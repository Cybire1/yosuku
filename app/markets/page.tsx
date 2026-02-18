'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Header from '@/components/Header';
import RoundCard from '@/components/RoundCard';
import BetPanel from '@/components/BetPanel';
import RoundHistory from '@/components/RoundHistory';
import Comments from '@/components/Comments';
import TokenBalance from '@/components/TokenBalance';
import TokenFaucet from '@/components/TokenFaucet';
import PredictionStats from '@/components/PredictionStats';
import PnLChart from '@/components/PnLChart';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import {
  BTC_PREDICTION_PROGRAM,
  PRED_MULTIPLIER,
  fetchMapping,
  parseU64,
  formatPred,
  DURATION_OPTIONS,
  type DurationLabel,
  type RoundState,
  type UserPosition,
} from '@/lib/predictionContract';
import { Activity, Timer, Radio, Trophy, XCircle } from 'lucide-react';
import BitcoinIcon from '@/components/icons/BitcoinIcon';

// Avg block time on Aleo testnet (~3.5s)
const AVG_BLOCK_TIME_MS = 3500;

// Fetch current block height (cached briefly)
let cachedHeight = 0;
let heightFetchedAt = 0;
async function getBlockHeight(): Promise<number> {
  if (cachedHeight > 0 && Date.now() - heightFetchedAt < 10_000) return cachedHeight;
  try {
    const res = await fetch(`https://api.explorer.provable.com/v1/testnet/latest/height`);
    if (!res.ok) return cachedHeight;
    cachedHeight = parseInt(await res.text(), 10);
    heightFetchedAt = Date.now();
    return cachedHeight;
  } catch {
    return cachedHeight;
  }
}

// Fetch a round's state from on-chain mappings
async function fetchRound(roundId: number): Promise<RoundState | null> {
  try {
    const [targetRaw, deadlineRaw, durationRaw, resolvedRaw, outcomeRaw, yesRaw, noRaw, currentHeight] = await Promise.all([
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_target_price', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_deadline', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_duration', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_resolved', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_outcome', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_yes_pool', `${roundId}u64`),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'round_no_pool', `${roundId}u64`),
      getBlockHeight(),
    ]);

    if (!targetRaw) return null;

    const targetPrice = parseU64(targetRaw);
    const deadline = parseInt(deadlineRaw?.replace('u32', '').trim() || '0', 10);
    const durationSecs = parseInt(durationRaw?.replace('u32', '').trim() || '300', 10);
    const durationMs = durationSecs * 1000;
    const resolved = resolvedRaw?.trim() === 'true';
    const outcome = resolved ? outcomeRaw?.trim() === 'true' : null;

    // Calculate endTime from blocks remaining, not from duration
    const blocksLeft = Math.max(0, deadline - currentHeight);
    const msLeft = blocksLeft * AVG_BLOCK_TIME_MS;
    const endTime = Date.now() + msLeft;

    return {
      id: roundId,
      targetPrice,
      deadline,
      durationMs,
      endTime,
      yesPool: parseU64(yesRaw),
      noPool: parseU64(noRaw),
      resolved,
      outcome,
    };
  } catch {
    return null;
  }
}

