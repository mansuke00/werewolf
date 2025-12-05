// システム管理・メンテナンス系のハンドラー

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();

// メンテナンスモード切替
exports.toggleMaintenanceHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { enabled } = request.data;
    
    const settingsRef = db.collection('system').doc('settings');
    await settingsRef.set({ maintenanceMode: enabled }, { merge: true });
    
    // メンテナンスONになったら、待機中の部屋をすべて削除する
    if (enabled) {
        const roomsRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms');
        const snapshot = await roomsRef.where('status', '==', 'waiting').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
    }
    
    return { success: true };
};