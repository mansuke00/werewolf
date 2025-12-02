import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Send, Info, Loader } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ROLE_DEFINITIONS } from '../../constants/gameData';

// 夜のアクションが無い役職や、カモフラージュが必要な役職向けのチャット
export const GeminiChatPanel = ({ playerName, inPersonMode, gameContext, currentDay }) => {
    // 初期メッセージを変更
    const initialMessage = inPersonMode 
        ? `こんにちは、${playerName}さん！待機時間にお話ししましょう。`
        : `戦略について一緒に考えましょう。これからの立ち回り方の予定はありますか？`;

    const [messages, setMessages] = useState([{ sender: 'gemini', text: initialMessage }]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [apiKey, setApiKey] = useState(null);
    const [keyError, setKeyError] = useState(false);
    const scrollRef = useRef(null);
    const [lastDay, setLastDay] = useState(currentDay);

    // 日付が変わったらチャット内容をリセット（対面モード以外）
    useEffect(() => {
        if (currentDay !== lastDay) {
            // 対面モードの場合はリセットしない
            if (!inPersonMode) {
                setMessages([{ sender: 'gemini', text: `${currentDay}日目ですね。状況が変わりました。作戦を見直しましょうか？` }]);
            }
            setLastDay(currentDay);
        }
    }, [currentDay, lastDay, inPersonMode]);

    // APIキー取得
    useEffect(() => {
        const fetchApiKey = async () => {
            try {
                const docRef = doc(db, 'system', 'settings');
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists() && docSnap.data().geminiApiKey) {
                    setApiKey(docSnap.data().geminiApiKey);
                } else {
                    console.error("Gemini API Key not found.");
                    setKeyError(true);
                    setMessages(prev => [...prev, { sender: 'gemini', text: "（システムエラー：APIキーの設定が見つかりません。）" }]);
                }
            } catch (e) {
                console.error("Error fetching API key:", e);
                setKeyError(true);
            }
        };
        fetchApiKey();
    }, []);

    useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const callGemini = async (userText) => {
        if (!apiKey) return;
        setLoading(true);
        
        let systemPrompt = "";
        
        if (inPersonMode) {
            systemPrompt = `
            あなたは人狼ゲームの待機時間にプレイヤーの話し相手をするAIです。
            相手のプレイヤー名は「${playerName}」です。
            以下のルールを厳守してください：
            1. **や##などの装飾記号は一切使用しないでください。
            2. ゲームの内容や推理には触れず、楽しく雑談してください。
            3. 常に敬語を使い、相手に関心を持って質問を投げかけてください。
            4. 回答は極めて簡潔に、80文字以内で返答してください。長文は禁止です。
            `;
        } else {
            // ゲームコンテキストの構築
            const myRoleName = gameContext?.myRole ? (ROLE_DEFINITIONS[gameContext.myRole]?.name || "不明") : "不明";
            const chatHistory = (gameContext?.chatHistory || []).map(m => `${m.senderName}: ${m.text}`).join('\n').slice(-1000); // 直近のログのみ
            const logs = (gameContext?.logs || []).map(l => l.text).join('\n').slice(-1000);
            
            // 役職配分情報のフォーマット作成
            const roleSettings = gameContext?.roleSettings || {};
            const roleDistStr = Object.entries(roleSettings)
                .filter(([_, count]) => count > 0)
                .map(([key, count]) => `${ROLE_DEFINITIONS[key]?.name || key}: ${count}人`)
                .join(', ');

            systemPrompt = `
            あなたは人狼ゲームのアドバイザーAIです。
            プレイヤー名「${playerName}」さんの陣営が勝つためのアドバイスや立ち回りを教えてください。
            情報は以下の通りです。
            
            [${playerName}の役職]: ${myRoleName}
            [今回の配役（内訳）]: ${roleDistStr}
            [直近の公開チャット履歴]:
            ${chatHistory}
            [直近のゲームログ（${playerName}が知り得る情報のみ）]:
            ${logs}
            
            以下のルールを厳守してください：
            1. 提供されたログにない情報（他人の役職や行動結果など）はあなたは絶対に知り得ません。カンニングと思われる発言は厳禁です。
            2. 建設的かつ丁寧な会話を心がけ、ずっと敬語を使ってください。
            3. **や##などの装飾記号は一切使用しないでください。
            4. 回答は極めて簡潔に、短く要点のみを伝えてください。絶対に100文字以内に収めてください。長々とした説明は禁止です。
            `;
        }

        // 会話履歴の構築
        const historyContents = messages.map(m => ({
            role: m.sender === 'user' ? 'user' : 'model',
            parts: [{ text: m.text }]
        }));

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contents: [
                        { role: "user", parts: [{ text: systemPrompt }] }, // システムプロンプトを最初のユーザーメッセージとして送信
                        ...historyContents, // 過去の履歴を展開
                        { role: "user", parts: [{ text: userText }] } // 最新のユーザー発言
                    ] 
                })
            });
            const data = await response.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "申し訳ありません、うまく聞き取れませんでした。";
            setMessages(prev => [...prev, { sender: 'gemini', text: reply.replace(/[*#]/g, '') }]); // 念のため装飾記号を除去
        } catch (e) { 
            setMessages(prev => [...prev, { sender: 'gemini', text: "通信エラーが発生しました。" }]); 
        } finally { 
            setLoading(false); 
        }
    };

    const handleSend = (e) => { 
        e.preventDefault(); 
        if(!input.trim() || !apiKey) return; 
        const text = input; 
        setMessages(prev => [...prev, { sender: 'user', text }]); 
        setInput(""); 
        callGemini(text); 
    };

    return (
        <div className="flex flex-col h-full bg-indigo-950/40 backdrop-blur-xl rounded-2xl border border-indigo-500/30 overflow-hidden shadow-2xl relative animate-fade-in">
            <div className="bg-indigo-900/40 border-b border-indigo-500/20">
                <div className="p-3 flex items-center justify-between"><span className="font-bold text-indigo-200 flex items-center gap-2"><Sparkles size={16} className="text-yellow-300"/> Gemini AI Chat</span><span className="text-[10px] bg-indigo-800 px-2 py-1 rounded text-indigo-300 border border-indigo-500/30">Advisor</span></div>
                <div className="bg-indigo-900/30 p-2 px-3 text-[11px] text-indigo-300 border-t border-indigo-500/10 leading-tight flex gap-2 items-start"><Info size={14} className="shrink-0 mt-0.5"/><span>{inPersonMode ? "対面モードのため、雑談相手として機能します。" : "ゲームのアドバイスを行います。AIはあなたの視点での情報しか持ちません。"}</span></div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.map((msg, i) => (<div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${msg.sender === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-gray-800 text-gray-200 rounded-tl-none border border-gray-700'}`}>{msg.text}</div></div>))}
                {loading && <div className="text-xs text-indigo-400 animate-pulse ml-2">Geminiが入力中...</div>}
                <div ref={scrollRef}></div>
            </div>
            <form onSubmit={handleSend} className="p-3 bg-indigo-900/30 flex gap-2">
                <input 
                    value={input} 
                    onChange={e => setInput(e.target.value)} 
                    disabled={!apiKey || keyError}
                    className="flex-1 bg-indigo-950/50 border border-indigo-500/30 rounded-xl px-4 py-2 text-white placeholder-indigo-400/50 focus:outline-none focus:border-indigo-400 transition text-sm disabled:opacity-50" 
                    placeholder={!apiKey ? "システム準備中..." : "メッセージを入力..."}
                />
                <button type="submit" disabled={!apiKey || keyError} className="bg-indigo-600 p-2 rounded-xl text-white hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed">
                    {(!apiKey && !keyError) ? <Loader className="animate-spin" size={18}/> : <Send size={18}/>}
                </button>
            </form>
        </div>
    );
};