// 部屋管理・プレイヤー管理系のハンドラー

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();

const { checkWin } = require('../utils');
// archiveGameは強制終了時や決着時にゲームデータを保存する関数
const { checkNightCompletion, applyPhaseChange, archiveGame } = require('../core');

// 観戦者参加ハンドラー
// 途中参加や、定員オーバー時の観戦希望などで使用
exports.joinSpectatorHandler = async (request) => {
    // 認証チェック
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    
    const { roomCode, nickname, isDev } = request.data;
    const uid = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        // 部屋存在確認
        const roomSnap = await t.get(roomRef);
        if (!roomSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
        const room = roomSnap.data();

        // プレイヤーデータ作成（観戦者フラグON）
        // ステータスはdead扱いにしておく（ゲーム進行に影響させないため）
        const playerRef = roomRef.collection('players').doc(uid);
        const playerData = {
            name: nickname,
            status: 'dead', // 観戦者は死者扱い
            joinedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastSeen: admin.firestore.FieldValue.serverTimestamp(),
            isSpectator: true
        };
        
        // 開発者フラグがある場合は保存（デバッグ用権限などに使用）
        if (isDev) {
            playerData.isDev = true;
        }

        // プレイヤー書き込み
        t.set(playerRef, playerData);

        // 入室通知ログを追加
        t.update(roomRef, {
            notificationEvent: {
                message: `${nickname}が観戦者として途中参加しました。`,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }
        });
    });
    return { success: true };
};

// 部屋削除ハンドラー
// 部屋とそれに紐づくサブコレクションを全て削除する
exports.deleteRoomHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    const batch = db.batch();
    
    // 削除対象のサブコレクション一覧
    const subcollections = ['chat', 'teamChats', 'graveChat', 'votes', 'players'];
    
    // サブコレクション内のドキュメントをループして削除バッチに追加
    for (const subColName of subcollections) {
        const snap = await roomRef.collection(subColName).get();
        for (const doc of snap.docs) {
            batch.delete(doc.ref);
            // プレイヤーの場合はさらに下層のsecretコレクションも削除必要
            if (subColName === 'players') {
                batch.delete(doc.ref.collection('secret').doc('roleData'));
                batch.delete(doc.ref.collection('secret').doc('actionResult'));
            }
        }
    }
    
    // 部屋ドキュメント自体を削除
    batch.delete(roomRef);
    
    // 一括削除実行
    await batch.commit();
    return { success: true };
};

// ゲーム強制終了ハンドラー
// ホストがゲームを中断する場合に使用
exports.abortGameHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        const rSnap = await t.get(roomRef);
        if (!rSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
        const room = rSnap.data();
        
        // アーカイブ保存用に全プレイヤー情報（役職含む）を取得
        const pSnap = await t.get(roomRef.collection('players'));
        const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
        const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
        
        // プレイヤーデータの結合
        const players = pSnap.docs.map((d, i) => {
            const p = { id: d.id, ...d.data() };
            if(secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
            return p;
        });

        // 部屋ステータス更新：aborted
        const updates = {
            status: 'aborted',
            logs: admin.firestore.FieldValue.arrayUnion({
                text: "ホストがゲームを強制終了しました。",
                phase: "System",
                day: room.day || 1
            })
        };
        
        t.update(roomRef, updates);

        // 強制終了時の状態を別コレクションへアーカイブ保存
        // ログ分析や振り返り機能に使用
        await archiveGame(t, roomRef, {...room, ...updates}, players, 'aborted');
    });
    return { success: true };
};

