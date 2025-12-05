// ハンドラーのまとめファイル
// ここで各ファイルをrequireしてまとめてエクスポートします

const room = require('./room');
const game = require('./game');
const action = require('./action');
const system = require('./system');

module.exports = {
    ...room,
    ...game,
    ...action,
    ...system
};