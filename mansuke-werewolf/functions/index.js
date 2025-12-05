// Firebase Functions (v2) と Admin SDK の読み込み
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

const { setGlobalOptions } = require("firebase-functions/v2");
setGlobalOptions({ region: "asia-northeast2", maxInstances: 10 });

const TIME_LIMITS = {
  DISCUSSION: 240,
  VOTING: 20,
  NIGHT: 86400,
  ANNOUNCEMENT: 10,
  COUNTDOWN: 5,
  ROLE_REVEAL: 3,
};

const ROLE_NAMES = {
  citizen: "市民", seer: "占い師", medium: "霊媒師", knight: "騎士",
  trapper: "罠師", sage: "賢者", killer: "人狼キラー", detective: "名探偵",
  cursed: "呪われし者", elder: "長老", assassin: "ももすけ",
  werewolf: "人狼", greatwolf: "大狼", wise_wolf: "賢狼", madman: "狂人", 
  fox: "妖狐", teruteru: "てるてる坊主"
};

// --- ユーティリティ ---
const shuffle = (arr) => {
  const n = [...arr];
  for (let i = n.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [n[i], n[j]] = [n[j], n[i]];
  }
  return n;
};

const generateMatchId = () => {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const checkWin = (players, deadIds) => {
  if (!players) return null;
  const live = players.filter(p => p && !deadIds.includes(p.id) && p.status !== 'vanished');
  const validPlayers = live.filter(p => p.role);
  
  const wolves = validPlayers.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role)).length;
  const humans = validPlayers.filter(p => !['werewolf', 'greatwolf', 'wise_wolf', 'fox', 'teruteru'].includes(p.role)).length; // 妖狐・てるてるはカウント外
  const fox = validPlayers.some(p => p.role === 'fox');

  // 妖狐が生存していれば、人狼全滅などの条件に関わらず妖狐勝利
  if (fox) return 'fox';
  
  if (wolves === 0) return 'citizen';
  if (wolves >= humans) return 'werewolf';
  return null;
};

const electLeaders = (players) => {
  const leaders = {};
  const groups = {};
  const alivePlayers = players.filter(p => p.status === 'alive');

  alivePlayers.forEach(p => {
    const role = p.role;
    if (!role) return;
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(role)) {
      if (!groups['werewolf_team']) groups['werewolf_team'] = [];
      groups['werewolf_team'].push(p.id);
    } else if (role === 'assassin') {
        if (!groups['assassin']) groups['assassin'] = [];
        groups['assassin'].push(p.id);
    } else if (role === 'teruteru') {
        if (!groups['teruteru']) groups['teruteru'] = [];
        groups['teruteru'].push(p.id);
    } else if (['seer', 'sage', 'knight', 'trapper'].includes(role)) {
      if (!groups[role]) groups[role] = [];
      groups[role].push(p.id);
    }
  });

  Object.entries(groups).forEach(([key, ids]) => {
    if (ids.length > 0) {
      leaders[key] = ids[Math.floor(Math.random() * ids.length)];
    }
  });
  return leaders;
};

const getTeamMemberIds = (players, role) => {
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(role)) {
        return players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf', 'madman'].includes(p.role)).map(p => p.id);
    }
    // ももすけ（暗殺者）、てるてる坊主などは同じ役職同士でチャット可能
    if (['assassin', 'teruteru'].includes(role)) {
        return players.filter(p => p.role === role).map(p => p.id);
    }
    return players.filter(p => p.role === role).map(p => p.id);
};

