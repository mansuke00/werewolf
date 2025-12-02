import React, { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../config/firebase.js'; 
import { Check, Moon, Lock, Loader, XCircle, CheckCircle, Info, Shield, Eye, Skull, Search, Crosshair } from 'lucide-react';
import { ROLE_DEFINITIONS } from '../../constants/gameData.js'; 

export const NightActionPanel = ({ myRole, players, onActionComplete, myPlayer, teammates, roomCode, roomData, lastActionResult, isDone }) => {
    if (!myPlayer) return null;
    
    // データ整合性のための安全策
    const safePlayers = players || [];

    // 暗殺者の使用済みチェック（Firestoreのsecret/roleDataに含まれる想定だが、簡易的にローカル判定またはサーバーレスポンスで処理）
    // 本格的にはmyPlayerプロップスにsecret情報を含める必要があるが、ここではroomData経由かサーバーエラーで判断
    
    // --- 受動的情報役職（名探偵・霊媒師） ---
    // アクション選択は無く、情報を見るだけの役職
    if (['detective', 'medium'].includes(myRole)) {
        const hasResult = lastActionResult && lastActionResult.length > 0;
        
        const displayCards = hasResult ? lastActionResult : [{ label: myRole === 'detective' ? "調査" : "霊媒", value: "今夜提供できる情報はありません", sub: "", isBad: false, icon: "Info" }];

        // 情報を見たら自動的に「アクション完了」扱いにする
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
                     <Search size={48} className="text-purple-400 animate-bounce-slow"/>
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

    // --- 能動的アクション役職（人狼・占い師・騎士・暗殺者など） ---
    const [selectedId, setSelectedId] = useState(null);
    const [confirmed, setConfirmed] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [waitingResult, setWaitingResult] = useState(false);
    const [assassinUsedMsg, setAssassinUsedMsg] = useState(null);

    // 人狼チーム、暗殺者チームなどはチーム単位でキーを管理
    let teamKey = myRole;
    if (['werewolf', 'greatwolf'].includes(myRole)) teamKey = 'werewolf_team';
    if (myRole === 'assassin') teamKey = 'assassin'; // 暗殺者もチーム行動（複数人の場合）
    
    const pendingAction = roomData?.pendingActions?.[teamKey];
    const leaderId = roomData?.nightLeaders?.[teamKey];
    
    // 生存しているチームメイトを確認
    const livingTeammates = (teammates || []).filter(t => {
        const p = safePlayers.find(pl => pl.id === t.id);
        return p && p.status === 'alive';
    });
    
    const isSolo = livingTeammates.length === 0;

    // ソロ（占い師等）またはチームリーダーかどうか
    const isLeader = isSolo ? true : (leaderId ? leaderId === myPlayer.id : false); 
    
    const needsConsensus = !isSolo;
    const leaderName = safePlayers.find(p => p.id === leaderId)?.name || "---";

    const myLeaderId = leaderId || myPlayer.id;
    // 占い師・賢者は結果が返ってくるまで待機するモードがある
    const hasResultWait = ['seer', 'sage'].includes(myRole);
    const isActionDone = isDone || roomData?.nightActions?.[myLeaderId] !== undefined || (isSolo && roomData?.nightActions?.[myPlayer.id] !== undefined);

    // 暗殺者が既に使用済みかどうかチェック
    useEffect(() => {
        if (myRole === 'assassin') {
            const checkAssassinUsage = async () => {
                // サーバーから情報をとるのが確実だが、ここではroomDataに含まれるフラグを確認する実装例
                // ※Functions側で `room.assassinUsed` を更新する想定
                if (roomData?.assassinUsed) {
                    setAssassinUsedMsg("暗殺者は一度のみ暗殺できます（使用済み）");
                    onActionComplete(); // アクション不要にする
                }
            };
            checkAssassinUsage();
        }
    }, [myRole, roomData, onActionComplete]);

    // ステータス同期
    useEffect(() => {
        if (!pendingAction) setConfirmed(false);

        if (isActionDone) {
             if (hasResultWait) {
                 if (lastActionResult && lastActionResult.length > 0) {
                     setConfirmed(true);
                     setWaitingResult(false);
                     onActionComplete();
                 } else {
                     setWaitingResult(true);
                 }
             } else {
                 setConfirmed(true);
                 onActionComplete();
             }
        }
    }, [pendingAction, confirmed, isLeader, livingTeammates.length, roomCode, onActionComplete, isActionDone, hasResultWait, lastActionResult]);

    // チームリーダー：提案
    const handlePropose = async () => { 
        if((!selectedId && myRole !== 'assassin') || isSubmitting) return; // 暗殺者はスキップ可能なのでselectedIdなしでもOKな場合があるが、基本は選択
        
        // 暗殺者の「今夜は暗殺しない」処理
        if (myRole === 'assassin' && selectedId === 'skip') {
             // スキップ処理
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
    
    // チームメンバー：投票
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
    
    // ソロまたは最終決定
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
    
    // 選択可能なターゲットのフィルタリング
    const targets = safePlayers.filter(p => {
        if (!p || p.status === 'dead') return false;
        if (teammates && teammates.some(t => t.id === p.id)) return false; // 仲間は選べない
        if (['werewolf', 'greatwolf'].includes(myRole) && p.id === myPlayer.id) return false;
        if (['seer', 'sage'].includes(myRole) && p.id === myPlayer.id) return false;
        if (['knight', 'trapper'].includes(myRole) && myPlayer.lastTarget === p.id) return false; // 連続護衛不可
        if (myRole === 'assassin' && p.id === myPlayer.id) return false;
        return true;
    });

    let prompt = "対象を選択";
    let doneTitle = "アクション完了";
    let doneIcon = Check;
    
    if (['werewolf', 'greatwolf'].includes(myRole)) {
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
        prompt = "誰を暗殺しますか？";
        doneTitle = "暗殺設定完了";
        doneIcon = Crosshair;
    }

    // 使用済みの場合の表示
    if (assassinUsedMsg) {
        return (
            <div className="flex flex-col h-full p-4 animate-fade-in items-center justify-center text-center bg-gray-900/80 rounded-xl border border-gray-700">
                <Crosshair size={48} className="text-gray-500 mb-4"/>
                <h3 className="text-lg font-bold text-gray-400">{assassinUsedMsg}</h3>
            </div>
        );
    }

    const showResultScreen = confirmed || (isActionDone && (!hasResultWait || (lastActionResult && lastActionResult.length > 0)));

    // 結果表示画面
    if (showResultScreen) {
        const actionData = roomData?.nightActions?.[myLeaderId] || roomData?.nightActions?.[myPlayer.id];
        const targetName = actionData ? (actionData.targetId === 'skip' ? "暗殺しない" : safePlayers.find(p => p.id === actionData.targetId)?.name) : (selectedId ? (selectedId==='skip'?"暗殺しない":safePlayers.find(p=>p.id===selectedId)?.name) : "---");
        const resultCards = lastActionResult || [];
        
        return (
            <div className="flex flex-col h-full p-4 animate-fade-in items-center justify-center text-center bg-gray-900/80 rounded-xl ring-4 ring-yellow-400/50">
                <div className="bg-white/10 p-4 rounded-full mb-4 animate-bounce-slow">
                     {React.createElement(doneIcon, { size: 48, className: "text-yellow-400" })}
                </div>
                <h3 className="text-xl font-bold text-white mb-2">今夜のアクションは終了しました</h3>
                
                <div className="mt-4 w-full max-w-sm bg-black/40 border border-white/10 rounded-xl p-4">
                     <p className="text-xs text-gray-400 font-bold uppercase mb-2">{doneTitle}</p>
                     <p className="text-lg text-white font-bold">
                         <span className="text-yellow-400">{targetName}</span> を{
                            ['werewolf', 'greatwolf'].includes(myRole) ? "襲撃しました" :
                            ['seer', 'sage'].includes(myRole) ? "占いました" :
                            myRole === 'assassin' ? (targetName === "暗殺しない" ? "選択しました" : "暗殺対象にしました") :
                            "護衛しました"
                         }
                     </p>
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

    if (waitingResult) {
        return (
            <div className="flex flex-col h-full p-4 animate-fade-in items-center justify-center text-center bg-gray-900/80 rounded-xl border border-purple-500/50">
                <Loader size={48} className="text-purple-400 animate-spin mb-4"/>
                <h3 className="text-xl font-bold text-white mb-2">結果を確認中...</h3>
                <p className="text-gray-400 text-sm">サーバーからの応答を待っています。</p>
            </div>
        );
    }

    // チーム行動の待機・投票画面
    if (needsConsensus) {
        if (!leaderId) {
             return (
                <div className="flex flex-col h-full p-4 animate-fade-in bg-gray-900/80 rounded-xl border border-purple-500/30 items-center justify-center text-center">
                    <Loader size={32} className="text-purple-400 animate-spin mb-2"/>
                    <p className="text-gray-400 text-sm">リーダーを選出中...</p>
                    <p className="text-xs text-gray-500 mt-2">画面が変わらない場合は、一度リロードしてください</p>
                </div>
             );
        }

        if (!pendingAction && !isLeader) {
            return (
                <div className="flex flex-col h-full p-4 animate-fade-in bg-gray-900/80 rounded-xl border border-purple-500/30 items-center justify-center text-center">
                    <div className="flex flex-col items-center">
                        <Lock size={48} className="text-gray-600 mb-4"/>
                        <h3 className="text-xl font-bold text-white mb-2">今晩のリーダーは {leaderName} さんです</h3>
                        <p className="text-gray-400 text-sm">リーダーが代表して対象者を選択します...</p>
                    </div>
                </div>
            );
        }

        if (pendingAction && isLeader) {
            const targetName = pendingAction.targetId === 'skip' ? "暗殺しない" : (safePlayers.find(p=>p.id===pendingAction.targetId)?.name || "不明");
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

        if (pendingAction && !isLeader) {
            const targetName = pendingAction.targetId === 'skip' ? "暗殺しない" : (safePlayers.find(p=>p.id===pendingAction.targetId)?.name || "不明");
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

    // ターゲット選択画面
    return (
        <div className="flex flex-col h-full p-4 animate-fade-in bg-gray-900/80 rounded-xl ring-4 ring-purple-500/30">
            <div className="text-center mb-4">
                <h3 className="text-lg font-bold text-white flex items-center justify-center gap-2 mb-1">
                    <Moon className="text-purple-400" size={20}/> {prompt}
                </h3>
                {needsConsensus && (
                    <p className="text-xs text-yellow-300 bg-yellow-900/30 px-2 py-1 rounded border border-yellow-500/30">
                        役職チャットで誰を選択するかを話し合い、チームを代表して選択してください。
                    </p>
                )}
                {['knight', 'trapper'].includes(myRole) && myPlayer.lastTarget && (
                    <p className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded border border-red-500/30 mt-2">
                        ※前回護衛したプレイヤー ({safePlayers.find(p => p.id === myPlayer.lastTarget)?.name}) は選択できません。
                    </p>
                )}
            </div>

            <div className="grid grid-cols-2 gap-2 overflow-y-auto flex-1 custom-scrollbar min-h-0">
                {myRole === 'assassin' && (
                    <button 
                        onClick={() => setSelectedId('skip')} 
                        className={`py-3 px-2 rounded-xl border-2 transition text-center flex flex-col items-center justify-center relative col-span-2 ${
                            selectedId === 'skip'
                            ? "border-purple-500 bg-purple-900/40 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)]" 
                            : "border-gray-700 bg-gray-800/40 text-gray-400 hover:bg-gray-700/60"
                        }`}
                    >
                        <span className="font-bold text-sm">今晩は暗殺しない</span>
                    </button>
                )}
                
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
                            <span className="font-bold text-sm truncate w-full">{p.name}</span>
                        </button>
                    ))
                )}
            </div>
            
            <button 
                onClick={needsConsensus ? handlePropose : handleSubmitFinal} 
                disabled={!selectedId || isSubmitting} 
                className="mt-4 w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition transform active:scale-95 flex items-center justify-center gap-2"
            >
                {isSubmitting ? <Loader className="animate-spin" size={20}/> : (needsConsensus ? "選択して承認へ" : "決定する")}
            </button>
        </div>
    );
};