import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

export const ConfirmationModal = ({ title, message, onConfirm, onCancel, confirmText = "はい", cancelText = "いいえ", isDanger = false }) => {
    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[999] flex items-center justify-center p-6 animate-fade-in">
            <div className={`bg-gray-900 border-2 ${isDanger ? "border-red-500/50" : "border-blue-500/50"} rounded-3xl p-8 max-w-sm w-full shadow-2xl relative text-center`}>
                <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-6 border ${isDanger ? "bg-red-900/30 border-red-500/30 text-red-400" : "bg-blue-900/30 border-blue-500/30 text-blue-400"} animate-pulse`}>
                    <AlertTriangle size={32}/>
                </div>
                
                <h2 className="text-xl font-black text-white mb-2 tracking-wide">{title}</h2>
                <p className="text-gray-400 text-sm mb-8 leading-relaxed whitespace-pre-wrap">
                    {message}
                </p>
                
                <div className="flex gap-3">
                    <button 
                        onClick={onCancel}
                        className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold rounded-xl border border-gray-700 transition flex items-center justify-center gap-2"
                    >
                        <X size={18}/> {cancelText}
                    </button>
                    <button 
                        onClick={onConfirm}
                        className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 ${isDanger ? "bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500"}`}
                    >
                        <Check size={18}/> {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};