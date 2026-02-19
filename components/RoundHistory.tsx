'use client';

import { motion } from 'framer-motion';
import { Check, X, Trophy, Clock } from 'lucide-react';
import { formatPred, calcPayoutWithBonus, type RoundState, type UserPosition, type ReputationData } from '@/lib/predictionContract';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { BTC_PREDICTION_PROGRAM } from '@/lib/predictionContract';
import ReputationBadge from './ReputationBadge';
import { useState } from 'react';

interface RoundHistoryProps {
  rounds: RoundState[];
  positions: UserPosition[];
  reputation?: ReputationData;
  onClaim?: (roundId: number) => void;
}

export default function RoundHistory({ rounds, positions, reputation, onClaim }: RoundHistoryProps) {
  const { publicKey, requestTransaction, requestRecords } = useWallet();
  const [claimingId, setClaimingId] = useState<number | null>(null);

  const getPosition = (roundId: number) => positions.find(p => p.roundId === roundId);

  const handleClaim = async (roundId: number) => {
    if (!publicKey || !requestTransaction) return;

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
      // Fetch user's BetReceipt records from wallet
      const records = await requestRecords?.(BTC_PREDICTION_PROGRAM);
      const receiptList = Array.isArray(records) ? records : [];
      // Find receipt matching this round
      const receipt = receiptList.find((r: Record<string, unknown>) => {
        const data = (r as Record<string, unknown>).data as Record<string, string> | undefined;
        const plaintext = (r as Record<string, unknown>).plaintext as string | undefined;
        if (data?.round_id) {
          return data.round_id === `${roundId}u64` || data.round_id === `${roundId}u64.private`;
        }
        if (plaintext) {
          return plaintext.includes(`round_id: ${roundId}u64`);
        }
        return false;
      });

      if (!receipt) {
        console.error('BetReceipt not found for round', roundId);
        return;
      }

      // Pass the record plaintext as input
      const recordInput = (receipt as Record<string, unknown>).plaintext as string
        || JSON.stringify(receipt);

      await requestTransaction({
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: BTC_PREDICTION_PROGRAM,
          functionName: 'claim',
          inputs: [recordInput, `${netPayout}u64`],
        }],
        fee: 1_000_000,
        feePrivate: false,
      });

      // Credit payout to local balance
      const curBalance = parseInt(localStorage.getItem('dart_balance') || '0', 10);
      localStorage.setItem('dart_balance', String(curBalance + netPayout));

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

        // Calculate payout
        const totalPool = round.yesPool + round.noPool;
        const winPool = round.outcome ? round.yesPool : round.noPool;
        const payout = isWinner && winPool > 0
          ? (userDeposit / winPool) * totalPool * 0.9
          : 0;

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
                      <span className={`text-[10px] font-bold uppercase tracking-wider ${
                        round.outcome ? 'text-new-mint' : 'text-off-red'
                      }`}>
                        {round.outcome ? 'YES Won' : 'NO Won'}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        Pending
                      </span>
                    )}
                    <span className="text-[10px] text-gray-600">
                      Pool: {formatPred(totalPool)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: User result */}
              <div className="text-right">
                {isWinner ? (
                  <div>
                    <span className="text-sm font-bold text-new-mint">+{formatPred(payout)}</span>
                    <span className="block text-[10px] text-gray-500">DART</span>
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
                    <span className="block text-[10px] text-gray-500">DART</span>
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
