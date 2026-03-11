// Contract constants for BTC Prediction Market v10 (fixed-odds, atomic escrow)

export const PRED_TOKEN_PROGRAM = 'test_usdcx_stablecoin.aleo';
export const BTC_PREDICTION_PROGRAM = 'btc_pred_v10.aleo';

// On-chain address of btc_pred_v10.aleo (vault for token escrow)
// TODO: update after deploy — run `leo deploy` and paste the program address here
export const BTC_PREDICTION_ADDRESS = 'aleo1v5wrxmqe2urj30wqxyhnfymghw03kcdgu2pdcv7hhlw3z2vcs5rqwl2f7e';

// Vault address (same as program address — stored in aa[1u8])
export const BTC_PREDICTION_VAULT = BTC_PREDICTION_ADDRESS;

// Token decimals: 1 USDCx = 1_000_000 micro-USDCx (6 decimals)
export const PRED_DECIMALS = 6;
export const PRED_MULTIPLIER = 1_000_000;

// Round duration in seconds
export const ROUND_DURATION_SECONDS = 300; // 5 minutes

// Frontend talks to the resolver through same-origin Next API routes.
export const BACKEND_URL = '/api/resolver';

// Aleo API endpoints
export const ALEO_API_URL = 'https://api.explorer.provable.com/v1';
export const ALEO_NETWORK = 'testnet';
export const BALANCE_KEY = 'usdcx_balance';
export const BALANCE_PENDING_KEY = 'usdcx_balance_pending';
export const BALANCE_UPDATED_EVENT = 'dart:balance-updated';

function broadcastBalance(balance: number) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BALANCE_UPDATED_EVENT, { detail: { balance } }));
  }
}

function storeBalance(balance: number) {
  localStorage.setItem(BALANCE_KEY, String(balance));
  broadcastBalance(balance);
}

