'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Wallet,
  Trophy,
  Check,
  X,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import PredictionStats from '@/components/PredictionStats';
import PnLChart from '@/components/PnLChart';
import {
  BTC_PREDICTION_PROGRAM,
  formatPred,
  fetchMapping,
  parseU64,
  type RoundState,
  type UserPosition,
} from '@/lib/predictionContract';

// Fetch a round's state from on-chain mappings
async function fetchRound(roundId: number): Promise<RoundState | null> {
  try {
    const [targetRaw, deadlineRaw, durationRaw, resolvedRaw, outcomeRaw, yesRaw, noRaw] =
      await Promise.all([
        fetchMapping(BTC_PREDICTION_PROGRAM, 'round_target_price', `${roundId}u64`),
        fetchMapping(BTC_PREDICTION_PROGRAM, 'round_deadline', `${roundId}u64`),
        fetchMapping(BTC_PREDICTION_PROGRAM, 'round_duration', `${roundId}u64`),
        fetchMapping(BTC_PREDICTION_PROGRAM, 'round_resolved', `${roundId}u64`),
        fetchMapping(BTC_PREDICTION_PROGRAM, 'round_outcome', `${roundId}u64`),
        fetchMapping(BTC_PREDICTION_PROGRAM, 'round_yes_pool', `${roundId}u64`),
        fetchMapping(BTC_PREDICTION_PROGRAM, 'round_no_pool', `${roundId}u64`),
      ]);

    if (!targetRaw) return null;

    const targetPrice = parseU64(targetRaw);
    const durationSecs = parseInt(durationRaw?.replace('u32', '').trim() || '300', 10);
    const durationMs = durationSecs * 1000;
    const resolved = resolvedRaw?.trim() === 'true';
    const outcome = resolved ? outcomeRaw?.trim() === 'true' : null;

    return {
      id: roundId,
      targetPrice,
      deadline: parseInt(deadlineRaw?.replace('u32', '').trim() || '0', 10),
      durationMs,
      endTime: Date.now() + durationMs,
      yesPool: parseU64(yesRaw),
      noPool: parseU64(noRaw),
      resolved,
      outcome,
    };
  } catch {
    return null;
  }
}

function loadPositions(): UserPosition[] {
  try {
    const saved: { roundId: number; side: string; amount: number }[] = JSON.parse(
      localStorage.getItem('pred_positions') || '[]'
    );
    const map = new Map<number, UserPosition>();
    for (const p of saved) {
      const existing = map.get(p.roundId);
      if (existing) {
        if (p.side === 'YES') existing.yesDeposit += p.amount;
        else existing.noDeposit += p.amount;
      } else {
        map.set(p.roundId, {
          roundId: p.roundId,
          yesDeposit: p.side === 'YES' ? p.amount : 0,
          noDeposit: p.side === 'NO' ? p.amount : 0,
          claimed: false,
        });
      }
    }
    const claimed: number[] = JSON.parse(localStorage.getItem('pred_claimed') || '[]');
    for (const id of claimed) {
      const pos = map.get(id);
      if (pos) pos.claimed = true;
    }
    return Array.from(map.values());
  } catch {
    return [];
  }
}

