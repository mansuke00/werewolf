import React from 'react';
import { User, Loader } from 'lucide-react';
import { ROLE_DEFINITIONS, TIME_LIMITS } from '../../constants/gameData';

// 役職発表画面（アニメーション付き）
export const RoleRevealScreen = ({ role, teammates }) => {
    if (!role) return <div className="min-h-screen bg-black flex items-center justify-center text-white"><Loader className="animate-spin mb-4"/>Retrieving Role...</div>;
    const roleDef = ROLE_DEFINITIONS[role] || ROLE_DEFINITIONS['citizen'];
    const Icon = roleDef?.icon || User;
    // 人狼チームなら赤、それ以外は青系の背景
    const isWolfTeam = ['werewolf','greatwolf','madman'].includes(ROLE_DEFINITIONS[role]?.team);
    
    return (
        <div className={`fixed inset-0 flex flex-col items-center justify-center z-[90] p-6 text-center text-white transition-colors duration-1000 ${isWolfTeam ? 'bg-red-950':'bg-indigo-950'}`}>
            <div className="animate-fade-in-up space-y-6 max-w-lg w-full">
                <p className="text-gray-300 text-lg font-medium tracking-widest uppercase mb-4">YOUR ROLE</p>
                <div className={`mx-auto w-40 h-40 rounded-full flex items-center justify-center mb-6 shadow-2xl ${isWolfTeam ? "bg-red-600" : "bg-blue-600"} ring-8 ring-white/10`}><Icon size={80} className="text-white" /></div>
                <h2 className={`text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r ${isWolfTeam ? "from-red-400 to-orange-400" : "from-blue-400 to-cyan-400"}`}>{roleDef?.name}</h2>
                <div className="bg-black/30 backdrop-blur-md p-6 rounded-2xl border border-white/10 mt-8"><p className="text-gray-200 text-lg leading-relaxed font-medium">{roleDef?.desc}</p></div>
                {teammates && teammates.length > 0 && (<div className="mt-8 animate-fade-in delay-1000 bg-white/10 p-4 rounded-xl border border-white/20"><p className="text-sm text-gray-300 mb-2 font-bold uppercase tracking-wider">仲間</p><div className="flex flex-wrap justify-center gap-3">{teammates.map(t => (<span key={t.id} className="px-4 py-2 bg-black/40 rounded-full text-white font-bold border border-white/20">{t.name} ({ROLE_DEFINITIONS[t.role]?.name})</span>))}</div></div>)}
            </div>
            {/* 時間経過バー */}
            <div className="absolute bottom-10 w-full px-10"><div className="h-1 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-white animate-progress-bar w-full origin-left" style={{ animationDuration: `${TIME_LIMITS.ROLE_REVEAL}s` }}></div></div></div>
        </div>
    );
};