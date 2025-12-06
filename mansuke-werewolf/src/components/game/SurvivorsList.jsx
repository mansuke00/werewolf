import React, { useState } from 'react';
import { Users, Skull, WifiOff, Check, Eye, Ban, LayoutGrid, HeartPulse, BadgeCheck } from 'lucide-react';
import { isPlayerOnline } from '../../utils/helpers';

export const SurvivorsList = ({ players }) => {
    // 表示モード管理
    // survivor: 生存者タブ
    // dead: 死亡・追放者タブ
    // spectator: 観戦者タブ
    const [viewMode, setViewMode] = useState('survivor');

    // プレイヤーの分類処理
    // isSpectatorフラグで参加者と観戦者を分離
    const participants = (players || []).filter(p => !p.isSpectator);
    const spectators = (players || []).filter(p => p.isSpectator);
    
    // 参加者をステータスでさらに分類
    // status: alive -> 生存
    // status: dead または vanished -> 死亡・追放
    const alivePlayers = participants.filter(p => p.status === 'alive');
    const deadPlayers = participants.filter(p => p.status === 'dead' || p.status === 'vanished');

    // 表示データの決定ロジック
    // viewModeに応じて表示リストと空時のメッセージを切り替え
    let displayList = [];
    let emptyMessage = "";
    if (viewMode === 'survivor') {
        displayList = alivePlayers;
        emptyMessage = "生存者はいません";
    } else if (viewMode === 'dead') {
        displayList = deadPlayers;
        emptyMessage = "死亡・追放されたプレイヤーはいません";
    } else {
        displayList = spectators;
        emptyMessage = "観戦者はいません";
    }

    return (
        <div className="flex flex-col h-full bg-gray-900/80 backdrop-blur border border-gray-700 rounded-2xl overflow-hidden shadow-xl">
            {/* ヘッダーエリア */}
            <div className="p-3 border-b border-gray-700 bg-gray-800/80 flex flex-col gap-2 md:gap-3 shrink-0">
                {/* タイトル行 */}
                <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-200 flex items-center gap-2 text-sm md:text-base">
                        <Users size={16} className="text-blue-400"/> プレイヤーリスト
                    </span>
                    {/* 生存者数カウンター */}
                    <span className="bg-black/30 px-2 py-1 rounded text-xs font-mono font-bold text-gray-300">
                        Alive: <span className="text-green-400 text-base md:text-lg">{alivePlayers.length}</span> / {participants.length}
                    </span>
                </div>

                {/* タブ切り替えボタン */}
                <div className="flex bg-black/30 rounded-lg p-1 border border-gray-700 gap-1">
                    {/* 生存者タブ */}
                    <button 
                        onClick={() => setViewMode('survivor')}
                        className={`flex-1 py-1.5 rounded-md text-[10px] md:text-xs font-bold flex items-center justify-center gap-1 transition ${viewMode === 'survivor' ? 'bg-green-900/60 text-green-200 shadow border border-green-500/30' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <HeartPulse size={12}/> <span className="truncate">生存 ({alivePlayers.length})</span>
                    </button>
                    {/* 死亡者タブ */}
                    <button 
                        onClick={() => setViewMode('dead')}
                        className={`flex-1 py-1.5 rounded-md text-[10px] md:text-xs font-bold flex items-center justify-center gap-1 transition ${viewMode === 'dead' ? 'bg-red-900/60 text-red-200 shadow border border-red-500/30' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        <Skull size={12}/> <span className="truncate">死亡 ({deadPlayers.length})</span>
                    </button>
                    {/* 観戦者タブ（観戦者がいる場合のみ表示） */}
                    {spectators.length > 0 && (
                        <button 
                            onClick={() => setViewMode('spectator')}
                            className={`flex-1 py-1.5 rounded-md text-[10px] md:text-xs font-bold flex items-center justify-center gap-1 transition ${viewMode === 'spectator' ? 'bg-purple-900/60 text-purple-200 shadow border border-purple-500/30' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            <Eye size={12}/> <span className="truncate">観戦 ({spectators.length})</span>
                        </button>
                    )}
                </div>
            </div>
            
            {/* リスト表示メインエリア */}
            <div className="flex-1 overflow-y-auto p-2 md:p-3 custom-scrollbar bg-black/10">
                {displayList.length === 0 ? (
                    // 空状態の表示
                    <div className="h-full flex flex-col items-center justify-center text-gray-500 text-sm py-8">
                        <Users size={32} className="mb-2 opacity-50"/>
                        <p>{emptyMessage}</p>
                    </div>
                ) : (
                    // リストアイテムのレンダリング
                    <div className="grid grid-cols-1 gap-2">
                        {displayList.map(p => {
                            // 各種状態判定
                            const isAlive = p.status === 'alive';
                            const isDead = p.status === 'dead';
                            const isVanished = p.status === 'vanished';
                            const isSpectator = p.isSpectator;
                            const online = isPlayerOnline(p);

                            // 状態に応じたスタイル定義（色、アイコン）
                            let bgColor = "bg-gray-800/60";
                            let borderColor = "border-gray-700";
                            let iconColor = "text-gray-400";
                            let iconBg = "bg-gray-700/50";
                            let Icon = Users;

                            if (isSpectator) {
                                // 観戦者: 紫系
                                bgColor = "bg-purple-900/10";
                                borderColor = "border-purple-900/30";
                                iconColor = "text-purple-400";
                                iconBg = "bg-purple-900/20";
                                Icon = Eye;
                            } else if (isAlive) {
                                // 生存者: 緑系
                                bgColor = "bg-green-900/10";
                                borderColor = "border-green-900/30";
                                iconColor = "text-green-400";
                                iconBg = "bg-green-900/20";
                                Icon = Users;
                            } else if (isDead) {
                                // 死亡者: 赤系
                                bgColor = "bg-red-900/10";
                                borderColor = "border-red-900/30";
                                iconColor = "text-red-400";
                                iconBg = "bg-red-900/20";
                                Icon = Skull;
                            } else if (isVanished) {
                                // 追放者: グレー（Ban）
                                bgColor = "bg-gray-900/40";
                                borderColor = "border-gray-800";
                                iconColor = "text-gray-500";
                                iconBg = "bg-gray-800";
                                Icon = Ban;
                            }

                            return (
                                <div key={p.id} className={`flex items-center p-2 md:p-2.5 rounded-lg border transition relative overflow-hidden ${bgColor} ${borderColor} ${!isAlive && !isSpectator ? "opacity-70" : ""}`}>
                                    {/* 準備完了エフェクト（生存者かつ準備OK時のみ） */}
                                    {isAlive && p.isReady && <div className="absolute inset-0 bg-green-500/5 pointer-events-none"></div>}
                                    
                                    {/* アイコンエリア */}
                                    <div className={`p-1.5 md:p-2 rounded-full mr-2 md:mr-3 shrink-0 ${iconBg} ${iconColor} relative`}>
                                        <Icon size={16} className="md:w-[18px] md:h-[18px]"/>
                                        {/* オフラインインジケータ */}
                                        {!online && <div className="absolute -bottom-1 -right-1 bg-gray-900 rounded-full p-0.5 border border-gray-700"><WifiOff size={10} className="text-red-500"/></div>}
                                    </div>
                                    
                                    {/* 情報エリア */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            {/* 名前表示（死亡・追放時は取り消し線） */}
                                            <span className={`text-xs md:text-sm font-bold truncate ${isVanished || (isDead && !isSpectator) ? "text-gray-500 line-through" : "text-gray-200"}`}>{p.name || '不明'}</span>
                                            {/* 開発者バッジ */}
                                            {p.isDev && (
                                                <span className="text-[9px] md:text-[10px] bg-indigo-900/50 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-500/30 flex items-center gap-0.5 shrink-0">
                                                    <BadgeCheck size={10}/> 開発者
                                                </span>
                                            )}
                                            {/* 準備OKバッジ */}
                                            {isAlive && p.isReady && <span className="ml-auto text-[9px] md:text-[10px] bg-green-900/30 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30 flex items-center gap-0.5 shrink-0"><Check size={8}/> 準備OK</span>}
                                        </div>
                                        {/* サブ情報エリア（ステータス） */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-[9px] md:text-[10px] text-gray-500">
                                                {isSpectator ? "観戦中" : isVanished ? "追放済み" : isDead ? "死亡" : "生存中"}
                                            </span>
                                            {/* DEADタグ（観戦者以外の死亡者） */}
                                            {isDead && !isSpectator && <span className="text-[8px] md:text-[9px] text-red-400 font-bold border border-red-900/50 px-1.5 py-0.5 rounded bg-red-950/30">DEAD</span>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};