import React from 'react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';
import { Settings, Users } from 'lucide-react';

// ゲーム中の役職内訳確認パネル
export const RoleDistributionPanel = ({ players, roleSettings }) => {
    const total = Object.values(roleSettings || {}).reduce((a,b)=>a+b,0);
    const validRoles = Object.entries(roleSettings || {}).filter(([_, c]) => c > 0);

    // 陣営ごとにグループ化
    const groups = {
        citizen: [],
        werewolf: [],
        third: []
    };

    validRoles.forEach(([roleKey, count]) => {
        const def = ROLE_DEFINITIONS[roleKey];
        if (def && groups[def.team]) {
            groups[def.team].push({ key: roleKey, count, def });
        }
    });

    const sections = [
        { key: 'werewolf', label: '人狼陣営', color: 'text-red-400', bg: 'bg-red-950/30', border: 'border-red-900/50' },
        { key: 'citizen', label: '市民陣営', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-900/50' },
        { key: 'third', label: '第三陣営', color: 'text-orange-400', bg: 'bg-orange-950/30', border: 'border-orange-900/50' },
    ];

    return (
        <div className="flex flex-col h-full bg-gray-900/80 backdrop-blur border border-gray-700 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-3 border-b border-gray-700 bg-gray-800/80 flex items-center justify-between shrink-0">
                <span className="font-bold text-gray-200 flex items-center gap-2 text-sm">
                    <Settings size={16} className="text-blue-400"/> 役職配分設定
                </span>
                <span className="bg-black/30 px-2 py-1 rounded text-xs font-mono font-bold text-gray-300">
                    Total: <span className="text-blue-400 text-lg">{total}</span>
                </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-4">
                {sections.map(section => {
                    const rolesInGroup = groups[section.key];
                    if (rolesInGroup.length === 0) return null;

                    return (
                        <div key={section.key} className={`rounded-xl overflow-hidden border ${section.border}`}>
                            <div className={`px-3 py-1.5 text-xs font-bold ${section.bg} ${section.color} flex justify-between items-center`}>
                                <span>{section.label}</span>
                                <span className="bg-black/20 px-1.5 rounded text-[10px]">合計: {rolesInGroup.reduce((a, b) => a + b.count, 0)}</span>
                            </div>
                            <div className="p-2 gap-2 grid grid-cols-1 bg-black/10">
                                {rolesInGroup.map(({ key, count, def }) => (
                                    <div key={key} className="flex items-center p-2 rounded-lg border border-gray-700/50 bg-gray-800/40">
                                        <div className={`p-2 rounded-full bg-black/30 mr-3 ${section.color}`}>
                                            {React.createElement(def.icon, { size: 18 })}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-gray-200 text-sm">{def.name}</span>
                                                <span className="font-mono font-black text-white bg-white/10 px-2 py-0.5 rounded text-xs">x{count}</span>
                                            </div>
                                            <p className="text-[10px] text-gray-500 leading-tight mt-0.5 truncate">{def.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};