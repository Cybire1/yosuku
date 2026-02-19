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
  PieChart,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import PredictionStats from '@/components/PredictionStats';
import PnLChart from '@/components/PnLChart';
import {
  BTC_PREDICTION_PROGRAM,
  formatPred,
  calcPayoutWithBonus,
  fetchReputation,
  type RoundState,
  type UserPosition,
  type ReputationData,
} from '@/lib/predictionContract';
import { fetchRound, loadPositions } from '@/lib/roundHelpers';
import ReputationCard from '@/components/ReputationCard';
import ReputationBadge from '@/components/ReputationBadge';

export default function PortfolioPage() {
  const router = useRouter();
  const { publicKey, requestTransaction, requestRecords } = useWallet();
  const [rounds, setRounds] = useState<RoundState[]>([]);
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const scan = useCallback(async () => {
    setLoading(true);
    const allPositions = loadPositions();
    setPositions(allPositions);

    // Only fetch rounds that the user has positions in
    const roundIds = [...new Set(allPositions.map(p => p.roundId))];

    // Also fetch the latest few rounds for context
    const lastKnown = parseInt(localStorage.getItem('dart_last_round_id') || '0', 10);
    if (lastKnown > 0) {
      for (let i = Math.max(0, lastKnown - 4); i <= lastKnown; i++) {
        if (!roundIds.includes(i)) roundIds.push(i);
      }
    }

    const results = await Promise.all(roundIds.map(id => fetchRound(id)));
    const found: RoundState[] = [];
    for (const r of results) {
      if (r) found.push(r);
    }
    setRounds(found.sort((a, b) => b.id - a.id));

    // Filter positions to only those with matching on-chain rounds
    const validIds = new Set(found.map(r => r.id));
    const validPositions = allPositions.filter(p => validIds.has(p.roundId));
    setPositions(validPositions);

    // Fetch reputation data
    if (publicKey) {
      try {
        const rep = await fetchReputation(publicKey);
        setReputation(rep);
      } catch {
        // Reputation not available yet (first time user)
      }
    }

    setLoading(false);
  }, [publicKey]);

  useEffect(() => {
    scan();
  }, [scan]);

  const handleClaim = async (roundId: number) => {
    if (!publicKey || !requestTransaction) return;

    const round = rounds.find((r) => r.id === roundId);
    const pos = positions.find((p) => p.roundId === roundId);
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
        setClaimingId(null);
        return;
      }

      const recordInput = (receipt as Record<string, unknown>).plaintext as string
        || JSON.stringify(receipt);

      await requestTransaction({
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [
          {
            program: BTC_PREDICTION_PROGRAM,
            functionName: 'claim',
            inputs: [recordInput, `${netPayout}u64`],
          },
        ],
        fee: 2_000_000,
        feePrivate: false,
      });
      // Credit payout to localStorage balance
      const curBalance = parseInt(localStorage.getItem('dart_balance') || '0', 10);
      localStorage.setItem('dart_balance', String(curBalance + netPayout));

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
    <div className="min-h-screen overflow-x-hidden selection:bg-white selection:text-black">
      <Header />

      <main className="pt-28 pb-12 relative">
        <motion.div
          className="max-w-[1100px] mx-auto px-6"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.1 }
            }
          }}
        >
          {/* Page Header */}
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 30 },
              visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 25, stiffness: 200 } }
            }}
            className="mb-8"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 bg-new-mint/10 rounded-lg flex items-center justify-center">
                <PieChart className="w-4 h-4 text-new-mint" />
              </div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-white">
                Portfolio
              </h1>
            </div>
            <p className="text-sm text-gray-500">
              Your BTC prediction performance and positions.
            </p>
          </motion.div>

          {!mounted ? (
            <div className="text-center py-20">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-white/10 border-t-new-mint" />
              <p className="mt-4 text-gray-500 text-sm font-bold uppercase tracking-widest">
                Loading...
              </p>
            </div>
          ) : !publicKey ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative overflow-hidden bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-[32px] p-20 text-center shadow-2xl"
            >
              {/* Premium Glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-new-mint/20 blur-[100px] rounded-full pointer-events-none" />

              <div className="relative z-10 w-24 h-24 mx-auto mb-6 bg-gradient-to-b from-neutral-800 to-black rounded-full border border-white/10 flex items-center justify-center shadow-inner">
                <div className="absolute inset-0 bg-new-mint/20 blur-xl rounded-full animate-pulse" />
                <Wallet className="w-10 h-10 text-white/70 relative z-10" />
              </div>
              <h2 className="relative z-10 text-3xl font-black text-white tracking-tight mb-3">Connect Your Wallet</h2>
              <p className="relative z-10 text-gray-400 max-w-sm mx-auto">
                Connect your Aleo wallet to track your positions, view your P&L, and claim your winnings.
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
              className="relative overflow-hidden bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-[32px] p-20 text-center shadow-2xl"
            >
              {/* Premium Glow */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-new-blue/20 blur-[100px] rounded-full pointer-events-none" />

              <div className="relative z-10 w-24 h-24 mx-auto mb-6 bg-gradient-to-b from-neutral-800 to-black rounded-full border border-white/10 flex items-center justify-center shadow-inner group">
                <div className="absolute inset-0 bg-new-blue/20 blur-xl rounded-full group-hover:bg-new-blue/30 transition-all duration-500" />
                <Clock className="w-10 h-10 text-white/70 relative z-10 group-hover:scale-110 transition-transform duration-500" />
              </div>
              <h2 className="relative z-10 text-3xl font-black text-white tracking-tight mb-3">No Active Positions</h2>
              <p className="relative z-10 text-gray-400 max-w-sm mx-auto mb-8">
                You haven't placed any predictions yet. Head over to the markets to make your first trade.
              </p>
              <button
                onClick={() => router.push('/markets')}
                className="relative z-10 px-8 py-4 bg-new-blue text-white font-bold text-sm uppercase tracking-widest rounded-2xl hover:bg-new-blue/90 shadow-[0_0_30px_rgba(59,130,246,0.3)] hover:shadow-[0_0_40px_rgba(59,130,246,0.5)] hover:scale-105 active:scale-95 transition-all"
              >
                Go to Markets
              </button>
            </motion.div>
          ) : (
            <motion.div
              variants={{
                hidden: { opacity: 0, scale: 0.95 },
                visible: { opacity: 1, scale: 1, transition: { type: 'spring', damping: 25, stiffness: 200 } }
              }}
              className="space-y-6"
            >
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

              {/* Reputation + Charts */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {reputation && <ReputationCard data={reputation} />}
                <div className={`${reputation ? 'md:col-span-2' : 'md:col-span-3'} grid grid-cols-1 md:grid-cols-2 gap-4`}>
                  <PredictionStats rounds={rounds} positions={positions} />
                  <PnLChart rounds={rounds} positions={positions} />
                </div>
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
                                className={`text-[10px] font-bold uppercase tracking-wider ${side === 'YES' ? 'text-new-mint' : 'text-off-red'
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
                              className={`w-8 h-8 rounded-full flex items-center justify-center ${isWinner ? 'bg-new-mint/10' : 'bg-off-red/10'
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
                                  className={`text-[10px] font-bold uppercase ${round.outcome ? 'text-new-mint' : 'text-off-red'
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
            </motion.div>
          )}
        </motion.div>
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
