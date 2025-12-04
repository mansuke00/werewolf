import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Send, Info, Loader } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { ROLE_DEFINITIONS } from '../../constants/gameData';

// 夜のアクションが無い役職や、カモフラージュが必要な役職向けのチャット
export const GeminiChatPanel = ({ playerName, inPersonMode, gameContext, currentDay, messages, setMessages }) => {
    // 親コンポーネントから messages, setMessages を受け取ることで履歴を維持する
    
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [apiKey, setApiKey] = useState(null);
    const [keyError, setKeyError] = useState(false);
    const scrollRef = useRef(null);
    
    // 日付変更検知用
    const [lastDay, setLastDay] = useState(0);

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
                    // エラーメッセージは、まだ履歴がない場合のみ追加
                    if (messages && messages.length === 0) {
                        setMessages(prev => [...prev, { sender: 'gemini', text: "（システムエラー：APIキーの設定が見つかりません。）" }]);
                    }
                }
            } catch (e) {
                console.error("Error fetching API key:", e);
                setKeyError(true);
            }
        };
        fetchApiKey();
    }, []);

    // 自動スクロール
    useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    // 初期化および自動アドバイスの制御
    useEffect(() => {
        if (!apiKey) return;

        // 対面モード：履歴が空の場合のみ初期メッセージを表示（こちらは待機）
        if (inPersonMode) {
            if (messages.length === 0) {
                setMessages([{ sender: 'gemini', text: `こんにちは、${playerName}さん！待機時間にお話ししましょう。` }]);
            }
            return;
        }

        // 対面モードOFF（戦略アドバイザー）：
        // 日付が変わった、または履歴が空の場合にAIから能動的にアドバイスを開始
        if (currentDay > lastDay || messages.length === 0) {
            // 自動実行のトリガー文言（これはAIへの指示として送るが、チャット履歴には表示しない）
            const triggerPrompt = messages.length === 0
                ? "ゲーム開始直後です。私の役職と配役に基づき、初日の立ち回りについてアドバイスをください。"
                : `${currentDay}日目になりました。これまでの議論や状況を踏まえて、今日のアドバイスをください。`;
            
            callGemini(triggerPrompt);
            setLastDay(currentDay);
        }
    }, [apiKey, currentDay, inPersonMode, messages.length, lastDay]);

    const callGemini = async (userText) => {
        if (!apiKey) return;
        setLoading(true);
        
        let systemPrompt = "";
        
        if (inPersonMode) {
            systemPrompt = `
            あなたは人狼ゲームの待機時間にプレイヤーの話し相手をするAIです。
            相手のプレイヤー名は「${playerName}」です。
            呼びかける際は必ず「${playerName}さん」と呼んでください。
            以下のルールを厳守してください：
            1. **や##などの装飾記号は一切使用しないでください。
            2. ゲームの内容や推理には触れず、楽しく雑談してください。
            3. 常に敬語を使い、相手に関心を持って質問を投げかけてください。
            4. 回答は極めて簡潔に、80文字以内で返答してください。長文は禁止です。
            `;
        } else {
            // ゲームコンテキストの構築
            const myRoleName = gameContext?.myRole ? (ROLE_DEFINITIONS[gameContext.myRole]?.name || "不明") : "不明";
            const chatHistory = (messages || []).map(m => `${m.sender === 'user' ? playerName : 'AI'}: ${m.text}`).join('\n').slice(-1500); 
            const logs = (gameContext?.logs || []).map(l => l.text).join('\n').slice(-1500);
            
            // 役職配分情報のフォーマット作成
            const roleSettings = gameContext?.roleSettings || {};
            const roleDistStr = Object.entries(roleSettings)
                .filter(([_, count]) => count > 0)
                .map(([key, count]) => `${ROLE_DEFINITIONS[key]?.name || key}: ${count}人`)
                .join(', ');

            systemPrompt = `
            あなたは人狼ゲームのアドバイザーAIです。
            プレイヤー名「${playerName}」さんの陣営が勝つためのアドバイスや立ち回りを教えてください。
            呼びかける際は必ず「${playerName}さん」と呼んでください。
            情報は以下の通りです。
            
            [${playerName}の役職]: ${myRoleName}
            [今回の配役（内訳）]: ${roleDistStr}
            [これまでのチャット会話履歴]:
            ${chatHistory}
            [直近のゲームログ（${playerName}が知り得る情報のみ）]:
            ${logs}
            
            以下のルールを厳守してください：
            1. 提供されたログにない情報（他人の役職や行動結果など）はあなたは絶対に知り得ません。カンニングと思われる発言は厳禁です。
            2. 建設的かつ丁寧な会話を心がけ、ずっと敬語を使ってください。
            3. **や##などの装飾記号は一切使用しないでください。
            4. 回答は極めて簡潔に、短く要点のみを伝えてください。絶対に100文字以内に収めてください。長々とした説明は禁止です。
            5. 2日目以降のアドバイスは、以前のアドバイスや会話履歴を踏まえて、一貫性のある助言をしてください。
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
                        { role: "user", parts: [{ text: userText }] } // 最新のユーザー発言（またはシステムトリガー）
                    ] 
                })
            });
            const data = await response.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "申し訳ありません、うまく聞き取れませんでした。";
            setMessages(prev => [...prev, { sender: 'gemini', text: reply.replace(/[*#]/g, '') }]); // 念のため装飾記号を除去
        } catch (e) { 
            console.error(e);
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
                <div className="p-3 flex items-center justify-between"><span className="font-bold text-indigo-200 flex items-center gap-2 text-sm"><Sparkles size={16} className="text-yellow-300"/> Gemini AI Chat</span><span className="text-[10px] bg-indigo-800 px-2 py-1 rounded text-indigo-300 border border-indigo-500/30">Advisor</span></div>
                <div className="bg-indigo-900/30 p-2 px-3 text-[10px] md:text-[11px] text-indigo-300 border-t border-indigo-500/10 leading-tight flex gap-2 items-start"><Info size={14} className="shrink-0 mt-0.5"/><span>{inPersonMode ? "対面モードのため、雑談相手として機能します。" : "ゲームのアドバイスを行います。AIはあなたの視点での情報しか持ちません。"}</span></div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-4 custom-scrollbar">
                {messages.map((msg, i) => (<div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-3 py-2 md:px-4 md:py-2 text-xs md:text-sm ${msg.sender === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-gray-800 text-gray-200 rounded-tl-none border border-gray-700'}`}>{msg.text}</div></div>))}
                {loading && <div className="text-xs text-indigo-400 animate-pulse ml-2">Geminiが入力中...</div>}
                <div ref={scrollRef}></div>
            </div>
            <form onSubmit={handleSend} className="p-2 md:p-3 bg-indigo-900/30 flex gap-2 shrink-0">
                <input 
                    value={input} 
                    onChange={e => setInput(e.target.value)} 
                    disabled={!apiKey || keyError}
                    className="flex-1 bg-indigo-950/50 border border-indigo-500/30 rounded-xl px-3 py-2 md:px-4 md:py-2 text-white placeholder-indigo-400/50 focus:outline-none focus:border-indigo-400 transition text-xs md:text-sm disabled:opacity-50" 
                    placeholder={!apiKey ? "システム準備中..." : "メッセージを入力..."}
                />
                <button type="submit" disabled={!apiKey || keyError} className="bg-indigo-600 p-2 rounded-xl text-white hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed">
                    {(!apiKey && !keyError) ? <Loader className="animate-spin" size={18}/> : <Send size={18}/>}
                </button>
            </form>
        </div>
    );
};