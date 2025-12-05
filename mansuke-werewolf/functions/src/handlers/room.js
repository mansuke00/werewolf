// 部屋管理・プレイヤー管理系のハンドラー

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();

const { checkWin } = require('../utils');
const { checkNightCompletion, applyPhaseChange } = require('../core');

// 観戦者として参加
exports.joinSpectatorHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode, nickname, isDev } = request.data;
    const uid = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        const roomSnap = await t.get(roomRef);
        if (!roomSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
        const room = roomSnap.data();

        const playerRef = roomRef.collection('players').doc(uid);
        const playerData = {
            name: nickname,
            status: 'dead',
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSeen: admin.firestore.FieldValue.serverTimestamp(),
            isSpectator: true
        };
        
        // 開発者フラグがあれば保存
        if (isDev) {
            playerData.isDev = true;
        }

        t.set(playerRef, playerData);

        t.update(roomRef, {
            notificationEvent: {
                message: `${nickname}が観戦者として途中参加しました。`,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }
        });
    });
    return { success: true };
};

// 部屋削除
exports.deleteRoomHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    const batch = db.batch();
    
    // サブコレクションの削除
    const subcollections = ['chat', 'teamChats', 'graveChat', 'votes', 'players'];
    for (const subColName of subcollections) {
        const snap = await roomRef.collection(subColName).get();
        for (const doc of snap.docs) {
            batch.delete(doc.ref);
            if (subColName === 'players') {
                batch.delete(doc.ref.collection('secret').doc('roleData'));
                batch.delete(doc.ref.collection('secret').doc('actionResult'));
            }
        }
    }
    
    batch.delete(roomRef);
    await batch.commit();
    return { success: true };
};

// ゲーム強制終了
exports.abortGameHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        const rSnap = await t.get(roomRef);
        if (!rSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
        const room = rSnap.data();
        
        t.update(roomRef, {
            status: 'aborted',
            logs: admin.firestore.FieldValue.arrayUnion({
                text: "ホストがゲームを強制終了しました。",
                phase: "System",
                day: room.day || 1
            })
        });
    });
    return { success: true };
};

// プレイヤー追放
exports.kickPlayerHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode, playerId } = request.data;
    const requesterId = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        // 1. 全ての読み取り操作を最初に行う
        const rSnap = await t.get(roomRef);
        if (!rSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
        const room = rSnap.data();
        
        // 実行者の権限チェック（ホスト または 開発者フラグ持ち）
        const requesterRef = roomRef.collection('players').doc(requesterId);
        const requesterSnap = await t.get(requesterRef);
        
        const isHost = room.hostId === requesterId;
        const isDev = requesterSnap.exists && requesterSnap.data().isDev === true;
        
        if (!isHost && !isDev) {
            throw new HttpsError('permission-denied', '権限がありません');
        }

        const pRef = roomRef.collection('players').doc(playerId);
        const pSnap = await t.get(pRef);
        if (!pSnap.exists) throw new HttpsError('not-found', 'プレイヤーが見つかりません');
        
        const allPlayersSnap = await t.get(roomRef.collection('players'));
        
        const playersData = [];
        const secretRefs = [];
        const playerDocs = [];
        
        // 観戦者かどうかを確認
        const isTargetSpectator = pSnap.data().isSpectator;

        if (isTargetSpectator) {
            // 観戦者の場合
            t.delete(pRef);
            const pName = pSnap.data().name;
            const currentDay = room.day || 1;
            t.update(roomRef, { 
                logs: admin.firestore.FieldValue.arrayUnion({ text: `${pName}がホスト/管理者により追放されました。`, phase: "System", day: currentDay }) 
            });
            return;
        }

        // 通常プレイヤー追放ロジック
        for (const docSnap of allPlayersSnap.docs) {
            const p = { id: docSnap.id, ...docSnap.data() };
            if (p.id === playerId) {
                p.status = 'dead'; 
                p.deathReason = '強制追放';
            }
            playerDocs.push(p);
            secretRefs.push(docSnap.ref.collection('secret').doc('roleData'));
        }
        
        const secretSnaps = await t.getAll(...secretRefs);
        
        for (let i = 0; i < playerDocs.length; i++) {
            const p = playerDocs[i];
            const sSnap = secretSnaps[i];
            if (sSnap.exists) {
                p.role = sSnap.data().role;
            }
            playersData.push(p);
        }

        // 2. 書き込み操作を開始
        const currentDay = room.day || 1;
        
        // プレイヤーのステータス更新
        t.update(pRef, { status: 'dead', deathReason: 'ホストによる追放', diedDay: currentDay });
        
        const pName = pSnap.data().name;
        t.update(roomRef, { 
            logs: admin.firestore.FieldValue.arrayUnion({ text: `${pName}がホスト/管理者により追放されました。`, phase: "System", day: currentDay }) 
        });

        // 勝敗判定
        const deadIds = playersData.filter(p => p.status === 'dead' || p.status === 'vanished').map(p => p.id);
        const winner = checkWin(playersData, deadIds);
        
        if (winner) {
            t.update(roomRef, { status: 'finished', winner: winner });
        } else if (room.phase && room.phase.startsWith('night')) {
            await checkNightCompletion(t, roomRef, room, playersData);
        } else if (room.phase && room.phase.startsWith('day')) {
             const alive = playersData.filter(p => p.status === 'alive');
             const allReady = alive.every(p => p.isReady);
             if (allReady && alive.length > 0) {
                 await applyPhaseChange(t, roomRef, room, playersData);
             }
        }
    });
    return { success: true };
};

