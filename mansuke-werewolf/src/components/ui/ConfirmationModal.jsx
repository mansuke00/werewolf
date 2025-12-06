import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

// 汎用確認モーダルコンポーネント
// 重要な操作（削除、確定など）の前にユーザーに確認を求めるために使用
// isDangerプロパティによって、警告色（赤）か通常色（青）かを切り替え可能
export const ConfirmationModal = ({ title, message, onConfirm, onCancel, confirmText = "はい", cancelText = "いいえ", isDanger = false }) => {
    return (
        // オーバーレイ背景
        // z-index: 999 (最前面に近い設定)
        // 背景色: 黒の90%不透明 + ブラー効果で背景を隠す
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[999] flex items-center justify-center p-4 animate-fade-in">
            
            {/* モーダル本体 */}
            {/* isDangerがtrueなら赤枠、falseなら青枠で囲む */}
            <div className={`bg-gray-900 border-2 ${isDanger ? "border-red-500/50" : "border-blue-500/50"} rounded-3xl p-6 md:p-8 w-full max-w-sm shadow-2xl relative text-center`}>
                
                {/* アイコン表示エリア */}
                {/* 中央上部に配置、パルスアニメーション付き */}
                {/* 危険度に応じてアイコンの背景色と文字色を変更 */}
                <div className={`mx-auto w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center mb-4 md:mb-6 border ${isDanger ? "bg-red-900/30 border-red-500/30 text-red-400" : "bg-blue-900/30 border-blue-500/30 text-blue-400"} animate-pulse`}>
                    <AlertTriangle size={28} md:size={32}/>
                </div>
                
                {/* タイトル */}
                <h2 className="text-lg md:text-xl font-black text-white mb-2 tracking-wide">{title}</h2>
                
                {/* メッセージ本文 */}
                {/* 改行コード(\n)を有効にするため whitespace-pre-wrap を適用 */}
                <p className="text-gray-400 text-xs md:text-sm mb-6 md:mb-8 leading-relaxed whitespace-pre-wrap">
                    {message}
                </p>
                
                {/* アクションボタンエリア */}
                <div className="flex gap-3">
                    {/* キャンセルボタン */}
                    {/* グレー基調の控えめなデザイン */}
                    <button 
                        onClick={onCancel}
                        className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold rounded-xl border border-gray-700 transition flex items-center justify-center gap-2 text-sm active:scale-95"
                    >
                        <X size={16}/> {cancelText}
                    </button>
                    
                    {/* 確定ボタン */}
                    {/* 危険度に応じて 赤グラデーション / 青グラデーション を切り替え */}
                    {/* 誤操作防止のため、ホバーアクションや押下時の縮小エフェクトを強めに設定 */}
                    <button 
                        onClick={onConfirm}
                        className={`flex-1 py-3 text-white font-bold rounded-xl shadow-lg transition transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 text-sm ${isDanger ? "bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500"}`}
                    >
                        <Check size={16}/> {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};