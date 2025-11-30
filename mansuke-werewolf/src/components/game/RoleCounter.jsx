import React from 'react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';

// ロビーでの役職設定用カウンター
export const RoleCounter = ({ roleKey, label, count, onChange, isHost }) => (
    <div className="flex items-center justify-between py-4 border-b border-gray-800 hover:bg-gray-800/30 transition px-2 rounded-lg">
      <div className="flex flex-col pr-4">
        <span className="font-bold text-gray-200 text-lg mb-1">{label}</span>
        <span className="text-xs text-gray-400 leading-tight">{ROLE_DEFINITIONS[roleKey]?.desc}</span>
      </div>
      <div className="flex items-center gap-4 bg-gray-900/60 p-2 rounded-xl border border-gray-700">
        {isHost && <button onClick={() => onChange(roleKey, Math.max(0, count - 1))} className="w-12 h-12 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold">-</button>}
        <span className={`w-8 text-center font-black text-2xl ${count > 0 ? "text-blue-400" : "text-gray-600"}`}>{count}</span>
        {isHost && <button onClick={() => onChange(roleKey, count + 1)} className="w-12 h-12 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold">+</button>}
      </div>
    </div>
);