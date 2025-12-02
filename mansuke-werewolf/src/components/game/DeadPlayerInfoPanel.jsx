import React from 'react';
import { Skull, User, Crown, Eye, WifiOff } from 'lucide-react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';
import { isPlayerOnline } from '../../utils/helpers';

export const DeadPlayerInfoPanel = ({ players, title = "死亡・追放されたプレイヤー" }) => {
    // players配列が存在しない場合は空配列として扱う
    const safePlayers = players || [];

    // 表示するプレイヤーを「役職が判明している人」または「死亡/追放された人」に絞る
    // リザルト画面などで全プレイヤーを表示する場合もあるため、親コンポーネントからのフィルタリングに依存する形にするが、
    // ここでは念のため「役職情報(role)を持っている」または「死亡/追放」ステータスの人を対象とする
    // ※観戦者は除外しない（リザルト画面等で表示するため）
    const targets = safePlayers.filter(p => p.role || ['dead', 'vanished'].includes(p.status) || p.isSpectator);

    return (
        <div className="flex flex-col h-full bg-gray-900/80 backdrop-blur border border-gray-700 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-gray-700 bg-gray-800/50 flex items-center justify-between">
                <span className="font-bold text-gray-300 flex items-center gap-2">
                    <Skull size={18} className="text-red-400"/> {title}
                </span>
                <span className="text-xs text-gray-500 bg-black/30 px-2 py-1 rounded">Total: {targets.length}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {targets.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm">
                        <Skull size={32} className="mb-2 opacity-50"/>
                        <p>該当するプレイヤーはいません</p>
                    </div>
                ) : (
                    targets.map(p => {
                        const roleKey = p.role || "unknown";
                        // 観戦者の場合は特別な処理（spectatorがROLE_DEFINITIONSにない場合のガードも兼ねる）
                        const isSpectator = p.isSpectator || roleKey === 'spectator';
                        const def = ROLE_DEFINITIONS[roleKey] || (isSpectator ? ROLE_DEFINITIONS['spectator'] : null);
                        
                        const roleName = def ? def.name : (roleKey === 'unknown' ? "不明" : roleKey);
                        const Icon = def ? def.icon : (isSpectator ? Eye : User);
                        
                        // 陣営カラーの決定
                        let teamColor = "text-gray-400";
                        let borderColor = "border-gray-700";
                        let bgColor = "bg-gray-800/40";

                        if (def) {
                            if (def.team === 'werewolf') {
                                teamColor = "text-red-400";
                                borderColor = "border-red-900/30";
                                bgColor = "bg-red-900/10";
                            } else if (def.team === 'citizen') {
                                teamColor = "text-blue-400";
                                borderColor = "border-blue-900/30";
                                bgColor = "bg-blue-900/10";
                            } else if (def.team === 'third') {
                                teamColor = "text-orange-400";
                                borderColor = "border-orange-900/30";
                                bgColor = "bg-orange-900/10";
                            }
                        }
                        
                        // 観戦者の特別色
                        if (isSpectator) {
                            teamColor = "text-purple-400";
                            borderColor = "border-purple-900/30";
                            bgColor = "bg-purple-900/10";
                        }

                        return (
                            <div key={p.id} className={`flex items-center p-3 rounded-xl border ${borderColor} ${bgColor} transition hover:bg-gray-700/50`}>
                                <div className={`p-2 rounded-full bg-black/20 mr-3 ${teamColor}`}>
                                    <Icon size={20}/>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className="font-bold text-gray-200 truncate text-sm">{p.name}</span>
                                        {p.isHost && <Crown size={12} className="text-yellow-500"/>}
                                        {!isPlayerOnline(p) && <WifiOff size={12} className="text-red-500"/>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded bg-black/30 ${teamColor}`}>
                                            {roleName}
                                        </span>
                                        {p.status === 'dead' && <span className="text-[10px] text-red-500 font-bold border border-red-900/50 px-1 rounded">DEAD</span>}
                                        {p.status === 'vanished' && <span className="text-[10px] text-gray-500 font-bold border border-gray-700 px-1 rounded">追放</span>}
                                        {/* 元の役職があれば表示（呪われし者など） */}
                                        {p.originalRole && p.originalRole !== p.role && (
                                            <span className="text-[10px] text-gray-500">
                                                (元: {ROLE_DEFINITIONS[p.originalRole]?.name || p.originalRole})
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {/* 死因があれば表示 */}
                                {p.deathReason && (
                                    <div className="text-right pl-2 max-w-[100px]">
                                        <p className="text-[10px] text-gray-500 mb-0.5">死因</p>
                                        <p className="text-xs text-red-300 font-medium truncate" title={p.deathReason}>{p.deathReason}</p>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};