import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';

// 全画面で表示する重要な通知（夜の開始、朝の死体発見など）
export const OverlayNotification = ({ title, subtitle, duration = 3000, onComplete, isNight = false }) => {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            setVisible(false);
            if (onComplete) setTimeout(onComplete, 500); // フェードアウト後にコールバック
        }, duration);
        return () => clearTimeout(timer);
    }, [duration, onComplete]);

    if (!visible) return null;

    return (
        <div className={`fixed inset-0 z-[200] flex flex-col items-center justify-center p-6 text-center transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'} ${isNight ? "bg-black/90 text-purple-100" : "bg-black/80 text-white"}`}>
            {/* 背景エフェクト */}
            <div className={`absolute inset-0 z-0 ${isNight ? "bg-gradient-to-b from-purple-900/20 to-black" : "bg-gradient-to-b from-blue-900/20 to-black"}`}></div>
            
            <div className="relative z-10 animate-fade-in-up max-w-4xl w-full">
                {title && (
                    <h2 className={`text-4xl md:text-7xl font-black mb-4 md:mb-8 tracking-widest uppercase drop-shadow-2xl ${isNight ? "text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400" : "text-white"}`}>
                        {title}
                    </h2>
                )}
                
                {subtitle && (
                    <div className="text-lg md:text-3xl font-bold leading-relaxed md:leading-relaxed text-gray-200 whitespace-pre-wrap">
                        {subtitle}
                    </div>
                )}
            </div>

            {/* 装飾用ライン */}
            <div className={`absolute bottom-0 left-0 w-full h-1 md:h-2 ${isNight ? "bg-purple-600" : "bg-blue-500"} animate-progress-bar`} style={{ animationDuration: `${duration}ms` }}></div>
        </div>
    );
};