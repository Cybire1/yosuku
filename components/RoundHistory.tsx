// @ts-nocheck
'use client';

import { motion } from 'framer-motion';
import { Check, X, Trophy, Clock } from 'lucide-react';
import { formatPred, type RoundState, type UserPosition } from '@/lib/predictionContract';
import { formatStrike, formatTimeRemaining } from '@/lib/roundHelpers';
import { FLOAT_SCALING } from '@/lib/sui/constants';

interface RoundHistoryProps {
  rounds: RoundState[];
  positions: UserPosition[];
  onClaim?: (roundId: string) => void;
}

export default function RoundHistory({ rounds, positions, onClaim }: RoundHistoryProps) {
  const getPosition = (oracleId: string) => positions.find(p => p.roundId === oracleId);

  // Only show rounds the user participated in
  const participatedRounds = rounds.filter(r => getPosition(r.id));

  if (participatedRounds.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">No markets with positions yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-4">
        Market History
      </h3>

      {participatedRounds.map((round, index) => {
        const position = getPosition(round.id)!;
        const userDirection = position.direction;
        const userDeposit = position.quantity;

        // Determine win/loss based on settlement
        const isWinner = round.resolved && round.settlementPrice !== null && (
          userDirection === 'UP' ? round.settlementPrice > round.minStrike : round.settlementPrice <= round.minStrike
        );

        // Payout: winner gets quantity back, loser gets 0
        const payout = isWinner ? userDeposit : 0;
        const canClaim = isWinner && !position.claimed;

        return (
          <motion.div
            key={round.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="p-4 bg-white/[0.03] hover:bg-white/[0.05] border border-white/5 rounded-2xl transition-all"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  round.resolved
                    ? isWinner ? 'bg-new-mint/10' : 'bg-off-red/10'
                    : 'bg-white/5'
                }`}>
                  {round.resolved ? (
                    isWinner ? (
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
                    <span className="text-sm font-bold text-white">{round.underlyingAsset}</span>
                    <span className="text-xs font-mono text-gray-500">
                      {formatStrike(round.minStrike)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {round.resolved ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Settled at {round.settlementPrice ? formatStrike(round.settlementPrice) : 'N/A'}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {formatTimeRemaining(round.endTime)}
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
                    <span className="block text-[10px] text-gray-500">DUSDC</span>
                    {canClaim && onClaim && (
                      <button
                        onClick={() => onClaim(round.id)}
                        className="mt-1 px-3 py-1 bg-new-mint/10 hover:bg-new-mint/20 border border-new-mint/30 rounded-lg text-[10px] font-bold text-new-mint uppercase tracking-wider transition-all"
                      >
                        Claim
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
                    <span className="block text-[10px] text-gray-500">DUSDC</span>
                  </div>
                ) : (
                  <div>
                    <span className="text-sm font-mono text-white">{formatPred(userDeposit)}</span>
                    <span className={`block text-[10px] font-bold ${userDirection === 'UP' ? 'text-new-mint' : 'text-off-red'}`}>
                      {userDirection}
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
