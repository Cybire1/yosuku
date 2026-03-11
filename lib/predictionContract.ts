// Contract constants for BTC Prediction Market v8 (commitment scheme + dark pool)

export const PRED_TOKEN_PROGRAM = 'test_usdcx_stablecoin.aleo';
export const BTC_PREDICTION_PROGRAM = 'btc_pred_v8.aleo';

// On-chain address of btc_pred_v8.aleo (for token transfers to the program)
export const BTC_PREDICTION_ADDRESS = 'aleo1v5wrxmqe2urj30wqxyhnfymghw03kcdgu2pdcv7hhlw3z2vcs5rqwl2f7e';

// Token decimals: 1 USDCx = 1_000_000 micro-USDCx (6 decimals)
export const PRED_DECIMALS = 6;
export const PRED_MULTIPLIER = 1_000_000;

// Platform fee: 10% base (reduced by tier)
export const PLATFORM_FEE_BPS = 1000;

// Round duration in seconds
export const ROUND_DURATION_SECONDS = 300; // 5 minutes

// Default seed liquidity per side when creating a round (500 USDCx)
export const DEFAULT_SEED_AMOUNT = 500 * PRED_MULTIPLIER;

// Pool address: btc_pred_v8.aleo program address in USDCx balances
export const POOL_ADDRESS = BTC_PREDICTION_ADDRESS;

// Backend URL for dark pool bet reporting
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// Aleo API endpoints
export const ALEO_API_URL = 'https://api.explorer.provable.com/v1';
export const ALEO_NETWORK = 'testnet';

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
  const onChain = parseU128(val);
  const local = parseInt(localStorage.getItem('usdcx_balance') || '0', 10);

  // If on-chain returned a real positive value, trust it
  if (onChain > 0) {
    // Clear any pending optimistic update — chain has confirmed something
    localStorage.removeItem('usdcx_balance_pending');
    // Use whichever is higher: on-chain or local (local may include unconfirmed mints)
    const best = Math.max(onChain, local);
    localStorage.setItem('usdcx_balance', String(best));
    return best;
  }

  // On-chain returned 0 or null — check if there's a pending optimistic update
  const pendingRaw = localStorage.getItem('usdcx_balance_pending');
  if (pendingRaw) {
    try {
      const pending = JSON.parse(pendingRaw);
      const age = Date.now() - (pending.timestamp || 0);
      // Keep optimistic value for up to 5 minutes (Aleo testnet can be slow)
      if (age < 300_000 && pending.expectedBalance > 0) {
        return pending.expectedBalance;
      }
      localStorage.removeItem('usdcx_balance_pending');
    } catch {
      localStorage.removeItem('usdcx_balance_pending');
    }
  }

  // No pending update but we have a local balance — keep it.
  // Only an explicit spend (bet) or a positive on-chain value should reduce it.
  // This prevents the API returning null from wiping out the user's balance.
  if (local > 0) {
    return local;
  }

  return 0;
}

// Set an optimistic balance after a transaction (bet or claim)
export function setOptimisticBalance(expectedBalance: number) {
  localStorage.setItem('usdcx_balance', String(expectedBalance));
  localStorage.setItem('usdcx_balance_pending', JSON.stringify({
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
  yesPool: number;        // microcredits (0 during betting, revealed at resolution)
  noPool: number;         // microcredits (0 during betting, revealed at resolution)
  totalPool: number;      // dark pool: combined total (always visible)
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

// Fetch reputation data — v6 has no on-chain reputation mappings,
// so we compute from local positions instead
export async function fetchReputation(_address: string): Promise<ReputationData> {
  try {
    const positions: { roundId: number; side: string; amount: number }[] =
      JSON.parse(localStorage.getItem('v8_positions') || '[]');
    const claimed: number[] = JSON.parse(localStorage.getItem('v8_claimed') || '[]');
    const bets = positions.length;
    const wins = claimed.length;
    return getReputationData(bets, wins, 0);
  } catch {
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
