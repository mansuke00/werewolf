import React, { useRef, useEffect, useState, useMemo } from 'react';
import { FileText, Clock, Lock, Info, Moon, Sun, Eye, CheckCircle2, Gavel, ListFilter, Sparkles, ScrollText } from 'lucide-react';

export const LogPanel = ({ logs, showSecret, user }) => {
      // ログリスト末尾への参照。スクロール制御用
      const logsEndRef = useRef(null);
      // 表示タブの状態管理。'all'(全て), 'progress'(進行のみ), 'role'(役職・秘匿のみ)
      const [activeTab, setActiveTab] = useState('all'); 
      
      // 自動スクロール処理
      // ログ更新、秘匿モード切替、タブ切替時に実行
      useEffect(() => { 
          if (logsEndRef.current) {
              logsEndRef.current.scrollIntoView({ behavior: 'smooth' }); 
          }
      }, [logs, showSecret, activeTab]);
      
      // ログのフィルタリングとグルーピング（重い処理のためメモ化）
      const groupedLogs = useMemo(() => {
          // 1. 閲覧権限チェック
          // showSecret(神視点)がtrueなら全ログ許可
          // falseなら visibleTo プロパティを確認。指定なしか、自分のuidが含まれる場合のみ許可
          const accessibleLogs = showSecret 
              ? (logs || []) 
              : (logs || []).filter(l => !l.visibleTo || (Array.isArray(l.visibleTo) && l.visibleTo.includes(user?.uid)));

          // 2. タブによるフィルタリング
          const filtered = accessibleLogs.filter(log => {
              // 全表示
              if (activeTab === 'all') return true;
              // 進行タブ: secretフラグなし（全員公開ログ）のみ抽出
              if (activeTab === 'progress') return !log.secret; 
              // 役職タブ: secretフラグあり（秘匿ログ）のみ抽出
              if (activeTab === 'role') return log.secret; 
              return true;
          });

          // 3. 日付ごとのグルーピング処理
          // 構造: [{ day: 1, logs: [...] }, { day: 2, logs: [...] }]
          const groups = [];
          let currentDay = null;
          let currentGroup = null;

          filtered.forEach(log => {
              // day未定義時は0（開始前）扱い
              const day = log.day !== undefined ? log.day : 0; 
              
              // 日付が変わったら新グループ作成
              if (day !== currentDay) {
                  if (currentGroup) groups.push(currentGroup);
                  currentGroup = { day, logs: [] };
                  currentDay = day;
              }
              // 現在のグループに追加
              if (currentGroup) {
                  currentGroup.logs.push(log);
              }
          });
          // 最後のグループをプッシュ
          if (currentGroup) groups.push(currentGroup);

          return groups;
      }, [logs, showSecret, user, activeTab]);
      
      // ログスタイル定義（アイコン、色）決定ロジック
      const getLogStyle = (log) => {
          // 秘匿ログ: 黄色 / 鍵アイコン
          if (log.secret) return {
              icon: Lock,
              color: "text-amber-400",
              bgColor: "bg-amber-500/10",
              borderColor: "border-amber-500/20"
          };
          
          const p = log.phase || "";
          // 夜・行動フェーズ: 紫 / 月アイコン
          if (p.includes("夜") || p.includes("行動")) return { icon: Moon, color: "text-purple-400", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/20" };
          // 昼・朝フェーズ: オレンジ / 太陽アイコン
          if (p.includes("昼") || p.includes("朝")) return { icon: Sun, color: "text-orange-400", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/20" };
          // 投票・処刑フェーズ: 赤 / 木槌アイコン
          if (p.includes("投票") || p.includes("処刑")) return { icon: Gavel, color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/20" };
          // システム・開始: 緑 / チェックアイコン
          if (p.includes("System") || p.includes("開始")) return { icon: CheckCircle2, color: "text-green-400", bgColor: "bg-green-500/10", borderColor: "border-green-500/20" };
          
          // デフォルト: 青 / 情報アイコン
          return { icon: Info, color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20" };
      };

      return (
          <div className="flex flex-col h-full bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/50 overflow-hidden relative shadow-lg">
             {/* ヘッダーエリア */}
             <div className="flex flex-col border-b border-gray-700/50 bg-gray-800/60 backdrop-blur-sm shrink-0 z-20">
                 {/* タイトル行 */}
                 <div className="px-4 py-3 font-bold text-gray-200 text-sm flex justify-between items-center">
                     <span className="flex items-center gap-2 text-blue-100">
                         <FileText size={16} className="text-blue-400 shrink-0"/> ゲームログ
                     </span>
                     {/* 神視点バッジ表示 */}
                     {showSecret && (
                         <span className="text-[10px] bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full border border-yellow-500/30 flex items-center gap-1 shadow-[0_0_10px_rgba(234,179,8,0.2)] animate-pulse whitespace-nowrap">
                             <Eye size={12} className="shrink-0"/> 神視点
                         </span>
                     )}
                 </div>
                 
                 {/* タブコントロール */}
                 <div className="flex px-2 pb-2 gap-1">
                     <button 
                        onClick={() => setActiveTab('all')}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition flex items-center justify-center gap-1 whitespace-nowrap ${activeTab === 'all' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
                     >
                        <ListFilter size={12} className="shrink-0"/> すべて
                     </button>
                     <button 
                        onClick={() => setActiveTab('progress')}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition flex items-center justify-center gap-1 whitespace-nowrap ${activeTab === 'progress' ? 'bg-green-600 text-white shadow-lg shadow-green-500/20' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
                     >
                        <ScrollText size={12} className="shrink-0"/> 進行
                     </button>
                     <button 
                        onClick={() => setActiveTab('role')}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] md:text-xs font-bold transition flex items-center justify-center gap-1 whitespace-nowrap ${activeTab === 'role' ? 'bg-amber-600 text-white shadow-lg shadow-amber-500/20' : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200'}`}
                     >
                        <Lock size={12} className="shrink-0"/> 役職
                     </button>
                 </div>
             </div>

             {/* ログリスト表示エリア */}
             <div className="flex-1 overflow-y-auto p-4 custom-scrollbar scroll-smooth">
                 {groupedLogs.length === 0 ? (
                     // ログなし時
                     <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-70">
                         <Clock size={32} className="mb-2"/>
                         <p className="text-xs font-bold">ログはありません</p>
                     </div>
                 ) : (
                     <div className="space-y-6">
                         {/* 日付グループ毎にレンダリング */}
                         {groupedLogs.map((group) => (
                             <div key={group.day} className="relative">
                                 {/* 日付セパレーター (スティッキー) */}
                                 <div className="sticky top-0 z-10 flex justify-center mb-4">
                                     <span className="bg-gray-800/90 backdrop-blur border border-gray-600 px-4 py-1 rounded-full text-xs font-bold text-gray-300 shadow-md">
                                         {group.day > 0 ? `${group.day}日目` : "ゲーム開始前"}
                                     </span>
                                 </div>

                                 {/* タイムラインレイアウト */}
                                 <div className="relative pl-4 border-l-2 border-gray-800 space-y-4">
                                     {group.logs.map((log, i) => {
                                         const style = getLogStyle(log);
                                         const Icon = style.icon;
                                         
                                         return (
                                           <div key={i} className="flex gap-3 animate-fade-in group relative">
                                               {/* タイムラインドット装飾 */}
                                               <div className={`absolute -left-[21px] top-3 w-3 h-3 rounded-full border-2 border-gray-900 ${style.bgColor.replace('/10', '')} ${style.color}`}></div>
                                               
                                               {/* ログカード本体 */}
                                               <div className={`flex-1 rounded-xl p-3 border ${style.borderColor} ${style.bgColor} relative hover:bg-opacity-80 transition-colors shadow-sm`}>
                                                   <div className="flex items-center gap-2 mb-1.5 opacity-80">
                                                       <Icon size={12} className={`shrink-0 ${style.color}`} />
                                                       <span className={`text-[10px] font-bold ${style.color} uppercase tracking-wider truncate`}>
                                                           {log.phase}
                                                       </span>
                                                       {/* 秘匿アイコン */}
                                                       {log.secret && <Lock size={10} className="text-amber-400 ml-auto shrink-0"/>}
                                                   </div>
                                                   {/* メッセージ本文 */}
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
                 {/* 自動スクロール用アンカー */}
                 <div ref={logsEndRef} className="h-2"></div>
             </div>
          </div>
      );
};