// --- コアロジック ---
const applyPhaseChange = async (t, roomRef, room, players) => {
    let next = "", logs = [], updates = {}, batchOps = [];

    if (room.phase === 'countdown') {
        next = 'role_reveal';
    } else if (room.phase === 'role_reveal') {
      next = 'day_1';
      logs.push({ text: "1日目の朝になりました。", phase: "1日目 - 昼", day: 1 });
      updates.day = 1;
      updates.nightActions = {};
      updates.pendingActions = {};
      updates.nightLeaders = {};
    } else if (room.phase === 'day_1') {
      next = 'night_1';
      logs.push({ text: "1日目は投票がありません。日が暮れました。", phase: "1日目 - 終了", day: 1 });
      const leaders = electLeaders(players);
      updates.nightLeaders = leaders;
      players.forEach(p => batchOps.push({ ref: roomRef.collection('players').doc(p.id), data: { isReady: false } }));
      ['detective', 'medium'].forEach(r => {
          const targets = players.filter(p => p.role === r && p.status === 'alive');
          targets.forEach(p => {
              batchOps.push({ 
                  ref: roomRef.collection('players').doc(p.id).collection('secret').doc('actionResult'), 
                  data: { day: 1, cards: [{ label: r==='detective'?"調査":"霊媒", value: "今夜提供できる情報はありません", sub: "", isBad: false, icon: "Info" }] },
                  merge: true 
              });
          });
      });
    } else if (room.phase.startsWith('day')) {
      next = 'voting';
      // 投票データのクリア
      const voteDocs = await t.get(roomRef.collection('votes'));
      voteDocs.docs.forEach(d => t.delete(d.ref));
      updates.votes = []; 
      players.forEach(p => batchOps.push({ ref: roomRef.collection('players').doc(p.id), data: { isReady: false } }));
      updates.awakeningEvents = admin.firestore.FieldValue.delete();
    } else if (room.phase === 'voting') {
      const votes = room.votes || [];
      const summaryMap = {};
      const voteResultLines = [];
      const voteDetailLines = [];
      const anonymous = room.anonymousVoting;

      // 生存者IDリストを作成し、死者の票を除外する
      const aliveVoterIds = players.filter(p => p.status === 'alive').map(p => p.id);

      votes.forEach(v => {
          // 生存していないプレイヤーの票はカウントしない
          if (!aliveVoterIds.includes(v.voterId)) return;

          if (!summaryMap[v.target]) summaryMap[v.target] = { targetId: v.target, count: 0, voters: [] };
          summaryMap[v.target].count++;
          summaryMap[v.target].voters.push(v.voterId);
      });
      
      const voteSummary = Object.values(summaryMap).sort((a, b) => b.count - a.count);
      updates.voteSummary = voteSummary;

      voteSummary.forEach(item => {
          const tName = item.targetId === 'skip' ? "スキップ" : (players.find(p => p.id === item.targetId)?.name || "不明");
          voteResultLines.push(`${tName}に${item.count}票`);
          if (!anonymous && item.voters) {
              item.voters.forEach(vid => {
                  const vName = players.find(p => p.id === vid)?.name || "不明";
                  voteDetailLines.push(`${vName}は${tName}に投票`);
              });
          }
      });

      if (voteDetailLines.length > 0) logs.push({ text: `＜各プレイヤーの投票先＞\n${voteDetailLines.join('\n')}`, phase: `${room.day}日目 - 投票`, day: room.day });
      logs.push({ text: `＜開票結果＞\n${voteResultLines.join('\n')}`, phase: `${room.day}日目 - 投票`, day: room.day });

      // 集計ロジック（フィルタリング済みvotesを使用）
      const validVotes = votes.filter(v => aliveVoterIds.includes(v.voterId));
      const counts = {};
      validVotes.forEach(v => counts[v.target] = (counts[v.target] || 0) + 1);
      
      let max = 0, execId = null;
      Object.entries(counts).forEach(([id, c]) => { if (c > max) { max = c; execId = id; } else if (c === max) execId = null; });

      let execResult = "同数投票、またはスキップ多数のため、処刑は行いません。";
      let hasExecuted = false;
      const executedPlayers = []; 

      if (execId && execId !== 'skip') {
        const victim = players.find(p => p.id === execId);
        execResult = `投票により、${victim.name}が処刑されました。`;
        hasExecuted = true;
        executedPlayers.push(victim);
        batchOps.push({ ref: roomRef.collection('players').doc(execId), data: { status: 'dead', deathReason: '投票による処刑', diedDay: room.day } });
      }
      
      logs.push({ text: execResult, phase: `${room.day}日目 - 投票`, day: room.day });
      updates.executionResult = execResult;

      // --- てるてる坊主の勝利判定 ---
      if (hasExecuted) {
          const updatedPlayers = players.map(p => {
              if (p.id === execId) return { ...p, status: 'dead', deathReason: '投票による処刑' };
              return p;
          });
          // 処刑されたプレイヤーの中に「てるてる坊主」がいるかチェック
          // ※現状の仕様では1日1人処刑だが、将来的に複数処刑になっても対応できるよう配列でチェック
          const executedTeruterus = executedPlayers.filter(p => p.role === 'teruteru');
          if (executedTeruterus.length > 0) {
              updates.teruteruWon = true;
          }
      }
      // -------------------------------
      
      const mediums = players.filter(p => p.role === 'medium' && p.status === 'alive');
      if (mediums.length > 0) {
          let mediumCards = [];
          if (executedPlayers.length > 0) {
              mediumCards = executedPlayers.map(victim => {
                  const isWolf = ['werewolf', 'greatwolf', 'wise_wolf'].includes(victim.role);
                  const res = isWolf ? "人狼だった" : "人狼ではなかった";
                  return { label: "霊媒結果", value: res, sub: victim.name, isBad: isWolf, icon: "Ghost" };
              });
              executedPlayers.forEach(victim => {
                  const isWolf = ['werewolf', 'greatwolf', 'wise_wolf'].includes(victim.role);
                  const res = isWolf ? "人狼だった" : "人狼ではなかった";
                  logs.push({ text: `霊媒師チームに、「${victim.name}は${res}」との情報を提供しました。`, phase: `${room.day}日目 - 夜`, day: room.day, secret: true, visibleTo: mediums.map(m=>m.id) });
              });
          } else {
              mediumCards = [{ label: "霊媒", value: "今夜提供できる情報はありません", sub: "", isBad: false, icon: "Info" }];
          }
          mediums.forEach(p => {
              batchOps.push({ ref: roomRef.collection('players').doc(p.id).collection('secret').doc('actionResult'), data: { day: room.day, cards: mediumCards }, merge: true });
          });
      }

      const deadIds = players.filter(p => p.status === 'dead' || p.status === 'vanished').map(p => p.id);
      if (hasExecuted) deadIds.push(execId);
      
      const winner = checkWin(players, deadIds);
      
      if (winner) { 
          updates.status = 'finished'; 
          updates.winner = winner; 
          next = null; 
      } else {
        next = `night_${room.day}`;
        const leaders = electLeaders(players.filter(p => !deadIds.includes(p.id)));
        updates.nightLeaders = leaders;
        
        const detectives = players.filter(p => p.role === 'detective' && p.status === 'alive');
        if (detectives.length > 0) {
            const targetDay = room.day - 1;
            // 名探偵への情報提供：死因が「投票による処刑」または「ホストによる追放」のプレイヤーは除外する
            const deadList = players.filter(p => 
                p.status === 'dead' && 
                p.deathReason !== '投票による処刑' && 
                p.deathReason !== 'ホストによる追放' && 
                p.diedDay === targetDay
            );
            let detectiveCards = [];
            if (deadList.length > 0) {
                detectiveCards = deadList.map(d => ({ label: "死因", value: d.deathReason || "不明", sub: d.name, isBad: true, icon: "Search" }));
                deadList.forEach(d => {
                    logs.push({ text: `名探偵チームに、「${d.name}の死因は${d.deathReason || "不明"}」との情報を提供しました。`, phase: `${room.day}日目 - 夜`, day: room.day, secret: true, visibleTo: detectives.map(d=>d.id) });
                });
            } else {
                detectiveCards = [{ label: "調査", value: "昨晩の死者はいません", sub: "", isBad: false, icon: "Info" }];
            }
            detectives.forEach(p => {
                batchOps.push({ ref: roomRef.collection('players').doc(p.id).collection('secret').doc('actionResult'), data: { day: room.day, cards: detectiveCards }, merge: true });
            });
        }
      }
    } else if (room.phase.startsWith('night')) {
      const actions = room.nightActions || {};
      let logsSec = [], events = [];
      const deathReasonsMap = {}; // playerId -> Set of reasons

      const addReason = (pid, reason) => {
          if (!deathReasonsMap[pid]) deathReasonsMap[pid] = new Set();
          deathReasonsMap[pid].add(reason);
      };

      // 1. 護衛リストの作成（アクターの生死に関わらず有効）
      const guards = Object.values(actions)
          .filter(a => ['knight', 'trapper'].includes(a.role) && a.targetId !== 'skip')
          .map(a => a.targetId);
      
      const trapperGuards = Object.values(actions)
          .filter(a => a.role === 'trapper' && a.targetId !== 'skip')
          .map(a => a.targetId);

      // 2. アクションの整理
      let atkId = null, wolfId = null; // 人狼の襲撃
      let assassinTargetId = null, assassinId = null; // 暗殺者

      Object.values(actions).forEach(a => {
          if(['werewolf','greatwolf','wise_wolf'].includes(a.role)) { atkId = a.targetId; wolfId = a.actorId; }
          if(a.role === 'assassin' && a.targetId !== 'skip') { assassinTargetId = a.targetId; assassinId = a.actorId; }
      });

      // 3. 襲撃処理（人狼）
      let wolfKilledByTrap = false;
      let wolfAttackSuccess = false;

      if (atkId && atkId !== 'skip') {
          const tgt = players.find(p => p.id === atkId);
          const r = tgt?.role;

          // 罠師の返り討ち判定
          if (trapperGuards.includes(atkId) && wolfId) {
              addReason(wolfId, "罠師による返り討ち");
              wolfKilledByTrap = true;
          } 
          
          if (!guards.includes(atkId)) {
              if (r === 'fox') {
                  logsSec.push({ text: `人狼チームは${tgt.name}を襲撃しましたが、妖狐の能力により無効化されました。`, visibleTo: [], secret: true });
              } else if (r === 'elder' && tgt.elderShield) {
                  batchOps.push({ ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), data: { elderShield: false }, merge: true });
                  logsSec.push({ text: `${tgt.name}は人狼により襲撃されましたが、長老の能力により生き延びました。`, visibleTo: [], secret: true });
              } else if (r === 'cursed') {
                  batchOps.push({ ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), data: { role: 'werewolf', originalRole: 'cursed' }, merge: true });
                  events.push({ type: 'cursed', playerId: atkId });
                  const wolves = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role)).map(p => p.id);
                  logsSec.push({ text: `${tgt.name}は人狼により襲撃されましたが、呪われし者の能力により人狼に覚醒しました。`, visibleTo: [...wolves, atkId], secret: true });
                  
                  const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf', 'madman'].includes(p.role));
                  const awakeningPlayer = { id: atkId, role: 'werewolf', name: tgt.name };
                  wolfTeamMembers.forEach(w => {
                      batchOps.push({ ref: roomRef.collection('players').doc(w.id).collection('secret').doc('roleData'), data: { teammates: admin.firestore.FieldValue.arrayUnion(awakeningPlayer) }, merge: true });
                  });
                  const newTeammates = wolfTeamMembers.map(w => ({ id: w.id, role: w.role, name: w.name }));
                  batchOps.push({ ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), data: { teammates: newTeammates }, merge: true });
              } else {
                  addReason(atkId, "人狼による襲撃");
                  wolfAttackSuccess = true;
              }
          }
      }

      // 4. 抹消処理（ももすけ）
      if (assassinTargetId && assassinId) {
          // 暗殺者が襲撃されている（かつ護衛されていない）かチェック
          let assassinInterrupted = false;
          if (atkId === assassinId && !guards.includes(assassinId)) {
              assassinInterrupted = true;
          }

          const assassinTeam = getTeamMemberIds(players, 'assassin');
          if (assassinInterrupted) {
              logsSec.push({ text: `ももすけは襲撃されたため、存在意義の抹消に失敗しました。`, visibleTo: assassinTeam, secret: true });
          } else {
              addReason(assassinTargetId, "存在意義抹消");
              const tgtName = players.find(p => p.id === assassinTargetId)?.name;
              if (guards.includes(assassinTargetId)) {
                  logs.push({ text: `${tgtName}は護衛されていましたが、ももすけの能力により存在意義が消されてしまいました。`, visibleTo: [], secret: true, phase: "霊界ログ", day: room.day });
              }
              updates.assassinUsed = true;
          }
      }

      // 5. 占い呪殺
      Object.values(actions).forEach(a => {
        const tgt = players.find(p => p.id === a.targetId);
        if ((a.role === 'seer' || a.role === 'sage') && tgt?.role === 'fox') { 
            addReason(a.targetId, "妖狐が占われたことによる呪死"); 
        }
      });

      // 6. 人狼キラーの発動判定
      if (wolfAttackSuccess && atkId && wolfId) {
          const reasons = deathReasonsMap[atkId];
          const tgt = players.find(p => p.id === atkId);
          // 修正: 死因に「人狼による襲撃」が含まれていれば発動（複合死因でもOK）
          if (tgt?.role === 'killer' && reasons && reasons.has("人狼による襲撃")) {
              addReason(wolfId, "人狼キラーを襲撃したことの返り討ち");
              const wolfTeamIds = players.filter(p => ['werewolf','greatwolf','wise_wolf','madman'].includes(p.role)).map(p => p.id);
              logsSec.push({ text: `人狼チームは人狼キラー（${tgt.name}）を襲撃してしまったため、1人道連れで死亡します。`, visibleTo: wolfTeamIds, secret: true });
          }
      }

      // 7. 死亡確定処理
      const uniqDead = Object.keys(deathReasonsMap);
      uniqDead.forEach(id => {
          const reasonsArray = Array.from(deathReasonsMap[id]);
          const reasonStr = reasonsArray.join('&');
          batchOps.push({ ref: roomRef.collection('players').doc(id), data: { status: 'dead', deathReason: reasonStr, diedDay: room.day } });
      });
      
      const deadNames = players.filter(p => uniqDead.includes(p.id)).map(p => p.name);
      const mornMsg = deadNames.length > 0 ? `${deadNames.join('、')}が無惨な姿で発見されました。` : "昨晩は誰も死亡しませんでした...。";
      
      updates.deathResult = mornMsg;
      logs.push({ text: `${room.day+1}日目の朝になりました。\n${mornMsg}`, phase: `${room.day+1}日目 - 朝`, day: room.day+1 });
      logs.push(...logsSec);

      updates.day = room.day + 1;
      updates.nightActions = {}; updates.pendingActions = {}; updates.nightAllDoneTime = admin.firestore.FieldValue.delete();
      updates.forceNightEnd = admin.firestore.FieldValue.delete();
      if(events.length) updates.awakeningEvents = events;

      let checkPlayers = players;
      if (events.length > 0) {
          checkPlayers = players.map(p => {
              if (events.some(e => e.playerId === p.id)) return { ...p, role: 'werewolf' };
              return p;
          });
      }

      const allDead = [...players.filter(p=>p.status==='dead'||p.status==='vanished').map(p=>p.id), ...uniqDead];
      const winner = checkWin(checkPlayers, allDead);
      if (winner) { updates.status = 'finished'; updates.winner = winner; next = null; }
      else next = `announcement_${room.day+1}`;
    } else if (room.phase.startsWith('announcement')) {
        next = `day_${room.day}`;
    }

    if (next !== "" || updates.status === 'finished') { 
        if (next) updates.phase = next; 
        updates.phaseStartTime = admin.firestore.Timestamp.now();
    }
    if (logs.length) updates.logs = admin.firestore.FieldValue.arrayUnion(...logs);
    
    if (Object.keys(updates).length > 0) t.update(roomRef, updates);
    batchOps.forEach(o => o.merge ? t.set(o.ref, o.data, {merge:true}) : t.update(o.ref, o.data));
};