// 全プレイヤーの役職取得（ゲーム終了後または管理者）
exports.getAllPlayerRolesHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const uid = request.auth.uid;
    
    // 参照取得
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    const roomSnap = await roomRef.get();
    
    if (!roomSnap.exists) throw new HttpsError('not-found', 'Room not found');
    const room = roomSnap.data();

    // プレイヤー情報の取得
    const pSnap = await roomRef.collection('players').get();
    const meDoc = pSnap.docs.find(d => d.id === uid);
    const me = meDoc ? meDoc.data() : null;
    
    // 権限チェック用フラグ
    const status = room.status;
    const isFinished = status === 'finished' || status === 'closed' || status === 'aborted';
    
    const isHost = room.hostId === uid;
    const isDead = me && (me.status === 'dead' || me.status === 'vanished');
    const isDev = me && me.isDev === true;
    const isSpectator = me && me.isSpectator === true;
    
    // いずれかの条件を満たせば許可
    // ゲームが終了している場合(isFinished)は、プレイヤーの状態に関わらず全員に許可する
    const isAllowed = isFinished || isHost || isDead || isDev || isSpectator;

    if (!isAllowed) {
        throw new HttpsError('permission-denied', `権限がありません (status:${status})`);
    }

    // データ構築
    const playersData = [];
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    const secretSnaps = await db.getAll(...secretRefs);
    
    pSnap.docs.forEach((d, i) => {
        const p = { id: d.id, ...d.data() };
        if (secretSnaps[i].exists) {
            const sData = secretSnaps[i].data();
            p.role = sData.role;
            p.originalRole = sData.originalRole;
        }
        playersData.push(p);
    });
    
    return { players: playersData };
};

// ホスト権限移行
exports.migrateHostHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const uid = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    await db.runTransaction(async (t) => {
        const rSnap = await t.get(roomRef);
        if (!rSnap.exists) return;
        const room = rSnap.data();
        if (room.hostId === uid) return;
        t.update(roomRef, { hostId: uid });
    });
    return { success: true };
};

// ロビーへリセット（再戦）
exports.resetToLobbyHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  const batch = db.batch();
  
  const chatSnap = await roomRef.collection('chat').get();
  const teamChatSnap = await roomRef.collection('teamChats').get();
  const graveChatSnap = await roomRef.collection('graveChat').get();
  const voteSnap = await roomRef.collection('votes').get();
  const playerSnap = await roomRef.collection('players').get();
  
  chatSnap.docs.forEach(d => batch.delete(d.ref));
  teamChatSnap.docs.forEach(d => batch.delete(d.ref));
  graveChatSnap.docs.forEach(d => batch.delete(d.ref));
  voteSnap.docs.forEach(d => batch.delete(d.ref));
  
  playerSnap.docs.forEach(d => {
      const updates = { 
          status: 'alive', 
          isReady: false, 
          isSpectator: admin.firestore.FieldValue.delete(), 
          deathReason: admin.firestore.FieldValue.delete(), 
          diedDay: admin.firestore.FieldValue.delete(), 
          lastTarget: admin.firestore.FieldValue.delete()
      };
      batch.update(d.ref, updates);
      batch.delete(d.ref.collection('secret').doc('roleData'));
      batch.delete(d.ref.collection('secret').doc('actionResult'));
  });
  
  batch.update(roomRef, {
      status: 'waiting', phase: 'lobby', day: 1, logs: [], 
      winner: admin.firestore.FieldValue.delete(), 
      nightActions: admin.firestore.FieldValue.delete(), 
      nightLeaders: admin.firestore.FieldValue.delete(), 
      pendingActions: admin.firestore.FieldValue.delete(), 
      awakeningEvents: admin.firestore.FieldValue.delete(), 
      nightAllDoneTime: admin.firestore.FieldValue.delete(), 
      executionResult: admin.firestore.FieldValue.delete(), 
      deathResult: admin.firestore.FieldValue.delete(), 
      voteSummary: admin.firestore.FieldValue.delete(), 
      phaseStartTime: admin.firestore.FieldValue.serverTimestamp(), 
      assassinUsed: admin.firestore.FieldValue.delete(), 
      matchId: admin.firestore.FieldValue.delete(), 
      teruteruWon: admin.firestore.FieldValue.delete(),
      notificationEvent: admin.firestore.FieldValue.delete()
  });
  await batch.commit();
  return { success: true };
};