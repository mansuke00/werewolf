// Firebase Functions (v2) と Admin SDK の読み込み
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentUpdated } = require("firebase-functions/v2");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

// Admin SDKの初期化（二重起動防止）
if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

// 大阪リージョンに設定、インスタンス数を制限してコスト管理
setGlobalOptions({ region: "asia-northeast2", maxInstances: 10 });

// 各フェーズの制限時間設定（秒単位）
// ゲームバランス調整時はここをいじる
const TIME_LIMITS = {
  DISCUSSION: 240, // 昼の議論時間
  VOTING: 20,      // 投票時間
  NIGHT: 86400,    // 夜時間（実質無制限だが、全員完了で早まる）
  ANNOUNCEMENT: 10,// 結果発表表示時間
  COUNTDOWN: 5,    // 開始カウントダウン
  ROLE_REVEAL: 3,  // 役職確認時間
};

// 役職IDと表示名のマッピング
const ROLE_NAMES = {
  citizen: "市民", seer: "占い師", medium: "霊媒師", knight: "騎士",
  trapper: "罠師", sage: "賢者", killer: "人狼キラー", detective: "名探偵",
  cursed: "呪われし者", elder: "長老", werewolf: "人狼", greatwolf: "大狼",
  madman: "狂人", fox: "妖狐",
};

// --- ユーティリティ関数 ---

// フィッシャー–イェーツのシャッフルアルゴリズム
// 役職のランダム配布に使用
const shuffle = (arr) => {
  const n = [...arr];
  for (let i = n.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [n[i], n[j]] = [n[j], n[i]];
  }
  return n;
};

// 勝利判定ロジック
// 生存者の内訳から勝敗を決定する
// 優先順位: 妖狐 > 人狼 > 市民
const checkWin = (players, deadIds) => {
  const live = players.filter(p => !deadIds.includes(p.id));
  const wolves = live.filter(p => ['werewolf', 'greatwolf'].includes(p.role)).length;
  const humans = live.filter(p => !['werewolf', 'greatwolf'].includes(p.role)).length;
  const fox = live.some(p => p.role === 'fox');

  // 人狼全滅 -> 妖狐がいれば妖狐勝ち、いなければ市民勝ち
  if (wolves === 0) return fox ? 'fox' : 'citizen';
  // 人狼が人間と同数以上 -> 妖狐がいれば妖狐勝ち、いなければ人狼勝ち
  if (wolves >= humans) return fox ? 'fox' : 'werewolf';
  
  return null; // 決着つかず
};

// 夜のアクションにおける代表者を選出する（人狼チャットや共有チャット用）
// ランダムで1人選ばれる
const electLeaders = (players) => {
  const leaders = {};
  const groups = {};
  
  const alivePlayers = players.filter(p => p.status === 'alive');

  alivePlayers.forEach(p => {
    const role = p.role;
    if (!role) return;
    
    // 人狼チーム（大狼含む）
    if (['werewolf', 'greatwolf'].includes(role)) {
      if (!groups['werewolf_team']) groups['werewolf_team'] = [];
      groups['werewolf_team'].push(p.id);
    } 
    // 単独行動だがチャット等がある役職（または将来的な拡張用）
    else if (['seer', 'sage', 'knight', 'trapper'].includes(role)) {
      if (!groups[role]) groups[role] = [];
      groups[role].push(p.id);
    }
  });

  // 各グループからランダムにリーダーIDを決定
  Object.entries(groups).forEach(([key, ids]) => {
    if (ids.length > 0) {
      leaders[key] = ids[Math.floor(Math.random() * ids.length)];
    }
  });
  return leaders;
};

// 特定の役職またはチームに所属するプレイヤーIDリストを取得
// ログの開示範囲（visibleTo）の設定に使う
const getTeamMemberIds = (players, role) => {
    if (['werewolf', 'greatwolf'].includes(role)) {
        return players.filter(p => ['werewolf', 'greatwolf'].includes(p.role)).map(p => p.id);
    }
    return players.filter(p => p.role === role).map(p => p.id);
};

