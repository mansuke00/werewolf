// フェーズ進行や夜のアクション処理など、DB操作を伴うロジックをここにまとめた
// 結構むずいから編集する時は相談してね by Nobuyama

const admin = require("firebase-admin");
// adminが初期化されていればインスタンスを取得できます
const db = admin.firestore();

// 定数とユーティリティ関数の読み込み
const { ROLE_NAMES } = require('./constants');
const { checkWin, electLeaders, getTeamMemberIds } = require('./utils');

// ★追加: ゲームデータのアーカイブ処理
// ゲーム終了時や強制終了時に、そのゲームの結果やログを履歴用コレクションに保存します
const archiveGame = async (t, roomRef, roomData, players, endStatus, winner = null) => {
    // 必須データのチェック（試合IDがない場合は保存しない）
    if (!roomData.matchId) return;

    // 保存先を match_history コレクションに変更
    const historyRef = db.collection('artifacts').doc('mansuke-jinro').collection('public').doc('data').collection('match_history').doc(roomData.matchId);
    
    // チャット履歴の取得 (全体チャットとチームチャット)
    // サーバーサイドで取得してアーカイブデータに含める
    const chatSnap = await roomRef.collection('chat').get();
    const teamChatSnap = await roomRef.collection('teamChats').get();
    
    // ★修正: データを整形して取得。Timestampは数値(ミリ秒)に変換しておく
    const formatMessage = (doc) => {
        const data = doc.data();
        let createdAtMillis = 0;
        
        // Timestamp型の処理
        if (data.createdAt && typeof data.createdAt.toMillis === 'function') {
            createdAtMillis = data.createdAt.toMillis();
        } else if (data.createdAt instanceof Date) {
            createdAtMillis = data.createdAt.getTime();
        } else if (typeof data.createdAt === 'number') {
            createdAtMillis = data.createdAt;
        }

        return {
            id: doc.id,
            text: data.text || "",
            senderId: data.senderId || "unknown",
            senderName: data.senderName || "不明",
            day: data.day !== undefined ? data.day : 1,
            type: data.type || 'normal', // normal, werewolf, grave etc
            createdAt: createdAtMillis
        };
    };

    const chatMessages = chatSnap.docs.map(formatMessage);
    const teamMessages = teamChatSnap.docs.map(formatMessage);
    
    // 全てのメッセージを統合
    const allMessages = [...chatMessages, ...teamMessages];
    
    // ★追加: 時系列順にソート（数値比較なので確実）
    allMessages.sort((a, b) => a.createdAt - b.createdAt);

    // アーカイブするデータを作成
    const archiveData = {
        matchId: roomData.matchId,
        roomCode: roomRef.id,
        hostId: roomData.hostId,
        hostName: roomData.hostName,
        status: endStatus, // 'finished', 'aborted' など
        winner: winner || roomData.winner || null,
        teruteruWon: roomData.teruteruWon || false, // てるてる勝利フラグ
        roleSettings: roomData.roleSettings || {},
        logs: roomData.logs || [],
        // 役職情報を持ったプレイヤー情報を保存
        // 個人情報や不要なフィールドは除外して整形
        players: players.map(p => ({
            id: p.id,
            name: p.name,
            role: p.role || 'unknown',
            originalRole: p.originalRole || p.role || 'unknown', // 変化前の役職っぽい
            status: p.status,
            deathReason: p.deathReason || null,
            diedDay: p.diedDay || null,
            isSpectator: p.isSpectator || false,
            isDev: p.isDev || false
        })),
        // チャットメッセージを保存
        // 無料枠やドキュメントサイズ制限への懸念はあるが、履歴閲覧のため保存する
        chatMessages: allMessages, 
        createdAt: roomData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        startedAt: roomData.phaseStartTime || null,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        // 対面モードの設定なども保存
        inPersonMode: roomData.inPersonMode || false
    };

    // 履歴データの書き込み
    t.set(historyRef, archiveData);

    // ★追加: 元の部屋データに「有効期限（削除予定時刻）」を設定
    // ゲーム終了から24時間後に削除対象とする
    // これにより、リザルト画面閲覧の猶予を持たせつつ、古い部屋データが確実に掃除されるようにする
    // ※FirestoreのTTL(Time-to-Live)機能で expireAt フィールドを指定すると自動削除されます
    const expireDate = new Date();
    expireDate.setHours(expireDate.getHours() + 24);
    
    t.update(roomRef, { 
        expireAt: admin.firestore.Timestamp.fromDate(expireDate),
        isArchived: true // アーカイブ済みフラグ
    });
};

