import React from 'react';
import { Users, Skull, WifiOff, Check, Eye, Ban } from 'lucide-react';
import { isPlayerOnline } from '../../utils/helpers';

export const SurvivorsList = ({ players }) => {
    // 参加者と観戦者に分離
    const participants = (players || []).filter(p => !p.isSpectator);
    const spectators = (players || []).filter(p => p.isSpectator);
    
    // 生存者は参加者の中からカウント（vanishedは除外）
    const aliveCount = participants.filter(p => p.status === 'alive').length;
    
    return (
        <div className="space-y-6">
            {/* 生存者セクション */}
            <div>
                <div className="flex items-center justify-between gap-2 mb-4 bg-gray-800 p-3 rounded-xl border border-gray-700">
                    <div className="flex items-center gap-2 text-gray-300 text-sm font-bold">
                        <Users size={18} className="text-green-400"/> <span>現在の生存者数</span>
                    </div>
                    {/* 分母は参加者のみ */}
                    <span className="text-2xl font-black text-white">{aliveCount} <span className="text-xs text-gray-500 font-normal">/ {participants.length}名</span></span>
                </div>
                
                {participants.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                        {participants.map(p => (
                            <div key={p.id} className={`flex items-center justify-between p-2 rounded-xl border transition ${p.status === 'dead' || p.status === 'vanished' || p.status === 'disconnected' ? "bg-black/50 border-gray-800 opacity-50" : p.isReady ? "bg-green-900/40 border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.2)]" : "bg-gray-800/50 border-gray-700"}`}>
                                <div className="flex items-center gap-2 overflow-hidden">
                                    {/* ステータスアイコン */}
                                    {p.status === 'vanished' ? (
                                        <Ban size={16} className="text-gray-500 shrink-0"/>
                                    ) : p.status === 'dead' ? (
                                        <Skull size={16} className="text-gray-500 shrink-0"/>
                                    ) : !isPlayerOnline(p) ? (
                                        <WifiOff size={16} className="text-red-500 shrink-0"/>
                                    ) : (
                                        <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_limegreen] shrink-0"></div>
                                    )}
                                    <span className={`font-bold text-xs truncate ${p.status === 'vanished' ? "text-gray-600 line-through" : "text-gray-300"}`}>
                                        {p.name || '不明'}
                                    </span>
                                </div>
                                {/* 準備完了マーク */}
                                {p.status === 'alive' && p.isReady && <Check size={14} className="text-green-400"/>}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center text-gray-500 text-xs py-2">参加者はいません</div>
                )}
            </div>

            {/* 観戦者セクション */}
            {spectators.length > 0 && (
                <div>
                    <h4 className="text-xs font-bold text-gray-400 mb-2 flex items-center gap-1 uppercase tracking-wider pl-1">
                        <Eye size={12}/> Spectators
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                        {spectators.map(p => (
                            <div key={p.id} className="flex items-center justify-between p-2 rounded-xl border bg-gray-900/30 border-gray-800 transition">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    {/* 観戦者はオンライン状態のみ表示（死亡アイコン等はなし） */}
                                    {!isPlayerOnline(p) ? <WifiOff size={16} className="text-red-500 shrink-0"/> : <div className="w-2 h-2 rounded-full bg-purple-500 shrink-0"></div>}
                                    <span className="text-gray-400 font-bold text-xs truncate">{p.name || '不明'}</span>
                                </div>
                                {/* 観戦者バッジ */}
                                <span className="text-[10px] bg-purple-900/20 text-purple-400 px-2 py-0.5 rounded border border-purple-500/20">観戦者</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};