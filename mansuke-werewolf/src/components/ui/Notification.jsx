import React, { useEffect, useState } from 'react';
import { X, Info, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';

// 通知トーストコンポーネント
// 画面右上に一時的にメッセージを表示する
// 自動消去機能あり
export const Notification = ({ message, type = 'info', duration = 3000, onClose }) => {
    // 表示状態（マウント時はtrue）
    const [isVisible, setIsVisible] = useState(true);
    // 退場アニメーション制御用フラグ
    const [isRemoving, setIsRemoving] = useState(false);

    // 自動消去タイマー設定
    // durationが指定されている場合、指定時間後に閉じる処理を実行
    useEffect(() => {
        if (duration && duration > 0) {
            const timer = setTimeout(() => {
                handleClose();
            }, duration);
            // クリーンアップでタイマー解除
            return () => clearTimeout(timer);
        }
    }, [duration]);

    // 閉じる処理
    // 即座に消去せず、退場アニメーションの完了を待ってからコールバックを呼ぶ
    const handleClose = () => {
        setIsRemoving(true);
        // CSS transitionのduration-300に合わせて300ms待機
        setTimeout(() => {
            if (onClose) onClose();
        }, 300);
    };

    // 通知タイプに応じたスタイルとアイコン定義
    // デフォルト: info (青/グレー系)
    let Icon = Info;
    let containerClass = "bg-gray-800/90 border-gray-600/50 text-blue-100";
    let iconColor = "text-blue-400";

    switch (type) {
        case 'success':
            // 成功: 緑系
            Icon = CheckCircle;
            containerClass = "bg-green-900/90 border-green-500/50 text-green-100";
            iconColor = "text-green-400";
            break;
        case 'error':
            // エラー: 赤系
            Icon = AlertCircle;
            containerClass = "bg-red-900/90 border-red-500/50 text-red-100";
            iconColor = "text-red-400";
            break;
        case 'warning':
            // 警告: 黄系
            Icon = AlertTriangle;
            containerClass = "bg-yellow-900/90 border-yellow-500/50 text-yellow-100";
            iconColor = "text-yellow-400";
            break;
        default:
            // info (default)
            break;
    }

    return (
        // 通知コンテナ (固定配置)
        // z-index: 150 (モーダル類と同じか手前)
        // isRemovingフラグに応じてスライド・フェードアウトのアニメーションクラスを適用
        <div 
            className={`fixed top-4 right-4 z-[150] max-w-sm w-full md:w-auto md:min-w-[300px] transition-all duration-300 transform ${
                isRemoving ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
            }`}
        >
            {/* 通知カード本体 */}
            {/* backdrop-blurで背景を少し透かす */}
            <div className={`flex items-start gap-3 p-4 rounded-xl border shadow-xl backdrop-blur-md ${containerClass}`}>
                {/* ステータスアイコン */}
                <Icon className={`shrink-0 mt-0.5 ${iconColor}`} size={20} />
                
                {/* メッセージ本文 */}
                <div className="flex-1 pt-0.5">
                    <p className="text-sm font-bold leading-relaxed">{message}</p>
                </div>
                
                {/* 手動クローズボタン */}
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