// プレイヤー追放ハンドラー
// 荒らし対策や不在プレイヤーの排除用
exports.kickPlayerHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode, playerId } = request.data;
    const requesterId = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        // 1. 全ての読み取り操作を最初に行う（トランザクション制約）
        const rSnap = await t.get(roomRef);
        if (!rSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
        const room = rSnap.data();
        
        // 実行者の権限チェック（ホスト または 開発者フラグ持ち）
        const requesterRef = roomRef.collection('players').doc(requesterId);
        const requesterSnap = await t.get(requesterRef);
        
        const isHost = room.hostId === requesterId;
        const isDev = requesterSnap.exists && requesterSnap.data().isDev === true;
        
        // 権限なしエラー
        if (!isHost && !isDev) {
            throw new HttpsError('permission-denied', '権限がありません');
        }

        // 対象プレイヤー存在確認
        const pRef = roomRef.collection('players').doc(playerId);
        const pSnap = await t.get(pRef);
        if (!pSnap.exists) throw new HttpsError('not-found', 'プレイヤーが見つかりません');
        
        // 勝敗判定計算用に全プレイヤー情報取得
        const allPlayersSnap = await t.get(roomRef.collection('players'));
        
        const playersData = [];
        const secretRefs = [];
        const playerDocs = [];
        
        // 対象が観戦者かどうか
        const isTargetSpectator = pSnap.data().isSpectator;

        // 観戦者の追放処理
        if (isTargetSpectator) {
            // 単純削除
            t.delete(pRef);
            const pName = pSnap.data().name;
            const currentDay = room.day || 1;
            t.update(roomRef, { 
                logs: admin.firestore.FieldValue.arrayUnion({ text: `${pName}がホスト/管理者により追放されました。`, phase: "System", day: currentDay }) 
            });
            return; // 観戦者はゲームバランスに影響しないのでここで終了
        }

        // 通常プレイヤー追放処理（死亡扱いにする）
        // メモリ上でプレイヤーリストを構築し、対象者のステータスを変更しておく
        for (const docSnap of allPlayersSnap.docs) {
            const p = { id: docSnap.id, ...docSnap.data() };
            if (p.id === playerId) {
                p.status = 'dead'; 
                p.deathReason = '強制追放';
            }
            playerDocs.push(p);
            // 役職情報取得用の参照準備
            secretRefs.push(docSnap.ref.collection('secret').doc('roleData'));
        }
        
        // 役職情報一括取得
        const secretSnaps = await t.getAll(...secretRefs);
        
        // プレイヤーデータに役職をマージ
        for (let i = 0; i < playerDocs.length; i++) {
            const p = playerDocs[i];
            const sSnap = secretSnaps[i];
            if (sSnap.exists) {
                p.role = sSnap.data().role;
            }
            playersData.push(p);
        }

        // 2. 書き込み操作開始
        const currentDay = room.day || 1;
        
        // 対象プレイヤーを死亡ステータスへ更新
        t.update(pRef, { status: 'dead', deathReason: 'ホストによる追放', diedDay: currentDay });
        
        const pName = pSnap.data().name;
        // ログ追加
        t.update(roomRef, { 
            logs: admin.firestore.FieldValue.arrayUnion({ text: `${pName}がホスト/管理者により追放されました。`, phase: "System", day: currentDay }) 
        });

        // 追放による勝敗判定チェック
        const deadIds = playersData.filter(p => p.status === 'dead' || p.status === 'vanished').map(p => p.id);
        const winner = checkWin(playersData, deadIds);
        
        // 勝敗が決した場合
        if (winner) {
            t.update(roomRef, { status: 'finished', winner: winner });
            // 追放で決着した場合もアーカイブ保存
            await archiveGame(t, roomRef, {...room, status: 'finished', winner}, playersData, 'finished', winner);
        } 
        // 決着せず、夜フェーズの場合（全滅判定などが必要かチェック）
        else if (room.phase && room.phase.startsWith('night')) {
            await checkNightCompletion(t, roomRef, room, playersData);
        } 
        // 決着せず、昼フェーズの場合（全員準備完了状態の再チェックなど）
        else if (room.phase && room.phase.startsWith('day')) {
             const alive = playersData.filter(p => p.status === 'alive');
             const allReady = alive.every(p => p.isReady);
             // 生存者が全員Readyならフェーズ進行
             if (allReady && alive.length > 0) {
                 await applyPhaseChange(t, roomRef, room, playersData);
             }
        }
    });
    return { success: true };
};