const checkNightCompletion = async (t, roomRef, room, players) => {
    if (!room || !players) return;
    const nightLeaders = room.nightLeaders || {};
    const nightActions = room.nightActions || {};

    const alive = players.filter(p => p.status === 'alive');
    const requiredKeys = [];

    const wolfTeam = alive.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
    if (wolfTeam.length > 0) {
        const leaderId = nightLeaders['werewolf_team'];
        if (leaderId) requiredKeys.push(leaderId);
    }
    const assassinTeam = alive.filter(p => p.role === 'assassin');
    if (assassinTeam.length > 0 && !room.assassinUsed) { 
        const leaderId = nightLeaders['assassin'];
        if (leaderId) requiredKeys.push(leaderId);
    }

    const soloRoles = ['seer', 'sage', 'knight', 'trapper'];
    alive.forEach(p => {
        if (soloRoles.includes(p.role)) requiredKeys.push(p.id);
    });

    const allDone = requiredKeys.every(key => nightActions[key] !== undefined);

    if (allDone && !room.nightAllDoneTime) {
         // クライアントのラグを考慮して、完了時刻を長めに設定（10秒）
         const doneTime = admin.firestore.Timestamp.fromMillis(Date.now() + 10000); 
         t.update(roomRef, { nightAllDoneTime: doneTime });
    }
};

