import { User, Eye, Ghost, Shield, Swords, Skull, Search, Moon, Sun, Crosshair, Smile } from 'lucide-react';

// APIキー管理方針
// クライアントコードには含めず、Firestore 'system/settings' から動的取得

// フェーズ制限時間設定 (単位: 秒)
// サーバー設定と同期必須 (基本はサーバー値優先で動作)
export const TIME_LIMITS = {
  DISCUSSION: 240, // 議論フェーズ
  VOTING: 20,      // 投票フェーズ
  NIGHT: 999,      // 夜フェーズ (アクション待ちのため長めに設定)
  ANNOUNCEMENT: 10, // 結果発表
  COUNTDOWN: 5,    // 開始カウントダウン
  ROLE_REVEAL: 3,  // 役職表示 (テンポ重視で短縮)
};

// タイムアウト・演出待機時間設定 (単位: ms)
export const HEARTBEAT_INTERVAL_MS = 5000; // 生存確認ポーリング間隔
export const OFFLINE_TIMEOUT_MS = 30000;   // 切断判定閾値 (最終更新からの経過時間)
export const NIGHT_END_DELAY_MS = 10000;   // 夜明け前の待機時間
export const NOTIFICATION_DURATION = 2000; // 通知トースト表示時間
export const OVERLAY_DURATION_NORMAL = 4000; // 通常フェーズ遷移演出
export const OVERLAY_DURATION_LONG = 8000;   // 特殊演出 (ゲーム終了等)

// 役職マスタ定義
// 構造: キー(内部ID) -> { name: 表示名, team: 陣営, desc: 説明, icon: アイコン }
// 依存箇所: RoleCounter 等のコンポーネント (追加時はそちらも修正必要)
export const ROLE_DEFINITIONS = {
  // 市民陣営
  citizen: { name: "市民", team: "citizen", desc: "特殊能力はありません。推理と議論で人狼を探します。", icon: User },
  seer: { name: "占い師", team: "citizen", desc: "毎晩1人を占い、「人狼」か「人狼ではない」かを知ることができます。", icon: Eye },
  medium: { name: "霊媒師", team: "citizen", desc: "昼に処刑された人が、「人狼だった」か「人狼ではなかった」かを知ることができます。", icon: Ghost },
  knight: { name: "騎士", team: "citizen", desc: "毎晩1人を人狼の襲撃から守ります。2夜連続同じ人を守る事はできません。", icon: Shield },
  trapper: { name: "罠師", team: "citizen", desc: "騎士の能力に加え、護衛した先が襲撃されると、襲撃してきた人狼を返り討ちにして死亡させます。", icon: Swords },
  sage: { name: "賢者", team: "citizen", desc: "毎晩1人を占い、その人の正確な役職名を知ることができます。", icon: Eye },
  killer: { name: "人狼キラー", team: "citizen", desc: "人狼に襲撃されると死亡しますが、襲撃してきた人狼1人を道連れにします。", icon: Skull },
  detective: { name: "名探偵", team: "citizen", desc: "誰かが死亡した日の夜に、その死因や正体に関する情報を知ることができます。", icon: Search },
  cursed: { name: "呪われし者", team: "citizen", desc: "最初は市民ですが、人狼に襲撃されると死亡せず、人狼に覚醒します。", icon: User },
  elder: { name: "長老", team: "citizen", desc: "人狼の襲撃を1度だけ耐えることができます。", icon: User },
  assassin: { name: "ももすけ", team: "citizen", desc: "夜に一度だけ、護衛をも貫通して1人の存在意義を抹消する（暗殺する）ことができます。", icon: Crosshair },
  
  // 人狼陣営
  werewolf: { name: "人狼", team: "werewolf", desc: "夜に仲間と相談して市民1人を襲撃します。", icon: Moon },
  greatwolf: { name: "大狼", team: "werewolf", desc: "占われても「人狼でない」と判定される、強力な人狼です。", icon: Moon },
  wise_wolf: { name: "賢狼", team: "werewolf", desc: "生存している間、襲撃先のプレイヤーの正確な役職を人狼チームに提供する人狼です。", icon: Moon },
  madman: { name: "狂人", team: "werewolf", desc: "人狼の味方をする市民です。嘘をついて場を混乱させます。", icon: User },
  
  // 第3陣営
  fox: { name: "妖狐", team: "third", desc: "人狼に襲撃されても死にませんが、占われると呪い殺されます。最後まで生き残れば単独勝利です。", icon: Sun },
  teruteru: { name: "てるてる坊主", team: "third", desc: "昼の投票で処刑されると、最終的な勝利陣営に加え追加で勝利となります。", icon: Smile },
};