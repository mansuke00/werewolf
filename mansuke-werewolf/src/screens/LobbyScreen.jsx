import React, { useState, useMemo, useEffect } from 'react';
import { Users, Crown, Settings, Mic, Play, Loader, Info, AlertTriangle, LogOut, Trash2, Shield, Moon, Sun, Ghost, Swords, Eye, Skull, Search, User, Crosshair, Smile, Check, Maximize2, Clock, X, BadgeCheck } from 'lucide-react';
import { updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { isPlayerOnline } from '../utils/helpers';
import { ROLE_DEFINITIONS } from '../constants/gameData';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';

// 設定用タブの定義
const TABS = [
    { id: 'citizen', label: '市民陣営', icon: Shield, color: 'text-blue-400', border: 'border-blue-500/50', bg: 'bg-blue-900/20' },
    { id: 'werewolf', label: '人狼陣営', icon: Moon, color: 'text-red-400', border: 'border-red-500/50', bg: 'bg-red-900/20' },
    { id: 'third', label: '第三陣営', icon: Ghost, color: 'text-orange-400', border: 'border-orange-500/50', bg: 'bg-orange-900/20' },
    { id: 'rules', label: 'ルール設定', icon: Settings, color: 'text-gray-300', border: 'border-gray-500/50', bg: 'bg-gray-800/40' },
];

export const LobbyScreen = ({ user, room, roomCode, players, setNotification, setView, setRoomCode }) => {
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
      
      // 自分のプレイヤー情報を取得し、開発者フラグを確認
      const myPlayer = players.find(p => p.id === user?.uid);
      const isDev = myPlayer?.isDev === true;
      const isHostUser = room.hostId === user?.uid;
      const hasControl = isHostUser || isDev; // ホストまたは開発者がコントロール可能

      const [roleSettings, setRoleSettings] = useState(room.roleSettings || {});
      const [anonymousVoting, setAnonymousVoting] = useState(room.anonymousVoting !== undefined ? room.anonymousVoting : true);
      const [inPersonMode, setInPersonMode] = useState(room.inPersonMode !== undefined ? room.inPersonMode : false);
      const [discussionTime, setDiscussionTime] = useState(room.discussionTime !== undefined ? room.discussionTime : 240); // デフォルト240秒
      const [loading, setLoading] = useState(false);
      const [activeTab, setActiveTab] = useState('citizen'); // 初期タブ
      
      const [modalConfig, setModalConfig] = useState(null);
      const [showCodeModal, setShowCodeModal] = useState(false); // ルームコード拡大表示用

      useEffect(() => {
          if (room) {
              setRoleSettings(room.roleSettings || {});
              setAnonymousVoting(room.anonymousVoting !== undefined ? room.anonymousVoting : true);
              setInPersonMode(room.inPersonMode !== undefined ? room.inPersonMode : false);
              setDiscussionTime(room.discussionTime !== undefined ? room.discussionTime : 240);
          }
      }, [room]);

      const validPlayers = useMemo(() => players.filter(p => !p.isSpectator), [players]);
      const validPlayerCount = validPlayers.length;
      
      const totalAssigned = Object.values(roleSettings).reduce((a,b) => a+b, 0);

      const validationError = useMemo(() => {
          if (validPlayerCount < 4) return "開始には最低4人のプレイヤーが必要です";
          if (totalAssigned !== validPlayerCount) return "配役の合計が人数と一致していません";
          
          let wolfCount = 0;
          let humanCount = 0;
          Object.entries(roleSettings).forEach(([r, c]) => { 
              if (['werewolf', 'greatwolf', 'wise_wolf'].includes(r)) wolfCount += c; // 賢狼も人狼としてカウント
              else humanCount += c;
          });
          
          if (wolfCount === 0) return "人狼がいません";
          if (wolfCount >= humanCount) return "人狼が過半数を占めているため、開始できません";
          
          return null;
      }, [validPlayerCount, totalAssigned, roleSettings]);

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
                  await updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { status: 'closed' });
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
          // ホストは開発者を追放できない（開発者はホストも追放可能）
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
                      await deleteDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', playerId));
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

      // 役職カテゴリー分け
      const roleGroups = {
          citizen: ['citizen', 'seer', 'medium', 'knight', 'trapper', 'sage', 'killer', 'detective', 'cursed', 'elder', 'assassin'],
          werewolf: ['werewolf', 'greatwolf', 'wise_wolf', 'madman'],
          third: ['fox', 'teruteru']
      };

      if (loading) return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white relative">
            <div className="absolute inset-0 bg-blue-900/10 animate-pulse"></div>
            <Loader className="animate-spin text-white mb-6 relative z-10" size={64}/>
            <p className="text-xl font-bold tracking-widest relative z-10">GAME STARTING...</p>
            <p className="text-xs text-gray-400 mt-2 relative z-10">ゲームを開始しています</p>
        </div>
      );

      return (
          <div className="h-screen w-full bg-gray-950 text-gray-100 font-sans relative overflow-hidden flex flex-col">
              {modalConfig && <ConfirmationModal {...modalConfig} />}
              
              {/* ルームコード拡大表示モーダル */}
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
              
              {/* 背景エフェクト */}
              <div className="fixed inset-0 z-0 pointer-events-none">
                  <div className="absolute -top-20 -right-20 w-[600px] h-[600px] bg-blue-900/10 rounded-full blur-[100px]"></div>
                  <div className="absolute -bottom-20 -left-20 w-[600px] h-[600px] bg-purple-900/10 rounded-full blur-[100px]"></div>
                  <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5"></div>
              </div>

              {/* メインコンテンツ - 2カラムレイアウト (左: 部屋情報/プレイヤー, 右: 設定) */}
              {/* スマホ対応: grid-cols-1, h-auto, overflow-y-auto */}
              <div className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10 min-h-0 overflow-y-auto lg:overflow-hidden">
                  
                  {/* --- 左カラム: 部屋情報 & プレイヤーリスト --- */}
                  <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full">
                      {/* ルームコードカード */}
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
                                  <button onClick={confirmForceClose} className="p-2 text-red-400 hover:bg-red-900/20 rounded-lg transition" title="部屋を解散"><LogOut size={18}/></button>
                              ) : (
                                  <button onClick={confirmLeaveRoom} className="p-2 text-gray-400 hover:bg-gray-800 rounded-lg transition" title="退出"><LogOut size={18}/></button>
                              )}
                          </div>
                          
                          {/* ステータスカード - モダンデザイン */}
                          <div className="mt-4 grid grid-cols-2 gap-3">
                              {/* 参加者カード */}
                              <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl p-3 flex flex-col items-center relative overflow-hidden group">
                                  <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition"><Users size={40}/></div>
                                  <span className="text-xs text-gray-400 font-bold mb-1 flex items-center gap-1"><Users size={12}/> 参加者</span>
                                  <span className="text-3xl font-black text-white font-mono">{validPlayerCount}<span className="text-xs ml-1 text-gray-600 font-sans font-bold">名</span></span>
                              </div>

                              {/* 配役カード */}
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

                      {/* プレイヤーリスト */}
                      {/* スマホ時は高さを制限してスクロール可能に */}
                      <div className="bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-700/50 flex flex-col lg:flex-1 min-h-[300px] lg:min-h-0 overflow-hidden shadow-xl">
                          <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-800/30">
                              <h3 className="font-bold text-gray-200 flex items-center gap-2"><Users size={18} className="text-blue-400"/> 参加者リスト</h3>
                              <span className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">{players.length}人</span>
                          </div>
                          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                              {players.map(p => (
                                  <div key={p.id} className="flex items-center justify-between bg-gray-800/30 hover:bg-gray-700/30 p-3 rounded-xl border border-transparent hover:border-gray-700 transition group">
                                      <div className="flex items-center gap-3 overflow-hidden">
                                          <div className={`w-2 h-2 rounded-full shrink-0 ${isPlayerOnline(p) ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-gray-600"}`}></div>
                                          <div className="flex flex-col min-w-0">
                                              <div className="flex items-center gap-2">
                                                  <span className={`font-bold text-sm truncate ${isPlayerOnline(p) ? "text-gray-200" : "text-gray-500"}`}>{p.name}</span>
                                                  {p.isDev && <span className="text-[10px] bg-indigo-900/50 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30 flex items-center gap-0.5"><BadgeCheck size={10}/> 開発者</span>}
                                              </div>
                                              {p.isSpectator && <span className="text-[9px] text-purple-400">観戦者</span>}
                                          </div>
                                      </div>
                                      <div className="flex items-center gap-1">
                                          {room.hostId === p.id && <Crown size={14} className="text-yellow-500"/>}
                                          {hasControl && p.id !== user.uid && (
                                              // ホストは開発者を追放できないチェックは confirmKickPlayer 内で行う
                                              // UI上は開発者に対してもゴミ箱アイコンを表示しておく（ただしホストには無効であることを通知）
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

                  {/* --- 右カラム: 設定パネル --- */}
                  <div className="lg:col-span-8 flex flex-col h-[600px] lg:h-full min-h-0 bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-700/50 shadow-2xl overflow-hidden relative">
                      
                      {/* タブヘッダー */}
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
                                      {tab.id !== 'rules' && (
                                          <span className="ml-1 text-[10px] opacity-60 bg-black/30 px-1.5 rounded-full">
                                              {roleGroups[tab.id].reduce((acc, key) => acc + (roleSettings[key] || 0), 0)}
                                          </span>
                                      )}
                                  </button>
                              );
                          })}
                      </div>

                      {/* コンテンツエリア */}
                      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar relative">
                          
                          {/* 陣営ごとの役職設定 */}
                          {['citizen', 'werewolf', 'third'].includes(activeTab) && (
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 animate-fade-in">
                                  {roleGroups[activeTab].map(key => {
                                      const def = ROLE_DEFINITIONS[key];
                                      const count = roleSettings[key] || 0;
                                      return (
                                          <div key={key} className={`relative flex flex-col h-full p-3 rounded-2xl border transition-all ${count > 0 ? "bg-gray-800/80 border-gray-600 shadow-lg" : "bg-gray-900/40 border-gray-800 opacity-60 hover:opacity-100"}`}>
                                              <div className={`mb-2 p-2 rounded-xl w-fit shrink-0 ${count > 0 ? (activeTab==='citizen'?'bg-blue-500/20 text-blue-400':activeTab==='werewolf'?'bg-red-500/20 text-red-400':'bg-orange-500/20 text-orange-400') : "bg-gray-800 text-gray-600"}`}>
                                                  {React.createElement(def.icon, { size: 20 })}
                                              </div>
                                              <span className="text-sm font-bold text-gray-200 truncate shrink-0">{def.name}</span>
                                              
                                              {/* 説明文エリアをflex-growで伸ばしてボタンを底に押しやる */}
                                              <p className="text-[10px] text-gray-500 leading-tight mt-1 mb-3 flex-grow whitespace-pre-wrap break-words">
                                                  {def.desc}
                                              </p>
                                              
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

                                  {/* 匿名投票モード */}
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

                                  {/* 対面モード */}
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

                      {/* フッターアクションエリア */}
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