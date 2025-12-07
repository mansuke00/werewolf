const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const db = admin.firestore();

const { ROLE_NAMES } = require('../constants');
const { getTeamMemberIds } = require('../utils');
const { checkNightCompletion, applyPhaseChange } = require('../core');

// 投票実行ハンドラー
exports.submitVoteHandler = async (request) => {
  // 認証チェック
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  
  const { roomCode, targetId } = request.data;
  const uid = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  await db.runTransaction(async (t) => {
    // 部屋存在確認
    const rSnap = await t.get(roomRef);
    if (!rSnap.exists) return;
    
    const room = rSnap.data();
    // フェーズ確認：投票中のみ受付
    if (room.phase !== 'voting') return;
    
    // プレイヤー情報と役職データ取得
    const pSnap = await t.get(roomRef.collection('players'));
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    
    // プレイヤーデータ結合
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });
    
    // 生存者IDリスト作成
    const aliveIds = players.filter(p => p.status === 'alive').map(p => p.id);
    
    // 既存投票データ取得
    const vSnap = await t.get(roomRef.collection('votes'));
    const votes = vSnap.docs.map(d => d.data());
    
    // 自分の投票を書き込み（上書き可）
    const voteRef = roomRef.collection('votes').doc(uid);
    t.set(voteRef, { target: targetId, voterId: uid });
    
    // 他プレイヤーの投票と自分の最新投票をマージ
    const otherVotes = votes.filter(v => v.voterId !== uid);
    otherVotes.push({ target: targetId, voterId: uid });
    
    // 全生存者が投票済みかチェック
    const votedIds = new Set(otherVotes.map(v => v.voterId));
    const allVoted = aliveIds.every(id => votedIds.has(id));
    
    // 全員投票完了時、フェーズ移行処理実行
    if (allVoted) {
        room.votes = otherVotes;
        await applyPhaseChange(t, roomRef, room, players);
    }
  });
  return { success: true };
};

