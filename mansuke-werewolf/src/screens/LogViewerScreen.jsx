import React, { useState, useEffect } from 'react';
import { Search, ArrowRight, ArrowLeft, Loader, FileText, Clock, Trophy, AlertOctagon, Calendar } from 'lucide-react';
import { collection, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { getMillis } from '../utils/helpers';
import { LogPanel } from '../components/game/LogPanel';
import { DeadPlayerInfoPanel } from '../components/game/DeadPlayerInfoPanel';

export const LogViewerScreen = ({ setView }) => {
    const [matchIdInput, setMatchIdInput] = useState("");
    const [searchDate, setSearchDate] = useState("");
    const [searchTime, setSearchTime] = useState("");
    
    const [searchResult, setSearchResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [matchList, setMatchList] = useState([]);
    const [showList, setShowList] = useState(false);
    const [error, setError] = useState("");

    // 初期化時に今日の日付をセット
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        setSearchDate(today);
    }, []);

    const handleSearch = async (idToSearch) => {
        const mid = idToSearch || matchIdInput;
        
        setLoading(true);
        setError("");
        setSearchResult(null);
        
        try {
            // ID検索が優先
            if (mid) {
                const q = query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms'), where('matchId', '==', mid));
                const snapshot = await getDocs(q);
                
                if (snapshot.empty) {
                    setError("指定された試合IDのデータは見つかりませんでした。");
                    setLoading(false);
                    return;
                }
                
                await processRoomData(snapshot.docs[0]);
            } else if (searchDate) {
                // 日付・時間検索
                await handleDateSearch();
            } else {
                setError("検索条件を入力してください");
                setLoading(false);
            }
        } catch (e) {
            console.error(e);
            setError("データの取得に失敗しました: " + e.message);
            setLoading(false);
        }
    };

    const processRoomData = async (roomDoc) => {
        const roomData = roomDoc.data();
        const roomId = roomDoc.id;

        // プレイヤー情報取得
        let players = [];
        try {
            const fn = httpsCallable(functions, 'getAllPlayerRoles');
            const res = await fn({ roomCode: roomId });
            if (res.data && res.data.players) {
                // 観戦者の役職データ（spectator）を補完
                players = res.data.players.map(p => {
                    if (p.isSpectator) return { ...p, role: 'spectator' };
                    return p;
                });
            }
        } catch (funcError) {
            console.warn("Failed to fetch full player roles, falling back to public info:", funcError);
            const playersSnap = await getDocs(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomId, 'players'));
            playersSnap.forEach(d => {
                const p = { id: d.id, ...d.data() };
                if (p.isSpectator) p.role = 'spectator'; // フォールバック時も補完
                players.push(p);
            });
        }

        // チャット取得
        const chatSnap = await getDocs(query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomId, 'chat'), orderBy('createdAt', 'asc')));
        const chatMessages = chatSnap.docs.map(d => d.data());

        setSearchResult({
            room: roomData,
            players: players,
            chatMessages: chatMessages
        });
        setShowList(false);
        setLoading(false);
    };

    const handleDateSearch = async () => {
        // 日付オブジェクトの作成
        const start = new Date(searchDate);
        let end = new Date(searchDate);

        if (searchTime) {
            // 時間指定あり：その時間の1時間後まで
            start.setHours(parseInt(searchTime, 10));
            end.setHours(parseInt(searchTime, 10) + 1);
        } else {
            // 日付のみ：その日の終わりまで（翌日の0時）
            end.setDate(end.getDate() + 1);
        }

        try {
            // 複合インデックスが必要になる可能性があるため、クライアントサイドフィルタリングを併用
            // まずは日付範囲で絞り込む
            const q = query(
                collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms'), 
                where('createdAt', '>=', Timestamp.fromDate(start)),
                where('createdAt', '<', Timestamp.fromDate(end)),
                orderBy('createdAt', 'desc')
            );
            
            const snapshot = await getDocs(q);
            
            // ステータスでフィルタリング (finished, closed, aborted)
            const list = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(d => ['finished', 'closed', 'aborted'].includes(d.status) && d.matchId);

            if (list.length === 0) {
                setError("条件に一致するデータは見つかりませんでした。");
                setMatchList([]);
            } else {
                setMatchList(list);
            }
            setShowList(true);
        } catch (e) {
            console.error(e);
            setError("検索中にエラーが発生しました（インデックス未作成の可能性があります）: " + e.message);
        } finally {
            setLoading(false); // ローディング終了処理を追加
        }
    };

    const handleFetchList = async () => {
        setLoading(true);
        try {
            // ステータスが完了、閉鎖、中断のいずれかの部屋を取得
            const q = query(collection(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms'), where('status', 'in', ['finished', 'closed', 'aborted']), orderBy('createdAt', 'desc'));
            const snapshot = await getDocs(q);
            const list = snapshot.docs.map(d => ({
                id: d.id,
                matchId: d.data().matchId,
                createdAt: d.data().createdAt,
                winner: d.data().winner,
                status: d.data().status,
                teruteruWon: d.data().teruteruWon // てるてる坊主勝利フラグを追加取得
            })).filter(d => d.matchId);
            
            setMatchList(list);
            setShowList(true);
        } catch (e) {
            console.error(e);
            setError("リストの取得に失敗しました。しばらく待ってから再試行してください。");
        } finally {
            setLoading(false);
        }
    };

    // 時間オプション生成
    const timeOptions = [];
    for (let i = 0; i < 24; i++) {
        timeOptions.push(<option key={i} value={i}>{`${i}:00 - ${i+1}:00`}</option>);
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 font-sans p-6 flex flex-col items-center overflow-y-auto relative">
            {/* 背景エフェクト */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-20%] right-[-10%] w-[800px] h-[800px] bg-blue-900/10 rounded-full blur-[120px]"></div>
                <div className="absolute bottom-[-20%] left-[-10%] w-[800px] h-[800px] bg-purple-900/10 rounded-full blur-[120px]"></div>
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:100px_100px] [mask-image:radial-gradient(ellipse_at_center,black_70%,transparent_100%)]"></div>
            </div>

            <div className="w-full max-w-6xl h-full flex flex-col z-10">
                <div className="flex-none mb-6">
                    <button onClick={() => { 
                        if(searchResult) { setSearchResult(null); setShowList(true); } 
                        else setView('home'); 
                    }} className="flex items-center gap-2 text-gray-400 hover:text-white transition px-4 py-2 rounded-lg hover:bg-white/5">
                        <ArrowLeft size={18}/> {searchResult ? "リストに戻る" : "ホームに戻る"}
                    </button>
                </div>

                {!searchResult ? (
                    <div className="flex flex-col items-center justify-center flex-1 py-10 animate-fade-in">
                        <div className="text-center mb-12">
                            <h2 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-blue-400 via-purple-400 to-pink-400 mb-4 tracking-tighter drop-shadow-2xl">
                                MANSUKE WEREWOLF ARCHIVES
                            </h2>
                            <p className="text-gray-500 font-mono tracking-widest text-sm">MANSUKE WEREWOLF HISTORY</p>
                        </div>
                        
                        <div className="w-full max-w-md space-y-6 bg-gray-900/80 backdrop-blur p-6 rounded-3xl border border-white/5 shadow-2xl">
                            {/* ID検索 */}
                            <div className="relative group">
                                <label className="text-xs text-gray-500 font-bold ml-1 mb-1 block">試合IDから検索</label>
                                <div className="relative flex">
                                    <input 
                                        type="text" 
                                        placeholder="試合ID (6桁)" 
                                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-5 py-4 text-white outline-none focus:border-blue-500 transition text-lg tracking-widest text-center placeholder-gray-700 shadow-inner"
                                        value={matchIdInput}
                                        onChange={(e) => setMatchIdInput(e.target.value)}
                                    />
                                    <button 
                                        onClick={() => handleSearch(matchIdInput)} 
                                        disabled={!matchIdInput || loading}
                                        className="absolute right-2 top-2 bottom-2 bg-blue-600 hover:bg-blue-500 text-white px-4 rounded-lg transition disabled:opacity-50 flex items-center justify-center shadow-lg"
                                    >
                                        <Search size={20}/>
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center gap-4 py-2">
                                <div className="h-px bg-gray-700 flex-1"></div>
                                <span className="text-xs text-gray-500 font-bold">OR</span>
                                <div className="h-px bg-gray-700 flex-1"></div>
                            </div>

                            {/* 日時検索 */}
                            <div className="space-y-3">
                                <label className="text-xs text-gray-500 font-bold ml-1 block">日時から検索</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                                        <input 
                                            type="date" 
                                            className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-purple-500 transition text-sm appearance-none"
                                            value={searchDate}
                                            onChange={(e) => setSearchDate(e.target.value)}
                                        />
                                    </div>
                                    <div className="relative w-1/3">
                                        <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                                        <select 
                                            className="w-full bg-gray-950 border border-gray-700 rounded-xl pl-9 pr-2 py-3 text-white outline-none focus:border-purple-500 transition text-sm appearance-none"
                                            value={searchTime}
                                            onChange={(e) => setSearchTime(e.target.value)}
                                        >
                                            <option value="">全日</option>
                                            {timeOptions}
                                        </select>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => handleSearch()} 
                                    disabled={!searchDate || loading}
                                    className="w-full bg-purple-900/50 border border-purple-500/50 hover:bg-purple-800/50 text-purple-200 py-3 rounded-xl font-bold transition flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    <Search size={16}/> 検索する
                                </button>
                            </div>
                            
                            {error && <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-xl text-red-400 text-center text-sm animate-pulse">{error}</div>}
                            
                            <div className="text-center pt-4 border-t border-gray-800">
                                <button onClick={handleFetchList} className="text-sm text-gray-500 hover:text-white transition flex items-center justify-center gap-2 mx-auto underline underline-offset-4 decoration-gray-700 hover:decoration-white">
                                    <Trophy size={14}/> 過去の試合をリスト表示する
                                </button>
                            </div>
                        </div>

                        {loading && <div className="mt-12"><Loader className="animate-spin text-blue-500" size={40}/></div>}

                        {showList && !loading && (
                            <div className="mt-12 w-full grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in-up max-w-4xl pb-20">
                                {matchList.length === 0 ? (
                                    <div className="col-span-2 text-center text-gray-500 py-10 bg-gray-900/50 rounded-2xl border border-gray-800">条件に一致するデータは見つかりませんでした</div>
                                ) : (
                                    matchList.map(m => (
                                        <div key={m.id} onClick={() => handleSearch(m.matchId)} className="bg-gray-900/60 backdrop-blur border border-gray-800 p-5 rounded-xl cursor-pointer hover:bg-gray-800 hover:border-blue-500/30 transition flex justify-between items-center group relative overflow-hidden">
                                            {m.status === 'aborted' && <div className="absolute top-0 right-0 bg-red-500/20 text-red-400 text-[10px] font-bold px-2 py-1 rounded-bl-lg">ABORTED</div>}
                                            <div>
                                                <div className="font-mono text-2xl font-black text-white group-hover:text-blue-400 transition tracking-widest">{m.matchId}</div>
                                                <div className="text-xs text-gray-500 flex items-center gap-1 mt-1 font-mono"><Clock size={12}/> {new Date(getMillis(m.createdAt)).toLocaleString()}</div>
                                            </div>
                                            <div className="text-right flex flex-col items-end">
                                                <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">WINNER</div>
                                                <div className={`font-black text-lg text-right ${m.status === 'aborted' ? "text-gray-500" : m.winner === 'citizen' ? "text-green-400" : m.winner === 'werewolf' ? "text-red-400" : m.winner === 'fox' ? "text-orange-400" : "text-gray-500"}`}>
                                                    {m.status === 'aborted' ? "強制終了" : m.winner === 'citizen' ? "市民陣営" : m.winner === 'werewolf' ? "人狼陣営" : m.winner === 'fox' ? "妖狐" : "引き分け"}
                                                    {m.teruteruWon && (
                                                        <div className="text-sm text-green-300 mt-1 flex items-center justify-end gap-1">
                                                            <span>+ てるてる坊主</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in h-[calc(100vh-100px)]">
                        <div className="lg:col-span-4 flex flex-col gap-4 overflow-hidden h-full">
                            <div className="bg-gray-900/80 backdrop-blur border border-gray-700 p-6 rounded-3xl shrink-0 shadow-xl">
                                <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-2">
                                    <span className="text-gray-500 text-xs font-bold tracking-widest uppercase">Match ID</span>
                                    <span className="text-gray-500 text-xs font-mono">{new Date(getMillis(searchResult.room.createdAt)).toLocaleString()}</span>
                                </div>
                                <div className="text-5xl font-mono font-black text-white mb-6 tracking-widest text-center">{searchResult.room.matchId}</div>
                                
                                {searchResult.room.status === 'aborted' ? (
                                    <div className="flex items-center justify-center gap-2 bg-red-900/20 py-3 rounded-xl border border-red-500/30">
                                        <AlertOctagon className="text-red-500" size={24}/>
                                        <span className="font-bold text-xl text-red-400">強制終了</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center gap-2 bg-gray-800/50 py-4 rounded-xl border border-gray-700">
                                        <div className="text-xs text-gray-400 font-bold uppercase tracking-widest">WINNER</div>
                                        <div className={`font-black text-2xl flex flex-col items-center gap-1 ${searchResult.room.winner === 'citizen' ? "text-green-400" : searchResult.room.winner === 'werewolf' ? "text-red-400" : searchResult.room.winner === 'fox' ? "text-orange-400" : "text-gray-500"}`}>
                                            <div className="flex items-center gap-2">
                                                <Trophy size={24} className={searchResult.room.winner === 'citizen' ? "text-green-500" : searchResult.room.winner === 'werewolf' ? "text-red-500" : searchResult.room.winner === 'fox' ? "text-orange-500" : "text-gray-500"}/>
                                                <span>{searchResult.room.winner === 'citizen' ? "市民陣営" : searchResult.room.winner === 'werewolf' ? "人狼陣営" : searchResult.room.winner === 'fox' ? "妖狐" : "引き分け"}</span>
                                            </div>
                                            {searchResult.room.teruteruWon && (
                                                <div className="text-lg text-green-300 flex items-center gap-1 mt-1 font-bold">
                                                    <span>+ てるてる坊主</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-h-0 overflow-hidden shadow-xl rounded-3xl">
                                <DeadPlayerInfoPanel players={searchResult.players} title="参加プレイヤーと役職" />
                            </div>
                        </div>

                        <div className="lg:col-span-8 flex flex-col gap-4 overflow-hidden h-full">
                            <div className="flex-1 bg-gray-900/80 backdrop-blur border border-gray-700 rounded-3xl overflow-hidden flex flex-col min-h-0 shadow-xl">
                                <div className="p-4 border-b border-gray-700 font-bold text-gray-300 flex items-center gap-2 bg-gray-800/50"><FileText size={18} className="text-blue-400"/> 詳細ログ</div>
                                <div className="flex-1 overflow-hidden">
                                    <LogPanel logs={searchResult.room.logs} showSecret={true} user={{uid:'all'}} />
                                </div>
                            </div>
                            
                            {/* 対面モード時は生存者チャットアーカイブを表示しない */}
                            {!searchResult.room.inPersonMode && (
                                <div className="flex-1 bg-gray-900/80 backdrop-blur border border-gray-700 rounded-3xl overflow-hidden flex flex-col min-h-0 shadow-xl">
                                    <div className="p-4 border-b border-gray-700 font-bold text-gray-300 flex items-center gap-2 bg-gray-800/50"><FileText size={18} className="text-green-400"/> 生存者チャットアーカイブ (昼のみ)</div>
                                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-black/20">
                                        {searchResult.chatMessages.map((msg, i) => (
                                            <div key={i} className="flex flex-col items-start bg-gray-800/40 p-3 rounded-xl border border-gray-700/50">
                                                <div className="flex items-baseline gap-2 mb-1">
                                                    <span className="text-xs font-bold text-blue-300">{msg.senderName}</span>
                                                    <span className="text-[10px] text-gray-500">{msg.day}日目</span>
                                                </div>
                                                <div className="text-sm text-gray-200 break-words w-full">{msg.text}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};