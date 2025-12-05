import React, { useState, useEffect, useRef } from 'react';
import { Send, Sparkles, User, Cpu, Info, ArrowUp } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase.js';
import { ROLE_DEFINITIONS } from '../../constants/gameData.js';
import { getMillis } from '../../utils/helpers';

export const GeminiChatPanel = ({ playerName, inPersonMode, gameContext, currentDay, messages, setMessages }) => {
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const messagesEndRef = useRef(null);
    
    // その日の夜に既にAIから話しかけたかを管理するRef
    // 初期値は0（まだどの夜も話しかけていない）
    const lastGreetedDay = useRef(0);

    // 自動スクロール
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    // APIキーの取得（Firestore または LocalStorage）
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

    // 毎晩の能動的メッセージ生成
    // APIキーがあり、かつ「現在の夜」にまだ挨拶していない場合に実行
    useEffect(() => {
        if (apiKey && currentDay > lastGreetedDay.current) {
            // 既にメッセージ履歴があり、最新がAIからのその日の発言であればスキップ（二重送信防止の念のため）
            // ただしGeminiChatPanelは夜の間マウントされ続ける前提なので、基本はRef判定で十分
            lastGreetedDay.current = currentDay;
            generateAiResponse(null, true); // trueフラグで能動的メッセージであることを伝える
        }
    }, [apiKey, currentDay]);

    const constructSystemPrompt = () => {
        const { myRole, logs, chatHistory, roleSettings, teammates, lastActionResult, players } = gameContext;
        
        // ログをテキスト化
        const logsText = logs.map(l => `[${l.phase}] ${l.text}`).join("\n");
        
        // チャット履歴
        let chatText = "";
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
        let rolesText = "";
        if (roleSettings) Object.entries(roleSettings).forEach(([r, c]) => { if(c>0) rolesText += `${ROLE_DEFINITIONS[r]?.name||r}: ${c}人\n`; });

        let matesText = "";
        if (teammates?.length) matesText += teammates.map(t => `${t.name} (${ROLE_DEFINITIONS[t.role]?.name||t.role})`).join(", ") + "\n";
        else matesText += "なし\n";

        let resultText = "";
        if (lastActionResult?.length) resultText += lastActionResult.map(c => `${c.label}: ${c.value}`).join("\n") + "\n";
        else resultText += "なし\n";

        let survivorsText = "";
        if (players) {
            const alive = players.filter(p => p.status === 'alive');
            survivorsText += `${alive.map(p => p.name).join(", ")} (残り${alive.length}人)\n`;
        }

        const myRoleName = ROLE_DEFINITIONS[myRole]?.name || myRole;
        const myTeam = ROLE_DEFINITIONS[myRole]?.team === 'werewolf' ? '人狼陣営' : ROLE_DEFINITIONS[myRole]?.team === 'citizen' ? '市民陣営' : '第三陣営';

        return `
あなたは人狼ゲームのアドバイザーAIです。
以下のガイドラインと提供情報を基に、プレイヤー「${playerName}」さんの陣営が勝利するための的確なアドバイスや誘導を行ってください。

【ガイドライン】
・呼びかける際は必ず「${playerName}さん」としてください。
・返答は絶対に100文字以内で、簡潔にまとめてください。
・返答に、##や**などの装飾文字は一切使用しないでください。
・常に丁寧な会話を心がけ、ずっと敬語を保ってください。
・前日以前のアドバイスやGeminiとの会話履歴を踏まえた、一貫性のある助言をしてください。
・「この発言は良かったですね」や「この発言はまずかったかもしれません」など、具体的なチャット内容に基づいたピンポイントな助言を行ってください。
・提供されたログ以外の情報（神視点のログや他人の役職情報など）は一切知らないものとして振る舞い、あくまでプレイヤー目線でアドバイスを行ってください。
・会話の中で意図が不明確な場合でも、「よくわかりません」と答えるのではなく、文脈から意図を推測し、その時点で考えられる最善の戦略や振る舞い方を提案してください。

【提供情報】
プレイヤー名: ${playerName}
役職: ${myRoleName} (${myTeam})
現在のフェーズ: ${currentDay}日目の夜

[役職配分]
${rolesText}

[生存者]
${survivorsText}

[仲間情報]
${matesText}

[直近のアクション結果]
${resultText}

[ゲームログ（自分に表示されているログ）]
${logsText}

[生存者チャット履歴（過去全て）]
${chatText}

上記の情報は削除せず、毎日アドバイスの有効情報として利用してください。
`;
    };

    const generateAiResponse = async (userText = null, isFirstMessage = false) => {
        if (!apiKey) {
            // APIキーがない場合のエラーメッセージ
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
            let promptContent = systemPrompt + "\n\n【これまでの会話履歴】\n";
            messages.filter(m => m.sender !== 'system').forEach(m => {
                promptContent += `${m.sender === 'user' ? 'プレイヤー' : 'AI'}: ${m.text}\n`;
            });
            
            if (userText) {
                promptContent += `プレイヤー: ${userText}\nAI:`;
            } else if (isFirstMessage) {
                promptContent += `AI (状況を踏まえた${currentDay}日目の夜の最初のアドバイスを100文字以内で):`;
            } else {
                promptContent += `AI:`;
            }

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
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "思考がまとまりませんでした。申し訳ありません。";

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

    const handleSendMessage = async (e) => {
        if (e) e.preventDefault();
        if (!input.trim() || isLoading) return;
        
        if (input.length > 50) {
            alert("メッセージは50文字以内で入力してください。");
            return;
        }

        const userMsg = { id: Date.now(), text: input, sender: 'user', timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        await generateAiResponse(input);
    };

    // チャットバブルのスタイル決定（通常のチャットパネルに合わせる）
    const getMsgBubbleStyle = (sender) => {
        if (sender === 'user') return "bg-blue-600 text-white rounded-br-sm shadow-blue-900/20";
        if (sender === 'ai') return "bg-indigo-900/60 border border-indigo-500/30 text-indigo-100 rounded-bl-sm shadow-indigo-900/20"; // AIはインディゴ系で区別
        return "bg-red-900/40 text-red-200 border border-red-500/30 rounded-bl-sm"; // システムメッセージ
    };

    return (
        <div className="flex flex-col h-full bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-indigo-500/30 overflow-hidden shadow-xl">
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

            {/* チャットエリア - 吹き出しスタイルに変更 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/10">
                {messages.map((msg, idx) => {
                    const isMe = msg.sender === 'user';
                    // 連続投稿時の名前表示制御（前のメッセージと送信者が違う場合のみ表示）
                    const showName = idx === 0 || messages[idx-1].sender !== msg.sender;
                    
                    return (
                        <div key={msg.id} className={`flex flex-col ${isMe ? "items-end" : "items-start"} animate-fade-in`}>
                            {showName && (
                                <div className="flex items-baseline gap-2 mb-1 ml-1">
                                    <span className={`text-[10px] font-bold ${
                                        msg.sender === 'user' ? 'text-gray-400' : 
                                        msg.sender === 'system' ? 'text-red-400' : 
                                        'text-indigo-300'
                                    }`}>
                                        {msg.sender === 'user' ? playerName : msg.sender === 'system' ? 'SYSTEM' : 'Gemini'}
                                    </span>
                                </div>
                            )}
                            <div className={`px-3 py-2 md:px-4 md:py-2.5 rounded-2xl max-w-[85%] break-words text-xs md:text-sm font-medium shadow-md leading-relaxed ${getMsgBubbleStyle(msg.sender)}`}>
                                {msg.text}
                            </div>
                            <span className="text-[9px] text-gray-600 mt-1 px-1 opacity-60">
                                {msg.timestamp ? msg.timestamp.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ""}
                            </span>
                        </div>
                    );
                })}
                
                {isLoading && (
                    <div className="flex flex-col items-start animate-pulse opacity-70">
                        <div className="flex items-baseline gap-2 mb-1 ml-1">
                             <span className="text-[10px] font-bold text-indigo-300">Gemini</span>
                        </div>
                        <div className="bg-indigo-900/40 border border-indigo-500/20 px-3 py-2 rounded-2xl rounded-bl-sm text-xs text-indigo-300 flex items-center gap-2">
                            <Cpu size={12} className="animate-spin"/> 考え中...
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* 入力エリア - ChatPanelと同じスタイルに統一 */}
            <form onSubmit={handleSendMessage} className="p-2 md:p-3 bg-gray-900/40 backdrop-blur-md flex gap-2 border-t border-indigo-500/30 shrink-0">
                <div className="relative flex-1">
                    <input 
                        className="w-full bg-gray-800/80 border border-gray-600 rounded-xl pl-3 pr-8 py-2 md:pl-4 md:pr-10 md:py-3 text-white focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition outline-none text-xs md:text-sm placeholder-gray-500"
                        placeholder="相談内容を入力 (50文字以内)..."
                        maxLength={50}
                        value={input} 
                        onChange={e => setInput(e.target.value)}
                        disabled={isLoading}
                    />
                    <div className={`absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-colors ${input.length > 40 ? "bg-red-500" : input.length > 0 ? "bg-green-500" : "bg-gray-600"}`}></div>
                </div>
                <button 
                    type="submit" 
                    disabled={!input.trim() || isLoading}
                    className="bg-indigo-600 w-10 md:w-12 h-full rounded-xl text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center shadow-lg active:scale-95 shrink-0"
                >
                    <ArrowUp size={18} md:size={20} strokeWidth={3}/>
                </button>
            </form>
        </div>
    );
};