import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Send, Info, Loader } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';

// 夜のアクションが無い役職（市民など）向けの暇つぶし＆カモフラージュ用チャット
export const GeminiChatPanel = ({ playerName }) => {
    const [messages, setMessages] = useState([{ sender: 'gemini', text: `こんにちは、${playerName}さん！ゲームのことは忘れて、少しお喋りしませんか？まずは自己紹介を兼ねて、好きなことや趣味を教えてください！` }]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [apiKey, setApiKey] = useState(null);
    const [keyError, setKeyError] = useState(false);
    const scrollRef = useRef(null);

    // APIキーはクライアントコードに埋め込まず、Firestoreの保護されたドキュメントから取得
    useEffect(() => {
        const fetchApiKey = async () => {
            try {
                // system/settings コレクションはセキュリティルールで読み取り制限をかけること
                const docRef = doc(db, 'system', 'settings');
                const docSnap = await getDoc(docRef);
                
                if (docSnap.exists() && docSnap.data().geminiApiKey) {
                    setApiKey(docSnap.data().geminiApiKey);
                } else {
                    console.error("Gemini API Key not found in Firestore (system/settings).");
                    setKeyError(true);
                    setMessages(prev => [...prev, { sender: 'gemini', text: "（システムエラー：APIキーの設定が見つかりません。管理者に連絡してください。）" }]);
                }
            } catch (e) {
                console.error("Error fetching API key:", e);
                if (e.code === 'permission-denied') {
                    console.error("権限エラー: Firestoreのセキュリティルールで 'system/settings' への読み取りが許可されていない可能性があります。");
                }
                setKeyError(true);
            }
        };
        fetchApiKey();
    }, []);

    useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const callGemini = async (userText) => {
        if (!apiKey) return;
        setLoading(true);
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: `あなたは人狼ゲームの待機時間にプレイヤーの暇つぶし相手をするAIです。プレイヤー名「${playerName}」さんと会話しています。ゲームの進行や推理の話は一切せず、プレイヤー自身のことに興味を持って質問してください。短く親しみやすく返答してください。ユーザー: ${userText}` }] }] })
            });
            const data = await response.json();
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "うーん、電波が悪いようです...";
            setMessages(prev => [...prev, { sender: 'gemini', text: reply }]);
        } catch (e) { setMessages(prev => [...prev, { sender: 'gemini', text: "接続エラーが発生しました。" }]); } finally { setLoading(false); }
    };

    const handleSend = (e) => { e.preventDefault(); if(!input.trim() || !apiKey) return; const text = input; setMessages(prev => [...prev, { sender: 'user', text }]); setInput(""); callGemini(text); };

    return (
        <div className="flex flex-col h-full bg-indigo-950/40 backdrop-blur-xl rounded-2xl border border-indigo-500/30 overflow-hidden shadow-2xl relative animate-fade-in">
            <div className="bg-indigo-900/40 border-b border-indigo-500/20">
                <div className="p-3 flex items-center justify-between"><span className="font-bold text-indigo-200 flex items-center gap-2"><Sparkles size={16} className="text-yellow-300"/> Gemini AI Chat</span><span className="text-[10px] bg-indigo-800 px-2 py-1 rounded text-indigo-300 border border-indigo-500/30">Camouflage</span></div>
                <div className="bg-indigo-900/30 p-2 px-3 text-[11px] text-indigo-300 border-t border-indigo-500/10 leading-tight flex gap-2 items-start"><Info size={14} className="shrink-0 mt-0.5"/><span>能力者が役職チャットを行っている可能性があるため、そのカモフラージュとしてGeminiとチャットを行っていてください！</span></div>
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
                    placeholder={!apiKey ? "システム準備中..." : "自己紹介してカモフラージュ..."}
                />
                <button type="submit" disabled={!apiKey || keyError} className="bg-indigo-600 p-2 rounded-xl text-white hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed">
                    {(!apiKey && !keyError) ? <Loader className="animate-spin" size={18}/> : <Send size={18}/>}
                </button>
            </form>
        </div>
    );
};