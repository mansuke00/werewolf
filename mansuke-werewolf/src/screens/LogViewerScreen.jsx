import React, { useState, useEffect, useMemo } from 'react';
import { Search, ArrowLeft, Loader, FileText, Clock, Trophy, AlertOctagon, Calendar, List, MessageSquare, ChevronRight, XCircle, User, Users, LayoutGrid, SortAsc, Hash, Filter, RefreshCw, Trash2, Crown, Mic, Play } from 'lucide-react';
import { collection, query, where, getDocs, orderBy, Timestamp, collectionGroup, getDoc, doc, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase.js';
import { LogPanel } from '../components/game/LogPanel.jsx';
import { DeadPlayerInfoPanel } from '../components/game/DeadPlayerInfoPanel.jsx';
import { ROLE_DEFINITIONS } from '../constants/gameData';

const safeGetMillis = (timestamp) => {
    if (!timestamp) return 0;
    if (typeof timestamp === 'number') return timestamp;
    if (timestamp.toMillis && typeof timestamp.toMillis === 'function') return timestamp.toMillis();
    if (timestamp.seconds !== undefined && typeof timestamp.seconds === 'number') return timestamp.seconds * 1000;
    if (timestamp instanceof Date) return timestamp.getTime();
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? 0 : date.getTime();
};

export const LogViewerScreen = ({ setView }) => {
    const [matchIdInput, setMatchIdInput] = useState("");
    const [searchDate, setSearchDate] = useState("");
    const [searchTime, setSearchTime] = useState("");
    const [searchName, setSearchName] = useState("");
    
    const [searchResult, setSearchResult] = useState(null); 
    const [loading, setLoading] = useState(false);
    const [matchList, setMatchList] = useState([]); 
    const [showDetail, setShowDetail] = useState(false); 
    const [error, setError] = useState("");

    const [detailTab, setDetailTab] = useState('info'); 

    useEffect(() => {
        handleSearchButton(null); 
    }, []);

    const handleClearAll = () => {
        setMatchIdInput("");
        setSearchDate("");
        setSearchTime("");
        setSearchName("");
        setError("");
    };

    const handleSearchButton = async (initialDate = null) => {
        setLoading(true);
        setError("");
        setSearchResult(null);
        setShowDetail(false);
        setMatchList([]);

        try {
            if (matchIdInput.trim()) {
                await searchByMatchId(matchIdInput.trim());
            } else {
                const targetDate = initialDate || searchDate;
                const hasNameSearch = !!searchName.trim();
                const hasDateSearch = !!targetDate;

                if (!hasNameSearch && !hasDateSearch) {
                    const recentQuery = query(
                        collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'match_history'),
                        orderBy('createdAt', 'desc'),
                        limit(100) 
                    );
                    const snapshot = await getDocs(recentQuery);
                    
                    const results = snapshot.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .filter(d => d.matchId);
                    
                    if (results.length === 0) setError("データが見つかりませんでした。");
                    else setMatchList(results);
                    
                    setLoading(false);
                    return;
                }

                const promises = [];
                
                if (hasNameSearch) {
                    const nameQuery = query(collectionGroup(db, 'players'), where('name', '==', searchName.trim()));
                    promises.push(getDocs(nameQuery).then(snapshot => {
                        const matchIds = new Set();
                        snapshot.forEach(doc => {});
                        return new Set(); 
                    }));
                } else {
                    promises.push(Promise.resolve(null));
                }

                if (hasDateSearch) {
                    const start = new Date(targetDate);
                    let end = new Date(targetDate);

                    if (searchTime) {
                        start.setHours(parseInt(searchTime, 10));
                        end.setHours(parseInt(searchTime, 10) + 1);
                    } else {
                        end.setDate(end.getDate() + 1);
                    }

                    const dateQuery = query(
                        collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'match_history'), 
                        where('createdAt', '>=', Timestamp.fromDate(start)),
                        where('createdAt', '<', Timestamp.fromDate(end)),
                        orderBy('createdAt', 'desc')
                    );
                    
                    promises.push(getDocs(dateQuery).then(snapshot => 
                        snapshot.docs
                            .map(d => ({ id: d.id, ...d.data() }))
                            .filter(d => d.matchId)
                    ));
                } else {
                    promises.push(Promise.resolve(null));
                }

                const [nameMatchIds, dateResults] = await Promise.all(promises);

                let finalResults = [];

                if (hasDateSearch) {
                    finalResults = dateResults;
                } else if (hasNameSearch) {
                    setError("現在、プレイヤー名での検索はサポートされていません。IDまたは日時で検索してください。");
                    setLoading(false);
                    return;
                }

                finalResults.sort((a, b) => safeGetMillis(b.createdAt) - safeGetMillis(a.createdAt));

                if (finalResults.length === 0) {
                    setError("条件に一致するデータは見つかりませんでした。");
                } else {
                    setMatchList(finalResults);
                }
            }
        } catch (e) {
            console.error(e);
            setError("検索中にエラーが発生しました: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const searchByMatchId = async (mid) => {
        const docRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'match_history', mid);
        const docSnap = await getDoc(docRef);
        
        if (!docSnap.exists()) {
            setError("指定された試合IDのデータは見つかりませんでした。");
            return;
        }
        await processRoomData(docSnap);
    };

    const processRoomData = async (roomDoc) => {
        setLoading(true);
        const roomData = roomDoc.data();
        const roomId = roomDoc.id; 

        let finalPlayers = roomData.players || [];
        
        let chatMessages = Array.isArray(roomData.chatMessages) ? roomData.chatMessages : [];

        if (chatMessages.length === 0 && roomData.roomCode) {
             try {
                 const oldChatSnap = await getDocs(
                     collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomData.roomCode, 'chat')
                 );
                 if (!oldChatSnap.empty) {
                     chatMessages = oldChatSnap.docs.map(d => d.data());
                 }
             } catch (e) {
                 console.log("Fallback chat fetch failed", e);
             }
        }

        chatMessages.sort((a, b) => safeGetMillis(a.createdAt) - safeGetMillis(b.createdAt));

        setSearchResult({
            room: { ...roomData, id: roomId },
            players: finalPlayers,
            chatMessages: chatMessages
        });
        setShowDetail(true);
        setDetailTab('info');
        setLoading(false);
    };

    const groupedChatMessages = useMemo(() => {
        if (!searchResult?.chatMessages) return [];
        
        // 生存者チャット(public)のみにフィルタリング
        const filteredMessages = searchResult.chatMessages.filter(msg => {
            const channel = msg.channel || 'public'; 
            return channel === 'public';
        });

        const groups = [];
        let currentDay = null;
        let currentGroup = null;

        filteredMessages.forEach(msg => {
            const day = msg.day !== undefined ? msg.day : 1;
            if (day !== currentDay) {
                if (currentGroup) groups.push(currentGroup);
                currentGroup = { day, messages: [] };
                currentDay = day;
            }
            if (currentGroup) {
                currentGroup.messages.push(msg);
            }
        });
        if (currentGroup) groups.push(currentGroup);
        return groups;
    }, [searchResult]);

    // 役職情報マップの作成 (ID -> RoleInfo)
    const playerRolesMap = useMemo(() => {
        if (!searchResult?.players) return {};
        const map = {};
        searchResult.players.forEach(p => {
            map[p.id] = { role: p.role, originalRole: p.originalRole };
        });
        return map;
    }, [searchResult]);

    // 役職ラベル取得ヘルパー
    const getRoleLabel = (senderId) => {
        if (!playerRolesMap[senderId]) return "";
        const { role, originalRole } = playerRolesMap[senderId];
        if (!role) return "";

        // 呪われし者の特別表記
        if (originalRole === 'cursed') {
            if (role === 'werewolf') return "（呪われし者 - 人狼陣営）";
            return "（呪われし者 - 市民陣営）";
        }

        const roleName = ROLE_DEFINITIONS[role]?.name || role;
        return `（${roleName}）`;
    };

    const timeOptions = [];
    for (let i = 0; i < 24; i++) {
        timeOptions.push(<option key={i} value={i}>{`${i}:00 - ${i+1}:00`}</option>);
    }

    const getStatusInfo = (room) => {
        if (room.status === 'aborted') {
            return { 
                text: "強制終了", 
                subText: "ABORTED",
                color: "text-gray-400", 
                bg: "bg-gray-800",
                border: "border-gray-600",
                gradient: "from-gray-800 to-gray-900",
                icon: AlertOctagon 
            };
        }
        
        const isCitizenWin = room.winner === 'citizen';
        const isWerewolfWin = room.winner === 'werewolf';
        const isFoxWin = room.winner === 'fox';
        const isTeruteruWin = room.teruteruWon === true;

        if (isTeruteruWin) {
            if (isCitizenWin) return { text: "市民勝利 ＋ てるてる", subText: "CITIZEN + TERUTERU", color: "text-yellow-200", bg: "bg-yellow-900/30", border: "border-yellow-500", gradient: "from-yellow-900/40 to-green-900/40", icon: Trophy };
            if (isWerewolfWin) return { text: "人狼勝利 ＋ てるてる", subText: "WEREWOLF + TERUTERU", color: "text-yellow-200", bg: "bg-red-900/30", border: "border-red-500", gradient: "from-red-900/40 to-yellow-900/40", icon: Trophy };
            if (isFoxWin) return { text: "妖狐勝利 ＋ てるてる", subText: "FOX + TERUTERU", color: "text-orange-200", bg: "bg-orange-900/30", border: "border-orange-500", gradient: "from-orange-900/40 to-yellow-900/40", icon: Trophy };
            return { text: "てるてる坊主 勝利", subText: "TERUTERU WIN", color: "text-yellow-400", bg: "bg-yellow-900/30", border: "border-yellow-500", gradient: "from-yellow-900/20 to-black", icon: Trophy };
        }

        if (isCitizenWin) return { text: "市民陣営 勝利", subText: "CITIZEN WIN", color: "text-green-400", bg: "bg-green-900/20", border: "border-green-600", gradient: "from-green-900/30 to-black", icon: Trophy };
        if (isWerewolfWin) return { text: "人狼陣営 勝利", subText: "WEREWOLF WIN", color: "text-red-400", bg: "bg-red-900/20", border: "border-red-600", gradient: "from-red-900/30 to-black", icon: Trophy };
        if (isFoxWin) return { text: "妖狐 勝利", subText: "FOX WIN", color: "text-orange-400", bg: "bg-orange-900/20", border: "border-orange-600", gradient: "from-orange-900/30 to-black", icon: Trophy };

        return { text: "引き分け", subText: "DRAW", color: "text-gray-400", bg: "bg-gray-800", border: "border-gray-600", gradient: "from-gray-800 to-black", icon: Trophy };
    };

    const getStatusDisplay = (room) => {
        const info = getStatusInfo(room);
        const Icon = info.icon;
        
        return (
             <div className={`w-full py-4 rounded-xl border font-bold flex flex-col items-center justify-center gap-1 tracking-wider ${info.bg} ${info.border} ${info.color} shadow-lg`}>
                 <div className="flex items-center gap-2 text-lg">
                     <Icon size={24}/> {info.text}
                 </div>
                 <span className="text-[10px] opacity-70 tracking-[0.2em] font-mono">{info.subText}</span>
             </div>
        );
    };

    return (
        <div className="h-screen bg-gray-950 text-gray-100 font-sans flex flex-col overflow-hidden relative">
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] bg-blue-900/10 rounded-full blur-[120px]"></div>
                <div className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] bg-purple-900/10 rounded-full blur-[120px]"></div>
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5"></div>
            </div>

            <div className="flex-none p-4 z-20 flex items-center">
                <button onClick={() => { 
                    if(showDetail) { setShowDetail(false); setSearchResult(null); } 
                    else setView('home');
                }} className="flex items-center gap-2 text-gray-400 hover:text-white transition px-4 py-2 rounded-xl bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50 backdrop-blur-sm group shadow-lg">
                    <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform"/> {showDetail ? "リストに戻る" : "ホームに戻る"}
                </button>
            </div>

            <div className="flex-1 flex overflow-hidden z-10 px-4 pb-4 gap-4">
                
                {!showDetail ? (
                    <div className="flex flex-col md:flex-row gap-4 w-full h-full min-h-0">
                        <div className="w-full md:w-[30%] md:min-w-[300px] md:max-w-sm flex flex-col gap-4 bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-700/50 shadow-2xl p-4 md:p-6 relative shrink-0 h-auto md:h-full max-h-[40vh] md:max-h-full">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 opacity-50"></div>
                            
                            <div className="mb-2 shrink-0">
                                <h3 className="text-lg md:text-xl font-black text-white flex items-center gap-2 mb-1"><Search size={20} md:size={24} className="text-blue-400"/> SEARCH</h3>
                                <p className="text-[10px] md:text-xs text-gray-500">条件を指定して過去ログを検索</p>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4 md:space-y-6 pt-2">
                                <div className="bg-gray-800/40 p-4 pt-6 rounded-2xl border border-gray-700/50 relative mt-2">
                                    <div className="absolute -top-3 left-3 bg-gray-900 px-2 text-[10px] font-bold text-blue-400 border border-blue-500/30 rounded-full flex items-center gap-1">
                                        <Hash size={10}/> ID指定で検索
                                    </div>
                                    <div className="space-y-2 mt-1">
                                        <input 
                                            type="text" 
                                            placeholder="例: aBc123" 
                                            className="w-full bg-black/40 border border-gray-600 rounded-xl px-4 py-2 md:py-3 text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition font-mono tracking-wider placeholder-gray-700 text-sm"
                                            value={matchIdInput}
                                            onChange={(e) => setMatchIdInput(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-center">
                                    <span className="text-[10px] text-gray-500 font-bold bg-gray-900 px-2 relative z-10">OR</span>
                                    <div className="absolute w-full h-px bg-gray-800"></div>
                                </div>

                                <div className="bg-gray-800/40 p-4 pt-6 rounded-2xl border border-gray-700/50 relative mt-2">
                                    <div className="absolute -top-3 left-3 bg-gray-900 px-2 text-[10px] font-bold text-purple-400 border border-purple-500/30 rounded-full flex items-center gap-1">
                                        <Filter size={10}/> 条件で検索
                                    </div>
                                    
                                    <div className="space-y-4 mt-1">
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <label className="text-[10px] md:text-xs text-gray-400 font-bold flex items-center gap-1"><Calendar size={12}/> 日時</label>
                                                <button 
                                                    onClick={() => { setSearchDate(""); setSearchTime(""); }}
                                                    className="text-[10px] text-gray-500 hover:text-white bg-gray-800 px-2 py-0.5 rounded border border-gray-700 hover:bg-gray-700 transition flex items-center gap-1"
                                                >
                                                    <Trash2 size={10}/> 指定しない
                                                </button>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <input 
                                                    type="date" 
                                                    className={`w-full border rounded-xl pl-4 pr-4 py-2 md:py-3 outline-none transition text-xs md:text-sm appearance-none ${searchDate ? "bg-black/40 border-gray-600 text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50" : "bg-gray-800/30 border-gray-700 text-gray-500"}`}
                                                    value={searchDate}
                                                    onChange={(e) => setSearchDate(e.target.value)}
                                                />
                                                <select 
                                                    className={`w-full border rounded-xl pl-4 pr-8 py-2 md:py-3 outline-none transition text-xs md:text-sm appearance-none ${searchTime ? "bg-black/40 border-gray-600 text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50" : "bg-gray-800/30 border-gray-700 text-gray-500"}`}
                                                    value={searchTime}
                                                    onChange={(e) => setSearchTime(e.target.value)}
                                                >
                                                    <option value="">全時間帯</option>
                                                    {timeOptions}
                                                </select>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 opacity-30">
                                            <div className="h-px bg-gray-500 flex-1"></div>
                                            <span className="text-[10px] text-gray-400 font-bold">AND / OR</span>
                                            <div className="h-px bg-gray-500 flex-1"></div>
                                        </div>

                                        <div className="space-y-2 opacity-50 pointer-events-none">
                                            <label className="text-[10px] md:text-xs text-gray-400 font-bold flex items-center gap-1"><User size={12}/> プレイヤー名</label>
                                            <input 
                                                type="text" 
                                                placeholder="現在は利用できません" 
                                                maxLength={10}
                                                className="w-full bg-black/40 border border-gray-600 rounded-xl px-4 py-2 md:py-3 text-white outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition text-xs md:text-sm placeholder-gray-700"
                                                value={searchName}
                                                onChange={(e) => setSearchName(e.target.value)}
                                                disabled
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-center text-xs font-bold animate-pulse flex items-start justify-center gap-2 mb-2 shrink-0">
                                    <AlertOctagon size={16} className="shrink-0 mt-0.5"/> <span>{error}</span>
                                </div>
                            )}

                            <div className="flex flex-col gap-2 mt-2 shrink-0">
                                <button 
                                    onClick={handleClearAll} 
                                    className="w-full py-2 md:py-3 rounded-xl border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white transition flex items-center justify-center gap-2 text-xs md:text-sm font-bold hover:border-gray-500"
                                >
                                    <RefreshCw size={16}/> 条件をすべてクリア
                                </button>
                                
                                <button 
                                    onClick={() => handleSearchButton()} 
                                    disabled={loading}
                                    className="w-full py-3 md:py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg transition transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm md:text-base"
                                >
                                    {loading ? <Loader className="animate-spin" size={20}/> : <Search size={20}/>}
                                    検索する
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 min-w-0 bg-gray-900/40 rounded-3xl border border-gray-800/50 overflow-hidden relative backdrop-blur-sm flex flex-col h-full">
                            <div className="p-4 border-b border-gray-800/50 bg-gray-900/50 flex justify-between items-center sticky top-0 z-10 backdrop-blur-md">
                                <h3 className="font-bold text-gray-300 flex items-center gap-2 text-sm md:text-base"><List size={18} className="text-blue-400"/> GAME LIST</h3>
                                <span className="text-xs bg-black/30 px-2 py-1 rounded text-gray-500">{matchList.length} GAMES</span>
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                {loading ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-4">
                                        <Loader className="animate-spin text-blue-500" size={32}/>
                                        <p className="text-xs font-bold tracking-widest">LOADING...</p>
                                    </div>
                                ) : matchList.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                        <XCircle size={32} className="mb-2 opacity-50"/>
                                        <p className="text-sm">条件に一致するデータは見つかりませんでした</p>
                                        <p className="text-xs text-gray-600 mt-1">条件を変更して検索してください</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-3">
                                        {matchList.map((m, idx) => {
                                            const statusInfo = getStatusInfo(m);
                                            return (
                                                <div 
                                                    key={m.id} 
                                                    onClick={() => processRoomData({ data: () => m, id: m.id })} 
                                                    className={`group relative flex flex-col gap-3 p-4 rounded-2xl cursor-pointer transition-all duration-300 animate-fade-in-up shadow-lg hover:shadow-xl hover:-translate-y-1 bg-gradient-to-br ${statusInfo.gradient} border-l-4 ${statusInfo.border} border-t border-r border-b border-white/5`}
                                                    style={{ animationDelay: `${Math.min(idx * 0.05, 0.5)}s` }}
                                                >
                                                    <div className="flex justify-between items-start">
                                                        <div className="flex flex-col">
                                                            <div className="flex items-center gap-3 mb-1">
                                                                <span className="bg-black/40 backdrop-blur px-2 py-0.5 rounded text-[10px] font-mono font-bold text-gray-400 tracking-widest border border-white/10">
                                                                    MATCH: {m.matchId}
                                                                </span>
                                                                <span className="bg-black/40 backdrop-blur px-2 py-0.5 rounded text-[10px] font-mono font-bold text-gray-400 tracking-widest border border-white/10">
                                                                    ROOM: {m.roomCode || m.id}
                                                                </span>
                                                            </div>
                                                            <div className={`text-lg md:text-xl font-black tracking-wide flex items-center gap-2 ${statusInfo.color}`}>
                                                                {statusInfo.text}
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="bg-black/30 p-2 rounded-full border border-white/10 group-hover:bg-white/10 transition">
                                                            <ChevronRight size={20} className="text-gray-400 group-hover:text-white"/>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between pt-3 border-t border-white/10 mt-1">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex items-center gap-1.5 bg-black/30 px-2.5 py-1 rounded-full border border-white/5">
                                                                <Crown size={12} className="text-yellow-500 fill-yellow-500/20"/>
                                                                <span className="text-xs font-bold text-gray-200 truncate max-w-[100px]">{m.hostName || "不明"}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 text-gray-400">
                                                            <Clock size={12}/>
                                                            <span className="text-xs font-mono font-medium">
                                                                {new Date(safeGetMillis(m.createdAt)).toLocaleString([], {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 min-w-0 flex flex-col md:flex-row gap-4 h-full px-0 md:px-[5%] justify-center overflow-hidden">
                        
                        <div className="md:hidden flex bg-gray-900/80 p-1 rounded-xl shrink-0">
                            <button onClick={() => setDetailTab('info')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${detailTab === 'info' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>情報</button>
                            {!searchResult.room.inPersonMode && <button onClick={() => setDetailTab('chat')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${detailTab === 'chat' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>チャット</button>}
                            <button onClick={() => setDetailTab('log')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition ${detailTab === 'log' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>ログ</button>
                        </div>

                        <div className={`flex-1 flex flex-col gap-4 min-h-0 h-full md:max-w-[33%] ${detailTab !== 'info' ? 'hidden md:flex' : 'flex'}`}>
                            <div className="bg-[#0f1115] border border-white/10 rounded-[32px] p-6 shrink-0 shadow-lg relative overflow-hidden flex flex-col items-center">
                                <div className="w-full flex justify-between items-center mb-8 border-b border-gray-800 pb-3">
                                    <span className="text-gray-500 text-[10px] font-bold tracking-[0.2em] uppercase">MATCH ID</span>
                                    <span className="text-gray-500 text-[10px] font-mono tracking-wider">{new Date(safeGetMillis(searchResult.room.createdAt)).toLocaleString()}</span>
                                </div>
                                <div className="text-3xl md:text-5xl font-black text-white tracking-widest mb-8 md:mb-10 text-center drop-shadow-2xl whitespace-nowrap overflow-hidden text-ellipsis w-full">
                                    {searchResult.room.matchId}
                                </div>
                                {getStatusDisplay(searchResult.room)}
                            </div>

                            <div className="flex-1 min-h-0 rounded-[32px] overflow-hidden border border-white/10 bg-[#0f1115] shadow-lg flex flex-col">
                                <div className="flex-1 overflow-y-auto custom-scrollbar">
                                    <DeadPlayerInfoPanel players={searchResult.players} title="参加プレイヤーと役職" />
                                </div>
                            </div>
                        </div>

                        {!searchResult.room.inPersonMode && (
                            <div className={`flex-1 flex flex-col min-h-0 h-full bg-gray-900/60 rounded-3xl border border-gray-700/50 overflow-hidden relative md:max-w-[33%] ${detailTab !== 'chat' ? 'hidden md:flex' : 'flex'}`}>
                                <div className="p-4 border-b border-gray-700 font-bold text-gray-300 flex items-center gap-2 bg-gray-800/40 backdrop-blur-sm shrink-0">
                                    <MessageSquare size={18} className="text-green-400"/> 生存者チャット
                                </div>
                                
                                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-black/10 relative">
                                    {groupedChatMessages.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-500 opacity-50 gap-2">
                                            <MessageSquare size={32}/>
                                            <p className="text-xs font-bold">チャット履歴はありません</p>
                                        </div>
                                    ) : (
                                        groupedChatMessages.map((group) => (
                                            <div key={group.day} className="relative">
                                                <div className="sticky top-0 z-10 flex justify-center mb-4">
                                                    <span className="bg-gray-800/90 border border-gray-600 px-3 py-0.5 rounded-full text-[10px] font-bold text-gray-300 shadow-sm backdrop-blur-sm">
                                                        {group.day}日目
                                                    </span>
                                                </div>
                                                <div className="space-y-3">
                                                    {group.messages.map((msg, i) => (
                                                        <div key={i} className="flex flex-col items-start animate-fade-in">
                                                            <div className="flex items-baseline gap-2 mb-1 ml-1">
                                                                <span className="text-[11px] font-bold text-blue-300">
                                                                    {msg.senderName}
                                                                    <span className="ml-1 text-gray-500 font-normal">
                                                                        {getRoleLabel(msg.senderId)}
                                                                    </span>
                                                                </span>
                                                                <span className="text-[9px] text-gray-600">{new Date(safeGetMillis(msg.createdAt)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                                            </div>
                                                            <div className="bg-gray-800/80 border-gray-700/50 text-gray-200 p-3 rounded-2xl rounded-tl-none border text-sm break-words max-w-full shadow-sm">
                                                                {msg.text}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}

                        <div className={`flex-1 flex flex-col min-h-0 h-full bg-gray-900/60 rounded-3xl border border-gray-700/50 overflow-hidden relative shadow-lg ${searchResult.room.inPersonMode ? 'md:max-w-[66%]' : 'md:max-w-[33%]'} ${detailTab !== 'log' ? 'hidden md:flex' : 'flex'}`}>
                            <div className="flex-1 overflow-hidden">
                                <LogPanel logs={searchResult.room.logs} showSecret={true} user={{uid: 'all'}} />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};