// --- コアロジック: フェーズ遷移とゲーム進行 ---
// この関数がゲームの状態遷移（ステートマシン）の役割を果たす
const applyPhaseChange = async (t, roomRef, room, players) => {
    let next = "", logs = [], updates = {}, batchOps = [];

    // カウントダウン -> 役職確認
    if (room.phase === 'countdown') {
        next = 'role_reveal';
    }
    // 役職確認 -> 1日目開始（初日は夜アクションなし、挨拶のみ）
    else if (room.phase === 'role_reveal') {
      next = 'day_1';
      logs.push({ text: "1日目の朝になりました。", phase: "1日目 - 昼", day: 1 });
      updates.day = 1;
      
      // 夜情報の初期化
      updates.nightActions = {};
      updates.pendingActions = {};
      updates.nightLeaders = {};
    }
    // 1日目終了 -> 夜フェーズへ（初日犠牲者は無し設定）
    else if (room.phase === 'day_1') {
      next = 'night_1';
      logs.push({ text: "1日目は投票がありません。日が暮れました。", phase: "1日目 - 終了", day: 1 });
      
      const leaders = electLeaders(players);
      updates.nightLeaders = leaders;
      
      // 全員の準備完了状態をリセット
      players.forEach(p => batchOps.push({ ref: roomRef.collection('players').doc(p.id), data: { isReady: false } }));

      // 名探偵と霊媒師には初期情報（初日は情報なし）を配布
      const detectives = players.filter(p => p.role === 'detective' && p.status === 'alive');
      detectives.forEach(p => {
          batchOps.push({ 
              ref: roomRef.collection('players').doc(p.id).collection('secret').doc('actionResult'), 
              data: { day: 1, cards: [{ label: "調査", value: "今夜提供できる情報はありません", sub: "", isBad: false, icon: "Info" }] },
              merge: true 
          });
      });
      const mediums = players.filter(p => p.role === 'medium' && p.status === 'alive');
      mediums.forEach(p => {
          batchOps.push({ 
              ref: roomRef.collection('players').doc(p.id).collection('secret').doc('actionResult'), 
              data: { day: 1, cards: [{ label: "霊媒", value: "今夜提供できる情報はありません", sub: "", isBad: false, icon: "Info" }] },
              merge: true
          });
      });
    }
    // 2日目以降の昼 -> 投票フェーズへ
    else if (room.phase.startsWith('day')) {
      next = 'voting';
      
      // 前回の投票データをクリア
      const voteDocs = await t.get(roomRef.collection('votes'));
      voteDocs.docs.forEach(d => t.delete(d.ref));
      updates.votes = []; 

      players.forEach(p => batchOps.push({ ref: roomRef.collection('players').doc(p.id), data: { isReady: false } }));
    }
    // 投票集計 -> 処刑実行 -> 勝敗判定 -> 夜フェーズへ
    else if (room.phase === 'voting') {
      const votes = room.votes || [];
      const summaryMap = {};
      
      const voteResultLines = [];
      const voteDetailLines = [];
      const anonymous = room.anonymousVoting; // 匿名投票設定の確認

      // 集計処理
      votes.forEach(v => {
          if (!summaryMap[v.target]) summaryMap[v.target] = { targetId: v.target, count: 0, voters: [] };
          summaryMap[v.target].count++;
          summaryMap[v.target].voters.push(v.voterId);
      });
      
      const voteSummary = Object.values(summaryMap).sort((a, b) => b.count - a.count);
      updates.voteSummary = voteSummary;

      // ログ生成（誰が誰に入れたか）
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

      if (voteDetailLines.length > 0) {
          logs.push({ text: `＜各プレイヤーの投票先＞\n${voteDetailLines.join('\n')}`, phase: `${room.day}日目 - 投票`, day: room.day });
      }
      logs.push({ text: `＜開票結果＞\n${voteResultLines.join('\n')}`, phase: `${room.day}日目 - 投票`, day: room.day });

      // 最多得票者の判定（同数なら処刑なし）
      const counts = {};
      votes.forEach(v => counts[v.target] = (counts[v.target] || 0) + 1);
      let max = 0, execId = null;
      Object.entries(counts).forEach(([id, c]) => { if (c > max) { max = c; execId = id; } else if (c === max) execId = null; });

      let execResult = "同数投票、またはスキップ多数のため、処刑は行いません。";
      let hasExecuted = false;
      const executedPlayers = []; 

      // 処刑実行処理
      if (execId && execId !== 'skip') {
        const victim = players.find(p => p.id === execId);
        execResult = `投票により、${victim.name}が処刑されました。`;
        hasExecuted = true;
        executedPlayers.push(victim);
        batchOps.push({ ref: roomRef.collection('players').doc(execId), data: { status: 'dead', deathReason: '投票による処刑', diedDay: room.day } });
      }
      
      logs.push({ text: execResult, phase: `${room.day}日目 - 投票`, day: room.day });
      updates.executionResult = execResult;

      // 霊媒師への結果通知（処刑された人の白黒判定）
      const mediums = players.filter(p => p.role === 'medium' && p.status === 'alive');
      if (mediums.length > 0) {
          let mediumCards = [];
          if (executedPlayers.length > 0) {
              mediumCards = executedPlayers.map(victim => {
                  const isWolf = ['werewolf', 'greatwolf'].includes(victim.role);
                  const res = isWolf ? "人狼だった" : "人狼ではなかった";
                  return { label: "霊媒結果", value: res, sub: victim.name, isBad: isWolf, icon: "Ghost" };
              });
              
              executedPlayers.forEach(victim => {
                  const isWolf = ['werewolf', 'greatwolf'].includes(victim.role);
                  const res = isWolf ? "人狼だった" : "人狼ではなかった";
                  logs.push({ text: `霊媒師チームに、「${victim.name}は${res}」との情報を提供しました。`, phase: `${room.day}日目 - 夜`, day: room.day, secret: true, visibleTo: mediums.map(m=>m.id) });
              });
          } else {
              mediumCards = [{ label: "霊媒", value: "今夜提供できる情報はありません", sub: "", isBad: false, icon: "Info" }];
          }

          mediums.forEach(p => {
              batchOps.push({ 
                  ref: roomRef.collection('players').doc(p.id).collection('secret').doc('actionResult'), 
                  data: { day: room.day, cards: mediumCards }, 
                  merge: true
              });
          });
      }

      // 勝敗判定（処刑後の状態）
      const deadIds = players.filter(p => p.status === 'dead').map(p => p.id);
      if (hasExecuted) deadIds.push(execId);
      const winner = checkWin(players, deadIds);
      
      if (winner) { 
          updates.status = 'finished'; 
          updates.winner = winner; 
          next = null; 
      }
      else {
        // ゲーム続行なら夜フェーズへ準備
        next = `night_${room.day}`;
        const leaders = electLeaders(players.filter(p => !deadIds.includes(p.id)));
        updates.nightLeaders = leaders;
        
        // 名探偵への情報提供（前日の死因などの調査結果）
        const detectives = players.filter(p => p.role === 'detective' && p.status === 'alive');
        if (detectives.length > 0) {
            const targetDay = room.day - 1;
            const deadList = players.filter(p => p.status === 'dead' && p.deathReason !== 'execution' && p.diedDay === targetDay);
            
            let detectiveCards = [];
            if (deadList.length > 0) {
                detectiveCards = deadList.map(d => ({
                    label: "死因",
                    value: d.deathReason || "不明",
                    sub: d.name,
                    isBad: true,
                    icon: "Search"
                }));
                
                const detectiveIds = detectives.map(d => d.id);
                deadList.forEach(d => {
                    logs.push({ text: `名探偵チームに、「${d.name}の死因は${d.deathReason || "不明"}」との情報を提供しました。`, phase: `${room.day}日目 - 夜`, day: room.day, secret: true, visibleTo: detectiveIds });
                });
            } else {
                detectiveCards = [{ label: "調査", value: "昨晩の死者はいません", sub: "", isBad: false, icon: "Info" }];
            }

            detectives.forEach(p => {
                batchOps.push({ 
                    ref: roomRef.collection('players').doc(p.id).collection('secret').doc('actionResult'), 
                    data: { day: room.day, cards: detectiveCards }, 
                    merge: true
                });
            });
        }
      }
    }
    // 夜フェーズ終了処理 -> アクション解決（襲撃、護衛など）
    else if (room.phase.startsWith('night')) {
      const actions = room.nightActions || {};
      let dead = [], logsSec = [], events = [], reasons = {};
      let atkId = null, wolfId = null;
      
      // 人狼の襲撃先と実行者を特定
      Object.values(actions).forEach(a => { if(['werewolf','greatwolf'].includes(a.role)) { atkId = a.targetId; wolfId = a.actorId; } });
      // 騎士・罠師の護衛先
      const guards = Object.values(actions).filter(a=>['knight','trapper'].includes(a.role)).map(a=>a.targetId);
      
      // 罠師のカウンター判定（人狼が罠師の守っているところを噛んだら人狼が死ぬ）
      let trapKill = false;
      if (Object.values(actions).some(a=>a.role==='trapper' && a.targetId===atkId) && wolfId) {
        dead.push(wolfId); trapKill = true; reasons[wolfId] = "罠師の護衛先を襲撃したことによる返り討ち";
      }

      // 襲撃処理（カウンターがなければ）
      if (atkId && !trapKill) {
        let success = true;
        const tgt = players.find(p=>p.id===atkId);
        const r = tgt?.role;
        
        // 護衛成功判定
        if (guards.includes(atkId)) {
            success = false;
        } 
        // 妖狐への襲撃は無効
        else if (r === 'fox') {
            success = false;
            logsSec.push({ 
                text: `人狼チームは${tgt.name}を襲撃しましたが、妖狐の能力により、襲撃は無効化されました。`, 
                visibleTo: [], 
                secret: true 
            });
        }
        // 長老の1回ガード能力
        else if (r==='elder' && tgt.elderShield) {
          success = false;
          batchOps.push({ ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), data: { elderShield: false }, merge: true });
          logsSec.push({ text: `${tgt.name}は人狼により襲撃されましたが、長老の能力により生き延びました。`, visibleTo: [], secret: true });
        } 
        // 呪われし者の覚醒（襲撃されると人狼になる）
        else if (r==='cursed') {
          success = false;
          batchOps.push({ ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), data: { role: 'werewolf', originalRole: 'cursed' }, merge: true });
          events.push({ type: 'cursed', playerId: atkId });
          const wolves = players.filter(p=>['werewolf','greatwolf'].includes(p.role)).map(p=>p.id);
          logsSec.push({ text: `${tgt.name}は人狼により襲撃されましたが、呪われし者の能力により人狼に覚醒しました。`, visibleTo: [...wolves, atkId], secret: true });
          
          // 人狼チャットメンバーの更新
          const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'madman'].includes(p.role));
          const awakeningPlayer = { id: atkId, role: 'werewolf', name: tgt.name };
          wolfTeamMembers.forEach(w => {
              batchOps.push({ 
                  ref: roomRef.collection('players').doc(w.id).collection('secret').doc('roleData'), 
                  data: { teammates: admin.firestore.FieldValue.arrayUnion(awakeningPlayer) }, 
                  merge: true 
              });
          });
          const newTeammates = wolfTeamMembers.map(w => ({ id: w.id, role: w.role, name: w.name }));
          batchOps.push({ 
              ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), 
              data: { teammates: newTeammates }, 
              merge: true 
          });

        }
        
        // 襲撃成功時の処理
        if (success) {
          dead.push(atkId); reasons[atkId] = "人狼による襲撃";
          
          // 人狼キラーを噛んだ場合の道連れ処理
          if (r==='killer' && wolfId) { 
              dead.push(wolfId); 
              reasons[wolfId] = "人狼キラーを襲撃したことの返り討ち"; 
              
              const wolfTeamIds = players.filter(p=>['werewolf','greatwolf','madman'].includes(p.role)).map(p=>p.id);
              logsSec.push({ 
                  text: `人狼チームは人狼キラー（${tgt.name}）を襲撃してしまったため、1人道連れで死亡します。`,
                  visibleTo: wolfTeamIds, 
                  secret: true 
              });
          }
        }
      }

      // 占い師・賢者が妖狐を占った場合の呪殺判定
      Object.values(actions).forEach(a => {
        const tgt = players.find(p=>p.id===a.targetId);
        const r = tgt?.role;
        if ((a.role === 'seer' || a.role === 'sage') && r) {
          if (r==='fox') { dead.push(a.targetId); reasons[a.targetId] = "妖狐が占い師または賢者に占われたことによる呪死"; }
        }
      });

      // 死者リストの整理と反映
      const uniqDead = [...new Set(dead)];
      
      uniqDead.forEach(id => batchOps.push({ ref: roomRef.collection('players').doc(id), data: { status: 'dead', deathReason: reasons[id]||'unknown', diedDay: room.day } }));
      const deadNames = players.filter(p=>uniqDead.includes(p.id)).map(p=>p.name);
      const mornMsg = deadNames.length>0 ? `${deadNames.join('、')}が無惨な姿で発見されました。` : "昨晩は誰も死亡しませんでした...。";
      
      updates.deathResult = mornMsg;
      logs.push({ text: `${room.day+1}日目の朝になりました。\n${mornMsg}`, phase: `${room.day+1}日目 - 朝`, day: room.day+1 });
      logs.push(...logsSec);

      // 翌日の準備
      updates.day = room.day + 1;
      updates.nightActions = {}; updates.pendingActions = {}; updates.nightAllDoneTime = admin.firestore.FieldValue.delete();
      updates.forceNightEnd = admin.firestore.FieldValue.delete();
      if(events.length) updates.awakeningEvents = events;

      // 覚醒イベントがあった場合の役職反映（メモリ上）
      let checkPlayers = players;
      if (events.length > 0) {
          checkPlayers = players.map(p => {
              if (events.some(e => e.playerId === p.id)) return { ...p, role: 'werewolf' };
              return p;
          });
      }

      // 最終的な勝敗判定
      const allDead = [...players.filter(p=>p.status==='dead').map(p=>p.id), ...uniqDead];
      const winner = checkWin(checkPlayers, allDead);
      if (winner) { updates.status = 'finished'; updates.winner = winner; next = null; }
      else next = `announcement_${room.day+1}`;
    }
    // アナウンスフェーズ -> 次の日の議論へ
    else if (room.phase.startsWith('announcement')) {
        next = `day_${room.day}`;
    }

    // フェーズ更新があればDB反映
    if (next !== "" || updates.status === 'finished') { 
        if (next) updates.phase = next; 
        // クライアント側での計算ズレを防ぐため、サーバータイムスタンプではなく確定時刻を記録
        updates.phaseStartTime = admin.firestore.Timestamp.now();
    }
    if (logs.length) updates.logs = admin.firestore.FieldValue.arrayUnion(...logs);
    
    if (Object.keys(updates).length > 0) {
        t.update(roomRef, updates);
    }
    // バッチ処理の実行
    batchOps.forEach(o => o.merge ? t.set(o.ref, o.data, {merge:true}) : t.update(o.ref, o.data));
};

