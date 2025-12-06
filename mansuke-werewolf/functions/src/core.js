// コアロジックファイル
// フェーズ進行や夜のアクション処理など、DB操作を伴う複雑なロジックをここにまとめます

const admin = require("firebase-admin");
// adminが初期化されていればインスタンスを取得できます
const db = admin.firestore();

const { ROLE_NAMES } = require('./constants');
const { checkWin, electLeaders, getTeamMemberIds } = require('./utils');

// ★追加: ゲームデータのアーカイブ処理
const archiveGame = async (t, roomRef, roomData, players, endStatus, winner = null) => {
    // 必須データのチェック
    if (!roomData.matchId) return;

    // 保存先を match_history コレクションに変更
    const historyRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('match_history').doc(roomData.matchId);
    
    // アーカイブするデータを作成
    const archiveData = {
        matchId: roomData.matchId,
        roomCode: roomRef.id,
        hostId: roomData.hostId,
        hostName: roomData.hostName,
        status: endStatus,
        winner: winner || roomData.winner || null,
        teruteruWon: roomData.teruteruWon || false,
        roleSettings: roomData.roleSettings || {},
        logs: roomData.logs || [],
        // プレイヤー情報（役職含む）を保存
        players: players.map(p => ({
            id: p.id,
            name: p.name,
            role: p.role || 'unknown',
            originalRole: p.originalRole || p.role || 'unknown',
            status: p.status,
            deathReason: p.deathReason || null,
            diedDay: p.diedDay || null,
            isSpectator: p.isSpectator || false,
            isDev: p.isDev || false
        })),
        // チャットログは容量が大きくなる可能性があるため今回は割愛し、主要なログのみとする
        // 必要であればここに chatMessages を追加することも可能
        chatMessages: [], 
        createdAt: roomData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        startedAt: roomData.phaseStartTime || null,
        endedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    t.set(historyRef, archiveData);
};

// フェーズ変更を適用する（昼→夜、夜→朝など）
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
          const teruteruPlayers = updatedPlayers.filter(p => p.role === 'teruteru');
          if (teruteruPlayers.length > 0) {
              const allExecuted = teruteruPlayers.every(p => p.status === 'dead' && p.deathReason === '投票による処刑');
              if (allExecuted) {
                  updates.teruteruWon = true;
              }
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
          // ★追加: 正常終了時にアーカイブ
          await archiveGame(t, roomRef, {...room, ...updates}, players, 'finished', winner);
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
      if (winner) { 
          updates.status = 'finished'; 
          updates.winner = winner; 
          next = null; 
          // ★追加: 終了時にアーカイブ
          await archiveGame(t, roomRef, {...room, ...updates}, checkPlayers, 'finished', winner);
      }
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

// 全員の夜のアクションが完了したかチェックする
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

module.exports = {
  applyPhaseChange,
  checkNightCompletion,
  archiveGame // エクスポート
};