'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import {
  BTC_PREDICTION_PROGRAM,
  fetchMapping,
  parseU64,
  formatPred,
  calcOdds,
  type RoundState,
} from '@/lib/predictionContract';
import { Activity, ArrowRight, CheckCircle2, TrendingUp, Users } from 'lucide-react';
import BitcoinIcon from '@/components/icons/BitcoinIcon';

/* ── Starfield background ── */
function Starfield() {
  const [stars] = useState(() =>
    Array.from({ length: 200 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() < 0.15 ? 2 : Math.random() < 0.4 ? 1.2 : 0.8,
      opacity: 0.15 + Math.random() * 0.5,
      delay: Math.random() * 6,
      duration: 2.5 + Math.random() * 4,
    }))
  );

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {stars.map((s) => (
        <motion.div
          key={s.id}
          className="absolute rounded-full bg-white"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
          }}
          animate={{
            opacity: [s.opacity * 0.3, s.opacity, s.opacity * 0.3],
            scale: [1, s.size > 1.5 ? 1.4 : 1.15, 1],
          }}
          transition={{
            duration: s.duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: s.delay,
          }}
        />
      ))}
    </div>
  );
}

const AVG_BLOCK_TIME_MS = 3500;

let cachedHeight = 0;
let heightFetchedAt = 0;
async function getBlockHeight(): Promise<number> {
  if (cachedHeight > 0 && Date.now() - heightFetchedAt < 10_000) return cachedHeight;
  try {
    const res = await fetch('https://api.explorer.provable.com/v1/testnet/latest/height');
    if (!res.ok) return cachedHeight;
    cachedHeight = parseInt(await res.text(), 10);
    heightFetchedAt = Date.now();
    return cachedHeight;
  } catch {
    return cachedHeight;
  }
}

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

    if (!targetRaw || targetRaw === 'null') return null;

    const targetPrice = parseU64(targetRaw);
    const deadline = parseInt(deadlineRaw?.replace('u32', '').trim() || '0', 10);
    const durationSecs = parseInt(durationRaw?.replace('u32', '').trim() || '300', 10);
    const durationMs = durationSecs * 1000;
    const resolved = resolvedRaw?.trim() === 'true';
    const outcome = resolved ? outcomeRaw?.trim() === 'true' : null;

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

function formatTargetPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ── Animated radial clock ── */
function AnimatedClock({ endTime, durationMs }: { endTime: number; durationMs: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, endTime - now);
  const progress = durationMs > 0 ? 1 - remaining / durationMs : 0;
  const clampedProgress = Math.max(0, Math.min(1, progress));

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const label = remaining === 0 ? 'END' : `${mins}:${secs.toString().padStart(2, '0')}`;

  const R = 38;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - clampedProgress);

  // Pulse faster as time runs out
  const urgent = remaining < 30_000 && remaining > 0;

  return (
    <div className="relative flex items-center justify-center w-[100px] h-[100px] flex-shrink-0">
      {/* Glow behind */}
      <div className={`absolute inset-0 rounded-full blur-xl transition-opacity duration-700 ${
        urgent ? 'bg-off-red/20 opacity-100' : 'bg-new-mint/10 opacity-60'
      }`} />

      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        {/* Track */}
        <circle
          cx="50" cy="50" r={R}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="4"
        />
        {/* Progress arc */}
        <motion.circle
          cx="50" cy="50" r={R}
          fill="none"
          stroke={urgent ? '#F43F5E' : '#34D399'}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'linear' }}
        />
        {/* Tick marks */}
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 * Math.PI) / 180;
          const x1 = 50 + 32 * Math.cos(angle);
          const y1 = 50 + 32 * Math.sin(angle);
          const x2 = 50 + 35 * Math.cos(angle);
          const y2 = 50 + 35 * Math.sin(angle);
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
              strokeLinecap="round"
            />
          );
        })}
        {/* Sweeping hand */}
        {remaining > 0 && (
          <motion.line
            x1="50" y1="50"
            x2="50" y2="18"
            stroke={urgent ? '#F43F5E' : '#34D399'}
            strokeWidth="1.5"
            strokeLinecap="round"
            style={{ originX: '50px', originY: '50px' }}
            animate={{ rotate: clampedProgress * 360 }}
            transition={{ duration: 1, ease: 'linear' }}
          />
        )}
        {/* Center dot */}
        <circle cx="50" cy="50" r="2.5" fill={urgent ? '#F43F5E' : '#34D399'} />
      </svg>

      {/* Time label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
        <span className={`text-lg font-mono font-black tracking-tight ${
          urgent ? 'text-off-red' : 'text-white'
        }`}>
          {label}
        </span>
        {remaining > 0 && (
          <span className="text-[9px] uppercase tracking-widest text-gray-500 font-bold">
            left
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Round Card ── */
function RoundGridCard({ round, index }: { round: RoundState; index: number }) {
  const router = useRouter();
  const { yes, no } = calcOdds(round.yesPool, round.noPool);
  const totalPool = round.yesPool + round.noPool;
  const isLive = !round.resolved;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => router.push('/markets')}
      role="button"
      tabIndex={0}
    >
        <div className={`group relative overflow-hidden rounded-3xl p-6 pb-5 transition-all duration-500 cursor-pointer ${
          isLive
            ? 'bg-gradient-to-br from-neutral-900/80 via-neutral-900/60 to-neutral-950/80 border border-new-mint/15 hover:border-new-mint/40 hover:shadow-[0_0_40px_-8px_rgba(52,211,153,0.15)]'
            : 'bg-gradient-to-br from-neutral-900/50 via-neutral-900/40 to-neutral-950/50 border border-white/[0.06] hover:border-white/15'
        }`}>
          {/* Ambient glow for live cards */}
          {isLive && (
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-new-mint/[0.04] rounded-full blur-3xl pointer-events-none group-hover:bg-new-mint/[0.08] transition-colors duration-700" />
          )}

          {/* Top row: badge + round id */}
          <div className="flex items-center justify-between mb-5 relative z-10">
            <div className="flex items-center gap-2.5">
              {isLive ? (
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-new-mint bg-new-mint/10 border border-new-mint/20 px-2.5 py-1 rounded-full uppercase tracking-widest">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-new-mint opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-new-mint" />
                  </span>
                  Live
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 bg-white/[0.04] border border-white/[0.06] px-2.5 py-1 rounded-full uppercase tracking-widest">
                  <CheckCircle2 className="w-3 h-3" />
                  Ended
                </span>
              )}
              <span className="text-[11px] text-gray-600 font-mono font-medium">#{round.id}</span>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-700 group-hover:text-gray-400 group-hover:translate-x-0.5 transition-all duration-300" />
          </div>

          {isLive ? (
            /* ── LIVE CARD ── */
            <>
              {/* Clock + question row */}
              <div className="flex items-center gap-5 mb-5">
                <AnimatedClock endTime={round.endTime} durationMs={round.durationMs} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider mb-1.5">
                    Will BTC be
                  </p>
                  <p className="text-xl font-black text-white leading-tight tracking-tight">
                    ≥ ${formatTargetPrice(round.targetPrice)}
                  </p>
                  <p className="text-[11px] text-gray-600 font-medium mt-1">
                    at round close?
                  </p>
                </div>
              </div>

              {/* Odds visualization */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-3 rounded-full bg-neutral-800/80 overflow-hidden flex">
                    <motion.div
                      className="h-full bg-gradient-to-r from-new-mint/80 to-new-mint/50 rounded-l-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${yes}%` }}
                      transition={{ duration: 0.8, delay: index * 0.07 + 0.3, ease: 'easeOut' }}
                    />
                    <motion.div
                      className="h-full bg-gradient-to-r from-off-red/50 to-off-red/80 rounded-r-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${no}%` }}
                      transition={{ duration: 0.8, delay: index * 0.07 + 0.3, ease: 'easeOut' }}
                    />
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs font-bold text-new-mint font-mono">YES {yes}%</span>
                  <span className="text-xs font-bold text-off-red font-mono">NO {no}%</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="relative overflow-hidden flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white bg-emerald-500 shadow-[0_0_20px_-4px_rgba(16,185,129,0.4)] group-hover:bg-emerald-400 group-hover:shadow-[0_0_28px_-4px_rgba(16,185,129,0.5)] transition-all duration-300">
                  <TrendingUp className="w-4 h-4" />
                  Yes {yes}%
                </div>
                <div className="relative overflow-hidden flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white bg-rose-500 shadow-[0_0_20px_-4px_rgba(244,63,94,0.4)] group-hover:bg-rose-400 group-hover:shadow-[0_0_28px_-4px_rgba(244,63,94,0.5)] transition-all duration-300">
                  <TrendingUp className="w-4 h-4 rotate-180" />
                  No {no}%
                </div>
              </div>

              {/* Footer stats */}
              <div className="flex items-center justify-between pt-3 border-t border-white/[0.04]">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <Users className="w-3 h-3" />
                  <span className="font-mono font-medium">{formatPred(totalPool)} DART</span>
                </div>
                <span className="text-[10px] text-gray-600 font-medium">Pool</span>
              </div>
            </>
          ) : (
            /* ── ENDED CARD ── */
            <>
              {/* Question */}
              <div className="mb-5">
                <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider mb-1.5">
                  Was BTC
                </p>
                <p className="text-lg font-black text-white/70 leading-tight tracking-tight">
                  ≥ ${formatTargetPrice(round.targetPrice)} ?
                </p>
              </div>

              {/* Result */}
              <div className={`mb-4 flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold ${
                round.outcome
                  ? 'bg-new-mint/[0.08] text-new-mint border border-new-mint/15'
                  : 'bg-off-red/[0.08] text-off-red border border-off-red/15'
              }`}>
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span className="text-base">
                  Resolved {round.outcome ? 'YES' : 'NO'}
                </span>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-white/[0.04]">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  <Users className="w-3 h-3" />
                  <span className="font-mono font-medium">{formatPred(totalPool)} DART</span>
                </div>
                <span className="text-[10px] text-gray-600 font-medium">Final Pool</span>
              </div>
            </>
          )}
        </div>
    </motion.div>
  );
}

