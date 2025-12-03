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
import { Loader, AlertTriangle, LogIn, XCircle, Home } from 'lucide-react';

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
      {showRestoreModal && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[999] flex items-center justify-center p-6 animate-fade-in">
              <div className="bg-gray-900 border-2 border-blue-500/50 rounded-3xl p-8 max-w-md w-full shadow-[0_0_50px_rgba(59,130,246,0.3)] relative text-center">
                  <div className="mx-auto w-16 h-16 bg-blue-900/30 rounded-full flex items-center justify-center mb-6 border border-blue-500/30 animate-pulse">
                      <LogIn size={32} className="text-blue-400"/>
                  </div>
                  
                  <h2 className="text-2xl font-black text-white mb-2 tracking-wide">WELCOME BACK</h2>
                  <p className="text-gray-400 text-sm mb-8 leading-relaxed">
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