// --- Exports ---

// 定期的に部屋をチェックし、放置された部屋を強制終了する
exports.cleanupAbandonedRooms = onSchedule({ schedule: "every 10 minutes", region: "asia-northeast2" }, async (event) => {
    const roomsRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms');
    const now = Date.now();
    const TIMEOUT_MS = 10 * 60 * 1000; // 10分間応答がなければ放棄とみなす
    
    const batch = db.batch();
    let updateCount = 0;
  
    // 進行中の部屋と待機中の部屋をチェック
    const statusesToCheck = ['playing', 'waiting'];
  
    for (const status of statusesToCheck) {
        const snapshot = await roomsRef.where('status', '==', status).get();
        
        for (const doc of snapshot.docs) {
            const playersSnap = await doc.ref.collection('players').get();
            
            // プレイヤーが誰もいない、または全員がタイムアウトしているか確認
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

exports.joinSpectator = onCall(async (request) => {
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
        // 開発者フラグがある場合はセット
        if (isDev) playerData.isDev = true;

        t.set(playerRef, playerData);

        t.update(roomRef, {
            notificationEvent: {
                message: `${nickname}が観戦者として途中参加しました。`,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            }
        });
    });
    return { success: true };
});

exports.toggleMaintenance = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { enabled } = request.data;
    
    // システム設定の更新権限チェック（本来は管理者IDチェックなどをすべきだが、管理者パスワードを知っている前提で実行）
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
});

