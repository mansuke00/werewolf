import React from 'react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';

// ゲーム中の役職内訳確認パネル
export const RoleDistributionPanel = ({ players, roleSettings }) => {
    const total = Object.values(roleSettings || {}).reduce((a,b)=>a+b,0);
    return (
        <div className="space-y-3">
            <p className="text-sm text-gray-400 mb-2">参加人数: {players.length}名 / 配役合計: {total}名</p>
            {Object.entries(roleSettings || {}).filter(([_, c]) => c > 0).map(([roleKey, count]) => (
                <div key={roleKey} className="flex flex-col bg-black/20 p-2 rounded-lg border border-white/5">
                    <div className="flex justify-between items-center mb-1"><span className="text-gray-200 font-bold text-sm">{ROLE_DEFINITIONS[roleKey]?.name}</span><span className="font-mono font-black text-blue-400 bg-blue-900/30 px-2 rounded text-xs">x{count}</span></div><p className="text-[10px] text-gray-500 leading-tight">{ROLE_DEFINITIONS[roleKey]?.desc}</p>
                </div>
            ))}
        </div>
    );
};