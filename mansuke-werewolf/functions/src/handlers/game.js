// ゲーム開始・進行管理系のハンドラー

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();

const { TIME_LIMITS } = require('../constants');
const { shuffle, generateMatchId } = require('../utils');
const { applyPhaseChange } = require('../core');

// ゲーム開始処理
// 部屋の作成者が開始ボタンを押したときに呼ばれる想定
exports.startGameHandler = async (request) => {
  // 認証確認。未ログインは弾く
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  
  const { roomCode } = request.data;
  // Firestoreのパス参照
  // 公開データ直下のroomsコレクション
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  const roomSnap = await roomRef.get();
  
  // 部屋存在チェック
  if (!roomSnap.exists) throw new HttpsError('not-found', '部屋なし');
  
  // プレイヤー一覧取得
  // 観戦者(isSpectator)は除外して、参加者のみ抽出
  const playersSnap = await roomRef.collection('players').get();
  const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.isSpectator); 
  
  // 最低人数チェック。4人未満は不可
  if (players.length < 4) throw new HttpsError('failed-precondition', '人数不足');
  
  // 役職設定取得。未設定なら空オブジェクト
  const roleSettings = roomSnap.data().roleSettings || {};
  let roles = [];
  let wolfCount = 0, humanCount = 0;
  
  // 設定に基づき役職配列を展開
  // 例: { werewolf: 2, villager: 3 } -> ['werewolf', 'werewolf', 'villager', '...', 'villager']
  Object.entries(roleSettings).forEach(([r, c]) => { 
      for(let i=0; i<c; i++) { 
          roles.push(r); 
          // 人狼陣営の数をカウント
          // 賢狼(wise_wolf)も人狼カウントに含める。これ重要
          if (['werewolf', 'greatwolf', 'wise_wolf'].includes(r)) wolfCount++; 
          else humanCount++; 
      } 
  });
  
  // 参加人数と役職総数の不整合チェック
  if (roles.length !== players.length) throw new HttpsError('invalid-argument', '人数不一致');
  
  // ゲームバランスチェック
  // 人狼0人は不可（賢狼のみでもwolfCount増えるのでOK）
  if (wolfCount === 0) throw new HttpsError('failed-precondition', '人狼がいません');
  // 人狼が過半数以上は即ゲーム終了条件なので開始不可
  if (wolfCount >= humanCount) throw new HttpsError('failed-precondition', '人狼過半数');
  
  // 役職シャッフル
  roles = shuffle(roles);
  
  // バッチ書き込み準備
  const batch = db.batch();
  // プレイヤーIDと役職、名前を紐付け
  const assignments = players.map((p, i) => ({ id: p.id, role: roles[i], name: p.name }));
  
  // 各プレイヤーの秘密情報生成
  assignments.forEach(p => {
    let mates = [];
    // 人狼陣営（人狼、大狼、賢狼）の場合
    if(['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role)) { 
        // 味方の人狼たちを知る。狂人は含まない
        mates = assignments.filter(a => ['werewolf', 'greatwolf', 'wise_wolf'].includes(a.role) && a.id !== p.id); 
    } 
    // 狂人の場合
    else if(p.role === 'madman') { 
        // 人狼たちが誰か知る。他の狂人も知る仕様
        mates = assignments.filter(a => ['werewolf', 'greatwolf', 'wise_wolf', 'madman'].includes(a.role) && a.id !== p.id); 
    } 
    // ももすけ（暗殺者）同士
    else if(p.role === 'assassin') { mates = assignments.filter(a => a.role === 'assassin' && a.id !== p.id); }
    // てるてる同士
    else if(p.role === 'teruteru') { mates = assignments.filter(a => a.role === 'teruteru' && a.id !== p.id); }
    // その他の役職（共有者など）
    else if(['seer', 'medium', 'knight', 'trapper', 'sage', 'detective', 'killer', 'fox'].includes(p.role)) { mates = assignments.filter(a => a.role === p.role && a.id !== p.id); }
    
    // secretサブコレクションに役職情報を保存
    // 他のプレイヤーからは見えない場所
    const secretRef = roomRef.collection('players').doc(p.id).collection('secret').doc('roleData');
    // originalRoleは呪われし者などの変化元保持用
    // elderShieldは長老のライフ用
    batch.set(secretRef, { role: p.role, teammates: mates, originalRole: p.role, elderShield: p.role === 'elder' });
    
    // プレイヤー公開情報の初期化
    // 準備完了フラグOFF、生存ステータス、死因クリア
    batch.update(roomRef.collection('players').doc(p.id), { isReady: false, status: 'alive', deathReason: admin.firestore.FieldValue.delete(), diedDay: admin.firestore.FieldValue.delete() });
  });

  // マッチID生成（ログ分析用など）
  const matchId = generateMatchId();

  // 部屋情報の更新：ゲーム開始状態へ
  batch.update(roomRef, {
    status: 'playing', 
    phase: 'countdown', // 最初はカウントダウンから
    phaseStartTime: admin.firestore.Timestamp.now(), 
    day: 1, 
    matchId: matchId, 
    logs: [{ text: "ゲームが開始されました。", phase: "System", day: 1 }], 
    // 夜アクション系データ初期化
    nightActions: {}, nightLeaders: {}, pendingActions: {}, awakeningEvents: [], 
    // 終了判定系データクリア
    winner: admin.firestore.FieldValue.delete(), 
    nightAllDoneTime: admin.firestore.FieldValue.delete(), 
    executionResult: admin.firestore.FieldValue.delete(), 
    deathResult: admin.firestore.FieldValue.delete(), 
    voteSummary: admin.firestore.FieldValue.delete(),
    assassinUsed: false,
    teruteruWon: admin.firestore.FieldValue.delete() 
  });
  
  // 一括コミット
  await batch.commit();
  return { success: true };
};