/* Duration buckets: map durationMs → label */
const DURATION_BUCKETS = [
  { label: '1 Min', tag: '1m', seconds: 60 },
  { label: '5 Min', tag: '5m', seconds: 300 },
  { label: '15 Min', tag: '15m', seconds: 900 },
  { label: '30 Min', tag: '30m', seconds: 1800 },
  { label: '1 Hour', tag: '1h', seconds: 3600 },
];

function getDurationLabel(durationMs: number): string {
  const secs = durationMs / 1000;
  const match = DURATION_BUCKETS.find(b => Math.abs(b.seconds - secs) < 10);
  return match ? match.label : `${Math.round(secs / 60)}m`;
}

function getDurationTag(durationMs: number): string {
  const secs = durationMs / 1000;
  const match = DURATION_BUCKETS.find(b => Math.abs(b.seconds - secs) < 10);
  return match ? match.tag : `${Math.round(secs / 60)}m`;
}

/* ── Page ── */
export default function HomePage() {
  const { price, change24h, connected } = useBtcPrice();
  const [rounds, setRounds] = useState<RoundState[]>([]);
  const [loading, setLoading] = useState(true);

  const scanRounds = useCallback(async () => {
    let lo = 0, hi = 500;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const raw = await fetchMapping(BTC_PREDICTION_PROGRAM, 'round_target_price', `${mid}u64`);
      const exists = raw !== null && raw !== 'null';
      if (exists) lo = mid; else hi = mid - 1;
    }
    const highestId = lo;

    if (highestId === 0) {
      const r0 = await fetchRound(0);
      if (r0) setRounds([r0]);
      setLoading(false);
      return;
    }

    // Fetch more rounds to find active ones across durations
    const startId = Math.max(0, highestId - 24);
    const ids = Array.from({ length: highestId - startId + 1 }, (_, i) => startId + i);
    const results = await Promise.all(ids.map(id => fetchRound(id)));

    const found = results.filter((r): r is RoundState => r !== null);
    // Only keep truly live rounds (not resolved AND time remaining)
    const now = Date.now();
    const active = found.filter(r => !r.resolved && r.endTime > now);
    // Sort by highest ID first
    active.sort((a, b) => b.id - a.id);

    setRounds(active);
    setLoading(false);
  }, []);

  useEffect(() => {
    scanRounds();
    const id = setInterval(scanRounds, 15_000);
    return () => clearInterval(id);
  }, [scanRounds]);

  // Group active rounds by duration bucket
  const grouped = useMemo(() => {
    const map = new Map<string, RoundState[]>();
    for (const bucket of DURATION_BUCKETS) {
      map.set(bucket.tag, []);
    }
    for (const r of rounds) {
      const tag = getDurationTag(r.durationMs);
      const arr = map.get(tag);
      if (arr) arr.push(r);
      else map.set(tag, [r]);
    }
    return map;
  }, [rounds]);

  return (
    <div className="min-h-screen overflow-x-hidden selection:bg-white selection:text-black">
      <Starfield />
      <Header />

      <main className="pt-32 pb-20 relative">
        {/* Background ambient blurs */}
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[900px] h-[700px] bg-new-mint/[0.025] rounded-full blur-[140px] pointer-events-none" />
        <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-new-blue/[0.02] rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-[1300px] mx-auto px-6 sm:px-8 relative z-10">

          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="text-center mb-10"
          >
            <div className="flex items-center justify-center gap-4 mb-3">
              <BitcoinIcon className="w-11 h-11" />
              <h1 className="text-5xl sm:text-6xl font-black uppercase tracking-tighter text-white">
                BTC Predictions
              </h1>
            </div>

            {/* Live price ticker */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="inline-flex items-center gap-4 bg-neutral-900/50 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-6 py-3 mb-4"
            >
              <span className="text-3xl font-mono font-black text-white tracking-tight">
                {price > 0
                  ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : '---'}
              </span>
              {price > 0 && (
                <span className={`text-sm font-mono font-bold px-3 py-1 rounded-xl ${
                  change24h >= 0
                    ? 'text-new-mint bg-new-mint/10 border border-new-mint/20'
                    : 'text-off-red bg-off-red/10 border border-off-red/20'
                }`}>
                  {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                </span>
              )}
              {connected && (
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-new-mint/60 uppercase tracking-widest">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-new-mint/60 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-new-mint/60" />
                  </span>
                  Live
                </span>
              )}
            </motion.div>

            <p className="text-base text-gray-500 max-w-md mx-auto leading-relaxed">
              Predict BTC price movements. Stake DART tokens. Win from the pool.
            </p>
          </motion.div>

          {/* Stats bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="flex items-center gap-4 mb-8"
          >
            {rounds.length > 0 && (
              <span className="text-xs font-bold text-new-mint bg-new-mint/10 border border-new-mint/20 px-4 py-1.5 rounded-full">
                {rounds.length} Active Market{rounds.length > 1 ? 's' : ''}
              </span>
            )}
            <div className="flex-1" />
            <Link
              href="/markets"
              className="group text-xs font-bold text-gray-400 hover:text-new-mint flex items-center gap-2 transition-colors duration-300"
            >
              Open Trading View
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </motion.div>

          {/* Markets by duration */}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-24">
              <Activity className="w-8 h-8 text-gray-600 mb-4 animate-pulse" />
              <p className="text-gray-500 text-sm">Fetching live markets from chain...</p>
            </div>
          ) : rounds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 bg-neutral-900/30 backdrop-blur-sm border border-white/[0.05] rounded-3xl">
              <Activity className="w-8 h-8 text-gray-600 mb-4" />
              <p className="text-gray-500 text-sm mb-6">No active markets right now.</p>
              <Link
                href="/markets"
                className="px-7 py-3 rounded-2xl text-sm font-bold text-black bg-new-mint hover:bg-new-mint/90 transition-colors"
              >
                Go to Markets
              </Link>
            </div>
          ) : (
            <div className="space-y-12">
              {DURATION_BUCKETS.map((bucket, bucketIdx) => {
                const bucketRounds = grouped.get(bucket.tag) || [];
                if (bucketRounds.length === 0) return null;

                return (
                  <motion.section
                    key={bucket.tag}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: bucketIdx * 0.08 }}
                  >
                    {/* Section header */}
                    <div className="flex items-center gap-3 mb-6">
                      <span className="text-base font-black text-white uppercase tracking-wide">
                        {bucket.label}
                      </span>
                      <span className="text-[10px] font-bold text-new-mint/70 bg-new-mint/[0.06] border border-new-mint/10 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                        {bucketRounds.length} live
                      </span>
                      <div className="flex-1 h-[1px] bg-gradient-to-r from-white/[0.06] to-transparent ml-1" />
                    </div>

                    {/* Cards grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {bucketRounds.map((round, i) => (
                        <RoundGridCard key={round.id} round={round} index={i} />
                      ))}
                    </div>
                  </motion.section>
                );
              })}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