// フェーズ変更を適用
// 現在のフェーズを見て、次のフェーズへ移行するためのDB更新を行う
const applyPhaseChange = async (t, roomRef, room, players) => {
    let next = "", logs = [], updates = {}, batchOps = [];

    // カウントダウン終了 → 役職確認
    if (room.phase === 'countdown') {
        next = 'role_reveal';
    } 
    // 役職確認終了 → 1日目開始
    else if (room.phase === 'role_reveal') {
      next = 'day_1';
      logs.push({ text: "1日目の朝になりました。", phase: "1日目 - 昼", day: 1 });
      updates.day = 1;
      // 夜アクション用データの初期化
      updates.nightActions = {};
      updates.pendingActions = {};
      updates.nightLeaders = {};
    } 
    // 1日目昼終了 → 1日目夜（1日目は投票なし）
    else if (room.phase === 'day_1') {
      next = 'night_1';
      logs.push({ text: "1日目は投票がありません。", phase: "1日目 - 終了", day: 1 });
      
      // リーダーシステム
      const leaders = electLeaders(players);
      updates.nightLeaders = leaders;
      
      // プレイヤーのReady状態リセット
      players.forEach(p => batchOps.push({ ref: roomRef.collection('players').doc(p.id), data: { isReady: false } }));
      
      // 初日の夜、名探偵と霊媒師には「情報なし」カードを配る
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
    } 
    // 2日目以降の昼終了 → 投票フェーズ
    else if (room.phase.startsWith('day')) {
      next = 'voting';
      // 前日の投票データを消す
      const voteDocs = await t.get(roomRef.collection('votes'));
      voteDocs.docs.forEach(d => t.delete(d.ref));
      updates.votes = []; 
      players.forEach(p => batchOps.push({ ref: roomRef.collection('players').doc(p.id), data: { isReady: false } }));
      // 覚醒イベントフラグのクリア
      updates.awakeningEvents = admin.firestore.FieldValue.delete();
    } 
    // 投票フェーズ終了 → 集計・処刑判定 → 夜or終了
    else if (room.phase === 'voting') {
      const votes = room.votes || [];
      const summaryMap = {};
      const voteResultLines = [];
      const voteDetailLines = [];
      const anonymous = room.anonymousVoting;

      // 生存者IDリストを作成し、死者の票（バグやラグで入った場合）を除外する
      const aliveVoterIds = players.filter(p => p.status === 'alive').map(p => p.id);

      // 投票集計
      votes.forEach(v => {
          if (!aliveVoterIds.includes(v.voterId)) return;

          if (!summaryMap[v.target]) summaryMap[v.target] = { targetId: v.target, count: 0, voters: [] };
          summaryMap[v.target].count++;
          summaryMap[v.target].voters.push(v.voterId);
      });
      
      // 得票数順にソート
      const voteSummary = Object.values(summaryMap).sort((a, b) => b.count - a.count);
      updates.voteSummary = voteSummary;

      // 結果表示用文字列の生成
      voteSummary.forEach(item => {
          const tName = item.targetId === 'skip' ? "スキップ" : (players.find(p => p.id === item.targetId)?.name || "不明");
          voteResultLines.push(`${tName}に${item.count}票`);
          // 誰が誰に入れたかの内訳（匿名設定でない場合）
          if (!anonymous && item.voters) {
              item.voters.forEach(vid => {
                  const vName = players.find(p => p.id === vid)?.name || "不明";
                  voteDetailLines.push(`${vName}は${tName}に投票`);
              });
          }
      });

      if (voteDetailLines.length > 0) logs.push({ text: `＜各プレイヤーの投票先＞\n${voteDetailLines.join('\n')}`, phase: `${room.day}日目 - 投票`, day: room.day });
      logs.push({ text: `＜開票結果＞\n${voteResultLines.join('\n')}`, phase: `${room.day}日目 - 投票`, day: room.day });

      // 処刑判定ロジック
      const validVotes = votes.filter(v => aliveVoterIds.includes(v.voterId));
      const counts = {};
      validVotes.forEach(v => counts[v.target] = (counts[v.target] || 0) + 1);
      
      let max = 0, execId = null;
      // 最多得票者を特定。同数の場合はnullで返す
      Object.entries(counts).forEach(([id, c]) => { if (c > max) { max = c; execId = id; } else if (c === max) execId = null; });

      let execResult = "同数投票、またはスキップ多数のため、処刑は行いません。";
      let hasExecuted = false;
      const executedPlayers = []; 

      if (execId && execId !== 'skip') {
        const victim = players.find(p => p.id === execId);
        execResult = `投票により、${victim.name}が処刑されました。`;
        hasExecuted = true;
        executedPlayers.push(victim);
        // 死亡処理
        batchOps.push({ ref: roomRef.collection('players').doc(execId), data: { status: 'dead', deathReason: '投票による処刑', diedDay: room.day } });
      }
      
      logs.push({ text: execResult, phase: `${room.day}日目 - 投票`, day: room.day });
      updates.executionResult = execResult;

      // てるてる坊主の勝利判定（処刑されたら勝ち）
      if (hasExecuted) {
          // 処刑されたプレイヤーの状態を一時的に反映して判定
          const updatedPlayers = players.map(p => {
              if (p.id === execId) return { ...p, status: 'dead', deathReason: '投票による処刑' };
              return p;
          });
          const teruteruPlayers = updatedPlayers.filter(p => p.role === 'teruteru');
          if (teruteruPlayers.length > 0) {
              // 全てのてるてるが処刑されていれば勝利（通常1人だが複数対応）
              const allExecuted = teruteruPlayers.every(p => p.status === 'dead' && p.deathReason === '投票による処刑');
              if (allExecuted) {
                  updates.teruteruWon = true; // 勝利フラグON。ゲームは続く
              }
          }
      }
    
      // 霊媒師への結果通知処理
      const mediums = players.filter(p => p.role === 'medium' && p.status === 'alive');
      if (mediums.length > 0) {
          let mediumCards = [];
          if (executedPlayers.length > 0) {
              // 処刑された人の霊媒結果生成
              mediumCards = executedPlayers.map(victim => {
                  const isWolf = ['werewolf', 'greatwolf', 'wise_wolf'].includes(victim.role);
                  const res = isWolf ? "人狼だった" : "人狼ではなかった";
                  return { label: "霊媒結果", value: res, sub: victim.name, isBad: isWolf, icon: "Ghost" };
              });
              // ログにも出す（霊媒師のみ見える）
              executedPlayers.forEach(victim => {
                  const isWolf = ['werewolf', 'greatwolf', 'wise_wolf'].includes(victim.role);
                  const res = isWolf ? "人狼だった" : "人狼ではなかった";
                  logs.push({ text: `霊媒師チームに、「${victim.name}は${res}」との情報を提供しました。`, phase: `${room.day}日目 - 夜`, day: room.day, secret: true, visibleTo: mediums.map(m=>m.id) });
              });
          } else {
              // 処刑なしの場合
              mediumCards = [{ label: "霊媒", value: "今夜提供できる情報はありません", sub: "", isBad: false, icon: "Info" }];
          }
          // カード配布
          mediums.forEach(p => {
              batchOps.push({ ref: roomRef.collection('players').doc(p.id).collection('secret').doc('actionResult'), data: { day: room.day, cards: mediumCards }, merge: true });
          });
      }

      // 勝敗判定
      const deadIds = players.filter(p => p.status === 'dead' || p.status === 'vanished').map(p => p.id);
      if (hasExecuted) deadIds.push(execId);
      
      const winner = checkWin(players, deadIds);
      
      if (winner) { 
          // ゲーム終了
          updates.status = 'finished'; 
          updates.winner = winner; 
          next = null; 
          // 正常終了時にアーカイブに残す
          await archiveGame(t, roomRef, {...room, ...updates}, players, 'finished', winner);
      } else {
        // 夜へ続く
        next = `night_${room.day}`;
        // 夜のリーダー選出（再計算）
        const leaders = electLeaders(players.filter(p => !deadIds.includes(p.id)));
        updates.nightLeaders = leaders;
        
        // 名探偵への情報提供（前日の死因調査）
        const detectives = players.filter(p => p.role === 'detective' && p.status === 'alive');
        if (detectives.length > 0) {
            const targetDay = room.day - 1; // 昨晩の情報
            // 死因が「投票による処刑」または「ホストによる追放」は除外（夜の犠牲者のみ対象）
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
    } 
    // 夜フェーズ終了 → 朝（アクション結果反映）
    else if (room.phase.startsWith('night')) {
      const actions = room.nightActions || {};
      let logsSec = [], events = [];
      const deathReasonsMap = {}; // playerId -> Set of reasons (複合死因対応)

      const addReason = (pid, reason) => {
          if (!deathReasonsMap[pid]) deathReasonsMap[pid] = new Set();
          deathReasonsMap[pid].add(reason);
      };

      // 1. 護衛リストの作成（生死に関わらず有効とする仕様）
      const guards = Object.values(actions)
          .filter(a => ['knight', 'trapper'].includes(a.role) && a.targetId !== 'skip')
          .map(a => a.targetId);
      
      const trapperGuards = Object.values(actions)
          .filter(a => a.role === 'trapper' && a.targetId !== 'skip')
          .map(a => a.targetId);

      // 2. 攻撃アクションの整理
      let atkId = null, wolfId = null; // 人狼の襲撃先、実行者
      let assassinTargetId = null, assassinId = null; // 暗殺者の標的、実行者

      Object.values(actions).forEach(a => {
          if(['werewolf','greatwolf','wise_wolf'].includes(a.role)) { atkId = a.targetId; wolfId = a.actorId; }
          if(a.role === 'assassin' && a.targetId !== 'skip') { assassinTargetId = a.targetId; assassinId = a.actorId; }
      });

      // 3. 人狼の襲撃処理
      let wolfKilledByTrap = false;
      let wolfAttackSuccess = false;

      if (atkId && atkId !== 'skip') {
          const tgt = players.find(p => p.id === atkId);
          const r = tgt?.role;

          // 罠師による返り討ち判定（護衛先を襲うと人狼が死ぬ）
          if (trapperGuards.includes(atkId) && wolfId) {
              addReason(wolfId, "罠師による返り討ち");
              wolfKilledByTrap = true;
          } 
          
          // 護衛されていない場合のみ成功判定
          if (!guards.includes(atkId)) {
              if (r === 'fox') {
                  // 妖狐は襲撃無効
                  logsSec.push({ text: `人狼チームは${tgt.name}を襲撃しましたが、妖狐の能力により無効化されました。`, visibleTo: [], secret: true });
              } else if (r === 'elder' && tgt.elderShield) {
                  // 長老は1回耐える
                  batchOps.push({ ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), data: { elderShield: false }, merge: true });
                  logsSec.push({ text: `${tgt.name}は人狼により襲撃されましたが、長老の能力により生き延びました。`, visibleTo: [], secret: true });
              } else if (r === 'cursed') {
                  // 呪われし者は人狼に覚醒
                  batchOps.push({ ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), data: { role: 'werewolf', originalRole: 'cursed' }, merge: true });
                  events.push({ type: 'cursed', playerId: atkId });
                  
                  const wolves = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role)).map(p => p.id);
                  logsSec.push({ text: `${tgt.name}は人狼により襲撃されましたが、呪われし者の能力により人狼に覚醒しました。`, visibleTo: [...wolves, atkId], secret: true });
                  
                  // 人狼チームに変更があった際の仲間リスト更新
                  const wolfTeamMembers = players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf', 'madman'].includes(p.role));
                  const awakeningPlayer = { id: atkId, role: 'werewolf', name: tgt.name, originalRole: 'cursed' }; // Add originalRole
                  wolfTeamMembers.forEach(w => {
                      batchOps.push({ ref: roomRef.collection('players').doc(w.id).collection('secret').doc('roleData'), data: { teammates: admin.firestore.FieldValue.arrayUnion(awakeningPlayer) }, merge: true });
                  });
                  const newTeammates = wolfTeamMembers.map(w => ({ id: w.id, role: w.role, name: w.name }));
                  batchOps.push({ ref: roomRef.collection('players').doc(atkId).collection('secret').doc('roleData'), data: { teammates: newTeammates }, merge: true });
              } else {
                  // 通常死亡
                  addReason(atkId, "人狼による襲撃");
                  wolfAttackSuccess = true;
              }
          }
      }

      // 4. ももすけの存在意義抹消処理
      if (assassinTargetId && assassinId) {
          // 暗殺者が襲撃されている（かつ護衛されていない）場合、能力が無効
          let assassinInterrupted = false;
          if (atkId === assassinId && !guards.includes(assassinId)) {
              assassinInterrupted = true;
          }

          const assassinTeam = getTeamMemberIds(players, 'assassin');
          if (assassinInterrupted) {
              logsSec.push({ text: `ももすけは襲撃されたため、存在意義の抹消に失敗しました。`, visibleTo: assassinTeam, secret: true });
          } else {
              // 成功（護衛貫通で死亡）
              addReason(assassinTargetId, "存在意義抹消");
              const tgtName = players.find(p => p.id === assassinTargetId)?.name;
              if (guards.includes(assassinTargetId)) {
                  // 護衛されていたのに死んだ場合の特別ログ
                  logs.push({ text: `${tgtName}は護衛されていましたが、ももすけの能力により存在意義が消されてしまいました。`, visibleTo: [], secret: true, phase: "霊界ログ", day: room.day });
              }
              updates.assassinUsed = true; // 能力使用済みフラグON
          }
      }

      // 5. 占い呪殺（妖狐対策）
      Object.values(actions).forEach(a => {
        const tgt = players.find(p => p.id === a.targetId);
        // 占い師か賢者が妖狐を占うと、妖狐は死ぬ
        if ((a.role === 'seer' || a.role === 'sage') && tgt?.role === 'fox') { 
            addReason(a.targetId, "妖狐が占われたことによる呪死"); 
        }
      });

      // 6. 人狼キラーの発動判定
      if (wolfAttackSuccess && atkId && wolfId) {
          const reasons = deathReasonsMap[atkId];
          const tgt = players.find(p => p.id === atkId);
          // ターゲットが人狼キラーで、かつ人狼の襲撃が成功して死んだ場合
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
          // DB更新: ステータスdead
          batchOps.push({ ref: roomRef.collection('players').doc(id), data: { status: 'dead', deathReason: reasonStr, diedDay: room.day } });
      });
      
      // 朝のメッセージ作成
      const deadNames = players.filter(p => uniqDead.includes(p.id)).map(p => p.name);
      const mornMsg = deadNames.length > 0 ? `${deadNames.join('、')}が無惨な姿で発見されました。` : "昨晩は誰も死亡しませんでした...。";
      
      updates.deathResult = mornMsg;
      logs.push({ text: `${room.day+1}日目の朝になりました。\n${mornMsg}`, phase: `${room.day+1}日目 - 朝`, day: room.day+1 });
      logs.push(...logsSec); // 秘密ログなどの追加

      // 日付更新
      updates.day = room.day + 1;
      // 夜データクリア
      updates.nightActions = {}; updates.pendingActions = {}; updates.nightAllDoneTime = admin.firestore.FieldValue.delete();
      updates.forceNightEnd = admin.firestore.FieldValue.delete();
      if(events.length) updates.awakeningEvents = events;

      // 覚醒イベントがあった場合、勝敗判定用にメモリ上のプレイヤー役職を更新
      let checkPlayers = players;
      if (events.length > 0) {
          checkPlayers = players.map(p => {
              if (events.some(e => e.playerId === p.id)) return { ...p, role: 'werewolf' };
              return p;
          });
      }

      // 勝敗判定
      const allDead = [...players.filter(p=>p.status==='dead'||p.status==='vanished').map(p=>p.id), ...uniqDead];
      const winner = checkWin(checkPlayers, allDead);
      
      if (winner) { 
          updates.status = 'finished'; 
          updates.winner = winner; 
          next = null; 
          // ★追加: 終了時にアーカイブ
          await archiveGame(t, roomRef, {...room, ...updates}, checkPlayers, 'finished', winner);
      }
      else next = `announcement_${room.day+1}`; // 結果発表フェーズへ（朝の死亡者表示）
    } 
    // --- 結果発表フェーズ終了 → 昼フェーズ ---
    else if (room.phase.startsWith('announcement')) {
        next = `day_${room.day}`;
    }

    // 更新実行
    if (next !== "" || updates.status === 'finished') { 
        if (next) updates.phase = next; 
        updates.phaseStartTime = admin.firestore.Timestamp.now();
    }
    if (logs.length) updates.logs = admin.firestore.FieldValue.arrayUnion(...logs);
    
    if (Object.keys(updates).length > 0) t.update(roomRef, updates);
    batchOps.forEach(o => o.merge ? t.set(o.ref, o.data, {merge:true}) : t.update(o.ref, o.data));
};

