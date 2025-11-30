import React, { useState, useEffect } from 'react';
import { Users, Crown, ArrowRight, Key, User, Search, RefreshCw, X } from 'lucide-react';
import { setDoc, getDoc, getDocs, doc, serverTimestamp, collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase.js';
import { getMillis } from '../utils/helpers.js';

export const HomeScreen = ({ user, setRoomCode, setView, setNotification, setMyPlayer }) => {
    // 画面遷移の状態管理（初期画面 -> 名前入力）
    const [homeStep, setHomeStep] = useState('initial');
    // 作成モードか参加モードか
    const [homeMode, setHomeMode] = useState(null);
    
    // 管理者ログイン用UIの状態
    const [showAdminInput, setShowAdminInput] = useState(false);
    const [adminPassInput, setAdminPassInput] = useState("");
    
    // ユーザー入力値
    const [nickname, setNickname] = useState("");
    const [roomCodeInput, setRoomCodeInput] = useState("");
    
    // DBから取得した正解の管理者パスワードを保持する
    const [adminPass, setAdminPass] = useState(null); 
    
    // 参加可能な部屋リスト
    const [availableRooms, setAvailableRooms] = useState([]);
    
    // 手動入力モーダルの制御
    const [showManualInputModal, setShowManualInputModal] = useState(false);
    const [isValidatingRoom, setIsValidatingRoom] = useState(false);

    // マウント時に管理者パスワードをFirestoreから引っこ抜いてくる
    // セキュリティ設定はsystemコレクションにある想定
    useEffect(() => {
        const fetchAdminPassword = async () => {
            try {
                const docRef = doc(db, 'system', 'settings');
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists() && docSnap.data().adminPassword) {
                    setAdminPass(docSnap.data().adminPassword);
                } else {
                    console.warn("Admin password not found in Firestore (system/settings).");
                }
            } catch (e) {
                console.error("Error fetching admin password:", e);
            }
        };
        fetchAdminPassword();
    }, []);

    // 部屋一覧のリアルタイム監視
    // 待機中の部屋だけ表示したいのでここでフィルタリング
    useEffect(() => {
        const q = query(
            collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const rooms = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }))
            // ステータスがwaitingのものだけに絞る
            .filter(room => room.status === 'waiting');
            
            // 新しい順にソートしておく
            rooms.sort((a, b) => {
                const tA = getMillis(a.createdAt);
                const tB = getMillis(b.createdAt);
                return tB - tA;
            });

            setAvailableRooms(rooms);
        }, (error) => {
            console.error("Error fetching rooms:", error);
        });

        return () => unsubscribe();
    }, []);

    // 管理者パスワードの照合処理
    const validateAdminPass = (pass) => { 
        // まだロード終わってない時は操作させない
        if (adminPass === null) {
            setNotification({ message: "設定を読み込み中です...", type: "warning" });
            return;
        }

        if(pass === adminPass) { setHomeStep('nickname'); setHomeMode('create'); } 
        else { setNotification({ message: "パスコードが違います", type: "error" }); } 
    };

    // 手入力された部屋コードが有効かチェックする
    // 存在確認とステータス（プレイ中か終了済みかなど）を見て適切なメッセージを出す
    const handleCheckRoom = async () => {
        if (roomCodeInput.length !== 4) return;
        setIsValidatingRoom(true);

        try {
            const roomRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCodeInput);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();
                if (roomData.status === 'waiting') {
                    // 入室可能なら名前入力画面へ
                    setShowManualInputModal(false);
                    setHomeStep('nickname');
                    setHomeMode('join');
                } else if (roomData.status === 'playing') {
                    setNotification({ message: "その部屋は既にゲーム中です", type: "warning" });
                } else if (roomData.status === 'closed' || roomData.status === 'finished') {
                    setNotification({ message: "その部屋は終了しています", type: "warning" });
                } else {
                    setNotification({ message: "現在この部屋には入れません", type: "error" });
                }
            } else {
                setNotification({ message: "部屋が見つかりません", type: "error" });
            }
        } catch (e) {
            console.error("Room check error:", e);
            setNotification({ message: "通信エラーが発生しました", type: "error" });
        } finally {
            setIsValidatingRoom(false);
        }
    };

    // 部屋作成処理（管理者のみ）
    const handleCreateRoom = async () => { 
        if(!nickname) return setNotification({ message: "名前を入力", type: "error" }); 
        try { 
            const code = Math.floor(1000+Math.random()*9000).toString(); 
            // とりあえずデフォルトの配役設定はこれ。後で設定画面で変えられるようにするかも？
            const defaultSettings = { citizen: 1, werewolf: 1, seer: 1, medium: 0, knight: 1, trapper: 0, sage: 0, killer: 0, detective: 0, cursed: 0, elder: 0, greatwolf: 0, madman: 0, fox: 0 };
            
            await setDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', code), { 
                hostId: user.uid, 
                hostName: nickname, 
                status: 'waiting', 
                phase: 'lobby', 
                roleSettings: defaultSettings, 
                createdAt: serverTimestamp(), 
                logs: [], 
                anonymousVoting: true, 
                inPersonMode: false 
            }); 
            // ホスト自身もプレイヤーとして登録
            await setDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', code, 'players', user.uid), { 
                name: nickname, status: 'alive', joinedAt: serverTimestamp(), lastSeen: serverTimestamp() 
            }); 
            setRoomCode(code); 
            setView('lobby'); 
        } catch(e){ setNotification({ message: "エラー", type: "error" }); } 
    };

    // 部屋への参加処理
    const handleJoinRoom = async (codeToJoin = roomCodeInput) => { 
        if(!nickname || codeToJoin.length!==4) return setNotification({ message: "入力エラー", type: "error" }); 
        try { 
            // 同じ名前の人がいないかチェック（なりすまし防止的な意味で）
            const playersRef = collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', codeToJoin, 'players');
            const playersSnap = await getDocs(playersRef);
            
            const isDuplicate = playersSnap.docs.some(doc => doc.data().name === nickname);
            if (isDuplicate) {
                setNotification({ message: "その名前は既に使用されています。別の名前を入力してください。", type: "error" });
                return;
            }

            await setDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', codeToJoin, 'players', user.uid), { 
                name: nickname, status: 'alive', joinedAt: serverTimestamp(), lastSeen: serverTimestamp() 
            }); 
            setRoomCode(codeToJoin);
            setView('lobby'); 
        } catch(e){ 
            console.error(e);
            setNotification({ message: "参加エラー: " + e.message, type: "error" }); 
        } 
    };

    // 一覧から部屋を選んだ時の挙動
    const handleRoomSelect = (roomId) => {
        setRoomCodeInput(roomId);
        setHomeStep('nickname');
        setHomeMode('join');
    };

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-4 font-sans relative overflow-y-auto pb-40">
            {/* 背景のエフェクト（ぼやっとした光） */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none"><div className="absolute top-[10%] left-[20%] w-96 h-96 bg-purple-600/30 rounded-full mix-blend-screen filter blur-[100px] animate-blob"></div><div className="absolute top-[10%] right-[20%] w-96 h-96 bg-blue-600/30 rounded-full mix-blend-screen filter blur-[100px] animate-blob animation-delay-2000"></div></div>
            
            {/* 部屋コード手動入力用のモーダル */}
            {showManualInputModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-gray-900 border border-gray-700 rounded-3xl p-6 w-full max-w-md shadow-2xl relative">
                        <button onClick={() => setShowManualInputModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={24}/></button>
                        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><Search size={20}/> 部屋コードを入力</h3>
                        <div className="space-y-4">
                            <input 
                                type="number" 
                                placeholder="部屋コード (4桁)" 
                                className="w-full bg-gray-950/50 border border-gray-600 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 transition text-center tracking-widest font-bold text-lg" 
                                value={roomCodeInput} 
                                onChange={(e) => setRoomCodeInput(e.target.value.slice(0, 4))} 
                            />
                            <button 
                                onClick={handleCheckRoom} 
                                disabled={roomCodeInput.length !== 4 || isValidatingRoom} 
                                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl py-3 font-bold transition flex items-center justify-center gap-2"
                            >
                                {isValidatingRoom ? "確認中..." : <>次へ <ArrowRight size={18}/></>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* メインコンテンツエリア */}
            <div className="z-10 w-full max-w-5xl px-2 h-full flex flex-col justify-center min-h-[500px]">
                <div className="text-center space-y-4 mb-8 shrink-0">
                    <h1 className="text-5xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 tracking-tighter drop-shadow-2xl py-2">MANSUKE<br/>WEREWOLF</h1>
                    <p className="text-sm text-gray-500 font-mono">Server Edition Ver 1.0</p>
                </div>

                <div className="bg-gray-900/60 backdrop-blur-xl border border-gray-700/50 rounded-3xl p-6 md:p-8 shadow-2xl relative w-full mx-auto flex flex-col h-auto">
                    
                    {/* Step 1: 初期画面（部屋一覧 & 管理者ログイン） */}
                    {homeStep === 'initial' && (
                        <div className="flex flex-col h-full animate-fade-in space-y-2">
                            
                            <div className="flex flex-col min-h-0">
                                <h2 className="text-xl font-bold text-white flex items-center justify-between gap-2 mb-4 shrink-0">
                                    <span className="flex items-center gap-2"><Users className="text-blue-400"/> 参加可能な部屋</span>
                                    <span className="text-xs bg-blue-900/30 text-blue-300 px-2 py-1 rounded border border-blue-500/30 flex items-center gap-1">
                                        <RefreshCw size={10} className="animate-spin-slow"/> リアルタイム更新中
                                    </span>
                                </h2>
                                
                                {/* 部屋リスト表示エリア */}
                                <div className={`overflow-y-auto custom-scrollbar pr-2 grid grid-cols-1 md:grid-cols-2 gap-3 content-start ${availableRooms.length > 0 ? "max-h-[400px]" : ""}`}>
                                    {availableRooms.length === 0 ? (
                                        <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center py-12 text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/30">
                                            <Search size={48} className="mb-4 opacity-50"/>
                                            <p className="font-bold">現在、参加可能な部屋はありません</p>
                                            <p className="text-xs mt-2">管理者が部屋を作成するのをお待ちください</p>
                                        </div>
                                    ) : (
                                        availableRooms.map(room => (
                                            <button 
                                                key={room.id}
                                                onClick={() => handleRoomSelect(room.id)}
                                                className="group relative flex flex-col items-start p-5 rounded-2xl border border-gray-700 bg-gradient-to-br from-gray-800/80 to-gray-900/80 hover:from-blue-900/40 hover:to-purple-900/40 hover:border-blue-500/50 transition-all duration-300 shadow-lg hover:shadow-blue-500/20 text-left w-full h-fit"
                                            >
                                                <div className="flex justify-between items-start w-full mb-2">
                                                    <span className="text-xs font-bold text-gray-400 bg-black/40 px-2 py-1 rounded">ROOM: {room.id}</span>
                                                    <ArrowRight size={18} className="text-gray-500 group-hover:text-blue-400 group-hover:translate-x-1 transition-transform"/>
                                                </div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <User size={16} className="text-blue-400"/>
                                                    <span className="font-bold text-lg text-white truncate">{room.hostName || "名無しホスト"} の部屋</span>
                                                </div>
                                                <p className="text-xs text-gray-500">
                                                    作成: {room.createdAt ? new Date(getMillis(room.createdAt)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "--:--"}
                                                </p>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="shrink-0 pt-4 space-y-6">
                                <div className="text-center">
                                    <button onClick={() => setShowManualInputModal(true)} className="text-sm text-gray-400 hover:text-white underline underline-offset-4 decoration-gray-600 hover:decoration-white transition">
                                        部屋が見つかりませんか？ コードを直接入力する
                                    </button>
                                </div>

                                {/* 管理者メニュー展開 */}
                                <div className="mt-4">
                                    {!showAdminInput ? (
                                        <button onClick={() => setShowAdminInput(true)} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold py-4 rounded-xl border border-gray-600 transition flex items-center justify-center gap-2">
                                            <Crown size={20} className="text-purple-400"/> 管理者として部屋を作成
                                        </button>
                                    ) : (
                                        <div className="flex flex-col gap-4 animate-fade-in-up">
                                            <div className="flex gap-2">
                                                <input type="password" placeholder="管理者パスコード" className="flex-1 bg-gray-950/50 border border-purple-500/50 rounded-xl px-4 py-3 text-white outline-none focus:border-purple-400 transition" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} />
                                                <button onClick={() => validateAdminPass(adminPassInput)} className="bg-purple-600 hover:bg-purple-500 text-white rounded-xl px-6 transition font-bold"><Key size={20}/></button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 2: ニックネーム入力画面 */}
                    {homeStep === 'nickname' && (
                        <div className="space-y-6 animate-fade-in flex flex-col justify-center h-full min-h-[400px]">
                            <button onClick={() => { setHomeStep('initial'); setAdminPassInput(""); setRoomCodeInput(""); }} className="text-xs text-gray-500 hover:text-white flex items-center gap-1 mb-2 absolute top-6 left-6"><ArrowRight className="rotate-180" size={12}/> 戻る</button>
                            <div className="text-center">
                                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-lg transform rotate-3">
                                    <User size={40} className="text-white"/>
                                </div>
                                <h2 className="text-3xl font-bold text-white mb-2">プレイヤー名を入力してください</h2>
                                <p className="text-sm text-gray-400">ゲーム内で表示されるニックネームを決めてください</p>
                                {homeMode === 'join' && <div className="mt-2 text-xs font-bold text-blue-400 bg-blue-900/20 inline-block px-3 py-1 rounded-full border border-blue-500/30">参加予定の部屋: {roomCodeInput}</div>}
                            </div>
                            <div className="space-y-4 max-w-sm mx-auto w-full">
                                <input maxLength={10} type="text" placeholder="名前 (10文字以内)" className="w-full bg-gray-950/50 border border-gray-600 rounded-xl px-6 py-4 text-white text-xl font-bold text-center outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition placeholder-gray-600" value={nickname} onChange={(e) => setNickname(e.target.value)} />
                                <button onClick={() => { homeMode === 'create' ? handleCreateRoom() : handleJoinRoom() }} className={`w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg transition transform hover:scale-105 active:scale-95 ${homeMode === 'create' ? "bg-gradient-to-r from-purple-600 to-pink-600" : "bg-gradient-to-r from-blue-600 to-cyan-500"}`}>{homeMode === 'create' ? "部屋を作成して開始" : "ゲームに参加する"}</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};