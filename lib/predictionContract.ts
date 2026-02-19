// Contract constants for BTC Prediction Market v3

export const PRED_TOKEN_PROGRAM = 'dart_token.aleo';
export const BTC_PREDICTION_PROGRAM = 'btc_prediction_v3.aleo';

// On-chain address of btc_prediction_v3.aleo (for token transfers to the program)
export const BTC_PREDICTION_ADDRESS = 'aleo1h9l6247x6y44fnq438yxjurqswf5dgdak7sedsn9wwzjl5xlxvpqwyyjyl';

// Token decimals: 1 DART = 1_000_000 microtokens
export const PRED_DECIMALS = 6;
export const PRED_MULTIPLIER = 1_000_000;

// Platform fee: 10% base (reduced by tier)
export const PLATFORM_FEE_BPS = 1000;

// Round duration in seconds
export const ROUND_DURATION_SECONDS = 300; // 5 minutes

// Default seed liquidity per side when creating a round (500 DART)
export const DEFAULT_SEED_AMOUNT = 500 * PRED_MULTIPLIER;

// Pool address: btc_prediction_v3.aleo program address in dart_token balances
export const POOL_ADDRESS = 'btc_prediction_v3.aleo';

// Aleo API endpoints
export const ALEO_API_URL = 'https://api.explorer.provable.com/v1';
export const ALEO_NETWORK = 'testnet';

// Helper: format DART amount for display
export function formatPred(microAmount: number): string {
  return (microAmount / PRED_MULTIPLIER).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// Helper: parse display DART to micro amount
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

// Fetch on-chain DART balance for an address and sync to localStorage
export async function fetchOnChainBalance(address: string): Promise<number> {
  const val = await fetchMapping(PRED_TOKEN_PROGRAM, 'balances', address);
  const onChain = parseU64(val);

  // Check if there's a pending optimistic update (expires after 60s)
  const pendingRaw = localStorage.getItem('dart_balance_pending');
  if (pendingRaw) {
    try {
      const pending = JSON.parse(pendingRaw);
      const age = Date.now() - (pending.timestamp || 0);
      if (age < 60_000 && pending.expectedBalance != null) {
        // If on-chain has caught up to or exceeded the optimistic value, clear pending
        if (onChain >= pending.expectedBalance) {
          localStorage.removeItem('dart_balance_pending');
          localStorage.setItem('dart_balance', String(onChain));
          return onChain;
        }
        // Still waiting for tx confirmation — show optimistic value
        return pending.expectedBalance;
      }
      // Expired — on-chain is source of truth
      localStorage.removeItem('dart_balance_pending');
    } catch {
      localStorage.removeItem('dart_balance_pending');
    }
  }

  // No pending update — on-chain is source of truth
  localStorage.setItem('dart_balance', String(onChain));
  return onChain;
}

// Set an optimistic balance after a transaction (bet or claim)
export function setOptimisticBalance(expectedBalance: number) {
  localStorage.setItem('dart_balance', String(expectedBalance));
  localStorage.setItem('dart_balance_pending', JSON.stringify({
    expectedBalance,
    timestamp: Date.now(),
  }));
}

// Helper: calculate estimated payout
export function calcPayout(
  deposit: number,
  winningPool: number,
  totalPool: number
): number {
  if (winningPool === 0) return 0;
  const gross = (deposit / winningPool) * totalPool;
  return gross * 0.9; // 10% fee
}

// Helper: calculate odds percentage
export function calcOdds(yesPool: number, noPool: number): { yes: number; no: number } {
  const total = yesPool + noPool;
  if (total === 0) return { yes: 50, no: 50 };
  return {
    yes: Math.round((yesPool / total) * 100),
    no: Math.round((noPool / total) * 100),
  };
}

// Probability estimation using BTC volatility model
// BTC_VOL ≈ 0.001 per minute (annualized ~75% vol)
const BTC_VOL_PER_MIN = 0.001;

export function estimateProb(
  livePrice: number,
  targetPrice: number,
  minsLeft: number
): number {
  if (minsLeft <= 0 || targetPrice <= 0 || livePrice <= 0) {
    return livePrice >= targetPrice ? 1 : 0;
  }
  const priceDiffPct = (livePrice - targetPrice) / targetPrice;
  const sigma = BTC_VOL_PER_MIN * Math.sqrt(minsLeft);
  const z = priceDiffPct / sigma;
  // Logistic approximation of normal CDF
  const probYes = 1 / (1 + Math.exp(-1.7 * z));
  return Math.max(0.01, Math.min(0.99, probYes));
}

export function getConfidenceLabel(prob: number): {
  label: string;
  color: string;
} {
  if (prob >= 0.8) return { label: 'Strong YES', color: 'text-new-mint' };
  if (prob >= 0.6) return { label: 'Lean YES', color: 'text-new-mint/70' };
  if (prob >= 0.4) return { label: 'Toss-up', color: 'text-gray-400' };
  if (prob >= 0.2) return { label: 'Lean NO', color: 'text-off-red/70' };
  return { label: 'Strong NO', color: 'text-off-red' };
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

// Round state interface
export interface RoundState {
  id: number;
  targetPrice: number;   // in cents
  deadline: number;       // block height
  durationMs: number;     // round duration in ms
  endTime: number;        // timestamp when round ends
  yesPool: number;        // micro DART
  noPool: number;         // micro DART
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

// Fetch reputation data from on-chain mappings
export async function fetchReputation(address: string): Promise<ReputationData> {
  try {
    const userKey = await fetchUserKey(address);
    const [betsRaw, winsRaw, streakRaw] = await Promise.all([
      fetchMapping(BTC_PREDICTION_PROGRAM, 'user_bets', userKey),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'user_wins', userKey),
      fetchMapping(BTC_PREDICTION_PROGRAM, 'user_streak', userKey),
    ]);
    return getReputationData(parseU64(betsRaw), parseU64(winsRaw), parseU64(streakRaw));
  } catch (err) {
    console.warn('Failed to fetch reputation (WASM hash may have failed):', err);
    return getReputationData(0, 0, 0);
  }
}

// Compute the same user hash key as the contract: BHP256::hash_to_field(address)
async function fetchUserKey(address: string): Promise<string> {
  const { bhp256HashToField } = await import('@/lib/aleoHash');
  return bhp256HashToField(address);
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
  const bonusAmount = Math.floor(baseFee * (bonusPct / 100) * 10); // bonusPct of gross
  const basePayout = gross - baseFee;
  // Bonus comes from fee reduction: base_net + (base_net * bonusPct / 100)
  return Math.floor(basePayout + basePayout * bonusPct / 100);
}

// Time-weight bonus multiplier
export function getTimeWeightMultiplier(
  betBlock: number,
  roundStart: number,
  roundDeadline: number,
): number {
  const totalBlocks = roundDeadline - roundStart;
  if (totalBlocks <= 0) return 1.0;
  const elapsed = betBlock - roundStart;
  const pct = elapsed / totalBlocks;
  if (pct <= 0.25) return 1.15;
  if (pct <= 0.50) return 1.10;
  if (pct <= 0.75) return 1.05;
  return 1.0;
}
