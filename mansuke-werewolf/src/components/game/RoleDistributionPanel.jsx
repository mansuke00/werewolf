import React from 'react';
import { ROLE_DEFINITIONS } from '../../constants/gameData';
import { Settings, Users } from 'lucide-react';

// ゲーム中の役職内訳確認用パネルコンポーネント
// 現在の設定でどの役職が何人いるか一覧表示する
export const RoleDistributionPanel = ({ players, roleSettings }) => {
    // 全役職の合計人数計算
    // roleSettingsがnull/undefinedの場合の安全策として空オブジェクト指定
    const total = Object.values(roleSettings || {}).reduce((a,b)=>a+b,0);
    
    // 設定数が1以上の役職のみ抽出
    // [key, count]の形式で配列化
    const validRoles = Object.entries(roleSettings || {}).filter(([_, c]) => c > 0);

    // 陣営ごとのグルーピング用コンテナ初期化
    // 役職定義(ROLE_DEFINITIONS)のteamプロパティに基づいて振り分ける
    const groups = {
        citizen: [],
        werewolf: [],
        third: []
    };

    // 抽出した有効役職をループ処理して振り分け
    validRoles.forEach(([roleKey, count]) => {
        const def = ROLE_DEFINITIONS[roleKey];
        // 定義が存在し、かつ対応するチーム配列がある場合のみ追加
        if (def && groups[def.team]) {
            groups[def.team].push({ key: roleKey, count, def });
        }
    });

    // 表示セクションの定義
    // 各陣営のラベル、テーマカラー、背景色などを設定
    const sections = [
        { key: 'werewolf', label: '人狼陣営', color: 'text-red-400', bg: 'bg-red-950/30', border: 'border-red-900/50' },
        { key: 'citizen', label: '市民陣営', color: 'text-blue-400', bg: 'bg-blue-950/30', border: 'border-blue-900/50' },
        { key: 'third', label: '第三陣営', color: 'text-orange-400', bg: 'bg-orange-950/30', border: 'border-orange-900/50' },
    ];

    return (
        <div className="flex flex-col h-full bg-gray-900/80 backdrop-blur border border-gray-700 rounded-2xl overflow-hidden shadow-xl">
            {/* ヘッダーエリア */}
            <div className="p-3 border-b border-gray-700 bg-gray-800/80 flex items-center justify-between shrink-0">
                {/* タイトル */}
                <span className="font-bold text-gray-200 flex items-center gap-2 text-sm md:text-base">
                    <Settings size={16} className="text-blue-400"/> 役職配分設定
                </span>
                {/* 合計人数表示バッジ */}
                <span className="bg-black/30 px-2 py-1 rounded text-xs font-mono font-bold text-gray-300">
                    Total: <span className="text-blue-400 text-base md:text-lg">{total}</span>
                </span>
            </div>

            {/* スクロール可能なリストエリア */}
            <div className="flex-1 overflow-y-auto p-2 md:p-3 custom-scrollbar space-y-3 md:space-y-4">
                {sections.map(section => {
                    const rolesInGroup = groups[section.key];
                    // 該当陣営に役職が一つもない場合は表示しない
                    if (rolesInGroup.length === 0) return null;

                    return (
                        <div key={section.key} className={`rounded-xl overflow-hidden border ${section.border}`}>
                            {/* 陣営ヘッダー */}
                            <div className={`px-3 py-1.5 text-xs font-bold ${section.bg} ${section.color} flex justify-between items-center`}>
                                <span>{section.label}</span>
                                {/* 陣営内合計人数 */}
                                <span className="bg-black/20 px-1.5 rounded text-[10px]">合計: {rolesInGroup.reduce((a, b) => a + b.count, 0)}</span>
                            </div>
                            
                            {/* 役職リストグリッド */}
                            <div className="p-2 gap-2 grid grid-cols-1 bg-black/10">
                                {rolesInGroup.map(({ key, count, def }) => (
                                    <div key={key} className="flex items-center p-2 rounded-lg border border-gray-700/50 bg-gray-800/40">
                                        {/* アイコンエリア */}
                                        <div className={`p-1.5 md:p-2 rounded-full bg-black/30 mr-2 md:mr-3 ${section.color} shrink-0`}>
                                            {/* Lucideアイコンを動的に生成 */}
                                            {React.createElement(def.icon, { size: 16, className: "md:w-[18px] md:h-[18px]" })}
                                        </div>
                                        
                                        {/* 情報エリア */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                {/* 役職名 */}
                                                <span className="font-bold text-gray-200 text-xs md:text-sm truncate">{def.name}</span>
                                                {/* 個別役職数 */}
                                                <span className="font-mono font-black text-white bg-white/10 px-1.5 py-0.5 md:px-2 rounded text-[10px] md:text-xs shrink-0">x{count}</span>
                                            </div>
                                            {/* 説明文 */}
                                            <p className="text-[9px] md:text-[10px] text-gray-500 leading-tight mt-0.5 truncate">{def.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};