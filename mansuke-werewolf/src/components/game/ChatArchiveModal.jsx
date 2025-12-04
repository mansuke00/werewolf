import React, { useState, useMemo } from 'react';
import { X, History, MessageSquare } from 'lucide-react';
import { getMillis } from '../../utils/helpers';

// 過去ログ閲覧用モーダル
export const ChatArchiveModal = ({ messages, onClose, logs, title }) => {
    const isLogMode = !!logs;
    const isChatMode = !!messages;

    const [tab, setTab] = useState("all");
    const safeLogs = logs || []; 
    // ログのフェーズ（1日目昼、夜など）でタブ分け
    const tabs = useMemo(() => { if (!safeLogs.length) return []; return [...new Set(safeLogs.map(l => l.phase).filter(p => p && p !== 'System'))]; }, [safeLogs]);
    
    const sortedMessages = useMemo(() => {
        if (!isChatMode) return [];
        return [...messages].sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt));
    }, [messages, isChatMode]);

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-2xl h-[85vh] md:h-[80vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-3 md:p-4 border-b border-gray-700 flex flex-col gap-2 shrink-0 bg-gray-800/50">
                    <div className="flex justify-between items-center">
                        <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                            {isChatMode ? <MessageSquare size={18}/> : <History size={18}/>} 
                            {title || (isChatMode ? "チャットアーカイブ" : "過去の記録")}
                        </h3>
                        <button onClick={onClose} className="p-1 bg-gray-800 rounded-full hover:bg-gray-700 transition"><X className="text-gray-400 hover:text-white" size={20}/></button>
                    </div>
                    {isLogMode && (
                        <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                            <button onClick={()=>setTab("all")} className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition ${tab==="all" ? 'bg-blue-600 text-white':'bg-gray-800 text-gray-400 border border-gray-700'}`}>すべて</button>
                            {tabs.map(t => (<button key={t} onClick={()=>setTab(t)} className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition ${tab===t ? 'bg-blue-600 text-white':'bg-gray-800 text-gray-400 border border-gray-700'}`}>{t}</button>))}
                        </div>
                    )}
                </div>
                
                <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 custom-scrollbar bg-black/20">
                    {isLogMode && safeLogs.filter(l => tab === "all" || l.phase === tab).map((l, i) => (
                        <div key={i} className="flex flex-col items-start animate-fade-in">
                            <span className="text-[10px] text-gray-400 mb-1 px-1">{l.phase}</span>
                            <div className="bg-gray-800 text-gray-200 px-3 py-2 rounded-xl rounded-tl-none text-xs md:text-sm border border-gray-700 leading-relaxed">{l.text}</div>
                        </div>
                    ))}

                    {isChatMode && sortedMessages.map((msg, i) => (
                        <div key={i} className="flex flex-col items-start animate-fade-in">
                            <div className="flex items-baseline gap-2 mb-1 px-1">
                                <span className="text-xs font-bold text-gray-400">{msg.senderName}</span>
                                <span className="text-[9px] text-gray-600">{msg.createdAt ? new Date(getMillis(msg.createdAt)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}</span>
                            </div>
                            <div className="bg-gray-800 text-gray-200 px-4 py-2.5 rounded-2xl rounded-tl-none text-xs md:text-sm border border-gray-700 max-w-[95%] break-words shadow-sm">
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    
                    {isChatMode && sortedMessages.length === 0 && (
                        <div className="text-center text-gray-500 text-xs md:text-sm py-10">メッセージはありません</div>
                    )}
                </div>
            </div>
        </div>
    );
};