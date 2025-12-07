import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, addDoc, serverTimestamp, query, where, orderBy, onSnapshot, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase.js';
import { ROLE_DEFINITIONS, TIME_LIMITS } from '../constants/gameData.js';
import { getMillis, formatPhaseName } from '../utils/helpers.js';
import { Loader, History, Mic, Gavel, CheckCircle, Sun, Moon, Clock, Settings, Users, ThumbsUp, Eye, LogOut, Skull, UserMinus, MessageSquare, Sparkles, FileText } from 'lucide-react';

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
import { ConfirmationModal } from '../components/ui/ConfirmationModal.jsx';
import { ResultScreen } from './ResultScreen.jsx';

// コンポーネント: ゲーム画面メイン
// 役割: ゲーム進行の制御、各フェーズのUI表示、リアルタイム通信の管理
export const GameScreen = ({ user, room, roomCode, players, myPlayer, setView, setRoomCode, maintenanceMode, setNotification }) => {
    // ステート: プレイヤー自身の情報
    // myRole/originalRole: Firestoreのsecretサブコレクションから取得
    // mySecret: 役職データ全体（仲間の情報など含む）
    const [myRole, setMyRole] = useState(null);
    const [originalRole, setOriginalRole] = useState(null);
    const [teammates, setTeammates] = useState([]);
    const [mySecret, setMySecret] = useState(null); 
    
    // ステート: チャット・ログデータ
    // Firestoreのリスナー経由でリアルタイム更新
    const [messages, setMessages] = useState([]);
    const [teamMessages, setTeamMessages] = useState([]);
    const [graveMessages, setGraveMessages] = useState([]);
    const [logs, setLogs] = useState([]);
    
    // ステート: AIチャット履歴
    // コンポーネント切り替え時も履歴を保持するためここで管理
    const [geminiMessages, setGeminiMessages] = useState([]);
    
    // ステート: 進行管理・アクション制御
    const [timeLeft, setTimeLeft] = useState(0);
    const [nightActionDone, setNightActionDone] = useState(false);
    const [voteSelection, setVoteSelection] = useState(null);
    const [hasVoted, setHasVoted] = useState(false);
    const [isVotingSubmitting, setIsVotingSubmitting] = useState(false); // 二重送信防止用フラグ
    
    // ステート: UI表示制御
    const [notificationLocal, setNotificationLocal] = useState(null); // この画面内限定のトースト通知
    const [overlay, setOverlay] = useState(null); // 全画面オーバーレイ（フェーズ遷移演出等）
    const [lastActionResult, setLastActionResult] = useState(null); // 夜のアクション結果（占い結果等）
    const [rightPanelTab, setRightPanelTab] = useState('chat'); // 右パネルのタブ切り替え ('chat' | 'gemini' | 'log')
    
    // ステート: 未読バッジ管理
    // チャット更新時に前回の件数と比較して増加分をカウント
    const [unreadTeam, setUnreadTeam] = useState(0);
    const [unreadGemini, setUnreadGemini] = useState(0);
    const lastTeamMsgCountRef = useRef(0);
    const lastGeminiMsgCountRef = useRef(0);
    // Ref: 初回ロード判定用 (初期データで未読がつかないようにする)
    const isTeamChatLoaded = useRef(false);
    const isGeminiChatLoaded = useRef(false);
    
    // ステート: 各種モーダル表示フラグ
    const [deadPlayersInfo, setDeadPlayersInfo] = useState([]); // 霊界用: 全プレイヤーの正体
    const [showRoleDist, setShowRoleDist] = useState(false); // 役職配分
    const [showSurvivors, setShowSurvivors] = useState(false); // 生存者リスト
    const [showArchive, setShowArchive] = useState(false); // 過去ログアーカイブ
    const [selectedArchive, setSelectedArchive] = useState(null); // 表示するアーカイブデータ
    const [showVoteResult, setShowVoteResult] = useState(false); // 投票結果
    const [showKickModal, setShowKickModal] = useState(false); // キック機能
    const [modalConfig, setModalConfig] = useState(null); // 汎用確認モーダル設定
    
    // ステート: フェーズ遷移制御
    // hasShownWaitMessage: 「待機中」メッセージの重複表示防止
    // optimisticPhase: サーバー更新待ちの間の楽観的フェーズ表示
    // isReadyProcessing: 準備完了ボタンの連打防止
    const [hasShownWaitMessage, setHasShownWaitMessage] = useState(false);
    const [optimisticPhase, setOptimisticPhase] = useState(null); 
    const [isReadyProcessing, setIsReadyProcessing] = useState(false);

    // Ref: 副作用内での値参照・重複実行防止
    const processingRef = useRef(false); // フェーズ進行処理の重複防止
    const lastPhaseRef = useRef(null); // 前回のフェーズ（変化検知用）
    const lastNotificationRef = useRef(null); // 同じ通知の繰り返し防止
    
    // データ抽出: roomオブジェクトからのプロパティ展開
    const roomPhase = room?.phase;
    const roomDay = room?.day;
    const roomStatus = room?.status;
    const roomPhaseStartTime = room?.phaseStartTime;
    const roomNightAllDoneTime = room?.nightAllDoneTime; // 夜アクション全員完了時刻
    const roomHostId = room?.hostId;
    
    const discussionTime = room?.discussionTime || TIME_LIMITS.DISCUSSION;
    const inPersonMode = room?.inPersonMode || false; // 対面モードフラグ
    
    const baseDay = (typeof roomDay === 'number') ? roomDay : 1;
    const isGameEnded = roomStatus === 'finished' || roomStatus === 'aborted' || roomStatus === 'closed';
    
    // 表示用フェーズ決定（楽観的更新を優先）
    const displayPhase = optimisticPhase || roomPhase || "loading";
    const displayDay = baseDay; 
    const isDead = myPlayer?.status === 'dead' || myPlayer?.status === 'vanished' || myPlayer?.isSpectator;
    const isSpectator = myPlayer?.isSpectator;

    // 権限フラグ
    const isDev = myPlayer?.isDev === true;
    // 修正: roomやuserがロード中でもエラーにならないようオプショナルチェーンを使用
    const isHost = room?.hostId === user?.uid;
    const hasControl = isHost || isDev; // 強制終了やキック権限

    // 関数: トースト通知表示ラッパー
    const showNotify = (msg, type = "info", duration = 3000) => {
        if (!msg) return;
        setNotificationLocal({ message: msg, type, duration });
    };

    // Memo: 表示用プレイヤーリスト生成
    // 自分が死亡している場合、サーバーから取得した正体情報(deadPlayersInfo)をマージして表示
    const displayPlayers = useMemo(() => {
        if (!players) return [];
        if (isDead && deadPlayersInfo.length > 0) {
            return players.map(p => {
                const secret = deadPlayersInfo.find(d => d.id === p.id);
                // 正体情報があれば上書き
                return secret ? { ...p, role: secret.role, originalRole: secret.originalRole } : p;
            });
        }
        return players;
    }, [players, isDead, deadPlayersInfo]);

    // Memo: AI向けログフィルタリング
    // secretフラグ付きログの場合、visibleToに含まれていなければ除外
    // 公平性のためAIには見えてはいけない情報を渡さない
    const visibleLogsForAi = useMemo(() => {
        if (!logs) return [];
        return logs.filter(l => {
            if (!l.secret) return true;
            if (l.visibleTo && Array.isArray(l.visibleTo) && l.visibleTo.includes(user?.uid)) return true;
            return false;
        });
    }, [logs, user?.uid]);

    // Effect: 通知イベント監視
    // サーバー側で書き込まれたnotificationEventを検知してトースト表示
    useEffect(() => {
        if (room?.notificationEvent) {
            const evt = room.notificationEvent;
            // タイムスタンプとメッセージでユニーク判定し、重複表示を防ぐ
            const key = `${evt.timestamp?.seconds}_${evt.message}`;
            if (evt.message && lastNotificationRef.current !== key) {
                showNotify(evt.message, "info", 4000);
                lastNotificationRef.current = key;
            }
        }
    }, [room?.notificationEvent]);

    // Effect: Firestoreリアルタイム監視 (メイン)
    // - 全体チャット
    // - 霊界チャット
    // - 自分の秘密情報 (roleData, actionResult)
    useEffect(() => {
        if (!roomCode || !user || isGameEnded) return;
        
        // チャット監視
        const unsubChat = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'chat'), orderBy('createdAt', 'asc')), (snap) => { setMessages(snap.docs.map(d=>d.data())); });
        // 霊界チャット監視
        const unsubGrave = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'graveChat'), orderBy('createdAt', 'asc')), (snap) => setGraveMessages(snap.docs.map(d => d.data())));
        
        let ur = () => {};
        let ures = () => {};

        // 観戦者以外は自分の秘密情報を監視
        if (!isSpectator) {
            // 役職情報監視: players/{uid}/secret/roleData
            ur = onSnapshot(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid, 'secret', 'roleData'), s=>{ 
                if(s.exists()){ 
                    const d = s.data();
                    setMySecret(d); 
                    setMyRole(d.role); 
                    setOriginalRole(d.originalRole);
                    const rawTeammates = d.teammates || [];
                    const cleanTeammates = Array.isArray(rawTeammates) ? rawTeammates.filter(t => t) : [];
                    setTeammates(cleanTeammates); 
                }
            });

            // アクション結果監視: players/{uid}/secret/actionResult
            // 日付が一致する場合のみ反映
            ures = onSnapshot(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid, 'secret', 'actionResult'), s=>{ 
                if(s.exists() && s.data().day === baseDay){ 
                    setLastActionResult(s.data().cards);
                    // 夜フェーズ中に結果が来たら通知
                    if (roomPhase?.startsWith('night')) {
                        showNotify("アクションの結果が届きました", "success"); 
                    }
                }
            });
        }
        
        return () => { unsubChat(); unsubGrave(); ur(); ures(); };
    }, [roomCode, user, baseDay, roomPhase, isGameEnded, isSpectator]);

    // Effect: 死亡時の全プレイヤー役職取得
    // 死亡時はCloud Functions経由で全員の役職情報を取得可能
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

    // Effect: 役職（チーム）チャット監視設定
    // 自分の役職に応じて適切なチャンネルを購読
    useEffect(() => {
         if (!user || !roomCode || isGameEnded) return; 
         let teamChannel = null; 
         if (myRole) { 
             // チャット不可役職
             if (['fox', 'cursed', 'teruteru'].includes(myRole)) teamChannel = null;
             // 人狼系・狂人は「werewolf_team」または「madman」チャンネル
             else if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) teamChannel = 'werewolf_team'; 
             else if (['madman'].includes(myRole)) teamChannel = 'madman'; 
             else if (['assassin'].includes(myRole)) teamChannel = 'assassin'; 
             else if (['citizen'].includes(myRole)) teamChannel = null; 
             else teamChannel = myRole; // その他役職は役職名チャンネル
         } 
         if (teamChannel) { 
             const unsub = onSnapshot(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'teamChats'), where('channel', '==', teamChannel)), (snap) => setTeamMessages(snap.docs.map(d => d.data()).sort((a,b) => getMillis(a.createdAt) - getMillis(b.createdAt)))); 
             return () => unsub(); 
         } else { setTeamMessages([]); } 
    }, [user, myRole, roomCode, isGameEnded]);

    // Effect: チームチャット未読件数カウント
    useEffect(() => {
        // 初回ロード時はカウントせず、ロード済みフラグを立てるだけにする (大量の未読バッジ防止)
        if (!isTeamChatLoaded.current) {
            if (teamMessages.length > 0) {
                isTeamChatLoaded.current = true;
            }
            lastTeamMsgCountRef.current = teamMessages.length;
            return;
        }

        if (teamMessages.length > lastTeamMsgCountRef.current) {
            // 現在のタブがチャット以外なら未読加算
            if (rightPanelTab !== 'chat') {
                setUnreadTeam(prev => prev + (teamMessages.length - lastTeamMsgCountRef.current));
            }
        }
        lastTeamMsgCountRef.current = teamMessages.length;
    }, [teamMessages, rightPanelTab]);

    // Effect: Geminiチャット未読件数カウント
    useEffect(() => {
        // 初回ロード時はカウントせず、ロード済みフラグを立てるだけにする
        if (!isGeminiChatLoaded.current) {
            if (geminiMessages.length > 0) {
                isGeminiChatLoaded.current = true;
            }
            lastGeminiMsgCountRef.current = geminiMessages.length;
            return;
        }

        if (geminiMessages.length > lastGeminiMsgCountRef.current) {
            const lastMsg = geminiMessages[geminiMessages.length - 1];
            // AIからの返信かつタブがGemini以外の場合に未読加算
            if (rightPanelTab !== 'gemini' && lastMsg?.sender === 'ai') {
                setUnreadGemini(prev => prev + 1);
            }
        }
        lastGeminiMsgCountRef.current = geminiMessages.length;
    }, [geminiMessages, rightPanelTab]);

    // Effect: タブ切り替え時の未読リセット
    useEffect(() => {
        if (rightPanelTab === 'chat') {
            setUnreadTeam(0);
        } else if (rightPanelTab === 'gemini') {
            setUnreadGemini(0);
        }
    }, [rightPanelTab]);

    // 関数: 投票結果表示後の処理
    // 処刑結果に応じたオーバーレイ表示
    // 自分が処刑された場合はYOU DIED演出
    const handleVoteSequenceEnd = () => {
        if (isGameEnded) return;
        if (room.executionResult) {
            const me = players.find(p => p.id === user.uid);
            const isMyExecution = me?.status === 'dead' && me?.deathReason === '投票による処刑' && me?.diedDay === roomDay;

            if (isMyExecution) {
                // 自身の処刑演出
                const myDeathContent = (
                    <div className="mt-6 flex flex-col items-center animate-fade-in-up w-full px-4">
                        <div className="bg-red-950/90 border-4 border-red-600 p-8 rounded-3xl flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(220,38,38,0.5)] max-w-lg w-full relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full bg-red-600 text-white text-sm font-bold py-1 px-4 text-center">
                                {room.executionResult}
                            </div>
                            <div className="bg-black/50 p-6 rounded-full border-2 border-red-500 shadow-xl relative z-10 mt-4">
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
                // 他者の処刑結果表示
                setOverlay({ title: "夜になりました", subtitle: room.executionResult, duration: 5000, isNight: true, onComplete: () => { 
                        setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) }); 
                    }
                });
            }
        } else {
            setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) });
        }
    };

    // Effect: フェーズ変更検知と演出オーバーレイ
    useEffect(() => {
        if (!room || isGameEnded) return;
        if(room.logs) setLogs(room.logs || []);

        if (roomPhase && roomPhase !== lastPhaseRef.current) {
            setOptimisticPhase(null); // 楽観的フェーズクリア
            const prevPhase = lastPhaseRef.current;
            lastPhaseRef.current = roomPhase;
            
            // フェーズ変更に伴う状態リセット
            setNightActionDone(false);
            setHasVoted(false);
            setVoteSelection(null);
            setLastActionResult(null);
            setHasShownWaitMessage(false);
            setIsReadyProcessing(false); 
            setIsVotingSubmitting(false);

            // 朝の発表フェーズ（死亡・覚醒）
            if (roomPhase.startsWith('announcement_')) { 
                 const isMyDeath = myPlayer?.status === 'dead' && (myPlayer?.diedDay === roomDay - 1 || myPlayer?.diedDay === roomDay);
                 const isExecution = myPlayer?.deathReason === '投票による処刑';
                 
                 let myDeathContent = null;
                 // 自分が死亡（かつ処刑以外）の場合の演出
                 if (isMyDeath && !isExecution) {
                     const reason = myPlayer?.deathReason || "不明";
                     myDeathContent = (
                         <div className="mt-6 flex flex-col items-center animate-fade-in-up w-full px-4">
                             <div className="bg-red-950/90 border-4 border-red-600 p-8 rounded-3xl flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(220,38,38,0.5)] max-w-lg w-full relative overflow-hidden">
                                 <div className="absolute top-0 left-0 w-full bg-red-600 text-white text-sm font-bold py-1 px-4 text-center">
                                     {room.deathResult}
                                 </div>
                                 <div className="bg-black/50 p-6 rounded-full border-2 border-red-500 shadow-xl relative z-10 mt-4">
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

                 // 覚醒イベント演出（呪われし者→人狼など）
                 // 人狼チームまたは本人のみに表示
                 let awakeningContent = null;
                 if (room.awakeningEvents && room.awakeningEvents.length > 0) {
                     const isWolfTeam = ['werewolf', 'greatwolf', 'wise_wolf', 'madman'].includes(myRole);
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
                                                 <div className="bg-red-500/20 p-3 rounded-full"><Users size={32} className="text-red-400"/></div>
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

                 // 朝のオーバーレイ設定
                 setOverlay({ 
                    title: (isMyDeath && !isExecution) ? "" : `${roomDay}日目の朝`, 
                    subtitle: (
                        <div className="flex flex-col items-center gap-4 w-full">
                            {!(isMyDeath && !isExecution) && (
                                <p className="text-lg">{room.deathResult || "昨晩は誰も死亡しませんでした..."}</p>
                            )}
                            {myDeathContent}
                            {awakeningContent}
                        </div>
                    ),
                    duration: (awakeningContent || myDeathContent) ? 10000 : 8000, 
                    isNight: false, 
                    onComplete: () => setOverlay(null) 
                 });

            } else if (roomPhase.startsWith('night_')) {
                 // 投票フェーズからの遷移時は投票結果モーダルを表示
                 if (prevPhase === 'voting') {
                     setShowVoteResult(true);
                 } else {
                    // 通常の夜遷移
                    if (room.executionResult) {
                        setOverlay({ title: "夜になりました", subtitle: room.executionResult, duration: 4000, isNight: true, onComplete: () => { setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) }); } });
                    } else {
                        setOverlay({ title: "夜になりました", subtitle: "能力者は行動してください", duration: 4000, isNight: true, onComplete: () => setOverlay(null) });
                    }
                 }
            }
        }
    }, [room, roomPhase, roomDay, isGameEnded, myPlayer, myRole, user.uid, players]);

    // Effect: クライアント側タイマー制御
    // サーバー時刻と同期しつつカウントダウン
    // 0になったらフェーズ進行リクエスト(advancePhase)をホストが送信
    useEffect(() => {
        if (roomStatus !== 'playing' || !roomPhaseStartTime) return; 

        const timer = setInterval(() => { 
            const now = Date.now(); 
            const start = getMillis(roomPhaseStartTime) || now; 
            
            let targetTime = 0;
            // 夜はアクション完了時間(roomNightAllDoneTime)があればそこまで、なければ無限
            if (roomPhase.startsWith('night') && roomNightAllDoneTime) {
                 targetTime = getMillis(roomNightAllDoneTime);
            } else {
                 // フェーズごとの制限時間設定
                 let duration = 5; 
                 if (roomPhase.startsWith('day')) duration = discussionTime; 
                 else if (roomPhase === 'voting') duration = TIME_LIMITS.VOTING; 
                 else if (roomPhase.startsWith('night')) duration = TIME_LIMITS.NIGHT; 
                 else if (roomPhase.startsWith('announcement')) duration = TIME_LIMITS.ANNOUNCEMENT; 
                 else if (roomPhase === 'countdown') duration = TIME_LIMITS.COUNTDOWN; 
                 else if (roomPhase === 'role_reveal') duration = TIME_LIMITS.ROLE_REVEAL;
                 targetTime = start + (duration * 1000);
            }
            
            const remaining = Math.max(0, Math.ceil((targetTime - now) / 1000));
            
            setTimeLeft(prev => {
                if (prev !== remaining) return remaining;
                return prev;
            });

            // タイムアップ時の処理
            if (remaining <= 0) {
                // 自動遷移系フェーズは楽観的に次へ
                if (roomPhase === 'countdown' && !optimisticPhase) { setOptimisticPhase('role_reveal'); executeForceAdvance(); } 
                else if (roomPhase === 'role_reveal' && !optimisticPhase) { setOptimisticPhase('day_1'); executeForceAdvance(); }

                // 待機メッセージフラグ設定
                if (!hasShownWaitMessage && roomPhase !== 'countdown' && roomPhase !== 'role_reveal') {
                    if (roomPhase.startsWith('night') && roomNightAllDoneTime) {} else { setHasShownWaitMessage(true); }
                }

                // フェーズ進行実行 (ホスト優先)
                if (!processingRef.current) {
                    const isAutoPhase = roomPhase === 'countdown' || roomPhase === 'role_reveal';
                    const baseDelay = isAutoPhase ? 200 : 1000;
                    
                    setTimeout(() => { 
                        if (roomPhase === lastPhaseRef.current && remaining <= 0) { 
                            executeForceAdvance(); 
                        } 
                    }, baseDelay);
                }
            }
        }, 250); 
        return () => clearInterval(timer);
    }, [roomStatus, roomPhase, roomPhaseStartTime, roomNightAllDoneTime, hasShownWaitMessage, optimisticPhase, discussionTime]);

    // 関数: フェーズ進行リクエスト (Cloud Functions)
    // 競合回避のためホストは即時、ゲストは遅延実行
    const executeForceAdvance = () => {
        if (processingRef.current || isGameEnded) return;
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

    // 関数: 投票準備完了 (toggleReady)
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

    // 関数: チャット送信系
    const handleSendChat = async (text) => { if(!text.trim()) return; await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'chat'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp(), day: roomDay, phaseLabel: 'day' }); };
    const handleSendGraveMessage = async (text) => { await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'graveChat'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp() }); };
    const handleSendTeamMessage = async (text) => { 
        let channel = myRole; 
        if(['werewolf','greatwolf', 'wise_wolf'].includes(myRole)) channel = 'werewolf_team'; 
        else if(myRole === 'madman') channel = 'madman'; 
        else if(myRole === 'assassin') channel = 'assassin'; 
        
        await addDoc(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'teamChats'), { text, senderId: user.uid, senderName: myPlayer.name, createdAt: serverTimestamp(), channel, day: roomDay, phaseLabel: 'night' }); 
    };
    
    // 関数: 投票送信 (submitVote)
    const handleSubmitVote = async () => { 
        if(!voteSelection || !roomCode || !user || isVotingSubmitting) return; 
        setIsVotingSubmitting(true);
        try {
            const fn = httpsCallable(functions, 'submitVote');
            await fn({ roomCode, targetId: voteSelection });
            setHasVoted(true); 
        } catch (e) {
            console.error(e);
            setIsVotingSubmitting(false);
            showNotify("投票に失敗しました。再試行してください。", "error");
        }
    };

    // 関数: アーカイブ表示
    const handleOpenArchive = (day, phase) => { 
        const msgs = messages.filter(m => m.day === day && m.phaseLabel === phase); 
        const teamMsgs = teamMessages.filter(m => m.day === day && m.phaseLabel === phase);
        const allMsgs = [...msgs, ...teamMsgs];
        setSelectedArchive({ title: `${day}日目 ${phase==='night'?'夜':'昼'}`, messages: allMsgs }); 
        setShowArchive(true); 
    };

    // 関数: 強制終了確認
    const confirmForceAbort = () => {
        setModalConfig({
            title: "ゲームの強制終了",
            message: "進行中のゲームを強制終了しますか？\n全てのプレイヤーはリザルト画面へ遷移します。",
            isDanger: true,
            onConfirm: async () => {
                setModalConfig(null);
                try { 
                    const fn = httpsCallable(functions, 'abortGame'); 
                    await fn({ roomCode }); 
                    showNotify("強制終了しました", "success"); 
                } catch(e) { 
                    showNotify("強制終了失敗", "error"); 
                }
            },
            onCancel: () => setModalConfig(null)
        });
    };

    // 関数: プレイヤー追放 (kickPlayer)
    const confirmKickPlayer = (playerId) => {
        const targetPlayer = players.find(p => p.id === playerId);
        const pName = targetPlayer?.name;
        const isTargetDev = targetPlayer?.isDev;

        // 開発者は保護
        if (isHost && isTargetDev) {
            showNotify("開発者を追放することはできません", "error");
            return;
        }

        setModalConfig({
            title: "プレイヤーの追放",
            message: `${pName} さんを追放しますか？\nこの操作は取り消せません。`,
            isDanger: true,
            confirmText: "追放する",
            onConfirm: async () => {
                setModalConfig(null);
                try {
                    const fn = httpsCallable(functions, 'kickPlayer');
                    await fn({ roomCode, playerId });
                    setShowKickModal(false);
                    showNotify(`${pName}を追放しました`, "success");
                } catch(e) {
                    showNotify("追放に失敗しました: " + e.message, "error");
                }
            },
            onCancel: () => setModalConfig(null)
        });
    };

    // 分岐: ゲーム終了時 -> リザルト画面
    if (isGameEnded) {
        return <ResultScreen room={room} players={players} setView={setView} setRoomCode={setRoomCode} roomCode={roomCode} myPlayer={myPlayer} user={user} maintenanceMode={maintenanceMode} setNotification={setNotification} />;
    }

    // 分岐: データロード待ち
    if (!room || !players || players.length === 0 || (!isSpectator && (!myPlayer || !myRole))) return (
        <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center text-white overflow-hidden" style={{ backgroundColor: '#030712' }}>
            <Loader className="animate-spin text-blue-400" size={32}/>
            <span className="mt-4">Loading Game Data...</span>
        </div>
    );
    
    // 分岐: カウントダウン画面 (通知非表示)
    if (displayPhase === 'countdown') return <CountdownScreen roomCode={roomCode} matchId={room.matchId} />;
    // 分岐: 役職紹介画面 (通知非表示)
    if (displayPhase === 'role_reveal') return <RoleRevealScreen role={myRole} teammates={teammates || []} />;

    // 状態判定
    const isNight = displayPhase?.startsWith('night');
    const isDay = displayPhase?.startsWith('day');
    const isVoting = displayPhase === 'voting';
    
    // 夜アクション有無の判定 (賢狼追加済み)
    const isSpecialRole = ['werewolf', 'greatwolf', 'wise_wolf', 'seer', 'sage', 'knight', 'trapper', 'detective', 'medium', 'assassin'].includes(myRole);
    
    // アクションパネル表示条件
    const showActionPanel = !isDead && isSpecialRole;
    // Geminiチャット表示条件 (アクションがない生存者)
    const showGeminiPanel = !isDead && !isSpecialRole;
    
    // チームチャットタイトル
    const teamChatTitle = ['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole) ? "人狼チャット" : `${ROLE_DEFINITIONS[myRole || 'citizen']?.name || myRole}チャット`;
    // チームチャット閲覧権限 (妖狐等は不可)
    const canSeeTeamChat = !isDead && ['werewolf', 'greatwolf', 'wise_wolf', 'seer', 'medium', 'knight', 'trapper', 'sage', 'detective', 'assassin'].includes(myRole);

    // アーカイブボタン生成ロジック
    const archiveButtons = [];
    if(roomDay >= 1) { 
        for(let d=1; d <= roomDay; d++) { 
            if (d < roomDay) { archiveButtons.push({ label: `${d}日目昼`, day: d, phase: 'day' }); archiveButtons.push({ label: `${d}日目夜`, day: d, phase: 'night' }); }
            else if (d === roomDay) { if (displayPhase?.startsWith('night')) { archiveButtons.push({ label: `${d}日目昼`, day: d, phase: 'day' }); } }
        } 
    }

    // 安全なプレイヤーオブジェクト (undefined対策)
    const safeMyPlayer = myPlayer || { status: 'alive', name: '観戦者', isReady: false };

    // Geminiへ渡すコンテキストデータ
    const gameContext = {
        myRole,
        logs: visibleLogsForAi, // フィルタ済みログ
        chatHistory: messages,
        roleSettings: room?.roleSettings,
        teammates: teammates, 
        lastActionResult: lastActionResult, 
        players: players 
    };

    return (
        // レイアウト: 画面全体
        // SP対応: h-screen固定を解除しスクロール可能に
        <div className="lg:h-screen min-h-screen flex flex-col bg-gray-950 text-gray-100 font-sans lg:overflow-y-auto">
            {/* モーダル群 */}
            {modalConfig && <ConfirmationModal {...modalConfig} />}
            {overlay && <OverlayNotification {...overlay} />}
            {notificationLocal && <Notification {...notificationLocal} onClose={() => setNotificationLocal(null)} />}
            
            {showVoteResult && <VotingResultModal voteSummary={room.voteSummary} players={players} anonymousVoting={room.anonymousVoting} executionResult={room.executionResult} onClose={() => { setShowVoteResult(false); handleVoteSequenceEnd(); }} />}
            {showRoleDist && <InfoModal title="役職配分" onClose={() => setShowRoleDist(false)}><RoleDistributionPanel players={players} roleSettings={room?.roleSettings || {}} /></InfoModal>}
            {showSurvivors && <InfoModal title="生存者確認" onClose={() => setShowSurvivors(false)}><SurvivorsList players={players}/></InfoModal>}
            {showArchive && selectedArchive && <ChatArchiveModal title={selectedArchive.title} messages={selectedArchive.messages} user={user} onClose={() => setShowArchive(false)} />}
            
            {/* キックモーダル */}
            {showKickModal && (
                <InfoModal title="プレイヤー追放" onClose={() => setShowKickModal(false)}>
                    <div className="space-y-2">
                        {players.filter(p => p.status === 'alive' || (p.isSpectator && p.status !== 'vanished')).map(p => (
                            <div key={p.id} className="flex justify-between items-center bg-gray-800 p-3 rounded-lg">
                                <span>{p.name} {p.isSpectator && <span className="text-xs text-gray-500">(観戦者)</span>}</span>
                                {p.id !== user.uid && (
                                    <button onClick={() => confirmKickPlayer(p.id)} className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1">
                                        <UserMinus size={12}/> 追放
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </InfoModal>
            )}

            {/* 投票モーダル (生存者のみ) */}
            {isVoting && safeMyPlayer.status === 'alive' && !hasVoted && (
                <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4">
                    <div className="bg-gray-900 border-2 border-red-600 rounded-3xl p-8 max-w-lg w-full text-center space-y-6 shadow-2xl animate-fade-in-up flex flex-col max-h-[85vh]">
                        <div className="flex flex-col items-center justify-center gap-2 text-red-500 mb-2 shrink-0">
                            <Gavel size={48} className="text-red-500" />
                            <h2 className="text-4xl font-black tracking-widest">VOTE</h2>
                        </div>
                        <p className="text-gray-300 mb-4 shrink-0 font-bold">{timeLeft > 0 ? "本日の処刑者を選んでください" : "投票を締め切りました"}<br/><span className="text-sm text-red-400">残り {timeLeft}秒</span></p>
                        <div className="grid grid-cols-2 gap-3 overflow-y-auto p-2 custom-scrollbar flex-1">
                            <button onClick={() => setVoteSelection('skip')} disabled={timeLeft <= 0} className={`py-4 px-3 rounded-xl border-2 font-bold transition flex items-center justify-center ${voteSelection === 'skip' ? "bg-gray-600 border-white ring-2 ring-white text-white shadow-xl scale-105" : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700"} disabled:opacity-50 disabled:cursor-not-allowed`}>スキップ</button>
                            {players.filter(p => p.status === 'alive' && p.id !== user.uid).map(p => (
                                <button key={p.id} onClick={() => setVoteSelection(p.id)} disabled={timeLeft <= 0} className={`py-4 px-3 rounded-xl border-2 font-bold transition flex items-center justify-center ${voteSelection === p.id ? "bg-red-600 border-red-400 ring-2 ring-red-400 text-white shadow-xl scale-105" : "bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700"} disabled:opacity-50 disabled:cursor-not-allowed`}>{p.name}</button>
                            ))}
                        </div>
                        <button 
                            onClick={handleSubmitVote} 
                            disabled={!voteSelection || timeLeft <= 0 || isVotingSubmitting} 
                            className="mt-6 w-full py-4 rounded-full font-black text-xl transition shadow-xl bg-gradient-to-r from-red-600 to-pink-600 text-white hover:scale-105 hover:shadow-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 shrink-0 flex items-center justify-center gap-2"
                        >
                            {isVotingSubmitting ? (
                                <Loader className="animate-spin text-white" size={24} />
                            ) : (
                                timeLeft > 0 ? "投票を確定する" : "集計中..."
                            )}
                        </button>
                    </div>
                </div>
            )}
            
            {/* 投票完了待ち表示 */}
            {isVoting && hasVoted && <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4"><div className="text-center"><CheckCircle size={64} className="text-green-500 mx-auto mb-4"/><h2 className="text-3xl font-bold text-white mb-2">投票完了</h2><p className="text-gray-400">結果発表を待っています...</p></div></div>}
            {isVoting && isDead && <div className="absolute bottom-32 left-1/2 transform -translate-x-1/2 z-50 text-center pointer-events-none w-full"><Gavel size={48} className="text-gray-500 mx-auto mb-2"/><h2 className="text-xl font-bold text-gray-300">現在生存者は投票を行っています...</h2></div>}

            {/* ヘッダー: フェーズ、タイマー、管理ボタン */}
            <header className="flex-none flex items-center justify-between p-3 border-b border-gray-800 bg-gray-950/80 backdrop-blur z-40">
                <div className="flex items-center gap-4">
                    <div className={`px-4 py-2 rounded-xl border font-bold flex items-center gap-2 ${displayPhase?.startsWith('night') ? "bg-purple-900/50 border-purple-500 text-purple-200" : "bg-gray-800 border-gray-700"}`}>
                        {displayPhase?.startsWith('night') ? <Moon size={18}/> : <Sun size={18} className="text-yellow-400"/>}<span>{formatPhaseName(displayPhase, displayDay)}</span>
                    </div>
                    <div className={`px-4 py-2 rounded-xl border font-mono font-bold text-xl flex items-center gap-2 ${timeLeft < 10 && !isNight ? "bg-red-900/50 border-red-500 text-red-400" : "bg-gray-800 border-gray-700 text-white"}`}>
                        <Clock size={18}/><span>{isNight ? (roomNightAllDoneTime ? timeLeft : "∞") : timeLeft}<span className="text-sm ml-0.5">s</span></span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <div className="text-xs text-gray-600 font-bold hidden md:block">ROOM: {roomCode}</div>
                    {hasControl && (
                        <div className="flex gap-2">
                            <button onClick={confirmForceAbort} className="bg-red-900/80 text-white border border-red-500 px-3 py-2 rounded-lg text-xs font-bold hover:bg-red-700 transition flex items-center gap-2 shadow-lg"><LogOut size={14}/> 強制終了</button>
                            <button onClick={() => setShowKickModal(true)} className="bg-gray-800 text-gray-300 border border-gray-600 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition flex items-center gap-2"><UserMinus size={14}/> 追放</button>
                        </div>
                    )}
                </div>
            </header>

            {/* メインコンテンツエリア (3カラム構成) */}
            {/* SP: 縦積み / PC: 横並び */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 min-h-0 overflow-y-auto">
                
                {/* 左カラム: プレイヤー情報 / アーカイブ / 投票準備 */}
                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-auto shrink-0">
                    {isDead || isSpectator ? <DeadPlayerInfoPanel players={displayPlayers} /> : <MiniRoleCard role={myRole} teammates={teammates || []} originalRole={originalRole} />}
                    
                    {!isDead && !isSpectator && (
                        <div className="flex-col gap-2 shrink-0 hidden lg:flex">
                            <button onClick={() => setShowRoleDist(true)} className="w-full p-4 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold"><Settings className="text-blue-400" size={18}/> 役職配分を確認</button>
                            <button onClick={() => setShowSurvivors(true)} className="w-full p-4 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold"><Users className="text-green-400" size={18}/> 生存者を確認</button>
                        </div>
                    )}
                    
                    {!isDead && !isSpectator && (
                        <div className="bg-black/20 p-3 rounded-xl overflow-y-auto custom-scrollbar border border-white/5 lg:flex-1 h-32 lg:h-auto min-h-0">
                            <p className="text-xs text-gray-500 font-bold mb-2 flex items-center gap-1 sticky top-0 bg-black/20 p-1 backdrop-blur"><History size={12}/> チャットアーカイブ</p>
                            <div className="flex flex-wrap gap-2">{archiveButtons.map((btn, i) => (<button key={i} onClick={() => handleOpenArchive(btn.day, btn.phase)} className="bg-gray-800 border border-gray-700 text-gray-300 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-700 transition">{btn.label}</button>))}</div>
                        </div>
                    )}

                    {isDay && !isDead && !isSpectator && (
                        <button onClick={handleVoteReady} disabled={safeMyPlayer.isReady || isReadyProcessing} className={`mt-auto w-full py-4 rounded-xl font-bold transition flex items-center justify-center gap-2 shrink-0 ${safeMyPlayer.isReady || isReadyProcessing ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20"}`}><ThumbsUp size={24}/> {safeMyPlayer.isReady ? "投票準備完了済み" : isReadyProcessing ? "送信中..." : "投票準備を完了する"}</button>
                    )}
                </div>

                {/* 中央カラム: 全体チャット / アクションパネル / Geminiパネル */}
                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-[50vh] min-h-[400px]">
                    {isDead || isSpectator ? (
                        <div className="h-full flex flex-col gap-4 min-h-0">
                            {/* 霊界チャット */}
                            <div className="flex-1 border border-purple-500/30 rounded-2xl overflow-hidden min-h-0 flex flex-col">
                                 <ChatPanel messages={graveMessages} user={user} teammates={[]} myPlayer={safeMyPlayer} onSendMessage={handleSendGraveMessage} title="霊界チャット" disableFilter={true} />
                            </div>
                            
                            {/* 生存者チャット閲覧 (対面以外) */}
                            {!inPersonMode && (
                                <div className="h-1/3 border border-gray-700 rounded-2xl overflow-hidden relative shrink-0 flex flex-col">
                                     <div className="absolute top-0 right-0 bg-gray-800/80 px-3 py-1 text-sm font-bold text-gray-300 z-10 border-bl rounded-bl-xl shadow-md flex items-center gap-2"><Eye size={14} className="text-blue-400"/> 生存者チャット (閲覧のみ)</div>
                                     <div className="h-full overflow-hidden opacity-80 hover:opacity-100 transition flex flex-col">
                                          <ChatPanel messages={messages} user={{uid: 'dummy'}} teammates={[]} myPlayer={{...safeMyPlayer, status: 'alive'}} title="" readOnly={true} disableFilter={true} />
                                     </div>
                                </div>
                            )}
                        </div>
                    ) : isNight ? (
                        <>
                            {/* 夜: アクションパネル or Geminiパネル */}
                            {showActionPanel ? (
                                <div className="h-full bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-purple-500/30 overflow-hidden">
                                    <NightActionPanel myRole={myRole} players={players} onActionComplete={() => setNightActionDone(true)} myPlayer={safeMyPlayer} teammates={teammates || []} roomCode={roomCode} roomData={room} lastActionResult={lastActionResult} isDone={nightActionDone} />
                                </div>
                            ) : showGeminiPanel ? (
                                <GeminiChatPanel 
                                    playerName={safeMyPlayer.name} 
                                    inPersonMode={inPersonMode} 
                                    gameContext={gameContext} 
                                    currentDay={displayDay} 
                                    messages={geminiMessages} 
                                    setMessages={setGeminiMessages} 
                                />
                            ) : (
                                <div className="h-full flex items-center justify-center text-gray-500 bg-gray-900/30 rounded-2xl border border-gray-800">
                                    <p>今夜は特にアクションはありません。</p>
                                </div>
                            )}
                        </>
                    ) : (
                        // 昼: 生存者チャット or 対面モード表示
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

                {/* 右カラム: ログ / 役職チャット / Gemini (タブ切り替え) */}
                <div className="lg:col-span-4 flex flex-col gap-4 lg:h-full h-[40vh] min-h-[300px]">
                    {!isDead && !isSpectator && (
                        <div className="flex gap-2 shrink-0 lg:hidden">
                            <button onClick={() => setShowRoleDist(true)} className="flex-1 p-3 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold text-sm"><Settings className="text-blue-400" size={16}/> 配分</button>
                            <button onClick={() => setShowSurvivors(true)} className="flex-1 p-3 bg-gray-800 rounded-xl border border-gray-700 hover:bg-gray-700 transition flex items-center justify-center gap-2 font-bold text-sm"><Users className="text-green-400" size={16}/> 生存者</button>
                        </div>
                    )}

                    {/* 夜かつチームチャット参加権限あり */}
                    {isNight && canSeeTeamChat && !isSpectator ? (
                        <>
                            {showActionPanel ? (
                                <div className="flex-1 min-h-0 flex flex-col bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-gray-700 overflow-hidden shadow-lg">
                                    {/* タブ切り替え: 役職チャット / Gemini / ログ */}
                                    <div className="flex border-b border-gray-700">
                                        <button 
                                            onClick={() => setRightPanelTab('chat')}
                                            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition relative ${rightPanelTab === 'chat' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border-b-2 border-transparent'}`}
                                        >
                                            <MessageSquare size={16}/> {teamChatTitle}
                                            {unreadTeam > 0 && (
                                                <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center animate-bounce">{unreadTeam}</span>
                                            )}
                                        </button>
                                        <button 
                                            onClick={() => setRightPanelTab('gemini')}
                                            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition relative ${rightPanelTab === 'gemini' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border-b-2 border-transparent'}`}
                                        >
                                            <Sparkles size={16}/> Gemini AI Chat
                                            {unreadGemini > 0 && (
                                                <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center animate-bounce">{unreadGemini}</span>
                                            )}
                                        </button>
                                        <button 
                                            onClick={() => setRightPanelTab('log')}
                                            className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition relative ${rightPanelTab === 'log' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border-b-2 border-transparent'}`}
                                        >
                                            <FileText size={16}/> ログ
                                        </button>
                                    </div>
                                    <div className="flex-1 min-h-0 relative">
                                        {rightPanelTab === 'chat' ? (
                                            <ChatPanel messages={teamMessages || []} user={user} teammates={teammates || []} myPlayer={safeMyPlayer} title={teamChatTitle} isTeamChat={true} onSendMessage={handleSendTeamMessage} currentDay={displayDay} currentPhase={displayPhase} disableFilter={true} />
                                        ) : rightPanelTab === 'gemini' ? (
                                            <GeminiChatPanel 
                                                playerName={safeMyPlayer.name} 
                                                inPersonMode={inPersonMode} 
                                                gameContext={gameContext} 
                                                currentDay={displayDay} 
                                                messages={geminiMessages} 
                                                setMessages={setGeminiMessages} 
                                            />
                                        ) : (
                                            <LogPanel logs={logs || []} showSecret={isDead} user={user} />
                                        )}
                                    </div>
                                </div>
                            ) : (
                                // アクションパネルがない場合 (Geminiが中央にあるため、右は役職チャットのみ表示)
                                <div className="flex-1 min-h-0"><ChatPanel messages={teamMessages || []} user={user} teammates={teammates || []} myPlayer={safeMyPlayer} title={teamChatTitle} isTeamChat={true} onSendMessage={handleSendTeamMessage} currentDay={displayDay} currentPhase={displayPhase} disableFilter={true} /></div>
                            )}
                            
                            {/* アクションパネルがない場合はログを表示 (スマホでは非表示推奨だが実装維持) */}
                            {!showActionPanel && <div className="flex-1 min-h-0"><LogPanel logs={logs || []} showSecret={isDead} user={user} /></div>}
                        </>
                    ) : (
                        // デフォルト: ログパネル
                        <div className="h-full min-h-0"><LogPanel logs={logs || []} showSecret={isDead || isSpectator} user={user} /></div>
                    )}
                </div>
            </div>
        </div>
    );
};