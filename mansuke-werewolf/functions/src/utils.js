const { ROLE_NAMES } = require('./constants');

// 配列をシャッフルする関数（フィッシャー–イェーツのシャッフル）
// 役職の割り当てなどで使用
const shuffle = (arr) => {
  const n = [...arr];
  for (let i = n.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [n[i], n[j]] = [n[j], n[i]];
  }
  return n;
};

// 6桁のランダムなマッチIDを生成する
// URLパラメータや履歴のキーとして使用しやすい形式
const generateMatchId = () => {
  // 視認性の悪い文字（I, 1, O, 0 など）を除いた文字セット
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// 勝敗判定を行う関数
// 戻り値: 勝利チームのキー（'fox', 'citizen', 'werewolf'）または null（決着つかず）
const checkWin = (players, deadIds, room) => {
  if (!players) return null;
  
  // 生存しており、かつ消失（vanished）していないプレイヤーをカウント対象とする
  const live = players.filter(p => p && !deadIds.includes(p.id) && p.status !== 'vanished');
  // 役職が設定されている有効なプレイヤーのみ抽出
  const validPlayers = live.filter(p => p.role);
  
  // カウント計算
  // 賢狼(wise_wolf)なども人狼としてカウント
  const wolves = validPlayers.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role)).length;
  // 人狼系と妖狐、てるてるを除いた数を市民側カウントとする（狂人は人数比では市民側カウント）
  const humans = validPlayers.filter(p => !['werewolf', 'greatwolf', 'wise_wolf', 'fox', 'teruteru'].includes(p.role)).length; 
  // 妖狐の生存確認
  const fox = validPlayers.some(p => p.role === 'fox');

  // てるてる坊主勝利判定（追加勝利）は別途 room.teruteruWon で管理するが、
  // ここではメインの勝敗（ゲーム終了条件）を返す
  
  // まず、基本的なゲーム終了条件（人狼全滅 または 人狼が人間を上回る）を判定
  let primaryWinner = null;

  // 優先順位2: 市民勝利（人狼全滅）
  if (wolves === 0) {
    primaryWinner = 'citizen';
  }
  // 優先順位3: 人狼勝利（人狼の数が人間以上）
  // 狂人はhumansに含まれているため、純粋な人狼数 vs その他の人数で判定
  else if (wolves >= humans) {
    primaryWinner = 'werewolf';
  }
  
  // 勝敗が決した場合の処理
  if (primaryWinner) {
      // 優先順位1: 妖狐勝利
      // 妖狐が生存していれば、人狼全滅などの条件に関わらず妖狐勝利となる（人狼等の勝利を上書き）
      if (fox) return 'fox';
      
      return primaryWinner;
  }
  
  // 決着つかず
  return null;
};

// 各役職・チームのリーダー（代表者）を選出する関数
// 夜のアクションで、誰が代表して操作するか（またはランダムターゲット決定の主体）を決める
const electLeaders = (players) => {
  const leaders = {};
  const groups = {};
  const alivePlayers = players.filter(p => p.status === 'alive');

  // グルーピング
  alivePlayers.forEach(p => {
    const role = p.role;
    if (!role) return;
    
    // 人狼チーム（人狼、大狼、賢狼）はまとめて1つのリーダーを選出
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(role)) {
      if (!groups['werewolf_team']) groups['werewolf_team'] = [];
      groups['werewolf_team'].push(p.id);
    } 
    // 暗殺者チーム
    else if (role === 'assassin') {
        if (!groups['assassin']) groups['assassin'] = [];
        groups['assassin'].push(p.id);
    } 
    // てるてるチーム（基本1人だが複数対応）
    else if (role === 'teruteru') {
        if (!groups['teruteru']) groups['teruteru'] = [];
        groups['teruteru'].push(p.id);
    } 
    // その他の単独行動役職（占い師など）
    else if (['seer', 'sage', 'knight', 'trapper'].includes(role)) {
      if (!groups[role]) groups[role] = [];
      groups[role].push(p.id);
    }
  });

  // 各グループからランダムに1人選出
  Object.entries(groups).forEach(([key, ids]) => {
    if (ids.length > 0) {
      leaders[key] = ids[Math.floor(Math.random() * ids.length)];
    }
  });
  return leaders;
};

// 指定した役職（またはチーム）のメンバーIDを取得する関数
// ログの表示範囲（visibleTo）やチャットの参加者判定に使用
const getTeamMemberIds = (players, role) => {
    // 人狼チームの場合：人狼、大狼、賢狼、狂人を含む（狂人は襲撃ログやチャットが見える仕様）
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(role)) {
        return players.filter(p => ['werewolf', 'greatwolf', 'wise_wolf', 'madman'].includes(p.role)).map(p => p.id);
    }
    // ももすけ（暗殺者）、てるてる坊主などは同じ役職同士でチャット可能（複数人の場合）
    if (['assassin', 'teruteru'].includes(role)) {
        return players.filter(p => p.role === role).map(p => p.id);
    }
    // 基本は同役職のみ
    return players.filter(p => p.role === role).map(p => p.id);
};

module.exports = {
  shuffle,
  generateMatchId,
  checkWin,
  electLeaders,
  getTeamMemberIds
};