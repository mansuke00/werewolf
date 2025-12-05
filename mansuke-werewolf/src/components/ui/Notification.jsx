import React, { useEffect, useState } from 'react';
import { X, Info, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';

export const Notification = ({ message, type = 'info', duration = 3000, onClose }) => {
    const [isVisible, setIsVisible] = useState(true);
    const [isRemoving, setIsRemoving] = useState(false);

    // 自動消去タイマー
    useEffect(() => {
        if (duration && duration > 0) {
            const timer = setTimeout(() => {
                handleClose();
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [duration]);

    const handleClose = () => {
        setIsRemoving(true);
        // アニメーションの時間(300ms)待ってから完全に閉じる
        setTimeout(() => {
            if (onClose) onClose();
        }, 300);
    };

    // タイプ別スタイル設定
    let Icon = Info;
    let containerClass = "bg-gray-800/90 border-gray-600/50 text-blue-100";
    let iconColor = "text-blue-400";

    switch (type) {
        case 'success':
            Icon = CheckCircle;
            containerClass = "bg-green-900/90 border-green-500/50 text-green-100";
            iconColor = "text-green-400";
            break;
        case 'error':
            Icon = AlertCircle;
            containerClass = "bg-red-900/90 border-red-500/50 text-red-100";
            iconColor = "text-red-400";
            break;
        case 'warning':
            Icon = AlertTriangle;
            containerClass = "bg-yellow-900/90 border-yellow-500/50 text-yellow-100";
            iconColor = "text-yellow-400";
            break;
        default:
            // info default
            break;
    }

    return (
        <div 
            className={`fixed top-4 right-4 z-[150] max-w-sm w-full md:w-auto md:min-w-[300px] transition-all duration-300 transform ${
                isRemoving ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
            }`}
        >
            <div className={`flex items-start gap-3 p-4 rounded-xl border shadow-xl backdrop-blur-md ${containerClass}`}>
                <Icon className={`shrink-0 mt-0.5 ${iconColor}`} size={20} />
                <div className="flex-1 pt-0.5">
                    <p className="text-sm font-bold leading-relaxed">{message}</p>
                </div>
                <button 
                    onClick={handleClose} 
                    className="text-white/50 hover:text-white transition shrink-0 p-0.5 hover:bg-white/10 rounded"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
};