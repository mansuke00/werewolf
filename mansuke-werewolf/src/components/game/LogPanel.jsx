import React, { useRef, useEffect } from 'react';
import { FileText } from 'lucide-react';

export const LogPanel = ({ logs, showSecret, user }) => {
      const logsEndRef = useRef(null);
      useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs, showSecret]);
      
      // 神視点（ゲーム終了後や死者）なら全ログを表示、それ以外は自分の権限でフィルタリング
      const displayLogs = showSecret ? (logs || []) : (logs || []).filter(l => !l.visibleTo || (Array.isArray(l.visibleTo) && l.visibleTo.includes(user?.uid)));
      
      return (
          <div className="flex flex-col h-full bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-gray-700/50 overflow-hidden relative shadow-lg">
             <div className="p-3 border-b border-gray-700/50 bg-gray-800/40 font-bold text-gray-300 text-sm flex justify-between shrink-0"><span>ゲームログ</span>{showSecret && <span className="text-xs text-yellow-400 flex items-center gap-1"><FileText size={10}/> 神視点</span>}</div>
             <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                 {displayLogs.map((log, i) => (
                   <div key={i} className={`text-sm border-l-2 pl-3 py-1 rounded-r-lg ${log.secret ? "border-yellow-500 bg-yellow-900/20" : "border-blue-500 bg-gray-800/20"}`}>
                       <span className={`${log.secret ? "text-yellow-400" : "text-blue-400"} font-bold text-xs block mb-1`}>{log.phase}</span>
                       <span className="text-gray-200 leading-relaxed whitespace-pre-wrap">{log.text}</span>
                   </div>
                 ))}
                 <div ref={logsEndRef}></div>
             </div>
          </div>
      );
};