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
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
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
