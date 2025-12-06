import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// アプリケーションのエントリーポイント
// HTMLのルート要素を取得し、Reactアプリケーションをマウントする
ReactDOM.createRoot(document.getElementById('root')).render(
  // StrictMode: 開発環境専用ラッパー
  // 意図しない副作用を検出するため、コンポーネントを二重にレンダリングする
  // 本番ビルド時には影響しない
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)