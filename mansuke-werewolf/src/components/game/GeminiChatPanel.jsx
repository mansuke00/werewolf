import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, User, Cpu } from 'lucide-react';
import { getMillis } from '../../utils/helpers.js';
import { ROLE_DEFINITIONS } from '../../constants/gameData.js';

// APIキー設定（環境変数または定数）
const apiKey = ""; // ランタイムで提供されるため空文字列

export const GeminiChatPanel = ({ playerName, inPersonMode, gameContext, currentDay, messages, setMessages }) => {
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);
    const hasInitialized = useRef(false);

    // 自動スクロール
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // 初回メッセージ（重複防止）
    useEffect(() => {
        if (!hasInitialized.current && messages.length === 0) {
            hasInitialized.current = true;
            // 少し遅延させて自然な感じにする
            setTimeout(() => {
                const initialMsg = {
                    id: Date.now(),
                    text: `こんばんは、${playerName}さん。今夜の作戦会議を始めましょうか。今日の議論で気になったことや、今後の動きについて相談に乗りますよ。`,
                    sender: 'ai',
                    timestamp: new Date()
                };
                setMessages([initialMsg]);
            }, 500);
        }
    }, [playerName, messages.length, setMessages]);

    // システムプロンプトの構築
    const constructSystemPrompt = () => {
        const { myRole, logs, chatHistory, roleSettings, teammates, lastActionResult, players } = gameContext;
        
        // ログをテキスト化
        const logsText = logs.map(l => `[${l.phase}] ${l.text}`).join("\n");
        
        // チャット履歴を日付別に整理
        let chatText = "【生存者チャット履歴】\n";
        if (inPersonMode) {
            chatText += "(対面モードのためチャット履歴はありません)\n";
        } else if (chatHistory && chatHistory.length > 0) {
            const historyByDay = {};
            chatHistory.forEach(msg => {
                const d = msg.day || 1;
                if (!historyByDay[d]) historyByDay[d] = [];
                historyByDay[d].push(`${msg.senderName}: ${msg.text}`);
            });
            
            Object.keys(historyByDay).sort((a,b)=>a-b).forEach(day => {
                chatText += `--- ${day}日目 ---\n`;
                chatText += historyByDay[day].join("\n") + "\n";
            });
        } else {
            chatText += "(履歴なし)\n";
        }

        // 役職配分
        let rolesText = "【役職配分】\n";
        if (roleSettings) {
            Object.entries(roleSettings).forEach(([role, count]) => {
                if (count > 0) rolesText += `${ROLE_DEFINITIONS[role]?.name || role}: ${count}人\n`;
            });
        }

        // 仲間情報
        let matesText = "【仲間の情報】\n";
        if (teammates && teammates.length > 0) {
            matesText += teammates.map(t => `${t.name} (${ROLE_DEFINITIONS[t.role]?.name || t.role})`).join(", ") + "\n";
        } else {
            matesText += "なし（孤独ですね...）\n";
        }

        // 夜のアクション結果
        let actionResultText = "【直近の夜のアクション結果】\n";
        if (lastActionResult && lastActionResult.length > 0) {
            actionResultText += lastActionResult.map(c => `${c.label}: ${c.value} (対象: ${c.sub || 'なし'})`).join("\n") + "\n";
        } else {
            actionResultText += "特になし\n";
        }

        // 生存者リスト
        let survivorsText = "【現在の生存者】\n";
        if (players) {
            const alive = players.filter(p => p.status === 'alive');
            survivorsText += alive.map(p => p.name).join(", ") + "\n";
            survivorsText += `(残り${alive.length}人)\n`;
        }

        return `
あなたは人狼ゲームの戦略アドバイザーAIです。
プレイヤー「${playerName}」の専属コーチとして、勝利のために親身になってアドバイスをしてください。
現在のプレイヤーの役職は「${ROLE_DEFINITIONS[myRole]?.name || myRole}」です。

【ゲーム状況】
現在のフェーズ: ${currentDay}日目の夜
${rolesText}
${survivorsText}
${matesText}
${actionResultText}

【ゲームログ】
${logsText}

${chatText}

【あなたの振る舞い方】
1. **建設的かつ優しく**: プレイヤーを励ましつつ、具体的で論理的なアドバイスをしてください。
2. **振り返りと称賛**: 今日の昼の議論（チャット履歴）を見て、プレイヤーの発言で良かった点は褒め、まずかったかもしれない点（怪しまれる発言、矛盾など）は正直かつ丁寧に指摘してください。
3. **打開策の提案**: 現状の生存者数や役職内訳を考慮し、明日以降どう動くべきか（誰を疑うべきか、どう弁明すべきか、能力をどう使うべきか）を一緒に考えてください。
4. **短く的確に**: 長文になりすぎないよう、要点を絞って会話してください。
5. **メタ発言禁止**: あなたはゲームの世界観に少し寄り添いつつも、冷静な分析官として振る舞ってください。

まずは直近の議論の流れを踏まえて、${playerName}さんへのフィードバックをお願いします。
`;
    };

    const handleSendMessage = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = {
            id: Date.now(),
            text: input,
            sender: 'user',
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setIsLoading(true);

        try {
            const systemPrompt = constructSystemPrompt();
            
            // 過去のメッセージ履歴を含めてコンテキストを作成（直近10件程度に制限すると良い）
            // ここでは簡易的にシステムプロンプト＋ユーザーの直近入力とする
            // 本格的には messages 配列を整形して API に渡す
            
            const payload = {
                contents: [{ 
                    parts: [{ text: `
${systemPrompt}

【これまでの会話】
${messages.map(m => `${m.sender === 'user' ? 'プレイヤー' : 'AI'}: ${m.text}`).join('\n')}

プレイヤー: ${input}
AI:` }] 
                }]
            };

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "すみません、少し考えがまとまりませんでした。もう一度聞いてもらえますか？";

            const aiMsg = {
                id: Date.now() + 1,
                text: aiText,
                sender: 'ai',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, aiMsg]);

        } catch (error) {
            console.error("Gemini Error:", error);
            setMessages(prev => [...prev, {
                id: Date.now() + 1,
                text: "通信エラーが発生しました。少し時間を置いてから再度お試しください。",
                sender: 'ai',
                timestamp: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-900/80 rounded-2xl border border-indigo-500/30 overflow-hidden shadow-xl">
            {/* ヘッダー */}
            <div className="p-3 bg-indigo-900/40 border-b border-indigo-500/30 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <Sparkles size={18} className="text-indigo-400 animate-pulse"/>
                    <span className="font-bold text-indigo-100 text-sm">Gemini Strategy Coach</span>
                </div>
                <div className="text-[10px] text-indigo-300 bg-indigo-950/50 px-2 py-1 rounded border border-indigo-500/20">
                    Powered by Google AI
                </div>
            </div>

            {/* チャットエリア */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                {messages.length === 0 && (
                    <div className="text-center text-gray-500 text-xs mt-10">
                        <p>ゲームの状況に合わせてアドバイスします。</p>
                        <p>気軽に話しかけてください。</p>
                    </div>
                )}
                
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`flex max-w-[85%] ${msg.sender === 'user' ? 'flex-row-reverse' : 'flex-row'} gap-2`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${msg.sender === 'user' ? 'bg-gray-700 border-gray-600' : 'bg-indigo-900 border-indigo-500'}`}>
                                {msg.sender === 'user' ? <User size={16} className="text-gray-300"/> : <Cpu size={16} className="text-indigo-300"/>}
                            </div>
                            <div className={`p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
                                msg.sender === 'user' 
                                ? 'bg-gray-800 text-gray-100 rounded-tr-none border border-gray-700' 
                                : 'bg-indigo-950/60 text-indigo-100 rounded-tl-none border border-indigo-500/30'
                            }`}>
                                {msg.text}
                            </div>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="flex items-center gap-2 bg-indigo-950/30 p-3 rounded-2xl rounded-tl-none border border-indigo-500/20">
                            <LoaderDots />
                            <span className="text-xs text-indigo-400">AIが思考中...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* 入力エリア */}
            <div className="p-3 bg-gray-900/90 border-t border-gray-800 shrink-0">
                <div className="flex gap-2 relative">
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="相談内容を入力..."
                        className="w-full bg-gray-800 text-white rounded-xl pl-4 pr-12 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 border border-gray-700 resize-none h-12 custom-scrollbar"
                        disabled={isLoading}
                    />
                    <button 
                        onClick={handleSendMessage}
                        disabled={!input.trim() || isLoading}
                        className="absolute right-2 top-2 p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                    >
                        <Send size={16} />
                    </button>
                </div>
                <div className="text-[10px] text-gray-500 text-center mt-2">
                    AIは誤った情報を生成する可能性があります。最終判断はあなた自身で行ってください。
                </div>
            </div>
        </div>
    );
};

// ローディングアニメーション用コンポーネント
const LoaderDots = () => (
    <div className="flex space-x-1">
        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
    </div>
);