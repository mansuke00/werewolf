import React from 'react';
import { Users, Skull, WifiOff, Check } from 'lucide-react';
import { isPlayerOnline } from '../../utils/helpers';

export const SurvivorsList = ({ players }) => {
    const safePlayers = players || [];
    const aliveCount = safePlayers.filter(p => p.status === 'alive').length;
    
    return (
        <div>
           <div className="flex items-center justify-between gap-2 mb-4 bg-gray-800 p-3 rounded-xl border border-gray-700">
                <div className="flex items-center gap-2 text-gray-300 text-sm font-bold">
                    <Users size={18} className="text-green-400"/> <span>現在の生存者数</span>
                </div>
                <span className="text-2xl font-black text-white">{aliveCount} <span className="text-xs text-gray-500 font-normal">/ {safePlayers.length}名</span></span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {safePlayers.map(p => (
                    <div key={p.id} className={`flex items-center justify-between p-2 rounded-xl border transition ${p.status === 'dead' || p.status === 'disconnected' ? "bg-black/50 border-gray-800 opacity-50" : p.isReady ? "bg-green-900/40 border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]" : "bg-gray-800/50 border-gray-700"}`}>
                        <div className="flex items-center gap-2 overflow-hidden">
                            {/* ステータスアイコン */}
                            {p.status === 'dead' ? <Skull size={16} className="text-gray-500 shrink-0"/> : !isPlayerOnline(p) ? <WifiOff size={16} className="text-red-500 shrink-0"/> : <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_limegreen] shrink-0"></div>}
                            <span className="text-gray-300 font-bold text-xs truncate">{p.name || '不明'}</span>
                        </div>
                        {/* 準備完了マーク */}
                        {p.status === 'alive' && p.isReady && <Check size={14} className="text-green-400"/>}
                    </div>
                ))}
            </div>
        </div>
    );
};