import React, { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';

// 画面全体を覆う通知（フェーズ切り替え時などに使用）
export const OverlayNotification = ({ title, subtitle, duration = 3000, isNight, onComplete }) => {
    const [count, setCount] = useState(duration / 1000);
    
    // タイマー制御
    useEffect(() => {
        if (count > 0) { const t = setTimeout(() => setCount(c => c - 1), 1000); return () => clearTimeout(t); } 
        else if (onComplete) { onComplete(); }
    }, [count, onComplete]);
    
    return (
        <div className={`fixed inset-0 z-[110] flex flex-col items-center justify-center text-center animate-fade-in pointer-events-none ${isNight ? "bg-indigo-950/95" : "bg-orange-50/95"}`}>
            {/* レスポンシブ対応: パディングを縮小(p-6)、幅を調整(w-[90%]) */}
            <div className={`p-6 md:p-12 rounded-3xl shadow-2xl max-w-3xl w-[90%] md:w-full mx-4 ${isNight ? "bg-gray-900 border border-purple-500/50 text-white" : "bg-white border border-orange-200 text-gray-800"}`}>
                {/* アイコンサイズをスマホでは小さく(w-12)、PCでは元のサイズ(w-20)に。上下のアニメーション(animate-bounce)は削除 */}
                <div className="mb-4 md:mb-6">
                    {isNight ? 
                        <Moon className="text-purple-400 mx-auto w-12 h-12 md:w-20 md:h-20"/> : 
                        <Sun className="text-orange-500 mx-auto w-12 h-12 md:w-20 md:h-20"/>
                    }
                </div>
                
                {/* タイトル文字サイズ調整 */}
                {title && <h2 className="text-3xl md:text-5xl font-black mb-4 md:mb-6 tracking-wider leading-tight">{title}</h2>}
                
                {/* サブタイトル文字サイズ調整 */}
                <div className="text-lg md:text-2xl font-bold opacity-80 mb-6 md:mb-8 whitespace-pre-wrap leading-relaxed">
                    {subtitle}
                </div>
                
                {/* カウントダウン文字サイズ調整 */}
                <div className="text-3xl md:text-5xl font-black opacity-30">
                    あと {Math.ceil(count)} 秒
                </div>
            </div>
        </div>
    );
};