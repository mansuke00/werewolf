import React, { useState, useMemo } from 'react';
import { Skull, User, Crown, Eye, WifiOff, Users, SortAsc, LayoutGrid, BadgeCheck } from 'lucide-react';
import { ROLE_DEFINITIONS } from '../../constants/gameData.js';
import { isPlayerOnline } from '../../utils/helpers.js';

export const DeadPlayerInfoPanel = ({ players, title = "プレイヤーの役職" }) => {
    // 表示モード管理。'role'（役職・陣営別）、'name'（名前順）の切り替え
    const [viewMode, setViewMode] = useState('role');

    // playersがundefined/nullの場合の対策。空配列フォールバック
    const safePlayers = players || [];

    // 表示対象フィルタリング
    // 条件: 役職判明済み OR 死亡 OR 追放 OR 観戦者
    const targets = useMemo(() => {
        return safePlayers.filter(p => p.role || ['dead', 'vanished'].includes(p.status) || p.isSpectator);
    }, [safePlayers]);

    // 表示用データ加工処理
    // 生データにアイコン、色定義、表示名などを付与してレンダリングしやすくする
    const processedPlayers = useMemo(() => {
        return targets.map(p => {
            const roleKey = p.role || "unknown";
            // 観戦者フラグの正規化。isSpectatorプロパティまたはroleがspectatorの場合
            const isSpectator = p.isSpectator || roleKey === 'spectator';
            
            // 定義取得。観戦者の場合は強制的に観戦者定義を使用
            const def = ROLE_DEFINITIONS[roleKey] || (isSpectator ? ROLE_DEFINITIONS['spectator'] : null);
            
            // 表示名・アイコン決定。定義がない場合はデフォルト値
            let roleName = def ? def.name : (roleKey === 'unknown' ? "不明" : roleKey);
            
            // 呪われし者が人狼に覚醒している場合の表示変更
            if (p.originalRole === 'cursed' && roleKey === 'werewolf') {
                roleName = "呪われし者 - 人狼陣営";
            }

            const Icon = def ? def.icon : (isSpectator ? Eye : User);
            const team = def ? def.team : 'other';

            // 陣営ごとのスタイル定義（色、枠線、背景、ラベル）
            // デフォルト: その他（グレー）
            let teamColor = "text-gray-400";
            let borderColor = "border-gray-700";
            let bgColor = "bg-gray-800/40";
            let teamLabel = "その他";

            // 陣営判定ロジック
            if (team === 'werewolf') {
                // 人狼陣営: 赤系
                teamColor = "text-red-400";
                borderColor = "border-red-900/30";
                bgColor = "bg-red-900/10";
                teamLabel = "人狼陣営";
            } else if (team === 'citizen') {
                // 市民陣営: 青系
                teamColor = "text-blue-400";
                borderColor = "border-blue-900/30";
                bgColor = "bg-blue-900/10";
                teamLabel = "市民陣営";
            } else if (team === 'third') {
                // 第三陣営: オレンジ系
                teamColor = "text-orange-400";
                borderColor = "border-orange-900/30";
                bgColor = "bg-orange-900/10";
                teamLabel = "第三陣営";
            }

            // 観戦者上書き設定: 紫系
            if (isSpectator) {
                teamColor = "text-purple-400";
                borderColor = "border-purple-900/30";
                bgColor = "bg-purple-900/10";
                teamLabel = "観戦者";
            }

            // 加工済みオブジェクト返却
            return {
                ...p,
                roleName,
                Icon,
                team,
                teamLabel,
                teamColor,
                borderColor,
                bgColor,
                isSpectator
            };
        });
    }, [targets]);

    // コンテンツ生成ロジック
    // viewModeによってレンダリング構造を分岐
    const content = useMemo(() => {
        // モード: 名前順
        if (viewMode === 'name') {
            // 文字コード順でソート
            const sorted = [...processedPlayers].sort((a, b) => a.name.localeCompare(b.name));
            return (
                <div className="grid grid-cols-1 gap-2">
                    {sorted.map(p => <PlayerCard key={p.id} player={p} />)}
                </div>
            );
        } else {
            // モード: 役職順（グルーピング表示）
            
            // グルーピング用コンテナ初期化
            // 構造: groups[陣営キー][役職キー] = [プレイヤー配列]
            const groups = {
                werewolf: {},
                citizen: {},
                third: {},
                spectator: [], // 観戦者は役職細分化不要のため配列直置き
                other: {}
            };

            // 分類処理
            processedPlayers.forEach(p => {
                if (p.isSpectator) {
                    groups.spectator.push(p);
                } else {
                    // 陣営キー検証（未定義の陣営はotherへ）
                    const teamKey = groups[p.team] ? p.team : 'other';
                    const roleKey = p.role || 'unknown';
                    
                    // 役職配列初期化
                    if (!groups[teamKey][roleKey]) {
                        groups[teamKey][roleKey] = [];
                    }
                    groups[teamKey][roleKey].push(p);
                }
            });

            // 表示順序定義
            const sections = [
                { key: 'werewolf', label: '人狼陣営', color: 'text-red-400', bg: 'bg-red-950/30', border: 'border-red-900/50' },
                { key: 'citizen', label: '市民陣営', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-900/50' },
                { key: 'third', label: '第三陣営', color: 'text-orange-400', bg: 'bg-orange-950/30', border: 'border-orange-900/50' },
                { key: 'spectator', label: '観戦者', color: 'text-purple-400', bg: 'bg-purple-950/30', border: 'border-purple-900/50' },
                { key: 'other', label: 'その他', color: 'text-gray-400', bg: 'bg-gray-900/30', border: 'border-gray-800' },
            ];

            return (
                <div className="space-y-4">
                    {sections.map(section => {
                        // 観戦者セクション特例処理（サブグループなしフラット表示）
                        if (section.key === 'spectator') {
                            const players = groups.spectator;
                            // 該当者なしなら非表示
                            if (players.length === 0) return null;
                            return (
                                <div key={section.key} className={`rounded-xl overflow-hidden border ${section.border}`}>
                                    <div className={`px-3 py-1.5 text-xs font-bold ${section.bg} ${section.color} flex justify-between items-center`}>
                                        <span>{section.label}</span>
                                        <span className="bg-black/20 px-1.5 rounded text-[10px]">{players.length}</span>
                                    </div>
                                    {/* ブロック内スクロールを削除 */}
                                    <div className="p-2 gap-2 grid grid-cols-1 bg-black/10">
                                        {players.map(p => <PlayerCard key={p.id} player={p} />)}
                                    </div>
                                </div>
                            );
                        }

                        // 通常陣営処理（役職サブグループあり）
                        const roleGroups = groups[section.key];
                        const roleKeys = Object.keys(roleGroups);
                        // 該当役職なしなら非表示
                        if (roleKeys.length === 0) return null;

                        // セクション内合計人数計算
                        const totalCount = roleKeys.reduce((acc, key) => acc + roleGroups[key].length, 0);

                        return (
                            <div key={section.key} className={`rounded-xl overflow-hidden border ${section.border}`}>
                                {/* 陣営ヘッダー */}
                                <div className={`px-3 py-1.5 text-xs font-bold ${section.bg} ${section.color} flex justify-between items-center`}>
                                    <span>{section.label}</span>
                                    <span className="bg-black/20 px-1.5 rounded text-[10px]">{totalCount}</span>
                                </div>
                                
                                {/* ブロック内スクロールを削除 */}
                                <div className="p-2 bg-black/10 space-y-2">
                                    {/* 役職ごとのブロック生成 */}
                                    {roleKeys.map(roleKey => {
                                        const players = roleGroups[roleKey];
                                        // 役職名はグループ内1人目から参照（全員同じはず）
                                        const roleName = players[0].roleName;
                                        
                                        return (
                                            <div key={roleKey} className="bg-gray-900/40 rounded-lg border border-gray-700/50 overflow-hidden">
                                                {/* 役職名ヘッダー */}
                                                <div className="px-2 py-1 bg-black/20 text-[10px] text-gray-400 font-bold border-b border-gray-700/30 flex justify-between">
                                                    <span>{roleName}</span>
                                                    <span>x{players.length}</span>
                                                </div>
                                                {/* プレイヤーリスト */}
                                                <div className="p-1 grid grid-cols-1 gap-1">
                                                    {players.map(p => <PlayerCard key={p.id} player={p} />)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        }
    }, [viewMode, processedPlayers]);

    return (
        // 高さ制限を修正: LogPanelと同じクラスを適用して高さを揃える
        // flex flex-col h-full bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/50 overflow-hidden relative shadow-lg
        // (レイアウト安定のため w-full を追加)
        <div className="flex flex-col w-full h-full bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/50 overflow-hidden relative shadow-lg">
            {/* パネルヘッダー */}
            <div className="p-3 border-b border-gray-700 bg-gray-800/80 flex items-center justify-between shrink-0">
                <span className="font-bold text-gray-200 flex items-center gap-2 text-sm truncate">
                    <Users size={16} className="text-blue-400 shrink-0"/> {title}
                </span>
                
                {/* トグルボタンエリア */}
                <div className="flex bg-black/30 rounded-lg p-0.5 border border-gray-700 shrink-0">
                    <button 
                        onClick={() => setViewMode('role')}
                        className={`px-2 py-1 rounded-md text-[10px] md:text-xs font-bold flex items-center gap-1 transition whitespace-nowrap ${viewMode === 'role' ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <LayoutGrid size={12} className="shrink-0"/> 役職順
                    </button>
                    <button 
                        onClick={() => setViewMode('name')}
                        className={`px-2 py-1 rounded-md text-[10px] md:text-xs font-bold flex items-center gap-1 transition whitespace-nowrap ${viewMode === 'name' ? 'bg-gray-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <SortAsc size={12} className="shrink-0"/> 名前順
                    </button>
                </div>
            </div>
            
            {/* スクロールエリア */}
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar min-h-0">
                {targets.length === 0 ? (
                    // 該当者なし時の空表示
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm py-8">
                        <Skull size={32} className="mb-2 opacity-50"/>
                        <p>該当するプレイヤーはいません</p>
                    </div>
                ) : (
                    // 生成済みコンテンツ描画
                    content
                )}
            </div>
        </div>
    );
};

// 子コンポーネント: 個別プレイヤーカード
const PlayerCard = ({ player, minimal }) => {
    // 必要なプロパティを分割代入
    const { name, roleName, Icon, teamColor, borderColor, bgColor, status, originalRole, deathReason, isHost, isSpectator } = player;

    // 追放タグ表示条件: 観戦者ではなく、かつステータスが追放(vanished)
    const showVanishedTag = !isSpectator && status === 'vanished';
    
    // 死亡判定: 観戦者は死亡扱いしない（スタイル適用除外のため）
    const isDead = !isSpectator && status === 'dead';

    return (
        <div className={`flex items-center p-2.5 rounded-lg border ${borderColor} ${bgColor} transition hover:bg-gray-700/40 relative overflow-hidden group`}>
            
            {/* アイコンエリア（左側） */}
            <div className={`p-2 rounded-full bg-black/30 mr-3 ${teamColor} shrink-0 relative`}>
                <Icon size={18} className="shrink-0"/>
                {/* ホスト（王冠）アイコンオーバーレイ */}
                {isHost && <div className="absolute -top-1 -left-1 bg-yellow-500 text-black p-0.5 rounded-full border border-black"><Crown size={8}/></div>}
            </div>
            
            {/* メイン情報エリア */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    {/* 名前表示。死亡/追放時は取り消し線と色変更 */}
                    <span className={`font-bold truncate text-sm ${isDead || showVanishedTag ? 'text-gray-400 line-through decoration-red-500/50' : 'text-gray-200'}`}>
                        {name}
                    </span>
                    {/* 開発者バッジ表示 */}
                    {player.isDev && (
                        <span className="text-[9px] md:text-[10px] bg-indigo-900/50 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30 flex items-center gap-0.5 shrink-0">
                            <BadgeCheck size={10}/> 開発者
                        </span>
                    )}
                    {/* ステータスアイコンエリア（右寄せ） */}
                    <div className="flex items-center gap-1 shrink-0 ml-auto">
                        {/* オフライン表示 */}
                        {!isPlayerOnline(player) && <WifiOff size={10} className="text-red-500"/>}
                        {/* 追放ラベル */}
                        {showVanishedTag && <span className="text-[9px] text-gray-500 font-bold border border-gray-700 px-1 rounded bg-black/30">追放</span>}
                    </div>
                </div>
                
                {/* 役職・サブ情報行 */}
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                    <span className={`text-xs font-bold ${teamColor}`}>
                        {isSpectator ? "観戦者" : roleName}
                    </span>
                    {/* 元役職表示（役職変化があった場合のみ。観戦者は除外） */}
                    {!isSpectator && originalRole && originalRole !== player.role && (
                        <span className="text-[10px] text-gray-500">
                            (元: {ROLE_DEFINITIONS[originalRole]?.name || originalRole})
                        </span>
                    )}
                </div>
            </div>

            {/* 死因表示エリア（観戦者以外かつ死因ありの場合） */}
            {!isSpectator && deathReason && (
                <div className="text-right pl-2 max-w-[100px] shrink-0 flex flex-col items-end justify-center">
                    <span className="text-[9px] text-gray-500 leading-none mb-0.5">死因</span>
                    <span className="text-[10px] text-red-300 font-medium break-words w-full text-right" title={deathReason}>
                        {deathReason}
                    </span>
                </div>
            )}
        </div>
    );
};