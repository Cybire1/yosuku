// Contract constants and helpers for DeepBook Predict on Sui

export { DUSDC_MULTIPLIER, DUSDC_DECIMALS, FLOAT_SCALING } from './sui/constants';
import { DUSDC_MULTIPLIER, FLOAT_SCALING } from './sui/constants';

// Backwards-compatible alias
export const PRED_MULTIPLIER = DUSDC_MULTIPLIER;

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

// Balance event name (kept for components that listen)
export const BALANCE_UPDATED_EVENT = 'dart:balance-updated';

// Helper: format DUSDC amount for display
export function formatPred(microAmount: number): string {
  return (microAmount / DUSDC_MULTIPLIER).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Helper: parse display amount to micro DUSDC
export function parsePredToMicro(displayAmount: string): number {
  const num = parseFloat(displayAmount);
  if (isNaN(num) || num <= 0) return 0;
  return Math.floor(num * DUSDC_MULTIPLIER);
}

// Duration options (for oracle timeframes)
export const DURATION_OPTIONS = [
  { label: '5 Minutes' as const, seconds: 300 },
  { label: '15 Minutes' as const, seconds: 900 },
  { label: '30 Minutes' as const, seconds: 1800 },
  { label: '1 Hour' as const, seconds: 3600 },
] as const;

export type DurationLabel = typeof DURATION_OPTIONS[number]['label'];

// ── Legacy types (kept for backwards compat with existing components) ──

/** Legacy RoundState — maps oracle data for old components */
export interface RoundState {
  id: string | number;
  oracleId: string;
  underlyingAsset: string;
  expiry: number;
  minStrike: number;
  tickSize: number;
  status: string;
  settlementPrice: number | null;
  resolved: boolean;
  endTime: number;
  // Legacy fields for old BTC trader
  targetPrice: number;
  durationMs: number;
  totalPool: number;
  yesPool: number;
  noPool: number;
  outcome: boolean | null;
}

/** Legacy UserPosition for old components */
export interface UserPosition {
  roundId: string | number;
  direction: 'UP' | 'DOWN';
  quantity: number;
  cost: number;
  claimed: boolean;
  // Legacy fields
  yesDeposit: number;
  noDeposit: number;
}

// ── Probability / Odds helpers ───────────────────────────

const BTC_VOL_PER_MIN = 0.001;

export function estimateProb(
  livePrice: number,
  targetPrice: number,
  minsLeft: number,
): number {
  if (minsLeft <= 0 || targetPrice <= 0 || livePrice <= 0) {
    return livePrice >= targetPrice ? 1 : 0;
  }
  const priceDiffPct = (livePrice - targetPrice) / targetPrice;
  const sigma = BTC_VOL_PER_MIN * Math.sqrt(minsLeft);
  const z = priceDiffPct / sigma;
  const probYes = 1 / (1 + Math.exp(-1.7 * z));
  return Math.max(0.01, Math.min(0.99, probYes));
}

export function getConfidenceLabel(prob: number): {
  label: string;
  color: string;
} {
  if (prob >= 0.8) return { label: 'Strong UP', color: 'text-new-mint' };
  if (prob >= 0.6) return { label: 'Lean UP', color: 'text-new-mint/70' };
  if (prob >= 0.4) return { label: 'Toss-up', color: 'text-gray-400' };
  if (prob >= 0.2) return { label: 'Lean DOWN', color: 'text-off-red/70' };
  return { label: 'Strong DOWN', color: 'text-off-red' };
}

/** Format a FLOAT_SCALING strike price to dollar string */
export function formatStrikePrice(scaled: number): string {
  const dollars = scaled / FLOAT_SCALING;
  return '$' + dollars.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Format multiplier from basis points */
export function formatMultiplier(multBps: number): string {
  return (multBps / 10000).toFixed(2) + 'x';
}

/** Implied probability from multiplier basis points */
export function impliedProb(multBps: number): number {
  if (multBps <= 0) return 50;
  return Math.round((10000 / multBps) * 100);
}

// ── Reputation System (computed locally) ─────────────────

export type ReputationTier = 'Novice' | 'Trader' | 'Whale' | 'Oracle';

export interface ReputationData {
  bets: number;
  wins: number;
  streak: number;
  winRate: number;
  tier: ReputationTier;
  bonusPct: number;
  feePct: number;
  nextTier: ReputationTier | null;
  progressToNext: number;
}

const TIERS: { tier: ReputationTier; minBets: number; minWinRate: number; bonus: number; fee: number }[] = [
  { tier: 'Oracle', minBets: 30, minWinRate: 0.65, bonus: 12, fee: 7 },
  { tier: 'Whale',  minBets: 15, minWinRate: 0.55, bonus: 7,  fee: 8 },
  { tier: 'Trader', minBets: 5,  minWinRate: 0.45, bonus: 3,  fee: 9 },
  { tier: 'Novice', minBets: 0,  minWinRate: 0,    bonus: 0,  fee: 10 },
];

export function computeTier(bets: number, wins: number): ReputationTier {
  const winRate = bets > 0 ? wins / bets : 0;
  for (const t of TIERS) {
    if (bets >= t.minBets && winRate >= t.minWinRate) return t.tier;
  }
  return 'Novice';
}

export function getReputationData(bets: number, wins: number, streak: number): ReputationData {
  const winRate = bets > 0 ? wins / bets : 0;
  const tier = computeTier(bets, wins);
  const tierInfo = TIERS.find(t => t.tier === tier)!;
  const tierIdx = TIERS.findIndex(t => t.tier === tier);
  const nextTierInfo = tierIdx > 0 ? TIERS[tierIdx - 1] : null;

  let progressToNext = 100;
  if (nextTierInfo) {
    const betsProgress = Math.min(1, bets / nextTierInfo.minBets);
    const wrProgress = nextTierInfo.minWinRate > 0
      ? Math.min(1, winRate / nextTierInfo.minWinRate)
      : 1;
    progressToNext = Math.round(((betsProgress + wrProgress) / 2) * 100);
  }

  return {
    bets, wins, streak, winRate, tier,
    bonusPct: tierInfo.bonus,
    feePct: tierInfo.fee,
    nextTier: nextTierInfo?.tier ?? null,
    progressToNext,
  };
}

export async function fetchReputation(_address: string): Promise<ReputationData> {
  try {
    const positions: { oracleId: string; direction: string }[] =
      JSON.parse(localStorage.getItem('sui_positions') || '[]');
    const wins: string[] = JSON.parse(localStorage.getItem('sui_wins') || '[]');
    return getReputationData(positions.length, wins.length, 0);
  } catch {
    return getReputationData(0, 0, 0);
  }
}
