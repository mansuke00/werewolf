const { onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

// Admin SDKの初期化（コールドスタート対策で重複初期化防止）
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// グローバルオプション設定
// リージョンを東京(asia-northeast2)に統一
const { setGlobalOptions } = require("firebase-functions/v2");
setGlobalOptions({ region: "asia-northeast2", maxInstances: 10 });

// ハンドラーの読み込み（srcフォルダから）
// index.js (handlers集約ファイル) を require することで全ハンドラーにアクセス可能
const handlers = require('./src/handlers');

// --- 定期実行関数 ---

// 放置部屋のクリーンアップ (10分ごとに実行)
// サーバーサイドで定期的に監視し、プレイヤーが全員いなくなった部屋を自動終了させる
exports.cleanupAbandonedRooms = onSchedule({ schedule: "every 10 minutes", region: "asia-northeast2" }, async (event) => {
    const roomsRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms');
    const now = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000; // タイムアウト判定基準：10分
    
    const batch = db.batch();
    let updateCount = 0;
  
    // 監視対象のステータス：プレイ中または待機中
    const statusesToCheck = ['playing', 'waiting'];
  
    for (const status of statusesToCheck) {
        // ステータスごとにクエリ実行
        const snapshot = await roomsRef.where('status', '==', status).get();
        
        for (const doc of snapshot.docs) {
            // プレイヤーサブコレクションを取得して生存確認
            const playersSnap = await doc.ref.collection('players').get();
            let allOffline = true;
            
            if (!playersSnap.empty) {
                for (const pDoc of playersSnap.docs) {
                    const pData = pDoc.data();
                    // lastSeen（最終アクセス時刻）を確認
                    const lastSeen = pData.lastSeen && pData.lastSeen.toMillis ? pData.lastSeen.toMillis() : 0;
                    // 1人でも10分以内にアクセスがあれば部屋は有効とみなす
                    if (now - lastSeen < TIMEOUT_MS) {
                        allOffline = false;
                        break;
                    }
                }
            }
  
            // 全員オフライン（またはプレイヤー0人）の場合
            if (allOffline) {
                const roomData = doc.data();
                // プレイ中は「中断(aborted)」、ロビー待機中は「閉鎖(closed)」へ変更
                const nextStatus = status === 'playing' ? 'aborted' : 'closed';
                
                // システムログ追加
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
  
    // 更新があればコミット
    if (updateCount > 0) {
        await batch.commit();
    }
    console.log(`Cleaned up ${updateCount} abandoned rooms.`);
});

// --- Callable Functions (API) ---
// クライアントから call される関数群
// 実装ロジックは handlers オブジェクト内の各関数に委譲

// 観戦者参加
exports.joinSpectator = onCall(handlers.joinSpectatorHandler);
// メンテナンスモード切替
exports.toggleMaintenance = onCall(handlers.toggleMaintenanceHandler);
// 部屋削除
exports.deleteRoom = onCall(handlers.deleteRoomHandler);
// ゲーム強制終了
exports.abortGame = onCall(handlers.abortGameHandler);
// ゲーム開始
exports.startGame = onCall(handlers.startGameHandler);
// プレイヤー追放
exports.kickPlayer = onCall(handlers.kickPlayerHandler);
// 夜のアクション（単体）
exports.submitNightAction = onCall(handlers.submitNightActionHandler);
// 夜のチームアクション（提案・投票）
exports.nightInteraction = onCall(handlers.nightInteractionHandler);
// フェーズ進行監視
exports.advancePhase = onCall(handlers.advancePhaseHandler);
// 全プレイヤー役職取得
exports.getAllPlayerRoles = onCall(handlers.getAllPlayerRolesHandler);
// 準備完了状態切替
exports.toggleReady = onCall(handlers.toggleReadyHandler);
// 投票実行
exports.submitVote = onCall(handlers.submitVoteHandler);
// ホスト権限移行
exports.migrateHost = onCall(handlers.migrateHostHandler);
// ロビーへリセット（再戦）
exports.resetToLobby = onCall(handlers.resetToLobbyHandler);