// 全プレイヤー役職取得ハンドラー
// ゲーム終了後や管理者が役職一覧を見るために使用
exports.getAllPlayerRolesHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const uid = request.auth.uid;
    
    // 部屋情報取得
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    const roomSnap = await roomRef.get();
    
    if (!roomSnap.exists) throw new HttpsError('not-found', 'Room not found');
    const room = roomSnap.data();

    // 自分の情報取得（権限チェック用）
    const pSnap = await roomRef.collection('players').get();
    const meDoc = pSnap.docs.find(d => d.id === uid);
    const me = meDoc ? meDoc.data() : null;
    
    // 閲覧権限判定
    const status = room.status;
    const isFinished = status === 'finished' || status === 'closed' || status === 'aborted';
    
    const isHost = room.hostId === uid; // ホスト
    const isDead = me && (me.status === 'dead' || me.status === 'vanished'); // 死亡者
    const isDev = me && me.isDev === true; // 開発者
    const isSpectator = me && me.isSpectator === true; // 観戦者
    
    // 終了後は全員OK、プレイ中は特定の人のみOK
    const isAllowed = isFinished || isHost || isDead || isDev || isSpectator;

    if (!isAllowed) {
        throw new HttpsError('permission-denied', `権限がありません (status:${status})`);
    }

    // 全員の役職情報を取得して返す
    const playersData = [];
    // 複数ドキュメントの一括取得
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    const secretSnaps = await db.getAll(...secretRefs);
    
    pSnap.docs.forEach((d, i) => {
        const p = { id: d.id, ...d.data() };
        // 役職情報を付与
        if (secretSnaps[i].exists) {
            const sData = secretSnaps[i].data();
            p.role = sData.role;
            p.originalRole = sData.originalRole; // 変化前の役職もあれば
        }
        playersData.push(p);
    });
    
    return { players: playersData };
};

// ホスト権限移行ハンドラー
// ホストが抜ける前などに権限を他人に移す
exports.migrateHostHandler = async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const uid = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        const rSnap = await t.get(roomRef);
        if (!rSnap.exists) return;
        const room = rSnap.data();
        
        // 既に自分がホストなら何もしない
        if (room.hostId === uid) return;
        
        // 早い者勝ちでホスト権限を取得するロジック（UI側の実装に依存）
        // 現状はリクエストした人がホストになる単純な仕組み
        t.update(roomRef, { hostId: uid });
    });
    return { success: true };
};

// ロビーへのリセット（再戦）ハンドラー
// ゲーム終了後、同じメンバーで再ゲームを行うための初期化
exports.resetToLobbyHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  const batch = db.batch();
  
  // 各種コレクションのクリーンアップ（チャット、投票など）
  const chatSnap = await roomRef.collection('chat').get();
  const teamChatSnap = await roomRef.collection('teamChats').get();
  const graveChatSnap = await roomRef.collection('graveChat').get();
  const voteSnap = await roomRef.collection('votes').get();
  const playerSnap = await roomRef.collection('players').get();
  
  // 削除バッチへの追加
  chatSnap.docs.forEach(d => batch.delete(d.ref));
  teamChatSnap.docs.forEach(d => batch.delete(d.ref));
  graveChatSnap.docs.forEach(d => batch.delete(d.ref));
  voteSnap.docs.forEach(d => batch.delete(d.ref));
  
  // プレイヤー状態のリセット
  playerSnap.docs.forEach(d => {
      const updates = { 
          status: 'alive', 
          isReady: false, 
          // 観戦者は削除されるか、aliveに戻るか？ここでは削除フィールド指定
          isSpectator: admin.firestore.FieldValue.delete(), 
          deathReason: admin.firestore.FieldValue.delete(), 
          diedDay: admin.firestore.FieldValue.delete(), 
          lastTarget: admin.firestore.FieldValue.delete()
      };
      batch.update(d.ref, updates);
      // 個人の秘密情報（役職、アクション結果）も削除
      batch.delete(d.ref.collection('secret').doc('roleData'));
      batch.delete(d.ref.collection('secret').doc('actionResult'));
  });
  
  // 部屋情報の初期化
  batch.update(roomRef, {
      status: 'waiting', 
      phase: 'lobby', 
      day: 1, 
      logs: [], 
      // ゲーム結果関連のフィールド削除
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