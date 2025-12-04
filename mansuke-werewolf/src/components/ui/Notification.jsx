import React, { useEffect, useState } from 'react';
import { Info, AlertCircle, CheckCircle, X, Bell } from 'lucide-react';

// 右上に表示するトースト通知
export const Notification = ({ message, type = 'info', duration = 3000, onClose }) => {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(false);
      setTimeout(onClose, 300); // アニメーション終了後に削除
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  // タイプに応じたスタイル
  let bgClass = "bg-gray-800 border-gray-600 text-white";
  let Icon = Bell;

  if (type === 'success') {
      bgClass = "bg-green-900/90 border-green-500 text-green-100";
      Icon = CheckCircle;
  } else if (type === 'error') {
      bgClass = "bg-red-900/90 border-red-500 text-red-100";
      Icon = AlertCircle;
  } else if (type === 'info') {
      bgClass = "bg-blue-900/90 border-blue-500 text-blue-100";
      Icon = Info;
  } else if (type === 'warning') {
      bgClass = "bg-yellow-900/90 border-yellow-500 text-yellow-100";
      Icon = AlertCircle;
  }

  return (
    <div className={`fixed top-4 right-0 left-0 md:left-auto md:right-4 z-[300] flex justify-center md:justify-end pointer-events-none transition-all duration-300 transform ${show ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
      <div className={`${bgClass} border shadow-2xl rounded-xl p-4 flex items-start gap-3 max-w-sm w-[90%] md:w-80 backdrop-blur-md pointer-events-auto relative overflow-hidden`}>
        <div className="shrink-0 mt-0.5">
            <Icon size={20} />
        </div>
        <div className="flex-1 text-sm font-bold leading-relaxed break-words">
            {message}
        </div>
        <button onClick={() => setShow(false)} className="shrink-0 opacity-70 hover:opacity-100 transition">
            <X size={16} />
        </button>
        
        {/* タイムバー */}
        <div className="absolute bottom-0 left-0 h-0.5 bg-white/30 w-full animate-shrink-width" style={{ animationDuration: `${duration}ms` }}></div>
      </div>
    </div>
  );
};