// 全員のアクションが完了したかチェックする関数
// 完了していたら時間を短縮するフラグを立てる
const checkNightCompletion = async (t, roomRef, room, players) => {
    const alive = players.filter(p => p.status === 'alive');
    const requiredKeys = [];

    // 人狼チームのアクション完了確認
    const wolfTeam = alive.filter(p => ['werewolf', 'greatwolf'].includes(p.role));
    if (wolfTeam.length > 0) {
        const leaderId = room.nightLeaders?.['werewolf_team'];
        if (leaderId) requiredKeys.push(leaderId);
    }

    // 単独行動役職のアクション完了確認
    const soloRoles = ['seer', 'sage', 'knight', 'trapper'];
    alive.forEach(p => {
        if (soloRoles.includes(p.role)) {
            requiredKeys.push(p.id);
        }
    });

    const currentActions = room.nightActions || {};
    const allDone = requiredKeys.every(key => currentActions[key] !== undefined);

    // 全員完了なら10秒後に夜を強制終了させるタイマーセット
    if (allDone) {
        if (!room.nightAllDoneTime) {
             const doneTime = admin.firestore.Timestamp.fromMillis(Date.now() + 10000); 
             t.update(roomRef, { nightAllDoneTime: doneTime });
        }
    }
};


// --- Exports (クライアントから呼ばれるAPI群) ---

