import type { OracleData } from './sui/predictApi';
import { defaultStrike, nearestStrike } from './roundHelpers';

export type MarketLineSource = 'explicit' | 'previous-settlement' | 'reference-price' | 'grid-fallback';

export interface MarketLine {
  strike: number;
  source: MarketLineSource;
  previousSettlementPrice?: number;
  previousOracleId?: string;
}

interface CanonicalMarketLineInput {
  oracle: OracleData;
  settledOracles?: OracleData[];
  referencePrice?: number | null;
  explicitStrike?: number | null;
  waitForSettledOracles?: boolean;
  settledOraclesLoaded?: boolean;
}

function oracleAsset(oracle: OracleData): string {
  return oracle.underlying_asset || 'BTC';
}

export function normalizeMarketStrike(strike: number, oracle: OracleData): number {
  return nearestStrike(strike, oracle.min_strike, oracle.tick_size);
}

export function previousSettledOracle(oracles: OracleData[] = [], oracle: OracleData): OracleData | null {
  const asset = oracleAsset(oracle);
  return oracles
    .filter(o =>
      o.status === 'settled' &&
      o.settlement_price !== null &&
      oracleAsset(o) === asset &&
      o.expiry <= oracle.expiry,
    )
    .sort((a, b) => (b.settled_at ?? b.expiry) - (a.settled_at ?? a.expiry))[0] ?? null;
}

export function previousSettlementStrike(oracles: OracleData[] = [], oracle: OracleData): number | null {
  const previous = previousSettledOracle(oracles, oracle);
  return previous?.settlement_price == null ? null : normalizeMarketStrike(previous.settlement_price, oracle);
}

export function fallbackMarketStrike(oracle: OracleData, referencePrice?: number | null): number {
  if (referencePrice && referencePrice > 0) {
    return defaultStrike(referencePrice, oracle.min_strike, oracle.tick_size);
  }

  return defaultStrike(oracle.min_strike + oracle.tick_size * 25, oracle.min_strike, oracle.tick_size);
}

export function getCanonicalMarketLine({
  oracle,
  settledOracles = [],
  referencePrice,
  explicitStrike,
  waitForSettledOracles = false,
  settledOraclesLoaded = true,
}: CanonicalMarketLineInput): MarketLine | null {
  if (explicitStrike !== null && explicitStrike !== undefined) {
    return {
      strike: normalizeMarketStrike(explicitStrike, oracle),
      source: 'explicit',
    };
  }

  const previous = previousSettledOracle(settledOracles, oracle);
  if (previous?.settlement_price != null) {
    return {
      strike: normalizeMarketStrike(previous.settlement_price, oracle),
      source: 'previous-settlement',
      previousSettlementPrice: previous.settlement_price,
      previousOracleId: previous.oracle_id,
    };
  }

  if (waitForSettledOracles && !settledOraclesLoaded) return null;

  if (referencePrice && referencePrice > 0) {
    return {
      strike: defaultStrike(referencePrice, oracle.min_strike, oracle.tick_size),
      source: 'reference-price',
    };
  }

  return {
    strike: fallbackMarketStrike(oracle, null),
    source: 'grid-fallback',
  };
}
