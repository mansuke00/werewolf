import React, { useState, useMemo } from 'react';
import { Skull, User, Crown, Eye, WifiOff, Users, SortAsc, LayoutGrid } from 'lucide-react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';
import { isPlayerOnline } from '../../utils/helpers';

export const DeadPlayerInfoPanel = ({ players, title = "プレイヤーの役職" }) => {
    const [viewMode, setViewMode] = useState('role'); // 'role' | 'name'

    // players配列が存在しない場合は空配列として扱う
    const safePlayers = players || [];

    // 表示対象のフィルタリング
    // 役職情報(role)を持っている、または死亡/追放ステータスの人、または観戦者
    const targets = useMemo(() => {
        return safePlayers.filter(p => p.role || ['dead', 'vanished'].includes(p.status) || p.isSpectator);
    }, [safePlayers]);

    // プレイヤーデータの加工（表示用情報の付与）
    const processedPlayers = useMemo(() => {
        return targets.map(p => {
            const roleKey = p.role || "unknown";
            const isSpectator = p.isSpectator || roleKey === 'spectator';
            // 観戦者の場合のフォールバック
            const def = ROLE_DEFINITIONS[roleKey] || (isSpectator ? ROLE_DEFINITIONS['spectator'] : null);
            
            const roleName = def ? def.name : (roleKey === 'unknown' ? "不明" : roleKey);
            const Icon = def ? def.icon : (isSpectator ? Eye : User);
            const team = def ? def.team : 'other';

            // 陣営カラー定義
            let teamColor = "text-gray-400";
            let borderColor = "border-gray-700";
            let bgColor = "bg-gray-800/40";
            let teamLabel = "その他";

            if (team === 'werewolf') {
                teamColor = "text-red-400";
                borderColor = "border-red-900/30";
                bgColor = "bg-red-900/10";
                teamLabel = "人狼陣営";
            } else if (team === 'citizen') {
                teamColor = "text-blue-400";
                borderColor = "border-blue-900/30";
                bgColor = "bg-blue-900/10";
                teamLabel = "市民陣営";
            } else if (team === 'third') {
                teamColor = "text-orange-400";
                borderColor = "border-orange-900/30";
                bgColor = "bg-orange-900/10";
                teamLabel = "第三陣営";
            }

            if (isSpectator) {
                teamColor = "text-purple-400";
                borderColor = "border-purple-900/30";
                bgColor = "bg-purple-900/10";
                teamLabel = "観戦者";
            }

            return {
                ...p,
                roleName,
                Icon,
                team,
                teamLabel,
                teamColor,
                borderColor,
                bgColor,
                isSpectator
            };
        });
    }, [targets]);

    // 表示データの並び替え・グループ化
    const content = useMemo(() => {
        if (viewMode === 'name') {
            // 名前順でソート
            const sorted = [...processedPlayers].sort((a, b) => a.name.localeCompare(b.name));
            return (
                <div className="grid grid-cols-1 gap-2">
                    {sorted.map(p => <PlayerCard key={p.id} player={p} />)}
                </div>
            );
        } else {
            // 役職（陣営）順でグループ化し、さらにその中で役職ごとにまとめる
            // 構造: groups[team][roleKey] = [player1, player2...]
            const groups = {
                werewolf: {},
                citizen: {},
                third: {},
                spectator: [], // 観戦者は役職分けしない（全員観戦者なので）
                other: {}
            };

            processedPlayers.forEach(p => {
                if (p.isSpectator) {
                    groups.spectator.push(p);
                } else {
                    const teamKey = groups[p.team] ? p.team : 'other';
                    const roleKey = p.role || 'unknown';
                    
                    if (!groups[teamKey][roleKey]) {
                        groups[teamKey][roleKey] = [];
                    }
                    groups[teamKey][roleKey].push(p);
                }
            });

            const sections = [
                { key: 'werewolf', label: '人狼陣営', color: 'text-red-400', bg: 'bg-red-950/30', border: 'border-red-900/50' },
                { key: 'citizen', label: '市民陣営', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-900/50' },
                { key: 'third', label: '第三陣営', color: 'text-orange-400', bg: 'bg-orange-950/30', border: 'border-orange-900/50' },
                { key: 'spectator', label: '観戦者', color: 'text-purple-400', bg: 'bg-purple-950/30', border: 'border-purple-900/50' },
                { key: 'other', label: 'その他', color: 'text-gray-400', bg: 'bg-gray-900/30', border: 'border-gray-800' },
            ];

            return (
                <div className="space-y-4">
                    {sections.map(section => {
                        // 観戦者の特別処理（役職サブグループを作らない）
                        if (section.key === 'spectator') {
                            const players = groups.spectator;
                            if (players.length === 0) return null;
                            return (
                                <div key={section.key} className={`rounded-xl overflow-hidden border ${section.border}`}>
                                    <div className={`px-3 py-1.5 text-xs font-bold ${section.bg} ${section.color} flex justify-between items-center`}>
                                        <span>{section.label}</span>
                                        <span className="bg-black/20 px-1.5 rounded text-[10px]">{players.length}</span>
                                    </div>
                                    <div className="p-2 gap-2 grid grid-cols-1 bg-black/10">
                                        {players.map(p => <PlayerCard key={p.id} player={p} />)}
                                    </div>
                                </div>
                            );
                        }

                        // 通常陣営の処理
                        const roleGroups = groups[section.key];
                        const roleKeys = Object.keys(roleGroups);
                        if (roleKeys.length === 0) return null;

                        // 総人数計算
                        const totalCount = roleKeys.reduce((acc, key) => acc + roleGroups[key].length, 0);

                        return (
                            <div key={section.key} className={`rounded-xl overflow-hidden border ${section.border}`}>
                                {/* 陣営ヘッダー */}
                                <div className={`px-3 py-1.5 text-xs font-bold ${section.bg} ${section.color} flex justify-between items-center`}>
                                    <span>{section.label}</span>
                                    <span className="bg-black/20 px-1.5 rounded text-[10px]">{totalCount}</span>
                                </div>
                                
                                <div className="p-2 bg-black/10 space-y-2">
                                    {roleKeys.map(roleKey => {
                                        const players = roleGroups[roleKey];
                                        // 役職名を取得（一人目の情報から取るのが手っ取り早い）
                                        const roleName = players[0].roleName;
                                        
                                        return (
                                            <div key={roleKey} className="bg-gray-900/40 rounded-lg border border-gray-700/50 overflow-hidden">
                                                {/* 役職サブヘッダー */}
                                                <div className="px-2 py-1 bg-black/20 text-[10px] text-gray-400 font-bold border-b border-gray-700/30 flex justify-between">
                                                    <span>{roleName}</span>
                                                    <span>x{players.length}</span>
                                                </div>
                                                <div className="p-1 grid grid-cols-1 gap-1">
                                                    {players.map(p => <PlayerCard key={p.id} player={p} />)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }
    }, [viewMode, processedPlayers]);

    return (
        <div className="flex flex-col h-full bg-gray-900/80 backdrop-blur border border-gray-700 rounded-2xl overflow-hidden shadow-xl">
            {/* ヘッダー */}
            <div className="p-3 border-b border-gray-700 bg-gray-800/80 flex items-center justify-between shrink-0">
                <span className="font-bold text-gray-200 flex items-center gap-2 text-sm">
                    <Users size={16} className="text-blue-400"/> {title}
                </span>
                
                {/* 表示切り替えタブ */}
                <div className="flex bg-black/30 rounded-lg p-0.5 border border-gray-700">
                    <button 
                        onClick={() => setViewMode('role')}
                        className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition ${viewMode === 'role' ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <LayoutGrid size={12}/> 役職順
                    </button>
                    <button 
                        onClick={() => setViewMode('name')}
                        className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition ${viewMode === 'name' ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <SortAsc size={12}/> 名前順
                    </button>
                </div>
            </div>
            
            {/* コンテンツエリア */}
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                {targets.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm">
                        <Skull size={32} className="mb-2 opacity-50"/>
                        <p>該当するプレイヤーはいません</p>
                    </div>
                ) : (
                    content
                )}
            </div>
        </div>
    );
};

// プレイヤーカードコンポーネント
const PlayerCard = ({ player, minimal }) => {
    const { name, roleName, Icon, teamColor, borderColor, bgColor, status, originalRole, deathReason, isHost, isSpectator } = player;

    // 観戦者以外で、かつstatusがvanishedの場合のみ表示
    const showVanishedTag = !isSpectator && status === 'vanished';
    
    // 観戦者は死亡判定にしない
    const isDead = !isSpectator && status === 'dead';

    return (
        <div className={`flex items-center p-2.5 rounded-lg border ${borderColor} ${bgColor} transition hover:bg-gray-700/40 relative overflow-hidden group`}>
            
            <div className={`p-2 rounded-full bg-black/30 mr-3 ${teamColor} shrink-0 relative`}>
                <Icon size={18}/>
                {isHost && <div className="absolute -top-1 -left-1 bg-yellow-500 text-black p-0.5 rounded-full border border-black"><Crown size={8}/></div>}
            </div>
            
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                    <span className={`font-bold truncate text-sm ${isDead || showVanishedTag ? 'text-gray-400 line-through decoration-red-500/50' : 'text-gray-200'}`}>
                        {name}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                        {!isPlayerOnline(player) && <WifiOff size={10} className="text-red-500"/>}
                        {/* DEADタグは削除しました */}
                        {showVanishedTag && <span className="text-[9px] text-gray-500 font-bold border border-gray-700 px-1 rounded bg-black/30">追放</span>}
                    </div>
                </div>
                
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                    <span className={`text-xs font-bold ${teamColor}`}>
                        {isSpectator ? "観戦者" : roleName}
                    </span>
                    {!isSpectator && originalRole && originalRole !== player.role && (
                        <span className="text-[10px] text-gray-500">
                            (元: {ROLE_DEFINITIONS[originalRole]?.name || originalRole})
                        </span>
                    )}
                </div>
            </div>

            {/* 死因表示 - 観戦者以外 */}
            {!isSpectator && deathReason && (
                <div className="text-right pl-2 max-w-[80px] shrink-0 flex flex-col items-end justify-center">
                    <span className="text-[9px] text-gray-500 leading-none mb-0.5">死因</span>
                    <span className="text-[10px] text-red-300 font-medium truncate w-full text-right" title={deathReason}>
                        {deathReason}
                    </span>
                </div>
            )}
        </div>
    );
};