export default function PortfolioPage() {
  const router = useRouter();
  const { publicKey, requestTransaction } = useWallet();
  const [rounds, setRounds] = useState<RoundState[]>([]);
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<number | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    const ids = Array.from({ length: 21 }, (_, i) => i);
    const results = await Promise.all(ids.map((id) => fetchRound(id)));
    const found: RoundState[] = [];
    for (const r of results) {
      if (r) found.push(r);
    }
    setRounds(found.sort((a, b) => b.id - a.id));
    setPositions(loadPositions());
    setLoading(false);
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const handleClaim = async (roundId: number) => {
    if (!publicKey || !requestTransaction) return;
    setClaimingId(roundId);
    try {
      await requestTransaction({
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [
          {
            program: BTC_PREDICTION_PROGRAM,
            functionName: 'claim',
            inputs: [`${roundId}u64`],
          },
        ],
        fee: 1000000,
        feePrivate: false,
      });
      const claimed: number[] = JSON.parse(localStorage.getItem('pred_claimed') || '[]');
      if (!claimed.includes(roundId)) {
        claimed.push(roundId);
        localStorage.setItem('pred_claimed', JSON.stringify(claimed));
      }
      setPositions((prev) =>
        prev.map((p) => (p.roundId === roundId ? { ...p, claimed: true } : p))
      );
    } catch (err) {
      console.error('Claim error:', err);
    } finally {
      setClaimingId(null);
    }
  };

  // Compute portfolio-level stats
  const resolvedRounds = rounds.filter((r) => r.resolved && r.outcome !== null);
  const roundsWithPosition = resolvedRounds.filter((r) =>
    positions.some((p) => p.roundId === r.id)
  );

  let totalInvested = 0;
  let totalPnL = 0;
  let claimableAmount = 0;

  for (const round of resolvedRounds) {
    const pos = positions.find((p) => p.roundId === round.id);
    if (!pos) continue;
    const deposit = Math.max(pos.yesDeposit, pos.noDeposit);
    totalInvested += deposit;
    const userSide = pos.yesDeposit > 0 ? 'YES' : 'NO';
    const winningSide = round.outcome ? 'YES' : 'NO';
    if (userSide === winningSide) {
      const totalPool = round.yesPool + round.noPool;
      const winPool = round.outcome ? round.yesPool : round.noPool;
      const payout = winPool > 0 ? (deposit / winPool) * totalPool * 0.9 : 0;
      totalPnL += payout - deposit;
      if (!pos.claimed) claimableAmount += payout;
    } else {
      totalPnL -= deposit;
    }
  }

  // Active (unresolved) positions
  const activePositions = positions.filter((p) => {
    const round = rounds.find((r) => r.id === p.roundId);
    return round && !round.resolved;
  });

  // Resolved positions for history
  const historyItems = resolvedRounds
    .map((round) => {
      const pos = positions.find((p) => p.roundId === round.id);
      return { round, pos };
    })
    .filter(({ pos }) => pos);

  return (
    <div className="min-h-screen bg-neutral-950 overflow-x-hidden selection:bg-white selection:text-black">
      <Header />

      <main className="pt-28 pb-12 relative">
        <div className="max-w-[1100px] mx-auto px-6">
          {/* Page Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 bg-new-mint/10 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-new-mint" />
              </div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-white">
                Portfolio
              </h1>
            </div>
            <p className="text-sm text-gray-500">
              Your BTC prediction performance and positions.
            </p>
          </div>

          {!publicKey ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-neutral-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-16 text-center"
            >
              <Wallet className="w-12 h-12 mx-auto text-gray-600 mb-4" />
              <h2 className="text-lg font-bold text-gray-400 mb-2">Connect Your Wallet</h2>
              <p className="text-sm text-gray-500">
                Connect your wallet to view your portfolio.
              </p>
            </motion.div>
          ) : loading ? (
            <div className="text-center py-20">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-white/10 border-t-new-mint" />
              <p className="mt-4 text-gray-500 text-sm font-bold uppercase tracking-widest">
                Loading...
              </p>
            </div>
          ) : positions.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-neutral-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-16 text-center"
            >
              <Clock className="w-12 h-12 mx-auto text-gray-600 mb-4" />
              <h2 className="text-lg font-bold text-gray-400 mb-2">No Positions Yet</h2>
              <p className="text-sm text-gray-500 mb-6">
                Place your first bet to start tracking your performance.
              </p>
              <button
                onClick={() => router.push('/markets')}
                className="px-6 py-3 bg-new-mint text-black font-bold text-xs uppercase tracking-wider rounded-xl hover:shadow-[0_0_20px_rgba(52,211,153,0.3)] transition-all"
              >
                Go to Markets
              </button>
            </motion.div>
          ) : (
            <div className="space-y-6">
              {/* Stats overview cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="Invested"
                  value={`${formatPred(totalInvested)}`}
                  sub="DART"
                  color="text-white"
                />
                <StatCard
                  label="P&L"
                  value={`${totalPnL >= 0 ? '+' : ''}${formatPred(totalPnL)}`}
                  sub="DART"
                  color={totalPnL >= 0 ? 'text-new-mint' : 'text-off-red'}
                  icon={totalPnL >= 0 ? TrendingUp : TrendingDown}
                />
                <StatCard
                  label="Claimable"
                  value={formatPred(claimableAmount)}
                  sub="DART"
                  color="text-new-mint"
                  icon={Trophy}
                />
                <StatCard
                  label="Rounds"
                  value={String(roundsWithPosition.length)}
                  sub="resolved"
                  color="text-new-blue"
                />
              </div>

              {/* Prediction Stats + P&L Chart side by side on desktop */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <PredictionStats rounds={rounds} positions={positions} />
                <PnLChart rounds={rounds} positions={positions} />
              </div>

              {/* Active Positions */}
              {activePositions.length > 0 && (
                <div className="bg-neutral-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-4">
                    Active Positions
                  </h3>
                  <div className="space-y-2">
                    {activePositions.map((pos) => {
                      const round = rounds.find((r) => r.id === pos.roundId);
                      if (!round) return null;
                      const side = pos.yesDeposit > 0 ? 'YES' : 'NO';
                      const deposit = Math.max(pos.yesDeposit, pos.noDeposit);
                      const totalPool = round.yesPool + round.noPool;
                      const winPool = side === 'YES' ? round.yesPool : round.noPool;
                      const estPayout =
                        winPool > 0 ? (deposit / winPool) * totalPool * 0.9 : 0;

                      return (
                        <div
                          key={pos.roundId}
                          onClick={() => router.push('/markets')}
                          className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-xl hover:bg-white/[0.06] cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                              <Clock className="w-4 h-4 text-gray-500" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">
                                  Round #{round.id}
                                </span>
                                <span className="text-xs font-mono text-gray-500">
                                  ${(round.targetPrice / 100).toFixed(2)}
                                </span>
                              </div>
                              <span
                                className={`text-[10px] font-bold uppercase tracking-wider ${
                                  side === 'YES' ? 'text-new-mint' : 'text-off-red'
                                }`}
                              >
                                {side} &middot; {formatPred(deposit)} DART
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-xs text-gray-500 block">Est. payout</span>
                            <span className="text-sm font-mono font-bold text-white">
                              {formatPred(estPayout)} DART
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Resolved History */}
              {historyItems.length > 0 && (
                <div className="bg-neutral-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] mb-4">
                    Round History
                  </h3>
                  <div className="space-y-2">
                    {historyItems.map(({ round, pos }) => {
                      if (!pos) return null;
                      const userSide = pos.yesDeposit > 0 ? 'YES' : 'NO';
                      const deposit = Math.max(pos.yesDeposit, pos.noDeposit);
                      const winningSide = round.outcome ? 'YES' : 'NO';
                      const isWinner = userSide === winningSide;
                      const totalPool = round.yesPool + round.noPool;
                      const winPool = round.outcome ? round.yesPool : round.noPool;
                      const payout =
                        isWinner && winPool > 0
                          ? (deposit / winPool) * totalPool * 0.9
                          : 0;
                      const canClaim = isWinner && !pos.claimed;

                      return (
                        <div
                          key={round.id}
                          className="flex items-center justify-between p-4 bg-white/[0.03] border border-white/5 rounded-xl"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                                isWinner ? 'bg-new-mint/10' : 'bg-off-red/10'
                              }`}
                            >
                              {isWinner ? (
                                <Check className="w-4 h-4 text-new-mint" />
                              ) : (
                                <X className="w-4 h-4 text-off-red" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">
                                  #{round.id}
                                </span>
                                <span className="text-xs font-mono text-gray-500">
                                  ${(round.targetPrice / 100).toFixed(2)}
                                </span>
                                <span
                                  className={`text-[10px] font-bold uppercase ${
                                    round.outcome ? 'text-new-mint' : 'text-off-red'
                                  }`}
                                >
                                  {round.outcome ? 'YES' : 'NO'} Won
                                </span>
                              </div>
                              <span className="text-[10px] text-gray-500">
                                Your bet: {userSide} &middot; {formatPred(deposit)} DART
                              </span>
                            </div>
                          </div>

                          <div className="text-right flex items-center gap-3">
                            {isWinner ? (
                              <>
                                <div>
                                  <span className="text-sm font-bold text-new-mint">
                                    +{formatPred(payout)}
                                  </span>
                                  <span className="block text-[10px] text-gray-500">DART</span>
                                </div>
                                {canClaim && (
                                  <button
                                    onClick={() => handleClaim(round.id)}
                                    disabled={claimingId === round.id}
                                    className="px-3 py-1.5 bg-new-mint/10 hover:bg-new-mint/20 border border-new-mint/30 rounded-lg text-[10px] font-bold text-new-mint uppercase tracking-wider transition-all disabled:opacity-50"
                                  >
                                    {claimingId === round.id ? '...' : 'Claim'}
                                  </button>
                                )}
                                {pos.claimed && (
                                  <div className="flex items-center gap-1">
                                    <Trophy className="w-3 h-3 text-new-mint" />
                                    <span className="text-[10px] text-new-mint font-bold">
                                      Claimed
                                    </span>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div>
                                <span className="text-sm font-bold text-off-red">
                                  -{formatPred(deposit)}
                                </span>
                                <span className="block text-[10px] text-gray-500">DART</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-neutral-900/60 backdrop-blur-xl border border-white/5 rounded-xl p-4"
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-1">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className={`w-4 h-4 ${color}`} />}
        <span className={`text-xl font-mono font-black ${color}`}>{value}</span>
        <span className="text-xs text-gray-600 ml-0.5">{sub}</span>
      </div>
    </motion.div>
  );
}
