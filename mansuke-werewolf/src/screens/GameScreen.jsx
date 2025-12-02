import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, addDoc, serverTimestamp, query, where, orderBy, onSnapshot, doc, updateDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase.js';
import { ROLE_DEFINITIONS, TIME_LIMITS } from '../constants/gameData.js';
import { getMillis, formatPhaseName, isPlayerOnline } from '../utils/helpers.js';
import { Loader, History, Mic, Gavel, CheckCircle, Ghost, Sun, Moon, Clock, Settings, Users, ThumbsUp, Eye, LogOut, Sparkles, UserPlus, Skull, UserMinus, Shield } from 'lucide-react';

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
    // 状態管理
    const [myRole, setMyRole] = useState(null);
    const [originalRole, setOriginalRole] = useState(null);
    const [teammates, setTeammates] = useState([]);
    
    // チャット・ログ関連
    const [messages, setMessages] = useState([]);
    const [teamMessages, setTeamMessages] = useState([]);
    const [graveMessages, setGraveMessages] = useState([]);
    const [logs, setLogs] = useState([]);
    
    // 進行制御
    const [timeLeft, setTimeLeft] = useState(0);
    const [nightActionDone, setNightActionDone] = useState(false);
    const [voteSelection, setVoteSelection] = useState(null);
    const [hasVoted, setHasVoted] = useState(false);
    
    // UI表示
    const [notification, setNotification] = useState(null);
    const [overlay, setOverlay] = useState(null);
    const [lastActionResult, setLastActionResult] = useState(null); 
    
    // モーダル
    const [deadPlayersInfo, setDeadPlayersInfo] = useState([]);
    const [showRoleDist, setShowRoleDist] = useState(false);
    const [showSurvivors, setShowSurvivors] = useState(false);
    const [showArchive, setShowArchive] = useState(false);
    const [selectedArchive, setSelectedArchive] = useState(null);
    const [showVoteResult, setShowVoteResult] = useState(false);
    const [showKickModal, setShowKickModal] = useState(false);
    
    const [hasShownWaitMessage, setHasShownWaitMessage] = useState(false);
    const [optimisticPhase, setOptimisticPhase] = useState(null); 
    const [isReadyProcessing, setIsReadyProcessing] = useState(false);

    const processingRef = useRef(false);
    const lastPhaseRef = useRef(null);
    // 通知イベントの重複防止用
    const lastNotificationRef = useRef(null);
    
    // roomオブジェクトから必要なプロパティを抽出（依存配列最適化のため）
    const roomPhase = room?.phase;
    const roomDay = room?.day;
    const roomStatus = room?.status;
    const roomPhaseStartTime = room?.phaseStartTime;
    const roomNightAllDoneTime = room?.nightAllDoneTime;
    const roomHostId = room?.hostId;
    const roomWinner = room?.winner;
    
    const baseDay = (typeof roomDay === 'number') ? roomDay : 1;
    const isGameEnded = roomStatus === 'finished' || roomStatus === 'aborted';
    
    const displayPhase = optimisticPhase || roomPhase || "loading";
    const displayDay = baseDay; 
    const isDead = myPlayer?.status === 'dead' || myPlayer?.status === 'vanished' || myPlayer?.isSpectator;
    const isSpectator = myPlayer?.isSpectator;

    const showNotify = (msg, type = "info", duration = 2000) => setNotification({ message: msg, type, duration });

    // ★ Hooksの呼び出し順序を守るため、条件付きリターンより前に移動
    const displayPlayers = useMemo(() => {
        if (!players) return [];
        if (isDead && deadPlayersInfo.length > 0) {
            return players.map(p => {
                const secret = deadPlayersInfo.find(d => d.id === p.id);
                return secret ? { ...p, role: secret.role, originalRole: secret.originalRole } : p;
            });
        }
        return players;
    }, [players, isDead, deadPlayersInfo]);

    // Geminiに渡すための、自分が見えているログだけのリストを作成
    const visibleLogsForAi = useMemo(() => {
        if (!logs) return [];
        return logs.filter(l => {
            // 全員公開ログ（secretフラグがない、またはfalse）
            if (!l.secret) return true;
            // 自分宛ての秘匿ログ（visibleToに含まれている）
            if (l.visibleTo && Array.isArray(l.visibleTo) && l.visibleTo.includes(user?.uid)) return true;
            return false;
        });
    }, [logs, user?.uid]);

    // 通知イベントの監視（観戦者参加など）
    useEffect(() => {
        if (room?.notificationEvent) {
            const evt = room.notificationEvent;
            // タイムスタンプとメッセージ内容でユニークキーを作成
            const key = `${evt.timestamp?.seconds}_${evt.message}`;
            
            // まだ表示していないイベントなら表示
            if (lastNotificationRef.current !== key) {
                showNotify(evt.message, "info", 4000);
                lastNotificationRef.current = key;
            }
        }
    }, [room?.notificationEvent]);

    // Firestore監視
    useEffect(() => {
        if (!roomCode || !user || isGameEnded) return;
        const unsubChat = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'chat'), orderBy('createdAt', 'asc')), (snap) => { setMessages(snap.docs.map(d=>d.data())); });
        const unsubGrave = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'graveChat'), orderBy('createdAt', 'asc')), (snap) => setGraveMessages(snap.docs.map(d => d.data())));
        
        let ur = () => {};
        let ures = () => {};

        if (!isSpectator) {
            ur = onSnapshot(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid, 'secret', 'roleData'), s=>{ 
                if(s.exists()){ 
                    const d = s.data();
                    setMyRole(d.role); 
                    setOriginalRole(d.originalRole);
                    const rawTeammates = d.teammates || [];
                    const cleanTeammates = Array.isArray(rawTeammates) ? rawTeammates.filter(t => t) : [];
                    setTeammates(cleanTeammates); 
                }
            });

            ures = onSnapshot(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid, 'secret', 'actionResult'), s=>{ 
                if(s.exists() && s.data().day===baseDay){ 
                    setLastActionResult(s.data().cards);
                    if (roomPhase?.startsWith('night')) {
                        showNotify("アクションの結果が届きました", "success"); 
                    }
                }
            });
        }
        
        return () => { unsubChat(); unsubGrave(); ur(); ures(); };
    }, [roomCode, user, baseDay, roomPhase, isGameEnded, isSpectator]);

    useEffect(() => {
        if (isDead && !isGameEnded) {
            const fetchAllRoles = async () => {
                try {
                    const fn = httpsCallable(functions, 'getAllPlayerRoles');
                    const res = await fn({ roomCode });
                    if (res.data && res.data.players) {
                        setDeadPlayersInfo(res.data.players);
                    }
                } catch (e) { console.error(e); }
            };
            fetchAllRoles();
        }
    }, [isDead, roomCode, isGameEnded]);

    // 役職チャットの設定
    useEffect(() => {
         if (!user || !roomCode || isGameEnded) return; 
         let teamChannel = null; 
         if (myRole) { 
             // 妖狐と呪われし者、てるてる坊主は役職チャット不可
             if (['fox', 'cursed', 'teruteru'].includes(myRole)) teamChannel = null;
             else if (['werewolf', 'greatwolf'].includes(myRole)) teamChannel = 'werewolf_team'; 
             else if (['madman'].includes(myRole)) teamChannel = 'madman'; 
             else if (['assassin'].includes(myRole)) teamChannel = 'assassin'; 
             else if (['citizen'].includes(myRole)) teamChannel = null; 
             else teamChannel = myRole; 
         } 
         if (teamChannel) { 
             const unsub = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'teamChats'), where('channel', '==', teamChannel)), (snap) => setTeamMessages(snap.docs.map(d => d.data()).sort((a,b) => getMillis(a.createdAt) - getMillis(b.createdAt)))); 
             return () => unsub(); 
         } else { setTeamMessages([]); } 
    }, [user, myRole, roomCode, isGameEnded]);

    const handleVoteSequenceEnd = () => {
        if (isGameEnded) return;
        if (room.executionResult) {
            const me = players.find(p => p.id === user.uid);
            const isMyExecution = me?.status === 'dead' && me?.deathReason === '投票による処刑' && me?.diedDay === roomDay;

            if (isMyExecution) {
                const myDeathContent = (
                    <div className="mt-6 flex flex-col items-center animate-fade-in-up w-full px-4">
                        <div className="bg-red-950/90 border-4 border-red-600 p-8 rounded-3xl flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(220,38,38,0.5)] max-w-lg w-full relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full bg-red-600 text-white text-sm font-bold py-1 px-4 text-center">
                                {room.executionResult}
                            </div>
                            <div className="bg-black/50 p-6 rounded-full border-2 border-red-500 shadow-xl relative z-10 animate-bounce-slow mt-4">
                                <Skull size={64} className="text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]"/>
                            </div>
                            <div className="text-center space-y-4 relative z-10">
                                <h3 className="text-4xl font-black text-white tracking-widest drop-shadow-md">YOU DIED</h3>
                                <div className="py-3 px-6 bg-black/60 rounded-xl border border-red-500/50 backdrop-blur-sm">
                                    <span className="text-sm text-red-300 font-bold uppercase tracking-wider block mb-1">CAUSE OF DEATH</span>
                                    <p className="text-2xl font-black text-white">投票による処刑</p>
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

                setOverlay({ title: "", subtitle: myDeathContent, duration: 8000, isNight: true, onComplete: () => { 
                        setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) }); 
                    }
                });
            } else {
                setOverlay({ title: "夜になりました", subtitle: room.executionResult, duration: 5000, isNight: true, onComplete: () => { 
                        setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) }); 
                    }
                });
            }
        } else {
            setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) });
        }
    };

    // フェーズ変更検知とオーバーレイ表示
    useEffect(() => {
        if (!room || isGameEnded) return;
        if(room.logs) setLogs(room.logs || []);

        if (roomPhase && roomPhase !== lastPhaseRef.current) {
            setOptimisticPhase(null);
            const prevPhase = lastPhaseRef.current;
            lastPhaseRef.current = roomPhase;
            
            setNightActionDone(false);
            setHasVoted(false);
            setVoteSelection(null);
            setLastActionResult(null);
            setHasShownWaitMessage(false);
            setIsReadyProcessing(false); 

            if (roomPhase.startsWith('announcement_')) { 
                 const isMyDeath = myPlayer?.status === 'dead' && (myPlayer?.diedDay === roomDay - 1 || myPlayer?.diedDay === roomDay);
                 const isExecution = myPlayer?.deathReason === '投票による処刑';
                 
                 let myDeathContent = null;
                 if (isMyDeath && !isExecution) {
                     const reason = myPlayer?.deathReason || "不明";
                     myDeathContent = (
                         <div className="mt-6 flex flex-col items-center animate-fade-in-up w-full px-4">
                             <div className="bg-red-950/90 border-4 border-red-600 p-8 rounded-3xl flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(220,38,38,0.5)] max-w-lg w-full relative overflow-hidden">
                                 <div className="absolute top-0 left-0 w-full bg-red-600 text-white text-sm font-bold py-1 px-4 text-center">
                                     {room.deathResult}
                                 </div>
                                 <div className="bg-black/50 p-6 rounded-full border-2 border-red-500 shadow-xl relative z-10 animate-bounce-slow mt-4">
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

                 let awakeningContent = null;
                 if (room.awakeningEvents && room.awakeningEvents.length > 0) {
                     const isWolfTeam = ['werewolf', 'greatwolf', 'madman'].includes(myRole);
                     const myAwakening = room.awakeningEvents.find(e => e.playerId === user.uid);
                     
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
                    title: (isMyDeath && !isExecution) ? "" : `${roomDay}日目の朝`, 
                    subtitle: (
                        <div className="flex flex-col items-center gap-4 w-full">
                            <p className="text-lg">{room.deathResult || "昨晩は誰も死亡しませんでした..."}</p>
                            {myDeathContent}
                            {awakeningContent}
                        </div>
                    ),
                    duration: (awakeningContent || myDeathContent) ? 10000 : 8000, 
                    isNight: false, 
                    onComplete: () => setOverlay(null) 
                 });

            } else if (roomPhase.startsWith('night_')) {
                 if (prevPhase === 'voting') {
                     setShowVoteResult(true);
                 } else {
                    if (room.executionResult) {
                        setOverlay({ title: "夜になりました", subtitle: room.executionResult, duration: 4000, isNight: true, onComplete: () => { setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) }); } });
                    } else {
                        setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) });
                    }
                 }
            }
        }
    }, [room, roomPhase, roomDay, isGameEnded, myPlayer, myRole, user.uid, players]);

    // タイマー管理ロジック（依存配列を最小限にし、チャット更新等での再レンダリングを防ぐ）
    useEffect(() => {
        if (roomStatus !== 'playing' || !roomPhaseStartTime) return; 

        const timer = setInterval(() => { 
            const now = Date.now(); 
            const start = getMillis(roomPhaseStartTime) || now; 
            
            let targetTime = 0;
            if (roomPhase.startsWith('night') && roomNightAllDoneTime) {
                 targetTime = getMillis(roomNightAllDoneTime);
            } else {
                 let duration = 5; 
                 if (roomPhase.startsWith('day')) duration = TIME_LIMITS.DISCUSSION; 
                 else if (roomPhase === 'voting') duration = TIME_LIMITS.VOTING; 
                 else if (roomPhase.startsWith('night')) duration = TIME_LIMITS.NIGHT; 
                 else if (roomPhase.startsWith('announcement')) duration = TIME_LIMITS.ANNOUNCEMENT; 
                 else if (roomPhase === 'countdown') duration = TIME_LIMITS.COUNTDOWN; 
                 else if (roomPhase === 'role_reveal') duration = TIME_LIMITS.ROLE_REVEAL;
                 targetTime = start + (duration * 1000);
            }
            
            const remaining = Math.max(0, Math.ceil((targetTime - now) / 1000));
            setTimeLeft(remaining); 

            if (remaining <= 0) {
                // クライアント側での先行フェーズ遷移（見た目のレスポンス向上）
                if (roomPhase === 'countdown' && !optimisticPhase) { setOptimisticPhase('role_reveal'); executeForceAdvance(); } 
                else if (roomPhase === 'role_reveal' && !optimisticPhase) { setOptimisticPhase('day_1'); executeForceAdvance(); }

                if (!hasShownWaitMessage && roomPhase !== 'countdown' && roomPhase !== 'role_reveal') {
                    if (roomPhase.startsWith('night') && roomNightAllDoneTime) {} else { setHasShownWaitMessage(true); }
                }

                if (!processingRef.current) {
                    // 自動フェーズ進行のトリガー（多重実行防止ロジックを含む）
                    // 少し遅延させて、サーバーの自動処理との競合を減らす
                    const isAutoPhase = roomPhase === 'countdown' || roomPhase === 'role_reveal';
                    const baseDelay = isAutoPhase ? 200 : 1000;
                    
                    setTimeout(() => { 
                        if (roomPhase === lastPhaseRef.current && remaining <= 0) { 
                            executeForceAdvance(); 
                        } 
                    }, baseDelay);
                }
            }
        }, 1000);
        return () => clearInterval(timer);
    }, [roomStatus, roomPhase, roomPhaseStartTime, roomNightAllDoneTime, hasShownWaitMessage, optimisticPhase]);

    // 強制フェーズ進行リクエスト
    const executeForceAdvance = () => {
        if (processingRef.current || isGameEnded) return;

        // ホストのみが即座に実行し、ゲストはバックアップとしてランダムな遅延後に実行する
        // これによりサーバーへの多重リクエストを防ぐ
        const isHost = roomHostId === user.uid;
        const delay = isHost ? 0 : 2000 + Math.random() * 3000;

        setTimeout(() => {
            if (processingRef.current) return;
            processingRef.current = true;
            
            const fn = httpsCallable(functions, 'advancePhase');
            fn({ roomCode })
                .catch(e => console.log("Advance Skipped or Failed", e))
                .finally(() => setTimeout(() => processingRef.current = false, 2000));
        }, delay);
    };

    const handleVoteReady = async () => { 
        if(!roomCode || !user || isReadyProcessing || isGameEnded) return; 
        setIsReadyProcessing(true); 
        try {
            const fn = httpsCallable(functions, 'toggleReady');
            await fn({ roomCode, isReady: true });
            showNotify("準備完了を送信しました", "success");
        } catch(e) {
            setIsReadyProcessing(false); 
            showNotify("通信エラー: もう一度お試しください", "error");
        }
    };

    const handleSendChat = async (text) => { if(!text.trim()) return; await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'chat'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp(), day: roomDay, phaseLabel: 'day' }); };
    const handleSendGraveMessage = async (text) => { await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'graveChat'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp() }); };
    const handleSendTeamMessage = async (text) => { 
        let channel = myRole; 
        if(['werewolf','greatwolf'].includes(myRole)) channel = 'werewolf_team'; 
        else if(myRole === 'madman') channel = 'madman'; 
        else if(myRole === 'assassin') channel = 'assassin'; 
        else if(myRole === 'teruteru') channel = 'teruteru';
        await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'teamChats'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp(), channel, day: roomDay, phaseLabel: 'night' }); 
    };
    
    const handleSubmitVote = async () => { 
        if(!voteSelection || !roomCode || !user) return; 
        const fn = httpsCallable(functions, 'submitVote');
        await fn({ roomCode, targetId: voteSelection });
        setHasVoted(true); 
    };

    const handleOpenArchive = (day, phase) => { 
        const msgs = messages.filter(m => m.day === day && m.phaseLabel === phase); 
        const teamMsgs = teamMessages.filter(m => m.day === day && m.phaseLabel === phase);
        const allMsgs = [...msgs, ...teamMsgs];
        setSelectedArchive({ title: `${day}日目 ${phase==='night'?'夜':'昼'}`, messages: allMsgs }); 
        setShowArchive(true); 
    };

    const handleForceAbort = async () => {
        if(confirm("強制終了しますか？")) {
            try { const fn = httpsCallable(functions, 'abortGame'); await fn({ roomCode }); showNotify("強制終了しました", "success"); } catch(e) { showNotify("強制終了失敗", "error"); }
        }
    };

    const handleKickPlayer = async (playerId) => {
        const pName = players.find(p => p.id === playerId)?.name;
        if(confirm(`${pName}さんを追放しますか？この操作は取り消せません。`)) {
            try {
                const fn = httpsCallable(functions, 'kickPlayer');
                await fn({ roomCode, playerId });
                setShowKickModal(false);
                showNotify(`${pName}を追放しました`, "success");
            } catch(e) {
                showNotify("追放に失敗しました: " + e.message, "error");
            }
        }
    };

    if (isGameEnded) return <div className="min-h-screen bg-black flex items-center justify-center text-white"><Loader className="animate-spin mb-4"/><span className="ml-2 font-bold tracking-widest">FINISHING GAME...</span></div>;

    if (!room || !players || players.length === 0 || (!isSpectator && (!myPlayer || !myRole))) return (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center text-white overflow-hidden" style={{ backgroundColor: '#030712' }}>
            <Loader className="animate-spin text-blue-400" size={32}/>
            <span className="mt-4">Loading Game Data...</span>
        </div>
    );
    
    if (displayPhase === 'countdown') return <><Notification {...notification} onClose={() => setNotification(null)} /><CountdownScreen roomCode={roomCode} matchId={room.matchId} /></>;
    if (displayPhase === 'role_reveal') return <><Notification {...notification} onClose={() => setNotification(null)} /><RoleRevealScreen role={myRole} teammates={teammates || []} /></>;

    const isNight = displayPhase?.startsWith('night');
    const isDay = displayPhase?.startsWith('day');
    const isVoting = displayPhase === 'voting';
    const inPersonMode = room.inPersonMode;
    const isSpecialRole = ['werewolf', 'greatwolf', 'seer', 'sage', 'knight', 'trapper', 'detective', 'medium', 'assassin'].includes(myRole);
    const showActionPanel = !isDead && isSpecialRole;
    
    const teamChatTitle = ['werewolf', 'greatwolf'].includes(myRole) ? "人狼チャット" : `${ROLE_DEFINITIONS[myRole || 'citizen']?.name || myRole}チャット`;
    // 役職チャット表示可能者（妖狐・呪われし者は不可）
    const canSeeTeamChat = !isDead && ['werewolf', 'greatwolf', 'seer', 'medium', 'knight', 'trapper', 'sage', 'detective', 'madman', 'assassin', 'teruteru'].includes(myRole);
    const isHost = room.hostId === user.uid;

    const archiveButtons = [];
    if(roomDay >= 1) { 
        for(let d=1; d <= roomDay; d++) { 
            if (d < roomDay) { archiveButtons.push({ label: `${d}日目昼`, day: d, phase: 'day' }); archiveButtons.push({ label: `${d}日目夜`, day: d, phase: 'night' }); }
            else if (d === roomDay) { if (displayPhase?.startsWith('night')) { archiveButtons.push({ label: `${d}日目昼`, day: d, phase: 'day' }); } }
        } 
    }

    const safeMyPlayer = myPlayer || { status: 'alive', name: '観戦者', isReady: false };

    const gameContext = {
        myRole,
        logs: visibleLogsForAi, // 公平性を保つためフィルタリング済みログを渡す
        chatHistory: messages,
        roleSettings: room?.roleSettings // 役職配分を追加
    };

    return (
        <div className="lg:h-screen min-h-screen flex flex-col bg-gray-950 text-gray-100 font-sans lg:overflow-hidden">
            {overlay && <OverlayNotification {...overlay} />}
            {notification && <Notification {...notification} onClose={() => setNotification(null)} />}
            
            {showVoteResult && <VotingResultModal voteSummary={room.voteSummary} players={players} anonymousVoting={room.anonymousVoting} executionResult={room.executionResult} onClose={() => { setShowVoteResult(false); handleVoteSequenceEnd(); }} />}
            {showRoleDist && <InfoModal title="役職配分" onClose={() => setShowRoleDist(false)}><RoleDistributionPanel players={players} roleSettings={room?.roleSettings || {}} /></InfoModal>}
            {showSurvivors && <InfoModal title="生存者確認" onClose={() => setShowSurvivors(false)}><SurvivorsList players={players}/></InfoModal>}
            {showArchive && selectedArchive && <ChatArchiveModal title={selectedArchive.title} messages={selectedArchive.messages} user={user} onClose={() => setShowArchive(false)} />}
            
            {showKickModal && (
                <InfoModal title="プレイヤー追放" onClose={() => setShowKickModal(false)}>
                    <div className="space-y-2">
                        {players.filter(p => p.status === 'alive').map(p => (
                            <div key={p.id} className="flex justify-between items-center bg-gray-800 p-3 rounded-lg">
                                <span>{p.name}</span>
                                {p.id !== user.uid && (
                                    <button onClick={() => handleKickPlayer(p.id)} className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1">
                                        <UserMinus size={12}/> 追放
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </InfoModal>
            )}

            {isVoting && safeMyPlayer.status === 'alive' && !hasVoted && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                    <div className="bg-gray-900 border-2 border-red-600 rounded-3xl p-8 max-w-lg w-full text-center space-y-6 shadow-2xl animate-fade-in-up flex flex-col max-h-[85vh]">
                        <div className="flex flex-col items-center justify-center gap-2 text-red-500 mb-2 shrink-0">
                            <Gavel size={48} className="animate-bounce" />
                            <h2 className="text-4xl font-black tracking-widest">VOTE</h2>
                        </div>
                        <p className="text-gray-300 mb-4 shrink-0 font-bold">{timeLeft > 0 ? "本日の処刑者を選んでください" : "投票を締め切りました"}<br/><span className="text-sm text-red-400">残り {timeLeft}秒</span></p>
                        <div className="grid grid-cols-2 gap-3 overflow-y-auto p-2 custom-scrollbar flex-1">
                            <button onClick={() => setVoteSelection('skip')} disabled={timeLeft <= 0} className={`py-4 px-3 rounded-xl border-2 font-bold transition flex items-center justify-center ${voteSelection === 'skip' ? "bg-gray-600 border-white ring-2 ring-white text-white shadow-xl scale-105" : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700"} disabled:opacity-50 disabled:cursor-not-allowed`}>スキップ</button>
                            {players.filter(p => p.status === 'alive' && p.id !== user.uid).map(p => (
                                <button key={p.id} onClick={() => setVoteSelection(p.id)} disabled={timeLeft <= 0} className={`py-4 px-3 rounded-xl border-2 font-bold transition flex items-center justify-center ${voteSelection === p.id ? "bg-red-600 border-red-400 ring-2 ring-red-400 text-white shadow-xl scale-105" : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700"} disabled:opacity-50 disabled:cursor-not-allowed`}>{p.name}</button>
                            ))}
                        </div>
                        <button onClick={handleSubmitVote} disabled={!voteSelection || timeLeft <= 0} className="mt-6 w-full py-4 rounded-full font-black text-xl transition shadow-xl bg-gradient-to-r from-red-600 to-pink-600 text-white hover:scale-105 hover:shadow-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 shrink-0">{timeLeft > 0 ? "投票を確定する" : "集計中..."}</button>
                    </div>
                </div>
            )}
            
            {isVoting && hasVoted && <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4"><div className="text-center animate-pulse"><CheckCircle size={64} className="text-green-500 mx-auto mb-4"/><h2 className="text-3xl font-bold text-white mb-2">投票完了</h2><p className="text-gray-400">結果発表を待っています...</p></div></div>}
            {isVoting && isDead && <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-50 text-center animate-pulse pointer-events-none w-full"><Gavel size={48} className="text-gray-500 mx-auto mb-2"/><h2 className="text-xl font-bold text-gray-300">現在生存者は投票を行っています...</h2></div>}

            <header className="flex-none flex items-center justify-between p-3 border-b border-gray-800 bg-gray-950/80 backdrop-blur z-40">
                <div className="flex items-center gap-4">
                    <div className={`px-4 py-2 rounded-xl border font-bold flex items-center gap-2 ${displayPhase?.startsWith('night') ? "bg-purple-900/50 border-purple-500 text-purple-200" : "bg-gray-800 border-gray-700"}`}>
                        {displayPhase?.startsWith('night') ? <Moon size={18}/> : <Sun size={18} className="text-yellow-400"/>}<span>{formatPhaseName(displayPhase, displayDay)}</span>
                    </div>
                    <div className={`px-4 py-2 rounded-xl border font-mono font-bold text-xl flex items-center gap-2 ${timeLeft < 10 && !isNight ? "bg-red-900/50 border-red-500 text-red-400" : "bg-gray-800 border-gray-700 text-white"}`}>
                        <Clock size={18}/><span>{isNight ? (roomNightAllDoneTime ? timeLeft : "∞") : timeLeft}<span className="text-sm ml-0.5">s</span></span>
                    </div>
                    {inPersonMode && <div className="hidden md:flex items-center gap-2 text-xs font-bold text-blue-400 bg-blue-900/20 px-3 py-1 rounded-full border border-blue-500/30"><Mic size={12}/> 対面モード</div>}
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs text-gray-600 font-bold hidden md:block">ROOM: {roomCode}</div>
                    {isHost && (
                        <div className="flex gap-2">
                            <button onClick={handleForceAbort} className="bg-red-900/80 text-white border border-red-500 px-3 py-2 rounded-lg text-xs font-bold hover:bg-red-700 transition flex items-center gap-2 shadow-lg"><LogOut size={14}/> 強制終了</button>
                            <button onClick={() => setShowKickModal(true)} className="bg-gray-800 text-gray-300 border border-gray-600 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition flex items-center gap-2"><UserMinus size={14}/> 追放</button>
                        </div>
                    )}
                </div>
            </header>

            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 lg:min-h-0 lg:overflow-hidden overflow-y-auto">
                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-auto shrink-0">
                    {isDead || isSpectator ? <DeadPlayerInfoPanel players={displayPlayers} /> : <MiniRoleCard role={myRole} teammates={teammates || []} originalRole={originalRole} />}
                    
                    {!isDead && !isSpectator && (
                        <div className="flex-col gap-2 shrink-0 hidden lg:flex">
                            <button onClick={() => setShowRoleDist(true)} className="w-full p-4 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold"><Settings className="text-blue-400" size={18}/> 役職配分を確認</button>
                            <button onClick={() => setShowSurvivors(true)} className="w-full p-4 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold"><Users className="text-green-400" size={18}/> 生存者を確認</button>
                        </div>
                    )}
                    
                    {!isDead && !isSpectator && (
                        <div className="bg-black/20 p-3 rounded-xl overflow-y-auto custom-scrollbar border border-white/5 lg:flex-1 h-48 lg:h-auto min-h-0">
                            <p className="text-xs text-gray-500 font-bold mb-2 flex items-center gap-1 sticky top-0 bg-black/20 p-1 backdrop-blur"><History size={12}/> チャットアーカイブ</p>
                            <div className="flex flex-wrap gap-2">{archiveButtons.map((btn, i) => (<button key={i} onClick={() => handleOpenArchive(btn.day, btn.phase)} className="bg-gray-800 border border-gray-700 text-gray-300 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition">{btn.label}</button>))}</div>
                        </div>
                    )}

                    {isDay && !isDead && !isSpectator && (
                        <button onClick={handleVoteReady} disabled={safeMyPlayer.isReady || isReadyProcessing} className={`mt-auto w-full py-4 rounded-xl font-bold transition flex items-center justify-center gap-2 shrink-0 ${safeMyPlayer.isReady || isReadyProcessing ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20"}`}><ThumbsUp size={24}/> {safeMyPlayer.isReady ? "投票準備完了済み" : isReadyProcessing ? "送信中..." : "投票準備を完了する"}</button>
                    )}
                </div>

                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-[80vh] min-h-[500px]">
                    {isDead || isSpectator ? (
                        <div className="h-full flex flex-col gap-4 min-h-0">
                            {/* 霊界チャット：対面モードでも利用可能 */}
                            <div className="flex-1 border border-purple-500/30 rounded-2xl overflow-hidden min-h-0">
                                 <ChatPanel messages={graveMessages} user={user} teammates={[]} myPlayer={safeMyPlayer} onSendMessage={handleSendGraveMessage} title="霊界チャット" disableFilter={true} />
                            </div>
                            
                            {/* 生存者チャット（閲覧用）：対面モードのときは非表示または無効 */}
                            {!inPersonMode && (
                                <div className="h-1/3 border border-gray-700 rounded-2xl overflow-hidden relative shrink-0">
                                     <div className="absolute top-0 right-0 bg-gray-800/80 px-3 py-1 text-sm font-bold text-gray-300 z-10 border-bl rounded-bl-xl shadow-md flex items-center gap-2"><Eye size={14} className="text-blue-400"/> 生存者チャット (閲覧のみ)</div>
                                     <div className="h-full overflow-hidden opacity-80 hover:opacity-100 transition">
                                          <ChatPanel messages={messages} user={{uid: 'dummy'}} teammates={[]} myPlayer={{...safeMyPlayer, status: 'alive'}} title="" readOnly={true} disableFilter={true} />
                                     </div>
                                </div>
                            )}
                        </div>
                    ) : isNight ? (
                        <>
                            {showActionPanel ? (
                                <div className="h-full bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-purple-500/30 overflow-hidden">
                                    <NightActionPanel myRole={myRole} players={players} onActionComplete={() => setNightActionDone(true)} myPlayer={safeMyPlayer} teammates={teammates || []} roomCode={roomCode} roomData={room} lastActionResult={lastActionResult} isDone={nightActionDone} />
                                </div>
                            ) : (
                                <GeminiChatPanel playerName={safeMyPlayer.name} inPersonMode={inPersonMode} gameContext={gameContext} currentDay={displayDay} />
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
                            <div className="h-full min-h-0"><ChatPanel messages={messages || []} user={user} teammates={teammates || []} myPlayer={safeMyPlayer} onSendMessage={handleSendChat} title="生存者チャット" currentDay={displayDay} currentPhase={displayPhase} /></div>
                        )
                    )}
                </div>

                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-[60vh] min-h-[400px]">
                    {!isDead && !isSpectator && (
                        <div className="flex gap-2 shrink-0 lg:hidden">
                            <button onClick={() => setShowRoleDist(true)} className="flex-1 p-3 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold text-sm"><Settings className="text-blue-400" size={16}/> 配分</button>
                            <button onClick={() => setShowSurvivors(true)} className="flex-1 p-3 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold text-sm"><Users className="text-green-400" size={16}/> 生存者</button>
                        </div>
                    )}

                    {/* 役職チャット：対面モードでも利用可能。ただし生存者チャットは不可 */}
                    {isNight && canSeeTeamChat && !isSpectator ? (
                        <>
                            <div className="flex-1 min-h-0"><ChatPanel messages={teamMessages || []} user={user} teammates={teammates || []} myPlayer={safeMyPlayer} title={teamChatTitle} isTeamChat={true} onSendMessage={handleSendTeamMessage} currentDay={displayDay} currentPhase={displayPhase} disableFilter={true} /></div>
                            <div className="flex-1 min-h-0"><LogPanel logs={logs || []} showSecret={isDead} user={user} /></div>
                        </>
                    ) : (
                        <div className="h-full min-h-0"><LogPanel logs={logs || []} showSecret={isDead || isSpectator} user={user} /></div>
                    )}
                </div>
            </div>
        </div>
    );
};