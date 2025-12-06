import React, { useState, useEffect, useRef } from 'react';
import { Gavel, User, AlertOctagon } from 'lucide-react';

// 投票結果および処刑結果を表示するモーダルコンポーネント
// 全画面オーバーレイで表示される
export const VotingResultModal = ({ voteSummary, players, anonymousVoting, executionResult, onClose }) => {
    // カウントダウン表示用State
    // 10秒だと長すぎるため、バグも含めてテンポ重視で5秒に短縮設定
    const [timeLeft, setTimeLeft] = useState(5);
    
    // タイマー管理用Ref
    // setInterval内での値の整合性を保つため、Stateとは別にRefで数値を管理
    const timerRef = useRef(5);

    // タイマー処理の副作用
    // マウント時にカウントダウン開始
    useEffect(() => {
        const interval = setInterval(() => {
            // Refを減算してからStateに反映させる
            timerRef.current -= 1;
            setTimeLeft(timerRef.current);
            
            // 0秒になったらクリアして閉じる処理を実行
            if (timerRef.current <= 0) {
                clearInterval(interval);
                onClose();
            }
        }, 1000);

        // アンマウント時のクリーンアップ
        return () => clearInterval(interval);
    }, [onClose]);

    // プレイヤー名解決ヘルパー
    // IDから名前を取得。スキップや不明な場合のフォールバック処理含む
    const getPlayerName = (id) => {
        if (id === 'skip') return 'スキップ';
        return players.find(p => p.id === id)?.name || '不明';
    };

    return (
        // z-index: 150 (最前面表示)
        // 背景は黒の半透明 + ブラー効果
        <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[150] flex flex-col items-center justify-center p-4 md:p-6 animate-fade-in">
            <div className="w-full max-w-3xl flex flex-col h-full max-h-[90vh]">
                
                {/* ヘッダーエリア: タイトルと残り時間 */}
                <div className="flex items-center justify-between mb-6 md:mb-8 shrink-0">
                    <div className="flex items-center gap-3 md:gap-4">
                        <Gavel size={32} md:size={48} className="text-red-500 animate-bounce shrink-0" />
                        <div>
                            <h2 className="text-2xl md:text-4xl font-black text-white tracking-widest">開票結果</h2>
                            <p className="text-xs md:text-base text-gray-400">Voting Results</p>
                        </div>
                    </div>
                    {/* タイマー表示サークル */}
                    <div className="w-14 h-14 md:w-20 md:h-20 rounded-full border-4 border-red-500/30 flex items-center justify-center bg-gray-900/50 shrink-0">
                        <span className="text-xl md:text-3xl font-black text-red-500">{timeLeft}</span>
                    </div>
                </div>

                {/* 投票結果リストエリア (スクロール可能) */}
                <div className="flex-1 overflow-y-auto space-y-3 md:space-y-4 custom-scrollbar pr-2 mb-6 md:mb-8 min-h-0">
                    {voteSummary && voteSummary.map((item, index) => {
                        const targetName = getPlayerName(item.targetId);
                        // 得票率計算 (グラフバーの幅に使用)
                        const percentage = (item.count / voteSummary.reduce((a,b) => a + b.count, 0)) * 100;
                        
                        return (
                            <div key={index} className="bg-gray-900/60 border border-gray-700/50 rounded-2xl p-3 md:p-4 flex flex-col gap-2 md:gap-3 relative overflow-hidden group">
                                {/* 得票率バー背景アニメーション */}
                                <div className="absolute top-0 left-0 h-full bg-red-900/20 transition-all duration-1000 ease-out" style={{ width: `${percentage}%` }}></div>
                                
                                {/* 投票結果メイン行 */}
                                <div className="relative z-10 flex items-center justify-between">
                                    <div className="flex items-center gap-3 md:gap-4 min-w-0">
                                        {/* 順位バッジ */}
                                        <div className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-gray-800 border border-gray-600 flex items-center justify-center font-bold text-gray-400 text-xs md:text-sm shrink-0">
                                            {index + 1}
                                        </div>
                                        {/* 被投票者名 (1位は赤文字強調) */}
                                        <span className={`text-lg md:text-2xl font-bold truncate ${index === 0 ? "text-red-400" : "text-gray-200"}`}>{targetName}</span>
                                    </div>
                                    {/* 票数表示 */}
                                    <span className="text-xl md:text-3xl font-black text-white shrink-0">{item.count}<span className="text-xs md:text-sm font-normal text-gray-500 ml-1">票</span></span>
                                </div>
                                
                                {/* 投票者内訳表示 (匿名投票OFFの場合のみ) */}
                                {!anonymousVoting && item.voters && item.voters.length > 0 && (
                                    <div className="relative z-10 flex flex-wrap gap-1 md:gap-2 pl-9 md:pl-12">
                                        {item.voters.map(vid => (
                                            <div key={vid} className="flex items-center gap-1 bg-black/40 px-1.5 py-0.5 md:px-2 md:py-1 rounded-lg border border-white/5">
                                                <User size={10} md:size={12} className="text-gray-500"/>
                                                <span className="text-[10px] md:text-xs text-gray-300">{getPlayerName(vid)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* 処刑結果表示エリア (フッター) */}
                {/* 誰が処刑されたか、または引き分けかを表示 */}
                <div className="shrink-0 bg-red-900/30 border-2 border-red-500/50 rounded-3xl p-4 md:p-6 text-center animate-pulse shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                    <div className="flex items-center justify-center gap-2 md:gap-3 mb-1 md:mb-2">
                        <AlertOctagon size={20} md:size={24} className="text-red-400"/>
                        <span className="text-red-300 font-bold uppercase tracking-wider text-sm md:text-base">JUDGEMENT</span>
                    </div>
                    <p className="text-lg md:text-3xl font-black text-white leading-relaxed">
                        {executionResult || "集計中..."}
                    </p>
                </div>
            </div>
        </div>
    );
};