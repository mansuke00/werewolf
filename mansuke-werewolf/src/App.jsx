import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, getDoc, collection, query, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { HomeScreen } from './screens/HomeScreen.jsx';
import { LobbyScreen } from './screens/LobbyScreen.jsx';
import { GameScreen } from './screens/GameScreen.jsx';
import { ResultScreen } from './screens/ResultScreen.jsx';
import { LogViewerScreen } from './screens/LogViewerScreen.jsx';
import { Notification } from './components/ui/Notification.jsx';
import { db, auth } from './config/firebase.js';
import { HEARTBEAT_INTERVAL_MS } from './constants/gameData.js';
import { Loader, AlertTriangle, LogIn, XCircle, Home, MonitorX, ExternalLink, Copy, Check } from 'lucide-react';

// アプリケーションルートコンポーネント
// 全体的な状態管理、ルーティング（画面切替）、Firebase初期化、セッション管理を担当
export default function App() {
  // ステート: 認証・ユーザー
  const [user, setUser] = useState(null);
  
  // ステート: 画面遷移管理 ('home' | 'lobby' | 'game' | 'result' | 'logs')
  const [view, setView] = useState('home');
  
  // ステート: ゲームデータ
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [myPlayer, setMyPlayer] = useState(null);
  
  // ステート: システム・UI
  const [notification, setNotification] = useState(null);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // ステート: セッション復帰機能
  const [restoreRoomId, setRestoreRoomId] = useState(null);
  const [isRestoring, setIsRestoring] = useState(true); // 初期ロードフラグ
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  // ステート: 環境判定
  const [isMobileView, setIsMobileView] = useState(false); // スマホ/縦画面判定
  const [isInAppBrowser, setIsInAppBrowser] = useState(false); // アプリ内ブラウザ判定
  const [isUrlCopied, setIsUrlCopied] = useState(false);

  // Effect: 画面サイズ・閲覧環境チェック
  // スマホやアプリ内ブラウザでの閲覧を制限するための判定ロジック
  useEffect(() => {
    const checkScreen = () => {
      const isSmall = window.innerWidth < 768; // 幅768px未満
      const isPortrait = window.innerHeight > window.innerWidth; // 縦長
      // どちらかに該当すればモバイルビューとみなす
      setIsMobileView(isSmall || isPortrait);
    };

    // アプリ内ブラウザ判定 (UA文字列チェック)
    const checkInAppBrowser = () => {
        const ua = window.navigator.userAgent.toLowerCase();
        
        // 判定対象キーワード
        const inAppKeywords = [
            'slack', 'line', 'instagram', 'fban', 'fbav', 'fb_iab', 
            'twitter', 'micromessenger', 'tiktok', 'pinterest', 
            'snapchat', 'yjapp', 'yjm', 'googlesearchapp', 'wv'
        ];

        const isBlacklisted = inAppKeywords.some(keyword => ua.includes(keyword));
        setIsInAppBrowser(isBlacklisted);
    };

    checkScreen();
    checkInAppBrowser();
    window.addEventListener('resize', checkScreen);
    return () => window.removeEventListener('resize', checkScreen);
  }, []);

  // Effect: 初期化・認証・セッション復元チェック
  // アプリ起動時に一度だけ実行
  useEffect(() => {
    // 認証初期化処理
    const initAuth = async () => {
      try {
        // カスタムトークンがあれば優先使用、なければ匿名認証
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth Error:", error);
        setIsRestoring(false); // エラー時もロード解除
      }
    };
    initAuth();

    // 認証状態監視 & 復帰ロジック
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // ローカルストレージから前回の部屋コード取得
        const savedRoomCode = localStorage.getItem('mansuke_last_room');
        
        // 未入室かつ保存コードありの場合、復帰可能性をチェック
        if (savedRoomCode && !roomCode) {
           try {
               // プレイヤーデータが存在し、かつ追放(vanished)されていないか確認
               const playerRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', savedRoomCode, 'players', currentUser.uid);
               const playerSnap = await getDoc(playerRef);
               
               if (playerSnap.exists() && playerSnap.data().status !== 'vanished') {
                   setRestoreRoomId(savedRoomCode);
                   setShowRestoreModal(true); // 復帰確認モーダル表示
               } else {
                   localStorage.removeItem('mansuke_last_room'); // 無効なデータは削除
               }
           } catch (e) {
               console.error("Session check failed:", e);
               localStorage.removeItem('mansuke_last_room');
           }
        }
      }
      setIsRestoring(false); // 初期チェック完了
    });
    return () => unsubscribe();
  }, []); 

  // Effect: 部屋コード永続化管理
  // 入室時に保存、退室時に削除
  useEffect(() => {
      if (roomCode) {
          localStorage.setItem('mansuke_last_room', roomCode);
      } else if (!isRestoring && !showRestoreModal) {
          // 意図的な退室（復元処理中でない）ならストレージクリア
          localStorage.removeItem('mansuke_last_room');
      }
  }, [roomCode, isRestoring, showRestoreModal]);

  // Effect: メンテナンスモード監視
  // Firestoreのsystem/settingsを監視
  useEffect(() => {
      if (!user) return;
      const unsub = onSnapshot(doc(db, 'system', 'settings'), (doc) => {
          if (doc.exists()) setMaintenanceMode(doc.data().maintenanceMode || false);
      });
      return () => unsub();
  }, [user]);

  // Effect: メインゲームループ監視 (部屋・プレイヤー情報)
  // roomCodeがセットされた時点で起動し、リアルタイム更新と画面遷移を制御
  useEffect(() => {
    // 未認証または未入室ならリセットして終了
    if (!user || !roomCode) {
        setRoom(null);
        setPlayers([]);
        setMyPlayer(null);
        return;
    }

    const roomRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode);

    // 部屋情報監視リスナー
    const roomUnsub = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const rData = { id: docSnap.id, ...docSnap.data() };
        setRoom(rData);
        
        // 解散検知: status='closed'なら強制ホーム遷移
        if (rData.status === 'closed') {
            setRoomCode("");
            setView('home');
            setNotification({ message: "部屋が解散されました", type: "info" });
            return;
        }
        
        // 自動画面遷移ロジック
        // 現在の画面(view)と部屋のステータス(rData.status)に応じて遷移先を決定
        if (view === 'home') {
            // ホームからの遷移（復帰時など）
            if (rData.status === 'waiting') setView('lobby');
            else if (rData.status === 'playing') setView('game');
            else if (rData.status === 'finished' || rData.status === 'aborted') setView('result');
        } else if (view === 'lobby' && rData.status === 'playing') {
            // ロビー -> ゲーム開始
            setView('game');
        } else if (view === 'game' && (rData.status === 'finished' || rData.status === 'aborted')) {
            // ゲーム中 -> 終了/中断
            setView('result');
        } else if (view === 'result' && rData.status === 'waiting') {
            // 結果画面 -> 再戦（ロビーへ）
            setView('lobby');
        }

      } else {
        // ドキュメント消失時の処理
        setRoomCode("");
        setView('home');
        setNotification({ message: "部屋が見つかりません（解散された可能性があります）", type: "info" });
      }
    }, (error) => {
        console.warn("Room sync warning:", error.message);
        // エラー時は安全のためホームへ
        setRoomCode("");
        setView('home');
        setNotification({ message: "部屋への接続が切れました", type: "error" });
    });

    // プレイヤーリスト監視リスナー
    const q = query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players'));
    const playersUnsub = onSnapshot(q, (snapshot) => {
      const pList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setPlayers(pList);
      
      const me = pList.find(p => p.id === user.uid);
      if (me) {
          setMyPlayer(me);
          // 追放検知
          if (me.status === 'vanished') {
              setRoomCode("");
              setView('home');
              setNotification({ message: "部屋から退出しました", type: "info" });
          }
      } else if (pList.length > 0) {
          // リストはあるのに自分がいない場合（削除された）
          setRoomCode("");
          setView('home');
      }
    }, (error) => {
        console.warn("Player sync warning:", error.message);
    });

    return () => { roomUnsub(); playersUnsub(); };
  }, [user, roomCode, view]);

  // Effect: 生存確認 (Heartbeat)
  // 定期的にlastSeenを更新し、オフライン判定を防ぐ
  useEffect(() => {
      if (!user || !roomCode) return;
      
      const interval = setInterval(() => {
          updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid), {
              lastSeen: serverTimestamp()
          }).catch(e => console.log("Heartbeat failed", e));
      }, HEARTBEAT_INTERVAL_MS);
      
      return () => clearInterval(interval);
  }, [user, roomCode]);

  // ハンドラ: 復帰モーダル「再参加」
  const handleConfirmRestore = () => {
      if (restoreRoomId) {
          setRoomCode(restoreRoomId); // roomCode更新によりメイン監視Effectが発火
          setRestoreRoomId(null);
          setShowRestoreModal(false);
          setNotification({ message: "セッションを復元しました", type: "success" });
      }
  };

  // ハンドラ: 復帰モーダル「キャンセル」
  const handleCancelRestore = () => {
      localStorage.removeItem('mansuke_last_room');
      setRestoreRoomId(null);
      setShowRestoreModal(false);
  };

  // ハンドラ: URLコピー
  const handleCopyUrl = () => {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
          setIsUrlCopied(true);
          setTimeout(() => setIsUrlCopied(false), 2000);
      });
  };

  // 表示分岐: アプリ内ブラウザ警告 (最優先)
  if (isInAppBrowser) {
      return (
          <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6 text-center text-white overflow-hidden font-sans">
              <div className="max-w-md w-full flex flex-col items-center gap-6 animate-fade-in-up">
                  <div className="p-6 bg-yellow-900/20 rounded-full border border-yellow-500/30 shadow-[0_0_30px_rgba(234,179,8,0.2)]">
                      <ExternalLink size={64} className="text-yellow-500" />
                  </div>
                  <h1 className="text-xl md:text-2xl font-black leading-tight">
                      MANSUKE WEREWOLFは<br/>アプリ内ブラウザでは<br/>ご利用いただけません
                  </h1>
                  <div className="bg-gray-900/80 border border-gray-700 p-6 rounded-2xl text-sm text-gray-300 leading-relaxed text-left shadow-xl">
                      Slackなどで直接リンクを開いた可能性があります。<br/>
                      Safariなどのブラウザアプリから直接開いてください。
                  </div>
                  
                  <div className="w-full space-y-3">
                      <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">PAGE URL</p>
                      <button 
                          onClick={handleCopyUrl}
                          className="w-full bg-gray-800 border border-gray-600 hover:bg-gray-700 hover:border-gray-500 text-white rounded-xl py-4 px-4 flex items-center justify-between transition group relative overflow-hidden"
                      >
                          <span className="font-mono text-sm truncate mr-4 text-gray-300 group-hover:text-white transition">
                              {window.location.href}
                          </span>
                          <div className={`flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${isUrlCopied ? "bg-green-500/20 text-green-400" : "bg-black/30 text-gray-400 group-hover:text-white"}`}>
                              {isUrlCopied ? <Check size={14} /> : <Copy size={14} />}
                              {isUrlCopied ? "COPIED" : "COPY"}
                          </div>
                      </button>
                  </div>
              </div>
          </div>
      );
  }

  // 表示分岐: 画面サイズ警告 (PC/タブレット推奨)
  if (isMobileView) {
      return (
          <div className="fixed inset-0 z-[9999] bg-gray-950 flex flex-col items-center justify-center p-6 text-center text-white overflow-hidden">
              <div className="max-w-md w-full flex flex-col items-center gap-6 animate-fade-in-up">
                  <div className="p-6 bg-red-900/20 rounded-full border border-red-500/30">
                      <MonitorX size={64} className="text-red-500" />
                  </div>
                  <h1 className="text-xl md:text-2xl font-black leading-tight">
                      MANSUKE WEREWOLFは<br/>スマートフォンまたは縦画面には<br/>対応していません
                  </h1>
                  <div className="bg-gray-900/80 border border-gray-700 p-6 rounded-2xl text-sm text-gray-300 leading-relaxed text-left">
                      レスポンシブデザインに対応しようと頑張ったのですが、必要な情報量やゲーム体験を考慮した結果、タブレットやPCなどの大画面でのみ対応することとなりました。今後の対応予定はありません。<br/><br/>
                      ご迷惑をおかけしますが、タブレットやPCから <span className="text-blue-400 font-mono font-bold select-all">https://mansuke.cerinal.com/werewolf</span> にアクセスするか、以下のQRコードを読み取ってください。
                  </div>
                  <div className="bg-white p-4 rounded-xl">
                      <img 
                          src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://mansuke.cerinal.com/werewolf" 
                          alt="QR Code" 
                          className="w-32 h-32"
                      />
                  </div>
              </div>
          </div>
      );
  }

  // 表示分岐: 初期ロード中
  if (isRestoring) {
      return (
          <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white">
              <Loader className="animate-spin text-blue-500 mb-4" size={48}/>
              <p className="text-sm font-bold tracking-widest text-gray-400">CONNECTING...</p>
          </div>
      );
  }

  // 表示分岐: メインアプリケーション
  return (
    <>
      {/* グローバル通知 */}
      {notification && <Notification {...notification} onClose={() => setNotification(null)} />}
      
      {/* 復帰確認モーダル */}
      {showRestoreModal && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[999] flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-gray-900 border-2 border-blue-500/50 rounded-3xl p-6 md:p-8 w-full max-w-md shadow-[0_0_50px_rgba(59,130,246,0.3)] relative text-center">
                  <div className="mx-auto w-16 h-16 bg-blue-900/30 rounded-full flex items-center justify-center mb-6 border border-blue-500/30 animate-pulse">
                      <LogIn size={32} className="text-blue-400"/>
                  </div>
                  
                  <h2 className="text-xl md:text-2xl font-black text-white mb-2 tracking-wide">WELCOME BACK</h2>
                  <p className="text-gray-400 text-xs md:text-sm mb-8 leading-relaxed">
                      中断されたゲームセッションが見つかりました。<br/>
                      部屋 <span className="font-mono text-blue-300 font-bold text-lg mx-1">{restoreRoomId}</span> に再接続しますか？
                  </p>
                  
                  <div className="flex flex-col gap-3">
                      <button 
                          onClick={handleConfirmRestore}
                          className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg transition transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                      >
                          <LogIn size={20}/> 再参加する
                      </button>
                      <button 
                          onClick={handleCancelRestore}
                          className="w-full py-4 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white font-bold rounded-xl border border-gray-700 transition flex items-center justify-center gap-2"
                      >
                          <XCircle size={20}/> 拒否してホームへ
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* 画面ルーティング */}
      {view === 'home' && <HomeScreen user={user} setRoomCode={setRoomCode} setView={setView} setNotification={setNotification} setMyPlayer={setMyPlayer} maintenanceMode={maintenanceMode} />}
      {view === 'logs' && <LogViewerScreen setView={setView} />}
      {view === 'lobby' && <LobbyScreen user={user} room={room} roomCode={roomCode} players={players} setNotification={setNotification} setView={setView} setRoomCode={setRoomCode} />}
      {view === 'game' && <GameScreen user={user} room={room} roomCode={roomCode} players={players} myPlayer={myPlayer} setView={setView} />}
      {view === 'result' && <ResultScreen user={user} room={room} roomCode={roomCode} players={players} myPlayer={myPlayer} setView={setView} setRoomCode={setRoomCode} maintenanceMode={maintenanceMode} setNotification={setNotification} />}
    </>
  );
}