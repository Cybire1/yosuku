#!/usr/bin/env node

const PREDICT_BASE = 'https://predict-server.testnet.mystenlabs.com';
const FLOAT_SCALING = 1_000_000_000;
const DISPLAY_STRIKE_STEP = 50 * FLOAT_SCALING;

function nearestStrike(price, minStrike, tickSize) {
  if (tickSize <= 0) return minStrike;
  const ticks = Math.round((price - minStrike) / tickSize);
  return minStrike + Math.max(0, ticks) * tickSize;
}

function displayStrikeStep(tickSize) {
  if (tickSize <= 0) return DISPLAY_STRIKE_STEP;
  return Math.ceil(Math.max(DISPLAY_STRIKE_STEP, tickSize) / tickSize) * tickSize;
}

function fallbackMarketStrike(oracle, referencePrice) {
  if (referencePrice && referencePrice > 0) {
    const step = displayStrikeStep(oracle.tick_size);
    return nearestStrike(Math.round(referencePrice / step) * step, oracle.min_strike, oracle.tick_size);
  }
  return nearestStrike(oracle.min_strike + oracle.tick_size * 25, oracle.min_strike, oracle.tick_size);
}

function previousSettledOracle(oracles, oracle) {
  const asset = oracle.underlying_asset || 'BTC';
  return oracles
    .filter(o =>
      o.status === 'settled' &&
      o.settlement_price != null &&
      (o.underlying_asset || 'BTC') === asset &&
      o.expiry <= oracle.expiry,
    )
    .sort((a, b) => (b.settled_at ?? b.expiry) - (a.settled_at ?? a.expiry))[0] ?? null;
}

async function fetchJson(path) {
  const res = await fetch(`${PREDICT_BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

function dollars(value) {
  return value == null ? null : value / FLOAT_SCALING;
}

const oracles = await fetchJson('/oracles');
const now = Date.now();
const active = oracles
  .filter(o => o.status === 'active' && o.expiry > now)
  .sort((a, b) => a.expiry - b.expiry)[0];

if (!active) {
  console.log('No active oracle found.');
  process.exit(0);
}

const price = await fetchJson(`/oracles/${active.oracle_id}/prices/latest`).catch(() => null);
const referencePrice = price?.forward || price?.spot || null;
const previous = previousSettledOracle(oracles, active);
const fallback = fallbackMarketStrike(active, referencePrice);
const strike = previous
  ? nearestStrike(previous.settlement_price, active.min_strike, active.tick_size)
  : fallback;

console.log(JSON.stringify({
  oracle: active.oracle_id,
  asset: active.underlying_asset || 'BTC',
  source: previous ? 'previous-settlement' : 'fallback-forward',
  previousSettlement: dollars(previous?.settlement_price),
  strike: dollars(strike),
  fallbackForwardStrike: dollars(fallback),
  liveForward: dollars(price?.forward),
  tick: dollars(active.tick_size),
}, null, 2));
