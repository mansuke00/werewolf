import { Shield, Moon, Ghost, Search, Skull, Eye, Crosshair, Users, Zap, Swords, UserMinus, User, Heart, Crown, HelpCircle, Gift } from 'lucide-react';

// ハートビート更新間隔 (ms)
export const HEARTBEAT_INTERVAL_MS = 20000;

// オフライン判定のタイムアウト時間 (ms)
export const OFFLINE_TIMEOUT_MS = 60000;

// 議論時間の設定 (秒)
export const TIME_LIMITS = {
    MIN: 60,
    MAX: 600,
    DEFAULT: 240,
    INCREMENT: 10
};

export const ROLE_DEFINITIONS = {
    // 市民陣営
    citizen: {
        name: '市民',
        icon: User,
        desc: '特別な能力を持たない一般人。\n推理と議論で村を守ろう。',
        team: 'citizen'
    },
    seer: {
        name: '占い師',
        icon: Eye,
        desc: '毎晩、誰か1人を占って\n「人狼」か「人間」かを知ることができる。\n（妖狐は人間と判定される）',
        team: 'citizen'
    },
    medium: {
        name: '霊媒師',
        icon: Ghost,
        desc: '昨夜処刑された人が\n「人狼」だったか「人間」かを知ることができる。',
        team: 'citizen'
    },
    knight: {
        name: '騎士',
        icon: Shield,
        desc: '毎晩、自分以外の誰か1人を護衛できる。\n人狼の襲撃から守ることができる。',
        team: 'citizen'
    },
    trapper: {
        name: '罠師',
        icon: Crosshair,
        desc: '毎晩、誰か1人に罠を仕掛ける。\n襲撃に来た人狼を返り討ちにできるが、\n護衛に来た騎士も死んでしまう。',
        team: 'citizen'
    },
    sage: {
        name: '賢者',
        icon: Search,
        desc: '毎晩、誰か1人を占って\nその人の「役職」を正確に知ることができる。',
        team: 'citizen'
    },
    killer: {
        name: 'ハンター',
        icon: Swords,
        desc: '処刑された時や人狼に襲撃された時、\n道連れに誰か1人を指定して殺すことができる。',
        team: 'citizen'
    },
    detective: {
        name: '名探偵',
        icon: Search,
        desc: '調査対象が人狼かどうか分かるが、\n調査したことが人狼にバレてしまうリスクがある。',
        team: 'citizen'
    },
    elder: {
        name: '長老',
        icon: Crown,
        desc: '人狼に襲撃されても一度だけ耐えることができる。\nただし、処刑されると村人側の役職能力が全て失われる。',
        team: 'citizen'
    },
    assassin: {
        name: '暗殺者', // ももすけ
        icon: Skull,
        desc: '夜に一度だけ、誰か1人を暗殺できる。\n（人狼や妖狐も倒せる強力な攻撃）',
        team: 'citizen'
    },

    // 人狼陣営
    werewolf: {
        name: '人狼',
        icon: Moon,
        desc: '毎晩、仲間と相談して市民を1人襲撃する。\n市民になりすまして混乱させよう。',
        team: 'werewolf'
    },
    greatwolf: {
        name: '大狼',
        icon:  Users, // 変更検討
        desc: '占われても「人間」と判定される強力な人狼。\nただし、霊媒結果は「人狼」と出る。',
        team: 'werewolf'
    },
    wise_wolf: {
        name: '賢狼',
        icon: Zap,
        desc: '襲撃した相手の役職を知ることができる人狼。',
        team: 'werewolf'
    },
    madman: {
        name: '狂人',
        icon: UserMinus,
        desc: '人狼に味方する人間。\n誰が人狼かは分からないが、人狼の勝利を目指す。',
        team: 'werewolf'
    },

    // 第三陣営
    fox: {
        name: '妖狐',
        icon: Heart,
        desc: '人狼に襲撃されても死なないが、占われると呪殺される。\n人狼か市民が勝利条件を満たした時、生き残っていれば勝利。',
        team: 'third'
    },
    teruteru: {
        name: 'てるてる',
        icon: HelpCircle,
        desc: '処刑されることが勝利条件。\n怪しい行動をして処刑されるように仕向けよう。',
        team: 'third'
    },
    cursed: {
        name: '呪われし者',
        icon: Skull,
        desc: '自覚のない裏切り者。\n襲撃されると人狼として覚醒する。',
        team: 'third'
    },
    
    // 期間限定役職などの設定例
    santa: {
        name: 'サンタ',
        icon: Gift,
        desc: '【12月限定役職】\n市民陣営として振る舞う。\n特別な能力はないが、クリスマス気分を盛り上げる。',
        team: 'citizen',
        
        // --- 表示設定 ---
        // isVisible: false, // これを有効にするとロビーから非表示になります（デフォルトはtrue）
        
        // --- バッジ設定 ---
        badge: {
            label: "12月限定",      // バッジのテキスト
            color: "bg-red-600 text-white" // バッジの色 (Tailwindクラス)
        }
    }
};

export const ROLE_GROUPS = {
    citizen: ['citizen', 'seer', 'medium', 'knight', 'trapper', 'sage', 'killer', 'detective', 'elder', 'assassin'],
    werewolf: ['werewolf', 'greatwolf', 'wise_wolf', 'madman'],
    third: ['fox', 'teruteru', 'cursed', 'santa'] // サンタをここに追加
};