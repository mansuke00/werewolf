import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyCDNS0bAPzghpFZ5V0kpECBeOcu1WkTInw",
  authDomain: "new-mansuke-jinro.firebaseapp.com",
  projectId: "new-mansuke-jinro",
  storageBucket: "new-mansuke-jinro.firebasestorage.app",
  messagingSenderId: "1019688806664",
  appId: "1:1019688806664:web:055c9aabe8a0bdb422a4bd",
  measurementId: "G-R5XLK481M6"
};

// アプリ初期化ロジック
// シングルトンパターン採用
// HMR(ホットリロード)時の重複初期化エラー回避のため getApps().length で判定
// 初期化済みなら getApp() で既存インスタンス取得
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Firestoreインスタンスのエクスポート
export const db = getFirestore(app);

// Authインスタンスのエクスポート
export const auth = getAuth(app);

// Cloud Functionsインスタンスのエクスポート
// 第2引数: リージョン指定 'asia-northeast2' (大阪)
// デプロイ先リージョンと一致させる必要あり
export const functions = getFunctions(app, 'asia-northeast2');