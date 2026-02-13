// Contract constants for BTC Prediction Market

export const PRED_TOKEN_PROGRAM = 'dart_token.aleo';
export const BTC_PREDICTION_PROGRAM = 'btc_prediction.aleo';

// Token decimals: 1 DART = 1_000_000 microtokens
export const PRED_DECIMALS = 6;
export const PRED_MULTIPLIER = 1_000_000;

// Platform fee: 10%
export const PLATFORM_FEE_BPS = 1000;

// Round duration in seconds
export const ROUND_DURATION_SECONDS = 300; // 5 minutes

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
    return text.replace(/"/g, '').trim();
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