// Read positions from localStorage and aggregate by round
function loadPositions(): UserPosition[] {
  try {
    const saved: { roundId: number; side: string; amount: number }[] =
      JSON.parse(localStorage.getItem('pred_positions') || '[]');

    // Aggregate multiple bets on the same round
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

    // Restore claimed status
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

export default function MarketsPage() {
  const { publicKey } = useWallet();
  const { price, change24h } = useBtcPrice();
  const [onChainRound, setOnChainRound] = useState<RoundState | null>(null);
  const [pastRounds, setPastRounds] = useState<RoundState[]>([]);
  const [userPositions, setUserPositions] = useState<UserPosition[]>([]);
  const [mintTrigger, setMintTrigger] = useState(0);
  const [selectedDuration, setSelectedDuration] = useState<DurationLabel>('5 Minutes');
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [demoRound, setDemoRound] = useState<RoundState | null>(null);
  const [notification, setNotification] = useState<{ type: 'win' | 'lose'; amount: number; roundId: number } | null>(null);
  const demoStartRef = useRef<number>(0);
  const demoTargetRef = useRef<number>(0);
  const prevResolvedRef = useRef<Set<number>>(new Set());

  const durationMs = DURATION_OPTIONS.find(d => d.label === selectedDuration)!.seconds * 1000;

  // Generate a live demo round when no on-chain round exists
  useEffect(() => {
    if (onChainRound || loading) return;
    if (price <= 0) return;

    if (demoStartRef.current === 0) {
      demoStartRef.current = Date.now();
      const offset = (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 150);
      demoTargetRef.current = Math.round(price * 100 + offset);
    }

    const elapsed = Date.now() - demoStartRef.current;
    if (elapsed >= durationMs) {
      demoStartRef.current = Date.now();
      const offset = (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 150);
      demoTargetRef.current = Math.round(price * 100 + offset);
    }

    setDemoRound({
      id: 0,
      targetPrice: demoTargetRef.current,
      deadline: 0,
      durationMs,
      endTime: demoStartRef.current + durationMs,
      yesPool: 500 * PRED_MULTIPLIER,
      noPool: 500 * PRED_MULTIPLIER,
      resolved: false,
      outcome: null,
    });
    setIsDemo(true);
  }, [onChainRound, loading, price, durationMs]);

  // Reset demo when duration changes
  useEffect(() => {
    if (isDemo) {
      demoStartRef.current = 0;
      demoTargetRef.current = 0;
    }
  }, [selectedDuration, isDemo]);

  // Active round: on-chain takes priority, fallback to demo
  const currentRound = onChainRound ?? demoRound;

  // Find highest round via binary search, then fetch recent rounds
  const scanForRounds = useCallback(async () => {
    setLoading(true);

    // Binary search for highest existing round ID
    let lo = 0, hi = 500;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const exists = await fetchMapping(BTC_PREDICTION_PROGRAM, 'round_target_price', `${mid}u64`);
      if (exists) lo = mid; else hi = mid - 1;
    }
    const highestId = lo;

    // If no rounds exist at all
    if (highestId === 0) {
      const r0 = await fetchRound(0);
      if (!r0) { setLoading(false); return; }
    }

    // Fetch the last ~10 rounds in parallel (enough for history + active)
    const startId = Math.max(0, highestId - 9);
    const ids = Array.from({ length: highestId - startId + 1 }, (_, i) => startId + i);
    const results = await Promise.all(ids.map(id => fetchRound(id)));

    const foundRounds: RoundState[] = [];
    let latestActive: RoundState | null = null;
    const resolvedIds = new Set<number>();

    for (const round of results) {
      if (!round) continue;
      if (round.resolved) {
        foundRounds.push(round);
        resolvedIds.add(round.id);
      } else if (!latestActive) {
        latestActive = round;
      }
    }

    prevResolvedRef.current = resolvedIds;

    if (latestActive) {
      setOnChainRound(latestActive);
      setIsDemo(false);
    }
    setPastRounds(foundRounds.reverse().slice(0, 20));
    setUserPositions(loadPositions());
    setLoading(false);
  }, []);

  useEffect(() => {
    scanForRounds();
  }, [scanForRounds]);

  // Poll on-chain round every 10s — detect resolution + pool updates
  useEffect(() => {
    if (!onChainRound) return;

    const poll = async () => {
      const updated = await fetchRound(onChainRound.id);
      if (!updated) return;

      // Round just resolved!
      if (updated.resolved && !onChainRound.resolved) {
        // Check if user had a position
        const positions = loadPositions();
        const pos = positions.find(p => p.roundId === updated.id);
        if (pos) {
          const userSide = pos.yesDeposit > 0 ? 'YES' : 'NO';
          const winningSide = updated.outcome ? 'YES' : 'NO';
          const userDeposit = Math.max(pos.yesDeposit, pos.noDeposit);
          const isWinner = userSide === winningSide;

          if (isWinner) {
            const totalPool = updated.yesPool + updated.noPool;
            const winPool = updated.outcome ? updated.yesPool : updated.noPool;
            const payout = winPool > 0 ? (userDeposit / winPool) * totalPool * 0.9 : 0;
            setNotification({ type: 'win', amount: payout, roundId: updated.id });
          } else {
            setNotification({ type: 'lose', amount: userDeposit, roundId: updated.id });
          }
          setTimeout(() => setNotification(null), 8000);
        }

        // Move to past rounds and look for next active
        setPastRounds(prev => [updated, ...prev].slice(0, 20));

        // Scan for next active round
        const nextId = onChainRound.id + 1;
        const next = await fetchRound(nextId);
        if (next && !next.resolved) {
          setOnChainRound(next);
        } else {
          setOnChainRound(null); // will fallback to demo
          setIsDemo(false);
          demoStartRef.current = 0;
        }

        setUserPositions(loadPositions());
        return;
      }

      // Normal update — keep endTime stable
      setOnChainRound(prev => prev ? { ...updated, endTime: prev.endTime } : updated);
    };

    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [onChainRound?.id, onChainRound?.resolved]);

  const handleDurationChange = (label: DurationLabel) => {
    setSelectedDuration(label);
  };

  const handleBetSuccess = () => {
    setMintTrigger(prev => prev + 1);
    // Reload positions immediately so "Your Position" shows
    setUserPositions(loadPositions());
    // Refresh pool data
    if (onChainRound) {
      fetchRound(onChainRound.id).then(updated => {
        if (updated) setOnChainRound(prev => prev ? { ...updated, endTime: prev.endTime } : updated);
      });
    }
  };

  const handleClaim = (roundId: number) => {
    // Save claimed status
    const claimed: number[] = JSON.parse(localStorage.getItem('pred_claimed') || '[]');
    if (!claimed.includes(roundId)) {
      claimed.push(roundId);
      localStorage.setItem('pred_claimed', JSON.stringify(claimed));
    }
    setUserPositions(prev =>
      prev.map(p => p.roundId === roundId ? { ...p, claimed: true } : p)
    );
    setMintTrigger(prev => prev + 1);
  };

  // Find user position for current round (aggregated)
  const currentPosition = currentRound
    ? userPositions.find(p => p.roundId === currentRound.id)
    : undefined;

  return (
    <div className="min-h-screen overflow-x-hidden selection:bg-white selection:text-black">
      <Header />

      {/* Win/Lose notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ y: -80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', damping: 20 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[55]"
          >
            <div className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl border backdrop-blur-xl shadow-2xl ${
              notification.type === 'win'
                ? 'bg-new-mint/15 border-new-mint/30 shadow-new-mint/10'
                : 'bg-off-red/15 border-off-red/30 shadow-off-red/10'
            }`}>
              {notification.type === 'win' ? (
                <Trophy className="w-5 h-5 text-new-mint" />
              ) : (
                <XCircle className="w-5 h-5 text-off-red" />
              )}
              <div>
                <span className={`text-sm font-bold ${notification.type === 'win' ? 'text-new-mint' : 'text-off-red'}`}>
                  {notification.type === 'win' ? 'You Won!' : 'Round Lost'}
                </span>
                <span className="text-xs text-gray-400 ml-2">
                  Round #{notification.roundId} —{' '}
                  {notification.type === 'win'
                    ? `+${formatPred(notification.amount)} DART`
                    : `-${formatPred(notification.amount)} DART`
                  }
                </span>
              </div>
              {notification.type === 'win' && (
                <span className="text-xs font-bold text-new-mint/60 ml-2">Claim in history</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="pt-28 pb-12 relative">
        <div className="max-w-[1400px] mx-auto px-6">

          {/* Page Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <BitcoinIcon className="w-8 h-8" />
                <h1 className="text-2xl font-black uppercase tracking-tight text-white">
                  BTC Predictions
                </h1>
              </div>

              {/* Duration selector */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <Timer className="w-3.5 h-3.5 text-gray-500" />
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => handleDurationChange(opt.label)}
                    className={`px-5 py-2 rounded-xl text-xs font-bold tracking-wide transition-all ${
                      selectedDuration === opt.label
                        ? 'bg-new-mint/15 text-new-mint border border-new-mint/30 shadow-[0_0_12px_rgba(52,211,153,0.15)]'
                        : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mobile token controls */}
            {publicKey && (
              <div className="lg:hidden flex items-center gap-2">
                <TokenBalance refreshTrigger={mintTrigger} />
              </div>
            )}
          </div>

          <div className="flex gap-8">
            {/* Main Content */}
            <div className="flex-1 min-w-0 space-y-8">

              {/* Mobile faucet */}
              {publicKey && (
                <div className="lg:hidden">
                  <TokenFaucet onMinted={() => setMintTrigger(prev => prev + 1)} />
                </div>
              )}

              {/* Demo banner */}
              {isDemo && currentRound && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-new-blue/10 border border-new-blue/20 rounded-xl">
                  <Radio className="w-3.5 h-3.5 text-new-blue animate-pulse" />
                  <span className="text-xs font-bold text-new-blue">LIVE PREVIEW</span>
                  <span className="text-xs text-gray-400">— No on-chain round active. Showing live BTC data with simulated pool.</span>
                </div>
              )}

              {/* Current Round */}
              {loading ? (
                <div className="bg-neutral-900/50 border border-white/5 rounded-3xl p-12 text-center">
                  <Activity className="w-8 h-8 text-gray-600 mx-auto mb-3 animate-pulse" />
                  <p className="text-gray-500">Fetching rounds from chain...</p>
                </div>
              ) : currentRound ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <RoundCard
                    round={currentRound}
                    userYesDeposit={currentPosition?.yesDeposit || 0}
                    userNoDeposit={currentPosition?.noDeposit || 0}
                  />
                </motion.div>
              ) : (
                <div className="bg-neutral-900/50 border border-white/5 rounded-3xl p-12 text-center">
                  <Activity className="w-8 h-8 text-gray-600 mx-auto mb-3 animate-pulse" />
                  <p className="text-gray-500">Connecting to BTC price feed...</p>
                </div>
              )}

              {/* Mobile Bet Panel */}
              {currentRound && (
                <div className="lg:hidden">
                  <BetPanel round={currentRound} onSuccess={handleBetSuccess} />
                </div>
              )}

              {/* Comments */}
              <Comments roundId={currentRound?.id || 0} />

              {/* Mobile Round History */}
              <div className="lg:hidden">
                <RoundHistory
                  rounds={pastRounds}
                  positions={userPositions}
                  onClaim={handleClaim}
                />
              </div>

            </div>

            {/* Sidebar */}
            <div className="hidden lg:block w-[340px] space-y-5 flex-shrink-0">

              {currentRound && (
                <div>
                  <BetPanel round={currentRound} onSuccess={handleBetSuccess} />

                  {/* Faucet in sidebar */}
                  {publicKey && (
                    <div className="mt-4">
                      <TokenFaucet onMinted={() => setMintTrigger(prev => prev + 1)} />
                    </div>
                  )}

                  {/* Prediction Stats */}
                  {publicKey && userPositions.length > 0 && (
                    <div className="mt-4">
                      <PredictionStats rounds={pastRounds} positions={userPositions} />
                    </div>
                  )}

                  {/* P&L Chart */}
                  {publicKey && userPositions.length > 0 && (
                    <div className="mt-3">
                      <PnLChart rounds={pastRounds} positions={userPositions} />
                    </div>
                  )}

                  {/* Stats */}
                  <div className="mt-5 bg-neutral-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5 space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">BTC 24h</span>
                      <span className={`text-xs font-mono font-bold ${change24h >= 0 ? 'text-new-mint' : 'text-off-red'}`}>
                        {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Pool</span>
                      <span className="text-xs font-mono font-bold text-new-mint">
                        {formatPred(currentRound.yesPool + currentRound.noPool)} DART
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-gray-500">Fee</span>
                      <span className="text-xs font-bold text-gray-400">10%</span>
                    </div>
                  </div>

                  {/* Rules */}
                  <div className="mt-4 px-1">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Rules</h4>
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      Resolves <span className="text-new-mint font-bold">YES</span> if BTC price at round end is greater than or equal to the target price. Otherwise resolves <span className="text-off-red font-bold">NO</span>. Winners split the pool proportionally (minus 10% fee).
                    </p>
                  </div>

                  {/* Round History */}
                  <div className="mt-5">
                    <RoundHistory
                      rounds={pastRounds}
                      positions={userPositions}
                      onClaim={handleClaim}
                    />
                  </div>
                </div>
              )}

              {/* Show faucet even when no round active */}
              {!currentRound && publicKey && (
                <div>
                  <TokenFaucet onMinted={() => setMintTrigger(prev => prev + 1)} />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}
