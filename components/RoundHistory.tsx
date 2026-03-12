'use client';

import { motion } from 'framer-motion';
import { Check, X, Trophy, Clock, Lock, Unlock } from 'lucide-react';
import { formatPred, calcPayoutWithBonus, setOptimisticBalance, fetchOnChainBalance, type RoundState, type UserPosition, type ReputationData } from '@/lib/predictionContract';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { BTC_PREDICTION_PROGRAM } from '@/lib/predictionContract';
import { executeWithRetry } from '@/lib/walletExecution';
import { useState } from 'react';

interface RoundHistoryProps {
  rounds: RoundState[];
  positions: UserPosition[];
  reputation?: ReputationData;
  onClaim?: (roundId: number) => void;
}

export default function RoundHistory({ rounds, positions, reputation, onClaim }: RoundHistoryProps) {
  const { address, executeTransaction } = useWallet();
  const [claimingId, setClaimingId] = useState<number | null>(null);

  const getPosition = (roundId: number) => positions.find(p => p.roundId === roundId);

  const handleClaim = async (roundId: number) => {
    if (!address || !executeTransaction) return;

    const round = rounds.find(r => r.id === roundId);
    const pos = getPosition(roundId);
    if (!round || !pos) return;

    const deposit = Math.max(pos.yesDeposit, pos.noDeposit);
    const totalPool = round.yesPool + round.noPool;
    const winPool = round.outcome ? round.yesPool : round.noPool;
    if (winPool === 0) return;

    // Calculate payout with tier bonus
    const bonusPct = reputation?.bonusPct ?? 0;
    const netPayout = calcPayoutWithBonus(deposit, winPool, totalPool, bonusPct);

    setClaimingId(roundId);
    try {
      // v8 commitment-based claim: reveal preimage (side, amt, salt) + payout
      const { getBetCommitment } = await import('@/lib/roundHelpers');
      const commitment = getBetCommitment(address, roundId);
      if (!commitment) {
        setClaimingId(null);
        return;
      }
      const sideVal = commitment.side === 'YES' ? 'true' : 'false';
      await executeWithRetry(() =>
        executeTransaction({
          program: BTC_PREDICTION_PROGRAM,
          function: 'claim',
          inputs: [
            `${roundId}u64`,
            sideVal,
            `${commitment.amount}u128`,
            commitment.salt,
            `${netPayout}u128`,
          ],
          fee: 2_000_000,
          privateFee: false,
        })
      );

      // Optimistic balance update
      const curBalance = parseInt(localStorage.getItem('usdcx_balance') || '0', 10);
      setOptimisticBalance(curBalance + netPayout);

      // Kick off on-chain refresh after delay
      setTimeout(() => {
        if (address) fetchOnChainBalance(address);
      }, 10_000);

      onClaim?.(roundId);
    } catch (err) {
      console.error('Claim error:', err);
    } finally {
      setClaimingId(null);
    }
  };

  // Only show rounds the user participated in
  const participatedRounds = rounds.filter(r => getPosition(r.id));

  if (participatedRounds.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">No rounds with positions yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-4">
        Round History
      </h3>

      {participatedRounds.map((round, index) => {
        const position = getPosition(round.id)!;
        const userSide = position.yesDeposit > 0 ? 'YES' : position.noDeposit > 0 ? 'NO' : null;
        const userDeposit = position
          ? Math.max(position.yesDeposit, position.noDeposit)
          : 0;
        const isWinner = round.resolved && userSide === (round.outcome ? 'YES' : 'NO');
        const canClaim = isWinner && position && !position.claimed && (round.yesPool + round.noPool) > 0;

        // Calculate payout — only possible after resolution when pools revealed
        const totalPool = round.yesPool + round.noPool;
        const winPool = round.outcome ? round.yesPool : round.noPool;
        const payout = isWinner && winPool > 0
          ? (userDeposit / winPool) * totalPool * 0.9
          : 0;

        // Dark pool state
        const isDarkPool = !round.resolved && round.totalPool > 0 && round.yesPool === 0 && round.noPool === 0;

        return (
          <motion.div
            key={round.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="p-4 bg-white/[0.03] hover:bg-white/[0.05] border border-white/5 rounded-2xl transition-all"
          >
            <div className="flex items-center justify-between">
              {/* Left: Round info */}
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  round.resolved
                    ? round.outcome ? 'bg-new-mint/10' : 'bg-off-red/10'
                    : 'bg-white/5'
                }`}>
                  {round.resolved ? (
                    round.outcome ? (
                      <Check className="w-4 h-4 text-new-mint" />
                    ) : (
                      <X className="w-4 h-4 text-off-red" />
                    )
                  ) : (
                    <Clock className="w-4 h-4 text-gray-500" />
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">#{round.id}</span>
                    <span className="text-xs font-mono text-gray-500">
                      ${(round.targetPrice / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {round.resolved ? (
                      <>
                        <Unlock className="w-2.5 h-2.5 text-gray-500" />
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          round.outcome ? 'text-new-mint' : 'text-off-red'
                        }`}>
                          {round.outcome ? 'YES Won' : 'NO Won'}
                        </span>
                        <span className="text-[10px] text-gray-600">
                          Pool: {formatPred(totalPool)} ({formatPred(round.yesPool)}Y / {formatPred(round.noPool)}N)
                        </span>
                      </>
                    ) : isDarkPool ? (
                      <>
                        <Lock className="w-2.5 h-2.5 text-sky-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
                          Dark Pool
                        </span>
                        <span className="text-[10px] text-gray-600">
                          Total: {formatPred(round.totalPool)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        Pending
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: User result */}
              <div className="text-right">
                {isWinner ? (
                  <div>
                    <span className="text-sm font-bold text-new-mint">+{formatPred(payout)}</span>
                    <span className="block text-[10px] text-gray-500">USDCx</span>
                    {canClaim && (
                      <button
                        onClick={() => handleClaim(round.id)}
                        disabled={claimingId === round.id}
                        className="mt-1 px-3 py-1 bg-new-mint/10 hover:bg-new-mint/20 border border-new-mint/30 rounded-lg text-[10px] font-bold text-new-mint uppercase tracking-wider transition-all disabled:opacity-50"
                      >
                        {claimingId === round.id ? '...' : 'Claim'}
                      </button>
                    )}
                    {position.claimed && (
                      <div className="flex items-center gap-1 justify-end mt-1">
                        <Trophy className="w-3 h-3 text-new-mint" />
                        <span className="text-[10px] text-new-mint font-bold">Claimed</span>
                      </div>
                    )}
                  </div>
                ) : round.resolved ? (
                  <div>
                    <span className="text-sm font-bold text-off-red">-{formatPred(userDeposit)}</span>
                    <span className="block text-[10px] text-gray-500">USDCx</span>
                  </div>
                ) : (
                  <div>
                    <span className="text-sm font-mono text-white">{formatPred(userDeposit)}</span>
                    <span className={`block text-[10px] font-bold ${userSide === 'YES' ? 'text-new-mint' : 'text-off-red'}`}>
                      {userSide}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