// 夜アクション実行ハンドラー（単独実行・確定処理）
exports.submitNightActionHandler = async (request) => {
  // 認証チェック
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  
  const { roomCode, targetId } = request.data;
  const actorId = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  await db.runTransaction(async (t) => {
    // 実行者の役職取得
    const sRef = roomRef.collection('players').doc(actorId).collection('secret').doc('roleData');
    const sSnap = await t.get(sRef);
    if (!sSnap.exists) return;
    const role = sSnap.data().role;
    
    const rSnap = await t.get(roomRef);
    const room = rSnap.data();

    // ももすけの能力使用済みチェック
    if (role === 'assassin' && room.assassinUsed) {
        throw new HttpsError('failed-precondition', 'ももすけの能力は既に使用済みです');
    }

    let targetDoc = null, targetSecret = null;
    // ターゲット詳細が必要な役職の場合、ターゲット情報取得（スキップ以外）
    if (['seer', 'sage', 'werewolf', 'greatwolf', 'wise_wolf'].includes(role) && targetId !== 'skip') {
        targetDoc = await t.get(roomRef.collection('players').doc(targetId));
        targetSecret = await t.get(roomRef.collection('players').doc(targetId).collection('secret').doc('roleData'));
    }

    // 全プレイヤー情報再取得（最新状態）
    const pSnap = await t.get(roomRef.collection('players'));
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });

    // アクションデータ作成・更新
    const actionData = { actorId, targetId, role, processed: false };
    t.update(roomRef, { [`nightActions.${actorId}`]: actionData });
    
    // 騎士・罠師の前回ターゲット更新（連続護衛制限用）
    if (['knight', 'trapper'].includes(role)) {
        t.update(roomRef.collection('players').doc(actorId), { lastTarget: targetId });
    }

    // ターゲット名解決
    const targetName = targetId === 'skip' ? "なし" : (players.find(p => p.id === targetId)?.name || "不明");
    let newLogs = [];
    // チームメンバーID取得（ログ公開範囲用）
    const teamIds = getTeamMemberIds(players, role); 
    
    // 人狼チームのアクション処理
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(role)) {
        // 狂人にもログを見せるためのIDリスト作成
        const madmenIds = players.filter(p => p.role === 'madman').map(p => p.id);
        const visibleTo = [...new Set([...teamIds, ...madmenIds])];

        // 襲撃ログ追加
        newLogs.push({ text: `人狼チームは${targetName}を襲撃しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo });
        
        // 賢狼ロジック
        const wiseWolves = players.filter(p => p.role === 'wise_wolf' && p.status === 'alive');
        const isWiseWolfAlive = wiseWolves.length > 0;
        const wiseWolfExists = players.some(p => p.role === 'wise_wolf'); // ゲーム内の賢狼存在有無
        
        const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
        
        // 賢狼が存在する場合のみカード生成処理
        if (wiseWolfExists) {
            let resultCards = [];
            if (isWiseWolfAlive && targetId !== 'skip' && targetSecret.exists) {
                 // ターゲット役職特定
                 const targetRoleKey = targetSecret.data().role;
                 const tgtRoleName = ROLE_NAMES[targetRoleKey] || "不明";
                 
                 // 結果カード：役職判明
                 resultCards.push({ label: `${targetName}の役職`, value: tgtRoleName, sub: targetName, isBad: false, icon: "Moon" });
                 
                 // ログ追加：人狼チームのみ（狂人不可）
                 const wolfVisibleTo = wolfTeamMembers.map(p => p.id);
                 newLogs.push({ text: `賢狼が生存しているため、人狼チームに「${targetName}の正確な役職は${tgtRoleName}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: wolfVisibleTo });
            } 
            // 賢狼死亡時は結果カードを生成しない（「情報なし」も表示しない）
            
            // 人狼チーム各個人のシークレットに結果カード配布
            // resultCardsが空の場合は空配列で上書き（前回結果のクリア）
            wolfTeamMembers.forEach(w => {
                 t.set(roomRef.collection('players').doc(w.id).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
            });
        }

    // 騎士アクション処理
    } else if (role === 'knight') {
        newLogs.push({ text: `騎士チームは${targetName}を護衛しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
    // 罠師アクション処理
    } else if (role === 'trapper') {
        newLogs.push({ text: `罠師チームは${targetName}を護衛しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
    // ももすけアクション処理
    } else if (role === 'assassin') {
        if (targetId !== 'skip') {
            newLogs.push({ text: `ももすけチームは${targetName}を存在意義抹消対象にしました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
        } else {
            newLogs.push({ text: `ももすけチームは今夜は誰の存在意義も消しませんでした。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
        }
    }

    // 占い師・賢者のアクション処理（結果カード生成）
    if (['seer', 'sage'].includes(role) && targetId !== 'skip' && targetDoc.exists && targetSecret.exists) {
        const tgtName = targetDoc.data().name;
        const tgtRoleKey = targetSecret.data().role;
        const resultCards = [];
        
        // 占い師ロジック
        if (role === 'seer') {
            const isWolf = ['werewolf', 'greatwolf', 'wise_wolf'].includes(tgtRoleKey);
            const resText = isWolf ? "人狼" : "人狼ではない";
            const icon = isWolf ? "Moon" : "Sun";
            resultCards.push({ label: "占い結果", value: resText, sub: tgtName, isBad: isWolf, icon: icon });
            newLogs.push({ text: `占い師チームに、「${tgtName}は${resText}」との占い結果を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
        // 賢者ロジック
        } else if (role === 'sage') {
            let dispRole = ROLE_NAMES[tgtRoleKey];
            // 呪われし者の表示調整
            if (targetSecret.data().originalRole === 'cursed') {
                dispRole = tgtRoleKey === 'werewolf' ? "呪われし者 - 人狼陣営" : "呪われし者 - 市民陣営";
            }
            resultCards.push({ label: "賢者結果", value: dispRole, sub: tgtName, isBad: false, icon: "Eye" });
            newLogs.push({ text: `賢者チームに、「${tgtName}の正確な役職は${dispRole}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
        }
        // 結果カード保存
        t.set(roomRef.collection('players').doc(actorId).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
    }

    // ログ保存
    if (newLogs.length > 0) t.update(roomRef, { logs: admin.firestore.FieldValue.arrayUnion(...newLogs) });

    // チームの保留中アクション削除
    let teamKey = role;
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(role)) teamKey = 'werewolf_team';
    t.update(roomRef, { [`pendingActions.${teamKey}`]: admin.firestore.FieldValue.delete() });

    // アクション完了記録
    if (!room.nightActions) room.nightActions = {};
    room.nightActions[actorId] = actionData;

    // 全員完了判定・翌朝への移行チェック
    await checkNightCompletion(t, roomRef, room, players);
  });
  return { success: true };
};

// 夜チームアクションハンドラー（提案・投票）
exports.nightInteractionHandler = async (request) => {
  // 認証チェック
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  
  const { roomCode, type, payload } = request.data; 
  const actorId = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  await db.runTransaction(async (t) => {
    // 実行者の役職取得
    const sRef = roomRef.collection('players').doc(actorId).collection('secret').doc('roleData');
    const sSnap = await t.get(sRef);
    if (!sSnap.exists) return;
    const myRole = sSnap.data().role;
    
    // チームキー決定（人狼系は同一チーム）
    let teamKey = myRole;
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) teamKey = 'werewolf_team';
    
    const rSnap = await t.get(roomRef);
    const room = rSnap.data();
    const pendingKey = `pendingActions.${teamKey}`;
    
    // 全プレイヤー情報取得
    const pSnap = await t.get(roomRef.collection('players'));
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });
    
    // チームメンバー抽出（生存者のみ）
    let teamMembers = [];
    if (teamKey === 'werewolf_team') {
        teamMembers = players.filter(p => p.status === 'alive' && ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
    } else {
        teamMembers = players.filter(p => p.status === 'alive' && p.role === myRole);
    }
    const requiredVotes = teamMembers.length;

    // 提案アクション処理
    if (type === 'propose') {
      t.update(roomRef, {
        [pendingKey]: { targetId: payload.targetId, leaderId: actorId, approvals: [actorId], rejects: [] }
      });
    } 
    // 投票アクション処理
    else if (type === 'vote') {
      if (payload.approve) {
        // 承認時の処理
        const pendingMap = room.pendingActions || {};
        const curr = pendingMap[teamKey];
        
        if (curr) {
          // 承認者リスト更新
          const newApprovals = [...new Set([...(curr.approvals || []), actorId])];
          
          // 全員承認完了判定
          if (newApprovals.length >= requiredVotes) {
              // アクション確定処理開始
              const targetId = curr.targetId;
              const leaderId = curr.leaderId; 
              const actionData = { actorId: leaderId, targetId, role: myRole, processed: false };
              
              // 確定アクション保存
              t.update(roomRef, { [`nightActions.${leaderId}`]: actionData });
              
              const targetName = targetId === 'skip' ? "なし" : (players.find(p => p.id === targetId)?.name || "不明");
              const teamIds = getTeamMemberIds(players, myRole);
              
              let newLogs = [];
              
              // 1. アクション実行ログ生成
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
                  // 可視範囲設定（人狼は狂人も含む）
                  let visibleTo = teamIds;
                  if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
                      const madmenIds = players.filter(p => p.role === 'madman').map(p => p.id);
                      visibleTo = [...new Set([...teamIds, ...madmenIds])];
                  }
                  newLogs.push({ text: actionMsg, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo });
              }

              // 2. 賢狼処理（ログ順序考慮：襲撃ログの後）
              if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
                  const wiseWolves = players.filter(p => p.role === 'wise_wolf' && p.status === 'alive');
                  const isWiseWolfAlive = wiseWolves.length > 0;
                  const wiseWolfExists = players.some(p => p.role === 'wise_wolf'); // ゲーム内存在有無
                  const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
                  
                  // 賢狼存在時のみカード生成
                  if (wiseWolfExists) {
                      let resultCards = [];
                      const targetPlayer = players.find(p => p.id === targetId);
                      
                      if (isWiseWolfAlive && targetId !== 'skip' && targetPlayer) {
                           const tgtRoleName = ROLE_NAMES[targetPlayer.role] || "不明";
                           // 結果カード：役職判明
                           resultCards.push({ label: `${targetName}の役職`, value: tgtRoleName, sub: targetName, isBad: false, icon: "Moon" });
                           
                           // ログ追加（人狼チームのみ）
                           const visibleTo = wolfTeamMembers.map(p => p.id);
                           newLogs.push({ text: `賢狼が生存しているため、人狼チームに「${targetName}の正確な役職は${tgtRoleName}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo });
                      } 
                      // 賢狼死亡時は結果カードを生成しない
                      
                      // カード配布
                      wolfTeamMembers.forEach(w => {
                           t.set(roomRef.collection('players').doc(w.id).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
                      });
                  }
              }

              // ログ一括保存
              if (newLogs.length > 0) {
                  t.update(roomRef, { logs: admin.firestore.FieldValue.arrayUnion(...newLogs) });
              }

              // 保留アクション削除と完了フラグセット
              t.update(roomRef, { [pendingKey]: admin.firestore.FieldValue.delete() });
              if (!room.nightActions) room.nightActions = {};
              room.nightActions[leaderId] = actionData;
              
              // 翌朝移行チェック
              await checkNightCompletion(t, roomRef, room, players);

          } else {
              // 承認数不足のため、承認者リスト更新のみ
              t.update(roomRef, { [`pendingActions.${teamKey}.approvals`]: newApprovals });
          }
        }
      } else {
        // 否認時の処理：提案取り下げ（保留アクション削除）
        t.update(roomRef, { [pendingKey]: admin.firestore.FieldValue.delete() });
      }
    }
  });
  return { success: true };
};