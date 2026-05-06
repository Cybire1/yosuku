// Realized + unrealized P&L computation
// Uses SVI fair pricing for mark-to-market on active positions

import type { PositionData, TradeData, SviParams } from './predictApi';
import { computeSviPrice, computeRangePrice } from './sviPricing';
import { FLOAT_SCALING, DUSDC_MULTIPLIER, POS_INF, NEG_INF } from './constants';

// ── Types ──

export interface PositionPnL {
  oracleId: string;
  direction: 'UP' | 'DOWN' | 'RANGE';
  strike: number;
  quantity: number;          // DUSDC display units
  entryPrice: number;        // per-unit cost (0-1)
  currentPrice: number;      // per-unit fair value from SVI (0-1)
  unrealizedPnL: number;     // (currentPrice - entryPrice) * quantity
  unrealizedPnLPct: number;  // percentage change
}

export interface RealizedTrade {
  timestamp: number;
  pnl: number;
  cumPnl: number;
}

// ── Helpers ──

function getDirection(lowerStrike: string, higherStrike: string): 'UP' | 'DOWN' | 'RANGE' {
  if (lowerStrike === NEG_INF || lowerStrike === '0') return 'DOWN';
  if (higherStrike === POS_INF || higherStrike === '18446744073709551615') return 'UP';
  return 'RANGE';
}

function getStrike(lowerStrike: string, higherStrike: string): number {
  const dir = getDirection(lowerStrike, higherStrike);
  if (dir === 'UP') return Number(lowerStrike);
  if (dir === 'DOWN') return Number(higherStrike);
  return Number(lowerStrike);
}

// ── Unrealized P&L ──

/**
 * Compute P&L for a single active position given current SVI params.
 * Returns null if SVI data unavailable.
 */
export function computePositionPnL(
  position: PositionData,
  svi: SviParams | null,
  forward: number | null,
): PositionPnL | null {
  if (!svi || !forward || forward <= 0) return null;

  const direction = getDirection(position.lower_strike, position.higher_strike);
  const strike = getStrike(position.lower_strike, position.higher_strike);
  const quantity = Number(position.quantity) / DUSDC_MULTIPLIER;

  // Entry price from position data (0-1 scale, FLOAT_SCALING encoded)
  const entryPrice = position.entry_price != null
    ? position.entry_price / FLOAT_SCALING
    : 0.5; // fallback if not available

  // Current fair price from SVI
  let currentPrice: number;
  if (direction === 'RANGE') {
    currentPrice = computeRangePrice(
      svi,
      Number(position.lower_strike),
      Number(position.higher_strike),
      forward,
    );
  } else {
    currentPrice = computeSviPrice(svi, strike, forward);
    // For DOWN positions, price is 1 - P(above strike)
    if (direction === 'DOWN') {
      currentPrice = 1 - currentPrice;
    }
  }

  const unrealizedPnL = (currentPrice - entryPrice) * quantity;
  const unrealizedPnLPct = entryPrice > 0
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : 0;

  return {
    oracleId: position.oracle_id,
    direction,
    strike,
    quantity,
    entryPrice,
    currentPrice,
    unrealizedPnL,
    unrealizedPnLPct,
  };
}

// ── Realized P&L ──

/**
 * Compute realized P&L from trade history.
 * Pairs mints with redeems chronologically.
 * Returns cumulative timeline.
 */
export function computeRealizedPnL(trades: TradeData[]): RealizedTrade[] {
  if (!trades.length) return [];

  // Sort by timestamp
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  const results: RealizedTrade[] = [];
  let cumPnl = 0;

  // Track mint prices by position key
  const mintPrices = new Map<string, number[]>();

  for (const trade of sorted) {
    const key = `${trade.oracle_id}-${trade.lower_strike}-${trade.higher_strike}`;

    if (trade.side === 'mint') {
      const existing = mintPrices.get(key) || [];
      existing.push(trade.price);
      mintPrices.set(key, existing);
    } else if (trade.side === 'redeem') {
      const mints = mintPrices.get(key);
      const mintPrice = mints?.shift() ?? 0;
      const qty = Number(trade.quantity) / DUSDC_MULTIPLIER;
      const redeemPrice = trade.price / FLOAT_SCALING;
      const entryP = mintPrice / FLOAT_SCALING;
      const pnl = (redeemPrice - entryP) * qty;
      cumPnl += pnl;

      results.push({
        timestamp: trade.timestamp,
        pnl,
        cumPnl,
      });
    }
  }

  return results;
}
