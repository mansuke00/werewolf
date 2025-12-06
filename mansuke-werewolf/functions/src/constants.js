// 定数定義ファイル

// 各フェーズの制限時間設定（単位：秒）
exports.TIME_LIMITS = {
  DISCUSSION: 240,    // 昼の議論時間（デフォルト）
  VOTING: 20,         // 投票時間
  NIGHT: 86400,       // 夜のアクション時間（24時間）
  ANNOUNCEMENT: 10,   // 結果発表などの表示時間
  COUNTDOWN: 5,       // ゲーム開始前のカウントダウン
  ROLE_REVEAL: 3,     // 役職確認画面の表示時間
};

// 役職IDと日本語表示名のマッピング
// UI表示やログ出力で使用
exports.ROLE_NAMES = {
  // 市民陣営
  citizen: "市民", 
  seer: "占い師", 
  medium: "霊媒師", 
  knight: "騎士",
  trapper: "罠師", 
  sage: "賢者", 
  killer: "人狼キラー", 
  detective: "名探偵",
  cursed: "呪われし者", 
  elder: "長老", 
  assassin: "ももすけ",
  
  // 人狼陣営
  werewolf: "人狼", 
  greatwolf: "大狼", 
  wise_wolf: "賢狼", 
  madman: "狂人", 
  
  // その他の陣営
  fox: "妖狐", 
  teruteru: "てるてる坊主"
};