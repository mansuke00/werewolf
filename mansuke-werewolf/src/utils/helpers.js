import { OFFLINE_TIMEOUT_MS } from "../constants/gameData";

// FirestoreのTimestamp型と通常のDate型の違いを吸収するラッパー関数
// サーバーから来るデータ形式が揺らぐことがあるため、防御的に実装
export const getMillis = (ts) => {
    if (!ts) return Date.now(); 
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts.seconds) return ts.seconds * 1000;
    return Date.now();
};

// 最終更新時間を見てオンライン状態を判定
export const isPlayerOnline = (p) => {
    if (!p) return false;
    const lastSeen = getMillis(p.lastSeen);
    return Date.now() - lastSeen < OFFLINE_TIMEOUT_MS;
};

// フェーズ名を画面表示用の日本語に変換
export const formatPhaseName = (phase, day) => {
    if(!phase) return "";
    if(phase === 'voting') return `${day || 0}日目 - 投票`;
    if(phase.startsWith('day')) return `${day || 1}日目 - 昼`;
    if(phase.startsWith('night')) return `${day || 1}日目 - 夜`;
    if(phase === 'role_reveal') return "役職確認";
    if(phase.startsWith('announcement')) return `${day || 1}日目 - 朝`;
    return phase;
};