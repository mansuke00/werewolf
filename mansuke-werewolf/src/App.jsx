import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, updateDoc, serverTimestamp } from 'firebase/firestore';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { db, auth } from './config/firebase';
import { Loader, Sword } from 'lucide-react';

import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { GameScreen } from './screens/GameScreen';
import { ResultScreen } from './screens/ResultScreen';
import { Notification } from './components/ui/Notification';

export default function App() {
  const [user, setUser] = useState(null);
  const [room, setRoom] = useState(null); 
  const [roomCode, setRoomCode] = useState(""); 
  const [players, setPlayers] = useState([]); 
  const [myPlayer, setMyPlayer] = useState(null);
  const [view, setView] = useState("home"); 
  const [notification, setNotification] = useState(null);

  // 匿名認証の初期化
  // これが完了しないとFirestoreに書き込めない
  useEffect(() => { 
      const ia = async ()=>{ try{ await signInAnonymously(auth); }catch(e){} }; ia(); 
      return onAuthStateChanged(auth, u=>setUser(u)); 
  }, []);

  // ハートビート処理（最終アクセス時刻の更新）
  // これを使ってオフライン判定や幽霊データの掃除を行う
  useEffect(() => { 
      if (!roomCode || !user) return; 
      const i = setInterval(() => { 
          updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid), { lastSeen: serverTimestamp() }); 
      }, 5000); 
      return () => clearInterval(i); 
  }, [roomCode, user]);

  // ルーム情報の監視と画面遷移制御
  useEffect(() => {
    if (!roomCode || !user || view === 'home') return;
    
    // ルーム自体のメタデータ監視
    const unsubRoom = onSnapshot(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        // IDを含めて状態に保存（結果画面などで使うため）
        setRoom({ ...d, id: snap.id });
        
        // ステータスに応じた画面切り替え
        if (d.status === 'playing') setView('game'); 
        else if (d.status === 'finished' || d.status === 'aborted') setView('result'); 
        else if (d.status === 'closed') { setNotification({message:"解散されました", type:"error"}); setView('home'); setRoomCode(""); } 
        else setView('lobby');
      }
    });

    // プレイヤーリストの監視
    const unsubPlayers = onSnapshot(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players'), (snap) => { 
        const p = snap.docs.map(d=>({id:d.id, ...d.data()})); 
        setPlayers(p); 
        if(user) {
            const me = p.find(pl=>pl.id===user.uid);
            if (me) setMyPlayer(me);
        }
    });

    return () => { unsubRoom(); unsubPlayers(); };
  }, [roomCode, user, view]); 

  // ホストによるキック（強制退出）の検知ロジック
  useEffect(() => {
    if (view === 'lobby' && room && user && players.length > 0) {
        const amIInList = players.find(p => p.id === user.uid);
        if (!amIInList) {
            setNotification({ message: "ホストにより退出させられました", type: "error" });
            setView('home');
            setRoomCode("");
        }
    }
  }, [players, view, room, user]);

  // 認証中のローディング画面
  if (!user) return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white relative overflow-hidden">
        <div className="absolute inset-0 z-0">
            <div className="absolute top-[30%] left-[20%] w-[500px] h-[500px] bg-purple-900/20 rounded-full blur-[100px] animate-blob"></div>
            <div className="absolute bottom-[20%] right-[20%] w-[500px] h-[500px] bg-blue-900/20 rounded-full blur-[100px] animate-blob animation-delay-2000"></div>
        </div>
        <div className="relative z-10 flex flex-col items-center">
            <div className="relative mb-8">
                <Sword size={64} className="text-gray-700 absolute top-0 left-0 animate-pulse"/>
                <Sword size={64} className="text-gray-500 relative top-2 left-2"/>
            </div>
            <h2 className="text-2xl font-black tracking-[0.5em] mb-4">AUTHENTICATING</h2>
            <div className="flex items-center gap-2 text-gray-400 text-sm font-bold">
                <Loader size={16} className="animate-spin"/>
                <span>認証サーバーに接続しています...</span>
            </div>
        </div>
    </div>
  );

  return (
    <>
        {notification && <Notification {...notification} onClose={() => setNotification(null)} />}
        
        {view === 'home' && (
            <HomeScreen 
                user={user} 
                setRoomCode={setRoomCode} 
                setView={setView} 
                setNotification={setNotification} 
                setMyPlayer={setMyPlayer}
            />
        )}
        
        {view === 'lobby' && (
            <LobbyScreen 
                user={user} 
                room={room} 
                roomCode={roomCode} 
                players={players} 
                setNotification={setNotification}
                setView={setView}
                setRoomCode={setRoomCode}
            />
        )}
        
        {view === 'game' && (
            <GameScreen 
                user={user} 
                room={room} 
                roomCode={roomCode} 
                players={players} 
                myPlayer={myPlayer}
                setView={setView}
            />
        )}
        
        {view === 'result' && (
            <ResultScreen 
                room={room} 
                players={players} 
                setView={setView} 
                setRoomCode={setRoomCode}
                roomCode={roomCode}
                myPlayer={myPlayer} 
                user={user}         
            />
        )}
    </>
  );
}