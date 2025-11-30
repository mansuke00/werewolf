import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Check, Info } from 'lucide-react';
import { NOTIFICATION_DURATION } from '../../constants/gameData';

// 右上のトースト通知
export const Notification = ({ message, type, onClose, duration }) => {
  const displayTime = duration || NOTIFICATION_DURATION;
  
  // onCloseの最新の参照を保持し、useEffectの依存配列から除外するテクニック
  // これにより、親コンポーネントの再レンダリング時にもタイマーがリセットされない
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => { 
      const timer = setTimeout(() => {
          if (onCloseRef.current) onCloseRef.current();
      }, displayTime); 
      return () => clearTimeout(timer); 
  }, [message, displayTime]);

  const bgColors = { 
      info: "bg-blue-600/90", 
      success: "bg-green-600/90", 
      error: "bg-red-600/90", 
      warning: "bg-yellow-600/90" 
  };
  
  return (
    <div className={`fixed top-6 right-6 z-[300] ${bgColors[type] || "bg-gray-800"} backdrop-blur-md text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-fade-in-down max-w-sm border border-white/10`}>
      {type === 'error' && <AlertTriangle size={20} />}
      {type === 'success' && <Check size={20} />}
      {type === 'info' && <Info size={20} />}
      <p className="font-medium tracking-wide">{message}</p>
    </div>
  );
};