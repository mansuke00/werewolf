import React, { useState, useMemo } from 'react';
import { X, History, MessageSquare } from 'lucide-react'; // アイコンライブラリ
import { getMillis } from '../../utils/helpers'; // タイムスタンプ変換ヘルパー

// 過去ログ・チャット履歴閲覧用モーダルコンポーネント
// logs: ゲームの進行ログ配列（フェーズ情報含む）
// messages: チャットメッセージ配列
// どちらか片方を渡して表示モードを切り替える想定
// user: 現在のユーザー情報（自分のメッセージ判定用に追加）
export const ChatArchiveModal = ({ messages, onClose, logs, title, user }) => {
    // 表示モード判定
    const isLogMode = !!logs;
    const isChatMode = !!messages;

    // ログ表示時のタブ選択状態（"all" または フェーズ名）
    const [tab, setTab] = useState("all");
    
    // チャット表示時のタブ選択状態（デフォルトは 'public' = 生存者チャット）
    const [chatTab, setChatTab] = useState("public");

    const safeLogs = logs || []; 
    
    // ログ用タブリスト生成（メモ化）
    const tabs = useMemo(() => { 
        if (!safeLogs.length) return []; 
        return [...new Set(safeLogs.map(l => l.phase).filter(p => p && p !== 'System'))]; 
    }, [safeLogs]);
    
    // チャット用タブリスト生成（存在するチャンネルのみ抽出）
    const availableChannels = useMemo(() => {
        if (!isChatMode || !messages) return ['public'];
        const channels = [...new Set(messages.map(m => m.channel).filter(c => c))];
        // publicが含まれていない場合でも最低限追加
        if (!channels.includes('public')) channels.unshift('public');
        
        // 並び順を固定 (生存者 -> 人狼 -> 霊界 -> その他)
        const order = ['public', 'wolf', 'grave', 'lobby'];
        return channels.sort((a, b) => {
            const indexA = order.indexOf(a);
            const indexB = order.indexOf(b);
            // orderにないものは後ろへ
            const valA = indexA === -1 ? 99 : indexA;
            const valB = indexB === -1 ? 99 : indexB;
            return valA - valB;
        });
    }, [messages, isChatMode]);

    // チャンネル名の日本語表示マッピング
    const channelNames = {
        public: "生存者",
        wolf: "人狼",
        grave: "霊界",
        lobby: "ロビー"
    };

    // チャットメッセージのフィルタリングとソート（メモ化）
    // Firestoreのタイムスタンプ等をミリ秒に変換して時系列順に並べ替え
    const sortedMessages = useMemo(() => {
        if (!isChatMode) return [];
        
        // 選択されたタブ（チャンネル）でフィルタリング
        const filtered = messages.filter(m => m.channel === chatTab);

        return [...filtered].sort((a, b) => getMillis(a.createdAt) - getMillis(b.createdAt));
    }, [messages, isChatMode, chatTab]);

    return (
        // モーダル背景（オーバーレイ）
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4" onClick={onClose}>
            
            {/* モーダル本体 */}
            <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-2xl h-[85vh] md:h-[80vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                
                {/* ヘッダーエリア */}
                <div className="p-3 md:p-4 border-b border-gray-700 flex flex-col gap-2 shrink-0 bg-gray-800/50">
                    <div className="flex justify-between items-center">
                        {/* タイトルとアイコン */}
                        <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                            {isChatMode ? <MessageSquare size={18}/> : <History size={18}/>} 
                            {title || (isChatMode ? "チャットアーカイブ" : "過去の記録")}
                        </h3>
                        {/* 閉じるボタン */}
                        <button onClick={onClose} className="p-1 bg-gray-800 rounded-full hover:bg-gray-700 transition">
                            <X className="text-gray-400 hover:text-white" size={20}/>
                        </button>
                    </div>

                    {/* ログモード時のタブ切り替えボタンエリア */}
                    {isLogMode && (
                        <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                            <button 
                                onClick={()=>setTab("all")} 
                                className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition ${tab==="all" ? 'bg-blue-600 text-white':'bg-gray-800 text-gray-400 border border-gray-700'}`}
                            >
                                すべて
                            </button>
                            {tabs.map(t => (
                                <button 
                                    key={t} 
                                    onClick={()=>setTab(t)} 
                                    className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition ${tab===t ? 'bg-blue-600 text-white':'bg-gray-800 text-gray-400 border border-gray-700'}`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* チャットモード時のタブ切り替えボタンエリア (新規追加) */}
                    {isChatMode && (
                        <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                            {availableChannels.map(c => (
                                <button 
                                    key={c} 
                                    onClick={()=>setChatTab(c)} 
                                    className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                                        chatTab===c 
                                            ? (c === 'wolf' ? 'bg-red-600 text-white' : c === 'grave' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white')
                                            : 'bg-gray-800 text-gray-400 border border-gray-700'
                                    }`}
                                >
                                    {channelNames[c] || c}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                
                {/* コンテンツエリア（スクロール可能） */}
                <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 custom-scrollbar bg-black/20">
                    
                    {/* ログ表示モード */}
                    {isLogMode && safeLogs.filter(l => tab === "all" || l.phase === tab).map((l, i) => (
                        <div key={i} className="flex flex-col items-start animate-fade-in">
                            {/* フェーズラベル */}
                            <span className="text-[10px] text-gray-400 mb-1 px-1">{l.phase}</span>
                            {/* ログ本文 */}
                            <div className="bg-gray-800 text-gray-200 px-3 py-2 rounded-xl rounded-tl-none text-xs md:text-sm border border-gray-700 leading-relaxed">
                                {l.text}
                            </div>
                        </div>
                    ))}

                    {/* チャット表示モード */}
                    {isChatMode && sortedMessages.map((msg, i) => {
                        // 自分のメッセージ判定
                        const isMe = user?.uid === msg.senderId;
                        
                        // チャンネルに応じたスタイル調整
                        let bubbleStyle = isMe 
                            ? "bg-blue-600 text-white rounded-tr-none border-blue-500" 
                            : "bg-gray-800 text-gray-200 rounded-tl-none border-gray-700";
                        
                        // 人狼・霊界チャットの視認性を上げる（自分以外の発言の時）
                        if (!isMe && msg.channel === 'wolf') {
                            bubbleStyle = "bg-red-900/40 text-red-100 rounded-tl-none border-red-800";
                        } else if (!isMe && msg.channel === 'grave') {
                            bubbleStyle = "bg-purple-900/40 text-purple-100 rounded-tl-none border-purple-800";
                        }

                        return (
                            <div key={i} className={`flex flex-col animate-fade-in ${isMe ? "items-end" : "items-start"}`}>
                                {/* 送信者名と時刻 */}
                                <div className={`flex items-baseline gap-2 mb-1 px-1 ${isMe ? "flex-row-reverse" : ""}`}>
                                    <span className="text-xs font-bold text-gray-400">{msg.senderName}</span>
                                    <span className="text-[9px] text-gray-600">
                                        {msg.createdAt ? new Date(getMillis(msg.createdAt)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}
                                    </span>
                                </div>
                                {/* メッセージ本文 */}
                                <div className={`px-4 py-2.5 rounded-2xl text-xs md:text-sm border max-w-[95%] break-words shadow-sm ${bubbleStyle}`}>
                                    {msg.text}
                                </div>
                            </div>
                        );
                    })}
                    
                    {/* チャットなしの場合の表示 */}
                    {isChatMode && sortedMessages.length === 0 && (
                        <div className="text-center text-gray-500 text-xs md:text-sm py-10">
                            {channelNames[chatTab] || chatTab}のメッセージはありません
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};