// プレイヤー全員の役職を取得（ゲーム終了後、または死者、ホストのみ実行可能）
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
    
    const isDead = me && me.data().status === 'dead';
    const isFinished = room.status === 'finished' || room.status === 'closed';
    const isHost = room.hostId === uid;
    
    // カンニング防止：条件を満たさない場合は拒否
    if (!isDead && !isFinished && !isHost) {
        throw new HttpsError('permission-denied', '生存中は他のプレイヤーの役職を見ることはできません');
    }

    // シークレットコレクションから役職データを取得して結合
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

// 夜のアクションを送信（単独役職用：占い、護衛など）
exports.submitNightAction = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode, targetId } = request.data;
  const actorId = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  await db.runTransaction(async (t) => {
    // 実行者の役職確認
    const sRef = roomRef.collection('players').doc(actorId).collection('secret').doc('roleData');
    const sSnap = await t.get(sRef);
    if (!sSnap.exists) return;
    const role = sSnap.data().role;

    const rSnap = await t.get(roomRef);
    if(!rSnap.exists) return;
    const room = rSnap.data();

    // 占い師・賢者の場合、対象のデータを取得
    let targetDoc = null;
    let targetSecret = null;
    if (role === 'seer' || role === 'sage') {
        targetDoc = await t.get(roomRef.collection('players').doc(targetId));
        targetSecret = await t.get(roomRef.collection('players').doc(targetId).collection('secret').doc('roleData'));
    }

    const pSnap = await t.get(roomRef.collection('players'));
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    
    // 全プレイヤーデータを構築（ログ用）
    let secretSnaps = [];
    if (secretRefs.length > 0) {
        secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    }
    
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i] && secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });

    // アクションの登録
    const actionData = { actorId, targetId, role, processed: false };
    t.update(roomRef, { [`nightActions.${actorId}`]: actionData });
    
    // 騎士・罠師の連続護衛防止用履歴更新
    if (role === 'knight' || role === 'trapper') {
        t.update(roomRef.collection('players').doc(actorId), { lastTarget: targetId });
    }

    // 自分のチームだけに表示されるログを生成
    const targetName = players.find(p => p.id === targetId)?.name || "不明";
    let newLogs = [];
    const teamIds = getTeamMemberIds(players, role); 
    
    if (['werewolf', 'greatwolf'].includes(role)) {
        newLogs.push({ text: `人狼チームは${targetName}を襲撃しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
    } else if (role === 'knight') {
        newLogs.push({ text: `騎士チームは${targetName}を護衛しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
    } else if (role === 'trapper') {
        newLogs.push({ text: `罠師チームは${targetName}を護衛しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
    }

    // 占い・賢者の即時結果返却
    if (role === 'seer' || role === 'sage') {
        if (targetDoc && targetDoc.exists && targetSecret && targetSecret.exists) {
            const tgtName = targetDoc.data().name;
            const tgtRole = targetSecret.data().role;
            const resultCards = [];
            
            if (role === 'seer') {
                const isWolf = tgtRole === 'werewolf'; 
                const resText = isWolf ? "人狼" : "人狼ではない";
                const icon = isWolf ? "Moon" : "Sun";
                resultCards.push({ label: "占い結果", value: resText, sub: tgtName, isBad: isWolf, icon: icon });
                newLogs.push({ text: `占い師チームに、「${tgtName}は${resText}」との占い結果を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
            } else if (role === 'sage') {
                resultCards.push({ label: "賢者結果", value: ROLE_NAMES[tgtRole], sub: tgtName, isBad: false, icon: "Eye" });
                newLogs.push({ text: `賢者チームに、「${tgtName}の正確な役職は${ROLE_NAMES[tgtRole]}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
            }
            // 個人結果領域に保存（クライアントでのカード表示用）
            t.set(roomRef.collection('players').doc(actorId).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
        }
    }

    if (newLogs.length > 0) {
        t.update(roomRef, { logs: admin.firestore.FieldValue.arrayUnion(...newLogs) });
    }

    // 未処理フラグをクリア
    let teamKey = role;
    if (['werewolf', 'greatwolf'].includes(role)) teamKey = 'werewolf_team';
    t.update(roomRef, { [`pendingActions.${teamKey}`]: admin.firestore.FieldValue.delete() });

    if (!room.nightActions) room.nightActions = {};
    room.nightActions[actorId] = actionData;

    // 全員完了判定
    await checkNightCompletion(t, roomRef, room, players);
  });
  return { success: true };
});

// 夜のチームアクション（人狼チャットでの提案・投票処理）
exports.nightInteraction = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode, type, payload } = request.data; 
  const actorId = request.auth.uid;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  
  await db.runTransaction(async (t) => {
    // 権限確認
    const sRef = roomRef.collection('players').doc(actorId).collection('secret').doc('roleData');
    const sSnap = await t.get(sRef);
    if (!sSnap.exists) return;
    const myRole = sSnap.data().role;
    
    let teamKey = myRole;
    if (['werewolf', 'greatwolf'].includes(myRole)) teamKey = 'werewolf_team';
    
    const rSnap = await t.get(roomRef);
    const room = rSnap.data();
    const pendingKey = `pendingActions.${teamKey}`;
    
    const pSnap = await t.get(roomRef.collection('players'));
    const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
    
    let secretSnaps = [];
    if (secretRefs.length > 0) {
        secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    }
    
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i] && secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });
    
    // 承認に必要な人数（生存メンバー数）を計算
    let teamMembers = [];
    if (teamKey === 'werewolf_team') {
        teamMembers = players.filter(p => p.status === 'alive' && ['werewolf', 'greatwolf'].includes(p.role));
    } else {
        teamMembers = players.filter(p => p.status === 'alive' && p.role === myRole);
    }
    const requiredVotes = teamMembers.length;

    // 提案処理
    if (type === 'propose') {
      t.update(roomRef, {
        [pendingKey]: { targetId: payload.targetId, leaderId: actorId, approvals: [actorId], rejects: [] }
      });
    } 
    // 投票処理（同意/拒否）
    else if (type === 'vote') {
      if (payload.approve) {
        const pendingMap = room.pendingActions || {};
        const curr = pendingMap[teamKey];
        
        if (curr) {
          const newApprovals = [...new Set([...(curr.approvals || []), actorId])];
          
          // 全員同意したらアクション確定
          if (newApprovals.length >= requiredVotes) {
              const targetId = curr.targetId;
              const leaderId = curr.leaderId; 
              
              const actionData = { actorId: leaderId, targetId, role: myRole, processed: false };
              t.update(roomRef, { [`nightActions.${leaderId}`]: actionData });
              
              const targetName = players.find(p => p.id === targetId)?.name || "不明";
              const teamIds = getTeamMemberIds(players, myRole);
              
              let actionMsg = "";
              if (['werewolf', 'greatwolf'].includes(myRole)) actionMsg = `人狼チームは${targetName}を襲撃しました。`;
              else if (myRole === 'knight') actionMsg = `騎士チームは${targetName}を護衛しました。`;
              else if (myRole === 'trapper') actionMsg = `罠師チームは${targetName}を護衛しました。`;
              
              let newLogs = [];
              if (actionMsg) {
                  newLogs.push({ 
                      text: actionMsg, 
                      phase: `夜の行動`, 
                      day: room.day, 
                      secret: true, 
                      visibleTo: teamIds 
                  });
              }

              // 占い・賢者の結果生成（チームアクションとして実行された場合）
              if (myRole === 'seer' || myRole === 'sage') {
                  const targetDoc = await t.get(roomRef.collection('players').doc(targetId));
                  const targetSecret = await t.get(roomRef.collection('players').doc(targetId).collection('secret').doc('roleData'));
                  
                  if (targetDoc.exists && targetSecret.exists) {
                        const tgtName = targetDoc.data().name;
                        const tgtRole = targetSecret.data().role;
                        const resultCards = [];
                        
                        if (myRole === 'seer') {
                            const isWolf = tgtRole === 'werewolf'; 
                            const resText = isWolf ? "人狼" : "人狼ではない";
                            const icon = isWolf ? "Moon" : "Sun";
                            resultCards.push({ label: "占い結果", value: resText, sub: tgtName, isBad: isWolf, icon: icon });
                            newLogs.push({ text: `占い師チームに、「${tgtName}は${resText}」との占い結果を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
                        } else if (myRole === 'sage') {
                            resultCards.push({ label: "賢者結果", value: ROLE_NAMES[tgtRole], sub: tgtName, isBad: false, icon: "Eye" });
                            newLogs.push({ text: `賢者チームに、「${tgtName}の正確な役職は${ROLE_NAMES[tgtRole]}」との情報を提供しました。`, phase: `夜の行動`, day: room.day, secret: true, visibleTo: teamIds });
                        }
                        t.set(roomRef.collection('players').doc(leaderId).collection('secret').doc('actionResult'), { day: room.day, cards: resultCards }, { merge: true });
                  }
              }

              if (newLogs.length > 0) {
                  t.update(roomRef, { logs: admin.firestore.FieldValue.arrayUnion(...newLogs) });
              }

              // 確定したのでペンディング状態を削除
              t.update(roomRef, { [pendingKey]: admin.firestore.FieldValue.delete() });

              if (!room.nightActions) room.nightActions = {};
              room.nightActions[leaderId] = actionData;
              await checkNightCompletion(t, roomRef, room, players);

          } else {
              // まだ全員の同意が得られていない場合
              const approvalPath = `pendingActions.${teamKey}.approvals`;
              t.update(roomRef, { [approvalPath]: newApprovals });
          }
        }
      } else {
        // 拒否された場合、提案を取り下げ
        t.update(roomRef, { [pendingKey]: admin.firestore.FieldValue.delete() });
      }
    }
  });
  return { success: true };
});

