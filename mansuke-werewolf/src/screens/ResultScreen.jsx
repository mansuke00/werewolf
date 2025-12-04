import React, { useState, useEffect, useMemo } from 'react';
import { Sun, Moon, Loader, FileText, AlertOctagon, Trophy, Frown, RefreshCw, LogOut, Skull, Sparkles, Smile, Copy, Search, X } from 'lucide-react';
import { getDoc, doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase'; // ローカル環境の構成に基づいたパス
import { ROLE_DEFINITIONS } from '../constants/gameData';
import { LogPanel } from '../components/game/LogPanel';
import { DeadPlayerInfoPanel } from '../components/game/DeadPlayerInfoPanel';
import { InfoModal } from '../components/ui/InfoModal';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';
import { Notification } from '../components/ui/Notification';

export const ResultScreen = ({ room, players, setView, setRoomCode, roomCode, myPlayer, user, maintenanceMode, setNotification }) => {
    if (!room || !players || players.length === 0) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center text-white">
                <Loader className="animate-spin mb-4"/>
                <span className="ml-2 font-bold tracking-widest">Loading Results...</span>
            </div>
        );
    }

    const isAborted = room.status === 'aborted';
    // 解散された場合、App.jsxで検知してホームに戻るはずだが、念のためここでもチェック
    const isClosed = room.status === 'closed';

    const winner = room.winner;
    const isCitizenWin = winner === 'citizen';
    const isFoxWin = winner === 'fox';
    const isWerewolfWin = winner === 'werewolf';
    // サーバー側で判定されたてるてる坊主勝利フラグ
    const isTeruteruWin = room.teruteruWon === true;
    
    const logs = room.logs || [];
    
    const isHost = room.hostId === user?.uid;
    const roomId = room.id || roomCode || "";
    const matchId = room.matchId || "---"; // 試合ID
    
    const [showDetail, setShowDetail] = useState(false);
    const [showRoleDetail, setShowRoleDetail] = useState(false);
    const [fullPlayers, setFullPlayers] = useState(players || []); 
    const [myTrueRole, setMyTrueRole] = useState(null);
    const [dataLoaded, setDataLoaded] = useState(false);
    const [loading, setLoading] = useState(false); // ボタン操作用ローディング
    
    // 試合IDの表示管理
    const [showMatchId, setShowMatchId] = useState(true);
    // モーダル管理
    const [modalConfig, setModalConfig] = useState(null);

    // 部屋が解散されたらホームへ戻る
    useEffect(() => {
        if (isClosed) {
            setView('home');
            setRoomCode("");
        }
    }, [isClosed, setView, setRoomCode]);

    useEffect(() => {
        const fetchRoles = async () => {
            if (!roomId) return;
            
            if(user && !myPlayer?.isSpectator) {
                try {
                    const mySecretRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomId, 'players', user.uid, 'secret', 'roleData');
                    const mySecret = await getDoc(mySecretRef);
                    if(mySecret.exists()) setMyTrueRole(mySecret.data().role);
                } catch(e) { console.error("Error fetching my secret:", e); }
            } else if (myPlayer?.isSpectator) {
                // 観戦者の場合は役職を「観戦者」とする
                setMyTrueRole('spectator');
            }

            try {
                const fn = httpsCallable(functions, 'getAllPlayerRoles');
                const res = await fn({ roomCode: roomId });
                if (res.data && res.data.players) {
                    // 観戦者情報を補正してセット
                    const processedPlayers = res.data.players.map(p => {
                        if (p.isSpectator) return { ...p, role: 'spectator' };
                        return p;
                    });
                    setFullPlayers(processedPlayers);
                } else {
                    setFullPlayers(players);
                }
            } catch (e) {
                setFullPlayers(players);
            } finally {
                setDataLoaded(true);
            }
        };
        
        if(room.status === 'finished' || room.status === 'aborted') {
            fetchRoles();
        }
    }, [room, players, roomId, user, myPlayer]);

    const winningPlayers = useMemo(() => {
        if (!dataLoaded || isAborted) return [];

        return fullPlayers.filter(p => {
            const role = p.role;
            if (!role || role === 'spectator') return false; // 観戦者は除外

            // 通常の勝利判定
            if (isFoxWin) { if(role === 'fox') return true; }
            else if (isWerewolfWin) { if(['werewolf', 'greatwolf', 'madman'].includes(role)) return true; }
            else if (isCitizenWin) { if(!['werewolf', 'greatwolf', 'madman', 'fox', 'teruteru'].includes(role)) return true; }

            // てるてる坊主の追加勝利判定（全員処刑されていたら勝利）
            if (role === 'teruteru' && isTeruteruWin) {
                return true;
            }

            return false;
        });
    }, [fullPlayers, dataLoaded, isAborted, isFoxWin, isWerewolfWin, isCitizenWin, isTeruteruWin]);

    let personalResult = null; 
    if (myPlayer?.isSpectator) {
        personalResult = null; // 観戦者は勝ち負けなし
    } else if (isAborted) {
        personalResult = 'draw';
    } else if (myTrueRole) {
        const myRoleKey = myTrueRole;
        const isMySideWolf = ['werewolf', 'greatwolf', 'madman'].includes(myRoleKey);
        const isMySideFox = myRoleKey === 'fox';
        const isTeruteru = myRoleKey === 'teruteru';
        
        if (isTeruteru) {
            // てるてる坊主は、teruteruWonがtrueなら勝利（追加勝利）
            personalResult = isTeruteruWin ? 'win' : 'lose';
        } else {
            if (isCitizenWin && !isMySideWolf && !isMySideFox) personalResult = 'win';
            else if (isWerewolfWin && isMySideWolf) personalResult = 'win';
            else if (isFoxWin && isMySideFox) personalResult = 'win';
            else personalResult = 'lose';
        }
    }

    // 表示テキスト決定ロジック
    let mainTitle = "";
    let titleGradient = "";
    
    if (isAborted) {
        mainTitle = "NO CONTEST";
        titleGradient = "from-gray-400 to-gray-600";
    } else if (myPlayer?.isSpectator) {
        // 観戦者の場合
        if (isCitizenWin) { titleGradient = "from-yellow-400 to-orange-500"; }
        else if (isFoxWin) { titleGradient = "from-orange-400 to-pink-500"; }
        else { titleGradient = "from-red-500 to-purple-600"; }
        mainTitle = "GAME SET"; // 指示通り観戦者はGAME SETに変更
    } else {
        // プレイヤーの場合
        if (personalResult === 'win') {
            mainTitle = "YOU WIN!!!";
            titleGradient = "from-yellow-300 via-yellow-500 to-orange-500";
        } else if (personalResult === 'lose') {
            mainTitle = "YOU LOSE…";
            titleGradient = "from-gray-400 to-slate-500";
        } else {
            mainTitle = "DRAW";
            titleGradient = "from-gray-400 to-gray-600";
        }
    }

    let resultDescription = "";
    if (isAborted) {
        resultDescription = "ホストにより強制終了されました";
    } else {
        if (isTeruteruWin) {
            // てるてる勝利時の特別テキスト
            if (isCitizenWin) resultDescription = "市民陣営＋てるてる坊主の勝ち";
            else if (isWerewolfWin) resultDescription = "人狼陣営＋てるてる坊主の勝ち";
            else if (isFoxWin) resultDescription = "妖狐＋てるてる坊主の勝ち";
            else resultDescription = "てるてる坊主の勝ち"; // 万が一の場合
        } else {
            // 通常時のテキスト
            if (isCitizenWin) resultDescription = "市民陣営の勝利";
            else if (isFoxWin) resultDescription = "妖狐の単独勝利";
            else resultDescription = "人狼陣営の勝利";
        }
    }

    // もう一度遊ぶ（ホスト操作）
    const handleReplay = async () => {
        if (maintenanceMode) {
            setView('home'); // メンテナンスモード画面（ホーム）へ強制遷移
            return;
        }
        if(!isHost || loading) return;
        setLoading(true); // ローディング開始
        try {
            const fn = httpsCallable(functions, 'resetToLobby');
            await fn({ roomCode: roomId });
            // 成功後はApp.jsxが部屋ステータス(waiting)を検知して遷移させるのを待つ
        } catch(e) {
            setNotification({ message: "エラーが発生しました: " + e.message, type: "error" });
            setLoading(false); // 失敗時はローディング解除
        }
    };

    // 部屋を解散する（ホスト操作）
    const confirmCloseRoom = () => {
        if (maintenanceMode) {
            setView('home');
            return;
        }
        if(!isHost || loading) return;
        
        setModalConfig({
            title: "部屋の解散",
            message: "本当に部屋を解散しますか？\n全てのデータはリセットされ、参加者はホームに戻ります。",
            isDanger: true,
            confirmText: "解散する",
            onConfirm: async () => {
                setModalConfig(null);
                setLoading(true); // ローディング開始
                try {
                    // updateDocではなく、Cloud FunctionsのdeleteRoomを使って確実に削除する
                    const fn = httpsCallable(functions, 'deleteRoom');
                    await fn({ roomCode: roomId });
                    // 削除成功後はApp.jsxが検知して遷移させる
                } catch(e) { 
                    console.error(e);
                    setNotification({ message: "解散に失敗しました: " + e.message, type: "error" });
                    setLoading(false);
                }
            },
            onCancel: () => setModalConfig(null)
        });
    };
    
    // ホームに戻る（自分だけ）
    const handleExit = () => {
        setRoomCode("");
        setView('home');
    };

    const copyMatchId = () => {
        navigator.clipboard.writeText(matchId);
        // 簡易的なフィードバック
        const el = document.getElementById("copy-feedback");
        if(el) {
            el.classList.remove("opacity-0");
            setTimeout(() => el.classList.add("opacity-0"), 2000);
        }
    };

    if(showDetail) return <div className="fixed inset-0 bg-gray-950 flex flex-col z-[100] p-6">
        {showRoleDetail && <InfoModal title="全プレイヤー役職" onClose={() => setShowRoleDetail(false)}><DeadPlayerInfoPanel players={fullPlayers} title="プレイヤーの役職" /></InfoModal>}
        <div className="max-w-6xl w-full mx-auto h-full flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0">
                <div className="flex items-center gap-4">
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2"><FileText className="text-blue-400"/> 詳細ログ</h2>
                    <button onClick={() => setShowRoleDetail(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm hover:bg-blue-500 transition">全プレイヤーの役職を確認</button>
                </div>
                <button onClick={() => setShowDetail(false)} className="px-4 py-2 bg-gray-800 text-white rounded-xl hover:bg-gray-700">戻る</button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0"><LogPanel logs={logs} showSecret={true} user={{uid: 'all'}} /></div>
        </div>
    </div>;

    return (
        <div className="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center z-50 p-6 overflow-y-auto z-[100]">
            {modalConfig && <ConfirmationModal {...modalConfig} />}
            {/* 通知コンポーネントを削除しました（App.jsx側で表示されるため） */}
            
            <div className="max-w-6xl w-full text-center space-y-8 animate-fade-in-up pb-20 pt-10">
                
                {/* 勝利アイコン表示エリア */}
                {isAborted ? (
                    <div className="inline-block p-4 rounded-full bg-red-900/50 mb-4 animate-pulse"><AlertOctagon size={64} className="text-red-500"/></div>
                ) : (
                    <div className="inline-block p-4 rounded-full bg-gray-800/50 mb-4 relative">
                        {isCitizenWin ? <Sun size={64} className="text-yellow-400"/> : isFoxWin ? <Sparkles size={64} className="text-orange-500 animate-pulse"/> : <Moon size={64} className="text-red-500"/>}
                        {isTeruteruWin && <Smile size={32} className="text-green-400 absolute -bottom-2 -right-2 bg-gray-900 rounded-full border border-green-500/50 animate-bounce"/>}
                    </div>
                )}
                
                {/* メインタイトル */}
                <h1 className={`text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r ${titleGradient} drop-shadow-2xl`}>
                    {mainTitle}
                </h1>
                
                {/* 詳細説明 */}
                <div className="flex flex-col items-center justify-center gap-2">
                    <p className="text-2xl text-white font-bold tracking-widest">{resultDescription}</p>
                </div>
                
                <style>{`
                    @keyframes shine-gold { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
                    @keyframes pulse-border { 0% { border-color: rgba(253, 224, 71, 0.5); box-shadow: 0 0 20px rgba(234, 179, 8, 0.3); } 50% { border-color: rgba(253, 224, 71, 1); box-shadow: 0 0 40px rgba(234, 179, 8, 0.6); } 100% { border-color: rgba(253, 224, 71, 0.5); box-shadow: 0 0 20px rgba(234, 179, 8, 0.3); } }
                `}</style>

                {/* 試合IDカード (画面右下に固定表示) */}
                {showMatchId && (
                    <div className="fixed bottom-4 right-4 z-[200] max-w-sm w-full animate-fade-in-up">
                        <div className="bg-gray-900/90 border border-indigo-500/30 rounded-2xl p-4 shadow-[0_0_20px_rgba(99,102,241,0.2)] backdrop-blur-md relative hover:border-indigo-500/50 transition">
                            <button onClick={() => setShowMatchId(false)} className="absolute top-2 right-2 text-gray-500 hover:text-white transition"><X size={16}/></button>
                            
                            <div className="flex flex-col items-start gap-2">
                                <div className="flex items-center gap-2">
                                    <div className="bg-indigo-600/20 p-1.5 rounded-lg"><Search size={14} className="text-indigo-400"/></div>
                                    <span className="text-xs font-bold text-indigo-300">この試合の試合IDは以下の通りです</span>
                                </div>

                                <button 
                                    onClick={copyMatchId}
                                    className="w-full relative flex items-center justify-between bg-black/40 px-3 py-2 rounded-xl border border-white/10 hover:bg-black/60 hover:border-indigo-400/50 transition group"
                                >
                                    <span className="text-xl font-mono font-black text-white tracking-widest group-hover:text-indigo-200">{matchId}</span>
                                    <div className="flex items-center gap-1 text-[10px] text-gray-500 group-hover:text-white transition">
                                        <Copy size={12}/> COPY
                                    </div>
                                    <div id="copy-feedback" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow opacity-0 transition-opacity pointer-events-none whitespace-nowrap">Copied!</div>
                                </button>

                                <p className="text-xs md:text-sm text-gray-500 leading-tight mt-1">
                                    ホーム画面で検索すると、詳細ログをいつでも確認できます。
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* 勝利プレイヤー一覧 */}
                {!isAborted && (
                    <div className="flex flex-col items-center mt-8 w-full">
                          <p className="text-gray-400 text-sm mb-4 uppercase tracking-widest font-bold flex items-center gap-2"><Trophy size={16} className="text-yellow-500"/> WINNERS</p>
                          {!dataLoaded ? (
                              <div className="flex items-center gap-2 text-gray-500 animate-pulse"><Loader size={16} className="animate-spin"/><span>勝者を判定中...</span></div>
                          ) : winningPlayers.length === 0 ? (
                              <p className="text-gray-500">勝者なし</p>
                          ) : (
                              <div className="flex flex-wrap justify-center gap-4 w-full">
                                  {winningPlayers.map(p => {
                                      const def = p.role && ROLE_DEFINITIONS[p.role];
                                      const roleName = def ? def.name : "不明";
                                      const Icon = def ? def.icon : Sun;
                                      return (
                                          <div key={p.id} className={`w-40 p-4 rounded-2xl border-2 flex flex-col items-center justify-center shadow-2xl transition hover:scale-105 relative ${p.status === 'dead' ? 'bg-gray-900/50 border-gray-700 opacity-70 grayscale' : 'bg-gradient-to-b from-gray-800 to-gray-900 border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.3)]'}`}>
                                              <div className="mb-2 p-2 rounded-full bg-white/5"><Icon size={32} className={p.status === 'dead' ? "text-gray-500" : "text-yellow-400"}/></div>
                                              <div className="font-bold text-white truncate w-full text-center flex items-center justify-center gap-1 text-sm mb-1">{p.name}</div>
                                              <div className="flex items-center gap-1">
                                                  <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-gray-300">{roleName}</div>
                                                  {p.status === 'dead' && <span className="text-[9px] text-red-400 font-bold border border-red-900/50 px-1.5 py-0.5 rounded bg-red-950/30">DEAD</span>}
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                          )}
                    </div>
                )}

                {/* アクションボタン */}
                <div className="pt-8 flex flex-col items-center gap-4 w-full max-w-md mx-auto">
                      <button onClick={() => setShowDetail(true)} className="w-full px-8 py-4 bg-gray-800 text-white font-bold rounded-full hover:bg-gray-700 transition flex items-center justify-center gap-2"><FileText size={20}/> 詳細ログを確認</button>
                      {isHost ? (
                          <>
                              <div className="w-full h-px bg-gray-800 my-2"></div>
                              <button 
                                  onClick={handleReplay} 
                                  disabled={loading}
                                  className="w-full px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-full hover:scale-105 transition shadow-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                  {loading ? <Loader className="animate-spin" size={20}/> : <RefreshCw size={20}/>}
                                  同じ部屋・設定で再度プレイ
                              </button>
                              <button 
                                  onClick={confirmCloseRoom} 
                                  disabled={loading}
                                  className="w-full px-8 py-3 text-red-400 border border-red-900/50 rounded-full hover:bg-red-900/20 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                  {loading ? <Loader className="animate-spin" size={18}/> : <LogOut size={18}/>}
                                  部屋を解散する
                              </button>
                          </>
                      ) : (
                          <div className="mt-4 p-4 bg-black/40 rounded-xl border border-gray-800 flex items-center justify-center gap-3 text-gray-400 animate-pulse">
                              <Loader size={18} className="animate-spin"/>
                              <span>ホストの操作を待っています...</span>
                          </div>
                      )}
                      
                      {!isHost && (
                          <button onClick={handleExit} className="w-full px-8 py-3 bg-gray-900 text-gray-400 font-bold rounded-full hover:bg-gray-800 border border-gray-700 transition flex items-center justify-center gap-2 mt-2">
                              <LogOut size={18}/> ホームに戻る
                          </button>
                      )}
                </div>
            </div>
        </div>
    );
};