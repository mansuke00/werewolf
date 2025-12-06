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

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home');
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [myPlayer, setMyPlayer] = useState(null);
  const [notification, setNotification] = useState(null);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // 復帰機能用の状態
  const [restoreRoomId, setRestoreRoomId] = useState(null);
  const [isRestoring, setIsRestoring] = useState(true); // 初期ロード中はtrue
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  // 画面サイズ・向きの監視
  const [isMobileView, setIsMobileView] = useState(false);
  // アプリ内ブラウザの監視
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  // URLコピー済みフラグ
  const [isUrlCopied, setIsUrlCopied] = useState(false);

  useEffect(() => {
    const checkScreen = () => {
      const isSmall = window.innerWidth < 768; // スマホ想定
      const isPortrait = window.innerHeight > window.innerWidth;
      // 小さい画面または縦画面のいずれかであればブロック
      setIsMobileView(isSmall || isPortrait);
    };

    // アプリ内ブラウザ検知（強化版）
    const checkInAppBrowser = () => {
        const ua = window.navigator.userAgent.toLowerCase();
        
        // 検知したいキーワードリスト（全て小文字で記述）
        const inAppKeywords = [
            'slack',      // Slack
            'line',       // LINE
            'instagram',  // Instagram
            'fban',       // Facebook (Android)
            'fbav',       // Facebook (iOS)
            'fb_iab',     // Facebook (In-App Browser)
            'twitter',    // Twitter
            'micromessenger', // WeChat
            'tiktok',     // TikTok
            'pinterest',  // Pinterest
            'snapchat',   // Snapchat
            'yjapp',      // Yahoo! JAPAN アプリ
            'yjm',        // Yahoo! JAPAN モバイル
            'googlesearchapp', // Google検索アプリ
            'wv'          // Android WebView (一般的な識別子)
        ];

        // キーワード判定
        const isBlacklisted = inAppKeywords.some(keyword => ua.includes(keyword));
        
        setIsInAppBrowser(isBlacklisted);
        
        // デバッグ用: もし開発者コンソールが見れる場合はUAを確認できます
        // console.log("User Agent:", ua, "Is In-App:", isBlacklisted);
    };

    checkScreen();
    checkInAppBrowser();
    window.addEventListener('resize', checkScreen);
    return () => window.removeEventListener('resize', checkScreen);
  }, []);

  // 1. 初期化・認証・状態復元チェック
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth Error:", error);
        setIsRestoring(false);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        const savedRoomCode = localStorage.getItem('mansuke_last_room');
        // 保存された部屋コードがあり、まだ部屋に入っていない場合
        if (savedRoomCode && !roomCode) {
           try {
               // ★ここではデータが存在するかだけの確認に留め、自動復帰はしない
               const playerRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', savedRoomCode, 'players', currentUser.uid);
               const playerSnap = await getDoc(playerRef);
               
               if (playerSnap.exists() && playerSnap.data().status !== 'vanished') {
                   setRestoreRoomId(savedRoomCode);
                   setShowRestoreModal(true); // モーダルを表示
               } else {
                   localStorage.removeItem('mansuke_last_room');
               }
           } catch (e) {
               console.error("Session check failed:", e);
               localStorage.removeItem('mansuke_last_room');
           }
        }
      }
      setIsRestoring(false); // 認証とチェック完了
    });
    return () => unsubscribe();
  }, []); 

  // 2. 部屋コードの永続化管理（roomCodeが変更された時のみ実行）
  useEffect(() => {
      if (roomCode) {
          localStorage.setItem('mansuke_last_room', roomCode);
      } else if (!isRestoring && !showRestoreModal) {
          // 復元処理中やモーダル表示中でないのにroomCodeが空なら、意図的な退出とみなす
          localStorage.removeItem('mansuke_last_room');
      }
  }, [roomCode, isRestoring, showRestoreModal]);

  // 3. メンテナンスモード監視
  useEffect(() => {
      if (!user) return;
      const unsub = onSnapshot(doc(db, 'system', 'settings'), (doc) => {
          if (doc.exists()) setMaintenanceMode(doc.data().maintenanceMode || false);
      });
      return () => unsub();
  }, [user]);

  // 4. 部屋・プレイヤー監視と画面遷移制御
  useEffect(() => {
    // ★重要: ユーザー認証済みかつ、部屋コードがセットされている場合のみリスナーを開始する
    if (!user || !roomCode) {
        setRoom(null);
        setPlayers([]);
        setMyPlayer(null);
        return;
    }

    const roomRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode);

    const roomUnsub = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const rData = { id: docSnap.id, ...docSnap.data() };
        setRoom(rData);
        
        // 解散（closed）の検知：即座にホームへ
        if (rData.status === 'closed') {
            setRoomCode("");
            setView('home');
            setNotification({ message: "部屋が解散されました", type: "info" });
            return;
        }
        
        // 画面遷移ロジック
        if (view === 'home') {
            if (rData.status === 'waiting') setView('lobby');
            else if (rData.status === 'playing') setView('game');
            else if (rData.status === 'finished' || rData.status === 'aborted') setView('result');
        } else if (view === 'lobby' && rData.status === 'playing') {
            setView('game');
        } else if (view === 'game' && (rData.status === 'finished' || rData.status === 'aborted')) {
            setView('result');
        } else if (view === 'result' && rData.status === 'waiting') {
            // リザルト画面で部屋がwaitingに戻ったらロビーへ遷移（再戦時）
            setView('lobby');
        }

      } else {
        // ドキュメント自体が消えた（削除された）場合
        setRoomCode("");
        setView('home');
        setNotification({ message: "部屋が見つかりません（解散された可能性があります）", type: "info" });
      }
    }, (error) => {
        console.warn("Room sync warning:", error.message);
        // 権限エラー等で読めなくなった場合もホームへ
        setRoomCode("");
        setView('home');
        setNotification({ message: "部屋への接続が切れました", type: "error" });
    });

    const q = query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players'));
    const playersUnsub = onSnapshot(q, (snapshot) => {
      const pList = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setPlayers(pList);
      
      const me = pList.find(p => p.id === user.uid);
      if (me) {
          setMyPlayer(me);
          if (me.status === 'vanished') {
              setRoomCode("");
              setView('home');
              setNotification({ message: "部屋から退出しました", type: "info" });
          }
      } else if (pList.length > 0) {
          // データ取得ができているのに自分がいない＝削除された/追い出された
          setRoomCode("");
          setView('home');
      }
    }, (error) => {
        console.warn("Player sync warning:", error.message);
    });

    return () => { roomUnsub(); playersUnsub(); };
  }, [user, roomCode, view]);

  // 5. 生存確認（ハートビート）
  useEffect(() => {
      if (!user || !roomCode) return;
      
      const interval = setInterval(() => {
          updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid), {
              lastSeen: serverTimestamp()
          }).catch(e => console.log("Heartbeat failed", e));
      }, HEARTBEAT_INTERVAL_MS);
      
      return () => clearInterval(interval);
  }, [user, roomCode]);

  // 復帰処理のハンドラー
  const handleConfirmRestore = () => {
      if (restoreRoomId) {
          setRoomCode(restoreRoomId); // これによりuseEffectが発火し、リスナー登録→画面遷移が行われる
          setRestoreRoomId(null);
          setShowRestoreModal(false);
          setNotification({ message: "セッションを復元しました", type: "success" });
      }
  };

  const handleCancelRestore = () => {
      localStorage.removeItem('mansuke_last_room');
      setRestoreRoomId(null);
      setShowRestoreModal(false);
  };

  const handleCopyUrl = () => {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
          setIsUrlCopied(true);
          setTimeout(() => setIsUrlCopied(false), 2000);
      });
  };

  // アプリ内ブラウザ警告（最優先表示）
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

  // 画面サイズ警告（アプリ内ブラウザでない場合のみ表示）
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

  // ローディング画面（初期認証中）
  if (isRestoring) {
      return (
          <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white">
              <Loader className="animate-spin text-blue-500 mb-4" size={48}/>
              <p className="text-sm font-bold tracking-widest text-gray-400">CONNECTING...</p>
          </div>
      );
  }

  return (
    <>
      {/* 通知データが存在する場合のみ表示（空の通知枠が出ないようにする） */}
      {notification && <Notification {...notification} onClose={() => setNotification(null)} />}
      
      {/* 復帰確認モーダル（独自リッチデザイン） */}
      {/* レスポンシブ調整: モーダルの幅やマージンを調整 */}
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

      {view === 'home' && <HomeScreen user={user} setRoomCode={setRoomCode} setView={setView} setNotification={setNotification} setMyPlayer={setMyPlayer} maintenanceMode={maintenanceMode} />}
      {view === 'logs' && <LogViewerScreen setView={setView} />}
      {view === 'lobby' && <LobbyScreen user={user} room={room} roomCode={roomCode} players={players} setNotification={setNotification} setView={setView} setRoomCode={setRoomCode} />}
      {view === 'game' && <GameScreen user={user} room={room} roomCode={roomCode} players={players} myPlayer={myPlayer} setView={setView} />}
      {view === 'result' && <ResultScreen user={user} room={room} roomCode={roomCode} players={players} myPlayer={myPlayer} setView={setView} setRoomCode={setRoomCode} maintenanceMode={maintenanceMode} setNotification={setNotification} />}
    </>
  );
}