exports.deleteRoom = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const uid = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    // 権限チェック: ホスト または 開発者
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
    const room = roomSnap.data();

    const pSnap = await roomRef.collection('players').doc(uid).get();
    const me = pSnap.exists ? pSnap.data() : null;
    const isHost = room.hostId === uid;
    const isDev = me?.isDev === true;

    if (!isHost && !isDev) throw new HttpsError('permission-denied', '権限がありません');

    const batch = db.batch();
    
    // サブコレクションの削除（主要なもののみ）
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
});

exports.abortGame = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const uid = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        const rSnap = await t.get(roomRef);
        if (!rSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
        const room = rSnap.data();

        // 権限チェック: ホスト または 開発者
        const pSnap = await t.get(roomRef.collection('players').doc(uid));
        const me = pSnap.exists ? pSnap.data() : null;
        const isHost = room.hostId === uid;
        const isDev = me?.isDev === true;

        if (!isHost && !isDev) throw new HttpsError('permission-denied', '権限がありません');
        
        t.update(roomRef, {
            status: 'aborted',
            logs: admin.firestore.FieldValue.arrayUnion({
                text: "ホストまたは開発者がゲームを強制終了しました。",
                phase: "System",
                day: room.day || 1
            })
        });
    });
    return { success: true };
});

