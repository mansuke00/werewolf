import React, { useState, useEffect } from 'react';
import { AlertTriangle, Fingerprint, Hash } from 'lucide-react';

// ゲーム開始前の5秒カウントダウン画面
// 状態管理、タイマー処理、動的なスタイル適用を行うコンポーネント
export const CountdownScreen = ({ roomCode, matchId }) => {
    // カウントダウン用の状態変数。初期値5
    const [count, setCount] = useState(5);
    
    // タイマー処理の副作用フック
    useEffect(() => { 
        // カウントが0より大きい場合のみ実行
        if(count > 0) { 
            // 1秒後にカウントを1減らす
            const t = setTimeout(() => setCount(c => c - 1), 1000); 
            // クリーンアップ関数：コンポーネントアンマウント時や再実行時にタイマー解除
            return () => clearTimeout(t); 
        } 
        // countの変化をトリガーに再実行
    }, [count]);
    
    // 現在のカウントに応じて背景グラデーションのCSSクラスを返す関数
    // カウントダウンが進むにつれて色が変化し、緊張感を高める演出
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
        // ルート要素：全画面固定表示、動的背景グラデーション、トランジション設定
        // z-indexを高く設定し最前面に表示
        <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br ${getBgStyle(count)} transition-all duration-500`}>
            
            {/* 背景エフェクトレイヤー */}
            {/* pointer-events-noneで操作を阻害しないように設定 */}
            <div className="absolute inset-0 pointer-events-none">
                {/* 中央で脈動する大きな円形エフェクト */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200vw] h-[200vw] bg-white/5 rounded-full animate-pulse-fast blur-3xl"></div>
                
                {/* 背景で浮遊するパーティクルエフェクト（左上、右下） */}
                <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-blue-500/20 rounded-full blur-xl animate-float-fast"></div>
                <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-purple-500/20 rounded-full blur-xl animate-float-slow"></div>
                
                {/* 放射状のグラデーションと振動エフェクト */}
                {/* カウントが2以下になったら振動アニメーション（animate-shake）を適用 */}
                <div className={`absolute inset-0 bg-[radial-gradient(circle,transparent_20%,#000_120%)] ${count <= 2 ? 'animate-shake' : ''}`}></div>
            </div>

            {/* カウントダウン数字表示エリア */}
            <div className="relative z-20 flex flex-col items-center justify-center w-full">
                {/* key={count}を指定することで、カウント変化時に再レンダリングを強制しアニメーションをリプレイさせる */}
                {/* レスポンシブなフォントサイズ、グラデーションテキスト、バウンスアニメーションを適用 */}
                {/* カウントが3以下でテキスト色を赤に変更 */}
                <span 
                    key={count} 
                    className={`text-7xl sm:text-8xl md:text-[8rem] lg:text-[10rem] font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-500 leading-tight tracking-tighter drop-shadow-[0_0_50px_rgba(255,255,255,0.5)] animate-zoom-in-bounce select-none font-mono py-8 ${count <= 3 ? 'text-red-500' : ''}`}
                >
                    {count}
                </span>
            </div>

            {/* 画面下部の情報パネル */}
            <div className="absolute bottom-12 left-0 w-full px-6 flex flex-col items-center gap-8 z-30">
                {/* ルーム情報表示エリア（Room Code, Match ID） */}
                {/* 半透明背景とブラー効果 */}
                <div className="flex items-center gap-8 md:gap-16 opacity-90 bg-black/40 px-6 py-2 rounded-2xl backdrop-blur-sm border border-white/10">
                        <div className="flex flex-col items-center group">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1 flex items-center gap-1"><Hash size={10}/> Room Code</span>
                            {/* propsが存在しない場合のフォールバック表示 */}
                            <span className="text-2xl font-mono font-bold text-white tracking-widest">{roomCode || "----"}</span>
                        </div>
                        {/* 区切り線 */}
                        <div className="h-8 w-px bg-white/20"></div>
                        <div className="flex flex-col items-center group">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-1 flex items-center gap-1"><Fingerprint size={10}/> Match ID</span>
                            {/* propsが存在しない場合のフォールバック表示 */}
                            <span className="text-sm font-mono font-bold text-white/80">{matchId || "Loading..."}</span>
                        </div>
                </div>

                {/* 警告メッセージ表示エリア */}
                {/* 赤系の強調スタイル */}
                <div className="bg-red-600/30 border border-red-500/50 px-8 py-3 rounded-full backdrop-blur-md shadow-[0_0_20px_rgba(220,38,38,0.4)]">
                    <p className="text-sm md:text-base text-white font-bold flex items-center justify-center gap-2 drop-shadow-md">
                        <AlertTriangle size={18} className="shrink-0 text-red-400"/> 
                        <span>他のプレイヤーに見せないでください</span>
                    </p>
                </div>
            </div>

            {/* カスタムCSSアニメーション定義 */}
            <style>{`
                /* 数字が出現する際の拡大縮小バウンス効果 */
                @keyframes zoom-in-bounce {
                    0% { transform: scale(2); opacity: 0; filter: blur(10px); }
                    60% { transform: scale(0.9); opacity: 1; filter: blur(0px); }
                    100% { transform: scale(1); opacity: 1; }
                }
                .animate-zoom-in-bounce { animation: zoom-in-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
                
                /* 背景サークルの速い脈動アニメーション */
                @keyframes pulse-fast {
                    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.1; }
                    50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.3; }
                }
                .animate-pulse-fast { animation: pulse-fast 0.5s infinite; }

                /* パーティクルの浮遊アニメーション（速め） */
                @keyframes float-fast {
                    0% { transform: translate(0, 0); }
                    50% { transform: translate(20px, -20px); }
                    100% { transform: translate(0, 0); }
                }
                .animate-float-fast { animation: float-fast 2s infinite ease-in-out; }

                /* パーティクルの浮遊アニメーション（遅め） */
                @keyframes float-slow {
                    0% { transform: translate(0, 0); }
                    50% { transform: translate(-20px, 20px); }
                    100% { transform: translate(0, 0); }
                }
                .animate-float-slow { animation: float-slow 3s infinite ease-in-out; }

                /* 画面全体の振動アニメーション（カウント終盤で使用） */
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