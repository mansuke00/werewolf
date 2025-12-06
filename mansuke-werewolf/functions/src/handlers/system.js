// システム管理・メンテナンス系のハンドラー

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();

// メンテナンスモード切替ハンドラー
// 管理画面などから呼び出される想定
exports.toggleMaintenanceHandler = async (request) => {
    // 認証チェック
    // 現状はログイン必須のみ（今度また実装する by Hiraku)
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    
    const { enabled } = request.data;
    
    // システム設定ドキュメント更新
    // クライアント側でこの値を監視してメンテナンス画面を出す想定
    const settingsRef = db.collection('system').doc('settings');
    await settingsRef.set({ maintenanceMode: enabled }, { merge: true });
    
    // メンテナンスONになったら、待機中の部屋をすべて削除する
    // プレイ中の部屋はそのまま（強制終了はしない仕様）
    if (enabled) {
        const roomsRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms');
        
        // 待機中(waiting)の部屋を検索
        const snapshot = await roomsRef.where('status', '==', 'waiting').get();
        
        // 一括削除実行
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
            // サブコレクション（chat, players等）の削除はここに含まれていない
            // Cloud Functionsの再帰削除トリガーなどに任せるか、別途実装が必要な可能性あり
        });
        await batch.commit();
    }
    
    return { success: true };
};