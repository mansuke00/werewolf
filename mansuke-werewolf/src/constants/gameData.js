import { User, Eye, Ghost, Shield, Swords, Skull, Search, Moon, Sun, Crosshair, Smile } from 'lucide-react';

// APIキーはセキュリティリスクを避けるため、ここでは定義せずFirestoreの'system/settings'から取得する設計

// 各フェーズの持続時間設定（秒）
// サーバー側の設定と一致させる必要があるが、基本的にはサーバーからのデータが優先される
export const TIME_LIMITS = {
  DISCUSSION: 240,
  VOTING: 20,
  NIGHT: 999, // 夜はアクション待ちなのでクライアント側では長めに設定
  ANNOUNCEMENT: 10,
  COUNTDOWN: 5,
  ROLE_REVEAL: 3, // 演出を短くしてテンポを改善
};

// 各種タイムアウト値の設定
export const HEARTBEAT_INTERVAL_MS = 5000; // 生存確認の頻度
export const OFFLINE_TIMEOUT_MS = 30000;   // この時間を超えて更新がないと切断扱い
export const NIGHT_END_DELAY_MS = 10000;
export const NOTIFICATION_DURATION = 2000;
export const OVERLAY_DURATION_NORMAL = 4000;
export const OVERLAY_DURATION_LONG = 8000;

// 役職の定義マスタ
// 新しい役職を追加する場合はここに定義を追加し、RoleCounter等も修正すること
export const ROLE_DEFINITIONS = {
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
  werewolf: { name: "人狼", team: "werewolf", desc: "夜に仲間と相談して市民1人を襲撃します。", icon: Moon },
  greatwolf: { name: "大狼", team: "werewolf", desc: "占われても「人狼でない」と判定される、強力な人狼です。", icon: Moon },
  wise_wolf: { name: "賢狼", team: "werewolf", desc: "賢狼が生存している間、襲撃先のプレイヤーの正確な役職を人狼チームに提供する人狼です。", icon: Moon },
  madman: { name: "狂人", team: "werewolf", desc: "人狼の味方をする市民です。嘘をついて場を混乱させます。", icon: User },
  fox: { name: "妖狐", team: "third", desc: "人狼に襲撃されても死にませんが、占われると呪い殺されます。最後まで生き残れば単独勝利です。", icon: Sun },
  teruteru: { name: "てるてる坊主", team: "third", desc: "昼の投票で処刑されると、最終的な勝利陣営に加え追加で勝利となります。", icon: Smile },
};