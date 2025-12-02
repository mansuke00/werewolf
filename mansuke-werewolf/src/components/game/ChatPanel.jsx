import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MessageSquare, Send, Users, Ghost, PenTool, Lock } from 'lucide-react';
import { getMillis } from '../../utils/helpers';

export const ChatPanel = ({ messages, user, teammates, myPlayer, onSendMessage, title = "生存者チャット", isTeamChat = false, currentDay, currentPhase, disableFilter = false, readOnly = false, disabled = false }) => {
  const [chatInput, setChatInput] = useState("");
  const scrollRef = useRef(null);
  
  // 新着メッセージが来たら自動スクロール
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSubmit = async (e) => {
      e.preventDefault();
      if(chatInput.trim()) { 
          if (chatInput.length > 50) {
              alert("メッセージは50文字以内で入力してください。");
              return;
          }
          try {
            await onSendMessage(chatInput); 
            setChatInput(""); 
          } catch(err) {
            console.error("Chat Error:", err);
            alert("メッセージの送信に失敗しました。通信環境を確認してください。");
          }
      }
  };
  
  const safeMessages = Array.isArray(messages) ? messages : [];
  const isGrave = title === "霊界チャット";
  
  // メッセージフィルタリングロジック
  const filteredMessages = useMemo(() => {
      if (disableFilter || isGrave) return safeMessages;
      
      const isNightPhase = (currentPhase && typeof currentPhase === 'string') 
          ? currentPhase.startsWith('night') 
          : false;
          
      const phaseLabel = isNightPhase ? 'night' : 'day';
      
      return safeMessages.filter(m => m && m.day === currentDay && m.phaseLabel === phaseLabel);
  }, [safeMessages, currentDay, currentPhase, isGrave, isTeamChat, disableFilter]);

  const sortedMessages = useMemo(() => {
      return [...filteredMessages].sort((a, b) => {
          const tA = getMillis(a.createdAt);
          const tB = getMillis(b.createdAt);
          return tA - tB;
      });
  }, [filteredMessages]);
  
  // スタイル定義
  const containerClass = isGrave 
    ? "bg-indigo-950/40 border-indigo-500/30 rounded-[2rem]" 
    : "bg-gray-900/60 border-gray-700/50 rounded-2xl";
  
  const headerClass = isGrave
    ? "bg-indigo-900/40 border-indigo-500/20"
    : isTeamChat ? "bg-purple-900/40 border-purple-500/30" : "bg-gray-800/40 border-gray-700/50";
    
  const msgBubbleClass = (isMe) => {
      if (isGrave) return isMe ? "bg-indigo-600 text-white rounded-br-none" : "bg-gray-800 text-indigo-100 rounded-bl-none border border-indigo-500/30";
      if (isTeamChat) return isMe ? "bg-purple-600 text-white rounded-tr-none" : "bg-purple-900/60 text-purple-100 rounded-tl-none border border-purple-500/30";
      return isMe ? "bg-blue-600 text-white rounded-tr-none" : "bg-gray-700 text-gray-200 rounded-tl-none";
  };

  let placeholderText = "メッセージ (50文字以内)...";
  let descriptionText = ""; 

  if(isGrave) {
      placeholderText = "霊界へ... (50文字以内)";
      descriptionText = "死んだ者同士で、試合の展開を見守りましょう！";
  }
  else if(isTeamChat) {
      placeholderText = "仲間へ... (50文字以内)";
      const roleName = title.replace("チャット", "");
      descriptionText = `${roleName}の方のみがアクセスできるチャットルームです。`;
  }

  const isTeammate = (id) => teammates && teammates.some(t => t.id === id);
  
  if (disabled) {
      return (
          <div className={`flex flex-col h-full backdrop-blur-xl border overflow-hidden shadow-xl items-center justify-center text-center p-4 ${containerClass}`}>
              <Lock size={48} className="text-gray-500 mb-4"/>
              <h3 className="text-xl font-bold text-gray-400">チャット利用不可</h3>
              <p className="text-sm text-gray-500 mt-2">対面モードが有効なため、<br/>このチャットは利用できません。</p>
          </div>
      );
  }

  return (
      <div className={`flex flex-col h-full backdrop-blur-xl border overflow-hidden shadow-xl ${containerClass}`}>
          <div className={`p-3 border-b flex flex-col shrink-0 ${headerClass}`}>
              <span className={`font-bold flex items-center gap-2 ${isTeamChat ? "text-purple-300" : isGrave ? "text-indigo-200" : "text-gray-300"}`}>
                  {isTeamChat ? (teammates?.length > 0 ? <Users size={16}/> : <PenTool size={16}/>) : isGrave ? <Ghost size={16}/> : <MessageSquare size={16}/>} 
                  {title}
              </span>
              {descriptionText && (
                  <span className={`text-[10px] mt-1 leading-tight ${isTeamChat ? "text-purple-300/70" : "text-indigo-300/70"}`}>
                      {descriptionText}
                  </span>
              )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-black/20 min-h-0">
              {sortedMessages.map((msg, idx) => {
                  const isMe = msg.senderId === user?.uid;
                  return (
                      <div key={idx} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                           <div className="flex items-baseline gap-2 mb-1">
                               <span className={`text-xs font-bold ${isTeammate(msg.senderId) && !isGrave && !isTeamChat ? "text-red-400" : "text-gray-400"}`}>{msg.senderName}</span>
                           </div>
                           <div className={`px-4 py-2 rounded-2xl max-w-[85%] break-words text-sm shadow-sm ${msgBubbleClass(isMe)}`}>
                               {msg.text}
                           </div>
                      </div>
                  );
              })}
              <div ref={scrollRef}></div>
          </div>
          {!readOnly && (
              <form onSubmit={handleSubmit} className="p-3 bg-gray-800/50 flex gap-2 border-t border-gray-700/50 shrink-0">
                  <input 
                      className="flex-1 bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                      placeholder={placeholderText}
                      maxLength={50}
                      value={chatInput} onChange={e => setChatInput(e.target.value)}
                  />
                  <button type="submit" className="bg-blue-600 px-4 rounded-xl text-white hover:bg-blue-500 disabled:opacity-50"><Send size={18}/></button>
              </form>
          )}
      </div>
  );
};