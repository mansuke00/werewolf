import React, { useState, useEffect } from 'react';
import { AlertTriangle, Fingerprint, Hash } from 'lucide-react';

// ゲーム開始直前の5秒カウントダウン画面（躍動感のあるアニメーション）
export const CountdownScreen = ({ roomCode, matchId }) => {
    const [count, setCount] = useState(5);
    
    useEffect(() => { 
        if(count > 0) { 
            const t = setTimeout(() => setCount(c => c - 1), 1000); 
            return () => clearTimeout(t); 
        } 
    }, [count]);
    
    // 背景のグラデーションスタイル（カウントに応じて激しく変化）
    const getBgStyle = (c) => {
        switch(c) {
            case 5: return "from-indigo-950 via-purple-950 to-black";
            case 4: return "from-blue-900 via-indigo-900 to-black";
            case 3: return "from-purple-900 via-red-900 to-black";
            case 2: return "from-red-900 via-orange-900 to-black";
            case 1: return "from-orange-600 via-red-600 to-black";
            default: return "bg-black";
        }
    };

    return (
        <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br ${getBgStyle(count)} transition-all duration-500`}>
            
            {/* 躍動感のある背景エフェクト */}
            <div className="absolute inset-0 pointer-events-none">
                {/* 脈動するサークル */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200vw] h-[200vw] bg-white/5 rounded-full animate-pulse-fast blur-3xl"></div>
                
                {/* ランダムに動くパーティクル（簡易的） */}
                <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-blue-500/20 rounded-full blur-xl animate-float-fast"></div>
                <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-purple-500/20 rounded-full blur-xl animate-float-slow"></div>
                
                {/* 集中線的なエフェクト */}
                <div className={`absolute inset-0 bg-[radial-gradient(circle,transparent_20%,#000_120%)] ${count <= 2 ? 'animate-shake' : ''}`}></div>
            </div>

            {/* メインカウントダウン数字 */}
            <div className="relative z-20 flex flex-col items-center justify-center w-full">
                <span 
                    key={count} 
                    className={`text-[30vh] md:text-[45vh] font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-500 leading-tight tracking-tighter drop-shadow-[0_0_50px_rgba(255,255,255,0.5)] animate-zoom-in-bounce select-none font-mono py-8 ${count <= 3 ? 'text-red-500' : ''}`}
                >
                    {count}
                </span>
            </div>

            {/* 下部情報パネル */}
            <div className="absolute bottom-12 left-0 w-full px-6 flex flex-col items-center gap-8 z-30">
                <div className="flex items-center gap-8 md:gap-16 opacity-90 bg-black/40 px-6 py-2 rounded-2xl backdrop-blur-sm border border-white/10">
                        <div className="flex flex-col items-center group">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1 flex items-center gap-1"><Hash size={10}/> Room Code</span>
                            <span className="text-2xl font-mono font-bold text-white tracking-widest">{roomCode || "----"}</span>
                        </div>
                        <div className="h-8 w-px bg-white/20"></div>
                        <div className="flex flex-col items-center group">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1 flex items-center gap-1"><Fingerprint size={10}/> Match ID</span>
                            <span className="text-sm font-mono font-bold text-white/80">{matchId || "Loading..."}</span>
                        </div>
                </div>

                <div className="bg-red-600/30 border border-red-500/50 px-8 py-3 rounded-full backdrop-blur-md animate-pulse shadow-[0_0_20px_rgba(220,38,38,0.4)]">
                    <p className="text-sm md:text-base text-white font-bold flex items-center justify-center gap-2 drop-shadow-md">
                        <AlertTriangle size={18} className="shrink-0 text-red-400"/> 
                        <span>他のプレイヤーに見せないでください</span>
                    </p>
                </div>
            </div>

            <style>{`
                @keyframes zoom-in-bounce {
                    0% { transform: scale(2); opacity: 0; filter: blur(10px); }
                    60% { transform: scale(0.9); opacity: 1; filter: blur(0px); }
                    100% { transform: scale(1); opacity: 1; }
                }
                .animate-zoom-in-bounce { animation: zoom-in-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
                
                @keyframes pulse-fast {
                    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.1; }
                    50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.3; }
                }
                .animate-pulse-fast { animation: pulse-fast 0.5s infinite; }

                @keyframes float-fast {
                    0% { transform: translate(0, 0); }
                    50% { transform: translate(20px, -20px); }
                    100% { transform: translate(0, 0); }
                }
                .animate-float-fast { animation: float-fast 2s infinite ease-in-out; }

                @keyframes float-slow {
                    0% { transform: translate(0, 0); }
                    50% { transform: translate(-20px, 20px); }
                    100% { transform: translate(0, 0); }
                }
                .animate-float-slow { animation: float-slow 3s infinite ease-in-out; }

                @keyframes shake {
                    0% { transform: translate(1px, 1px) rotate(0deg); }
                    10% { transform: translate(-1px, -2px) rotate(-1deg); }
                    20% { transform: translate(-3px, 0px) rotate(1deg); }
                    30% { transform: translate(3px, 2px) rotate(0deg); }
                    40% { transform: translate(1px, -1px) rotate(1deg); }
                    50% { transform: translate(-1px, 2px) rotate(-1deg); }
                    60% { transform: translate(-3px, 1px) rotate(0deg); }
                    70% { transform: translate(3px, 1px) rotate(-1deg); }
                    80% { transform: translate(-1px, -1px) rotate(1deg); }
                    90% { transform: translate(1px, 2px) rotate(0deg); }
                    100% { transform: translate(1px, -2px) rotate(-1deg); }
                }
                .animate-shake { animation: shake 0.5s infinite; }
            `}</style>
        </div>
    );
};