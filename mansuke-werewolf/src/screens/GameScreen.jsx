import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, addDoc, serverTimestamp, query, where, orderBy, onSnapshot, doc, updateDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase.js';
import { ROLE_DEFINITIONS, TIME_LIMITS } from '../constants/gameData.js';
import { getMillis, formatPhaseName, isPlayerOnline } from '../utils/helpers.js';
import { Loader, History, Mic, Gavel, CheckCircle, Ghost, Sun, Moon, Clock, Settings, Users, ThumbsUp, Eye, LogOut, Sparkles, UserPlus, Skull } from 'lucide-react';

import { MiniRoleCard } from '../components/game/RoleCard.jsx';
import { ChatPanel } from '../components/game/ChatPanel.jsx';
import { LogPanel } from '../components/game/LogPanel.jsx';
import { NightActionPanel } from '../components/game/NightActionPanel.jsx';
import { GeminiChatPanel } from '../components/game/GeminiChatPanel.jsx';
import { RoleDistributionPanel } from '../components/game/RoleDistributionPanel.jsx';
import { SurvivorsList } from '../components/game/SurvivorsList.jsx';
import { ChatArchiveModal } from '../components/game/ChatArchiveModal.jsx';
import { CountdownScreen } from '../components/game/CountdownScreen.jsx';
import { RoleRevealScreen } from '../components/game/RoleRevealScreen.jsx';
import { DeadPlayerInfoPanel } from '../components/game/DeadPlayerInfoPanel.jsx';
import { VotingResultModal } from '../components/game/VotingResultModal.jsx';

import { OverlayNotification } from '../components/ui/OverlayNotification.jsx';
import { Notification } from '../components/ui/Notification.jsx';
import { InfoModal } from '../components/ui/InfoModal.jsx';

