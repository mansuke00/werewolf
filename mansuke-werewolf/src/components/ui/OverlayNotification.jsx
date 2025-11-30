import React, { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';

// 画面全体を覆う通知（フェーズ切り替え時などに使用）
export const OverlayNotification = ({ title, subtitle, duration = 5000, isNight, onComplete }) => {
    const [count, setCount] = useState(duration / 1000);
    
    // タイマー制御
    useEffect(() => {
        if (count > 0) { const t = setTimeout(() => setCount(c => c - 1), 1000); return () => clearTimeout(t); } 
        else if (onComplete) { onComplete(); }
    }, [count, onComplete]);
    
    return (
        <div className={`fixed inset-0 z-[110] flex flex-col items-center justify-center text-center animate-fade-in-out pointer-events-none ${isNight ? "bg-indigo-950/95" : "bg-orange-50/95"}`}>
            <div className={`p-12 rounded-3xl shadow-2xl max-w-3xl w-full mx-4 ${isNight ? "bg-gray-900 border border-purple-500/50 text-white" : "bg-white border border-orange-200 text-gray-800"}`}>
                <div className="mb-6 animate-bounce">{isNight ? <Moon size={80} className="text-purple-400 mx-auto"/> : <Sun size={80} className="text-orange-500 mx-auto"/>}</div>
                {title && <h2 className="text-5xl font-black mb-6 tracking-wider leading-tight">{title}</h2>}
                {/* 以前は<p>タグ内に<div>を入れていたためHydration Errorが発生していた。<div>に変更して修正済み */}
                <div className="text-2xl font-bold opacity-80 mb-8 whitespace-pre-wrap">{subtitle}</div>
                <div className="text-5xl font-black opacity-30">あと {Math.ceil(count)} 秒</div>
            </div>
        </div>
    );
};