exports.startGame = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const uid = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  // トランザクションまたは単純なgetで権限チェック
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) throw new HttpsError('not-found', '部屋なし');
  const room = roomSnap.data();

  // 権限チェック: ホスト または 開発者
  const pSnapHost = await roomRef.collection('players').doc(uid).get();
  const me = pSnapHost.exists ? pSnapHost.data() : null;
  const isHost = room.hostId === uid;
  const isDev = me?.isDev === true;

  if (!isHost && !isDev) throw new HttpsError('permission-denied', '権限がありません');
  
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
});

exports.kickPlayer = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode, playerId } = request.data;
    const uid = request.auth.uid; // 実行者ID
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        // 1. 全ての読み取り操作を最初に行う
        const rSnap = await t.get(roomRef);
        if (!rSnap.exists) throw new HttpsError('not-found', '部屋が見つかりません');
        const room = rSnap.data();
        
        // 実行者の情報を取得
        const meRef = roomRef.collection('players').doc(uid);
        const meSnap = await t.get(meRef);
        const me = meSnap.exists ? meSnap.data() : null;

        // 追放対象の情報を取得
        const pRef = roomRef.collection('players').doc(playerId);
        const pSnap = await t.get(pRef);
        if (!pSnap.exists) throw new HttpsError('not-found', 'プレイヤーが見つかりません');
        const target = pSnap.data();

        // 権限チェック
        const isHost = room.hostId === uid;
        const isDev = me?.isDev === true;
        const targetIsDev = target?.isDev === true;

        if (!isHost && !isDev) {
            throw new HttpsError('permission-denied', '権限がありません');
        }

        // ホストによる開発者追放の禁止チェック
        if (isHost && !isDev && targetIsDev) {
            throw new HttpsError('permission-denied', 'ホストは開発者を追放できません');
        }

        const allPlayersSnap = await t.get(roomRef.collection('players'));
        
        const playersData = [];
        const secretRefs = [];
        const playerDocs = [];
        
        // 観戦者かどうかを確認
        const isTargetSpectator = target.isSpectator;

        if (isTargetSpectator) {
            // 観戦者の場合、シークレット情報は持っていないので、単純にプレイヤーリストから削除するだけ
            t.delete(pRef);
            const pName = target.name;
            t.update(roomRef, { 
                logs: admin.firestore.FieldValue.arrayUnion({ text: `${pName}が追放されました。`, phase: "System", day: room.day }) 
            });
            return;
        }

        // 以下、通常のプレイヤー追放ロジック
        for (const docSnap of allPlayersSnap.docs) {
            const p = { id: docSnap.id, ...docSnap.data() };
            // キック対象のステータスはメモリ上で更新しておく
            if (p.id === playerId) {
                p.status = 'dead'; // vanishedではなくdead扱いにする（ログに残すため）
                p.deathReason = 'ホストによる追放';
            }
            
            playerDocs.push(p);
            secretRefs.push(docSnap.ref.collection('secret').doc('roleData'));
        }
        
        const secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
        
        for (let i = 0; i < playerDocs.length; i++) {
            const p = playerDocs[i];
            const sSnap = secretSnaps[i];
            if (sSnap.exists) {
                p.role = sSnap.data().role;
            }
            playersData.push(p);
        }

        // 2. 書き込み操作を開始
        
        // プレイヤーのステータス更新
        // 死因を「ホストによる追放」とする
        t.update(pRef, { status: 'dead', deathReason: 'ホストによる追放', diedDay: room.day });
        
        const pName = target.name;
        t.update(roomRef, { 
            logs: admin.firestore.FieldValue.arrayUnion({ text: `${pName}がホストまたは開発者により追放されました。`, phase: "System", day: room.day }) 
        });

        // 勝敗判定の再計算
        const deadIds = playersData.filter(p => p.status === 'dead' || p.status === 'vanished').map(p => p.id);
        const winner = checkWin(playersData, deadIds);
        
        if (winner) {
            t.update(roomRef, { status: 'finished', winner: winner });
        } else if (room.phase.startsWith('night')) {
            await checkNightCompletion(t, roomRef, room, playersData);
        } else if (room.phase.startsWith('day')) {
             // 昼フェーズの場合、残りの生存者全員が準備完了か確認する
             const alive = playersData.filter(p => p.status === 'alive');
             const allReady = alive.every(p => p.isReady);
             // 少なくとも1人以上の生存者がいて、全員準備完了なら進める
             if (allReady && alive.length > 0) {
                 await applyPhaseChange(t, roomRef, room, playersData);
             }
        }
    });
    return { success: true };
});

