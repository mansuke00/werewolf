import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, User, Cpu, Info } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase.js';
import { ROLE_DEFINITIONS } from '../../constants/gameData.js';

export const GeminiChatPanel = ({ playerName, inPersonMode, gameContext, currentDay, messages, setMessages }) => {
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const messagesEndRef = useRef(null);
    const hasInitialized = useRef(false);

    // 自動スクロール
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    // APIキーの取得（Firestore または LocalStorage）
    // 設定UIは削除しましたが、裏側での取得ロジックは維持します
    useEffect(() => {
        const fetchApiKey = async () => {
            // 1. LocalStorageを確認（以前入力されたものがあれば）
            const localKey = localStorage.getItem('gemini_api_key');
            if (localKey) {
                setApiKey(localKey);
                return;
            }

            // 2. Firestoreを確認（管理者が設定した場合）
            try {
                const docRef = doc(db, 'system', 'settings');
                const docSnap = await getDoc(docRef);
                if (docSnap.exists() && docSnap.data().geminiApiKey) {
                    setApiKey(docSnap.data().geminiApiKey);
                }
            } catch (e) {
                console.error("Failed to fetch API key:", e);
            }
        };
        fetchApiKey();
    }, []);

    // 初回メッセージ生成（APIキー取得後かつ未実行の場合のみ）
    useEffect(() => {
        if (!hasInitialized.current && messages.length === 0 && apiKey) {
            hasInitialized.current = true;
            generateAiResponse();
        }
    }, [apiKey]);

    const constructSystemPrompt = () => {
        const { myRole, logs, chatHistory, roleSettings, teammates, lastActionResult, players } = gameContext;
        
        // ログをテキスト化
        const logsText = logs.map(l => `[${l.phase}] ${l.text}`).join("\n");
        
        // チャット履歴
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

        // ゲーム情報
        let rolesText = "【役職配分】\n";
        if (roleSettings) Object.entries(roleSettings).forEach(([r, c]) => { if(c>0) rolesText += `${ROLE_DEFINITIONS[r]?.name||r}: ${c}人\n`; });

        let matesText = "【仲間】\n";
        if (teammates?.length) matesText += teammates.map(t => `${t.name} (${ROLE_DEFINITIONS[t.role]?.name||t.role})`).join(", ") + "\n";
        else matesText += "なし\n";

        let resultText = "【直近のアクション結果】\n";
        if (lastActionResult?.length) resultText += lastActionResult.map(c => `${c.label}: ${c.value}`).join("\n") + "\n";
        else resultText += "なし\n";

        let survivorsText = "【生存者】\n";
        if (players) {
            const alive = players.filter(p => p.status === 'alive');
            survivorsText += `${alive.map(p => p.name).join(", ")} (残り${alive.length}人)\n`;
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
${resultText}

【ログ】
${logsText}
${chatText}

建設的かつ優しく、具体的な打開策や振る舞い方を短くアドバイスしてください。メタ発言は控えてください。
`;
    };

    const generateAiResponse = async (userText = null) => {
        if (!apiKey) {
            // APIキーがない場合のエラーメッセージ（設定UIへの誘導は削除）
            setMessages(prev => [...prev, { 
                id: Date.now(), 
                text: "APIキーが設定されていません。チャットボット機能は現在利用できません。", 
                sender: 'system' 
            }]);
            return;
        }

        setIsLoading(true);
        try {
            const systemPrompt = constructSystemPrompt();
            let promptContent = systemPrompt + "\n\n【会話履歴】\n";
            messages.filter(m => m.sender !== 'system').forEach(m => {
                promptContent += `${m.sender === 'user' ? 'プレイヤー' : 'AI'}: ${m.text}\n`;
            });
            if (userText) promptContent += `プレイヤー: ${userText}\nAI:`;
            else promptContent += `AI (最初のアドバイス):`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: promptContent }] }] })
            });

            if (!response.ok) {
                if (response.status === 403) throw new Error("APIキーが無効、またはアクセス権限がありません(403)");
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "思考がまとまりませんでした。";

            setMessages(prev => [...prev, { id: Date.now()+1, text: aiText, sender: 'ai', timestamp: new Date() }]);

        } catch (error) {
            console.error("Gemini Error:", error);
            setMessages(prev => [...prev, { 
                id: Date.now()+1, 
                text: `エラーが発生しました: ${error.message}`, 
                sender: 'system', 
                timestamp: new Date() 
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendMessage = async () => {
        if (!input.trim() || isLoading) return;
        const userMsg = { id: Date.now(), text: input, sender: 'user', timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        await generateAiResponse(input);
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
            <div className="p-3 bg-indigo-900/40 border-b border-indigo-500/30 flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Sparkles size={18} className="text-indigo-400 animate-pulse"/>
                        <span className="font-bold text-indigo-100 text-sm">Gemini AI Chat</span>
                    </div>
                    <div className="text-[10px] text-indigo-300 bg-indigo-950/50 px-2 py-1 rounded border border-indigo-500/20">
                        Powered by Google AI
                    </div>
                </div>
                
                <div className="flex items-start gap-1.5 bg-indigo-950/30 p-2 rounded-lg border border-indigo-500/10">
                    <Info size={14} className="text-indigo-400 mt-0.5 shrink-0"/>
                    <p className="text-[10px] text-indigo-200 leading-relaxed">
                        役職チームがそれぞれチャットを行っている可能性があるため、そのカモフラージュとしてAIと会話を行ってください。
                    </p>
                </div>
            </div>

            {/* チャットエリア - 吹き出しを廃止し、ログ形式に変更 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20">
                {messages.map((msg) => (
                    <div key={msg.id} className="flex gap-3 animate-fade-in group">
                        {/* アイコン */}
                        <div className={`mt-1 shrink-0 w-6 h-6 rounded-full flex items-center justify-center border ${
                            msg.sender === 'user' ? 'bg-gray-700 border-gray-600' : 
                            msg.sender === 'system' ? 'bg-red-900 border-red-700' : 
                            'bg-indigo-900 border-indigo-500'
                        }`}>
                            {msg.sender === 'user' ? <User size={12} className="text-gray-300"/> : 
                             msg.sender === 'system' ? <Info size={12} className="text-red-300"/> : 
                             <Cpu size={12} className="text-indigo-300"/>}
                        </div>
                        
                        {/* テキストコンテンツ（左寄せ） */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2 mb-0.5">
                                <span className={`text-[10px] font-bold ${
                                    msg.sender === 'user' ? 'text-gray-400' : 
                                    msg.sender === 'system' ? 'text-red-400' : 
                                    'text-indigo-300'
                                }`}>
                                    {msg.sender === 'user' ? playerName : msg.sender === 'system' ? 'SYSTEM' : 'Gemini'}
                                </span>
                                <span className="text-[9px] text-gray-600">
                                    {msg.timestamp ? msg.timestamp.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ""}
                                </span>
                            </div>
                            <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap break-words">
                                {msg.text}
                            </div>
                        </div>
                    </div>
                ))}
                
                {isLoading && (
                    <div className="flex gap-3 animate-pulse opacity-70">
                        <div className="mt-1 shrink-0 w-6 h-6 rounded-full bg-indigo-900/50 border border-indigo-500/30 flex items-center justify-center">
                            <Cpu size={12} className="text-indigo-400"/>
                        </div>
                        <div className="text-xs text-indigo-400 flex items-center h-6">考え中...</div>
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
            </div>
        </div>
    );
};