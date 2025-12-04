import React, { useState, useEffect } from 'react';
import { AlertTriangle, Fingerprint, Hash } from 'lucide-react';

// ゲーム開始直前の5秒カウントダウン画面（全画面演出・背景連動型）
export const CountdownScreen = ({ roomCode, matchId }) => {
    const [count, setCount] = useState(5);
    
    useEffect(() => { 
        if(count > 0) { 
            const t = setTimeout(() => setCount(c => c - 1), 1000); 
            return () => clearTimeout(t); 
        } 
    }, [count]);
    
    // カウントに応じた背景色の定義
    const bgColors = {
        5: "bg-indigo-950",
        4: "bg-blue-950",
        3: "bg-purple-950",
        2: "bg-red-950",
        1: "bg-black",
        0: "bg-black"
    };

    // カウントに応じた円のスケール（5から1に向かって縮小）
    const scale = count / 5;

    return (
        <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center transition-colors duration-1000 ease-in-out overflow-hidden ${bgColors[count] || "bg-black"}`}>
            
            {/* 背景の動的サークル演出 */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div 
                    className="rounded-full border border-white/10 bg-white/5 transition-all duration-1000 ease-linear"
                    style={{ 
                        width: '150vmax', 
                        height: '150vmax', 
                        transform: `scale(${scale})`,
                        opacity: count > 0 ? 1 : 0
                    }}
                />
                <div 
                    className="absolute rounded-full border border-white/5"
                    style={{ 
                        width: '100vmax', 
                        height: '100vmax', 
                        transform: `scale(${scale * 1.5})`,
                        opacity: 0.3
                    }}
                />
            </div>

            {/* メインカウントダウン数字 */}
            <div className="relative z-20 flex flex-col items-center justify-center">
                <span 
                    key={count} 
                    className="text-[30vh] md:text-[40vh] font-bold text-white leading-none tracking-tighter drop-shadow-2xl animate-pop-in select-none font-mono"
                >
                    {count}
                </span>
            </div>

            {/* 下部情報パネル */}
            <div className="absolute bottom-12 left-0 w-full px-6 flex flex-col items-center gap-8 z-30">
                <div className="flex items-center gap-8 md:gap-16 opacity-70">
                        <div className="flex flex-col items-center group">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1 flex items-center gap-1"><Hash size={10}/> Room Code</span>
                            <span className="text-3xl font-mono font-bold text-white tracking-widest">{roomCode || "----"}</span>
                        </div>
                        <div className="h-10 w-px bg-white/20"></div>
                        <div className="flex flex-col items-center group">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1 flex items-center gap-1"><Fingerprint size={10}/> Match ID</span>
                            <span className="text-xl font-mono font-bold text-white/80">{matchId || "Loading..."}</span>
                        </div>
                </div>

                <div className="bg-red-500/20 border border-red-500/30 px-8 py-3 rounded-full backdrop-blur-md animate-pulse">
                    <p className="text-sm md:text-base text-red-200 font-bold flex items-center justify-center gap-2">
                        <AlertTriangle size={18} className="shrink-0"/> 
                        <span>この画面を他のプレイヤーに見せないでください</span>
                    </p>
                </div>
            </div>

            <style>{`
                @keyframes pop-in {
                    0% { transform: scale(1.5); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                .animate-pop-in { animation: pop-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
            `}</style>
        </div>
    );
};