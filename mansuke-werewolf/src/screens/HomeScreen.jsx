import React, { useState, useEffect, useRef } from 'react';
import { Users, Crown, ArrowRight, Key, User, Search, RefreshCw, X, Eye, Settings, Trash2, Power, Construction, PlayCircle, History } from 'lucide-react';
import { setDoc, getDoc, getDocs, doc, serverTimestamp, collection, query, where, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase.js';
import { getMillis } from '../utils/helpers.js';

// コンポーネント: ホーム画面
// 役割: 部屋作成、参加、観戦、管理者機能、メンテナンス表示
export const HomeScreen = ({ user, setRoomCode, setView, setNotification, setMyPlayer, maintenanceMode }) => {
    // ステート: 画面遷移管理
    // initial: 初期画面
    // spectateRoomList: 途中参加（観戦）可能な部屋リスト
    // nickname: 名前入力画面
    // adminMenu: 管理者メニュー
    // maintenance: メンテナンス画面
    const [homeStep, setHomeStep] = useState('initial');
    
    // ステート: アクションモード (create: 作成, join: 参加, spectate: 観戦)
    const [homeMode, setHomeMode] = useState(null); 
    
    // ステート: 管理者機能関連
    const [showAdminAuth, setShowAdminAuth] = useState(false);
    const [adminPassInput, setAdminPassInput] = useState("");
    const [adminPass, setAdminPass] = useState(null); 
    const [isAdmin, setIsAdmin] = useState(false);
    
    // Ref: 隠しコマンド用タイマー（長押し判定用）
    const longPressTimerRef = useRef(null);
    
    // ステート: 入力データ・部屋リスト
    const [nickname, setNickname] = useState("");
    const [roomCodeInput, setRoomCodeInput] = useState("");
    const [availableRooms, setAvailableRooms] = useState([]);
    
    // ステート: モーダル・ローディング制御
    const [showManualInputModal, setShowManualInputModal] = useState(false);
    const [showSpectatorConfirmModal, setShowSpectatorConfirmModal] = useState(false); // 観戦参加確認
    const [isValidatingRoom, setIsValidatingRoom] = useState(false);

    // Effect: 管理者パスワード取得
    // Firestore 'system/settings' から取得
    // 依存配列に user を追加し、ログイン完了後に実行されるよう制御
    useEffect(() => {
        if (!user) return;

        const fetchAdminPassword = async () => {
            try {
                const docRef = doc(db, 'system', 'settings');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setAdminPass(docSnap.data().adminPassword);
                }
            } catch (e) {
                console.error("Error fetching admin password:", e);
            }
        };
        fetchAdminPassword();
    }, [user]);

    // Effect: メンテナンスモード監視
    // 管理者以外は強制的にメンテナンス画面へ遷移
    // 管理者はメンテナンス中も操作可能
    useEffect(() => {
        if (maintenanceMode && !isAdmin && homeStep !== 'maintenance') {
            setHomeStep('maintenance');
        } else if (!maintenanceMode && homeStep === 'maintenance') {
            setHomeStep('initial');
        }
    }, [maintenanceMode, isAdmin, homeStep]);

    // Effect: 部屋リストリアルタイム監視
    // 用途に応じてフィルタリング
    // - 途中参加(spectateRoomList): status='playing'
    // - 通常参加(その他): status='waiting'
    useEffect(() => {
        if (!user) return;

        const q = query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const allRooms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            let filteredRooms = [];
            if (homeStep === 'spectateRoomList') {
                // 進行中の部屋のみ抽出（終了・中断は除外）
                filteredRooms = allRooms.filter(room => room.status === 'playing');
            } else {
                // 待機中の部屋のみ抽出
                filteredRooms = allRooms.filter(room => room.status === 'waiting');
            }
            
            // 作成日時降順ソート
            filteredRooms.sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));
            setAvailableRooms(filteredRooms);
        }, (error) => {
            console.log("Room list fetch paused or failed:", error.message);
        });
        return () => unsubscribe();
    }, [homeStep, user]);

    // 関数: 管理者パスワード検証
    // adminPass未取得時は警告
    const validateAdminPass = (pass) => { 
        if (adminPass === null) {
            setNotification({ message: "設定を読み込み中です...", type: "warning" });
            return;
        }
        if(pass === adminPass) { 
            setIsAdmin(true);
            setHomeStep('adminMenu');
            setShowAdminAuth(false);
            setAdminPassInput("");
        } else { 
            setNotification({ message: "パスコードが違います", type: "error" }); 
        } 
    };

    // 関数: メンテナンスモード切り替え (Cloud Functions)
    const handleToggleMaintenance = async () => {
        try {
            const fn = httpsCallable(functions, 'toggleMaintenance');
            await fn({ enabled: !maintenanceMode });
            setNotification({ message: `メンテナンスモードを${!maintenanceMode ? "ON" : "OFF"}にしました`, type: "success" });
        } catch (e) {
            setNotification({ message: "変更エラー: " + e.message, type: "error" });
        }
    };

    // 関数: 部屋コード検証
    // 入力されたコードの部屋が存在するか、参加可能かチェック
    const handleCheckRoom = async () => {
        if (roomCodeInput.length !== 4) return;
        setIsValidatingRoom(true);

        try {
            const roomRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCodeInput);
            const roomSnap = await getDoc(roomRef);

            if (roomSnap.exists()) {
                const roomData = roomSnap.data();
                
                if (roomData.status === 'waiting') {
                    // 待機中 -> 参加フローへ
                    setShowManualInputModal(false);
                    setHomeStep('nickname');
                    setHomeMode('join');
                } else if (roomData.status === 'playing') {
                    // 進行中 -> 観戦確認モーダル表示
                    setShowManualInputModal(false);
                    setShowSpectatorConfirmModal(true);
                } else {
                    // 終了/中断 -> エラー
                    setNotification({ message: "部屋が見つかりません", type: "error" });
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

    // 関数: 観戦モード参加確定
    const confirmJoinSpectator = () => {
        setShowSpectatorConfirmModal(false);
        setHomeStep('nickname');
        setHomeMode('spectate');
    };

    // 関数: 隠しコマンド (長押し開始)
    // タイトルロゴ等を2秒長押しで管理者認証表示
    const handlePressStart = () => {
        longPressTimerRef.current = setTimeout(() => {
            setShowAdminAuth(true);
            if (navigator.vibrate) navigator.vibrate(50); // バイブレーションフィードバック
        }, 2000); 
    };

    // 関数: 隠しコマンド (長押し中断)
    const handlePressEnd = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    // 関数: 部屋作成処理
    // isDev: 管理者メニューからの作成時true
    const handleCreateRoom = async (isDev = false) => { 
        if(!nickname) return setNotification({ message: "名前を入力", type: "error" }); 
        try { 
            // 部屋コード生成 (1000-9999)
            const code = Math.floor(1000+Math.random()*9000).toString(); 
            // 初期設定値
            const defaultSettings = { citizen: 1, werewolf: 1, seer: 1, medium: 0, knight: 1, trapper: 0, sage: 0, killer: 0, detective: 0, cursed: 0, elder: 0, greatwolf: 0, madman: 0, fox: 0, assassin: 0, teruteru: 0 };
            
            // 部屋ドキュメント作成
            await setDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', code), { 
                hostId: user.uid, hostName: nickname, status: 'waiting', phase: 'lobby', roleSettings: defaultSettings, createdAt: serverTimestamp(), logs: [], anonymousVoting: true, inPersonMode: false 
            }); 
            
            const playerData = { 
                name: nickname, status: 'alive', joinedAt: serverTimestamp(), lastSeen: serverTimestamp() 
            };
            if (isDev) playerData.isDev = true;

            // ホストプレイヤー作成
            await setDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', code, 'players', user.uid), playerData); 
            setRoomCode(code); 
            setView('lobby'); 
        } catch(e){ setNotification({ message: "エラー", type: "error" }); } 
    };

    // 関数: 部屋参加処理
    // 観戦参加の場合はCloud Functions経由
    const handleJoinRoom = async (codeToJoin = roomCodeInput, isDev = false) => { 
        if(!nickname || codeToJoin.length!==4) return setNotification({ message: "入力エラー", type: "error" }); 
        
        try { 
            // 観戦モード処理
            if (homeMode === 'spectate') {
                const joinSpectatorFn = httpsCallable(functions, 'joinSpectator');
                await joinSpectatorFn({ roomCode: codeToJoin, nickname: nickname, isDev });
                setRoomCode(codeToJoin);
                setView('game'); 
                return;
            }

            // 通常参加: 同名チェック
            const playersRef = collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', codeToJoin, 'players');
            const playersSnap = await getDocs(playersRef);
            if (playersSnap.docs.some(doc => doc.data().name === nickname)) {
                setNotification({ message: "その名前は既に使用されています。", type: "error" });
                return;
            }

            const playerData = { 
                name: nickname, 
                status: 'alive', 
                joinedAt: serverTimestamp(), 
                lastSeen: serverTimestamp(),
                isSpectator: false
            };
            if (isDev) playerData.isDev = true;

            // プレイヤー追加
            await setDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', codeToJoin, 'players', user.uid), playerData); 
            setRoomCode(codeToJoin);
            setView('lobby'); 
        } catch(e){ 
            console.error(e);
            setNotification({ message: "参加エラー: " + e.message, type: "error" }); 
        } 
    };

    // 関数: 部屋リストからの選択処理
    // 選択された部屋IDをセットし検証へ
    const handleRoomSelect = (roomId) => {
        setRoomCodeInput(roomId);
        setIsValidatingRoom(true);
        // リスト上の情報を使って簡易チェック（通信削減）
        const targetRoom = availableRooms.find(r => r.id === roomId);
        
        if (targetRoom) {
            if (targetRoom.status === 'waiting') {
                setHomeStep('nickname');
                setHomeMode('join');
                setIsValidatingRoom(false);
            } else if (targetRoom.status === 'playing') {
                // 進行中 -> 観戦確認へ
                setShowSpectatorConfirmModal(true);
                setIsValidatingRoom(false);
            } else {
                setNotification({ message: "部屋が見つかりません", type: "error" });
                setIsValidatingRoom(false);
            }
        } else {
            // リスト情報のラグ対策でサーバー確認
            handleCheckRoom(); 
        }
    };

    // レンダリング: メンテナンス画面
    if (homeStep === 'maintenance' && !isAdmin) {
        return (
            <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4 md:p-6 relative overflow-hidden font-sans">
                {/* 背景エフェクト */}
                <div className="absolute inset-0 z-0">
                    <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-amber-900/20 via-black to-black animate-pulse-slow"></div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[1px] bg-amber-500/50 blur-sm"></div>
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1px] h-[800px] bg-amber-500/50 blur-sm"></div>
                </div>
                
                <div className="relative z-10 text-center max-w-2xl px-4">
                    <Construction size={60} className="text-amber-500 mx-auto mb-6 md:w-20 md:h-20 md:mb-8"/>
                    {/* タイトル (長押しで管理者認証トリガー) */}
                    <h1 
                        className="text-4xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-300 to-amber-700 mb-6 tracking-tight select-none cursor-default active:scale-95 transition-transform"
                        onMouseDown={handlePressStart}
                        onMouseUp={handlePressEnd}
                        onMouseLeave={handlePressEnd}
                        onTouchStart={handlePressStart}
                        onTouchEnd={handlePressEnd}
                    >
                        MAINTENANCE
                    </h1>
                    <p className="text-lg md:text-2xl text-gray-300 font-bold mb-4">
                        メンテナンスモードが有効です
                    </p>
                    <div className="bg-gray-900/80 backdrop-blur border border-amber-500/30 p-6 rounded-2xl">
                        <p className="text-gray-400 leading-relaxed text-sm md:text-base">
                            現在開発者がメンテナンスを行っております。<br/>
                            開発者の準備が完了するまで、しばらくお待ちください。
                        </p>
                    </div>
                </div>

                {/* メンテナンス画面用 管理者認証モーダル */}
                {showAdminAuth && (
                    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
                        <div className="bg-gray-900 border border-amber-500/50 rounded-2xl p-6 w-full max-w-sm shadow-2xl relative">
                            <button onClick={() => setShowAdminAuth(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={20}/></button>
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Key size={18} className="text-amber-500"/> 管理者認証</h3>
                            <div className="flex gap-2">
                                <input type="password" placeholder="パスコード" className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-amber-500" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} />
                                <button onClick={() => validateAdminPass(adminPassInput)} className="bg-amber-600 hover:bg-amber-500 text-white rounded-lg px-4 font-bold transition">解除</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-4 font-sans relative overflow-y-auto pb-40">
            
            {/* 手動コード入力モーダル */}
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

            {/* 観戦参加確認モーダル */}
            {showSpectatorConfirmModal && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[250] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-gray-900 border border-purple-500/50 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative text-center">
                        <Eye size={48} className="text-purple-400 mx-auto mb-4 animate-pulse"/>
                        <h3 className="text-xl font-bold text-white mb-2">この部屋でゲームが進行中です</h3>
                        <p className="text-gray-400 text-sm mb-6 leading-relaxed">
                            観戦者モードとして参加しますか？<br/>
                            このゲームは観戦者として霊界に参加し、次回の試合からゲームに参加することができます。
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowSpectatorConfirmModal(false)} className="flex-1 py-3 rounded-xl border border-gray-600 text-gray-400 font-bold hover:bg-gray-800 transition">
                                キャンセル
                            </button>
                            <button onClick={confirmJoinSpectator} className="flex-1 py-3 rounded-xl bg-purple-600 text-white font-bold hover:bg-purple-500 transition shadow-lg shadow-purple-900/20">
                                参加する
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 管理者認証モーダル (通常画面用) */}
            {showAdminAuth && !isAdmin && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-gray-900 border border-purple-500/50 rounded-2xl p-6 w-full max-w-sm shadow-2xl relative">
                        <button onClick={() => setShowAdminAuth(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={20}/></button>
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Crown size={18} className="text-purple-500"/> 管理者メニューを開く</h3>
                        <div className="flex gap-2">
                            <input type="password" placeholder="パスコード" className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-white outline-none focus:border-purple-500" value={adminPassInput} onChange={(e) => setAdminPassInput(e.target.value)} />
                            <button onClick={() => validateAdminPass(adminPassInput)} className="bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-4 font-bold transition">認証</button>
                        </div>
                    </div>
                </div>
            )}

            {/* メインレイアウト */}
            <div className="z-10 w-full max-w-5xl px-2 h-full flex flex-col justify-center min-h-[500px]">
                {/* ヘッダー・タイトルロゴ */}
                <div className="text-center space-y-4 mb-8 shrink-0">
                    {/* タイトル長押しで隠しコマンド発火 */}
                    <h1 
                        className="text-4xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 tracking-tighter drop-shadow-2xl py-2 cursor-default select-none active:scale-95 transition-transform"
                        onMouseDown={handlePressStart}
                        onMouseUp={handlePressEnd}
                        onMouseLeave={handlePressEnd}
                        onTouchStart={handlePressStart}
                        onTouchEnd={handlePressEnd}
                    >
                        MANSUKE<br/>WEREWOLF
                    </h1>
                    <p className="text-xs md:text-sm text-gray-500 font-mono">Server Edition Ver 3.1</p>
                </div>

                <div className="bg-gray-900/60 backdrop-blur-xl border border-gray-700/50 rounded-3xl p-6 md:p-8 shadow-2xl relative w-full mx-auto flex flex-col h-auto">
                    
                    {/* 画面: 初期画面 or 途中参加部屋リスト */}
                    {(homeStep === 'initial' || homeStep === 'spectateRoomList') && (
                        <div className="flex flex-col h-full animate-fade-in space-y-4">
                            
                            {/* 戻るボタン (途中参加画面 or 管理者認証済み時) */}
                            {(homeStep === 'spectateRoomList' || isAdmin) && (
                                <button onClick={() => homeStep === 'spectateRoomList' ? setHomeStep('initial') : setHomeStep('adminMenu')} className="absolute top-6 left-6 text-gray-500 hover:text-white flex items-center gap-1">
                                    <ArrowRight className="rotate-180" size={14}/> {isAdmin ? "管理者メニューに戻る" : "戻る"}
                                </button>
                            )}

                            {/* 部屋リスト表示エリア */}
                            <div className="flex flex-col min-h-0">
                                <h2 className="text-lg md:text-xl font-bold text-white flex items-center justify-between gap-2 mb-4 shrink-0 mt-2">
                                    <span className="flex items-center gap-2">
                                        {homeStep === 'spectateRoomList' ? <Eye className="text-purple-400"/> : <Users className="text-blue-400"/>} 
                                        {homeStep === 'spectateRoomList' ? "途中参加可能な部屋" : "参加可能な部屋"}
                                    </span>
                                    <span className="text-[10px] md:text-xs bg-blue-900/30 text-blue-300 px-2 py-1 rounded border border-blue-500/30 flex items-center gap-1 whitespace-nowrap">
                                        <RefreshCw size={10} className="animate-spin-slow"/> リアルタイム更新中
                                    </span>
                                </h2>
                                
                                {/* 部屋カードリスト */}
                                <div className={`overflow-y-auto custom-scrollbar pr-2 grid grid-cols-1 md:grid-cols-2 gap-3 content-start ${availableRooms.length > 0 ? "max-h-[300px]" : ""}`}>
                                    {availableRooms.length === 0 ? (
                                        <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center py-12 text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl bg-gray-900/30">
                                            <Search size={48} className="mb-4 opacity-50"/>
                                            <p className="font-bold">現在、部屋はありません</p>
                                            <p className="text-xs mt-2">
                                                {homeStep === 'spectateRoomList' ? "進行中のゲームはありません" : "新しい部屋が作成されるのをお待ちください"}
                                            </p>
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
                                                    <div className="flex gap-2">
                                                        {room.status === 'playing' && <span className="text-[10px] font-bold bg-green-900/50 text-green-300 px-2 py-0.5 rounded border border-green-500/30">進行中</span>}
                                                        {room.status === 'finished' && <span className="text-[10px] font-bold bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30">終了</span>}
                                                        {room.status === 'aborted' && <span className="text-[10px] font-bold bg-red-900/50 text-red-300 px-2 py-0.5 rounded border border-red-500/30">中断</span>}
                                                        <ArrowRight size={18} className="text-gray-500 group-hover:text-blue-400 group-hover:translate-x-1 transition-transform"/>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 mb-1 w-full">
                                                    <User size={16} className="text-blue-400 shrink-0"/>
                                                    <span className="font-bold text-base md:text-lg text-white truncate w-full">{room.hostName || "名無しホスト"} の部屋</span>
                                                </div>
                                                <p className="text-xs text-gray-500">
                                                    作成: {room.createdAt ? new Date(getMillis(room.createdAt)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "--:--"}
                                                </p>
                                            </button>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="shrink-0 pt-2 space-y-4">
                                {/* 手動入力トリガー */}
                                <div className="text-center space-y-2">
                                    <button onClick={() => setShowManualInputModal(true)} className="text-sm text-gray-400 hover:text-white underline underline-offset-4 decoration-gray-600 hover:decoration-white transition block mx-auto">
                                        部屋が見つかりませんか？ コードを直接入力する
                                    </button>
                                </div>

                                {/* メインアクションボタン (通常モード) */}
                                {homeStep === 'initial' && !isAdmin && (
                                    <div className="space-y-3 mt-4 pt-4 border-t border-gray-800">
                                        <button onClick={() => { setHomeStep('nickname'); setHomeMode('create'); }} className="w-full py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 rounded-xl shadow-lg hover:scale-[1.02] transition transform text-white font-black text-lg flex flex-col items-center justify-center gap-1 group">
                                            <span className="flex items-center gap-2"><Crown size={24} /> 部屋を新しく作成</span>
                                        </button>

                                        <div className="flex flex-col md:flex-row gap-3">
                                            <button onClick={() => setHomeStep('spectateRoomList')} className="flex-1 bg-gray-800/50 hover:bg-gray-800 text-gray-300 font-bold py-4 rounded-xl border border-gray-700 transition flex items-center justify-center gap-2 text-sm group">
                                                <Eye size={18} className="text-blue-400 group-hover:scale-110 transition"/> 途中参加
                                            </button>
                                            <button onClick={() => setView('logs')} className="flex-1 bg-gray-800/50 hover:bg-gray-800 text-gray-300 font-bold py-4 rounded-xl border border-gray-700 transition flex items-center justify-center gap-2 text-sm group">
                                                <History size={18} className="text-green-400 group-hover:rotate-12 transition"/> 過去のゲーム結果
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 画面: 管理者メニュー */}
                    {homeStep === 'adminMenu' && (
                        <div className="flex flex-col h-full animate-fade-in space-y-6 justify-center">
                            <button onClick={() => { setHomeStep('initial'); setIsAdmin(false); }} className="absolute top-6 left-6 text-gray-500 hover:text-white flex items-center gap-1"><ArrowRight className="rotate-180" size={14}/> 戻る</button>
                            
                            <div className="text-center mb-4">
                                <div className="inline-block p-4 rounded-full bg-purple-900/30 border border-purple-500/30 mb-2">
                                    <Settings size={40} className="text-purple-400"/>
                                </div>
                                <h2 className="text-2xl font-bold text-white">ADMINISTRATION</h2>
                                <p className="text-sm text-gray-400">管理者機能を選択してください</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto w-full">
                                <button onClick={() => { setHomeStep('nickname'); setHomeMode('create'); }} className="md:col-span-2 py-8 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl shadow-lg hover:scale-105 transition transform text-white font-black text-xl flex flex-col items-center justify-center gap-2 group">
                                    <Crown size={32} /> 部屋を新しく作成
                                </button>
                                
                                <div className="bg-gray-800/50 border border-gray-700 p-6 rounded-2xl flex flex-col items-center justify-center gap-4">
                                    <div className="flex flex-col items-center">
                                        <span className="text-sm font-bold text-gray-300 flex items-center gap-2"><Construction size={16}/> メンテナンスモード</span>
                                        <p className="text-xs text-gray-500 mt-1">一般ユーザーのアクセスを制限</p>
                                    </div>
                                    <button 
                                        onClick={handleToggleMaintenance} 
                                        className={`relative w-16 h-8 rounded-full transition-colors duration-300 ${maintenanceMode ? "bg-amber-500" : "bg-gray-600"}`}
                                    >
                                        <div className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-all duration-300 shadow-md ${maintenanceMode ? "left-9" : "left-1"}`}></div>
                                    </button>
                                    <span className={`text-xs font-bold ${maintenanceMode ? "text-amber-400" : "text-gray-500"}`}>{maintenanceMode ? "ON (制限中)" : "OFF (通常)"}</span>
                                </div>

                                <button onClick={() => { setHomeStep('initial'); setHomeMode('join'); }} className="bg-gray-800/50 border border-gray-700 hover:bg-gray-800 p-6 rounded-2xl flex flex-col items-center justify-center gap-2 transition text-gray-300 hover:text-white font-bold">
                                    <ArrowRight size={24}/> 部屋に参加する
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 画面: ニックネーム入力 (作成/参加/観戦 共通) */}
                    {homeStep === 'nickname' && (
                        <div className="space-y-6 animate-fade-in flex flex-col justify-center h-full min-h-[400px]">
                            <button onClick={() => { setHomeStep(homeMode === 'spectate' ? 'spectateRoomList' : (isAdmin ? 'adminMenu' : 'initial')); setAdminPassInput(""); setRoomCodeInput(""); }} className="text-xs text-gray-500 hover:text-white flex items-center gap-1 mb-2 absolute top-6 left-6"><ArrowRight className="rotate-180" size={12}/> 戻る</button>
                            <div className="text-center">
                                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-lg transform rotate-3">
                                    <User size={40} className="text-white"/>
                                </div>
                                <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">プレイヤー名を入力してください</h2>
                                <p className="text-sm text-gray-400">ゲーム内で表示されるニックネームを決めてください</p>
                                {(homeMode === 'join' || homeMode === 'spectate') && <div className="mt-2 text-xs font-bold text-blue-400 bg-blue-900/20 inline-block px-3 py-1 rounded-full border border-blue-500/30">{homeMode==='spectate'?'観戦':'参加'}予定の部屋: {roomCodeInput}</div>}
                            </div>
                            <div className="space-y-4 max-w-sm mx-auto w-full">
                                <input maxLength={10} type="text" placeholder="名前 (10文字以内)" className="w-full bg-gray-950/50 border border-gray-600 rounded-xl px-6 py-4 text-white text-xl font-bold text-center outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition placeholder-gray-600" value={nickname} onChange={(e) => setNickname(e.target.value)} />
                                <button onClick={() => { homeMode === 'create' ? handleCreateRoom(isAdmin) : handleJoinRoom(undefined, isAdmin) }} className={`w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg transition transform hover:scale-105 active:scale-95 ${homeMode === 'create' ? "bg-gradient-to-r from-purple-600 to-pink-600" : homeMode === 'spectate' ? "bg-gradient-to-r from-gray-600 to-gray-800" : "bg-gradient-to-r from-blue-600 to-cyan-500"}`}>{homeMode === 'create' ? "部屋を作成して開始" : homeMode === 'spectate' ? "観戦する" : "ゲームに参加する"}</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};