// Helper: format credits amount for display
export function formatPred(microAmount: number): string {
  return (microAmount / PRED_MULTIPLIER).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Helper: parse display credits to micro amount
export function parsePredToMicro(displayAmount: string): number {
  const num = parseFloat(displayAmount);
  if (isNaN(num) || num <= 0) return 0;
  return Math.floor(num * PRED_MULTIPLIER);
}

// Helper: fetch public mapping value from Aleo API
export async function fetchMapping(
  program: string,
  mapping: string,
  key: string
): Promise<string | null> {
  try {
    const url = `${ALEO_API_URL}/${ALEO_NETWORK}/program/${program}/mapping/${mapping}/${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    // Remove quotes and whitespace
    const cleaned = text.replace(/"/g, '').trim();
    if (cleaned === 'null' || cleaned === '') return null;
    return cleaned;
  } catch {
    return null;
  }
}

// Helper: parse u64 value from Aleo mapping response
export function parseU64(val: string | null): number {
  if (!val) return 0;
  const cleaned = val.replace('u64', '').trim();
  return parseInt(cleaned, 10) || 0;
}

// Helper: parse u128 value from Aleo mapping response (USDCx amounts)
export function parseU128(val: string | null): number {
  if (!val) return 0;
  const cleaned = val.replace('u128', '').trim();
  return parseInt(cleaned, 10) || 0;
}

// Fetch on-chain USDCx balance for an address and sync to localStorage
export async function fetchOnChainBalance(address: string): Promise<number> {
  const val = await fetchMapping(PRED_TOKEN_PROGRAM, 'balances', address);
  const local = parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10);
  const pendingRaw = localStorage.getItem(BALANCE_PENDING_KEY);

  // Any non-null mapping response is authoritative, including zero.
  if (val !== null) {
    const onChain = parseU128(val);
    if (pendingRaw) {
      try {
        const pending = JSON.parse(pendingRaw);
        const age = Date.now() - (pending.timestamp || 0);
        if (pending.expectedBalance === onChain || age >= 300_000) {
          localStorage.removeItem(BALANCE_PENDING_KEY);
        }
      } catch {
        localStorage.removeItem(BALANCE_PENDING_KEY);
      }
    }
    storeBalance(onChain);
    return onChain;
  }

  // Explorer was unavailable — fall back to a recent optimistic value if we have one.
  if (pendingRaw) {
    try {
      const pending = JSON.parse(pendingRaw);
      const age = Date.now() - (pending.timestamp || 0);
      if (age < 300_000 && pending.expectedBalance > 0) {
        storeBalance(pending.expectedBalance);
        return pending.expectedBalance;
      }
      localStorage.removeItem(BALANCE_PENDING_KEY);
    } catch {
      localStorage.removeItem(BALANCE_PENDING_KEY);
    }
  }

  if (local > 0) {
    return local;
  }

  return 0;
}

// Set an optimistic balance after a transaction (bet or claim)
export function setOptimisticBalance(expectedBalance: number) {
  storeBalance(expectedBalance);
  localStorage.setItem(BALANCE_PENDING_KEY, JSON.stringify({
    expectedBalance,
    timestamp: Date.now(),
  }));
}

// Fetch multipliers for a round from on-chain mappings
export async function fetchMultipliers(rid: number): Promise<{ yesMult: number; noMult: number }> {
  const [ymRaw, nmRaw] = await Promise.all([
    fetchMapping(BTC_PREDICTION_PROGRAM, 'ym', `${rid}u64`),
    fetchMapping(BTC_PREDICTION_PROGRAM, 'nm', `${rid}u64`),
  ]);
  return {
    yesMult: parseU64(ymRaw),
    noMult: parseU64(nmRaw),
  };
}

// Calculate locked payout from stake and multiplier (basis points)
export function calcLockedPayout(stake: number, multBps: number): number {
  return Math.floor(stake * multBps / 10000);
}

// Calculate display odds from multiplier (e.g. 18500 → "1.85x")
export function formatMultiplier(multBps: number): string {
  return (multBps / 10000).toFixed(2) + 'x';
}

// Calculate implied probability from multiplier (e.g. 18500 → 54.05%)
export function impliedProb(multBps: number): number {
  if (multBps <= 0) return 50;
  return Math.round((10000 / multBps) * 100);
}

// Legacy UI helper kept for components that still animate a live YES/NO split.
// It returns a normalized YES probability from 0..1 based on distance to target
// and the time remaining in the round.
export function estimateProb(price: number, targetUsd: number, minsLeft: number): number {
  if (price <= 0 || targetUsd <= 0) return 0.5;

  const pctDiff = (price - targetUsd) / targetUsd;
  const cappedDiff = Math.max(-0.05, Math.min(0.05, pctDiff));
  const timeWeight = Math.max(0.2, Math.min(1, minsLeft / 5));
  const score = (cappedDiff / 0.05) * (2 - timeWeight);
  const prob = 1 / (1 + Math.exp(-score * 2.2));

  return Math.max(0.05, Math.min(0.95, prob));
}

// Duration options
export const DURATION_OPTIONS = [
  { label: '1 Minute', seconds: 60 },
  { label: '5 Minutes', seconds: 300 },
  { label: '15 Minutes', seconds: 900 },
  { label: '30 Minutes', seconds: 1800 },
  { label: '1 Hour', seconds: 3600 },
] as const;

export type DurationLabel = typeof DURATION_OPTIONS[number]['label'];

// Round state interface — v10 fixed-odds model
export interface RoundState {
  id: number;
  targetPrice: number;   // in cents
  deadline: number;       // block height
  durationMs: number;     // round duration in ms
  endTime: number;        // timestamp when round ends
  yesMult: number;        // YES multiplier in basis points (18500 = 1.85x)
  noMult: number;         // NO multiplier in basis points
  bankroll: number;       // admin-funded bankroll (micro-USDCx)
  totalPool: number;      // total premiums/stakes received
  yesLocked: number;      // total YES locked payouts
  noLocked: number;       // total NO locked payouts
  yesPool: number;        // legacy alias for v8-style UI components
  noPool: number;         // legacy alias for v8-style UI components
  resolved: boolean;
  outcome: boolean | null; // null if not resolved, true = YES won
}

// User position interface
export interface UserPosition {
  roundId: number;
  yesDeposit: number;
  noDeposit: number;
  claimed: boolean;
}

// ── Reputation System ──────────────────────────────────

export type ReputationTier = 'Novice' | 'Trader' | 'Whale' | 'Oracle';

export interface ReputationData {
  bets: number;
  wins: number;
  streak: number;
  winRate: number;
  tier: ReputationTier;
  bonusPct: number;   // 0, 3, 7, or 12
  feePct: number;     // 10, 9, 8, or 7
  nextTier: ReputationTier | null;
  progressToNext: number; // 0-100%
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
    bets,
    wins,
    streak,
    winRate,
    tier,
    bonusPct: tierInfo.bonus,
    feePct: tierInfo.fee,
    nextTier: nextTierInfo?.tier ?? null,
    progressToNext,
  };
}

// Fetch reputation data — computed from local positions
export async function fetchReputation(_address: string): Promise<ReputationData> {
  try {
    const positions: { roundId: number; side: string; amount: number }[] =
      JSON.parse(localStorage.getItem('v10_positions') || '[]');
    const claimed: number[] = JSON.parse(localStorage.getItem('v10_claimed') || '[]');
    const bets = positions.length;
    const wins = claimed.length;
    return getReputationData(bets, wins, 0);
  } catch {
    return getReputationData(0, 0, 0);
  }
}

// Calculate payout with tier bonus
export function calcPayoutWithBonus(
  deposit: number,
  winningPool: number,
  totalPool: number,
  bonusPct: number,
): number {
  if (winningPool === 0) return 0;
  const gross = (deposit / winningPool) * totalPool;
  const baseFee = gross * 0.1;
  const basePayout = gross - baseFee;
  return Math.floor(basePayout + basePayout * bonusPct / 100);
}
