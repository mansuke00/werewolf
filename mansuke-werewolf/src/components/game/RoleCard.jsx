import React, { useState } from 'react';
import { EyeOff } from 'lucide-react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';

// 画面左上常時表示コンポーネント
// 自分の役職、仲間確認用
// 長押し時のみ中身表示（覗き見防止仕様）
export const MiniRoleCard = ({ role, teammates, originalRole }) => {
  // 表示状態管理
  // false: 隠す（デフォルト）
  // true: 表示
  const [revealed, setRevealed] = useState(false);
  
  // role未定義時の安全策
  // 定義がない場合は市民として扱う
  const safeRole = role && ROLE_DEFINITIONS[role] ? role : 'citizen';
  const roleDef = ROLE_DEFINITIONS[safeRole];
  
  // teammates配列の安全性確保
  const safeTeammates = Array.isArray(teammates) ? teammates.filter(t => t && t.name) : [];
  
  // 仲間リスト非表示役職定義
  // 妖狐、呪われし者などはシステム上仲間がいても表示しない
  const hiddenTeammateRoles = ['citizen', 'killer', 'cursed', 'elder', 'fox', 'teruteru'];
  
  // 表示名決定ロジック
  // 呪われし者は所属陣営によって表記変更
  let displayName = roleDef?.name;
  if (originalRole === 'cursed') {
      if (role === 'werewolf') displayName = "呪われし者 - 人狼陣営";
      else displayName = "呪われし者 - 市民陣営";
  }

  return (
      <div 
        className="relative bg-gradient-to-br from-indigo-900 to-purple-900 rounded-2xl p-4 text-center select-none cursor-pointer overflow-hidden border border-indigo-500/30 shadow-lg group touch-none h-40 md:h-56 flex flex-col items-center justify-center transition-transform active:scale-95 shrink-0"
        // PC用イベント（マウス操作）
        onMouseDown={() => setRevealed(true)}
        onMouseUp={() => setRevealed(false)}
        onMouseLeave={() => setRevealed(false)}
        // スマホ用イベント（タッチ操作）
        onTouchStart={() => setRevealed(true)}
        onTouchEnd={() => setRevealed(false)}
      >
          {/* 中身（役職情報） */}
          {/* revealedステートに応じてぼかし/透明度制御 */}
          <div className={`transition-all duration-200 w-full ${revealed ? "blur-0 opacity-100" : "blur-md opacity-50"}`}>
             {/* 役職アイコン */}
             {roleDef?.icon && React.createElement(roleDef.icon, { size: 32, className: "mx-auto mb-1 md:mb-2 text-white w-6 h-6 md:w-8 md:h-8" })}
             {/* 役職名 */}
             <h3 className="text-lg md:text-xl font-black text-white mb-1">{displayName}</h3>
             
             {/* 詳細情報（表示時のみレンダリング） */}
             {revealed && (
               <div className="animate-fade-in space-y-1 md:space-y-2 bg-black/20 p-2 rounded-lg">
                   {/* 役職説明文 */}
                   <p className="text-[10px] md:text-[11px] text-indigo-100 leading-tight px-1">{roleDef?.desc}</p>
                   
                   {/* 仲間リスト表示エリア */}
                   <div className="pt-1 border-t border-white/10 mt-1">
                       <p className="text-[9px] md:text-[10px] text-red-300 font-bold mb-0.5">【仲間】</p>
                       <p className="text-[9px] md:text-[10px] text-white">
                           {/* 仲間がいる かつ 非表示対象役職でない場合のみリスト表示 */}
                           {safeTeammates.length > 0 && !hiddenTeammateRoles.includes(safeRole)
                             ? safeTeammates.map(t => `${t.name}(${ROLE_DEFINITIONS[t.role]?.name || '不明'})`).join(', ')
                             : (hiddenTeammateRoles.includes(safeRole) ? "非公開" : "なし")
                           }
                       </p>
                   </div>
               </div>
             )}
          </div>
          
          {/* マスク時（非表示時）のオーバーレイ */}
          {/* 長押し誘導メッセージ */}
          {!revealed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10 pointer-events-none p-4">
                  <EyeOff size={24} md:size={28} className="mb-2 opacity-80"/>
                  <span className="text-[10px] md:text-xs font-bold tracking-widest uppercase leading-tight mt-2">長押しして自分の役職と仲間を確認</span>
              </div>
          )}
      </div>
  );
};