// フェーズ進行監視ハンドラー
// クライアントからの定期ポーリングやタイマートリガーで呼ばれる想定
exports.advancePhaseHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  await db.runTransaction(async (t) => {
     const rSnap = await t.get(roomRef);
     if (!rSnap.exists) return;
     const room = rSnap.data();
     const now = Date.now();
     
     // 開始時刻取得。なければ0
     const startTime = room.phaseStartTime && typeof room.phaseStartTime.toMillis === 'function' ? room.phaseStartTime.toMillis() : 0;
     const elapsed = (now - startTime) / 1000; // 経過秒数
     let duration = 9999;
     
     // 現在のフェーズに応じて制限時間を決定
     if (room.phase.startsWith('day')) duration = room.discussionTime || TIME_LIMITS.DISCUSSION; // 昼の議論
     else if (room.phase === 'voting') duration = TIME_LIMITS.VOTING; // 投票
     else if (room.phase.startsWith('announcement')) duration = TIME_LIMITS.ANNOUNCEMENT; // 結果発表など
     else if (room.phase === 'countdown') duration = TIME_LIMITS.COUNTDOWN; // 開始前カウントダウン
     else if (room.phase === 'role_reveal') duration = TIME_LIMITS.ROLE_REVEAL; // 役職確認
     else if (room.phase.startsWith('night')) duration = TIME_LIMITS.NIGHT; // 夜
     
     // タイムアップ判定（バッファ2秒考慮？）
     const isTimeUp = elapsed >= duration - 2; 
     // 夜の強制終了判定
     const isNightForce = room.phase.startsWith('night') && isTimeUp;
     // 夜の全員行動完了による早期終了判定
     const isNightAllDone = room.nightAllDoneTime && typeof room.nightAllDoneTime.toMillis === 'function' && now >= room.nightAllDoneTime.toMillis();

     // 時間内かつ、夜の早期終了でもなければ何もしない
     if (!isTimeUp && !isNightForce && !isNightAllDone) return;
     
     // フェーズ遷移処理へ
     
     // プレイヤー情報取得
     const pSnap = await t.get(roomRef.collection('players'));
     const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
     const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
     const players = pSnap.docs.map((d, i) => {
          const pData = { id: d.id, ...d.data() };
          if (secretSnaps[i].exists) {
              const sData = secretSnaps[i].data();
              pData.role = sData.role; // 役職情報付与
              pData.elderShield = sData.elderShield;
          }
          return pData;
     });
     
     // 投票フェーズなら投票結果も取得しておく
     if (room.phase === 'voting') {
         const vSnap = await t.get(roomRef.collection('votes'));
         room.votes = vSnap.docs.map(d => d.data());
     }
     
     // 夜終了フラグセット
     if (isNightForce || isNightAllDone) { t.update(roomRef, { forceNightEnd: true }); }
     
     // 実際のフェーズ変更処理を実行（coreモジュール）
     await applyPhaseChange(t, roomRef, room, players);
  });
  return { success: true };
};

// 準備完了トグルハンドラー
// 議論開始前の確認などで使用
exports.toggleReadyHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode, isReady } = request.data;
  const uid = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  const playerRef = roomRef.collection('players').doc(uid);
  
  await db.runTransaction(async (t) => {
      const rSnap = await t.get(roomRef);
      if (!rSnap.exists) throw new HttpsError('not-found', 'Room not found');
      const room = rSnap.data();
      
      // 昼フェーズでの時短用準備完了チェックを行うか
      const shouldCheckAdvance = isReady && room.phase.startsWith('day');
      
      // 単なるステータス更新の場合
      if (!shouldCheckAdvance) { t.update(playerRef, { isReady: isReady }); return; }
      
      // 全員準備完了ならフェーズを進める処理
      const pSnap = await t.get(roomRef.collection('players'));
      const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
      const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
      
      const players = pSnap.docs.map((d, i) => {
          const pData = { id: d.id, ...d.data() }; 
          if (secretSnaps[i].exists) {
              const sData = secretSnaps[i].data();
              pData.role = sData.role;
              pData.elderShield = sData.elderShield;
          }
          return pData;
      });
      
      // 自分のステータスをメモリ上で更新
      const me = players.find(p => p.id === uid); if (me) me.isReady = true;
      
      // 生存者全員がReadyかチェック
      const alive = players.filter(p => p.status === 'alive');
      const allReady = alive.every(p => p.isReady);
      
      // 全員Readyならフェーズ進行
      if (allReady) { await applyPhaseChange(t, roomRef, room, players); } 
      // まだなら自分のステータスだけDB更新
      else { t.update(playerRef, { isReady: isReady }); }
  });
  return { success: true };
};