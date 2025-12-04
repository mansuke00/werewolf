import React, { useState, useEffect } from 'react';
import { AlertTriangle, Fingerprint, Hash } from 'lucide-react';

// ゲーム開始直前の5秒カウントダウン画面
// シンプルかつ緊張感のある全画面光呼吸演出
export const CountdownScreen = ({ roomCode, matchId }) => {
    const [count, setCount] = useState(5);
    
    useEffect(() => { 
        if(count > 0) { 
            const t = setTimeout(() => setCount(c => c - 1), 1000); 
            return () => clearTimeout(t); 
        } 
    }, [count]);
    
    // カウントダウンに応じた背景色と光の強度
    const getStyles = (c) => {
        switch(c) {
            case 5: return { bg: "bg-slate-900", shadow: "shadow-indigo-500/20", text: "text-indigo-200" };
            case 4: return { bg: "bg-indigo-950", shadow: "shadow-blue-500/30", text: "text-blue-200" };
            case 3: return { bg: "bg-purple-950", shadow: "shadow-purple-500/40", text: "text-purple-200" };
            case 2: return { bg: "bg-rose-950", shadow: "shadow-rose-500/50", text: "text-rose-200" };
            case 1: return { bg: "bg-red-950", shadow: "shadow-red-500/60", text: "text-red-200" };
            default: return { bg: "bg-black", shadow: "shadow-none", text: "text-white" };
        }
    };

    const style = getStyles(count);

    return (
        <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden transition-colors duration-1000 ease-out ${style.bg}`}>
            
            {/* 背景の呼吸する光 */}
            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-1000 ${count === 0 ? 'opacity-0' : 'opacity-100'}`}>
                <div className={`w-[60vw] h-[60vw] rounded-full bg-white/5 blur-[100px] animate-pulse-slow ${style.shadow}`}></div>
            </div>

            {/* グリッドとノイズ */}
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10"></div>
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_at_center,black_50%,transparent_100%)]"></div>

            {/* メインカウントダウン */}
            <div className="relative z-20 flex flex-col items-center justify-center">
                <span 
                    key={count}
                    className={`text-[25vh] md:text-[45vh] font-bold leading-none tracking-tighter drop-shadow-2xl select-none font-mono transition-colors duration-300 ${style.text} ${count > 0 ? "animate-scale-fade" : ""}`}
                >
                    {count}
                </span>
            </div>

            {/* 警告通知（カウントダウン下部に移動） */}
            <div className="absolute bottom-24 md:bottom-40 left-0 w-full z-30 flex justify-center">
                <div className="bg-red-900/40 border border-red-500/50 px-4 py-3 md:px-8 md:py-4 rounded-full backdrop-blur-md animate-pulse shadow-[0_0_30px_rgba(220,38,38,0.4)] max-w-[90%] md:max-w-md mx-4 text-center">
                    <p className="text-xs md:text-lg text-red-200 font-bold flex items-center justify-center gap-2 tracking-wider">
                        <AlertTriangle size={16} className="shrink-0 md:w-5 md:h-5"/> 
                        <span>画面を誰にも見られないようにしてください</span>
                    </p>
                </div>
            </div>

            {/* 下部情報バー */}
            <div className="absolute bottom-0 w-full bg-black/60 backdrop-blur-lg border-t border-white/5 p-4 md:p-8 flex justify-between items-center z-30">
                <div className="flex gap-6 md:gap-12 opacity-60">
                    <div className="flex flex-col">
                        <span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase tracking-[0.3em] flex items-center gap-1 md:gap-2 mb-1"><Hash size={10}/> Room Code</span>
                        <span className="text-xl md:text-2xl font-mono font-bold text-white tracking-widest">{roomCode}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase tracking-[0.3em] flex items-center gap-1 md:gap-2 mb-1"><Fingerprint size={10}/> Match ID</span>
                        <span className="text-xl md:text-2xl font-mono font-bold text-white tracking-widest">{matchId}</span>
                    </div>
                </div>
                <div className="text-right hidden md:block">
                    <p className="text-xs text-gray-500 font-bold tracking-widest mb-1">SYSTEM STATUS: NORMAL</p>
                    <p className="text-[10px] text-gray-600">DO NOT SHARE YOUR SCREEN</p>
                </div>
            </div>

            <style>{`
                @keyframes pulse-slow {
                    0%, 100% { transform: scale(1); opacity: 0.5; }
                    50% { transform: scale(1.1); opacity: 0.8; }
                }
                .animate-pulse-slow { animation: pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
                
                @keyframes scale-fade {
                    0% { transform: scale(0.9); opacity: 0; }
                    10% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(1.1); opacity: 1; }
                }
                .animate-scale-fade { animation: scale-fade 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
            `}</style>
        </div>
    );
};