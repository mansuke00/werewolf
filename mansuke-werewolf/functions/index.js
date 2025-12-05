// Cloud Functions エントリーポイント
// ここでは各ハンドラーを紐付けるだけにし、実装は src/handlers.js に分離しています

const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

const { setGlobalOptions } = require("firebase-functions/v2");
setGlobalOptions({ region: "asia-northeast2", maxInstances: 10 });

// ハンドラーの読み込み（srcフォルダから）
const handlers = require('./src/handlers');

// --- 定期実行関数 ---

// 放置部屋のクリーンアップ (10分ごと)
exports.cleanupAbandonedRooms = onSchedule({ schedule: "every 10 minutes", region: "asia-northeast2" }, async (event) => {
    const roomsRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms');
    const now = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000; // 10分
    
    const batch = db.batch();
    let updateCount = 0;
  
    const statusesToCheck = ['playing', 'waiting'];
  
    for (const status of statusesToCheck) {
        const snapshot = await roomsRef.where('status', '==', status).get();
        
        for (const doc of snapshot.docs) {
            const playersSnap = await doc.ref.collection('players').get();
            let allOffline = true;
            if (!playersSnap.empty) {
                for (const pDoc of playersSnap.docs) {
                    const pData = pDoc.data();
                    const lastSeen = pData.lastSeen && pData.lastSeen.toMillis ? pData.lastSeen.toMillis() : 0;
                    if (now - lastSeen < TIMEOUT_MS) {
                        allOffline = false;
                        break;
                    }
                }
            }
  
            if (allOffline) {
                const roomData = doc.data();
                const nextStatus = status === 'playing' ? 'aborted' : 'closed';
                const logMsg = {
                    text: "プレイヤーが全員不在となったため、システムにより自動終了しました。",
                    phase: "System",
                    day: roomData.day || 1
                };
                batch.update(doc.ref, { 
                    status: nextStatus,
                    logs: admin.firestore.FieldValue.arrayUnion(logMsg)
                });
                updateCount++;
            }
        }
    }
  
    if (updateCount > 0) {
        await batch.commit();
    }
    console.log(`Cleaned up ${updateCount} abandoned rooms.`);
});

// --- Callable Functions (API) ---

exports.joinSpectator = onCall(handlers.joinSpectatorHandler);
exports.toggleMaintenance = onCall(handlers.toggleMaintenanceHandler);
exports.deleteRoom = onCall(handlers.deleteRoomHandler);
exports.abortGame = onCall(handlers.abortGameHandler);
exports.startGame = onCall(handlers.startGameHandler);
exports.kickPlayer = onCall(handlers.kickPlayerHandler);
exports.submitNightAction = onCall(handlers.submitNightActionHandler);
exports.nightInteraction = onCall(handlers.nightInteractionHandler);
exports.advancePhase = onCall(handlers.advancePhaseHandler);
exports.getAllPlayerRoles = onCall(handlers.getAllPlayerRolesHandler);
exports.toggleReady = onCall(handlers.toggleReadyHandler);
exports.submitVote = onCall(handlers.submitVoteHandler);
exports.migrateHost = onCall(handlers.migrateHostHandler);
exports.resetToLobby = onCall(handlers.resetToLobbyHandler);