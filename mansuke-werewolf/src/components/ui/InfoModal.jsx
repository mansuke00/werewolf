import React from 'react';
import { X } from 'lucide-react';

// 汎用的な情報表示モーダルコンポーネント
// ヘルプ、詳細情報、設定画面などの表示に使用
// 閉じるボタン付き、背景クリックでも閉じる仕様
export const InfoModal = ({ title, children, onClose }) => {
    return (
        // 背景オーバーレイ
        // z-index: 150 (通常コンテンツより上、確認モーダルよりは下を想定)
        // 背景クリックで閉じる機能 (onClick={onClose})
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[150] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            
            {/* モーダルウィンドウ本体 */}
            {/* 内部クリック時のイベント伝播阻止 (onClick={e => e.stopPropagation()}) */}
            {/* 画面高さの85%を上限とし、それ以上は内部スクロールさせる */}
            <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden relative" onClick={e => e.stopPropagation()}>
                
                {/* ヘッダーセクション */}
                {/* タイトルと閉じるボタンを配置 */}
                {/* shrink-0: コンテンツ量に関わらず高さを維持 */}
                <div className="p-4 md:p-5 border-b border-gray-700 bg-gray-800/50 flex justify-between items-center shrink-0">
                    {/* タイトル表示 */}
                    <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                        {title}
                    </h3>
                    
                    {/* 閉じるボタン (右上) */}
                    <button 
                        onClick={onClose} 
                        className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition"
                    >
                        <X size={20}/>
                    </button>
                </div>
                
                {/* コンテンツエリア (スクロール可能) */}
                {/* flex-1 overflow-y-auto: 残りの高さを埋め、溢れたらスクロール */}
                {/* custom-scrollbar: スクロールバーのデザイン適用 */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-black/20">
                    {children}
                </div>
            </div>
        </div>
    );
};