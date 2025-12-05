// ゲーム開始・進行管理系のハンドラー

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();

const { TIME_LIMITS } = require('../constants');
const { shuffle, generateMatchId } = require('../utils');
const { applyPhaseChange } = require('../core');

// ゲーム開始
exports.startGameHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) throw new HttpsError('not-found', '部屋なし');
  
  const playersSnap = await roomRef.collection('players').get();
  const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.isSpectator); 
  if (players.length < 4) throw new HttpsError('failed-precondition', '人数不足');
  
  const roleSettings = roomSnap.data().roleSettings || {};
  let roles = [];
  let wolfCount = 0, humanCount = 0;
  Object.entries(roleSettings).forEach(([r, c]) => { 
      for(let i=0; i<c; i++) { roles.push(r); if (['werewolf', 'greatwolf', 'wise_wolf'].includes(r)) wolfCount++; else humanCount++; } 
  });
  
  if (roles.length !== players.length) throw new HttpsError('invalid-argument', '人数不一致');
  if (wolfCount === 0) throw new HttpsError('failed-precondition', '人狼がいません');
  if (wolfCount >= humanCount) throw new HttpsError('failed-precondition', '人狼過半数');
  
  roles = shuffle(roles);
  const batch = db.batch();
  const assignments = players.map((p, i) => ({ id: p.id, role: roles[i], name: p.name }));
  
  assignments.forEach(p => {
    let mates = [];
    if(['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role)) { 
        // 人狼チーム：狂人は含めない
        mates = assignments.filter(a => ['werewolf', 'greatwolf', 'wise_wolf'].includes(a.role) && a.id !== p.id); 
    } 
    else if(p.role === 'madman') { 
        // 狂人：人狼チームと他の狂人がわかる
        mates = assignments.filter(a => ['werewolf', 'greatwolf', 'wise_wolf', 'madman'].includes(a.role) && a.id !== p.id); 
    } 
    else if(p.role === 'assassin') { mates = assignments.filter(a => a.role === 'assassin' && a.id !== p.id); }
    else if(p.role === 'teruteru') { mates = assignments.filter(a => a.role === 'teruteru' && a.id !== p.id); }
    else if(['seer', 'medium', 'knight', 'trapper', 'sage', 'detective', 'killer', 'fox'].includes(p.role)) { mates = assignments.filter(a => a.role === p.role && a.id !== p.id); }
    
    const secretRef = roomRef.collection('players').doc(p.id).collection('secret').doc('roleData');
    batch.set(secretRef, { role: p.role, teammates: mates, originalRole: p.role, elderShield: p.role === 'elder' });
    batch.update(roomRef.collection('players').doc(p.id), { isReady: false, status: 'alive', deathReason: admin.firestore.FieldValue.delete(), diedDay: admin.firestore.FieldValue.delete() });
  });

  const matchId = generateMatchId();

  batch.update(roomRef, {
    status: 'playing', phase: 'countdown', phaseStartTime: admin.firestore.Timestamp.now(), day: 1, 
    matchId: matchId, 
    logs: [{ text: "ゲームが開始されました。", phase: "System", day: 1 }], 
    nightActions: {}, nightLeaders: {}, pendingActions: {}, awakeningEvents: [], 
    winner: admin.firestore.FieldValue.delete(), nightAllDoneTime: admin.firestore.FieldValue.delete(), 
    executionResult: admin.firestore.FieldValue.delete(), deathResult: admin.firestore.FieldValue.delete(), voteSummary: admin.firestore.FieldValue.delete(),
    assassinUsed: false,
    teruteruWon: admin.firestore.FieldValue.delete() 
  });
  
  await batch.commit();
  return { success: true };
};

// フェーズ進行（タイマー終了など）
exports.advancePhaseHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  await db.runTransaction(async (t) => {
     const rSnap = await t.get(roomRef);
     if (!rSnap.exists) return;
     const room = rSnap.data();
     const now = Date.now();
     
     const startTime = room.phaseStartTime && typeof room.phaseStartTime.toMillis === 'function' ? room.phaseStartTime.toMillis() : 0;
     const elapsed = (now - startTime) / 1000;
     let duration = 9999;
     
     if (room.phase.startsWith('day')) duration = room.discussionTime || TIME_LIMITS.DISCUSSION;
     else if (room.phase === 'voting') duration = TIME_LIMITS.VOTING;
     else if (room.phase.startsWith('announcement')) duration = TIME_LIMITS.ANNOUNCEMENT;
     else if (room.phase === 'countdown') duration = TIME_LIMITS.COUNTDOWN;
     else if (room.phase === 'role_reveal') duration = TIME_LIMITS.ROLE_REVEAL;
     else if (room.phase.startsWith('night')) duration = TIME_LIMITS.NIGHT;
     
     const isTimeUp = elapsed >= duration - 2; 
     const isNightForce = room.phase.startsWith('night') && isTimeUp;
     const isNightAllDone = room.nightAllDoneTime && typeof room.nightAllDoneTime.toMillis === 'function' && now >= room.nightAllDoneTime.toMillis();

     if (!isTimeUp && !isNightForce && !isNightAllDone) return;
     
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
     if (room.phase === 'voting') {
         const vSnap = await t.get(roomRef.collection('votes'));
         room.votes = vSnap.docs.map(d => d.data());
     }
     if (isNightForce || isNightAllDone) { t.update(roomRef, { forceNightEnd: true }); }
     await applyPhaseChange(t, roomRef, room, players);
  });
  return { success: true };
};

// 準備完了切り替え
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
      const shouldCheckAdvance = isReady && room.phase.startsWith('day');
      if (!shouldCheckAdvance) { t.update(playerRef, { isReady: isReady }); return; }
      
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
      const me = players.find(p => p.id === uid); if (me) me.isReady = true;
      const alive = players.filter(p => p.status === 'alive');
      const allReady = alive.every(p => p.isReady);
      if (allReady) { await applyPhaseChange(t, roomRef, room, players); } else { t.update(playerRef, { isReady: isReady }); }
  });
  return { success: true };
};