// 「準備完了」トグルボタンの処理
// 全員が準備完了すると時間をスキップして次のフェーズへ
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
      // 議論時間中のみ時短機能が有効
      const shouldCheckAdvance = isReady && room.phase.startsWith('day');
      if (!shouldCheckAdvance) { t.update(playerRef, { isReady: isReady }); return; }
      
      const pSnap = await t.get(roomRef.collection('players'));
      const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
      
      let secretSnaps = [];
      if (secretRefs.length > 0) {
          secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
      }
      
      const players = pSnap.docs.map((d, i) => {
          const pData = { id: d.id, ...d.data() }; 
          if (secretSnaps[i] && secretSnaps[i].exists) {
              const sData = secretSnaps[i].data();
              pData.role = sData.role;
              pData.elderShield = sData.elderShield;
          }
          return pData;
      });
      const me = players.find(p => p.id === uid); if (me) me.isReady = true;
      const alive = players.filter(p => p.status === 'alive');
      const allReady = alive.every(p => p.isReady);
      
      // 全員準備完了なら強制遷移
      if (allReady) { await applyPhaseChange(t, roomRef, room, players); } else { t.update(playerRef, { isReady: isReady }); }
  });
  return { success: true };
});

// 定期実行などで呼ばれるフェーズ進行チェック
// 時間経過を確認してフェーズを進める
exports.advancePhase = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  await db.runTransaction(async (t) => {
     const rSnap = await t.get(roomRef);
     if (!rSnap.exists) throw new HttpsError('not-found', 'Room not found');
     const room = rSnap.data();
     const now = Date.now();
     
     // 経過時間の計算
     const startTime = room.phaseStartTime && typeof room.phaseStartTime.toMillis === 'function' ? room.phaseStartTime.toMillis() : 0;
     const elapsed = (now - startTime) / 1000;
     let duration = 9999;
     
     // フェーズごとの制限時間を取得
     if (room.phase.startsWith('day')) duration = TIME_LIMITS.DISCUSSION;
     else if (room.phase === 'voting') duration = TIME_LIMITS.VOTING;
     else if (room.phase.startsWith('announcement')) duration = TIME_LIMITS.ANNOUNCEMENT;
     else if (room.phase === 'countdown') duration = TIME_LIMITS.COUNTDOWN;
     else if (room.phase === 'role_reveal') duration = TIME_LIMITS.ROLE_REVEAL;
     else if (room.phase.startsWith('night')) duration = TIME_LIMITS.NIGHT;
     
     // タイムアップ判定（少し余裕を持たせる）
     const isTimeUp = elapsed >= duration - 2; 
     const isNightForce = room.phase.startsWith('night') && isTimeUp;
     
     // 夜の時短終了判定
     const isNightAllDone = room.nightAllDoneTime && typeof room.nightAllDoneTime.toMillis === 'function' && now >= room.nightAllDoneTime.toMillis();

     if (!isTimeUp && !isNightForce && !isNightAllDone) return;
     
     const pSnap = await t.get(roomRef.collection('players'));
     const secretRefs = pSnap.docs.map(d => d.ref.collection('secret').doc('roleData'));
     
     let secretSnaps = [];
     if (secretRefs.length > 0) {
         secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
     }
     
     const players = pSnap.docs.map((d, i) => {
          const pData = { id: d.id, ...d.data() };
          if (secretSnaps[i] && secretSnaps[i].exists) {
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

// 投票アクション（昼の処刑投票）
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
    
    let secretSnaps = [];
    if (secretRefs.length > 0) {
        secretSnaps = await Promise.all(secretRefs.map(ref => t.get(ref)));
    }
    
    const players = pSnap.docs.map((d, i) => {
        const p = { id: d.id, ...d.data() };
        if(secretSnaps[i] && secretSnaps[i].exists) p.role = secretSnaps[i].data().role;
        return p;
    });
    const aliveIds = players.filter(p => p.status === 'alive').map(p => p.id);
    const vSnap = await t.get(roomRef.collection('votes'));
    const votes = vSnap.docs.map(d => d.data());
    
    // 投票データの書き込み（上書き可能）
    const voteRef = roomRef.collection('votes').doc(uid);
    t.set(voteRef, { target: targetId, voterId: uid });
    
    // 全員投票済みかチェック
    const otherVotes = votes.filter(v => v.voterId !== uid);
    otherVotes.push({ target: targetId, voterId: uid });
    const votedIds = new Set(otherVotes.map(v => v.voterId));
    const allVoted = aliveIds.every(id => votedIds.has(id));
    
    // 全員投票したら即開票へ
    if (allVoted) {
        room.votes = otherVotes;
        await applyPhaseChange(t, roomRef, room, players);
    }
  });
  return { success: true };
});

// ホスト権限の移譲
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

// ゲーム終了後、ロビーに戻して再戦するためのリセット処理
exports.resetToLobby = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  const batch = db.batch();
  
  // 不要なコレクション（チャット、投票など）の削除
  const chatSnap = await roomRef.collection('chat').get();
  const teamChatSnap = await roomRef.collection('teamChats').get();
  const graveChatSnap = await roomRef.collection('graveChat').get();
  const voteSnap = await roomRef.collection('votes').get();
  const playerSnap = await roomRef.collection('players').get();
  chatSnap.docs.forEach(d => batch.delete(d.ref));
  teamChatSnap.docs.forEach(d => batch.delete(d.ref));
  graveChatSnap.docs.forEach(d => batch.delete(d.ref));
  voteSnap.docs.forEach(d => batch.delete(d.ref));
  
  // プレイヤー状態のリセット
  playerSnap.docs.forEach(d => {
      batch.update(d.ref, { 
          status: 'alive', isReady: false, deathReason: admin.firestore.FieldValue.delete(), diedDay: admin.firestore.FieldValue.delete(), lastTarget: admin.firestore.FieldValue.delete()
      });
      batch.delete(d.ref.collection('secret').doc('roleData'));
      batch.delete(d.ref.collection('secret').doc('actionResult'));
  });
  
  // ルーム情報の初期化
  batch.update(roomRef, {
      status: 'waiting', phase: 'lobby', day: 1, logs: [], winner: admin.firestore.FieldValue.delete(), nightActions: admin.firestore.FieldValue.delete(), nightLeaders: admin.firestore.FieldValue.delete(), pendingActions: admin.firestore.FieldValue.delete(), awakeningEvents: admin.firestore.FieldValue.delete(), nightAllDoneTime: admin.firestore.FieldValue.delete(), executionResult: admin.firestore.FieldValue.delete(), deathResult: admin.firestore.FieldValue.delete(), voteSummary: admin.firestore.FieldValue.delete(), phaseStartTime: admin.firestore.FieldValue.serverTimestamp()
  });
  await batch.commit();
  return { success: true };
});

