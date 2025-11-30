import React from 'react';
import { X } from 'lucide-react';

// 汎用モーダルコンポーネント
// 背景クリックで閉じる挙動あり
export const InfoModal = ({ title, onClose, children }) => (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-gray-900 border border-gray-700 rounded-3xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-700 shrink-0">
                <h3 className="text-xl font-bold text-white">{title}</h3>
                <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24}/></button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">{children}</div>
        </div>
    </div>
);