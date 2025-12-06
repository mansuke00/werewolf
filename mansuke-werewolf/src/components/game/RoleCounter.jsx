import React from 'react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';

// ロビー画面用コンポーネント
// 各役職の人数を設定するカウンター行
// ホストのみが操作可能、参加者は閲覧のみ
export const RoleCounter = ({ roleKey, label, count, onChange, isHost }) => (
    <div className="flex items-center justify-between py-3 md:py-4 border-b border-gray-800 hover:bg-gray-800/30 transition px-2 rounded-lg">
      
      {/* 左側：役職情報エリア */}
      <div className="flex flex-col pr-2 min-w-0 flex-1">
        {/* 役職名 */}
        <span className="font-bold text-gray-200 text-sm md:text-lg mb-0.5 md:mb-1 truncate">{label}</span>
        {/* 役職説明文（2行まで表示） */}
        <span className="text-[10px] md:text-xs text-gray-400 leading-tight line-clamp-2 md:line-clamp-1">{ROLE_DEFINITIONS[roleKey]?.desc}</span>
      </div>
      
      {/* 右側：カウンター操作エリア */}
      <div className="flex items-center gap-2 md:gap-4 bg-gray-900/60 p-1.5 md:p-2 rounded-xl border border-gray-700 shrink-0">
        {/* 減算ボタン（ホストのみ表示） */}
        {isHost && (
            <button 
                // 0未満にはならないように制御
                onClick={() => onChange(roleKey, Math.max(0, count - 1))} 
                className="w-8 h-8 md:w-12 md:h-12 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold flex items-center justify-center transition active:scale-95"
            >
                -
            </button>
        )}
        
        {/* 現在の人数表示 */}
        {/* 1人以上なら青色で強調 */}
        <span className={`w-6 md:w-8 text-center font-black text-lg md:text-2xl ${count > 0 ? "text-blue-400" : "text-gray-600"}`}>{count}</span>
        
        {/* 加算ボタン（ホストのみ表示） */}
        {isHost && (
            <button 
                onClick={() => onChange(roleKey, count + 1)} 
                className="w-8 h-8 md:w-12 md:h-12 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold flex items-center justify-center transition active:scale-95"
            >
                +
            </button>
        )}
      </div>
    </div>
);