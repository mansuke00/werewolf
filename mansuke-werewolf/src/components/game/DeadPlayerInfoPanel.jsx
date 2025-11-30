import React, { useState, useMemo } from 'react';
import { Ghost, List, Grid } from 'lucide-react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';

// 死者（観戦者）専用の全プレイヤー情報パネル
// ネタバレを含むため生存者には表示しないこと
export const DeadPlayerInfoPanel = ({ players, title = "全プレイヤー役職" }) => {
  const [filterType, setFilterType] = useState('name'); 
  
  const sortedPlayers = useMemo(() => {
    const safePlayers = players || [];
    const validPlayers = safePlayers.filter(p => p && p.name);
    
    if (filterType === 'name') {
        return [...validPlayers].sort((a, b) => a.name.localeCompare(b.name));
    } else {
        return [...validPlayers].sort((a, b) => (a.role || '').localeCompare(b.role || ''));
    }
  }, [players, filterType]);
  
  const groupedByRole = useMemo(() => {
    const groups = {};
    const safePlayers = players || [];
    safePlayers.forEach(p => { 
        if(!p) return;
        let r = p.role || 'unknown'; 
        
        // 呪われし者の覚醒状態を区別してグルーピング
        if (p.originalRole === 'cursed') {
            if (p.role === 'werewolf') r = "cursed_awakened";
            else r = "cursed_normal";
        }
        
        if (!groups[r]) groups[r] = []; 
        groups[r].push(p); 
    });
    return groups;
  }, [players]);

  const getRoleDisplayName = (role, p) => {
      if (!role) return "不明"; 
      if (p?.originalRole === 'cursed') {
          if (p.role === 'werewolf') return "呪われし者 - 人狼陣営";
          return "呪われし者 - 市民陣営";
      }
      return ROLE_DEFINITIONS[role]?.name || "不明";
  };

  const getGroupTitle = (key) => {
      if (key === 'cursed_awakened') return "呪われし者 - 人狼陣営";
      if (key === 'cursed_normal') return "呪われし者 - 市民陣営";
      return ROLE_DEFINITIONS[key]?.name || "不明";
  };

  return (
    <div className="h-full bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/50 flex flex-col overflow-hidden">
      <div className="p-3 border-b border-gray-700/50 bg-gray-800/40 flex justify-between items-center shrink-0">
        <span className="font-bold text-gray-300 flex items-center gap-2"><Ghost size={16}/> {title}</span>
        <div className="flex bg-black/30 rounded-lg p-1">
          <button 
            onClick={() => setFilterType('name')} 
            className={`px-3 py-1 text-xs rounded-md transition flex items-center gap-1 ${filterType === 'name' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}
          >
            <List size={12}/> 名前別
          </button>
          <button 
            onClick={() => setFilterType('role')} 
            className={`px-3 py-1 text-xs rounded-md transition flex items-center gap-1 ${filterType === 'role' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}
          >
            <Grid size={12}/> 役職別
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0">
        {filterType === 'name' ? (
          <div className="space-y-2">
            {sortedPlayers.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-black/20 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${p.status === 'alive' ? 'bg-green-500' : p.status === 'disconnected' ? 'bg-gray-500' : 'bg-red-500'}`}></div>
                        <span className="font-bold text-gray-200">{p.name}</span>
                    </div>
                    <span className="text-xs text-gray-400">{getRoleDisplayName(p.role, p)}</span>
                </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedByRole).map(([roleKey, pList]) => (
                <div key={roleKey} className="bg-black/20 rounded-xl border border-white/5 overflow-hidden">
                    <div className="bg-white/5 px-3 py-2 text-xs font-bold text-gray-300 flex items-center gap-2 border-b border-white/5">
                        {getGroupTitle(roleKey)}
                    </div>
                    <div className="p-2 space-y-1">
                        {pList.map(p => (
                            <div key={p.id} className="flex items-center justify-between px-2 py-1">
                                <span className={`text-sm ${p.status === 'alive' ? 'text-gray-300' : 'text-red-400 line-through'}`}>{p.name}</span>
                                <span className="text-[10px] text-gray-500">{p.status === 'alive' ? '生存' : p.status === 'disconnected' ? '回線落ち' : '死亡'}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};