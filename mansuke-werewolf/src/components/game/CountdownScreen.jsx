import React, { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

// ゲーム開始直前の5秒カウントダウン画面
// 他人に見られないよう注意喚起する
export const CountdownScreen = () => {
    const [count, setCount] = useState(5);
    useEffect(() => { if(count > 0) { const t = setTimeout(() => setCount(c => c - 1), 1000); return () => clearTimeout(t); } }, [count]);
    return <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black overflow-hidden"><div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900 via-black to-black"></div><div className="absolute inset-0 opacity-30 bg-[size:50px_50px] bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)]"></div><div key={count} className="relative z-10"><span className="text-[15rem] font-black text-transparent bg-clip-text bg-gradient-to-b from-blue-500 to-purple-900 leading-none animate-ping-number">{count}</span></div><div className="relative z-10 mt-12 text-center space-y-4"><p className="text-2xl md:text-4xl font-bold text-white tracking-[0.5em] uppercase animate-pulse">Game Starting</p><div className="bg-red-900/40 border border-red-500/50 px-6 py-3 rounded-full backdrop-blur-md animate-bounce-slow"><p className="text-sm md:text-lg text-red-300 font-bold flex items-center gap-2"><AlertTriangle size={20}/> 他のプレイヤーに画面を見られないように注意してください</p></div></div></div>;
};