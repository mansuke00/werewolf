// 投票・夜のアクション処理系のハンドラー

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();

const { ROLE_NAMES } = require('../constants');
const { getTeamMemberIds } = require('../utils');
const { checkNightCompletion, applyPhaseChange } = require('../core');

// 投票送信
exports.submitVoteHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode, targetId } = request.data;
  const uid = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  await db.runTransaction(async (t) => {
    const rSnap = await t.get(roomRef);
    if (!rSnap.exists) return;
    const room = rSnap.data();
    if (room.phase !== 'voting') return;
    const pSnap = await t.get(roomRef.collection('players'));
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });
    const aliveIds = players.filter(p => p.status === 'alive').map(p => p.id);
    const vSnap = await t.get(roomRef.collection('votes'));
    const votes = vSnap.docs.map(d => d.data());
    
    const voteRef = roomRef.collection('votes').doc(uid);
    t.set(voteRef, { target: targetId, voterId: uid });
    
    const otherVotes = votes.filter(v => v.voterId !== uid);
    otherVotes.push({ target: targetId, voterId: uid });
    const votedIds = new Set(otherVotes.map(v => v.voterId));
    const allVoted = aliveIds.every(id => votedIds.has(id));
    
    if (allVoted) {
        room.votes = otherVotes;
        await applyPhaseChange(t, roomRef, room, players);
    }
  });
  return { success: true };
};

