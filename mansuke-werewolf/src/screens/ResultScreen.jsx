import React, { useState, useEffect, useMemo } from 'react';
import { Sun, Moon, Loader, FileText, AlertOctagon, Trophy, Frown, RefreshCw, LogOut, Skull, Sparkles } from 'lucide-react';
import { getDoc, doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { ROLE_DEFINITIONS } from '../constants/gameData';
import { LogPanel } from '../components/game/LogPanel';
import { DeadPlayerInfoPanel } from '../components/game/DeadPlayerInfoPanel';
import { InfoModal } from '../components/ui/InfoModal';

export const ResultScreen = ({ room, players, setView, setRoomCode, roomCode, myPlayer, user }) => {
    // データ整合性チェック
    if (!room || !players || players.length === 0) {
        return (
            <div className="min-h-screen bg-black flex items-center justify-center text-white">
                <Loader className="animate-spin mb-4"/>
                <span className="ml-2 font-bold tracking-widest">Loading Results...</span>
            </div>
        );
    }

    const isAborted = room.status === 'aborted';
    const winner = room.winner;
    const isCitizenWin = winner === 'citizen';
    const isFoxWin = winner === 'fox';
    const isWerewolfWin = winner === 'werewolf';
    const logs = room.logs || [];
    
    const isHost = room.hostId === user?.uid;
    const roomId = room.id || roomCode || "";
    
    const [showDetail, setShowDetail] = useState(false);
    const [showRoleDetail, setShowRoleDetail] = useState(false);
    const [fullPlayers, setFullPlayers] = useState(players || []); // 初期値はマスクされた状態かもしれない
    const [myTrueRole, setMyTrueRole] = useState(null);
    const [dataLoaded, setDataLoaded] = useState(false);

    // ゲーム終了後は全員の役職情報が解禁されるため、サーバーから全情報を取得する
    useEffect(() => {
        const fetchRoles = async () => {
            if (!roomId) return;
            
            // 自分の正確な役職を確認
            if(user) {
                try {
                    const mySecretRef = doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomId, 'players', user.uid, 'secret', 'roleData');
                    const mySecret = await getDoc(mySecretRef);
                    if(mySecret.exists()) setMyTrueRole(mySecret.data().role);
                } catch(e) { console.error("Error fetching my secret:", e); }
            }

            // Functions経由で全プレイヤーの秘密情報（役職）を取得
            try {
                const fn = httpsCallable(functions, 'getAllPlayerRoles');
                const res = await fn({ roomCode: roomId });
                
                if (res.data && res.data.players) {
                    setFullPlayers(res.data.players);
                } else {
                    setFullPlayers(players);
                }
            } catch (e) {
                console.error("Error fetching all roles via function:", e);
                setFullPlayers(players);
            } finally {
                setDataLoaded(true);
            }
        };
        
        if(room.status === 'finished' || room.status === 'aborted') {
            fetchRoles();
        }
    }, [room, players, roomId, user]);

    // 勝者の抽出ロジック（メモ化してパフォーマンス最適化）
    const winningPlayers = useMemo(() => {
        if (!dataLoaded || isAborted) return [];

        return fullPlayers.filter(p => {
            const role = p.role;
            if (!role) return false;

            if (isFoxWin) return role === 'fox';
            if (isWerewolfWin) return ['werewolf', 'greatwolf', 'madman'].includes(role);
            if (isCitizenWin) return !['werewolf', 'greatwolf', 'madman', 'fox'].includes(role);

            return false;
        });
    }, [fullPlayers, dataLoaded, isAborted, isFoxWin, isWerewolfWin, isCitizenWin]);

    // 個人の勝敗（You Win / You Lose）判定
    let personalResult = null; 
    if (isAborted) {
        personalResult = 'draw';
    } else if (myTrueRole) {
        const myRoleKey = myTrueRole;
        const isMySideWolf = ['werewolf', 'greatwolf', 'madman'].includes(myRoleKey);
        const isMySideFox = myRoleKey === 'fox';
        
        if (isCitizenWin && !isMySideWolf && !isMySideFox) personalResult = 'win';
        else if (isWerewolfWin && isMySideWolf) personalResult = 'win';
        else if (isFoxWin && isMySideFox) personalResult = 'win';
        else personalResult = 'lose';
    }

    // 再戦処理（部屋をロビー状態に戻す）
    const handleReplay = async () => {
        if(!isHost) return;
        try {
            const fn = httpsCallable(functions, 'resetToLobby');
            await fn({ roomCode: roomId });
        } catch(e) {
            console.error(e);
            alert("エラーが発生しました: " + e.message);
        }
    };

    // 解散処理
    const handleCloseRoom = async () => {
        if(!isHost) return;
        if(confirm("本当に部屋を解散しますか？")) {
            try {
                await updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomId), { status: 'closed' });
            } catch(e) { console.error(e); }
        }
    };

    if(showDetail) return <div className="fixed inset-0 bg-gray-950 flex flex-col z-[100] p-6">
        {showRoleDetail && <InfoModal title="全プレイヤー役職" onClose={() => setShowRoleDetail(false)}><DeadPlayerInfoPanel players={fullPlayers} title="最終結果" /></InfoModal>}
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
            <div className="max-w-6xl w-full text-center space-y-8 animate-fade-in-up pb-20">
                {isAborted ? (
                    <div className="inline-block p-4 rounded-full bg-red-900/50 mb-4 animate-pulse"><AlertOctagon size={64} className="text-red-500"/></div>
                ) : (
                    <div className="inline-block p-4 rounded-full bg-gray-800/50 mb-4">
                        {isCitizenWin ? <Sun size={64} className="text-yellow-400"/> : isFoxWin ? <Sparkles size={64} className="text-orange-500 animate-pulse"/> : <Moon size={64} className="text-red-500"/>}
                    </div>
                )}
                
                <h1 className={`text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r ${isAborted ? "from-gray-400 to-gray-600" : isCitizenWin ? "from-yellow-400 to-orange-500" : isFoxWin ? "from-orange-400 to-pink-500" : "from-red-500 to-purple-600"}`}>
                    {isAborted ? "NO CONTEST" : isCitizenWin ? "CITIZEN WIN" : isFoxWin ? "FOX WIN" : "WEREWOLF WIN"}
                </h1>
                
                <p className="text-2xl text-white font-bold tracking-widest">{isAborted ? "ホストにより強制終了されました" : isCitizenWin ? "市民陣営の勝利" : isFoxWin ? "妖狐の単独勝利" : "人狼陣営の勝利"}</p>
                
                <style>{`
                    @keyframes shine-gold {
                        0% { background-position: 0% 50%; }
                        50% { background-position: 100% 50%; }
                        100% { background-position: 0% 50%; }
                    }
                    @keyframes pulse-border {
                        0% { border-color: rgba(253, 224, 71, 0.5); box-shadow: 0 0 20px rgba(234, 179, 8, 0.3); }
                        50% { border-color: rgba(253, 224, 71, 1); box-shadow: 0 0 40px rgba(234, 179, 8, 0.6); }
                        100% { border-color: rgba(253, 224, 71, 0.5); box-shadow: 0 0 20px rgba(234, 179, 8, 0.3); }
                    }
                `}</style>

                {!isAborted && personalResult && (
                    <div 
                        className={`relative inline-flex flex-col items-center justify-center gap-3 px-6 py-4 rounded-xl transition-all duration-500 transform hover:scale-105 group overflow-hidden min-w-[160px] mx-auto ${
                            personalResult === 'win' 
                            ? "text-white" 
                            : "text-gray-300 border border-gray-700 bg-gradient-to-br from-gray-900 to-gray-800 shadow-xl"
                        }`}
                        style={personalResult === 'win' ? {
                            background: 'linear-gradient(135deg, #854d0e 0%, #ca8a04 25%, #facc15 50%, #ca8a04 75%, #854d0e 100%)',
                            backgroundSize: '200% 200%',
                            animation: 'shine-gold 4s ease infinite, pulse-border 2s infinite',
                            borderWidth: '1px',
                            borderStyle: 'solid'
                        } : {}}
                    >
                        {personalResult === 'win' && (
                            <>
                                <div className="absolute inset-0 bg-white/10 opacity-30 mix-blend-overlay"></div>
                                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-white/20 pointer-events-none"></div>
                            </>
                        )}

                        <div className="relative z-10 flex flex-col items-center gap-3 text-center">
                            {personalResult === 'win' ? (
                                <div className="bg-yellow-100/20 p-3 rounded-full backdrop-blur-sm shadow-inner border border-yellow-200/30">
                                    <Trophy size={36} className="text-yellow-100 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />
                                </div>
                            ) : (
                                <div className="bg-black/20 p-3 rounded-full backdrop-blur-sm shadow-inner border border-gray-600/30">
                                    <Frown size={36} className="text-gray-400 drop-shadow-md" />
                                </div>
                            )}
                            
                            <div className="flex flex-col items-center">
                                <span className={`text-xs font-bold uppercase tracking-[0.2em] mb-2 leading-none ${personalResult==='win' ? "text-yellow-200" : "text-gray-500"}`}>
                                    RESULT
                                </span>
                                <span className={`text-xl md:text-2xl font-black tracking-wider leading-tight drop-shadow-lg whitespace-nowrap ${
                                    personalResult === 'win' 
                                        ? "text-white" 
                                        : "text-gray-400"
                                }`}>
                                    {personalResult === 'win' ? "あなたの陣営の勝利です！" : "あなたの陣営の敗北です..."}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {!isAborted && (
                    <div className="flex flex-col items-center mt-8 w-full">
                          <p className="text-gray-400 text-sm mb-4 uppercase tracking-widest font-bold flex items-center gap-2">
                              <Trophy size={16} className="text-yellow-500"/> WINNERS
                          </p>
                          
                          {!dataLoaded ? (
                              <div className="flex items-center gap-2 text-gray-500 animate-pulse">
                                  <Loader size={16} className="animate-spin"/>
                                  <span>勝者を判定中...</span>
                              </div>
                          ) : winningPlayers.length === 0 ? (
                              <p className="text-gray-500">勝者なし</p>
                          ) : (
                              <div className="flex flex-wrap justify-center gap-4 w-full">
                                  {winningPlayers.map(p => {
                                      const def = p.role && ROLE_DEFINITIONS[p.role];
                                      const roleName = def ? def.name : "不明";
                                      const Icon = def ? def.icon : Sun;
                                      
                                      return (
                                          <div key={p.id} className={`w-40 p-4 rounded-2xl border-2 flex flex-col items-center justify-center shadow-2xl transition hover:scale-105 ${p.status === 'dead' ? 'bg-gray-900/50 border-gray-700 opacity-70 grayscale' : 'bg-gradient-to-b from-gray-800 to-gray-900 border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.3)]'}`}>
                                              <div className="mb-2 p-2 rounded-full bg-white/5">
                                                  <Icon size={32} className={p.status === 'dead' ? "text-gray-500" : "text-yellow-400"}/>
                                              </div>
                                              <div className="font-bold text-white truncate w-full text-center flex items-center justify-center gap-1 text-sm mb-1">
                                                  {p.status === 'dead' && <Skull size={12} className="text-gray-500"/>}
                                                  {p.name}
                                              </div>
                                              <div className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 text-gray-300">
                                                  {roleName}
                                              </div>
                                              {p.status === 'dead' && <div className="text-[10px] text-red-500 mt-1 font-bold">DEAD</div>}
                                          </div>
                                      );
                                  })}
                              </div>
                          )}
                    </div>
                )}

                <div className="pt-8 flex flex-col items-center gap-4 w-full max-w-md mx-auto">
                      <button onClick={() => setShowDetail(true)} className="w-full px-8 py-4 bg-gray-800 text-white font-bold rounded-full hover:bg-gray-700 transition flex items-center justify-center gap-2"><FileText size={20}/> 詳細ログを確認</button>
                      
                      {isHost ? (
                          <>
                              <div className="w-full h-px bg-gray-800 my-2"></div>
                              <button onClick={handleReplay} className="w-full px-8 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-full hover:scale-105 transition shadow-lg flex items-center justify-center gap-2">
                                  <RefreshCw size={20}/> 同じ部屋・設定で再度プレイ
                              </button>
                              <button onClick={handleCloseRoom} className="w-full px-8 py-3 text-red-400 border border-red-900/50 rounded-full hover:bg-red-900/20 transition flex items-center justify-center gap-2">
                                  <LogOut size={18}/> 部屋を解散する
                              </button>
                          </>
                      ) : (
                          <div className="mt-4 p-4 bg-black/40 rounded-xl border border-gray-800 flex items-center justify-center gap-3 text-gray-400 animate-pulse">
                              <Loader size={18} className="animate-spin"/>
                              <span>ホストの操作を待っています...</span>
                          </div>
                      )}
                </div>
            </div>
        </div>
    );
};