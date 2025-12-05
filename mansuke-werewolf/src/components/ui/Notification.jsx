import React, { useEffect, useState } from 'react';
import { Info, AlertCircle, CheckCircle, Bell, X } from 'lucide-react';

// 右上の通知トースト
// 修正：タイムバーや過剰なスタイルを削除し、視認性の高いシンプルなデザインに戻しました
// レスポンシブ対応：画面幅に合わせたサイズ調整と配置（スマホでは上部中央、PCでは右上）を行っています
export const Notification = ({ message, type = 'info', duration = 3000, onClose }) => {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShow(false);
      setTimeout(onClose, 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  // タイプに応じたシンプルな配色
  let bgClass = "bg-gray-800 text-white border-gray-600";
  let Icon = Bell;

  if (type === 'success') {
      bgClass = "bg-green-800 text-white border-green-600";
      Icon = CheckCircle;
  } else if (type === 'error') {
      bgClass = "bg-red-800 text-white border-red-600";
      Icon = AlertCircle;
  } else if (type === 'info') {
      bgClass = "bg-blue-800 text-white border-blue-600";
      Icon = Info;
  } else if (type === 'warning') {
      bgClass = "bg-yellow-800 text-white border-yellow-600";
      Icon = AlertCircle;
  }

  return (
    <div className={`fixed top-4 right-0 md:right-4 left-0 md:left-auto z-[300] flex justify-center md:justify-end pointer-events-none transition-all duration-300 transform ${show ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'}`}>
      <div className={`pointer-events-auto shadow-xl rounded-lg border p-4 max-w-sm w-[90%] md:w-80 flex items-start gap-3 ${bgClass}`}>
        <div className="shrink-0 mt-0.5">
            <Icon size={20} />
        </div>
        <div className="flex-1 text-sm font-bold leading-relaxed break-words">
            {message}
        </div>
        <button onClick={() => setShow(false)} className="shrink-0 opacity-70 hover:opacity-100 transition">
            <X size={16} />
        </button>
      </div>
    </div>
  );
};