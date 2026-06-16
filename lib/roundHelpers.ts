// Oracle market helpers for DeepBook Predict
// Uses the predict server API for oracle/market data

import { FLOAT_SCALING } from './sui/constants';
import type { OracleData } from './sui/predictApi';

// ── Local Position Storage ───────────────────────────────
// On-chain positions live in PredictManager.
// We keep a local record for instant UI updates.

export interface LocalPosition {
  oracleId: string;
  expiry: number;
  strike: number;
  direction: 'UP' | 'DOWN';
  quantity: number;
  cost: number;
  timestamp: number;
  txDigest?: string;
  claimed?: boolean;
}

const POSITIONS_KEY = 'sui_positions';
const CLAIMED_KEY = 'sui_claimed';

export function loadPositions(): LocalPosition[] {
  try {
    return JSON.parse(localStorage.getItem(POSITIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function savePosition(position: LocalPosition) {
  const positions = loadPositions();
  positions.push(position);
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
}

export function removePosition(oracleId: string, timestamp: number) {
  const positions = loadPositions().filter(
    p => !(p.oracleId === oracleId && p.timestamp === timestamp),
  );
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
}

export function markClaimed(oracleId: string) {
  const claimed: string[] = JSON.parse(localStorage.getItem(CLAIMED_KEY) || '[]');
  if (!claimed.includes(oracleId)) {
    claimed.push(oracleId);
    localStorage.setItem(CLAIMED_KEY, JSON.stringify(claimed));
  }
}

export function isPositionClaimed(oracleId: string): boolean {
  const claimed: string[] = JSON.parse(localStorage.getItem(CLAIMED_KEY) || '[]');
  return claimed.includes(oracleId);
}

// ── Strike Grid Helpers ──────────────────────────────────

export const DEFAULT_DISPLAY_STRIKE_STEP = 50 * FLOAT_SCALING;

function displayStrikeStep(tickSize: number, displayStep: number = DEFAULT_DISPLAY_STRIKE_STEP): number {
  if (tickSize <= 0) return Math.max(displayStep, 1);
  const minStep = Math.max(displayStep, tickSize);
  return Math.ceil(minStep / tickSize) * tickSize;
}

export function generateStrikeGrid(
  minStrike: number,
  tickSize: number,
  numTicks: number = 50,
  centerPrice?: number,
): number[] {
  const strikes: number[] = [];
  if (centerPrice && tickSize > 0) {
    const centerTick = Math.round((centerPrice - minStrike) / tickSize);
    const halfTicks = Math.floor(numTicks / 2);
    const startTick = Math.max(0, centerTick - halfTicks);
    for (let i = 0; i < numTicks; i++) {
      strikes.push(minStrike + (startTick + i) * tickSize);
    }
  } else {
    for (let i = 0; i < numTicks; i++) {
      strikes.push(minStrike + tickSize * i);
    }
  }
  return strikes;
}

export function formatStrike(scaledStrike: number): string {
  return '$' + (scaledStrike / FLOAT_SCALING).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Find the nearest strike in the grid to a given price */
export function nearestStrike(price: number, minStrike: number, tickSize: number): number {
  if (tickSize <= 0) return minStrike;
  const ticks = Math.round((price - minStrike) / tickSize);
  return minStrike + Math.max(0, ticks) * tickSize;
}

/** Default app line: human-readable, still snapped back to the valid protocol grid. */
export function defaultStrike(
  price: number,
  minStrike: number,
  tickSize: number,
  displayStep: number = DEFAULT_DISPLAY_STRIKE_STEP,
): number {
  if (price <= 0 || tickSize <= 0) return minStrike;
  const step = displayStrikeStep(tickSize, displayStep);
  const rounded = Math.round(price / step) * step;
  return nearestStrike(rounded, minStrike, tickSize);
}

/** Coarse strike menu for explicit configuration; avoids exposing every raw tick. */
export function generateDisplayStrikeGrid(
  minStrike: number,
  tickSize: number,
  numSteps: number = 21,
  centerPrice?: number,
  displayStep: number = DEFAULT_DISPLAY_STRIKE_STEP,
): number[] {
  if (tickSize <= 0) return [minStrike];

  const step = displayStrikeStep(tickSize, displayStep);
  const half = Math.floor(numSteps / 2);
  const center = centerPrice
    ? defaultStrike(centerPrice, minStrike, tickSize, displayStep)
    : defaultStrike(minStrike + step * half, minStrike, tickSize, displayStep);
  const start = center - half * step;
  const seen = new Set<number>();
  const strikes: number[] = [];

  for (let i = 0; i < numSteps; i++) {
    const strike = nearestStrike(Math.max(minStrike, start + i * step), minStrike, tickSize);
    if (!seen.has(strike)) {
      seen.add(strike);
      strikes.push(strike);
    }
  }

  return strikes;
}

// ── Time helpers ─────────────────────────────────────────

export function getTimeRemaining(expiryMs: number): {
  totalMs: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
} {
  const totalMs = Math.max(0, expiryMs - Date.now());
  const expired = totalMs <= 0;
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    totalMs,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired,
  };
}

export function formatTimeRemaining(expiryMs: number): string {
  const { hours, minutes, seconds, expired } = getTimeRemaining(expiryMs);
  if (expired) return 'Expired';
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Day-aware ticker for the "EXPIRES IN" displays. `hours` here is the TOTAL
 * hours remaining (as returned by getTimeRemaining), so a 23-day market is
 * `hours === 552` — without this it renders as "552:42:41".
 *   ≥ 1 day  → "23d 00h 42m"   (seconds are noise at multi-day range)
 *   < 1 day  → "HH:MM:SS"
 *   < 1 hour → "MM:SS"
 */
export function formatCountdown(t: { hours: number; minutes: number; seconds: number; expired: boolean }): string {
  if (t.expired) return 'Expired';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (t.hours >= 24) {
    return `${Math.floor(t.hours / 24)}d ${pad(t.hours % 24)}h ${pad(t.minutes)}m`;
  }
  if (t.hours > 0) return `${pad(t.hours)}:${pad(t.minutes)}:${pad(t.seconds)}`;
  return `${pad(t.minutes)}:${pad(t.seconds)}`;
}

/** Stub: get saved payout (for legacy PnLChart/PredictionStats) */
export function getSavedPayout(_oracleId: string): number {
  return 0;
}

/** Stub: fetch round data (legacy) */
export async function fetchRound(_id: string | number): Promise<null> {
  return null;
}

/** Stub: get bet commitment (legacy) */
export function getBetCommitment(_address: string, _roundId: number): null {
  return null;
}

/** Group oracles by time proximity */
export function groupOraclesByTimeframe(oracles: OracleData[]): {
  expiringSoon: OracleData[];
  nextHour: OracleData[];
  later: OracleData[];
} {
  const now = Date.now();
  const expiringSoon: OracleData[] = [];
  const nextHour: OracleData[] = [];
  const later: OracleData[] = [];

  for (const o of oracles) {
    const msLeft = o.expiry - now;
    if (msLeft <= 15 * 60 * 1000) {
      expiringSoon.push(o);
    } else if (msLeft <= 60 * 60 * 1000) {
      nextHour.push(o);
    } else {
      later.push(o);
    }
  }

  return { expiringSoon, nextHour, later };
}
