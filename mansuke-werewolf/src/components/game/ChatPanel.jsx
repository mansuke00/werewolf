import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MessageSquare, Send, Users, Ghost, PenTool, Lock, ArrowUp } from 'lucide-react';
import { getMillis } from '../../utils/helpers';
import { ROLE_DEFINITIONS } from '../../constants/gameData';

// チャットパネルコンポーネント
// 用途: 全体チャット、人狼チャット、霊界チャットなどの表示と入力
// propsにより表示モードやフィルタリングルールを切り替える
// playerRoles: 全プレイヤーの役職情報 { [id]: {role, originalRole} } (霊界表示用)
export const ChatPanel = ({ 
    messages, 
    user, 
    teammates, 
    myPlayer, 
    onSendMessage, 
    title = "生存者チャット", 
    isTeamChat = false, 
    currentDay, 
    currentPhase, 
    disableFilter = false, 
    readOnly = false, 
    disabled = false,
    playerRoles = null // 追加: 役職表示用の情報
}) => {
  // 入力中のメッセージ状態
  const [chatInput, setChatInput] = useState("");
  // 自動スクロール用のRef
  const scrollRef = useRef(null);
  
  // メッセージ更新時に最下部へ自動スクロール
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // 送信ハンドラー
  const handleSubmit = async (e) => {
      e.preventDefault();
      // 空文字チェック
      if(chatInput.trim()) { 
          // 文字数制限チェック（クライアントサイドバリデーション）
          if (chatInput.length > 50) {
              alert("メッセージは50文字以内で入力してください。");
              return;
          }
          try {
            // 親コンポーネントから渡された送信関数を実行
            await onSendMessage(chatInput); 
            // 送信成功したら入力欄をクリア
            setChatInput(""); 
          } catch(err) {
            console.error("Chat Error:", err);
            alert("メッセージの送信に失敗しました。通信環境を確認してください。");
          }
      }
  };
  
  const safeMessages = Array.isArray(messages) ? messages : [];
  // タイトルで霊界チャットかどうかを判定（簡易判定）
  const isGrave = title === "霊界チャット";
  
  // メッセージフィルタリングロジック（メモ化）
  const filteredMessages = useMemo(() => {
      if (disableFilter || isGrave) return safeMessages;
      
      const isNightPhase = (currentPhase && typeof currentPhase === 'string') 
          ? currentPhase.startsWith('night') 
          : false;
          
      // DB上のフェーズラベル（day/night）と照合
      const phaseLabel = isNightPhase ? 'night' : 'day';
      
      return safeMessages.filter(m => m && m.day === currentDay && m.phaseLabel === phaseLabel);
  }, [safeMessages, currentDay, currentPhase, isGrave, isTeamChat, disableFilter]);

  // ソートロジック（メモ化）
  const sortedMessages = useMemo(() => {
      return [...filteredMessages].sort((a, b) => {
          const tA = getMillis(a.createdAt);
          const tB = getMillis(b.createdAt);
          return tA - tB;
      });
  }, [filteredMessages]);
  
  // --- スタイル定義関数群 ---
  
  const getContainerStyle = () => {
      if (isGrave) return "bg-indigo-950/40 border-indigo-500/30"; 
      if (isTeamChat) return "bg-purple-950/40 border-purple-500/30"; 
      return "bg-gray-900/60 border-gray-700/50"; 
  };
  
  const getHeaderStyle = () => {
      if (isGrave) return "bg-indigo-900/40 border-indigo-500/20";
      if (isTeamChat) return "bg-purple-900/40 border-purple-500/30";
      return "bg-gray-800/60 border-gray-700/50";
  };
    
  const getMsgBubbleStyle = (isMe) => {
      if (isGrave) return isMe 
          ? "bg-indigo-600 text-white rounded-br-sm shadow-indigo-900/20" 
          : "bg-gray-800 text-indigo-100 rounded-bl-sm border border-indigo-500/30";
      if (isTeamChat) return isMe 
          ? "bg-purple-600 text-white rounded-br-sm shadow-purple-900/20" 
          : "bg-purple-900/40 text-purple-100 rounded-bl-sm border border-purple-500/30";
      return isMe 
          ? "bg-blue-600 text-white rounded-br-sm shadow-blue-900/20" 
          : "bg-gray-800 text-gray-200 rounded-bl-sm border border-gray-700";
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
  
  // 役職表示用のヘルパー関数
  const getRoleLabel = (senderId) => {
      if (!playerRoles || !playerRoles[senderId]) return "";
      
      const { role, originalRole } = playerRoles[senderId];
      if (!role) return "";

      // 呪われし者の特別表記
      if (originalRole === 'cursed') {
          if (role === 'werewolf') return "（呪われし者 - 人狼陣営）";
          return "（呪われし者 - 市民陣営）";
      }

      const roleName = ROLE_DEFINITIONS[role]?.name || role;
      return `（${roleName}）`;
  };

  // 無効状態のレンダリング
  if (disabled) {
      return (
          <div className={`flex flex-col h-full backdrop-blur-xl border overflow-hidden shadow-xl items-center justify-center text-center p-4 rounded-2xl ${getContainerStyle()}`}>
              <div className="bg-gray-800/50 p-4 rounded-full mb-4">
                  <Lock size={32} className="text-gray-500"/>
              </div>
              <h3 className="text-lg font-bold text-gray-300">チャット利用不可</h3>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">対面モードが有効なため、<br/>このチャットは利用できません。</p>
          </div>
      );
  }

  return (
      <div className={`flex flex-col h-full backdrop-blur-xl border overflow-hidden shadow-xl rounded-2xl ${getContainerStyle()}`}>
          {/* ヘッダーエリア */}
          <div className={`px-3 py-2 md:px-4 md:py-3 border-b flex flex-col shrink-0 ${getHeaderStyle()}`}>
              <div className="flex items-center justify-between">
                  <span className={`font-bold flex items-center gap-2 text-xs md:text-sm truncate ${isTeamChat ? "text-purple-300" : isGrave ? "text-indigo-200" : "text-blue-100"}`}>
                      {isTeamChat ? (teammates?.length > 0 ? <Users size={16} className="shrink-0"/> : <PenTool size={16} className="shrink-0"/>) : isGrave ? <Ghost size={16} className="shrink-0"/> : <MessageSquare size={16} className="shrink-0"/>} 
                      <span className="truncate">{title}</span>
                  </span>
                  {!readOnly && (
                      <span className="text-[10px] bg-black/20 px-2 py-0.5 rounded-full text-gray-400 font-mono shrink-0 ml-2">
                          {chatInput.length}/50
                      </span>
                  )}
              </div>
              {descriptionText && (
                  <span className={`text-[10px] mt-1 leading-tight truncate ${isTeamChat ? "text-purple-300/70" : "text-indigo-300/70"}`}>
                      {descriptionText}
                  </span>
              )}
          </div>
          
          {/* メッセージリストエリア */}
          <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-3 md:space-y-4 custom-scrollbar bg-black/10 min-h-0">
              {sortedMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center opacity-30 text-gray-400">
                      <MessageSquare size={40} className="mb-2"/>
                      <p className="text-xs font-bold">No messages</p>
                  </div>
              )}
              
              {sortedMessages.map((msg, idx) => {
                  const isMe = msg.senderId === user?.uid;
                  // 名前表示判定：自分以外で、かつ前のメッセージと送信者が違う場合（または最初）
                  const showName = !isMe && (idx === 0 || sortedMessages[idx-1].senderId !== msg.senderId);
                  
                  const showDayHeader = msg.day && (!sortedMessages[idx - 1] || sortedMessages[idx - 1].day !== msg.day);

                  // 役職表示が必要な場合（霊界または過去ログ閲覧時で、playerRolesが渡されている場合）
                  const roleLabel = (isGrave || readOnly) && playerRoles ? getRoleLabel(msg.senderId) : "";

                  return (
                      <div key={idx} className="w-full">
                          {showDayHeader && (
                              <div className="flex justify-center mt-2 mb-4 shrink-0">
                                  <span className="bg-black/40 backdrop-blur-sm border border-gray-700/50 text-gray-400 text-[10px] font-bold px-3 py-0.5 rounded-full shadow-sm">
                                      {msg.day}日目
                                  </span>
                              </div>
                          )}

                          <div className={`flex flex-col ${isMe ? "items-end" : "items-start"} animate-fade-in`}>
                               {showName && (
                                   <div className="flex items-baseline gap-2 mb-1 ml-1 flex-wrap">
                                       <span className={`text-[10px] font-bold ${isTeammate(msg.senderId) && !isGrave && !isTeamChat ? "text-red-400" : "text-gray-400"}`}>
                                           {msg.senderName}
                                           {roleLabel && <span className="ml-1 text-gray-500 font-normal">{roleLabel}</span>}
                                       </span>
                                   </div>
                               )}
                               <div className={`px-3 py-2 md:px-4 md:py-2.5 rounded-2xl max-w-[85%] break-words text-xs md:text-sm font-medium shadow-md leading-relaxed ${getMsgBubbleStyle(isMe)}`}>
                                   {msg.text}
                               </div>
                               <span className="text-[9px] text-gray-600 mt-1 px-1 opacity-60">
                                   {msg.createdAt ? new Date(getMillis(msg.createdAt)).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ""}
                               </span>
                          </div>
                      </div>
                  );
              })}
              <div ref={scrollRef}></div>
          </div>
          
          {/* 入力フォームエリア */}
          {!readOnly && (
              <form onSubmit={handleSubmit} className="p-2 md:p-3 bg-gray-900/40 backdrop-blur-md flex gap-2 border-t border-gray-700/30 shrink-0">
                  <div className="relative flex-1">
                      <input 
                          className="w-full bg-gray-800/80 border border-gray-600 rounded-xl pl-3 pr-8 py-2 md:pl-4 md:pr-10 md:py-3 text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition outline-none text-xs md:text-sm placeholder-gray-500"
                          placeholder={placeholderText}
                          maxLength={50}
                          value={chatInput} 
                          onChange={e => setChatInput(e.target.value)}
                      />
                      <div className={`absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-colors ${chatInput.length > 40 ? "bg-red-500" : chatInput.length > 0 ? "bg-green-500" : "bg-gray-600"}`}></div>
                  </div>
                  <button 
                      type="submit" 
                      disabled={!chatInput.trim()}
                      className="bg-blue-600 w-10 md:w-12 h-full rounded-xl text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center shadow-lg active:scale-95 shrink-0"
                  >
                      <ArrowUp size={18} md:size={20} strokeWidth={3}/>
                  </button>
              </form>
          )}
      </div>
  );
};