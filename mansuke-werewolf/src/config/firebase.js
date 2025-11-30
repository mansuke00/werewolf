import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

// Firebaseプロジェクトの設定値
// 一般公開されるクライアントキーなので、セキュリティルールで保護すること
const firebaseConfig = {
  apiKey: "AIzaSyCDNS0bAPzghpFZ5V0kpECBeOcu1WkTInw",
  authDomain: "new-mansuke-jinro.firebaseapp.com",
  projectId: "new-mansuke-jinro",
  storageBucket: "new-mansuke-jinro.firebasestorage.app",
  messagingSenderId: "1019688806664",
  appId: "1:1019688806664:web:055c9aabe8a0bdb422a4bd",
  measurementId: "G-R5XLK481M6"
};

// Reactの再レンダリングやHMRで二重初期化エラーが出るのを防ぐためのシングルトンパターン
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app);
export const auth = getAuth(app);
// Cloud Functionsのリージョン指定。これを合わせないとCORSエラーや404になる
export const functions = getFunctions(app, 'asia-northeast2');