import React, { useState, useEffect } from 'react';
import { Gavel, User, AlertOctagon } from 'lucide-react';

// 投票結果と処刑結果を表示するモーダル
export const VotingResultModal = ({ voteSummary, players, anonymousVoting, executionResult, onClose }) => {
    // 表示時間：短めに設定してテンポを良くする
    const [timeLeft, setTimeLeft] = useState(6);

    useEffect(() => {
        if (timeLeft > 0) {
            const t = setTimeout(() => setTimeLeft(c => c - 1), 1000);
            return () => clearTimeout(t);
        } else {
            onClose();
        }
    }, [timeLeft, onClose]);

    const getPlayerName = (id) => {
        if (id === 'skip') return 'スキップ';
        return players.find(p => p.id === id)?.name || '不明';
    };

    return (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[150] flex flex-col items-center justify-center p-6 animate-fade-in">
            <div className="w-full max-w-3xl flex flex-col h-full max-h-[90vh]">
                <div className="flex items-center justify-between mb-8 shrink-0">
                    <div className="flex items-center gap-4">
                        <Gavel size={48} className="text-red-500 animate-bounce" />
                        <div>
                            <h2 className="text-4xl font-black text-white tracking-widest">開票結果</h2>
                            <p className="text-gray-400">Voting Results</p>
                        </div>
                    </div>
                    <div className="w-20 h-20 rounded-full border-4 border-red-500/30 flex items-center justify-center bg-gray-900/50">
                        <span className="text-3xl font-black text-red-500">{timeLeft}</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 mb-8">
                    {voteSummary && voteSummary.map((item, index) => {
                        const targetName = getPlayerName(item.targetId);
                        const percentage = (item.count / voteSummary.reduce((a,b) => a + b.count, 0)) * 100;
                        
                        return (
                            <div key={index} className="bg-gray-900/60 border border-gray-700/50 rounded-2xl p-4 flex flex-col gap-3 relative overflow-hidden group">
                                <div className="absolute top-0 left-0 h-full bg-red-900/20 transition-all duration-1000 ease-out" style={{ width: `${percentage}%` }}></div>
                                <div className="relative z-10 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center font-bold text-gray-400 text-sm">
                                            {index + 1}
                                        </div>
                                        <span className={`text-2xl font-bold ${index === 0 ? "text-red-400" : "text-gray-200"}`}>{targetName}</span>
                                    </div>
                                    <span className="text-3xl font-black text-white">{item.count}<span className="text-sm font-normal text-gray-500 ml-1">票</span></span>
                                </div>
                                
                                {!anonymousVoting && item.voters && item.voters.length > 0 && (
                                    <div className="relative z-10 flex flex-wrap gap-2 pl-12">
                                        {item.voters.map(vid => (
                                            <div key={vid} className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded-lg border border-white/5">
                                                <User size={12} className="text-gray-500"/>
                                                <span className="text-xs text-gray-300">{getPlayerName(vid)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="shrink-0 bg-red-900/30 border-2 border-red-500/50 rounded-3xl p-6 text-center animate-pulse shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                    <div className="flex items-center justify-center gap-3 mb-2">
                        <AlertOctagon size={24} className="text-red-400"/>
                        <span className="text-red-300 font-bold uppercase tracking-wider">JUDGEMENT</span>
                    </div>
                    <p className="text-2xl md:text-3xl font-black text-white leading-relaxed">
                        {executionResult || "集計中..."}
                    </p>
                </div>
            </div>
        </div>
    );
};