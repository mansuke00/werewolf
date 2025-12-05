// ユーティリティ関数ファイル
// 純粋な計算や判定ロジックをここにまとめます

const { ROLE_NAMES } = require('./constants');

// 配列をシャッフルする
const shuffle = (arr) => {
  const n = [...arr];
  for (let i = n.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [n[i], n[j]] = [n[j], n[i]];
  }
  return n;
};

// 6桁のランダムなマッチIDを生成する
const generateMatchId = () => {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// 勝敗判定を行う
const checkWin = (players, deadIds, room) => {
  if (!players) return null;
  const live = players.filter(p => p && !deadIds.includes(p.id) && p.status !== 'vanished');
  const validPlayers = live.filter(p => p.role);
  
  const wolves = validPlayers.filter(p => ['werewolf', 'greatwolf', 'wise_wolf'].includes(p.role)).length;
  const humans = validPlayers.filter(p => !['werewolf', 'greatwolf', 'wise_wolf', 'fox', 'teruteru'].includes(p.role)).length; // 妖狐・てるてるはカウント外
  const fox = validPlayers.some(p => p.role === 'fox');

  // てるてる坊主勝利判定（追加勝利）は別途 room.teruteruWon で管理するが、
  // ここではメインの勝敗（ゲーム終了条件）を返す
  
  // 妖狐が生存していれば、人狼全滅などの条件に関わらず妖狐勝利
  if (fox) return 'fox';
  
  if (wolves === 0) return 'citizen';
  if (wolves >= humans) return 'werewolf';
  return null;
};

// 各役職・チームのリーダー（代表者）を選出する
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

// 指定した役職（またはチーム）のメンバーIDを取得する
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

module.exports = {
  shuffle,
  generateMatchId,
  checkWin,
  electLeaders,
  getTeamMemberIds
};