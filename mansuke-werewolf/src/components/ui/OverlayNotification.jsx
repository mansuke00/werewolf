import React, { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';

// コンポーネント: 全画面オーバーレイ通知
// 用途: フェーズ切り替え（昼/夜）時のトランジション演出
// props:
// - duration: 表示時間(ms)。デフォルト3000ms
// - onComplete: 完了時コールバック
export const OverlayNotification = ({ title, subtitle, duration = 3000, isNight, onComplete }) => {
    // 初期状態: duration(ms)を秒単位(s)に変換して管理
    const [count, setCount] = useState(duration / 1000);
    
    // タイマー制御ロジック
    // 1秒ごとにカウントダウン
    useEffect(() => {
        if (count > 0) { 
            const t = setTimeout(() => setCount(c => c - 1), 1000); 
            // クリーンアップ関数: アンマウント時のタイマー解除
            return () => clearTimeout(t); 
        } 
        else if (onComplete) { 
            // カウント0で完了処理発火
            onComplete(); 
        }
    }, [count, onComplete]);
    
    return (
        // ルート要素: 画面全体を覆う (fixed inset-0)
        // Z-index: 110 (他のUIより最前面に表示)
        // 操作ブロック: pointer-events-none (背後の要素へのクリック透過、ただし視覚的にはブロック)
        // 背景色: テーマに応じて切り替え (透過度95%)
        <div className={`fixed inset-0 z-[110] flex flex-col items-center justify-center text-center animate-fade-in pointer-events-none ${isNight ? "bg-indigo-950/95" : "bg-orange-50/95"}`}>
            
            {/* 通知カードコンテナ */}
            {/* レスポンシブ: SPは幅90%・padding小 / PCは幅固定・padding大 */}
            {/* テーマ: 夜は暗色背景+紫枠 / 昼は白背景+オレンジ枠 */}
            <div className={`p-6 md:p-12 rounded-3xl shadow-2xl max-w-3xl w-[90%] md:w-full mx-4 ${isNight ? "bg-gray-900 border border-purple-500/50 text-white" : "bg-white border border-orange-200 text-gray-800"}`}>
                
                {/* アイコン表示エリア */}
                {/* マージン: SP/PCで調整 */}
                <div className="mb-4 md:mb-6">
                    {/* 条件分岐: 夜/昼アイコン切り替え */}
                    {/* サイズ: SP(w-12) / PC(w-20) */}
                    {isNight ? 
                        <Moon className="text-purple-400 mx-auto w-12 h-12 md:w-20 md:h-20"/> : 
                        <Sun className="text-orange-500 mx-auto w-12 h-12 md:w-20 md:h-20"/>
                    }
                </div>
                
                {/* タイトル (任意表示) */}
                {/* フォント: 太字・トラッキング広め */}
                {/* サイズ: SP(3xl) / PC(5xl) */}
                {title && <h2 className="text-3xl md:text-5xl font-black mb-4 md:mb-6 tracking-wider leading-tight">{title}</h2>}
                
                {/* サブタイトル */}
                {/* 改行対応: whitespace-pre-wrap */}
                {/* 透明度: 80%で視認性調整 */}
                <div className="text-lg md:text-2xl font-bold opacity-80 mb-6 md:mb-8 whitespace-pre-wrap leading-relaxed">
                    {subtitle}
                </div>
                
                {/* カウントダウン表示 */}
                {/* Math.ceil: 切り上げ表示 (例: 0.9秒 -> "あと1秒") */}
                {/* 透明度: 30% (控えめな表示) */}
                <div className="text-3xl md:text-5xl font-black opacity-30">
                    あと {Math.ceil(count)} 秒
                </div>
            </div>
        </div>
    );
};