// 全員の夜のアクションが完了したかチェックする
// 完了していれば早期終了タイマーをセットする
const checkNightCompletion = async (t, roomRef, room, players) => {
    if (!room || !players) return;
    const nightLeaders = room.nightLeaders || {};
    const nightActions = room.nightActions || {};

    const alive = players.filter(p => p.status === 'alive');
    const requiredKeys = [];

    // 人狼チームのアクション完了確認（リーダーが代表）
    const wolfTeam = alive.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role));
    if (wolfTeam.length > 0) {
        const leaderId = nightLeaders['werewolf_team'];
        if (leaderId) requiredKeys.push(leaderId);
    }
    // 暗殺者チームのアクション完了確認（能力未使用時のみ）
    const assassinTeam = alive.filter(p => p.role === 'assassin');
    if (assassinTeam.length > 0 && !room.assassinUsed) { 
        const leaderId = nightLeaders['assassin'];
        if (leaderId) requiredKeys.push(leaderId);
    }

    // 個人能力者の完了確認
    const soloRoles = ['seer', 'sage', 'knight', 'trapper'];
    alive.forEach(p => {
        if (soloRoles.includes(p.role)) requiredKeys.push(p.id);
    });

    // 全てのアクションキーが nightActions に存在するかチェック
    const allDone = requiredKeys.every(key => nightActions[key] !== undefined);

    // 全員完了かつ早期終了タイマーがセットされていない場合
    if (allDone && !room.nightAllDoneTime) {
         // 完了時刻を10秒後に設定
         const doneTime = admin.firestore.Timestamp.fromMillis(Date.now() + 10000); 
         t.update(roomRef, { nightAllDoneTime: doneTime });
    }
};

module.exports = {
  applyPhaseChange,
  checkNightCompletion,
  archiveGame 
};