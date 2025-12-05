import React from 'react';
import { X } from 'lucide-react';

// 汎用的な情報表示モーダル（閉じるボタン付き）
export const InfoModal = ({ title, children, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[150] flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden relative" onClick={e => e.stopPropagation()}>
                {/* ヘッダー */}
                <div className="p-4 md:p-5 border-b border-gray-700 bg-gray-800/50 flex justify-between items-center shrink-0">
                    <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                        {title}
                    </h3>
                    <button 
                        onClick={onClose} 
                        className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition"
                    >
                        <X size={20}/>
                    </button>
                </div>
                
                {/* コンテンツ（スクロール可能） */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-black/20">
                    {children}
                </div>
            </div>
        </div>
    );
};