exports.submitNightAction = onCall(async (request) => {
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

        newLogs.push({ text: `人狼チームは${targetName}を襲撃しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo });
        
        // 賢狼ロジック: 賢狼が生存していればターゲットの役職情報を開示
        const wiseWolves = players.filter(p => p.role === 'wise_wolf' && p.status === 'alive');
        const isWiseWolfAlive = wiseWolves.length > 0;
        const wiseWolfExists = players.some(p => p.role === 'wise_wolf'); // ゲーム内に賢狼が存在するか
        
        // 狂人を除く人狼チーム（人狼、大狼、賢狼）のみ
        const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
        
        let resultCards = [];
        // 賢狼が最初からいない場合はカードを生成しない
        if (wiseWolfExists) {
            if (isWiseWolfAlive && targetId !== 'skip' && targetSecret.exists) {
                 const targetRoleKey = targetSecret.data().role;
                 const tgtRoleName = ROLE_NAMES[targetRoleKey] || "不明";
                 
                 // カードのラベル変更: 賢狼の導き -> [ターゲット名]の役職
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
});

exports.nightInteraction = onCall(async (request) => {
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
              
              let actionMsg = "";
              if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
                  actionMsg = `人狼チームは${targetName}を襲撃しました。`;
                  
                  // ★賢狼ロジック（投票による決定時も実行）
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
                           
                           // ログ追加は後で行う（順序制御のためここでは行わない）
                      } else {
                           // カードのラベル変更
                           resultCards.push({ label: `${targetName}の役職`, value: "情報なし", sub: `賢狼が死亡したため、${targetName}の役職は提供されません`, isBad: true, icon: "Moon" });
                      }
                      
                      wolfTeamMembers.forEach(w => {
                           t.set(roomRef.collection('players').doc(w.id).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
                      });
                  }
              }
              else if (myRole === 'knight') actionMsg = `騎士チームは${targetName}を護衛しました。`;
              else if (myRole === 'trapper') actionMsg = `罠師チームは${targetName}を護衛しました。`;
              else if (myRole === 'assassin') {
                  if (targetId !== 'skip') actionMsg = `ももすけチームは${targetName}を存在意義抹消対象にしました。`;
                  else actionMsg = `ももすけチームは今夜は誰の存在意義も消しませんでした。`;
              }
              
              // ログの保存順序を制御：まずアクションログ、その後に賢狼ログ
              if (actionMsg) {
                  // 人狼チームの場合は狂人にも見せる
                  let visibleTo = teamIds;
                  if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
                      const madmenIds = players.filter(p => p.role === 'madman').map(p => p.id);
                      visibleTo = [...new Set([...teamIds, ...madmenIds])];
                  }
                  t.update(roomRef, { logs: admin.firestore.FieldValue.arrayUnion({ text: actionMsg, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo }) });
              }

              // 賢狼のログはアクションログの後に追加
              if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
                  const wiseWolves = players.filter(p => p.role === 'wise_wolf' && p.status === 'alive');
                  const isWiseWolfAlive = wiseWolves.length > 0;
                  const wiseWolfExists = players.some(p => p.role === 'wise_wolf');
                  const targetPlayer = players.find(p => p.id === targetId);
                  
                  if (wiseWolfExists && isWiseWolfAlive && targetId !== 'skip' && targetPlayer) {
                       const tgtRoleName = ROLE_NAMES[targetPlayer.role] || "不明";
                       const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
                       const visibleTo = wolfTeamMembers.map(p => p.id);
                       t.update(roomRef, { logs: admin.firestore.FieldValue.arrayUnion({ text: `賢狼が生存しているため、人狼チームに「${targetName}の正確な役職は${tgtRoleName}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: visibleTo }) });
                  }
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
});

