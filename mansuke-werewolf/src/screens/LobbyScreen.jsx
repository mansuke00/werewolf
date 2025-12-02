import React, { useState, useMemo, useEffect } from 'react';
import { Users, Crown, Settings, Mic, Play, Loader, Info, AlertTriangle, LogOut, Trash2 } from 'lucide-react';
import { updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import { isPlayerOnline } from '../utils/helpers';
import { ROLE_DEFINITIONS } from '../constants/gameData';
import { RoleCounter } from '../components/game/RoleCounter';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';

export const LobbyScreen = ({ user, room, roomCode, players, setNotification, setView, setRoomCode }) => {
      if (!room) return (
        <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-6 font-sans relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900 via-black to-black opacity-80"></div>
            <div className="relative z-10 flex flex-col items-center animate-fade-in-up">
                <Loader className="animate-spin text-blue-500 mb-6" size={48}/>
                <h3 className="text-2xl font-bold tracking-widest mb-2">CONNECTING</h3>
                <p className="text-gray-500 text-sm font-mono">部屋情報を同期しています...</p>
            </div>
        </div>
      );
      
      const isHostUser = room.hostId === user?.uid;
      const [roleSettings, setRoleSettings] = useState(room.roleSettings || {});
      const [anonymousVoting, setAnonymousVoting] = useState(room.anonymousVoting !== undefined ? room.anonymousVoting : true);
      const [inPersonMode, setInPersonMode] = useState(room.inPersonMode !== undefined ? room.inPersonMode : false);
      const [loading, setLoading] = useState(false);
      
      // モーダル管理用State
      const [modalConfig, setModalConfig] = useState(null);

      useEffect(() => {
          if (room) {
              setRoleSettings(room.roleSettings || {});
              setAnonymousVoting(room.anonymousVoting !== undefined ? room.anonymousVoting : true);
              setInPersonMode(room.inPersonMode !== undefined ? room.inPersonMode : false);
          }
      }, [room]);

      const validPlayers = useMemo(() => players.filter(p => !p.isSpectator), [players]);
      const validPlayerCount = validPlayers.length;
      
      const totalAssigned = Object.values(roleSettings).reduce((a,b) => a+b, 0);

      const validationError = useMemo(() => {
          if (validPlayerCount < 4) return "開始には最低4人のプレイヤーが必要です";
          if (totalAssigned !== validPlayerCount) return "配役の合計が人数と一致していません";
          
          let wolfCount = 0;
          let humanCount = 0;
          Object.entries(roleSettings).forEach(([r, c]) => { 
              if (['werewolf', 'greatwolf'].includes(r)) wolfCount += c;
              else humanCount += c;
          });
          
          if (wolfCount === 0) return "人狼がいません";
          if (wolfCount >= humanCount) return "人狼が過半数を占めているため、開始できません";
          
          return null;
      }, [validPlayerCount, totalAssigned, roleSettings]);

      const handleStartGame = async () => { 
          if(validationError) return setNotification({ message: validationError, type: "error" });
          setLoading(true); 
          try { 
              await updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { roleSettings, anonymousVoting, inPersonMode }); 
              const fn = httpsCallable(functions, 'startGame'); 
              await fn({ roomCode }); 
          } catch(e){ setNotification({ message: e.message || "開始エラー", type: "error" }); } 
          finally { setLoading(false); } 
      };

      const confirmForceClose = () => {
          setModalConfig({
              title: "部屋の解散",
              message: "本当にこの部屋を解散しますか？\n参加中のプレイヤーは全員ホームに戻されます。",
              isDanger: true,
              onConfirm: async () => {
                  setModalConfig(null);
                  await updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { status: 'closed' });
              },
              onCancel: () => setModalConfig(null)
          });
      };

      const confirmLeaveRoom = () => {
          setModalConfig({
              title: "部屋からの退出",
              message: "本当に退出しますか？",
              isDanger: false,
              onConfirm: async () => {
                  setModalConfig(null);
                  try {
                      await deleteDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', user.uid));
                      setView('home');
                      setRoomCode("");
                      setNotification({ message: "退出しました", type: "success" });
                  } catch(e) {
                      setNotification({ message: "退出エラー: " + e.message, type: "error" });
                  }
              },
              onCancel: () => setModalConfig(null)
          });
      };

      const confirmKickPlayer = (playerId, playerName) => {
          setModalConfig({
              title: "プレイヤーの追放",
              message: `${playerName} さんを部屋から追放しますか？`,
              isDanger: true,
              confirmText: "追放する",
              onConfirm: async () => {
                  setModalConfig(null);
                  try {
                      await deleteDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode, 'players', playerId));
                      setNotification({ message: `${playerName} さんを退出させました`, type: "success" });
                  } catch(e) {
                      setNotification({ message: "操作エラー: " + e.message, type: "error" });
                  }
              },
              onCancel: () => setModalConfig(null)
          });
      };

      const handleUpdateSettings = (newSettings) => {
          setRoleSettings(newSettings);
          if (isHostUser) updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { roleSettings: newSettings });
      };
      
      const handleUpdateAnonymous = (val) => {
          setAnonymousVoting(val);
          if (isHostUser) updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { anonymousVoting: val });
      };

      const handleUpdateInPersonMode = (val) => {
          setInPersonMode(val);
          if (isHostUser) updateDoc(doc(db, 'artifacts', 'mansuke-jinro', 'public', 'data', 'rooms', roomCode), { inPersonMode: val });
      };

      if (loading) return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white relative">
            <div className="absolute inset-0 bg-blue-900/10 animate-pulse"></div>
            <Loader className="animate-spin text-white mb-6 relative z-10" size={64}/>
            <p className="text-xl font-bold tracking-widest relative z-10">GAME STARTING...</p>
            <p className="text-xs text-gray-400 mt-2 relative z-10">ゲームを開始しています</p>
        </div>
      );

      return (
          <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-20 relative overflow-hidden">
              {modalConfig && <ConfirmationModal {...modalConfig} />}
              <div className="fixed top-0 left-0 w-full h-full z-0 pointer-events-none"><div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-900/10 rounded-full blur-[120px]"></div><div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-900/10 rounded-full blur-[120px]"></div></div>
              <div className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
                  <div className="lg:col-span-4 space-y-6">
                      <div className="bg-gray-900/60 backdrop-blur-xl rounded-[2rem] p-8 shadow-2xl border border-gray-700/50 relative overflow-hidden">
                          <p className="text-gray-400 text-xs font-bold tracking-widest mb-2 uppercase">Room Code</p>
                          <div className="flex items-center gap-4 mb-4"><span className="text-6xl font-black text-white tracking-widest cursor-pointer" onClick={() => navigator.clipboard.writeText(roomCode)}>{roomCode}</span></div>
                          <span className={`px-4 py-2 rounded-xl text-xs font-bold border ${totalAssigned === validPlayerCount ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"}`}>参加者: {validPlayerCount}名 / 配役: {totalAssigned}名</span>
                      </div>
                      <div className="bg-gray-900/60 backdrop-blur-xl rounded-[2rem] p-8 shadow-2xl border border-gray-700/50 h-[600px] flex flex-col">
                          <h3 className="text-xl font-bold mb-6 flex items-center gap-3 text-gray-200"><Users className="text-blue-400"/> 参加者一覧</h3>
                          <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                              {players.map(p => (
                                  <div key={p.id} className="flex items-center justify-between bg-gray-800/40 p-4 rounded-2xl border border-gray-700/30 group">
                                      <div className="flex items-center gap-3">
                                          <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px_currentColor] ${isPlayerOnline(p) ? "bg-green-500 text-green-500" : "bg-red-500 text-red-500"}`}></div>
                                          <span className={`font-bold ${isPlayerOnline(p) ? "text-gray-200" : "text-gray-500"}`}>{p.name}</span>
                                          {p.isSpectator && <span className="text-[10px] bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30">観戦</span>}
                                      </div>
                                      <div className="flex items-center gap-2">
                                          {room.hostId === p.id && <Crown size={14} className="text-yellow-500"/>}
                                          {isHostUser && room.hostId !== p.id && (
                                              <button 
                                                  onClick={() => confirmKickPlayer(p.id, p.name)}
                                                  className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition"
                                                  title="強制退出させる"
                                              >
                                                  <Trash2 size={16}/>
                                              </button>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>
                  
                  <div className="lg:col-span-8 space-y-6">
                      <div className="flex justify-end">
                          {isHostUser ? (
                              <button onClick={confirmForceClose} className="bg-red-900/50 text-red-300 border border-red-500/50 px-4 py-2 rounded-xl text-sm hover:bg-red-800 transition">強制終了</button>
                          ) : (
                              <button onClick={confirmLeaveRoom} className="bg-gray-800 text-gray-300 border border-gray-600 px-4 py-2 rounded-xl text-sm hover:bg-gray-700 transition flex items-center gap-2">
                                  <LogOut size={16}/> 退出する
                              </button>
                          )}
                      </div>
                      <div className="bg-gray-900/60 backdrop-blur-xl rounded-[2rem] p-8 shadow-2xl border border-gray-700/50">
                          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
                              <h3 className="text-2xl font-bold flex items-center gap-3 text-gray-200"><Settings className="text-purple-400"/> ゲーム設定</h3>
                              <div className="flex flex-wrap gap-4">
                                  <div className="flex items-center gap-4 bg-gray-800/50 px-4 py-2 rounded-xl border border-gray-700"><span className="text-sm font-bold text-gray-300">匿名投票</span>{isHostUser ? (<button onClick={() => handleUpdateAnonymous(!anonymousVoting)} className={`w-12 h-6 rounded-full transition relative ${anonymousVoting ? "bg-green-500" : "bg-gray-600"}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${anonymousVoting ? "left-7" : "left-1"}`}></div></button>) : (<span className={`text-xs font-bold ${anonymousVoting ? "text-green-400" : "text-gray-500"}`}>{anonymousVoting ? "ON" : "OFF"}</span>)}</div>
                                  <div className="flex items-center gap-4 bg-gray-800/50 px-4 py-2 rounded-xl border border-gray-700"><span className="text-sm font-bold text-gray-300 flex items-center gap-2"><Mic size={14}/> 対面モード</span>{isHostUser ? (<button onClick={() => handleUpdateInPersonMode(!inPersonMode)} className={`w-12 h-6 rounded-full transition relative ${inPersonMode ? "bg-green-500" : "bg-gray-600"}`}><div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${inPersonMode ? "left-7" : "left-1"}`}></div></button>) : (<span className={`text-xs font-bold ${inPersonMode ? "text-green-400" : "text-gray-500"}`}>{inPersonMode ? "ON" : "OFF"}</span>)}</div>
                              </div>
                          </div>
                          {inPersonMode && <div className="mb-6 p-4 bg-blue-900/20 border border-blue-500/30 rounded-xl text-sm text-blue-200 flex items-start gap-2"><Info size={16} className="shrink-0 mt-0.5"/> <span>対面モードが有効です。生存者チャットが無効になります。口頭で議論をしてください。</span></div>}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                              <div>
                                <h4 className="text-sm font-black text-blue-400 mb-4 uppercase tracking-wider">市民陣営</h4>
                                <div className="space-y-4">
                                    {['citizen', 'seer', 'medium', 'knight', 'trapper', 'sage', 'killer', 'detective', 'cursed', 'elder', 'assassin'].map(k => (
                                        <RoleCounter key={k} roleKey={k} label={ROLE_DEFINITIONS[k].name} count={roleSettings[k] || 0} onChange={(key, val) => handleUpdateSettings({...roleSettings, [key]: val})} isHost={isHostUser} />
                                    ))}
                                </div>
                              </div>
                              <div>
                                <h4 className="text-sm font-black text-red-400 mb-4 uppercase tracking-wider">人狼陣営</h4>
                                <div className="space-y-4">
                                    {['werewolf', 'greatwolf', 'madman'].map(k => (
                                        <RoleCounter key={k} roleKey={k} label={ROLE_DEFINITIONS[k].name} count={roleSettings[k] || 0} onChange={(key, val) => handleUpdateSettings({...roleSettings, [key]: val})} isHost={isHostUser} />
                                    ))}
                                </div>
                                <h4 className="text-sm font-black text-yellow-400 mb-4 mt-8 uppercase tracking-wider">第三陣営</h4>
                                <div className="space-y-4">
                                    {['fox', 'teruteru'].map(k => (
                                        <RoleCounter key={k} roleKey={k} label={ROLE_DEFINITIONS[k].name} count={roleSettings[k] || 0} onChange={(key, val) => handleUpdateSettings({...roleSettings, [key]: val})} isHost={isHostUser} />
                                    ))}
                                </div>
                              </div>
                          </div>
                      </div>
                      {isHostUser ? (
                          <div className="bg-gray-900/60 backdrop-blur-xl rounded-[2rem] p-8 shadow-2xl border border-gray-700/50 flex flex-col items-center justify-center text-center gap-6">
                              <p className={`font-bold ${!validationError ? "text-green-400" : "text-red-400"}`}>
                                  配役合計: {totalAssigned} / 参加者: {validPlayerCount}
                              </p>
                              {validationError && (
                                  <div className="flex items-center gap-2 text-red-400 bg-red-900/20 px-4 py-2 rounded-lg border border-red-500/30">
                                      <AlertTriangle size={16}/> <span className="text-sm font-bold">{validationError}</span>
                                  </div>
                              )}
                              <button disabled={!!validationError} onClick={handleStartGame} className="w-full md:w-auto px-16 py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 transition-all shadow-xl bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:scale-105 hover:shadow-purple-500/30 text-white disabled:opacity-50 disabled:scale-100"><Play fill="currentColor" size={24}/> ゲームを開始する</button>
                          </div>
                      ) : (
                          <div className="bg-gray-900/60 backdrop-blur-xl rounded-[2rem] p-10 shadow-2xl border border-gray-700/50 text-center"><Loader className="animate-spin mx-auto text-blue-500 mb-4" size={32}/><h3 className="text-xl font-bold text-gray-300">ホストがゲームを開始するのを待っています...</h3></div>
                      )}
                  </div>
              </div>
          </div>
      );
};