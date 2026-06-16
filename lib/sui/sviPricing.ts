// SVI (Stochastic Volatility Inspired) pricing engine
// Replicates oracle.move::compute_nd2 in TypeScript for display purposes
// On-chain contract is authoritative — these are estimates only

import type { SviParams } from './predictApi';
import { FLOAT_SCALING } from './constants';

// ── Normal CDF via erf approximation (Abramowitz & Stegun 7.1.26) ──

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x >= 0 ? 1 : -1;
  const abs = Math.abs(x);
  const t = 1.0 / (1.0 + p * abs);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
  return sign * y;
}

function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// ── Core SVI price computation ──

/**
 * Compute binary option price for a single strike.
 * Math from oracle.move lines 1012-1044:
 *   k = ln(strike / forward)
 *   w(k) = a + b * (rho*(k-m) + sqrt((k-m)^2 + sigma^2))
 *   d2 = -(k + w/2) / sqrt(w)
 *   price = normalCDF(d2)
 *
 * SVI params and strike/forward are FLOAT_SCALING-encoded (1e9).
 * Returns probability 0-1.
 */
export function computeSviPrice(
  svi: SviParams,
  strike: number,
  forward: number,
): number {
  if (forward <= 0 || strike <= 0) return 0;

  // Decode from FLOAT_SCALING to regular floats
  const a = svi.a / FLOAT_SCALING;
  const b = svi.b / FLOAT_SCALING;
  const rho = svi.rho / FLOAT_SCALING;
  const m = svi.m / FLOAT_SCALING;
  const sigma = svi.sigma / FLOAT_SCALING;

  const k = Math.log(strike / forward);

  const km = k - m;
  const w = a + b * (rho * km + Math.sqrt(km * km + sigma * sigma));

  if (w <= 0) return k < 0 ? 1 : 0;

  const d2 = -(k + w / 2) / Math.sqrt(w);
  return normalCDF(d2);
}

/**
 * Compute range price = P(settlement in (lower, higher]).
 * This is P(above lower) - P(above higher).
 */
export function computeRangePrice(
  svi: SviParams,
  lowerStrike: number,
  higherStrike: number,
  forward: number,
): number {
  const pAboveLower = computeSviPrice(svi, lowerStrike, forward);
  const pAboveHigher = computeSviPrice(svi, higherStrike, forward);
  return Math.max(0, pAboveLower - pAboveHigher);
}

/**
 * Compute fair prices for an entire strike grid.
 */
export function computeStrikeGrid(
  svi: SviParams,
  forward: number,
  strikes: number[],
): { strike: number; fairPrice: number }[] {
  return strikes.map(strike => ({
    strike,
    fairPrice: computeSviPrice(svi, strike, forward),
  }));
}

// ── Implied volatility (from the SVI surface) — powers the chain / smile / term-structure ──

const SECONDS_PER_YEAR = 365.25 * 24 * 3600;

/**
 * SVI total implied variance w(k) = σ²·T at `strike` (decoded from FLOAT_SCALING).
 * Scale-invariant in strike/forward (only the ratio enters via k = ln(strike/forward)),
 * so dollars or encoded values both work as long as both are in the same unit.
 */
export function totalVariance(svi: SviParams, strike: number, forward: number): number {
  if (forward <= 0 || strike <= 0) return 0;
  const a = svi.a / FLOAT_SCALING;
  const b = svi.b / FLOAT_SCALING;
  const rho = svi.rho / FLOAT_SCALING;
  const m = svi.m / FLOAT_SCALING;
  const sigma = svi.sigma / FLOAT_SCALING;
  const k = Math.log(strike / forward);
  const km = k - m;
  return a + b * (rho * km + Math.sqrt(km * km + sigma * sigma));
}

/**
 * Annualized implied volatility implied by the SVI surface at `strike`, as a fraction
 * (e.g. 0.65 = 65%). IV = sqrt(totalVariance / T_years). `secondsToExpiry` is the time
 * left on the round. The same surface that prices the binary IS the vol surface — this
 * just reads it back as a quotable vol.
 */
export function impliedVolAnnual(
  svi: SviParams,
  strike: number,
  forward: number,
  secondsToExpiry: number,
): number {
  const w = totalVariance(svi, strike, forward);
  const T = Math.max(secondsToExpiry, 1) / SECONDS_PER_YEAR;
  if (w <= 0 || T <= 0) return 0;
  return Math.sqrt(w / T);
}

/** At-the-money implied vol (strike = forward, k = 0) — the point for a term-structure curve. */
export function atmImpliedVol(svi: SviParams, forward: number, secondsToExpiry: number): number {
  return impliedVolAnnual(svi, forward, forward, secondsToExpiry);
}

export interface SmilePoint {
  strike: number;
  logMoneyness: number;
  iv: number;        // annualized, as a fraction
  prob: number;      // P(settle above strike) = the UP digital price, 0..1
}

/**
 * A volatility smile: implied vol + the UP digital price across a strike grid centered on
 * the forward (±spanPct). The curve you render to show Predict is a real, surfaced options
 * venue rather than a single up/down toggle.
 */
export function sviSmile(
  svi: SviParams,
  forward: number,
  secondsToExpiry: number,
  opts?: { spanPct?: number; steps?: number },
): SmilePoint[] {
  const span = opts?.spanPct ?? 0.18; // ±18% around the forward
  const steps = Math.max(3, opts?.steps ?? 41);
  const pts: SmilePoint[] = [];
  for (let i = 0; i < steps; i++) {
    const f = (i / (steps - 1)) * 2 - 1; // -1 … 1
    const strike = forward * (1 + f * span);
    if (strike <= 0) continue;
    pts.push({
      strike,
      logMoneyness: Math.log(strike / forward),
      iv: impliedVolAnnual(svi, strike, forward, secondsToExpiry),
      prob: computeSviPrice(svi, strike, forward),
    });
  }
  return pts;
}

// ── Fee computation (from pricing_config.move lines 106-121) ──

export interface FeeBreakdown {
  fairPrice: number;         // per-unit fair value (0-1)
  bernoulliFee: number;      // base_fee * sqrt(p * (1-p))
  utilizationFee: number;    // base_fee * util_mult * (liability/balance)^2
  totalFee: number;          // max(bernoulli, minFee) + utilization
  totalCostPerUnit: number;  // fairPrice + totalFee (what user pays per unit)
}

/**
 * Compute fee breakdown for a position.
 * All monetary values in FLOAT_SCALING (1e9).
 */
export function computeFeeBreakdown(
  fairPrice: number,
  baseFee: number,
  minFee: number,
  utilMultiplier: number,
  liability: number,
  balance: number,
): FeeBreakdown {
  // Decode from FLOAT_SCALING
  const p = fairPrice / FLOAT_SCALING;
  const bFee = baseFee / FLOAT_SCALING;
  const mFee = minFee / FLOAT_SCALING;
  const uMult = utilMultiplier / FLOAT_SCALING;

  // Bernoulli fee: baseFee * sqrt(p * (1-p))
  const bernoulliFee = bFee * Math.sqrt(p * (1 - p));

  // Utilization fee: baseFee * utilMultiplier * (liability/balance)^2
  const utilRatio = balance > 0 ? liability / balance : 0;
  const utilizationFee = bFee * uMult * utilRatio * utilRatio;

  // Total fee: max(bernoulli, minFee) + utilization
  const totalFee = Math.max(bernoulliFee, mFee) + utilizationFee;

  return {
    fairPrice: p,
    bernoulliFee,
    utilizationFee,
    totalFee,
    totalCostPerUnit: p + totalFee,
  };
}