// ゲーム開始処理（ロビーからカウントダウンへ）
exports.startGame = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', '認証が必要です');
  const { roomCode } = request.data;
  const roomRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('rooms').doc(roomCode);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) throw new HttpsError('not-found', '部屋なし');
  
  // 参加プレイヤーの取得（幽霊データの排除）
  const playersSnap = await roomRef.collection('players').get();
  const players = playersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (players.length < 4) throw new HttpsError('failed-precondition', 'プレイ人数が不足しています。最低4人必要です。');
  
  // 役職設定に基づく役職リストの生成
  const roleSettings = roomSnap.data().roleSettings || {};
  let roles = [];
  let wolfCount = 0;
  let humanCount = 0;
  Object.entries(roleSettings).forEach(([r, c]) => { 
      for(let i=0; i<c; i++) { roles.push(r); if (['werewolf', 'greatwolf'].includes(r)) wolfCount++; else humanCount++; } 
  });
  
  // 人数チェックとゲーム成立判定
  if (roles.length !== players.length) throw new HttpsError('invalid-argument', '人数と役職数が一致しません');
  if (wolfCount === 0) throw new HttpsError('failed-precondition', '人狼がいません。ゲームを開始できません。');
  if (wolfCount >= humanCount) throw new HttpsError('failed-precondition', '人狼が過半数を超えています。開始時点で人狼の勝利となります。');
  
  // 役職のシャッフルと割り当て
  roles = shuffle(roles);
  const batch = db.batch();
  const assignments = players.map((p, i) => ({ id: p.id, role: roles[i], name: p.name }));
  
  assignments.forEach(p => {
    if (!p.role) {
        console.error("Role assignment error:", p);
        return;
    }

    // 仲間の把握（人狼同士、共有者など）
    let mates = [];
    if(['werewolf', 'greatwolf'].includes(p.role)) { mates = assignments.filter(a => ['werewolf', 'greatwolf'].includes(a.role) && a.id !== p.id); } 
    else if(p.role === 'madman') { mates = assignments.filter(a => ['werewolf', 'greatwolf', 'madman'].includes(a.role) && a.id !== p.id); } 
    else if(['seer', 'medium', 'knight', 'trapper', 'sage', 'detective', 'killer', 'fox'].includes(p.role)) { mates = assignments.filter(a => a.role === p.role && a.id !== p.id); }
    
    // 役職データをシークレットサブコレクションに保存（カンニング防止）
    const secretRef = roomRef.collection('players').doc(p.id).collection('secret').doc('roleData');
    batch.set(secretRef, { role: p.role, teammates: mates, originalRole: p.role, elderShield: p.role === 'elder' });
    batch.update(roomRef.collection('players').doc(p.id), { isReady: false, status: 'alive', deathReason: admin.firestore.FieldValue.delete(), diedDay: admin.firestore.FieldValue.delete() });
  });

  // ルームステータスをプレイ中に更新
  // phaseStartTimeにはServerTimestampではなく確定時刻を使用してクライアントの計算ズレを防ぐ
  batch.update(roomRef, {
    status: 'playing', 
    phase: 'countdown', 
    phaseStartTime: admin.firestore.Timestamp.now(), 
    day: 1, 
    logs: [{ text: "ゲームが開始されました。", phase: "System", day: 1 }], 
    nightActions: {}, 
    nightLeaders: {}, 
    pendingActions: {}, 
    awakeningEvents: [], 
    winner: admin.firestore.FieldValue.delete(), 
    nightAllDoneTime: admin.firestore.FieldValue.delete(), 
    executionResult: admin.firestore.FieldValue.delete(), 
    deathResult: admin.firestore.FieldValue.delete(), 
    voteSummary: admin.firestore.FieldValue.delete()
  });
  
  await batch.commit();
  return { success: true };
});