// 夜のアクション実行（確定）
exports.submitNightActionHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode, targetId } = request.data;
  const actorId = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  await db.runTransaction(async (t) => {
    const sRef = roomRef.collection('players').doc(actorId).collection('secret').doc('roleData');
    const sSnap = await t.get(sRef);
    if (!sSnap.exists) return;
    const role = sSnap.data().role;
    
    const rSnap = await t.get(roomRef);
    const room = rSnap.data();

    if (role === 'assassin' && room.assassinUsed) {
        throw new HttpsError('failed-precondition', 'ももすけの能力は既に使用済みです');
    }

    let targetDoc = null, targetSecret = null;
    // 占い師・賢者・人狼チーム（賢狼）の場合は、ターゲットの情報が必要になる可能性がある
    if (['seer', 'sage', 'werewolf', 'greatwolf', 'wise_wolf'].includes(role) && targetId !== 'skip') {
        targetDoc = await t.get(roomRef.collection('players').doc(targetId));
        targetSecret = await t.get(roomRef.collection('players').doc(targetId).collection('secret').doc('roleData'));
    }

    const pSnap = await t.get(roomRef.collection('players'));
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });

    const actionData = { actorId, targetId, role, processed: false };
    t.update(roomRef, { [`nightActions.${actorId}`]: actionData });
    
    if (['knight', 'trapper'].includes(role)) {
        t.update(roomRef.collection('players').doc(actorId), { lastTarget: targetId });
    }

    const targetName = targetId === 'skip' ? "なし" : (players.find(p => p.id === targetId)?.name || "不明");
    let newLogs = [];
    const teamIds = getTeamMemberIds(players, role); 
    
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(role)) {
        // 狂人にも人狼のアクション結果を見せる
        const madmenIds = players.filter(p => p.role === 'madman').map(p => p.id);
        const visibleTo = [...new Set([...teamIds, ...madmenIds])];

        // 1. まず襲撃ログを追加
        newLogs.push({ text: `人狼チームは${targetName}を襲撃しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo });
        
        // 2. その後に賢狼の処理（ログ順序を守る）
        const wiseWolves = players.filter(p => p.role === 'wise_wolf' && p.status === 'alive');
        const isWiseWolfAlive = wiseWolves.length > 0;
        const wiseWolfExists = players.some(p => p.role === 'wise_wolf'); // ゲーム内に賢狼が存在するか
        
        // 狂人を除く人狼チーム（人狼、大狼、賢狼）のみ
        const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
        
        // 賢狼が最初からいない場合はカードを生成しない
        if (wiseWolfExists) {
            let resultCards = [];
            if (isWiseWolfAlive && targetId !== 'skip' && targetSecret.exists) {
                 const targetRoleKey = targetSecret.data().role;
                 const tgtRoleName = ROLE_NAMES[targetRoleKey] || "不明";
                 
                 // カードのラベル変更: [ターゲット名]の役職
                 resultCards.push({ label: `${targetName}の役職`, value: tgtRoleName, sub: targetName, isBad: false, icon: "Moon" });
                 
                 // ログにも追加 (賢狼の情報提供は人狼チームのみ、狂人には見せない)
                 const wolfVisibleTo = wolfTeamMembers.map(p => p.id);
                 newLogs.push({ text: `賢狼が生存しているため、人狼チームに「${targetName}の正確な役職は${tgtRoleName}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: wolfVisibleTo });
            } else {
                 // 賢狼死亡またはスキップ時は情報なし
                 // カードのラベル変更
                 resultCards.push({ label: `${targetName}の役職`, value: "情報なし", sub: `賢狼が死亡したため、${targetName}の役職は提供されません`, isBad: true, icon: "Moon" });
            }
            
            // 人狼チーム全員にアクション結果(カード)を配布
            wolfTeamMembers.forEach(w => {
                 t.set(roomRef.collection('players').doc(w.id).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
            });
        }

    } else if (role === 'knight') {
        newLogs.push({ text: `騎士チームは${targetName}を護衛しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
    } else if (role === 'trapper') {
        newLogs.push({ text: `罠師チームは${targetName}を護衛しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
    } else if (role === 'assassin') {
        if (targetId !== 'skip') {
            newLogs.push({ text: `ももすけチームは${targetName}を存在意義抹消対象にしました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
        } else {
            newLogs.push({ text: `ももすけチームは今夜は誰の存在意義も消しませんでした。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
        }
    }

    if (['seer', 'sage'].includes(role) && targetId !== 'skip' && targetDoc.exists && targetSecret.exists) {
        const tgtName = targetDoc.data().name;
        const tgtRoleKey = targetSecret.data().role;
        const resultCards = [];
        if (role === 'seer') {
            const isWolf = ['werewolf', 'greatwolf', 'wise_wolf'].includes(tgtRoleKey);
            const resText = isWolf ? "人狼" : "人狼ではない";
            const icon = isWolf ? "Moon" : "Sun";
            resultCards.push({ label: "占い結果", value: resText, sub: tgtName, isBad: isWolf, icon: icon });
            newLogs.push({ text: `占い師チームに、「${tgtName}は${resText}」との占い結果を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
        } else if (role === 'sage') {
            let dispRole = ROLE_NAMES[tgtRoleKey];
            if (targetSecret.data().originalRole === 'cursed') {
                dispRole = tgtRoleKey === 'werewolf' ? "呪われし者 - 人狼陣営" : "呪われし者 - 市民陣営";
            }
            resultCards.push({ label: "賢者結果", value: dispRole, sub: tgtName, isBad: false, icon: "Eye" });
            newLogs.push({ text: `賢者チームに、「${tgtName}の正確な役職は${dispRole}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
        }
        t.set(roomRef.collection('players').doc(actorId).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
    }

    if (newLogs.length > 0) t.update(roomRef, { logs: admin.firestore.FieldValue.arrayUnion(...newLogs) });

    let teamKey = role;
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(role)) teamKey = 'werewolf_team';
    t.update(roomRef, { [`pendingActions.${teamKey}`]: admin.firestore.FieldValue.delete() });

    if (!room.nightActions) room.nightActions = {};
    room.nightActions[actorId] = actionData;

    await checkNightCompletion(t, roomRef, room, players);
  });
  return { success: true };
};

// 夜のチームアクション（提案・投票）
exports.nightInteractionHandler = async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode, type, payload } = request.data; 
  const actorId = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  await db.runTransaction(async (t) => {
    const sRef = roomRef.collection('players').doc(actorId).collection('secret').doc('roleData');
    const sSnap = await t.get(sRef);
    if (!sSnap.exists) return;
    const myRole = sSnap.data().role;
    
    let teamKey = myRole;
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) teamKey = 'werewolf_team';
    
    const rSnap = await t.get(roomRef);
    const room = rSnap.data();
    const pendingKey = `pendingActions.${teamKey}`;
    
    const pSnap = await t.get(roomRef.collection('players'));
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });
    
    let teamMembers = [];
    if (teamKey === 'werewolf_team') {
        teamMembers = players.filter(p => p.status === 'alive' && ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
    } else {
        teamMembers = players.filter(p => p.status === 'alive' && p.role === myRole);
    }
    const requiredVotes = teamMembers.length;

    if (type === 'propose') {
      t.update(roomRef, {
        [pendingKey]: { targetId: payload.targetId, leaderId: actorId, approvals: [actorId], rejects: [] }
      });
    } 
    else if (type === 'vote') {
      if (payload.approve) {
        const pendingMap = room.pendingActions || {};
        const curr = pendingMap[teamKey];
        
        if (curr) {
          const newApprovals = [...new Set([...(curr.approvals || []), actorId])];
          
          if (newApprovals.length >= requiredVotes) {
              const targetId = curr.targetId;
              const leaderId = curr.leaderId; 
              const actionData = { actorId: leaderId, targetId, role: myRole, processed: false };
              t.update(roomRef, { [`nightActions.${leaderId}`]: actionData });
              
              const targetName = targetId === 'skip' ? "なし" : (players.find(p => p.id === targetId)?.name || "不明");
              const teamIds = getTeamMemberIds(players, myRole);
              
              // ログ配列を用意し、順番に追加してから一括保存する
              let newLogs = [];
              
              // 1. アクション実行ログ
              let actionMsg = "";
              if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
                  actionMsg = `人狼チームは${targetName}を襲撃しました。`;
              }
              else if (myRole === 'knight') actionMsg = `騎士チームは${targetName}を護衛しました。`;
              else if (myRole === 'trapper') actionMsg = `罠師チームは${targetName}を護衛しました。`;
              else if (myRole === 'assassin') {
                  if (targetId !== 'skip') actionMsg = `ももすけチームは${targetName}を存在意義抹消対象にしました。`;
                  else actionMsg = `ももすけチームは今夜は誰の存在意義も消しませんでした。`;
              }
              
              if (actionMsg) {
                  // 人狼チームの場合は狂人にも見せる
                  let visibleTo = teamIds;
                  if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
                      const madmenIds = players.filter(p => p.role === 'madman').map(p => p.id);
                      visibleTo = [...new Set([...teamIds, ...madmenIds])];
                  }
                  newLogs.push({ text: actionMsg, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo });
              }

              // 2. 賢狼の処理（アクションログの後に追加）
              if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
                  const wiseWolves = players.filter(p => p.role === 'wise_wolf' && p.status === 'alive');
                  const isWiseWolfAlive = wiseWolves.length > 0;
                  const wiseWolfExists = players.some(p => p.role === 'wise_wolf'); // ゲーム内に賢狼が存在するか
                  const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
                  
                  // 賢狼が最初からいない場合はカードを生成しない
                  if (wiseWolfExists) {
                      let resultCards = [];
                      const targetPlayer = players.find(p => p.id === targetId);
                      
                      if (isWiseWolfAlive && targetId !== 'skip' && targetPlayer) {
                           const tgtRoleName = ROLE_NAMES[targetPlayer.role] || "不明";
                           // カードのラベル変更
                           resultCards.push({ label: `${targetName}の役職`, value: tgtRoleName, sub: targetName, isBad: false, icon: "Moon" });
                           
                           // ログ追加（人狼チームのみ）
                           const visibleTo = wolfTeamMembers.map(p => p.id);
                           newLogs.push({ text: `賢狼が生存しているため、人狼チームに「${targetName}の正確な役職は${tgtRoleName}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo });
                      } else {
                           // カードのラベル変更
                           resultCards.push({ label: `${targetName}の役職`, value: "情報なし", sub: `賢狼が死亡したため、${targetName}の役職は提供されません`, isBad: true, icon: "Moon" });
                      }
                      
                      wolfTeamMembers.forEach(w => {
                           t.set(roomRef.collection('players').doc(w.id).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
                      });
                  }
              }

              // ログの一括保存
              if (newLogs.length > 0) {
                  t.update(roomRef, { logs: admin.firestore.FieldValue.arrayUnion(...newLogs) });
              }

              t.update(roomRef, { [pendingKey]: admin.firestore.FieldValue.delete() });
              if (!room.nightActions) room.nightActions = {};
              room.nightActions[leaderId] = actionData;
              await checkNightCompletion(t, roomRef, room, players);

          } else {
              t.update(roomRef, { [`pendingActions.${teamKey}.approvals`]: newApprovals });
          }
        }
      } else {
        t.update(roomRef, { [pendingKey]: admin.firestore.FieldValue.delete() });
      }
    }
  });
  return { success: true };
};