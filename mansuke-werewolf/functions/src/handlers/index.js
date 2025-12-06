// ハンドラーのまとめファイル

// 部屋関連の処理（作成、参加、退出など）を読み込み
// ファイルパスは環境に合わせて調整が必要
const room = require('./room');

// ゲーム進行関連の処理（開始、フェーズ進行など）を読み込み
const game = require('./game');

// アクション関連の処理（投票、夜の能力使用など）を読み込み
const action = require('./action');

// システム関連の処理（定期実行、管理機能など）を読み込み
const system = require('./system');

// 全てのハンドラー関数をまとめてエクスポート
// Cloud Functionsではここから各関数がデプロイされる想定
module.exports = {
    // スプレッド構文 (...) でオブジェクトを展開して結合
    ...room,
    ...game,
    ...action,
    ...system
};