export const GameScreen = ({ user, room, roomCode, players, myPlayer, setView }) => {
    // 状態管理: 自分の役職やチームメイト情報はFirestoreのsecretサブコレクションから取得してここに保持
    const [myRole, setMyRole] = useState(null);
    const [teammates, setTeammates] = useState([]);
    
    // チャット・ログ関連のState
    const [messages, setMessages] = useState([]);
    const [teamMessages, setTeamMessages] = useState([]);
    const [graveMessages, setGraveMessages] = useState([]);
    const [logs, setLogs] = useState([]);
    
    // 進行制御用State
    const [timeLeft, setTimeLeft] = useState(0);
    const [nightActionDone, setNightActionDone] = useState(false);
    const [voteSelection, setVoteSelection] = useState(null);
    const [hasVoted, setHasVoted] = useState(false);
    
    // UI表示用State
    const [notification, setNotification] = useState(null);
    const [overlay, setOverlay] = useState(null);
    const [lastActionResult, setLastActionResult] = useState(null); // 占い・霊媒結果のキャッシュ
    
    // モーダル表示制御
    const [deadPlayersInfo, setDeadPlayersInfo] = useState([]);
    const [showRoleDist, setShowRoleDist] = useState(false);
    const [showSurvivors, setShowSurvivors] = useState(false);
    const [showArchive, setShowArchive] = useState(false);
    const [selectedArchive, setSelectedArchive] = useState(null);
    const [showVoteResult, setShowVoteResult] = useState(false);
    
    // タイミング制御フラグ
    const [hasShownWaitMessage, setHasShownWaitMessage] = useState(false);
    const [optimisticPhase, setOptimisticPhase] = useState(null); // サーバー反映待ちの間の先行フェーズ表示
    const [isReadyProcessing, setIsReadyProcessing] = useState(false);

    // useEffect内での重複実行防止用Ref
    const processingRef = useRef(false);
    const lastPhaseRef = useRef(null);
    
    const baseDay = (room && typeof room.day === 'number') ? room.day : 1;
    const isGameEnded = room?.status === 'finished' || room?.status === 'aborted';
    
    // 画面表示上のフェーズ（サーバー同期ラグを吸収するためoptimisticPhaseを優先）
    const isOptimisticAdvance = optimisticPhase && room?.phase && optimisticPhase !== room.phase;
    const displayPhase = optimisticPhase || room?.phase || "loading";
    const displayDay = baseDay; 
    const isDead = myPlayer?.status === 'dead';

    const showNotify = (msg, type = "info", duration = 2000) => setNotification({ message: msg, type, duration });

    // プレイヤーリストの整形。自分が死亡している場合は、ネタバレ防止を解除して全員の役職を表示できるようにする
    const displayPlayers = useMemo(() => {
        if (!players) return [];
        if (isDead && deadPlayersInfo.length > 0) {
            return players.map(p => {
                const secret = deadPlayersInfo.find(d => d.id === p.id);
                // 死者視点では正体データをマージして返す
                return secret ? { ...p, role: secret.role, originalRole: secret.originalRole } : p;
            });
        }
        return players;
    }, [players, isDead, deadPlayersInfo]);

    // Firestoreリスナー設定: 公開チャット、霊界チャット、自分の秘密情報
    useEffect(() => {
        if (!roomCode || !user || isGameEnded) return;
        const unsubChat = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'chat'), orderBy('createdAt', 'asc')), (snap) => { setMessages(snap.docs.map(d=>d.data())); });
        const unsubGrave = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'graveChat'), orderBy('createdAt', 'asc')), (snap) => setGraveMessages(snap.docs.map(d => d.data())));
        
        // 自分の役職情報は他人に見えないサブコレクションにある
        const ur = onSnapshot(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid, 'secret', 'roleData'), s=>{ 
            if(s.exists()){ 
                setMyRole(s.data().role); 
                // データ不整合でnullが含まれる場合があるのでフィルタリング
                const rawTeammates = s.data().teammates || [];
                const cleanTeammates = Array.isArray(rawTeammates) ? rawTeammates.filter(t => t) : [];
                setTeammates(cleanTeammates); 
            }
        });

        // アクション結果（占い結果など）の監視
        const ures = onSnapshot(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid, 'secret', 'actionResult'), s=>{ 
            if(s.exists() && s.data().day===baseDay){ 
                setLastActionResult(s.data().cards);
                if (room?.phase?.startsWith('night')) {
                    showNotify("アクションの結果が届きました", "success"); 
                }
            }
        });
        
        return () => { unsubChat(); unsubGrave(); ur(); ures(); };
    }, [roomCode, user, baseDay, room?.phase, isGameEnded]);

    // 死亡時、全プレイヤーの役職情報を取得（観戦モード用）
    useEffect(() => {
        if (isDead && !isGameEnded) {
            const fetchAllRoles = async () => {
                try {
                    const fn = httpsCallable(functions, 'getAllPlayerRoles');
                    const res = await fn({ roomCode });
                    if (res.data && res.data.players) {
                        setDeadPlayersInfo(res.data.players);
                    }
                } catch (e) {
                    console.error("Failed to fetch dead players info:", e);
                }
            };
            fetchAllRoles();
        }
    }, [isDead, roomCode, isGameEnded]);

    // チームチャット（人狼チャットなど）のリスナー設定
    useEffect(() => {
         if (!user || !roomCode || isGameEnded) return; 
         let teamChannel = null; 
         if (myRole) { 
             if (['werewolf', 'greatwolf'].includes(myRole)) teamChannel = 'werewolf_team'; 
             else if (['madman'].includes(myRole)) teamChannel = 'madman'; 
             else if (['citizen'].includes(myRole)) teamChannel = null; 
             else teamChannel = myRole; 
         } 
         if (teamChannel) { 
             const unsub = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'teamChats'), where('channel', '==', teamChannel)), (snap) => setTeamMessages(snap.docs.map(d => d.data()).sort((a,b) => getMillis(a.createdAt) - getMillis(b.createdAt)))); 
             return () => unsub(); 
         } else { setTeamMessages([]); } 
    }, [user, myRole, roomCode, isGameEnded]);

    // 投票結果表示後の演出処理
    const handleVoteSequenceEnd = () => {
        if (isGameEnded) return;

        // 処刑者がいる場合
        if (room.executionResult) {
            setOverlay({ 
                title: "夜になりました", 
                subtitle: room.executionResult, 
                duration: 5000, 
                isNight: true, 
                onComplete: () => { 
                    setOverlay({ 
                        title: "夜になりました", 
                        subtitle: "能力者は行動してください", 
                        duration: 4000, 
                        isNight: true, 
                        onComplete: () => setOverlay(null) 
                    }); 
                }
            });
        } else {
            // 処刑なしの場合
            setOverlay({ 
                title: "夜になりました", 
                subtitle: "能力者は行動してください", 
                duration: 4000, 
                isNight: true, 
                onComplete: () => setOverlay(null) 
            });
        }
    };

    // フェーズ遷移検知とタイマー管理
    useEffect(() => {
        if (!room || isGameEnded) return;
        if(room.logs) setLogs(room.logs || []);

        // フェーズが変わった瞬間の初期化処理
        if (room.phase && room.phase !== lastPhaseRef.current) {
            setOptimisticPhase(null);
            const prevPhase = lastPhaseRef.current;
            lastPhaseRef.current = room.phase;
            
            // 各種状態リセット
            setNightActionDone(false);
            setHasVoted(false);
            setVoteSelection(null);
            setLastActionResult(null);
            setHasShownWaitMessage(false);
            setIsReadyProcessing(false); 

            // 朝のアナウンスフェーズの演出（死亡通知、覚醒通知）
            if (room.phase.startsWith('announcement_')) { 
                 const isMyDeath = myPlayer?.status === 'dead' && (myPlayer?.diedDay === room.day - 1 || myPlayer?.diedDay === room.day);
                 
                 let myDeathContent = null;
                 if (isMyDeath) {
                     const reason = myPlayer?.deathReason || "不明";
                     myDeathContent = (
                         <div className="mt-6 flex flex-col items-center animate-fade-in-up w-full px-4">
                             <div className="bg-red-950/90 border-4 border-red-600 p-8 rounded-3xl flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(220,38,38,0.5)] max-w-lg w-full relative overflow-hidden">
                                 <div className="bg-black/50 p-6 rounded-full border-2 border-red-500 shadow-xl relative z-10 animate-bounce-slow">
                                     <Skull size={64} className="text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]"/>
                                 </div>
                                 <div className="text-center space-y-4 relative z-10">
                                     <h3 className="text-4xl font-black text-white tracking-widest drop-shadow-md">YOU DIED</h3>
                                     <div className="py-3 px-6 bg-black/60 rounded-xl border border-red-500/50 backdrop-blur-sm">
                                         <span className="text-sm text-red-300 font-bold uppercase tracking-wider block mb-1">CAUSE OF DEATH</span>
                                         <p className="text-2xl font-black text-white">{reason}</p>
                                     </div>
                                     <div className="inline-block mt-2">
                                         <p className="text-white font-bold bg-gradient-to-r from-red-900 to-black px-6 py-2 rounded-full border border-red-500/30 shadow-lg text-sm">
                                             霊界で試合の様子を見守りましょう！
                                         </p>
                                     </div>
                                 </div>
                             </div>
                         </div>
                     );
                 }

                 // 呪われし者の覚醒イベント表示
                 let awakeningContent = null;
                 if (room.awakeningEvents && room.awakeningEvents.length > 0) {
                     const isWolfTeam = ['werewolf', 'greatwolf', 'madman'].includes(myRole);
                     const myAwakening = room.awakeningEvents.find(e => e.playerId === user.uid);
                     
                     // 自分または人狼チームなら表示
                     if (isWolfTeam || myAwakening) {
                         const eventsToShow = room.awakeningEvents.filter(e => isWolfTeam || e.playerId === user.uid);
                         if (eventsToShow.length > 0) {
                             awakeningContent = (
                                 <div className="mt-6 flex flex-col gap-3 items-center animate-fade-in-up">
                                     {eventsToShow.map((e, idx) => {
                                         const pName = players.find(p => p.id === e.playerId)?.name || "誰か";
                                         return (
                                             <div key={idx} className="bg-gray-900 border-2 border-red-500 p-4 rounded-2xl flex items-center gap-4 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
                                                 <div className="bg-red-500/20 p-3 rounded-full"><UserPlus size={32} className="text-red-400"/></div>
                                                 <div className="text-left">
                                                     <div className="text-xs text-red-400 font-black uppercase tracking-wider mb-1">AWAKENING</div>
                                                     <div className="text-lg font-bold text-white">
                                                         <span className="text-red-400 text-xl mr-1">{pName}</span> が新しく<br/>人狼になりました
                                                     </div>
                                                 </div>
                                             </div>
                                         );
                                     })}
                                 </div>
                             );
                         }
                     }
                 }

                 setOverlay({ 
                    title: isMyDeath ? "" : `${room.day}日目の朝`, 
                    subtitle: (
                        <div className="flex flex-col items-center gap-4 w-full">
                            {!isMyDeath && <p className="text-lg">{room.deathResult || "昨晩は誰も死亡しませんでした..."}</p>}
                            {myDeathContent}
                            {awakeningContent}
                        </div>
                    ),
                    duration: (awakeningContent || myDeathContent) ? 10000 : 8000, 
                    isNight: false, 
                    onComplete: () => setOverlay(null) 
                 });

            } else if (room.phase.startsWith('night_')) {
                 if (prevPhase === 'voting') {
                     setShowVoteResult(true);
                 } else {
                    // 投票を経ずに夜になった場合（初日夜など）の演出
                    if (room.executionResult) {
                        setOverlay({ 
                            title: "夜になりました", 
                            subtitle: room.executionResult, 
                            duration: 4000, 
                            isNight: true, 
                            onComplete: () => { 
                                setOverlay({ 
                                    title: "夜になりました", 
                                    subtitle: "能力者は行動してください", 
                                    duration: 4000, 
                                    isNight: true, 
                                    onComplete: () => setOverlay(null) 
                                }); 
                            }
                        });
                    } else {
                        setOverlay({ 
                            title: "夜になりました", 
                            subtitle: "能力者は行動してください", 
                            duration: 4000, 
                            isNight: true, 
                            onComplete: () => setOverlay(null) 
                        });
                    }
                 }
            }
        }
        
        if (room.status !== 'playing' || !room.phaseStartTime) return; 

        // クライアントサイドタイマー
        const timer = setInterval(() => { 
            const now = Date.now(); 
            const start = getMillis(room.phaseStartTime) || now; 
            
            let targetTime = 0;
            // 夜フェーズで全員のアクションが終わっている場合は早送り時間を採用
            if (room.phase.startsWith('night') && room.nightAllDoneTime && typeof room.nightAllDoneTime.toMillis === 'function') {
                 targetTime = room.nightAllDoneTime.toMillis();
            } else if (room.phase.startsWith('night') && room.nightAllDoneTime && room.nightAllDoneTime.seconds) {
                 targetTime = room.nightAllDoneTime.seconds * 1000;
            } else {
                 let duration = 5; 
                 if (room.phase.startsWith('day')) duration = TIME_LIMITS.DISCUSSION; 
                 else if (room.phase === 'voting') duration = TIME_LIMITS.VOTING; 
                 else if (room.phase.startsWith('night')) duration = TIME_LIMITS.NIGHT; 
                 else if (room.phase.startsWith('announcement')) duration = TIME_LIMITS.ANNOUNCEMENT; 
                 else if (room.phase === 'countdown') duration = TIME_LIMITS.COUNTDOWN; 
                 else if (room.phase === 'role_reveal') duration = TIME_LIMITS.ROLE_REVEAL;
                 targetTime = start + (duration * 1000);
            }
            
            const remaining = Math.max(0, Math.ceil((targetTime - now) / 1000));
            setTimeLeft(remaining); 

            // タイマーゼロ時の処理
            if (remaining <= 0) {
                // 自動遷移するフェーズの先行表示（ラグ対策）
                if (room.phase === 'countdown' && !optimisticPhase) {
                    setOptimisticPhase('role_reveal');
                    executeForceAdvance();
                } else if (room.phase === 'role_reveal' && !optimisticPhase) {
                    setOptimisticPhase('day_1');
                    executeForceAdvance();
                }

                if (!hasShownWaitMessage && room.phase !== 'countdown' && room.phase !== 'role_reveal') {
                    if (room.phase.startsWith('night') && room.nightAllDoneTime) {
                        // 夜の短縮終了時はメッセージを出さない
                    } else {
                        setHasShownWaitMessage(true);
                    }
                }

                // サーバーへのフェーズ進行リクエスト（競合防止のためランダムディレイを入れる）
                if (!processingRef.current) {
                    const isAutoPhase = room.phase === 'countdown' || room.phase === 'role_reveal';
                    const randomDelay = isAutoPhase ? Math.random() * 200 : Math.random() * 1000;
                    
                    setTimeout(() => {
                         if (room.phase === lastPhaseRef.current && remaining <= 0) {
                             executeForceAdvance();
                         }
                    }, randomDelay);
                }
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [room, roomCode, user.uid, players, hasShownWaitMessage, optimisticPhase, isGameEnded]);

    // サーバー関数呼び出し：フェーズ進行
    const executeForceAdvance = () => {
        if (processingRef.current || isGameEnded) return;
        processingRef.current = true;
        const fn = httpsCallable(functions, 'advancePhase');
        fn({ roomCode })
            .then(() => console.log("Advance Success"))
            .catch(e => {
                console.log("Advance Skipped or Failed", e);
            })
            .finally(() => setTimeout(() => processingRef.current = false, 2000));
    };

    // サーバー関数呼び出し：時短リクエスト（準備完了）
    const handleVoteReady = async () => { 
        if(!roomCode || !user || isReadyProcessing || isGameEnded) return; 
        setIsReadyProcessing(true); 
        try {
            const fn = httpsCallable(functions, 'toggleReady');
            await fn({ roomCode, isReady: true });
            showNotify("準備完了を送信しました", "success");
        } catch(e) {
            console.error("Ready Error:", e);
            setIsReadyProcessing(false); 
            showNotify("通信エラー: もう一度お試しください", "error");
        }
    };

    // メッセージ送信ハンドラ群
    const handleSendChat = async (text) => { if(!text.trim()) return; await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'chat'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp(), day: room.day, phaseLabel: 'day' }); };
    const handleSendGraveMessage = async (text) => { await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'graveChat'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp() }); };
    const handleSendTeamMessage = async (text) => { let channel = myRole; if(['werewolf','greatwolf'].includes(myRole)) channel = 'werewolf_team'; else if(myRole === 'madman') channel = 'madman'; await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'teamChats'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp(), channel, day: room.day, phaseLabel: 'night' }); };
    
    // 投票送信
    const handleSubmitVote = async () => { 
        if(!voteSelection || !roomCode || !user) return; 
        const fn = httpsCallable(functions, 'submitVote');
        await fn({ roomCode, targetId: voteSelection });
        setHasVoted(true); 
    };

    // アーカイブ表示
    const handleOpenArchive = (day, phase) => { 
        const msgs = messages.filter(m => m.day === day && m.phaseLabel === phase); 
        const teamMsgs = teamMessages.filter(m => m.day === day && m.phaseLabel === phase);
        const allMsgs = [...msgs, ...teamMsgs];
        setSelectedArchive({ title: `${day}日目 ${phase==='night'?'夜':'昼'}`, messages: allMsgs }); 
        setShowArchive(true); 
    };

    // ホスト用：強制終了
    const handleForceAbort = async () => {
        if(confirm("強制終了しますか？部屋はロビー状態に戻り、配役設定などは保持されます。")) {
            try {
                const fn = httpsCallable(functions, 'resetToLobby');
                await fn({ roomCode });
            } catch(e) {
                console.error("Force Abort Error:", e);
                showNotify("強制終了に失敗しました: " + e.message, "error");
            }
        }
    };

    // 描画ブロック ----------------------------------------------------------------

    // 終了状態ならローディング表示（ResultScreenへの遷移待ち）
    if (isGameEnded) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center text-white">
                <Loader className="animate-spin mb-4"/>
                <span className="ml-2 font-bold tracking-widest">FINISHING GAME...</span>
            </div>
        );
    }

    // データロード中
    if (!room || !players || players.length === 0 || !myPlayer || !myRole) return (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center text-white overflow-hidden" style={{ backgroundColor: '#030712' }}>
            <div className="absolute inset-0 z-0">
                 <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-900/20 rounded-full blur-[100px] animate-pulse"></div>
            </div>
            <div className="relative z-10 flex flex-col items-center animate-fade-in-up">
                <div className="mb-8 relative">
                    <div className="absolute inset-0 bg-blue-500 blur-xl opacity-30 rounded-full"></div>
                    <div className="relative bg-gray-900 border border-gray-700 p-6 rounded-3xl shadow-2xl">
                        <div className="flex gap-4">
                            <Ghost size={48} className="text-gray-300 animate-bounce" style={{ animationDelay: '0s' }}/>
                            <Moon size={48} className="text-purple-400 animate-bounce" style={{ animationDelay: '0.2s' }}/>
                            <Sun size={48} className="text-orange-400 animate-bounce" style={{ animationDelay: '0.4s' }}/>
                        </div>
                    </div>
                </div>
                <h2 className="text-4xl font-black tracking-[0.3em] mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
                    CONNECTING
                </h2>
                <div className="flex items-center gap-3 text-gray-400 text-sm font-bold bg-black/30 px-6 py-2 rounded-full border border-white/10 backdrop-blur-md">
                    <Loader size={16} className="animate-spin text-blue-400"/>
                    <span className="tracking-wide">ゲームデータを同期しています...</span>
                </div>
            </div>
        </div>
    );
    
    // 特定フェーズ用の専用画面表示
    if (displayPhase === 'countdown') return (
        <>
            {notification && <Notification {...notification} onClose={() => setNotification(null)} />}
            {overlay && <OverlayNotification {...overlay} />}
            <CountdownScreen />
        </>
    );

    if (displayPhase === 'role_reveal') return (
        <>
            {notification && <Notification {...notification} onClose={() => setNotification(null)} />}
            {overlay && <OverlayNotification {...overlay} />}
            <RoleRevealScreen role={myRole} teammates={teammates || []} />
        </>
    );

    // 変数定義
    const isNight = displayPhase?.startsWith('night');
    const isDay = displayPhase?.startsWith('day');
    const isVoting = displayPhase === 'voting';
    const inPersonMode = room.inPersonMode;
    // 夜のアクションパネルを表示すべき役職か判定
    const isSpecialRole = ['werewolf', 'greatwolf', 'seer', 'sage', 'knight', 'trapper', 'detective', 'medium'].includes(myRole);
    const showActionPanel = !isDead && isSpecialRole;
    
    const teamChatTitle = ['werewolf', 'greatwolf'].includes(myRole) ? "人狼チャット" : `${ROLE_DEFINITIONS[myRole || 'citizen']?.name || myRole}チャット`;
    const canSeeTeamChat = !isDead && ['werewolf', 'greatwolf', 'seer', 'medium', 'knight', 'trapper', 'sage', 'detective', 'fox', 'madman'].includes(myRole);
    const isHost = room.hostId === user.uid;

    // アーカイブボタンの生成
    const archiveButtons = [];
    if(room.day >= 1) { 
        for(let d=1; d <= room.day; d++) { 
            if (d < room.day) {
                archiveButtons.push({ label: `${d}日目昼`, day: d, phase: 'day' }); 
                archiveButtons.push({ label: `${d}日目夜`, day: d, phase: 'night' }); 
            }
            else if (d === room.day) {
                // 夜になったらその日の昼のアーカイブも見れるようにする
                if (displayPhase?.startsWith('night')) {
                    archiveButtons.push({ label: `${d}日目昼`, day: d, phase: 'day' });
                }
            }
        } 
    }

    const safeMyPlayer = myPlayer || { status: 'alive', name: 'Loading...', isReady: false };

    return (
        <div className="lg:h-screen min-h-screen flex flex-col bg-gray-950 text-gray-100 font-sans lg:overflow-hidden">
            {overlay && <OverlayNotification {...overlay} />}
            {notification && <Notification {...notification} onClose={() => setNotification(null)} />}
            
            {showVoteResult && (
                <VotingResultModal 
                    voteSummary={room.voteSummary} 
                    players={players} 
                    anonymousVoting={room.anonymousVoting} 
                    executionResult={room.executionResult}
                    onClose={() => {
                        setShowVoteResult(false);
                        handleVoteSequenceEnd();
                    }}
                />
            )}
            
            {showRoleDist && <InfoModal title="役職配分" onClose={() => setShowRoleDist(false)}><RoleDistributionPanel players={players} roleSettings={room?.roleSettings || {}} /></InfoModal>}
            {showSurvivors && <InfoModal title="生存者確認" onClose={() => setShowSurvivors(false)}><SurvivorsList players={players}/></InfoModal>}
            
            {showArchive && selectedArchive && <ChatArchiveModal title={selectedArchive.title} messages={selectedArchive.messages} user={user} onClose={() => setShowArchive(false)} />}

            {/* 投票モーダル */}
            {isVoting && safeMyPlayer.status === 'alive' && !hasVoted && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                    <div className="bg-gray-900 border-2 border-red-600 rounded-3xl p-8 max-w-lg w-full text-center space-y-6 shadow-2xl animate-fade-in-up flex flex-col max-h-[85vh]">
                        <div className="flex flex-col items-center justify-center gap-2 text-red-500 mb-2 shrink-0">
                            <Gavel size={48} className="animate-bounce" />
                            <h2 className="text-4xl font-black tracking-widest">VOTE</h2>
                        </div>
                        <p className="text-gray-300 mb-4 shrink-0 font-bold">
                            {timeLeft > 0 ? "本日の処刑者を選んでください" : "投票を締め切りました"}
                            <br/><span className="text-sm text-red-400">残り {timeLeft}秒</span>
                        </p>
                        <div className="grid grid-cols-2 gap-3 overflow-y-auto p-2 custom-scrollbar flex-1">
                            <button onClick={() => setVoteSelection('skip')} disabled={timeLeft <= 0} className={`py-4 px-3 rounded-xl border-2 font-bold transition flex items-center justify-center ${voteSelection === 'skip' ? "bg-gray-600 border-white ring-2 ring-white text-white shadow-xl scale-105" : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700"} disabled:opacity-50 disabled:cursor-not-allowed`}>
                                スキップ
                            </button>
                            {players.filter(p => p.status === 'alive' && p.id !== user.uid).map(p => (
                                <button key={p.id} onClick={() => setVoteSelection(p.id)} disabled={timeLeft <= 0} className={`py-4 px-3 rounded-xl border-2 font-bold transition flex items-center justify-center ${voteSelection === p.id ? "bg-red-600 border-red-400 ring-2 ring-red-400 text-white shadow-xl scale-105" : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700"} disabled:opacity-50 disabled:cursor-not-allowed`}>
                                    {p.name}
                                </button>
                            ))}
                        </div>
                        <button onClick={handleSubmitVote} disabled={!voteSelection || timeLeft <= 0} className="mt-6 w-full py-4 rounded-full font-black text-xl transition shadow-xl bg-gradient-to-r from-red-600 to-pink-600 text-white hover:scale-105 hover:shadow-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 shrink-0">
                            {timeLeft > 0 ? "投票を確定する" : "集計中..."}
                        </button>
                    </div>
                </div>
            )}
            
            {/* 投票完了待ち画面 */}
            {isVoting && hasVoted && <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4"><div className="text-center animate-pulse"><CheckCircle size={64} className="text-green-500 mx-auto mb-4"/><h2 className="text-3xl font-bold text-white mb-2">投票完了</h2><p className="text-gray-400">結果発表を待っています...</p></div></div>}
            
            {/* 死者用：投票待ちメッセージ */}
            {isVoting && safeMyPlayer.status === 'dead' && (
                <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-50 text-center animate-pulse pointer-events-none w-full">
                    <Gavel size={48} className="text-gray-500 mx-auto mb-2"/>
                    <h2 className="text-xl font-bold text-gray-300">現在生存者は投票を行っています...</h2>
                </div>
            )}

            {/* ヘッダーエリア */}
            <header className="flex-none flex items-center justify-between p-3 border-b border-gray-800 bg-gray-950/80 backdrop-blur z-40">
                <div className="flex items-center gap-4">
                    <div className={`px-4 py-2 rounded-xl border font-bold flex items-center gap-2 ${displayPhase?.startsWith('night') ? "bg-purple-900/50 border-purple-500 text-purple-200" : "bg-gray-800 border-gray-700"}`}>
                        {displayPhase?.startsWith('night') ? <Moon size={18}/> : <Sun size={18} className="text-yellow-400"/>}<span>{formatPhaseName(displayPhase, displayDay)}</span>
                    </div>
                    <div className={`px-4 py-2 rounded-xl border font-mono font-bold text-xl flex items-center gap-2 ${timeLeft < 10 && !isNight ? "bg-red-900/50 border-red-500 text-red-400" : "bg-gray-800 border-gray-700 text-white"}`}>
                        <Clock size={18}/>
                        <span>{isNight ? (room.nightAllDoneTime ? timeLeft : "∞") : timeLeft}<span className="text-sm ml-0.5">s</span></span>
                    </div>
                    {inPersonMode && <div className="hidden md:flex items-center gap-2 text-xs font-bold text-blue-400 bg-blue-900/20 px-3 py-1 rounded-full border border-blue-500/30"><Mic size={12}/> 対面モード</div>}
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs text-gray-600 font-bold hidden md:block">ROOM: {roomCode}</div>
                    {isHost && (
                        <button onClick={handleForceAbort} className="bg-red-900/80 text-white border border-red-500 px-3 py-2 rounded-lg text-xs font-bold hover:bg-red-700 transition flex items-center gap-2 shadow-lg">
                            <LogOut size={14}/> 強制終了
                        </button>
                    )}
                </div>
            </header>

            {/* メイングリッドレイアウト */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 lg:min-h-0 lg:overflow-hidden overflow-y-auto">
                
                {/* 左カラム：役職カード、アクションボタン */}
                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-auto shrink-0">
                    {/* 死者の場合は全プレイヤーの役職一覧を表示 */}
                    {isDead ? <DeadPlayerInfoPanel players={displayPlayers} /> : <MiniRoleCard role={myRole} teammates={teammates || []} />}
                    
                    {!isDead && (
                        <div className="flex-col gap-2 shrink-0 hidden lg:flex">
                            <button onClick={() => setShowRoleDist(true)} className="w-full p-4 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold"><Settings className="text-blue-400" size={18}/> 役職配分を確認</button>
                            <button onClick={() => setShowSurvivors(true)} className="w-full p-4 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold"><Users className="text-green-400" size={18}/> 生存者を確認</button>
                        </div>
                    )}
                    
                    {!isDead && (
                        <div className="bg-black/20 p-3 rounded-xl overflow-y-auto custom-scrollbar border border-white/5 lg:flex-1 h-48 lg:h-auto min-h-0">
                            <p className="text-xs text-gray-500 font-bold mb-2 flex items-center gap-1 sticky top-0 bg-black/20 p-1 backdrop-blur"><History size={12}/> チャットアーカイブ</p>
                            <div className="flex flex-wrap gap-2">{archiveButtons.map((btn, i) => (<button key={i} onClick={() => handleOpenArchive(btn.day, btn.phase)} className="bg-gray-800 border border-gray-700 text-gray-300 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition">{btn.label}</button>))}</div>
                        </div>
                    )}

                    {isDay && !isDead && (
                        <button onClick={handleVoteReady} disabled={safeMyPlayer.isReady || isReadyProcessing} className={`mt-auto w-full py-4 rounded-xl font-bold transition flex items-center justify-center gap-2 shrink-0 ${safeMyPlayer.isReady || isReadyProcessing ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20"}`}><ThumbsUp size={24}/> {safeMyPlayer.isReady ? "投票準備完了済み" : isReadyProcessing ? "送信中..." : "投票準備を完了する"}</button>
                    )}
                </div>

                {/* 中央カラム：メインチャット、夜のアクション、対面モード表示 */}
                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-[80vh] min-h-[500px]">
                    {isDead ? (
                        <div className="h-full flex flex-col gap-4 min-h-0">
                            {inPersonMode ? (
                                <div className="flex-1 border border-purple-500/30 rounded-2xl overflow-hidden min-h-0">
                                     <ChatPanel messages={graveMessages} user={user} teammates={[]} myPlayer={safeMyPlayer} onSendMessage={handleSendGraveMessage} title="霊界チャット" disableFilter={true} />
                                </div>
                            ) : (
                                <>
                                    <div className="flex-1 border border-purple-500/30 rounded-2xl overflow-hidden min-h-0">
                                         <ChatPanel messages={graveMessages} user={user} teammates={[]} myPlayer={safeMyPlayer} onSendMessage={handleSendGraveMessage} title="霊界チャット" disableFilter={true} />
                                    </div>
                                    <div className="h-1/3 border border-gray-700 rounded-2xl overflow-hidden relative shrink-0">
                                         <div className="absolute top-0 right-0 bg-gray-800/80 px-3 py-1 text-sm font-bold text-gray-300 z-10 border-bl rounded-bl-xl shadow-md flex items-center gap-2"><Eye size={14} className="text-blue-400"/> 生存者チャット (閲覧のみ)</div>
                                         <div className="h-full overflow-hidden opacity-80 hover:opacity-100 transition">
                                              <ChatPanel messages={messages} user={{uid: 'dummy'}} teammates={[]} myPlayer={{...safeMyPlayer, status: 'alive'}} title="" readOnly={true} disableFilter={true} />
                                         </div>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : isNight ? (
                        <>
                            {showActionPanel ? (
                                <div className="h-full bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-purple-500/30 overflow-hidden">
                                    {/* 役職ごとの夜アクションUI */}
                                    {safeMyPlayer && <NightActionPanel myRole={myRole} players={players} onActionComplete={() => setNightActionDone(true)} myPlayer={safeMyPlayer} teammates={teammates || []} roomCode={roomCode} roomData={room} lastActionResult={lastActionResult} isDone={nightActionDone} />}
                                </div>
                            ) : (
                                // アクションが無い役職はGeminiとの暇つぶしチャットを表示（カモフラージュ用）
                                <GeminiChatPanel playerName={safeMyPlayer.name} />
                            )}
                        </>
                    ) : (
                        inPersonMode ? (
                            <div className="h-full min-h-0 bg-gray-900/40 backdrop-blur rounded-2xl border border-blue-500/20 p-4 flex flex-col justify-center items-center text-center">
                                <Mic size={48} className="text-blue-500 mb-4 animate-pulse"/>
                                <h3 className="text-xl font-bold text-white mb-2">対面モード</h3>
                                <p className="text-gray-400 text-sm">口頭で議論を行ってください。<br/>チャットは無効化されています。</p>
                            </div>
                        ) : (
                            // 通常の昼チャット
                            <div className="h-full min-h-0"><ChatPanel messages={messages || []} user={user} teammates={teammates || []} myPlayer={safeMyPlayer} onSendMessage={handleSendChat} title="生存者チャット" currentDay={displayDay} currentPhase={displayPhase}/></div>
                        )
                    )}
                </div>

                {/* 右カラム：ログ、チームチャット */}
                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-[60vh] min-h-[400px]">
                    {!isDead && (
                        <div className="flex gap-2 shrink-0 lg:hidden">
                            <button onClick={() => setShowRoleDist(true)} className="flex-1 p-3 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold text-sm"><Settings className="text-blue-400" size={16}/> 配分</button>
                            <button onClick={() => setShowSurvivors(true)} className="flex-1 p-3 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold text-sm"><Users className="text-green-400" size={16}/> 生存者</button>
                        </div>
                    )}

                    {isNight && canSeeTeamChat && !inPersonMode ? (
                        <>
                            {/* 人狼チャットや共有チャット */}
                            <div className="flex-1 min-h-0"><ChatPanel messages={teamMessages || []} user={user} teammates={teammates || []} myPlayer={safeMyPlayer} title={teamChatTitle} isTeamChat={true} onSendMessage={handleSendTeamMessage} currentDay={displayDay} currentPhase={displayPhase} disableFilter={true} /></div>
                            <div className="flex-1 min-h-0"><LogPanel logs={logs || []} showSecret={isDead} user={user} /></div>
                        </>
                    ) : (
                        // 通常ログ表示
                        <div className="h-full min-h-0"><LogPanel logs={logs || []} showSecret={isDead} user={user} /></div>
                    )}
                </div>
            </div>
        </div>
    );
};