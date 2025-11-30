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
            <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-700 flex flex-col gap-2 shrink-0">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            {isChatMode ? <MessageSquare size={18}/> : <History size={18}/>} 
                            {title || (isChatMode ? "チャットアーカイブ" : "過去の記録")}
                        </h3>
                        <button onClick={onClose}><X className="text-gray-400 hover:text-white"/></button>
                    </div>
                    {isLogMode && (
                        <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-2">
                            <button onClick={()=>setTab("all")} className={`px-3 py-1 rounded text-xs whitespace-nowrap ${tab==="all" ? 'bg-blue-600 text-white':'bg-gray-800 text-gray-400'}`}>すべて</button>
                            {tabs.map(t => (<button key={t} onClick={()=>setTab(t)} className={`px-3 py-1 rounded text-xs whitespace-nowrap ${tab===t ? 'bg-blue-600 text-white':'bg-gray-800 text-gray-400'}`}>{t}</button>))}
                        </div>
                    )}
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-black/20">
                    {isLogMode && safeLogs.filter(l => tab === "all" || l.phase === tab).map((l, i) => (
                        <div key={i} className="flex flex-col items-start">
                            <span className="text-xs text-gray-400 mb-1">{l.phase}</span>
                            <div className="bg-gray-800 text-gray-200 px-3 py-2 rounded-xl rounded-tl-none text-sm border border-gray-700">{l.text}</div>
                        </div>
                    ))}

                    {isChatMode && sortedMessages.map((msg, i) => (
                        <div key={i} className="flex flex-col items-start">
                            <div className="flex items-baseline gap-2 mb-1">
                                <span className="text-xs font-bold text-gray-400">{msg.senderName}</span>
                                <span className="text-[10px] text-gray-600">{msg.createdAt ? new Date(getMillis(msg.createdAt)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}</span>
                            </div>
                            <div className="bg-gray-800 text-gray-200 px-4 py-2 rounded-2xl rounded-tl-none text-sm border border-gray-700 max-w-[90%] break-words">
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    
                    {isChatMode && sortedMessages.length === 0 && (
                        <div className="text-center text-gray-500 text-sm py-10">メッセージはありません</div>
                    )}
                </div>
            </div>
        </div>
    );
};