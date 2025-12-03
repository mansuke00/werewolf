import React, { useState, useEffect, useMemo } from 'react';
import { Search, ArrowLeft, Loader, FileText, Clock, Trophy, AlertOctagon, Calendar, List, MessageSquare, ChevronRight, XCircle, User, Users, LayoutGrid, SortAsc, Hash, Filter, RefreshCw, Trash2 } from 'lucide-react';
import { collection, query, where, getDocs, orderBy, Timestamp, collectionGroup, getDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase.js';
import { getMillis } from '../utils/helpers.js';
import { LogPanel } from '../components/game/LogPanel.jsx';
import { DeadPlayerInfoPanel } from '../components/game/DeadPlayerInfoPanel.jsx';

export const LogViewerScreen = ({ setView }) => {
    // 検索条件
    const [matchIdInput, setMatchIdInput] = useState("");
    const [searchDate, setSearchDate] = useState("");
    const [searchTime, setSearchTime] = useState("");
    const [searchName, setSearchName] = useState("");
    
    // データ状態
    const [searchResult, setSearchResult] = useState(null); // 詳細表示用データ
    const [loading, setLoading] = useState(false);
    const [matchList, setMatchList] = useState([]); // リスト表示用データ
    const [showDetail, setShowDetail] = useState(false); // 詳細表示モードかどうか
    const [error, setError] = useState("");

    // 初期化時に今日の日付をセット
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        setSearchDate(today);
        // 初期表示でリストを読み込む
        handleSearchButton(today); 
    }, []);

    const handleClearAll = () => {
        setMatchIdInput("");
        setSearchDate("");
        setSearchTime("");
        setSearchName("");
        setError("");
    };

    // 統合検索ボタンのハンドラ（AND検索に対応）
    const handleSearchButton = async (initialDate = null) => {
        setLoading(true);
        setError("");
        setSearchResult(null);
        setShowDetail(false);
        setMatchList([]);

        try {
            // 試合ID指定がある場合は最優先
            if (matchIdInput.trim()) {
                await searchByMatchId(matchIdInput.trim());
            } else {
                const targetDate = initialDate || searchDate;
                const hasNameSearch = !!searchName.trim();
                const hasDateSearch = !!targetDate;

                // 並列処理用のPromise配列
                const promises = [];
                
                // 1. 名前検索（該当する部屋IDのセットを取得）
                if (hasNameSearch) {
                    const nameQuery = query(collectionGroup(db, 'players'), where('name', '==', searchName.trim()));
                    promises.push(getDocs(nameQuery).then(snapshot => {
                        const ids = new Set();
                        snapshot.forEach(doc => {
                            if (doc.ref.parent && doc.ref.parent.parent) {
                                ids.add(doc.ref.parent.parent.id);
                            }
                        });
                        return ids;
                    }));
                } else {
                    promises.push(Promise.resolve(null));
                }

                // 2. 日時検索（該当する部屋データのリストを取得）
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
                        collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms'), 
                        where('createdAt', '>=', Timestamp.fromDate(start)),
                        where('createdAt', '<', Timestamp.fromDate(end)),
                        orderBy('createdAt', 'desc')
                    );
                    
                    promises.push(getDocs(dateQuery).then(snapshot => 
                        snapshot.docs
                            .map(d => ({ id: d.id, ...d.data() }))
                            .filter(d => ['finished', 'closed', 'aborted'].includes(d.status) && d.matchId)
                    ));
                } else {
                    promises.push(Promise.resolve(null));
                }

                // 両方の検索結果を待つ
                const [nameMatchIds, dateResults] = await Promise.all(promises);

                let finalResults = [];

                // 3. AND条件による結合
                if (hasNameSearch && hasDateSearch) {
                    // 名前検索でヒットしたIDに含まれる日付検索結果のみを残す
                    finalResults = dateResults.filter(room => nameMatchIds.has(room.id));
                } else if (hasNameSearch) {
                    // 名前検索のみの場合、IDリストから部屋詳細を取得
                    const roomPromises = Array.from(nameMatchIds).map(id => getDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', id)));
                    const roomSnaps = await Promise.all(roomPromises);
                    finalResults = roomSnaps
                        .filter(s => s.exists() && ['finished', 'closed', 'aborted'].includes(s.data().status))
                        .map(s => ({ id: s.id, ...s.data() }));
                } else if (hasDateSearch) {
                    // 日付検索のみ
                    finalResults = dateResults;
                } else {
                    // 条件なしの場合は直近のデータを取得（負荷対策のため制限付き）
                    const recentQuery = query(
                        collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms'), 
                        orderBy('createdAt', 'desc'),
                        // limit(20) // 必要に応じて制限
                    );
                    // ここでは実装を省略し、日付指定を促すエラーにするか、全件検索を許容するか判断が必要
                    // 今回はリストを空にしてエラーメッセージを表示
                    setError("検索条件を指定してください（日時またはプレイヤー名）");
                    setLoading(false);
                    return;
                }

                // ソート
                finalResults.sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

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
        const q = query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms'), where('matchId', '==', mid));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            setError("指定された試合IDのデータは見つかりませんでした。");
            return;
        }
        await processRoomData(snapshot.docs[0]);
    };

    const processRoomData = async (roomDoc) => {
        setLoading(true);
        const roomData = roomDoc.data();
        const roomId = roomDoc.id;

        let finalPlayers = [];
        
        try {
            // Cloud Functions経由で役職を含む全プレイヤー情報を取得
            const fn = httpsCallable(functions, 'getAllPlayerRoles');
            const res = await fn({ roomCode: roomId });
            
            if (res.data && res.data.players) {
                finalPlayers = res.data.players.map(p => {
                    if (p.isSpectator) return { ...p, role: 'spectator' };
                    if (!p.role) return { ...p, role: 'unknown' };
                    return p;
                });
            } else {
                throw new Error("Functions returned empty player data");
            }
        } catch (funcError) {
            console.warn("getAllPlayerRoles failed, falling back to public info:", funcError);
            
            const playersSnap = await getDocs(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomId, 'players'));
            finalPlayers = playersSnap.docs.map(d => {
                const p = { id: d.id, ...d.data() };
                if (p.isSpectator) {
                    p.role = 'spectator';
                } else {
                    p.role = 'unknown'; 
                }
                return p;
            });
            setError("役職情報の取得に失敗しました。一部情報が制限されます。");
        }

        const chatSnap = await getDocs(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomId, 'chat'), orderBy('createdAt', 'asc')));
        const chatMessages = chatSnap.docs.map(d => d.data());

        setSearchResult({
            room: { ...roomData, id: roomId },
            players: finalPlayers,
            chatMessages: chatMessages
        });
        setShowDetail(true);
        setLoading(false);
    };

    const groupedChatMessages = useMemo(() => {
        if (!searchResult?.chatMessages) return [];
        const groups = [];
        let currentDay = null;
        let currentGroup = null;

        searchResult.chatMessages.forEach(msg => {
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

    const timeOptions = [];
    for (let i = 0; i < 24; i++) {
        timeOptions.push(<option key={i} value={i}>{`${i}:00 - ${i+1}:00`}</option>);
    }

    const getStatusDisplay = (room) => {
        if (room.status === 'aborted') {
             return (
                 <div className="w-full py-4 rounded-xl bg-[#2a1a1a] border border-red-500/30 text-red-400 font-bold flex items-center justify-center gap-2 tracking-wider">
                     <AlertOctagon size={20}/> 強制終了
                 </div>
             );
        } else {
             const isCitizenWin = room.winner === 'citizen';
             const isWerewolfWin = room.winner === 'werewolf';
             const isFoxWin = room.winner === 'fox';
             
             let label = "引き分け";
             let colorClass = "bg-[#1a1d26] border-gray-700 text-gray-400";
             let Icon = Trophy;

             if (isCitizenWin) { label = "市民陣営 勝利"; colorClass = "bg-[#1a2620] border-green-500/30 text-green-400"; }
             if (isWerewolfWin) { label = "人狼陣営 勝利"; colorClass = "bg-[#2a1a1a] border-red-500/30 text-red-400"; Icon = Trophy; }
             if (isFoxWin) { label = "妖狐 勝利"; colorClass = "bg-[#2a201a] border-orange-500/30 text-orange-400"; }

             return (
                 <div className={`w-full py-4 rounded-xl border font-bold flex items-center justify-center gap-2 tracking-wider ${colorClass}`}>
                     <Icon size={20}/> {label}
                 </div>
             );
        }
    };

    return (
        <div className="h-screen bg-gray-950 text-gray-100 font-sans flex flex-col overflow-hidden relative">
            {/* 背景エフェクト */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] bg-blue-900/10 rounded-full blur-[120px]"></div>
                <div className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] bg-purple-900/10 rounded-full blur-[120px]"></div>
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-5"></div>
            </div>

            {/* ヘッダー */}
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
                    // === リスト表示モード ===
                    <>
                        {/* 左側: 検索パネル */}
                        <div className="w-[30%] min-w-[300px] max-w-sm flex flex-col gap-4 bg-gray-900/80 backdrop-blur-xl rounded-3xl border border-gray-700/50 shadow-2xl p-6 relative shrink-0">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 opacity-50"></div>
                            
                            <div className="mb-2">
                                <h3 className="text-xl font-black text-white flex items-center gap-2 mb-1"><Search size={24} className="text-blue-400"/> SEARCH</h3>
                                <p className="text-xs text-gray-500">条件を指定して過去ログを検索</p>
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6 pt-4">
                                
                                {/* ID検索エリア - mtを大きくしてタグのはみ出しを防止 */}
                                <div className="bg-gray-800/40 p-4 pt-6 rounded-2xl border border-gray-700/50 relative mt-2">
                                    <div className="absolute -top-3 left-3 bg-gray-900 px-2 text-[10px] font-bold text-blue-400 border border-blue-500/30 rounded-full flex items-center gap-1">
                                        <Hash size={10}/> ID指定で検索
                                    </div>
                                    <div className="space-y-2 mt-1">
                                        <label className="text-xs text-gray-400 font-bold flex items-center gap-1">試合ID (完全一致)</label>
                                        <input 
                                            type="text" 
                                            placeholder="例: aBc123" 
                                            className="w-full bg-black/40 border border-gray-600 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition font-mono tracking-wider placeholder-gray-700"
                                            value={matchIdInput}
                                            onChange={(e) => setMatchIdInput(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center justify-center">
                                    <span className="text-[10px] text-gray-500 font-bold bg-gray-900 px-2 relative z-10">OR</span>
                                    <div className="absolute w-full h-px bg-gray-800"></div>
                                </div>

                                {/* 条件検索エリア - mtを大きくしてタグのはみ出しを防止 */}
                                <div className="bg-gray-800/40 p-4 pt-6 rounded-2xl border border-gray-700/50 relative mt-2">
                                    <div className="absolute -top-3 left-3 bg-gray-900 px-2 text-[10px] font-bold text-purple-400 border border-purple-500/30 rounded-full flex items-center gap-1">
                                        <Filter size={10}/> 条件で検索
                                    </div>
                                    
                                    <div className="space-y-4 mt-1">
                                        {/* 日時検索 */}
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-center">
                                                <label className="text-xs text-gray-400 font-bold flex items-center gap-1"><Calendar size={12}/> 日時</label>
                                                <button 
                                                    onClick={() => { setSearchDate(""); setSearchTime(""); }}
                                                    className="text-[10px] text-gray-500 hover:text-white bg-gray-800 px-2 py-0.5 rounded border border-gray-700 hover:bg-gray-700 transition flex items-center gap-1"
                                                >
                                                    <Trash2 size={10}/> 指定しない
                                                </button>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                {/* 未指定時はプレースホルダー風のスタイルにする */}
                                                <input 
                                                    type="date" 
                                                    className={`w-full border rounded-xl pl-4 pr-4 py-3 outline-none transition text-sm appearance-none ${searchDate ? "bg-black/40 border-gray-600 text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50" : "bg-gray-800/30 border-gray-700 text-gray-500"}`}
                                                    value={searchDate}
                                                    onChange={(e) => setSearchDate(e.target.value)}
                                                />
                                                <select 
                                                    className={`w-full border rounded-xl pl-4 pr-8 py-3 outline-none transition text-sm appearance-none ${searchTime ? "bg-black/40 border-gray-600 text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50" : "bg-gray-800/30 border-gray-700 text-gray-500"}`}
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
                                            <span className="text-[10px] text-gray-400 font-bold">AND</span>
                                            <div className="h-px bg-gray-500 flex-1"></div>
                                        </div>

                                        {/* プレイヤー名検索 */}
                                        <div className="space-y-2">
                                            <label className="text-xs text-gray-400 font-bold flex items-center gap-1"><User size={12}/> プレイヤー名</label>
                                            <input 
                                                type="text" 
                                                placeholder="名前 (10文字以内)" 
                                                maxLength={10}
                                                className="w-full bg-black/40 border border-gray-600 rounded-xl px-4 py-3 text-white outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition text-sm placeholder-gray-700"
                                                value={searchName}
                                                onChange={(e) => setSearchName(e.target.value)}
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
                                    className="w-full py-3 rounded-xl border border-gray-600 text-gray-400 hover:bg-gray-800 hover:text-white transition flex items-center justify-center gap-2 text-sm font-bold hover:border-gray-500"
                                >
                                    <RefreshCw size={16}/> 条件をすべてクリア
                                </button>
                                
                                <button 
                                    onClick={() => handleSearchButton()} 
                                    disabled={loading}
                                    className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl shadow-lg transition transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {loading ? <Loader className="animate-spin" size={20}/> : <Search size={20}/>}
                                    検索する
                                </button>
                            </div>
                        </div>

                        {/* 右側: リストエリア */}
                        <div className="flex-1 min-w-0 bg-gray-900/40 rounded-3xl border border-gray-800/50 overflow-hidden relative backdrop-blur-sm flex flex-col">
                            <div className="p-4 border-b border-gray-800/50 bg-gray-900/50 flex justify-between items-center sticky top-0 z-10 backdrop-blur-md">
                                <h3 className="font-bold text-gray-300 flex items-center gap-2"><List size={18} className="text-blue-400"/> GAME LIST</h3>
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
                                    matchList.map((m, idx) => (
                                        <div 
                                            key={m.id} 
                                            onClick={() => processRoomData({ data: () => m, id: m.id })} 
                                            className="group flex items-center justify-between p-4 bg-gray-800/40 hover:bg-gray-700/60 border border-gray-700/30 hover:border-blue-500/30 rounded-xl cursor-pointer transition-all duration-200 animate-fade-in-up"
                                            style={{ animationDelay: `${Math.min(idx * 0.05, 0.5)}s` }}
                                        >
                                            <div className="flex items-center gap-4 md:gap-6 min-w-0">
                                                <div className="shrink-0 flex flex-col items-center justify-center bg-black/20 w-12 h-12 rounded-lg border border-white/5">
                                                    {m.status === 'aborted' ? <AlertOctagon size={20} className="text-red-500 opacity-70"/> : <Trophy size={20} className={m.winner === 'citizen' ? "text-green-500" : m.winner === 'werewolf' ? "text-red-500" : m.winner === 'fox' ? "text-orange-500" : "text-gray-500"}/>}
                                                </div>
                                                <div className="flex flex-col min-w-0">
                                                    <div className="flex items-center gap-3">
                                                        <span className="font-mono text-lg font-black text-gray-200 group-hover:text-blue-300 transition tracking-widest leading-none">
                                                            {m.matchId}
                                                        </span>
                                                        {m.status === 'aborted' && (
                                                            <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20 font-bold uppercase">Aborted</span>
                                                        )}
                                                    </div>
                                                    <span className="text-[10px] text-gray-500 font-mono mt-1 flex items-center gap-1">
                                                        <Clock size={10}/> {new Date(getMillis(m.createdAt)).toLocaleString()}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-6 shrink-0 text-right">
                                                <div className="flex flex-col items-end">
                                                    <div className={`text-sm font-bold ${m.status === 'aborted' ? "text-gray-500" : m.winner === 'citizen' ? "text-green-400" : m.winner === 'werewolf' ? "text-red-400" : m.winner === 'fox' ? "text-orange-400" : "text-gray-500"}`}>
                                                        {m.status === 'aborted' ? "強制終了" : m.winner === 'citizen' ? "市民陣営" : m.winner === 'werewolf' ? "人狼陣営" : m.winner === 'fox' ? "妖狐" : "引き分け"}
                                                    </div>
                                                    {m.teruteruWon && (
                                                        <span className="text-[10px] text-green-300 bg-green-900/30 px-1.5 py-0.5 rounded border border-green-500/20 mt-0.5 block w-fit">+ てるてる</span>
                                                    )}
                                                </div>
                                                <ChevronRight size={20} className="text-gray-600 group-hover:text-white group-hover:translate-x-1 transition-all"/>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    // === 詳細表示モード ===
                    <div className="flex-1 min-w-0 flex gap-4 h-full px-[5%] justify-center">
                        
                        {/* 左カラム: マッチ情報 & プレイヤーリスト */}
                        <div className="flex-1 flex flex-col gap-4 min-h-0 h-full max-w-[33%]">
                            <div className="bg-[#0f1115] border border-white/10 rounded-[32px] p-6 shrink-0 shadow-lg relative overflow-hidden flex flex-col items-center">
                                <div className="w-full flex justify-between items-center mb-8 border-b border-gray-800 pb-3">
                                    <span className="text-gray-500 text-[10px] font-bold tracking-[0.2em] uppercase">MATCH ID</span>
                                    <span className="text-gray-500 text-[10px] font-mono tracking-wider">{new Date(getMillis(searchResult.room.createdAt)).toLocaleString()}</span>
                                </div>
                                <div className="text-7xl font-black text-white tracking-widest mb-10 text-center drop-shadow-2xl">
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

                        {/* 中央カラム: 生存者チャット */}
                        <div className="flex-1 flex flex-col min-h-0 h-full bg-gray-900/60 rounded-3xl border border-gray-700/50 overflow-hidden relative max-w-[33%]">
                            <div className="p-4 border-b border-gray-700 font-bold text-gray-300 flex items-center gap-2 bg-gray-800/40 backdrop-blur-sm shrink-0">
                                <MessageSquare size={18} className="text-green-400"/> 生存者チャット
                            </div>
                            
                            {!searchResult.room.inPersonMode ? (
                                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-black/10">
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
                                                                <span className="text-[11px] font-bold text-blue-300">{msg.senderName}</span>
                                                                <span className="text-[9px] text-gray-600">{new Date(getMillis(msg.createdAt)).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                                            </div>
                                                            <div className="bg-gray-800/80 p-3 rounded-2xl rounded-tl-none border border-gray-700/50 text-sm text-gray-200 break-words max-w-full shadow-sm">
                                                                {msg.text}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-2 bg-black/20">
                                    <MessageSquare size={32} className="opacity-50"/>
                                    <p className="text-sm font-bold">対面モードのためチャット記録なし</p>
                                </div>
                            )}
                        </div>

                        {/* 右カラム: 詳細ログ */}
                        <div className="flex-1 flex flex-col min-h-0 h-full bg-gray-900/60 rounded-3xl border border-gray-700/50 overflow-hidden relative shadow-lg max-w-[33%]">
                            <div className="flex-1 overflow-hidden">
                                <LogPanel logs={searchResult.room.logs} showSecret={true} user={{uid:'all'}} />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};