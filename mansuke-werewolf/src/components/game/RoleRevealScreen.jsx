import React from 'react';
import { User, Loader } from 'lucide-react';
import { ROLE_DEFINITIONS, TIME_LIMITS } from '../../constants/gameData';

// ゲーム開始直後の役職発表画面コンポーネント
// 全画面でアニメーション表示し、プレイヤーに自分の役割を認知させる
export const RoleRevealScreen = ({ role, teammates }) => {
    // roleデータがまだ届いていない場合のローディング表示
    // サーバー通信のラグ対策
    if (!role) return <div className="min-h-screen bg-black flex items-center justify-center text-white"><Loader className="animate-spin mb-4"/>Retrieving Role...</div>;
    
    // 役職定義データの取得。万が一未定義の場合は市民として扱う（エラー回避）
    const roleDef = ROLE_DEFINITIONS[role] || ROLE_DEFINITIONS['citizen'];
    const Icon = roleDef?.icon || User;
    
    // チーム判定ロジック
    // 人狼陣営（人狼、大狼、狂人など）かどうかで画面のテーマカラーを切り替える
    // 緊張感を演出するため、人狼側は赤、市民側は青とする
    const isWolfTeam = ['werewolf','greatwolf','madman'].includes(ROLE_DEFINITIONS[role]?.team);
    
    return (
        // ルート要素: 画面全体を覆う固定配置 (z-index: 90)
        // 背景色はチームによって赤系/青系に分岐
        // 1秒かけて色が変化するトランジション付き
        <div className={`fixed inset-0 flex flex-col items-center justify-center z-[90] p-4 md:p-6 text-center text-white transition-colors duration-1000 ${isWolfTeam ? 'bg-red-950':'bg-indigo-950'}`}>
            
            {/* メインコンテンツコンテナ */}
            {/* 下からフェードインするアニメーション */}
            <div className="animate-fade-in-up space-y-4 md:space-y-6 max-w-lg w-full flex flex-col items-center">
                
                {/* ラベル: YOUR ROLE */}
                <p className="text-gray-300 text-sm md:text-lg font-medium tracking-widest uppercase mb-2 md:mb-4">YOUR ROLE</p>
                
                {/* 役職アイコン表示エリア */}
                {/* 大きな円形背景、チームカラーに応じた背景色 */}
                <div className={`mx-auto w-32 h-32 md:w-40 md:h-40 rounded-full flex items-center justify-center mb-4 md:mb-6 shadow-2xl ${isWolfTeam ? "bg-red-600" : "bg-blue-600"} ring-4 md:ring-8 ring-white/10`}>
                    <Icon size={64} className="text-white md:w-20 md:h-20" />
                </div>
                
                {/* 役職名表示 */}
                {/* グラデーションテキストでインパクトを出す */}
                <h2 className={`text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r ${isWolfTeam ? "from-red-400 to-orange-400" : "from-blue-400 to-cyan-400"}`}>{roleDef?.name}</h2>
                
                {/* 役職説明文エリア */}
                {/* 半透明のガラスモーフィズムデザイン */}
                <div className="bg-black/30 backdrop-blur-md p-4 md:p-6 rounded-2xl border border-white/10 mt-4 md:mt-8 w-full">
                    <p className="text-gray-200 text-sm md:text-lg leading-relaxed font-medium">{roleDef?.desc}</p>
                </div>
                
                {/* 仲間リスト表示エリア（人狼同士や共有者など） */}
                {/* 1秒遅れてフェードインさせる演出 (delay-1000) */}
                {teammates && teammates.length > 0 && (
                    <div className="mt-4 md:mt-8 animate-fade-in delay-1000 bg-white/10 p-3 md:p-4 rounded-xl border border-white/20 w-full">
                        <p className="text-xs md:text-sm text-gray-300 mb-2 font-bold uppercase tracking-wider">仲間</p>
                        <div className="flex flex-wrap justify-center gap-2 md:gap-3">
                            {teammates.map(t => (<span key={t.id} className="px-3 py-1.5 md:px-4 md:py-2 bg-black/40 rounded-full text-white text-xs md:text-sm font-bold border border-white/20">{t.name} ({ROLE_DEFINITIONS[t.role]?.name})</span>))}
                        </div>
                    </div>
                )}
            </div>
            
            {/* 画面下部の時間経過バー */}
            {/* CSSアニメーションで残り時間を可視化 */}
            <div className="absolute bottom-10 w-full px-6 md:px-10">
                <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                    {/* TIME_LIMITS.ROLE_REVEAL で定義された秒数でバーが減っていく */}
                    <div className="h-full bg-white animate-progress-bar w-full origin-left" style={{ animationDuration: `${TIME_LIMITS.ROLE_REVEAL}s` }}></div>
                </div>
            </div>
        </div>
    );
};