exports.advancePhase = onCall(async (request) => {
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
});

exports.getAllPlayerRoles = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
    const { roomCode } = request.data;
    const uid = request.auth.uid;
    const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) throw new HttpsError('not-found', 'Room not found');
    const room = roomSnap.data();
    const pSnap = await roomRef.collection('players').get();
    const me = pSnap.docs.find(d => d.id === uid);
    
    // 権限チェック: 死亡者、ゲーム終了後、ホスト、または開発者
    const isDead = me && (me.data().status === 'dead' || me.data().status === 'vanished');
    const isFinished = room.status === 'finished' || room.status === 'closed';
    const isHost = room.hostId === uid;
    const isDev = me && me.data().isDev === true;
    
    if (!isDead && !isFinished && !isHost && !isDev) throw new HttpsError('permission-denied', '権限がありません');

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
});

exports.toggleReady = onCall(async (request) => {
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
});

exports.submitVote = onCall(async (request) => {
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
});

exports.migrateHost = onCall(async (request) => {
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
});

exports.resetToLobby = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const uid = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  // 権限チェック: ホスト または 開発者
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) throw new HttpsError('not-found', 'Room not found');
  const room = roomSnap.data();
  
  const pSnapHost = await roomRef.collection('players').doc(uid).get();
  const me = pSnapHost.exists ? pSnapHost.data() : null;
  const isHost = room.hostId === uid;
  const isDev = me?.isDev === true;

  if (!isHost && !isDev) throw new HttpsError('permission-denied', '権限がありません');

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
});