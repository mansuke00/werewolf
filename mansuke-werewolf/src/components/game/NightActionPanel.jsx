import React, { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase.js'; 
import { Check, Moon, Lock, Loader, XCircle, CheckCircle, Info, Shield, Eye, Skull, Search, Crosshair, Crown } from 'lucide-react';
import { ROLE_DEFINITIONS } from '../../constants/gameData.js'; 

export const NightActionPanel = ({ myRole, players, onActionComplete, myPlayer, teammates, roomCode, roomData, lastActionResult, isDone }) => {
    if (!myPlayer) return null;
    
    // players配列がundefinedの場合の対策
    const safePlayers = players || [];

    // 暗殺者の使用済みチェックなどはここで行わない。サーバーサイドまたはroomDataで管理
    
    // 受動的役職（探偵・霊媒師）の処理ブロック
    // ターゲット選択不要。結果を見るだけの役職
    if (['detective', 'medium'].includes(myRole)) {
        // 結果が存在するか確認
        const hasResult = lastActionResult && lastActionResult.length > 0;
        
        // 表示データの生成。結果がない場合はデフォルトメッセージ
        const displayCards = hasResult ? lastActionResult : [{ label: myRole === 'detective' ? "調査" : "霊媒", value: "今夜提供できる情報はありません", sub: "", isBad: false, icon: "Info" }];

        // 自動完了処理
        // 結果表示後、または3秒後に自動的にアクション完了とする
        useEffect(() => {
             const timer = setTimeout(() => {
                 onActionComplete();
             }, 3000);
             
             if (hasResult) {
                 onActionComplete();
             }
             return () => clearTimeout(timer);
        }, [hasResult, onActionComplete]);
        
        return (
            <div className="flex flex-col h-full p-4 animate-fade-in items-center justify-center text-center bg-gray-900/80 rounded-xl ring-4 ring-purple-400/50">
                <div className="flex flex-col items-center mb-4 gap-2">
                     <Search size={48} className="text-purple-400"/>
                     <h3 className="text-xl font-bold text-white">以下の情報をご確認ください</h3>
                </div>
                <div className="space-y-3 w-full max-w-sm">
                    {displayCards.map((card, idx) => (
                        <div key={idx} className={`p-4 rounded-xl border flex flex-col items-center ${card.isBad ? "bg-red-900/30 border-red-500/50" : card.isBad === false ? "bg-blue-900/30 border-blue-500/50" : "bg-gray-800/30 border-gray-600/50"}`}>
                            <span className="text-xs font-bold text-gray-400 mb-1">{card.label}</span>
                            <div className={`text-xl font-black ${card.isBad ? "text-red-400" : "text-white"}`}>{card.value}</div>
                            {card.sub && <div className="text-sm text-gray-300 mt-1">{card.sub}</div>}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // 能動的役職（人狼・占い師・騎士・暗殺者など）の処理ブロック
    // ターゲット選択と送信が必要
    const [selectedId, setSelectedId] = useState(null);
    const [confirmed, setConfirmed] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [waitingResult, setWaitingResult] = useState(false);
    const [assassinUsedMsg, setAssassinUsedMsg] = useState(null);

    // チームキー設定
    // 人狼系は同一チーム、暗殺者は独自チームとして扱う
    let teamKey = myRole;
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) teamKey = 'werewolf_team'; 
    if (myRole === 'assassin') teamKey = 'assassin'; 
    
    // 現在の進行中アクション、リーダーIDを取得
    const pendingAction = roomData?.pendingActions?.[teamKey];
    const leaderId = roomData?.nightLeaders?.[teamKey];
    
    // 生存しているチームメイトの抽出
    const livingTeammates = (teammates || []).filter(t => {
        const p = safePlayers.find(pl => pl.id === t.id);
        return p && p.status === 'alive';
    });
    
    // ソロプレイ判定（チームメイトがいない場合）
    const isSolo = livingTeammates.length === 0;

    // リーダー判定
    // ソロなら自分がリーダー、そうでなければleaderIdと一致するか確認
    const isLeader = isSolo ? true : (leaderId ? leaderId === myPlayer.id : false); 
    
    // 合意形成が必要か（ソロでなければ必要）
    const needsConsensus = !isSolo;
    const leaderName = safePlayers.find(p => p.id === leaderId)?.name || "---";

    // 自分の視点でのリーダーID
    const myLeaderId = leaderId || myPlayer.id;
    // 結果待ちが必要な役職（占い師・賢者）
    const hasResultWait = ['seer', 'sage'].includes(myRole);
    // アクション完了済み判定
    const isActionDone = isDone || roomData?.nightActions?.[myLeaderId] !== undefined || (isSolo && roomData?.nightActions?.[myPlayer.id] !== undefined);

    // チャット名決定ロジック (人狼陣営か、それ以外の役職か)
    const chatName = ['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole) 
        ? "人狼チャット" 
        : `${ROLE_DEFINITIONS[myRole]?.name || myRole}チャット`;

    // 暗殺者の能力使用済みチェック
    // roomDataのフラグを確認し、使用済みならメッセージを表示して完了扱いにする
    useEffect(() => {
        if (myRole === 'assassin') {
            const checkAssassinUsage = async () => {
                if (roomData?.assassinUsed) {
                    setAssassinUsedMsg("ももすけは一名のみ存在意義を消すことができます");
                    onActionComplete(); 
                }
            };
            checkAssassinUsage();
        }
    }, [myRole, roomData, onActionComplete]);

    // ステータス同期処理
    // 承認状況のリセットや、アクション完了時のUI更新
    useEffect(() => {
        // 提案がなくなれば確認状態を解除
        if (!pendingAction) setConfirmed(false);

        // アクション完了時の処理
        if (isActionDone) {
             if (hasResultWait) {
                 // 結果待ち役職の場合、結果が届いていれば完了、なければ待機中にする
                 if (lastActionResult && lastActionResult.length > 0) {
                     setConfirmed(true);
                     setWaitingResult(false);
                     onActionComplete();
                 } else {
                     setWaitingResult(true);
                 }
             } else {
                 // 結果待ち不要なら即完了
                 setConfirmed(true);
                 onActionComplete();
             }
        }
    }, [pendingAction, confirmed, isLeader, livingTeammates.length, roomCode, onActionComplete, isActionDone, hasResultWait, lastActionResult]);

    // 提案処理（リーダー用）
    // Functions: nightInteraction / type: propose
    const handlePropose = async () => { 
        if((!selectedId && myRole !== 'assassin') || isSubmitting) return; 
        
        // 暗殺者のスキップ処理対応
        if (myRole === 'assassin' && selectedId === 'skip') {
             // スキップ時の特別な処理があればここに記述
        } else if (!selectedId) return;

        setIsSubmitting(true);
        try {
            const fn = httpsCallable(functions, 'nightInteraction'); 
            await fn({ roomCode, type: 'propose', payload: { targetId: selectedId } });
            setIsSubmitting(false);
        } catch(e) { 
            console.error(e);
            setIsSubmitting(false); 
        }
    };
    
    // 投票処理（メンバー用）
    // Functions: nightInteraction / type: vote
    // approve: true(承認) / false(却下)
    const handleVote = async (approve) => { 
        if(isSubmitting) return;
        setIsSubmitting(true);
        try {
            const fn = httpsCallable(functions, 'nightInteraction'); 
            await fn({ roomCode, type: 'vote', payload: { approve } });
            setTimeout(() => setIsSubmitting(false), 2000);
        } catch(e) { 
            console.error(e); 
            setIsSubmitting(false);
        }
    };
    
    // 最終決定処理（ソロまたは単独行動用）
    // Functions: submitNightAction
    const handleSubmitFinal = async () => { 
        if(isSubmitting) return;
        if (!selectedId && myRole !== 'assassin') return;

        setIsSubmitting(true);
        
        if (hasResultWait) {
            setWaitingResult(true);
        }

        const finalTarget = selectedId;
        try {
            const fn = httpsCallable(functions, 'submitNightAction'); 
            await fn({ roomCode, targetId: finalTarget }); 
            
            // 結果待ち不要なら即座に完了状態へ
            if (!hasResultWait) {
                setConfirmed(true);
                onActionComplete();
            }
        } catch(e) {
            console.error(e);
            setIsSubmitting(false);
            setWaitingResult(false);
            alert("エラーが発生しました: " + e.message);
        }
    };
    
    // ターゲットリストのフィルタリング
    const targets = safePlayers.filter(p => {
        // 死亡者、自分自身、仲間、前回護衛対象などを除外
        if (!p || p.status === 'dead') return false;
        if (teammates && teammates.some(t => t.id === p.id)) return false; 
        if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole) && p.id === myPlayer.id) return false;
        if (['seer', 'sage'].includes(myRole) && p.id === myPlayer.id) return false;
        if (['knight', 'trapper'].includes(myRole) && myPlayer.lastTarget === p.id) return false; 
        if (myRole === 'assassin' && p.id === myPlayer.id) return false;
        return true;
    });

    // 役職ごとのテキスト・アイコン設定
    let prompt = "対象を選択";
    let doneTitle = "アクション完了";
    let doneIcon = Check;
    
    if (['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole)) {
        prompt = "どのプレイヤーを襲撃しますか？";
        doneTitle = "襲撃完了";
        doneIcon = Skull;
    } else if (['seer', 'sage'].includes(myRole)) {
        prompt = "どのプレイヤーを占いますか？";
        doneTitle = "占い完了";
        doneIcon = Eye;
    } else if (['knight', 'trapper'].includes(myRole)) {
        prompt = "どのプレイヤーを護衛しますか？";
        doneTitle = "護衛完了";
        doneIcon = Shield;
    } else if (myRole === 'assassin') {
        prompt = "どのプレイヤーの存在意義を抹消しますか？";
        doneTitle = "存在意義抹消設定完了";
        doneIcon = Crosshair;
    }

    // 暗殺者使用済み画面の表示
    if (assassinUsedMsg) {
        return (
            <div className="flex flex-col h-full p-4 animate-fade-in items-center justify-center text-center bg-gray-900/80 rounded-xl border border-gray-700">
                <Crosshair size={48} className="text-gray-500 mb-4"/>
                <h3 className="text-lg font-bold text-gray-400">{assassinUsedMsg}</h3>
            </div>
        );
    }

    // 結果画面表示判定
    const showResultScreen = confirmed || (isActionDone && (!hasResultWait || (lastActionResult && lastActionResult.length > 0)));

    // 結果画面レンダリング
    if (showResultScreen) {
        // アクションデータ取得（リーダーのアクションまたは自分のアクション）
        const actionData = roomData?.nightActions?.[myLeaderId] || roomData?.nightActions?.[myPlayer.id];
        // ターゲット名解決
        const targetName = actionData ? (actionData.targetId === 'skip' ? "誰の存在意義も消さない" : safePlayers.find(p => p.id === actionData.targetId)?.name) : (selectedId ? (selectedId==='skip'?"誰の存在意義も消さない":safePlayers.find(p=>p.id===selectedId)?.name) : "---");
        const resultCards = lastActionResult || [];
        
        return (
            <div className="flex flex-col h-full p-4 animate-fade-in items-center justify-center text-center bg-gray-900/80 rounded-xl ring-4 ring-yellow-400/50">
                <div className="bg-white/10 p-4 rounded-full mb-4">
                     {React.createElement(doneIcon, { size: 48, className: "text-yellow-400" })}
                </div>
                <h3 className="text-xl font-bold text-white mb-2">今夜のアクションは終了しました</h3>
                
                <div className="mt-4 w-full max-w-sm bg-black/40 border border-white/10 rounded-xl p-4">
                     <p className="text-xs text-gray-400 font-bold uppercase mb-2">{doneTitle}</p>
                     <p className="text-lg text-white font-bold">
                         <span className="text-yellow-400">{targetName}</span> を{
                            ['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole) ? "襲撃しました" :
                            ['seer', 'sage'].includes(myRole) ? "占いました" :
                            myRole === 'assassin' ? (targetName === "誰の存在意義も消さない" ? "選択しました" : "存在意義を抹消する対象にしました") :
                            "護衛しました"
                         }
                     </p>
                     {/* 占い結果などの詳細表示 */}
                     {resultCards.length > 0 && (
                         <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                             {resultCards.map((card, idx) => (
                                 <div key={idx} className="bg-indigo-900/50 p-2 rounded-lg border border-indigo-500/30">
                                     <span className="text-xs text-indigo-300 block">{card.label}</span>
                                     <span className="text-xl font-black text-white">{card.value}</span>
                                 </div>
                             ))}
                         </div>
                     )}
                </div>
            </div>
        );
    }

    // 結果待ち画面（サーバー応答待ち）
    if (waitingResult) {
        return (
            <div className="flex flex-col h-full p-4 animate-fade-in items-center justify-center text-center bg-gray-900/80 rounded-xl border border-purple-500/50">
                <Loader size={48} className="text-purple-400 animate-spin mb-4"/>
                <h3 className="text-xl font-bold text-white mb-2">結果を確認中...</h3>
                <p className="text-gray-400 text-sm">サーバーからの応答を待っています。</p>
            </div>
        );
    }

    // チーム行動用画面（リーダー選出・提案・投票）
    if (needsConsensus) {
        // リーダー未定時
        if (!leaderId) {
             return (
                <div className="flex flex-col h-full p-4 animate-fade-in bg-gray-900/80 rounded-xl border border-purple-500/30 items-center justify-center text-center">
                    <Loader size={32} className="text-purple-400 animate-spin mb-2"/>
                    <p className="text-gray-400 text-sm">リーダーを選出中...</p>
                    <p className="text-xs text-gray-500 mt-2">画面が変わらない場合は、一度リロードしてください</p>
                </div>
             );
        }

        // 提案待ち（メンバー視点）
        if (!pendingAction && !isLeader) {
            return (
                <div className="flex flex-col h-full p-4 animate-fade-in bg-gray-900/80 rounded-xl border border-purple-500/30 justify-center">
                    <div className="flex flex-col items-start gap-4">
                        <div className="bg-purple-900/20 p-3 rounded-full">
                            <Lock size={32} className="text-purple-400"/>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white mb-2">{leaderName}が今夜の選択リーダーです</h3>
                            <div className="text-gray-400 text-sm leading-relaxed space-y-1">
                                <p>①{chatName}で、誰を選択するかを話し合ってください。</p>
                                <p>②選択リーダーが、今夜の対象プレイヤーを選択するまでお待ちください。</p>
                                <p>③選択リーダーから承認の申請が届きます。選択したプレイヤーが正しければ、承認してください。</p>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // 承認待ち（リーダー視点）
        if (pendingAction && isLeader) {
            const targetName = pendingAction.targetId === 'skip' ? "誰の存在意義も消さない" : (safePlayers.find(p=>p.id===pendingAction.targetId)?.name || "不明");
            return (
                <div className="flex flex-col h-full p-4 animate-fade-in bg-gray-900/80 rounded-xl border border-purple-500/50">
                    <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
                        <Loader size={48} className="text-yellow-400 animate-spin"/>
                        <div>
                            <h3 className="text-xl font-bold text-white mb-2">承認待機中...</h3>
                            <p className="text-gray-400 text-sm">
                                あなたは <span className="text-yellow-400 font-bold text-lg">{targetName}</span> を選択しました。<br/>
                                他のメンバーからの承認を待っています。
                            </p>
                        </div>
                        <div className="bg-black/40 px-4 py-2 rounded-lg">
                            <p className="text-xs text-gray-500">承認状況: {pendingAction.approvals?.length} / {livingTeammates.length + 1}</p>
                        </div>
                    </div>
                </div>
            );
        }

        // 承認投票画面（メンバー視点）
        if (pendingAction && !isLeader) {
            const targetName = pendingAction.targetId === 'skip' ? "誰の存在意義も消さない" : (safePlayers.find(p=>p.id===pendingAction.targetId)?.name || "不明");
            const hasVoted = pendingAction.approvals?.includes(myPlayer.id);
            return (
                <div className="flex flex-col h-full p-4 animate-fade-in bg-gray-900/80 rounded-xl border border-purple-500/50">
                    <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
                        <div className="bg-purple-900/30 p-4 rounded-full border border-purple-500/30">
                            <Info size={32} className="text-purple-300"/>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white mb-1">リーダーは {targetName} さんを選択しました</h3>
                            <p className="text-sm text-gray-400 mb-4">他のチームメンバー全員からの承認を確認後、選択完了となります。</p>
                        </div>
                        <div className="flex gap-3 w-full mt-2">
                            <button onClick={() => handleVote(false)} disabled={isSubmitting} className="flex-1 py-3 bg-red-900/80 border border-red-500 text-red-200 rounded-xl font-bold hover:bg-red-800 transition flex items-center justify-center gap-2 disabled:opacity-50">
                                <XCircle size={18}/> 却下
                            </button>
                            <button onClick={() => handleVote(true)} disabled={isSubmitting || hasVoted} className={`flex-1 py-3 border rounded-xl font-bold transition flex items-center justify-center gap-2 disabled:opacity-50 ${hasVoted ? "bg-gray-700 text-gray-400 border-gray-600" : "bg-green-900/80 border-green-500 text-green-200 hover:bg-green-800"}`}>
                                <CheckCircle size={18}/> {hasVoted ? "承認済み" : "承認"}
                            </button>
                        </div>
                    </div>
                </div>
            );
        }
    }

    // ターゲット選択画面（メイン）
    return (
        <div className="flex flex-col h-full p-4 animate-fade-in bg-gray-900/80 rounded-xl ring-4 ring-purple-500/30">
            {/* リーダー時の案内表示 */}
            {needsConsensus && (
                <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-xl p-3 mb-4 flex items-start gap-3 shrink-0">
                    <div className="bg-yellow-500/20 p-2 rounded-full shrink-0">
                        <Crown size={20} className="text-yellow-400"/>
                    </div>
                    <div>
                        <h4 className="text-yellow-400 font-bold text-sm mb-1">あなたが今夜の選択リーダーです</h4>
                        <div className="text-xs text-yellow-200/80 space-y-1 leading-relaxed">
                            <p>①{chatName}で、誰を選択するかを話し合ってください。</p>
                            <p>②今夜の対象プレイヤーを選択し、決定を押してください。</p>
                            <p>③他の{['werewolf', 'greatwolf', 'wise_wolf'].includes(myRole) ? "人狼" : ROLE_DEFINITIONS[myRole]?.name}チームの方全員からの承認を確認次第、選択完了となります。</p>
                        </div>
                    </div>
                </div>
            )}

            <div className="text-center mb-4 shrink-0">
                <h3 className="text-lg font-bold text-white flex items-center justify-center gap-2 mb-1">
                    <Moon className="text-purple-400 shrink-0" size={20}/> {prompt}
                </h3>
                {myRole === 'assassin' && (
                    <p className="text-xs text-red-300 bg-red-900/20 px-2 py-1 rounded border border-red-500/30 mb-2">
                        ももすけは1ゲームにつき1人しか存在意義を抹消することができません。注意して能力を活用してください。
                    </p>
                )}
                {/* 連続護衛禁止の警告 */}
                {['knight', 'trapper'].includes(myRole) && myPlayer.lastTarget && (
                    <p className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded border border-red-500/30 mt-2">
                        ※前回護衛したプレイヤー ({safePlayers.find(p => p.id === myPlayer.lastTarget)?.name}) は選択できません。
                    </p>
                )}
            </div>

            <div className="grid grid-cols-2 gap-2 overflow-y-auto flex-1 custom-scrollbar min-h-0">
                {/* 暗殺者用スキップボタン */}
                {myRole === 'assassin' && (
                    <button 
                        onClick={() => setSelectedId('skip')} 
                        className={`py-3 px-2 rounded-xl border-2 transition text-center flex flex-col items-center justify-center relative col-span-2 ${
                            selectedId === 'skip'
                            ? "border-purple-500 bg-purple-900/40 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]" 
                            : "border-gray-700 bg-gray-800/40 text-gray-400 hover:bg-gray-700/60"
                        }`}
                    >
                        <span className="font-bold text-sm">誰の存在意義も消さない</span>
                    </button>
                )}
                
                {/* ターゲットボタン生成 */}
                {targets.length === 0 ? (
                    <div className="col-span-2 text-center text-gray-500 py-10">
                        <p className="text-sm">選択可能な対象がいません</p>
                    </div>
                ) : (
                    targets.map(p => (
                        <button 
                            key={p.id} 
                            onClick={() => setSelectedId(p.id)} 
                            className={`py-3 px-2 rounded-xl border-2 transition text-center flex flex-col items-center justify-center relative ${
                                selectedId === p.id 
                                ? "border-purple-500 bg-purple-900/40 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]" 
                                : "border-gray-700 bg-gray-800/40 text-gray-400 hover:bg-gray-700/60"
                            }`}
                        >
                            <span className="font-bold text-sm truncate w-full px-1">{p.name}</span>
                        </button>
                    ))
                )}
            </div>
            
            {/* 決定/承認へ進むボタン */}
            <button 
                onClick={needsConsensus ? handlePropose : handleSubmitFinal} 
                disabled={!selectedId || isSubmitting} 
                className="mt-4 w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2 shrink-0"
            >
                {isSubmitting ? <Loader className="animate-spin" size={20}/> : (needsConsensus ? "選択して承認へ" : "決定する")}
            </button>
        </div>
    );
};