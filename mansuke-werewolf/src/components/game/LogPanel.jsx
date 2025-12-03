import React, { useRef, useEffect, useState, useMemo } from 'react';
import { FileText, Clock, Lock, Info, Moon, Sun, Eye, CheckCircle2, Gavel, ListFilter, Sparkles, ScrollText } from 'lucide-react';

export const LogPanel = ({ logs, showSecret, user }) => {
      const logsEndRef = useRef(null);
      const [activeTab, setActiveTab] = useState('all'); // 'all' | 'progress' | 'role'
      
      // ログが更新されたら自動スクロール
      useEffect(() => { 
          if (logsEndRef.current) {
              logsEndRef.current.scrollIntoView({ behavior: 'smooth' }); 
          }
      }, [logs, showSecret, activeTab]);
      
      // フィルタリングとグルーピング処理
      const groupedLogs = useMemo(() => {
          // 1. まず権限に基づいて表示可能なログを抽出
          const accessibleLogs = showSecret 
              ? (logs || []) 
              : (logs || []).filter(l => !l.visibleTo || (Array.isArray(l.visibleTo) && l.visibleTo.includes(user?.uid)));

          // 2. タブに基づいてフィルタリング
          const filtered = accessibleLogs.filter(log => {
              if (activeTab === 'all') return true;
              if (activeTab === 'progress') return !log.secret; // secretフラグがない＝全員公開＝進行ログ
              if (activeTab === 'role') return log.secret; // secretフラグがある＝秘匿＝役職ログ
              return true;
          });

          // 3. 日付ごとにグルーピング
          const groups = [];
          let currentDay = null;
          let currentGroup = null;

          filtered.forEach(log => {
              const day = log.day !== undefined ? log.day : 0; // dayがない場合は0（開始前など）として扱う
              
              if (day !== currentDay) {
                  if (currentGroup) groups.push(currentGroup);
                  currentGroup = { day, logs: [] };
                  currentDay = day;
              }
              if (currentGroup) {
                  currentGroup.logs.push(log);
              }
          });
          if (currentGroup) groups.push(currentGroup);

          return groups;
      }, [logs, showSecret, user, activeTab]);
      
      // ログの種類に応じたスタイル定義
      const getLogStyle = (log) => {
          if (log.secret) return {
              icon: Lock,
              color: "text-amber-400",
              bgColor: "bg-amber-500/10",
              borderColor: "border-amber-500/20"
          };
          
          const p = log.phase || "";
          if (p.includes("夜") || p.includes("行動")) return { icon: Moon, color: "text-purple-400", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/20" };
          if (p.includes("昼") || p.includes("朝")) return { icon: Sun, color: "text-orange-400", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/20" };
          if (p.includes("投票") || p.includes("処刑")) return { icon: Gavel, color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/20" };
          if (p.includes("System") || p.includes("開始")) return { icon: CheckCircle2, color: "text-green-400", bgColor: "bg-green-500/10", borderColor: "border-green-500/20" };
          
          // デフォルト
          return { icon: Info, color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20" };
      };

      return (
          <div className="flex flex-col h-full bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/50 overflow-hidden relative shadow-lg">
             {/* ヘッダー & タブ */}
             <div className="flex flex-col border-b border-gray-700/50 bg-gray-800/60 backdrop-blur-sm shrink-0 z-20">
                 <div className="px-4 py-3 font-bold text-gray-200 text-sm flex justify-between items-center">
                     <span className="flex items-center gap-2 text-blue-100">
                         <FileText size={16} className="text-blue-400"/> ゲームログ
                     </span>
                     {showSecret && (
                         <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full border border-yellow-500/30 flex items-center gap-1 shadow-[0_0_10px_rgba(234,179,8,0.2)] animate-pulse">
                             <Eye size={12}/> 神視点
                         </span>
                     )}
                 </div>
                 
                 {/* タブ切り替えボタン */}
                 <div className="flex px-2 pb-2 gap-1">
                     <button 
                        onClick={() => setActiveTab('all')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${activeTab === 'all' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
                     >
                        <ListFilter size={12}/> すべて
                     </button>
                     <button 
                        onClick={() => setActiveTab('progress')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${activeTab === 'progress' ? 'bg-green-600 text-white shadow-lg shadow-green-500/20' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
                     >
                        <ScrollText size={12}/> 進行
                     </button>
                     <button 
                        onClick={() => setActiveTab('role')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1 ${activeTab === 'role' ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/20' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
                     >
                        <Lock size={12}/> 役職
                     </button>
                 </div>
             </div>

             {/* ログリスト */}
             <div className="flex-1 overflow-y-auto p-4 custom-scrollbar scroll-smooth">
                 {groupedLogs.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-70">
                         <Clock size={32} className="mb-2"/>
                         <p className="text-xs font-bold">ログはありません</p>
                     </div>
                 ) : (
                     <div className="space-y-6">
                         {groupedLogs.map((group) => (
                             <div key={group.day} className="relative">
                                 {/* 日付セパレーター */}
                                 <div className="sticky top-0 z-10 flex justify-center mb-4">
                                     <span className="bg-gray-800/90 backdrop-blur border border-gray-600 px-4 py-1 rounded-full text-xs font-bold text-gray-300 shadow-md">
                                         {group.day > 0 ? `${group.day}日目` : "ゲーム開始前"}
                                     </span>
                                 </div>

                                 <div className="relative pl-4 border-l-2 border-gray-800 space-y-4">
                                     {group.logs.map((log, i) => {
                                         const style = getLogStyle(log);
                                         const Icon = style.icon;
                                         
                                         return (
                                           <div key={i} className="flex gap-3 animate-fade-in group relative">
                                               {/* タイムラインのドット */}
                                               <div className={`absolute -left-[21px] top-3 w-3 h-3 rounded-full border-2 border-gray-900 ${style.bgColor.replace('/10', '')} ${style.color}`}></div>
                                               
                                               {/* メッセージ本文 */}
                                               <div className={`flex-1 rounded-xl p-3 border ${style.borderColor} ${style.bgColor} relative hover:bg-opacity-80 transition-colors shadow-sm`}>
                                                   <div className="flex items-center gap-2 mb-1.5 opacity-80">
                                                       <Icon size={12} className={style.color} />
                                                       <span className={`text-[10px] font-bold ${style.color} uppercase tracking-wider`}>
                                                           {log.phase}
                                                       </span>
                                                       {log.secret && <Lock size={10} className="text-amber-400 ml-auto"/>}
                                                   </div>
                                                   <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words font-medium">
                                                       {log.text}
                                                   </p>
                                               </div>
                                           </div>
                                         );
                                     })}
                                 </div>
                             </div>
                         ))}
                     </div>
                 )}
                 <div ref={logsEndRef} className="h-2"></div>
             </div>
          </div>
      );
};