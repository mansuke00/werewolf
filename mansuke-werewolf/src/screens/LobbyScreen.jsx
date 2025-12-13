import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Users, Crown, Settings, Mic, Play, Loader, Info, AlertTriangle, LogOut, Trash2, Shield, Moon, Sun, Ghost, Swords, Eye, Skull, Search, User, Crosshair, Smile, Check, Maximize2, Clock, X, BadgeCheck, Globe, MessageSquare, Send, Calendar } from 'lucide-react';
import { updateDoc, doc, deleteDoc, collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { isPlayerOnline } from '../utils/helpers';
import { ROLE_DEFINITIONS, ROLE_GROUPS } from '../constants/gameData'; // ROLE_GROUPSをインポート
import { ConfirmationModal } from '../components/ui/ConfirmationModal';
import { InfoModal } from '../components/ui/InfoModal';

// 設定パネル用タブ定義
const TABS = [
    { id: 'chat', label: 'ロビーチャット', icon: MessageSquare, color: 'text-green-400', border: 'border-green-500/50', bg: 'bg-green-900/20' },
    { id: 'citizen', label: '市民陣営', icon: Shield, color: 'text-blue-400', border: 'border-blue-500/50', bg: 'bg-blue-900/20' },
    { id: 'werewolf', label: '人狼陣営', icon: Moon, color: 'text-red-400', border: 'border-red-500/50', bg: 'bg-red-900/20' },
    { id: 'third', label: '第三陣営', icon: Ghost, color: 'text-orange-400', border: 'border-orange-500/50', bg: 'bg-orange-900/20' },
    { id: 'rules', label: 'ルール設定', icon: Settings, color: 'text-gray-300', border: 'border-gray-500/50', bg: 'bg-gray-800/40' },
];

// コンポーネント: 待機ロビー画面
export const LobbyScreen = ({ user, room, roomCode, players, setNotification, setView, setRoomCode }) => {
      // 1. フックの宣言を最上部に移動
      
      // ブラウザ互換性チェックステート
      const [isBrowserSupported, setIsBrowserSupported] = useState(true);

      // ローカル設定ステート
      const [roleSettings, setRoleSettings] = useState(room?.roleSettings || {});
      const [anonymousVoting, setAnonymousVoting] = useState(room?.anonymousVoting !== undefined ? room.anonymousVoting : true);
      const [inPersonMode, setInPersonMode] = useState(room?.inPersonMode !== undefined ? room.inPersonMode : false);
      const [discussionTime, setDiscussionTime] = useState(room?.discussionTime !== undefined ? room.discussionTime : 240); 
      const [loading, setLoading] = useState(false);
      const [activeTab, setActiveTab] = useState('chat');
      
      // チャット用State
      const [messages, setMessages] = useState([]);
      const [newMessage, setNewMessage] = useState('');
      const messagesEndRef = useRef(null);
      
      // モーダル制御
      const [modalConfig, setModalConfig] = useState(null);
      const [showCodeModal, setShowCodeModal] = useState(false); 
      const [showDevActionModal, setShowDevActionModal] = useState(false); 
      
      // Memo: 開発者バッジ表示用フラグ
      const hasDevPlayer = useMemo(() => players.some(p => p.isDev), [players]);

      // Memo: プレイヤー人数計算（観戦者除外）
      const validPlayers = useMemo(() => players.filter(p => !p.isSpectator), [players]);
      const validPlayerCount = validPlayers.length;
      
      // 配役合計数計算
      // 画面に表示されていなくても、設定値として残っている場合はカウントに含める（矛盾を防ぐため）
      const totalAssigned = Object.values(roleSettings).reduce((a,b) => a+b, 0);

      // Memo: ゲーム開始条件バリデーション
      const validationError = useMemo(() => {
          if (validPlayerCount < 4) return "開始には最低4人のプレイヤーが必要です";
          if (totalAssigned !== validPlayerCount) return "配役の合計が人数と一致していません";
          
          let wolfCount = 0;
          let humanCount = 0;
          Object.entries(roleSettings).forEach(([r, c]) => { 
              if (['werewolf', 'greatwolf', 'wise_wolf'].includes(r)) wolfCount += c; 
              else humanCount += c;
          });
          
          if (wolfCount === 0) return "人狼がいません";
          if (wolfCount >= humanCount) return "人狼が過半数を占めているため、開始できません";
          
          return null;
      }, [validPlayerCount, totalAssigned, roleSettings]);

      // Effect: 推奨ブラウザ判定
      useEffect(() => {
          const checkBrowser = () => {
              const ua = window.navigator.userAgent.toLowerCase();
              let supported = false;

              if (ua.includes('opr') || ua.includes('opera')) {
                  supported = false;
              } else if (ua.includes('firefox')) {
                  supported = true;
              } else if (ua.includes('edg')) {
                  supported = true;
              } else if (ua.includes('chrome')) {
                  supported = true;
              } else if (ua.includes('safari')) {
                  supported = true;
              }

              setIsBrowserSupported(supported);
          };
          checkBrowser();
      }, []);

      // Effect: サーバーからの設定更新を同期
      useEffect(() => {
          if (room) {
              setRoleSettings(room.roleSettings || {});
              setAnonymousVoting(room.anonymousVoting !== undefined ? room.anonymousVoting : true);
              setInPersonMode(room.inPersonMode !== undefined ? room.inPersonMode : false);
              setDiscussionTime(room.discussionTime !== undefined ? room.discussionTime : 240);
          }
      }, [room]);

      // Effect: ロビーチャットの購読
      useEffect(() => {
        if (!roomCode) return;
    
        const q = query(
          collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'messages'),
          where('channel', '==', 'lobby'),
          orderBy('createdAt', 'asc'),
          limit(100)
        );
    
        const unsubscribe = onSnapshot(q, (snapshot) => {
          const msgs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setMessages(msgs);
        });
    
        return () => unsubscribe();
      }, [roomCode]);

      // Effect: メッセージ受信時にスクロール
      useEffect(() => {
        if (activeTab === 'chat') {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }, [messages, activeTab]);

      // --------------------------------------------------------------------------------
      // 2. 変数定義
      // --------------------------------------------------------------------------------
      
      const myPlayer = players.find(p => p.id === user?.uid);
      const isDev = myPlayer?.isDev === true;
      const isHostUser = room?.hostId === user?.uid;
      const hasControl = isHostUser || isDev;

      // 関数群定義
      const handleStartGame = async () => { 
          if(validationError) return setNotification({ message: validationError, type: "error" });
          setLoading(true); 
          try { 
              await updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { 
                  roleSettings, 
                  anonymousVoting, 
                  inPersonMode,
                  discussionTime 
              }); 
              const fn = httpsCallable(functions, 'startGame'); 
              await fn({ roomCode }); 
          } catch(e){ setNotification({ message: e.message || "開始エラー", type: "error" }); } 
          finally { setLoading(false); } 
      };

      const confirmForceClose = () => {
          setModalConfig({
              title: "部屋の解散",
              message: "本当にこの部屋を解散しますか？\n参加中のプレイヤーは全員ホームに戻されます。",
              isDanger: true,
              onConfirm: async () => {
                  setModalConfig(null);
                  try {
                      const fn = httpsCallable(functions, 'deleteRoom');
                      await fn({ roomCode });
                  } catch (e) {
                      console.error(e);
                      await updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { status: 'closed' });
                  }
              },
              onCancel: () => setModalConfig(null)
          });
      };

      const confirmLeaveRoom = () => {
          setModalConfig({
              title: "部屋からの退出",
              message: "本当に退出しますか？",
              isDanger: false,
              onConfirm: async () => {
                  setModalConfig(null);
                  try {
                      await deleteDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid));
                      setView('home');
                      setRoomCode("");
                      setNotification({ message: "退出しました", type: "success" });
                  } catch(e) {
                      setNotification({ message: "退出エラー: " + e.message, type: "error" });
                  }
              },
              onCancel: () => setModalConfig(null)
          });
      };

      const confirmKickPlayer = (playerId, playerName, isTargetDev) => {
          if (isHostUser && isTargetDev) {
              setNotification({ message: "開発者を追放することはできません", type: "error" });
              return;
          }

          setModalConfig({
              title: "プレイヤーの追放",
              message: `${playerName} さんを部屋から追放しますか？`,
              isDanger: true,
              confirmText: "追放する",
              onConfirm: async () => {
                  setModalConfig(null);
                  try {
                      const fn = httpsCallable(functions, 'kickPlayer');
                      await fn({ roomCode, playerId });
                      setNotification({ message: `${playerName} さんを退出させました`, type: "success" });
                  } catch(e) {
                      setNotification({ message: "操作エラー: " + e.message, type: "error" });
                  }
              },
              onCancel: () => setModalConfig(null)
          });
      };

      const handleUpdateSettings = (key, val) => {
          const newSettings = {...roleSettings, [key]: val};
          setRoleSettings(newSettings);
          if (hasControl) updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { roleSettings: newSettings });
      };
      
      const handleUpdateAnonymous = (val) => {
          setAnonymousVoting(val);
          if (hasControl) updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { anonymousVoting: val });
      };

      const handleUpdateInPersonMode = (val) => {
          setInPersonMode(val);
          if (hasControl) updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { inPersonMode: val });
      };

      const handleUpdateDiscussionTime = (val) => {
          setDiscussionTime(val);
          if (hasControl) updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { discussionTime: val });
      };

      // チャット送信処理
      const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !user) return;

        try {
            await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'messages'), {
                text: newMessage,
                senderId: user.uid,
                senderName: user.displayName || '名無し',
                channel: 'lobby',
                createdAt: serverTimestamp(),
            });
            setNewMessage('');
        } catch (error) {
            console.error("Error sending message:", error);
            setNotification({ message: "メッセージの送信に失敗しました", type: "error" });
        }
      };

      // --------------------------------------------------------------------------------
      // 3. 早期リターン (フック宣言後に行うこと！)
      // --------------------------------------------------------------------------------

      // 非推奨ブラウザ時の警告表示
      if (!isBrowserSupported) {
          return (
              <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6 text-center text-white overflow-hidden font-sans">
                  <div className="max-w-md w-full flex flex-col items-center gap-6 animate-fade-in-up">
                      <div className="p-6 bg-red-900/20 rounded-full border border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                          <Globe size={64} className="text-red-500" />
                      </div>
                      <h1 className="text-xl md:text-2xl font-black leading-tight">
                          お使いのブラウザは<br/>推奨されていません
                      </h1>
                      <div className="bg-gray-900/80 border border-gray-700 p-6 rounded-2xl text-sm text-gray-300 leading-relaxed text-left shadow-xl w-full">
                          <p className="mb-4">
                              MANSUKE WEREWOLFを快適にプレイいただくため、以下のブラウザでのアクセスをお願いしています。
                          </p>
                          <ul className="space-y-2 font-bold text-white">
                              <li className="flex items-center gap-2"><Check size={16} className="text-green-400"/> Google Chrome</li>
                              <li className="flex items-center gap-2"><Check size={16} className="text-green-400"/> Safari</li>
                              <li className="flex items-center gap-2"><Check size={16} className="text-green-400"/> Microsoft Edge</li>
                              <li className="flex items-center gap-2"><Check size={16} className="text-green-400"/> Mozilla Firefox</li>
                          </ul>
                          <p className="mt-4 text-xs text-gray-500">
                              ※これら以外のブラウザでは、正常に動作しない可能性があります。
                          </p>
                      </div>
                  </div>
              </div>
          );
      }

      // データロード待機
      if (!room) return (
        <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-6 font-sans relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900 via-black to-black opacity-80"></div>
            <div className="relative z-10 flex flex-col items-center animate-fade-in-up">
                <Loader className="animate-spin text-blue-500 mb-6" size={48}/>
                <h3 className="text-2xl font-bold tracking-widest mb-2">CONNECTING</h3>
                <p className="text-gray-500 text-sm font-mono">部屋情報を同期しています...</p>
            </div>
        </div>
      );

      // ローディング画面
      if (loading) return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white relative">
            <div className="absolute inset-0 bg-blue-900/10 animate-pulse"></div>
            <Loader className="animate-spin text-white mb-6 relative z-10" size={64}/>
            <p className="text-xl font-bold tracking-widest relative z-10">GAME STARTING...</p>
            <p className="text-xs text-gray-400 mt-2 relative z-10">ゲームを開始しています</p>
        </div>
      );

      // --------------------------------------------------------------------------------
      // 4. メインレンダリング
      // --------------------------------------------------------------------------------
      return (
          // レイアウト: 2カラム (左:情報 / 右:設定)
          // SP対応: 横スクロール抑制 overflow-x-hidden
          <div className="min-h-screen w-full bg-gray-950 text-gray-100 font-sans relative overflow-x-hidden flex flex-col">
              {modalConfig && <ConfirmationModal {...modalConfig} />}
              
              {/* モーダル: 開発者用アクションメニュー */}
              {showDevActionModal && (
                  <InfoModal title="開発者メニュー" onClose={() => setShowDevActionModal(false)}>
                      <div className="flex flex-col gap-3 p-2">
                          <p className="text-sm text-gray-400 mb-2">この部屋に対する操作を選択してください。</p>
                          <button 
                              onClick={() => { setShowDevActionModal(false); confirmForceClose(); }}
                              className="w-full py-4 bg-red-900/50 border border-red-500 text-red-200 rounded-xl font-bold hover:bg-red-800 transition flex items-center justify-center gap-2"
                          >
                              <LogOut size={18}/> 部屋を解散する (全員強制退出)
                          </button>
                          <button 
                              onClick={() => { setShowDevActionModal(false); confirmLeaveRoom(); }}
                              className="w-full py-4 bg-gray-800 border border-gray-600 text-gray-300 rounded-xl font-bold hover:bg-gray-700 transition flex items-center justify-center gap-2"
                          >
                              <LogOut size={18}/> 部屋から退出する (自分のみ)
                          </button>
                      </div>
                  </InfoModal>
              )}

              {/* モーダル: 部屋コード拡大表示 */}
              {showCodeModal && (
                  <div className="fixed inset-0 z-[200] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center animate-fade-in" onClick={() => setShowCodeModal(false)}>
                      <button className="absolute top-6 right-6 text-gray-400 hover:text-white transition"><X size={32}/></button>
                      <p className="text-gray-400 text-lg font-bold tracking-widest mb-4 uppercase">Room Code</p>
                      <div className="text-[20vw] font-black text-white leading-none tracking-tighter font-mono select-none pointer-events-none drop-shadow-[0_0_50px_rgba(59,130,246,0.5)]">
                          {roomCode}
                      </div>
                      <p className="text-gray-500 mt-8 text-sm">クリックして閉じる</p>
                  </div>
              )}
              
              {/* 背景装飾 */}
              <div className="fixed inset-0 z-0 pointer-events-none">
                  <div className="absolute -top-20 -right-20 w-[600px] h-[600px] bg-blue-900/10 rounded-full blur-[100px]"></div>
                  <div className="absolute -bottom-20 -left-20 w-[600px] h-[600px] bg-purple-900/10 rounded-full blur-[100px]"></div>
                  <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5"></div>
              </div>

              {/* メインエリア */}
              <div className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10 min-h-0 overflow-y-auto">
                  
                  {/* 左カラム: 部屋情報 / プレイヤーリスト */}
                  <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full">
                      {/* 上部カード: コード表示 & 退室ボタン */}
                      <div className="bg-gray-900/80 backdrop-blur-xl rounded-3xl p-6 shadow-xl border border-gray-700/50 shrink-0">
                          <div className="flex justify-between items-start mb-2">
                              <div>
                                  <p className="text-gray-500 text-[10px] font-bold tracking-[0.2em] uppercase mb-1">Room Code</p>
                                  <div className="flex items-center gap-3 group cursor-pointer" onClick={() => setShowCodeModal(true)}>
                                      <span className="text-5xl font-black text-white tracking-widest font-mono group-hover:text-blue-400 transition">{roomCode}</span>
                                      <div className="bg-gray-800 p-2 rounded-lg group-hover:bg-blue-500/20 transition"><Maximize2 size={16} className="text-gray-500 group-hover:text-blue-400"/></div>
                                  </div>
                              </div>
                              {hasControl ? (
                                  (isDev && !isHostUser) ? (
                                      <button onClick={() => setShowDevActionModal(true)} className="p-2 text-indigo-400 hover:bg-indigo-900/20 rounded-lg transition" title="操作を選択"><Settings size={18}/></button>
                                  ) : (
                                      <button onClick={confirmForceClose} className="p-2 text-red-400 hover:bg-red-900/20 rounded-lg transition" title="部屋を解散"><LogOut size={18}/></button>
                                  )
                              ) : (
                                  <button onClick={confirmLeaveRoom} className="p-2 text-gray-400 hover:bg-gray-800 rounded-lg transition" title="退出"><LogOut size={18}/></button>
                              )}
                          </div>
                          
                          {/* ステータスカウンター: 人数 / 配役数 */}
                          <div className="mt-4 grid grid-cols-2 gap-3">
                              {/* 参加人数 */}
                              <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-3 flex flex-col items-center relative overflow-hidden group">
                                  <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition"><Users size={40}/></div>
                                  <span className="text-xs text-gray-400 font-bold mb-1 flex items-center gap-1"><Users size={12}/> 参加者</span>
                                  <span className="text-3xl font-black text-white font-mono">{validPlayerCount}<span className="text-xs ml-1 text-gray-600 font-sans font-bold">名</span></span>
                              </div>

                              {/* 配役数 (一致判定で色変化) */}
                              <div className={`border rounded-2xl p-3 flex flex-col items-center relative overflow-hidden group transition-all ${
                                  totalAssigned === validPlayerCount 
                                  ? "bg-green-900/20 border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.1)]" 
                                  : "bg-red-900/20 border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.1)]"
                              }`}>
                                  <div className={`absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition ${
                                      totalAssigned === validPlayerCount ? "text-green-400" : "text-red-400"
                                  }`}><Settings size={40}/></div>
                                  <span className={`text-xs font-bold mb-1 flex items-center gap-1 ${
                                      totalAssigned === validPlayerCount ? "text-green-400" : "text-red-400"
                                  }`}>
                                      {totalAssigned === validPlayerCount ? <Check size={12}/> : <AlertTriangle size={12}/>} 配役
                                  </span>
                                  <span className={`text-3xl font-black font-mono ${
                                      totalAssigned === validPlayerCount ? "text-green-400" : "text-red-400"
                                  }`}>{totalAssigned}<span className={`text-xs ml-1 font-sans font-bold ${
                                      totalAssigned === validPlayerCount ? "text-green-600" : "text-red-600"
                                  }`}>名</span></span>
                              </div>
                          </div>
                      </div>

                      {/* Info: 開発者参加通知 */}
                      {hasDevPlayer && (
                          <div className="bg-indigo-900/30 border border-indigo-500/30 rounded-2xl p-4 flex flex-col gap-2 shrink-0 animate-fade-in shadow-lg">
                              <div className="flex items-center gap-2">
                                  <div className="bg-indigo-500/20 p-2 rounded-full">
                                      <BadgeCheck size={20} className="text-indigo-400" />
                                  </div>
                                  <h3 className="font-bold text-indigo-100 text-sm md:text-base">開発者がこの部屋に参加しています！</h3>
                              </div>
                              <div className="pl-11">
                                  <p className="text-xs text-indigo-200 leading-relaxed mb-2">
                                      開発者バッジがついているプレイヤーは、MANSUKE WEREWOLFの開発者または協力者です。
                                  </p>
                                  <ul className="list-disc list-outside text-[10px] md:text-xs text-indigo-300/80 space-y-1 ml-4">
                                      <li>開発者も参加者の1人として、通常通りプレイします。</li>
                                      <li>ホストは、開発者を追放することはできません。</li>
                                  </ul>
                              </div>
                          </div>
                      )}

                      {/* プレイヤーリスト表示 */}
                      <div className="bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-700/50 flex flex-col lg:flex-1 min-h-[300px] lg:min-h-0 overflow-hidden shadow-xl">
                          <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-800/30">
                              <h3 className="font-bold text-gray-200 flex items-center gap-2"><Users size={18} className="text-blue-400"/> 参加者リスト</h3>
                              <span className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">{players.length}人</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                              {players.map(p => (
                                  <div key={p.id} className="flex items-center justify-between bg-gray-800/30 hover:bg-gray-700/30 p-3 rounded-xl border border-transparent hover:border-gray-700 transition group">
                                      <div className="flex items-center gap-3 overflow-hidden">
                                          {/* オンライン状態インジケータ */}
                                          <div className={`w-2 h-2 rounded-full shrink-0 ${isPlayerOnline(p) ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-gray-600"}`}></div>
                                          <div className="flex flex-col min-w-0">
                                              <div className="flex items-center gap-2">
                                                  <span className={`font-bold text-sm truncate ${isPlayerOnline(p) ? "text-gray-200" : "text-gray-500"}`}>{p.name}</span>
                                                  {p.isDev && <span className="text-[10px] bg-indigo-900/50 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30 flex items-center gap-0.5 shrink-0"><BadgeCheck size={10}/> 開発者</span>}
                                              </div>
                                              {p.isSpectator && <span className="text-[9px] text-purple-400">観戦者</span>}
                                          </div>
                                      </div>
                                      {/* アクション: ホストアイコン / 追放ボタン */}
                                      <div className="flex items-center gap-1">
                                          {room.hostId === p.id && <Crown size={14} className="text-yellow-500"/>}
                                          {hasControl && p.id !== user.uid && (
                                              <button onClick={() => confirmKickPlayer(p.id, p.name, p.isDev)} className="p-1.5 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded transition" title="追放">
                                                  <Trash2 size={14}/>
                                              </button>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>

                  {/* 右カラム: ゲーム設定パネル */}
                  <div className="lg:col-span-8 flex flex-col h-[600px] lg:h-full min-h-0 bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-700/50 shadow-2xl overflow-hidden relative">
                      
                      {/* 設定タブナビゲーション */}
                      <div className="flex items-center p-2 gap-2 overflow-x-auto custom-scrollbar border-b border-gray-800 bg-gray-950/50 shrink-0">
                          {TABS.map(tab => {
                              const isActive = activeTab === tab.id;
                              return (
                                  <button
                                      key={tab.id}
                                      onClick={() => setActiveTab(tab.id)}
                                      className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs md:text-sm font-bold transition-all relative overflow-hidden whitespace-nowrap ${
                                          isActive 
                                          ? `${tab.bg} ${tab.color} border ${tab.border} shadow-lg` 
                                          : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                                      }`}
                                  >
                                      <tab.icon size={16} />
                                      {tab.label}
                                      {tab.id !== 'rules' && tab.id !== 'chat' && (
                                          <span className="ml-1 text-[10px] opacity-60 bg-black/30 px-1.5 rounded-full">
                                              {ROLE_GROUPS[tab.id].reduce((acc, key) => acc + (roleSettings[key] || 0), 0)}
                                          </span>
                                      )}
                                  </button>
                              );
                          })}
                      </div>

                      {/* 設定コンテンツエリア */}
                      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar relative">
                          
                          {/* ロビーチャットタブ */}
                          {activeTab === 'chat' && (
                              <div className="flex flex-col h-full animate-fade-in">
                                  {/* チャットログエリア */}
                                  <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 custom-scrollbar min-h-0">
                                      {messages.length === 0 ? (
                                          <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                              <MessageSquare size={48} className="mb-4 opacity-20" />
                                              <p className="text-sm">まだメッセージはありません</p>
                                              <p className="text-xs mt-1">挨拶してみましょう！</p>
                                          </div>
                                      ) : (
                                          messages.map(msg => {
                                              const isMe = msg.senderId === user.uid;
                                              return (
                                                  <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                                                      <div className={`flex items-baseline gap-2 mb-1 ${isMe ? "flex-row-reverse" : ""}`}>
                                                          <span className="text-xs font-bold text-gray-400">{msg.senderName}</span>
                                                          <span className="text-[10px] text-gray-600">
                                                              {msg.createdAt?.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                          </span>
                                                      </div>
                                                      <div className={`px-4 py-2 rounded-2xl text-sm max-w-[85%] break-words ${
                                                          isMe 
                                                          ? "bg-green-600 text-white rounded-tr-none" 
                                                          : "bg-gray-800 text-gray-200 rounded-tl-none border border-gray-700"
                                                      }`}>
                                                          {msg.text}
                                                      </div>
                                                  </div>
                                              );
                                          })
                                      )}
                                      <div ref={messagesEndRef} />
                                  </div>
                                  
                                  {/* 入力フォーム */}
                                  <form onSubmit={handleSendMessage} className="flex gap-2 shrink-0 pt-2 border-t border-gray-800">
                                      <input
                                          type="text"
                                          value={newMessage}
                                          onChange={(e) => setNewMessage(e.target.value)}
                                          placeholder="メッセージを入力..."
                                          className="flex-1 bg-gray-800/50 border border-gray-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:border-green-500/50 focus:bg-gray-800 transition placeholder-gray-500"
                                      />
                                      <button
                                          type="submit"
                                          disabled={!newMessage.trim()}
                                          className="bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white p-3 rounded-xl transition-colors shadow-lg shadow-green-900/20"
                                      >
                                          <Send size={20} />
                                      </button>
                                  </form>
                              </div>
                          )}

                          {/* 役職設定 (市民・人狼・第三陣営) */}
                          {['citizen', 'werewolf', 'third'].includes(activeTab) && (
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 animate-fade-in">
                                  {ROLE_GROUPS[activeTab].map(key => {
                                      const def = ROLE_DEFINITIONS[key];
                                      const count = roleSettings[key] || 0;

                                      // 期間限定役職などの表示設定チェック
                                      // isVisibleがfalseと明示されている場合のみ非表示（undefinedやtrueは表示）
                                      if (def.isVisible === false) {
                                          return null;
                                      }

                                      return (
                                          <div key={key} className={`relative flex flex-col h-full p-3 rounded-2xl border transition-all ${count > 0 ? "bg-gray-800/80 border-gray-600 shadow-lg" : "bg-gray-900/40 border-gray-800 opacity-60 hover:opacity-100"}`}>
                                              
                                              {/* バッジ表示 */}
                                              {def.badge && (
                                                  <div className={`absolute -top-2 -right-2 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm z-10 flex items-center gap-1 ${def.badge.color || "bg-yellow-500 text-black"}`}>
                                                      {/* 必要に応じてアイコンも可変にできますが、一旦Calendar固定か、badgeオブジェクトにiconを持たせることも可能です */}
                                                      <Calendar size={10} />
                                                      {def.badge.label}
                                                  </div>
                                              )}

                                              <div className={`mb-2 p-2 rounded-xl w-fit shrink-0 ${count > 0 ? (activeTab==='citizen'?'bg-blue-500/20 text-blue-400':activeTab==='werewolf'?'bg-red-500/20 text-red-400':'bg-orange-500/20 text-orange-400') : "bg-gray-800 text-gray-600"}`}>
                                                  {React.createElement(def.icon, { size: 20 })}
                                              </div>
                                              <span className="text-sm font-bold text-gray-200 truncate shrink-0">{def.name}</span>
                                              
                                              {/* 役職説明 (flex-growでレイアウト調整) */}
                                              <p className="text-[10px] text-gray-500 leading-tight mt-1 mb-3 flex-grow whitespace-pre-wrap break-words">
                                                  {def.desc}
                                              </p>
                                              
                                              {/* カウンター操作 */}
                                              <div className="mt-auto flex items-center justify-between bg-black/30 rounded-lg p-1 shrink-0">
                                                  {hasControl && <button onClick={() => handleUpdateSettings(key, Math.max(0, count - 1))} className="w-7 h-7 flex items-center justify-center rounded bg-gray-700/50 hover:bg-gray-600 text-gray-400 hover:text-white transition">-</button>}
                                                  <span className={`flex-1 text-center font-black text-lg ${count > 0 ? "text-white" : "text-gray-600"}`}>{count}</span>
                                                  {hasControl && <button onClick={() => handleUpdateSettings(key, count + 1)} className="w-7 h-7 flex items-center justify-center rounded bg-gray-700/50 hover:bg-gray-600 text-gray-400 hover:text-white transition">+</button>}
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                          )}

                          {/* ルール設定タブ */}
                          {activeTab === 'rules' && (
                              <div className="space-y-4 animate-fade-in max-w-2xl mx-auto">
                                  
                                  {/* 議論時間設定 */}
                                  <div className="bg-gray-800/40 p-5 rounded-2xl border border-gray-700 hover:border-gray-600 transition flex items-center justify-between">
                                      <div>
                                          <h4 className="font-bold text-white flex items-center gap-2 text-sm md:text-base"><Clock size={18} className="text-yellow-400"/> 議論時間（昼）</h4>
                                          <p className="text-xs text-gray-400 mt-1">昼フェーズの議論時間を設定します</p>
                                      </div>
                                      <div className="flex items-center gap-2">
                                          {hasControl && (
                                              <button onClick={() => handleUpdateDiscussionTime(Math.max(60, discussionTime - 10))} className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center transition">-</button>
                                          )}
                                          <span className="font-mono font-black text-xl w-16 text-center">{discussionTime}<span className="text-xs text-gray-500 ml-1">s</span></span>
                                          {hasControl && (
                                              <button onClick={() => handleUpdateDiscussionTime(discussionTime + 10)} className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center transition">+</button>
                                          )}
                                      </div>
                                  </div>

                                  {/* 匿名投票モード切替 */}
                                  <div className="bg-gray-800/40 p-5 rounded-2xl border border-gray-700 hover:border-gray-600 transition flex items-center justify-between">
                                      <div className="pr-4">
                                          <h4 className="font-bold text-white flex items-center gap-2 text-sm md:text-base"><Settings size={18}/> 匿名投票モード</h4>
                                          <p className="text-xs text-gray-400 mt-1 leading-relaxed">昼の投票において、誰が誰に投票したかを伏せて開票します。</p>
                                      </div>
                                      {hasControl ? (
                                          <button onClick={() => handleUpdateAnonymous(!anonymousVoting)} className={`w-14 h-7 rounded-full transition-colors relative shrink-0 ${anonymousVoting ? "bg-green-500" : "bg-gray-700"}`}>
                                              <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-md ${anonymousVoting ? "left-8" : "left-1"}`}></div>
                                          </button>
                                      ) : (
                                          <span className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 ${anonymousVoting ? "bg-green-500/20 text-green-400" : "bg-gray-700 text-gray-400"}`}>{anonymousVoting ? "ON" : "OFF"}</span>
                                      )}
                                  </div>

                                  {/* 対面モード切替 */}
                                  <div className="bg-gray-800/40 p-5 rounded-2xl border border-gray-700 hover:border-gray-600 transition flex items-center justify-between">
                                      <div className="pr-4">
                                          <h4 className="font-bold text-white flex items-center gap-2 text-sm md:text-base"><Mic size={18}/> 対面モード</h4>
                                          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                                              生存者チャットを無効化し、対面での議論を促します。<br/>
                                              役職チャット・霊界チャット・Gemini AI Chatはそのまま利用できます。
                                          </p>
                                      </div>
                                      {hasControl ? (
                                          <button onClick={() => handleUpdateInPersonMode(!inPersonMode)} className={`w-14 h-7 rounded-full transition-colors relative shrink-0 ${inPersonMode ? "bg-green-500" : "bg-gray-700"}`}>
                                              <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-md ${inPersonMode ? "left-8" : "left-1"}`}></div>
                                          </button>
                                      ) : (
                                          <span className={`text-xs font-bold px-3 py-1 rounded-full shrink-0 ${inPersonMode ? "bg-green-500/20 text-green-400" : "bg-gray-700 text-gray-400"}`}>{inPersonMode ? "ON" : "OFF"}</span>
                                      )}
                                  </div>
                                  
                                  <div className="p-4 bg-blue-900/10 border border-blue-500/20 rounded-xl text-xs text-blue-300 leading-relaxed">
                                      <Info size={16} className="inline mr-1 mb-0.5"/>
                                      役職の人数設定は、各陣営タブから行ってください。<br/>
                                      参加人数と役職の合計数が一致しないとゲームを開始できません。
                                  </div>
                              </div>
                          )}
                      </div>

                      {/* フッターアクション (ゲーム開始ボタン等) */}
                      <div className="p-4 border-t border-gray-800 bg-gray-900/50 backdrop-blur shrink-0">
                          {hasControl ? (
                              <div className="flex flex-col gap-2">
                                  {validationError && (
                                      <div className="flex items-center justify-center gap-2 text-red-400 text-xs font-bold bg-red-900/20 py-2 rounded-lg mb-2">
                                          <AlertTriangle size={14}/> {validationError}
                                      </div>
                                  )}
                                  <button 
                                      onClick={handleStartGame} 
                                      disabled={!!validationError} 
                                      className="w-full py-4 rounded-xl font-black text-lg bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:scale-[1.02] active:scale-[0.98] transition shadow-lg shadow-indigo-500/20 text-white disabled:opacity-50 disabled:scale-100 disabled:shadow-none flex items-center justify-center gap-2"
                                  >
                                      <Play fill="currentColor" size={20}/> ゲームを開始する
                                  </button>
                              </div>
                          ) : (
                              <div className="text-center py-3 bg-gray-800/50 rounded-xl border border-gray-700 border-dashed text-gray-400 text-sm animate-pulse">
                                  ホストが設定中です...
                              </div>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      );
};