// DeepBook Predict `predict-testnet-6-24` — browser-safe data + tx client.
//
// The 6-24 deployment is a full rewrite of the integration layer (NOT an ID swap):
//   • custody moved to the `account` package — one shared AccountWrapper per owner
//     (deterministic derived address) + an `Auth` hot-potato generated per tx;
//   • pricing needs a per-PTB `Pricer` built from FOUR oracle feeds
//     (expiry_market::load_live_pricer) chained in the SAME transaction;
//   • markets are rolling per-expiry cadence markets (1m/5m/1h) discovered from the
//     beta indexer, each selling European cash-or-nothing RANGE DIGITALS;
//   • native leverage: `leverage` (1e9 = 1x) sets a financed floor; payout on a win
//     is quantity − floor.
//
// SAFETY: this client only ever uses the OWNER auth path (`account::generate_auth`,
// tied to the tx sender). It never touches app auth (`generate_auth_as_app`) — that
// is a full-custody bearer credential. Delegated/agent custody is expressed on-chain
// via object-owned wrappers (see the vault624 Move module), not here.
//
// CORS: BOTH hosts (predict-server-beta + propbook) serve
// `access-control-allow-origin: *` (verified 2026-07-03), so the browser fetches
// them directly — no /api proxy route is needed.
//
// Everything here follows the strategyClient/modernClients idioms: reads via
// GraphQL/gRPC (gql/grpc) with a JSON-RPC fallback where testnet GraphQL is
// unreliable; writes are wallet-signed `Transaction` builders (no keys, no node
// imports — browser-safe).
//
// Proven-on-chain reference flows: suioverflow/x-relay/spike-624.mjs (owner path),
// spike-624b.mjs (delegated vault path), predict624.mjs (the node twin of this file).

import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import { gql, grpc } from './modernClients';
import { DUSDC_TYPE, CLOCK_ID, DUSDC_MULTIPLIER } from './constants';

// ─── strike-tick sentinels (vendor predict source, constants.move) ───
//   tick_bits!() = 30                            (constants.move:149)
//   pos_inf_tick!() = (1u64 << tick_bits!()) - 1 (constants.move:155) = 1_073_741_823
//   lower_tick 0 = −inf sentinel                 (constants.move:161, order.move:56)
// Mint admission exempts both sentinels from the $1 admission grid, but the FULL
// open range (0, pos_inf_tick) is rejected on-chain (order.move:211 EInvalidRange).
export const POS_INF_TICK = (1n << 30n) - 1n; // 1073741823n
export const NEG_INF_TICK = 0n;

// ─── deployment constants (predict-testnet-6-24, deployment.testnet.json updatedAt 2026-06-25) ───

export const PREDICT624 = {
  /** `predict` package — expiry_market / plp / registry / protocol_config. */
  predictPackage: '0xdb3ef5a5129920e59c9b2ae25a77eddb48acd0e1c6307b97073f0e076016446e',
  /** `account` package — custody (AccountWrapper + Auth). */
  accountPackage: '0xb9389eac8d59170ffd1427c1a66e5c8306263464fcc6615e825c1f5b3e15da3b',
  /** predict::protocol_config::ProtocolConfig (shared). */
  protocolConfig: '0x2325224629b4bd96d1f1d7ee937e07f8a06f861018a130bbb26db09cb0394cb6',
  /** Yosuku's native BuilderCode (predict::builder_code, owner = treasury 0xaa50…),
   *  created on-chain 2026-07-17 (tx HR2FoJ1z). Attached to the accounts we mint for so
   *  their trades ride DeepBook Predict's OWN builder-fee rail. Pays 0 until the protocol
   *  enables builder fees: wired now so revenue is a config flip, never a migration. */
  builderCode: '0x3d02c41f853b6a62510a517b149ed44a1322476974e309c42d0c4ff99c0abb6a',
  /** account::account_registry::AccountRegistry (shared) — wrapper derivation root. */
  accountRegistry: '0x3c54d5b8b6bca376fc289121838ad02f8a5b3843242b9ad7e8f8245720e685a2',
  /** propbook::registry::OracleRegistry (shared). */
  oracleRegistry: '0xf3deaff68cbd081a35ec21653af6f671d2ad5f012f3b4d817d81752843374136',
  /** BTC_USD oracle feed objects — ALL FOUR feed the per-PTB Pricer. */
  pythFeed: '0xc78d7de16217d46d21b92ae475da799448be30b71a758dc6d7bb3ac2f1c35afb',
  bsSpotFeed: '0xcdc5fa7364e60fd2504aa96f65b707dc0734e507a919b1a7d7d63164fd67b745',
  bsForwardFeed: '0xe72c734ea8d8dcbc9183d9d8f96f51aaa1fb5034d5ed33ac60d67d261e15b48a',
  bsSviFeed: '0xdc2f8270676bd05fb28491e8d4a41a495722fda7a454926dd66dbba256a21c69',
  /** Framework AccumulatorRoot (fund settlement) — required on every account-touching call. */
  accumulatorRoot: '0x0000000000000000000000000000000000000000000000000000000000000acc',
  clock: CLOCK_ID,
  dusdcType: DUSDC_TYPE,
  /** Beta indexer for THIS deployment (the old predict-server is the 4-16 one). */
  indexer: 'https://predict-server-beta.testnet.mystenlabs.com',
  /** Oracle (propbook) indexer — off-chain pyth observations + feed discovery. */
  propbook: 'https://propbook.api.testnet.mystenlabs.com',
  /** Open-ended range sentinels (tick indices): lower 0 = −inf, higher 2^30−1 = +inf. */
  POS_INF_TICK,
  NEG_INF_TICK,
} as const;

/** 1e9 fixed-point scale used for probabilities and leverage (1e9 = 1x / 100%). */
export const FLOAT_SCALING_624 = 1_000_000_000;

// ─── tick math ───
// Markets run a $0.01 tick grid (tick_size 1e7) with mint admission snapped to a $1
// grid (admission_tick_size 1e9) → tick index = whole-dollars × 100.

/** Whole-dollar USD strike → raw tick index on the $0.01 grid ($1 admission ⇒ ×100). */
export function usdToTick(usd: number): bigint {
  return BigInt(Math.round(usd)) * 100n;
}

/** Tick index → USD strike. */
export function tickToUsd(tick: number | bigint): number {
  return Number(tick) / 100;
}

// ─── market discovery (beta indexer) ───

export type Cadence624 = '1m' | '5m' | '1h';

export interface Market624 {
  /** ExpiryMarket object id. */
  id: string;
  /** Expiry, ms epoch. */
  expiry: number;
  /** Minutes until expiry at fetch time. */
  minsOut: number;
  /** Cadence, read from the real trading window (see cadenceFromWindow624). */
  cadence: Cadence624;
  /** Total trading window in minutes (expiry − created). windowSize×cadence ≈ 3×
   *  cadence in the 6-24 deployment, so this is the max the countdown ever reads. */
  windowMin: number;
  /** Market tick size (1e9-scaled USD per tick; 1e7 = $0.01). */
  tickSize: number;
  /** Admission tick size (1e9-scaled; 1e9 = $1 strike grid). */
  admissionTickSize: number;
  /** Max admission leverage, 1e9-scaled (3e9 = 3x). */
  maxLeverage1e9: number;
}

interface IndexerMarketRow {
  expiry_market_id: string;
  expiry: number | string;
  /** market_created checkpoint time (ms) — the market's open time. */
  checkpoint_timestamp_ms?: string | number;
  tick_size: string | number;
  admission_tick_size: string | number;
  max_admission_leverage: number | string;
}

/**
 * Canonical cadence classification — matches Mysten's own dashboard
 * (`_owner_cadence`): a market's cadence is the COARSEST cadence whose period
 * divides its expiry (an on-the-hour expiry is owned by 1h even though 1m and 5m
 * divide it too). The venue mints exactly one market per expiry timestamp, owned
 * by that cadence, so this is exact — not a heuristic. Each market then trades
 * for windowSize×cadence (= 3× cadence in the 6-24 deployment), which is why a
 * 1m market's countdown can read up to ~3 min.
 */
export function inferCadence624(expiryMs: number): Cadence624 {
  return expiryMs % 3_600_000 === 0 ? '1h' : expiryMs % 300_000 === 0 ? '5m' : '1m';
}

/** Future-only markets from the beta indexer, deduped by id, soonest-expiry first.
 *
 * NOTE the `limit`: /markets returns recent `market_created` events newest-first,
 * and 1-minute markets are created every minute — with the indexer's small default
 * limit they flood the page and push the nearer 1-hour (and 5-minute) creations off
 * the list, so those lanes falsely appear empty. A generous limit keeps every open
 * cadence in view (max market window is ~3h; 500 events ≈ 7h of creations). */
const MARKETS_FETCH_LIMIT = 500;
export async function fetchMarkets624(): Promise<Market624[]> {
  const res = await fetch(`${PREDICT624.indexer}/markets?limit=${MARKETS_FETCH_LIMIT}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`predict624 indexer /markets ${res.status}`);
  const rows = (await res.json()) as IndexerMarketRow[];
  const now = Date.now();
  const seen = new Set<string>();
  const out: Market624[] = [];
  for (const m of Array.isArray(rows) ? rows : []) {
    const id = String(m.expiry_market_id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const expiry = Number(m.expiry);
    if (expiry <= now) continue; // future-only
    // Cadence from expiry alignment (inferCadence624 = Mysten's canonical
    // _owner_cadence). Also carry the real trading window (expiry − created) for
    // display — it's windowSize×cadence (≈3× the cadence period).
    const created = Number(m.checkpoint_timestamp_ms);
    const hasWindow = Number.isFinite(created) && created > 0 && created < expiry;
    const windowMs = hasWindow ? expiry - created : NaN;
    out.push({
      id,
      expiry,
      minsOut: (expiry - now) / 60_000,
      cadence: inferCadence624(expiry),
      windowMin: hasWindow ? windowMs / 60_000 : NaN,
      tickSize: Number(m.tick_size),
      admissionTickSize: Number(m.admission_tick_size),
      maxLeverage1e9: Number(m.max_admission_leverage),
    });
  }
  return out.sort((a, b) => a.expiry - b.expiry);
}

/**
 * Pick the soonest market expiring within (minMinutes, maxMinutes) from now.
 * The proven-on-chain mintable window is ~3.5–11 min out (too close to expiry the
 * pricer aborts / probability collapses). `cadence` is a SOFT filter (inferred —
 * see inferCadence624): if no market of that cadence is in the window the filter
 * is dropped rather than failing. Returns null when the window is empty (markets
 * roll every minute — retry shortly).
 */
export async function pickMarket624(
  p: { minMinutes?: number; maxMinutes?: number; cadence?: Cadence624 } = {},
): Promise<Market624 | null> {
  const { minMinutes = 3.5, maxMinutes = 11, cadence } = p;
  const markets = await fetchMarkets624();
  let candidates = markets.filter((m) => m.minsOut > minMinutes && m.minsOut < maxMinutes);
  if (cadence) {
    const only = candidates.filter((m) => m.cadence === cadence);
    if (only.length) candidates = only;
  }
  return candidates[0] ?? null; // already soonest-first
}

// ─── spot price (the EXACT pyth feed that settles these markets, via propbook) ───

interface PythLatest {
  price_magnitude: string | number;
  exponent_magnitude: string | number;
  exponent_is_negative?: boolean;
  price_is_negative?: boolean;
}

/**
 * Pyth observation history from the SETTLEMENT feed (propbook), OLDEST-FIRST for
 * charting: [{ usd, tsMs }]. Observations land roughly once per second, so
 * `limit` ≈ seconds of lookback. Same parse as the proven node twin
 * (suioverflow/x-relay/predict624.mjs pythHistory), reversed for drawing.
 */
export async function fetchPythHistory624(limit = 120): Promise<{ usd: number; tsMs: number }[]> {
  const res = await fetch(
    `${PREDICT624.propbook}/oracles/${PREDICT624.pythFeed}/pyth?limit=${limit}`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`propbook pyth history ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      usd:
        r.normalized_spot != null
          ? Number(r.normalized_spot) / 1e9
          : Number(r.price_magnitude) / 10 ** Number(r.exponent_magnitude),
      tsMs: Number(r.source_timestamp_ms ?? r.update_timestamp_ms),
    }))
    .filter((r) => Number.isFinite(r.usd) && r.usd > 0)
    .reverse(); // newest-first from the API → oldest-first for charts
}

/** Latest BTC/USD spot from the settlement pyth feed → USD number. */
export async function fetchSpot624(): Promise<number> {
  const res = await fetch(
    `${PREDICT624.propbook}/oracles/${PREDICT624.pythFeed}/pyth/latest`,
    { headers: { accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`propbook pyth/latest ${res.status}`);
  const j = (await res.json()) as PythLatest;
  const exp = Number(j.exponent_magnitude);
  const scale = j.exponent_is_negative === false ? 10 ** exp : 10 ** -exp;
  const price = Number(j.price_magnitude) * scale * (j.price_is_negative ? -1 : 1);
  if (!Number.isFinite(price) || price <= 0) throw new Error('pyth spot unavailable');
  return price;
}

// ─── tx builders (OWNER path — wallet signs; Auth is generated in-PTB, tied to the sender) ───

/**
 * One-time: create the sender's canonical derived AccountWrapper and share it.
 * Aborts on-chain if the wrapper already exists (use findWrapperId624 first).
 */
/** Attach Yosuku's native BuilderCode to a wrapper so this account's trades attribute
 *  builder fees to our treasury on DeepBook Predict's OWN rail (not a private wrapper).
 *  `wrapper` may be an object id (existing account) or a PTB-local result (a fresh
 *  account, before it is shared). Consumes a fresh owner Auth, so the account owner must
 *  be the tx sender. Pays 0 until the protocol enables the rail: wired now so revenue is
 *  a config flip, not a migration. */
function appendSetBuilderCode(tx: Transaction, wrapper: TransactionObjectArgument | string): void {
  const w = typeof wrapper === 'string' ? tx.object(wrapper) : wrapper;
  const auth = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${PREDICT624.predictPackage}::predict_account::set_builder_code`,
    arguments: [w, auth, tx.object(PREDICT624.builderCode)],
  });
}

export function buildCreateAccountTx(): Transaction {
  const tx = new Transaction();
  const wrapper = tx.moveCall({
    target: `${PREDICT624.accountPackage}::account_registry::new`,
    arguments: [tx.object(PREDICT624.accountRegistry)],
  });
  // ride DeepBook Predict's native builder rail — attach while the account is fresh (one signature)
  appendSetBuilderCode(tx, wrapper);
  tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::share`,
    arguments: [wrapper],
  });
  return tx;
}

/** Attach Yosuku's BuilderCode to an EXISTING account (owner-signed). For accounts
 *  created before the rail was wired, or to re-attach. Idempotent for our own code. */
export function buildSetBuilderCodeTx(wrapperId: string): Transaction {
  const tx = new Transaction();
  appendSetBuilderCode(tx, wrapperId);
  return tx;
}

/** Deposit DUSDC into the sender's account (merge coins → split exact → deposit_funds). */
export function buildDepositTx(p: {
  wrapperId: string;
  coinIds: string[];
  amountMicro: bigint;
}): Transaction {
  if (p.coinIds.length === 0) throw new Error('no DUSDC coins to deposit');
  const tx = new Transaction();
  const primary = tx.object(p.coinIds[0]);
  if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
  const [pay] = tx.splitCoins(primary, [tx.pure.u64(p.amountMicro)]);
  const auth = tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::generate_auth`,
    arguments: [],
  });
  tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::deposit_funds`,
    typeArguments: [PREDICT624.dusdcType],
    arguments: [tx.object(p.wrapperId), auth, pay, tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock)],
  });
  return tx;
}

/** Withdraw DUSDC from the sender's account back to their wallet (owner-gated by Auth). */
export function buildWithdrawTx(p: {
  wrapperId: string;
  amountMicro: bigint;
  /** Where the withdrawn coin goes — the connected wallet address. */
  recipient: string;
}): Transaction {
  const tx = new Transaction();
  const auth = tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::generate_auth`,
    arguments: [],
  });
  const coin = tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::withdraw_funds`,
    typeArguments: [PREDICT624.dusdcType],
    arguments: [tx.object(p.wrapperId), auth, tx.pure.u64(p.amountMicro), tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock)],
  });
  tx.transferObjects([coin], tx.pure.address(p.recipient));
  return tx;
}

/**
 * Mint a (possibly leveraged) range digital: chains `load_live_pricer` (all four
 * oracle feeds) → `generate_auth` → `mint_exact_quantity` in ONE PTB — the Pricer
 * is PTB-local and must be built in the same tx.
 *
 * Gotchas (proven on-chain): net_premium = prob × qty ÷ leverage must be ≥ 1 DUSDC
 * (protocol min); the leverage cap scales DOWN as entry probability rises, so
 * high-probability wide ranges reject 2x — tighten the range or drop leverage.
 * Open-ended ranges use the sentinels (NEG_INF_TICK / POS_INF_TICK), but the FULL
 * open range is rejected on-chain (order.move EInvalidRange) — guarded here too.
 */
/**
 * yosuku_rooms position gate — a `record` call folded into every bet PTB flips the
 * on-chain `has_bet` flag that unlocks that market's Room. Kept local (not imported
 * from comments.ts) so the core bet path doesn't pull in the messaging/Seal SDK.
 * `record` is idempotent per (user, market), so repeat bets are a safe no-op, and
 * it's atomic with the mint — the flag only sets if the bet actually lands.
 */
const ROOMS_GATE = {
  packageId: '0x7d22915a2bc60c2dcdb7055f69debe9d41e759b3f4e212330c17380e6795a658',
  betRegistry: '0xea58c10b34bbb90f226208c5895b8f159870a9f60d33bc5a11e1972763503dc6',
} as const;

/** Append the position-gate record so this market's Room unlocks for the sender. */
function appendRecordBet(tx: Transaction, marketId: string): void {
  tx.moveCall({
    target: `${ROOMS_GATE.packageId}::bet_registry::record`,
    arguments: [tx.object(ROOMS_GATE.betRegistry), tx.pure.id(marketId)],
  });
}

export function buildMintTx(p: {
  marketId: string;
  wrapperId: string;
  /** Tick indices on the $0.01 grid, $1-snapped (use usdToTick) or a sentinel. */
  lowerTick: number | bigint;
  higherTick: number | bigint;
  /** Contracts = DUSDC 6dp units of max payout. */
  qtyMicro: bigint;
  /** 1e9-scaled; 1e9 = 1x (no floor). */
  leverage1e9: bigint;
  /** Slippage: caps the ALL-IN withdrawal (net premium + fees + penalty), micro DUSDC. */
  maxCostMicro: bigint;
  /** Caps the quoted per-contract probability before fees, 1e9-scaled. */
  maxProb1e9: bigint;
}): Transaction {
  const lower = BigInt(p.lowerTick);
  const higher = BigInt(p.higherTick);
  if (lower === NEG_INF_TICK && higher === POS_INF_TICK) {
    throw new Error('full open range (−inf, +inf) is prohibited on-chain (EInvalidRange)');
  }
  const tx = new Transaction();
  const pricer = tx.moveCall({
    target: `${PREDICT624.predictPackage}::expiry_market::load_live_pricer`,
    arguments: [
      tx.object(p.marketId),
      tx.object(PREDICT624.protocolConfig),
      tx.object(PREDICT624.oracleRegistry),
      tx.object(PREDICT624.pythFeed),
      tx.object(PREDICT624.bsSpotFeed),
      tx.object(PREDICT624.bsForwardFeed),
      tx.object(PREDICT624.bsSviFeed),
      tx.object(PREDICT624.clock),
    ],
  });
  const auth = tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::generate_auth`,
    arguments: [],
  });
  tx.moveCall({
    target: `${PREDICT624.predictPackage}::expiry_market::mint_exact_quantity`,
    arguments: [
      tx.object(p.marketId),
      tx.object(p.wrapperId),
      auth,
      tx.object(PREDICT624.protocolConfig),
      pricer,
      tx.pure.u64(lower),
      tx.pure.u64(higher),
      tx.pure.u64(p.qtyMicro),
      tx.pure.u64(p.leverage1e9),
      tx.pure.u64(p.maxCostMicro),
      tx.pure.u64(p.maxProb1e9),
      tx.object(PREDICT624.accumulatorRoot),
      tx.object(PREDICT624.clock),
    ],
  });
  appendRecordBet(tx, p.marketId);
  return tx;
}

/**
 * ONE-SIGNATURE onboarding: create the account, fund it, place the first bet, and share
 * the account — all in a single PTB. The AccountWrapper from `account_registry::new` is a
 * command RESULT, so it's passed by reference through `deposit_funds` + `mint_exact_quantity`
 * and only `share`d at the end (the shared-input rule applies to declared inputs, not results).
 * A brand-new user goes connect → one tap → first bet, gas-free (every target is in the
 * yosuku-trading-624 sponsor policy). No pre-quote is possible (the account doesn't exist yet),
 * so cost is bounded by `maxCostMicro` (≤ the deposit) and the whole PTB reverts if it can't fit.
 */
export function buildCreateFundAndMint624(p: {
  coinIds: string[];
  depositMicro: bigint;
  marketId: string;
  lowerTick: number | bigint;
  higherTick: number | bigint;
  qtyMicro: bigint;
  leverage1e9: bigint;
  maxCostMicro: bigint;
  maxProb1e9: bigint;
}): Transaction {
  if (p.coinIds.length === 0) throw new Error('no DUSDC coins to fund the account');
  const lower = BigInt(p.lowerTick);
  const higher = BigInt(p.higherTick);
  if (lower === NEG_INF_TICK && higher === POS_INF_TICK) {
    throw new Error('full open range (−inf, +inf) is prohibited on-chain (EInvalidRange)');
  }
  const tx = new Transaction();
  // 1. create the account — `wrapper` is a PTB-local result, NOT yet shared
  const wrapper = tx.moveCall({
    target: `${PREDICT624.accountPackage}::account_registry::new`,
    arguments: [tx.object(PREDICT624.accountRegistry)],
  });
  // 1b. ride DeepBook Predict's native builder rail — attach our BuilderCode while the
  //     account is fresh (gasless: set_builder_code is allowlisted in the Onara policy)
  appendSetBuilderCode(tx, wrapper);
  // 2. fund it from the wallet's DUSDC
  const primary = tx.object(p.coinIds[0]);
  if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
  const [pay] = tx.splitCoins(primary, [tx.pure.u64(p.depositMicro)]);
  const authDep = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::deposit_funds`,
    typeArguments: [PREDICT624.dusdcType],
    arguments: [wrapper, authDep, pay, tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock)],
  });
  // 3. place the first bet against the just-funded account
  const pricer = tx.moveCall({
    target: `${PREDICT624.predictPackage}::expiry_market::load_live_pricer`,
    arguments: [
      tx.object(p.marketId), tx.object(PREDICT624.protocolConfig), tx.object(PREDICT624.oracleRegistry),
      tx.object(PREDICT624.pythFeed), tx.object(PREDICT624.bsSpotFeed), tx.object(PREDICT624.bsForwardFeed),
      tx.object(PREDICT624.bsSviFeed), tx.object(PREDICT624.clock),
    ],
  });
  const authMint = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${PREDICT624.predictPackage}::expiry_market::mint_exact_quantity`,
    arguments: [
      tx.object(p.marketId), wrapper, authMint, tx.object(PREDICT624.protocolConfig), pricer,
      tx.pure.u64(lower), tx.pure.u64(higher), tx.pure.u64(p.qtyMicro), tx.pure.u64(p.leverage1e9),
      tx.pure.u64(p.maxCostMicro), tx.pure.u64(p.maxProb1e9), tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock),
    ],
  });
  // 4. record the position so this market's Room unlocks for the sender
  appendRecordBet(tx, p.marketId);
  // 5. share the account LAST — now it becomes the user's canonical shared AccountWrapper
  tx.moveCall({ target: `${PREDICT624.accountPackage}::account::share`, arguments: [wrapper] });
  return tx;
}

/**
 * TOP-UP-AND-BET in one signature for an EXISTING account whose balance is below the bet:
 * deposit the shortfall from the wallet, then mint — both against the same already-shared
 * `wrapperId`, so no create/share is needed (simpler than the first-bet PTB). Gas-free via the
 * sponsor (deposit_funds + mint targets are in yosuku-trading-624). Cost is capped at maxCost
 * (≤ the post-deposit balance); the whole PTB reverts if it can't fit, so funds are never stranded.
 */
export function buildTopUpAndMint624(p: {
  wrapperId: string;
  coinIds: string[];
  depositMicro: bigint;
  marketId: string;
  lowerTick: number | bigint;
  higherTick: number | bigint;
  qtyMicro: bigint;
  leverage1e9: bigint;
  maxCostMicro: bigint;
  maxProb1e9: bigint;
}): Transaction {
  if (p.coinIds.length === 0) throw new Error('no DUSDC coins to top up with');
  const lower = BigInt(p.lowerTick);
  const higher = BigInt(p.higherTick);
  if (lower === NEG_INF_TICK && higher === POS_INF_TICK) {
    throw new Error('full open range (−inf, +inf) is prohibited on-chain (EInvalidRange)');
  }
  const tx = new Transaction();
  // 1. top up the existing account from the wallet
  const primary = tx.object(p.coinIds[0]);
  if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
  const [pay] = tx.splitCoins(primary, [tx.pure.u64(p.depositMicro)]);
  const authDep = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::deposit_funds`,
    typeArguments: [PREDICT624.dusdcType],
    arguments: [tx.object(p.wrapperId), authDep, pay, tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock)],
  });
  // 2. place the bet against the now-funded account
  const pricer = tx.moveCall({
    target: `${PREDICT624.predictPackage}::expiry_market::load_live_pricer`,
    arguments: [
      tx.object(p.marketId), tx.object(PREDICT624.protocolConfig), tx.object(PREDICT624.oracleRegistry),
      tx.object(PREDICT624.pythFeed), tx.object(PREDICT624.bsSpotFeed), tx.object(PREDICT624.bsForwardFeed),
      tx.object(PREDICT624.bsSviFeed), tx.object(PREDICT624.clock),
    ],
  });
  const authMint = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${PREDICT624.predictPackage}::expiry_market::mint_exact_quantity`,
    arguments: [
      tx.object(p.marketId), tx.object(p.wrapperId), authMint, tx.object(PREDICT624.protocolConfig), pricer,
      tx.pure.u64(lower), tx.pure.u64(higher), tx.pure.u64(p.qtyMicro), tx.pure.u64(p.leverage1e9),
      tx.pure.u64(p.maxCostMicro), tx.pure.u64(p.maxProb1e9), tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock),
    ],
  });
  appendRecordBet(tx, p.marketId);
  return tx;
}

/**
 * REAL entry probability for the no-quote paths (no account yet / underfunded account, where
 * the plain quote's mint dry-run can't withdraw). Dry-runs the COMBINED PTB — (create|top-up)
 * deposit funds the account mid-dry-run — with a fixed 2-DUSDC probe qty (clears the venue's
 * 1-DUSDC min-premium admission for any prob ≥ 0.5, which the $20 band guarantees) and UNCAPPED
 * cost guards, then reads OrderMinted. Nothing executes. The probability on these bands swings
 * 0.6→0.9 with market conditions, so sizing off any static estimate aborts EMintCostAboveMax —
 * this probe is what lets first-bet / top-up-bet size the payout correctly.
 * `gasOwner` (the sponsor) satisfies gas selection for SUI-less wallets — dry-runs need no signature.
 */
export async function probeCombinedMint624(p: {
  /** null = create-account path; a wrapper id = top-up path on the existing account. */
  wrapperId: string | null;
  coinIds: string[];
  /** How much the probe deposits (dry-run only — nothing moves). Use the full wallet balance. */
  probeDepositMicro: bigint;
  marketId: string;
  lowerTick: number | bigint;
  higherTick: number | bigint;
  leverage1e9: bigint;
  sender: string;
  gasOwner?: string | null;
}): Promise<{ entryProb: number; costOfProbeMicro: number } | { error: string }> {
  try {
    const tx = new Transaction();
    // account: fresh (command result) or the existing shared wrapper
    const wrapper = p.wrapperId
      ? tx.object(p.wrapperId)
      : tx.moveCall({ target: `${PREDICT624.accountPackage}::account_registry::new`, arguments: [tx.object(PREDICT624.accountRegistry)] });
    const primary = tx.object(p.coinIds[0]);
    if (p.coinIds.length > 1) tx.mergeCoins(primary, p.coinIds.slice(1).map((id) => tx.object(id)));
    const [pay] = tx.splitCoins(primary, [tx.pure.u64(p.probeDepositMicro)]);
    const authDep = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
    tx.moveCall({
      target: `${PREDICT624.accountPackage}::account::deposit_funds`,
      typeArguments: [PREDICT624.dusdcType],
      arguments: [wrapper, authDep, pay, tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock)],
    });
    const pricer = tx.moveCall({
      target: `${PREDICT624.predictPackage}::expiry_market::load_live_pricer`,
      arguments: [
        tx.object(p.marketId), tx.object(PREDICT624.protocolConfig), tx.object(PREDICT624.oracleRegistry),
        tx.object(PREDICT624.pythFeed), tx.object(PREDICT624.bsSpotFeed), tx.object(PREDICT624.bsForwardFeed),
        tx.object(PREDICT624.bsSviFeed), tx.object(PREDICT624.clock),
      ],
    });
    const authMint = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
    tx.moveCall({
      target: `${PREDICT624.predictPackage}::expiry_market::mint_exact_quantity`,
      arguments: [
        tx.object(p.marketId), wrapper, authMint, tx.object(PREDICT624.protocolConfig), pricer,
        tx.pure.u64(BigInt(p.lowerTick)), tx.pure.u64(BigInt(p.higherTick)),
        tx.pure.u64(2_000_000n), tx.pure.u64(p.leverage1e9),
        tx.pure.u64(18446744073709551615n), tx.pure.u64(990_000_000n),
        tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock),
      ],
    });
    if (!p.wrapperId) tx.moveCall({ target: `${PREDICT624.accountPackage}::account::share`, arguments: [wrapper] });
    tx.setSender(p.sender);
    if (p.gasOwner) tx.setGasOwner(p.gasOwner);
    const bytes = await tx.build({ client: grpc });
    const b64 = typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(String.fromCharCode(...bytes));
    const r = await fetch(RPC_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_dryRunTransactionBlock', params: [b64] }),
    }).then((x) => x.json());
    const ev = (r?.result?.events ?? []).find((e: { type?: string }) => String(e.type).includes('OrderMinted'))?.parsedJson as Record<string, string> | undefined;
    if (!ev) return { error: String(r?.result?.effects?.status?.error ?? 'no OrderMinted in probe').slice(0, 160) };
    const n = (k: string) => Number(ev[k] ?? 0);
    return {
      entryProb: n('entry_probability') / FLOAT_SCALING_624,
      costOfProbeMicro: n('net_premium') + n('trading_fee') - n('fee_incentive_subsidy') + n('builder_fee') + n('penalty_fee'),
    };
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e).slice(0, 160) };
  }
}

/** A REAL mint quote — dry-runs the exact mint PTB with UNCAPPED guards and reads OrderMinted.
 *  This is the number predict will actually charge (net premium + trader fee + builder fee +
 *  EWMA penalty), not an estimate; probability on short cadences moves too much to estimate
 *  (a $20 band is ~0.55 on 5m but 0.75–0.9 on 1m — estimates abort EMintCostAboveMax(4)). */
export interface MintQuote624 {
  costMicro: number;        // the all-in debit the mint will take
  winMicro: number;         // payout on a win = qty − financed floor
  entryProb: number;        // 0..1
  netPremiumMicro: number;
  feeMicro: number;         // trader-paid fee (after subsidy) + builder fee
  penaltyMicro: number;
}
export async function quoteMint624(p: {
  sender: string;
  marketId: string;
  wrapperId: string;
  lowerTick: number | bigint;
  higherTick: number | bigint;
  qtyMicro: bigint;
  leverage1e9: bigint;
  /** Gas owner for BUILD-time gas selection — pass the sponsor for SUI-less wallets
   *  (the bet itself is sponsored, so the quote must not require the user to hold SUI). */
  gasOwner?: string | null;
}): Promise<MintQuote624 | { error: string }> {
  try {
    const tx = buildMintTx({
      marketId: p.marketId, wrapperId: p.wrapperId, lowerTick: p.lowerTick, higherTick: p.higherTick,
      qtyMicro: p.qtyMicro, leverage1e9: p.leverage1e9,
      maxCostMicro: 18446744073709551615n, maxProb1e9: 990_000_000n, // uncapped guards: pure price discovery
    });
    tx.setSender(p.sender);
    if (p.gasOwner) tx.setGasOwner(p.gasOwner); // dry-runs need no signature — sponsor coins satisfy gas selection
    const bytes = await tx.build({ client: grpc }); // resolution simulates; throws on protocol rejects
    const b64 = typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : btoa(String.fromCharCode(...bytes));
    const r = await fetch(RPC_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_dryRunTransactionBlock', params: [b64] }),
    }).then((x) => x.json());
    const ev = (r?.result?.events ?? []).find((e: { type?: string }) => String(e.type).includes('OrderMinted'))?.parsedJson as Record<string, string> | undefined;
    if (!ev) {
      const err = r?.result?.effects?.status?.error ?? 'no OrderMinted in dry run';
      return { error: String(err).slice(0, 160) };
    }
    const n = (k: string) => Number(ev[k] ?? 0);
    const netPremium = n('net_premium');
    const fee = n('trading_fee') - n('fee_incentive_subsidy') + n('builder_fee');
    const penalty = n('penalty_fee');
    const entryProb = n('entry_probability') / FLOAT_SCALING_624;
    const qty = Number(p.qtyMicro);
    // financed floor = entry_value − net_premium; a win pays qty − floor.
    const entryValue = entryProb * qty;
    const winMicro = Math.max(0, Math.round(qty - (entryValue - netPremium)));
    return { costMicro: netPremium + fee + penalty, winMicro, entryProb, netPremiumMicro: netPremium, feeMicro: fee, penaltyMicro: penalty };
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e).slice(0, 160) };
  }
}

/**
 * Redeem a position on a SETTLED market — permissionless, no Auth, no Pricer;
 * the payout force-lands in the position owner's account regardless of who cranks.
 * Full close only (pass the position's full quantity).
 */
export function buildRedeemSettledTx(p: {
  marketId: string;
  wrapperId: string;
  /** Packed u256 order id (from OrderMinted). */
  orderId: bigint;
  /** Micro-DUSDC quantity of the position. */
  qty: bigint;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PREDICT624.predictPackage}::expiry_market::redeem_settled`,
    arguments: [
      tx.object(p.marketId),
      tx.object(PREDICT624.accountRegistry),
      tx.object(p.wrapperId),
      tx.object(PREDICT624.protocolConfig),
      tx.object(PREDICT624.oracleRegistry),
      tx.object(PREDICT624.pythFeed),
      tx.pure.u256(p.orderId),
      tx.pure.u64(p.qty),
      tx.object(PREDICT624.accumulatorRoot),
      tx.object(PREDICT624.clock),
    ],
  });
  return tx;
}

// ─── reads ───

const RPC_URL = process.env.NEXT_PUBLIC_SUI_RPC_URL || 'https://sui-testnet-rpc.publicnode.com'; // public fullnode JSON-RPC sunset

async function jsonRpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const r = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const j = await r.json();
    return (j.result ?? null) as T | null;
  } catch {
    return null;
  }
}

/**
 * The account's STORED DUSDC balance as a display number, read from the wrapper's
 * `account.balances` Bag via raw JSON-RPC dynamic-field walk (getObject wrapper →
 * balances Bag id → getDynamicFields → CoinKey<DUSDC> entry → its `value` field) —
 * the exact reader proven in predict624.mjs. Mint debits and redeem payouts are
 * synchronous stored-balance ops, so this is exact for the trade path (only async
 * LP fills lag until the next account-touching call sweeps the accumulator).
 * Returns 0 on any read failure (missing wrapper, empty bag, RPC hiccup).
 */
export async function fetchAccountBalanceMicro624(wrapperId: string): Promise<bigint> {
  const obj = await jsonRpc<{ data?: { content?: { fields?: Record<string, any> } } }>('sui_getObject', [
    wrapperId,
    { showContent: true },
  ]);
  const bagId = obj?.data?.content?.fields?.account?.fields?.balances?.fields?.id?.id;
  if (!bagId) return BigInt(0);
  const dfs = await jsonRpc<{ data?: Array<Record<string, any>> }>('suix_getDynamicFields', [bagId, null, 50]);
  const rows = dfs?.data ?? [];
  // STRICT: match only the DUSDC CoinKey. Never fall back to rows[0] — the bag can
  // also hold PLP/DEEP balances, and a wrong-coin figure passed to
  // withdraw_funds<DUSDC> would overshoot and abort with EBalanceTooLow.
  const hit = rows.find(
    (f) =>
      String(f.name?.type ?? '').includes('CoinKey') &&
      String(f.objectType ?? f.name?.type ?? '').toLowerCase().includes('dusdc'),
  );
  if (!hit) return BigInt(0);
  const v = await jsonRpc<{ data?: { content?: { fields?: { value?: string | number } } } }>('sui_getObject', [
    hit.objectId,
    { showContent: true },
  ]);
  try {
    return BigInt(v?.data?.content?.fields?.value ?? 0);
  } catch {
    return BigInt(0);
  }
}

/** Display number (DUSDC) derived from the exact integer reader above. */
export async function fetchAccountBalance624(wrapperId: string): Promise<number> {
  return Number(await fetchAccountBalanceMicro624(wrapperId)) / DUSDC_MULTIPLIER;
}

// ─── per-account order/position feeds (live beta indexer — routes VERIFIED 2026-07-03) ───
//
// The deployed predict-server-beta keys every per-user feed by the wrapper's INNER
// `account.account_id` field — NOT the AccountWrapper object id and NOT the owner
// address (both 404/empty). Verified against the proven spike account:
//   GET /accounts/{account_id}/orders?limit=N            → interleaved event feed
//       (kinds: order_minted / settled_order_redeemed / live_order_redeemed /
//        liquidated_order_redeemed), newest first
//   GET /accounts/{account_id}/positions?status=<s>      → order_state rows
//       (statuses: open | replaced | closed | liquidated | liquidated_redeemed |
//        settled_redeemed; DEFAULT open when the param is omitted)
//   GET /markets/{market_id}/state                        → { market, reference_tick,
//        mint_paused, settlement } — `settlement.settlement_price` is 1e9-scaled USD
// (The `/managers/…` routes in the predict-testnet-6-24 source are NOT deployed.)

/** Read the wrapper's INNER `account.account_id` — the id the indexer feeds key on. */
export async function fetchInnerAccountId624(wrapperId: string): Promise<string | null> {
  const obj = await jsonRpc<{ data?: { content?: { fields?: Record<string, any> } } }>('sui_getObject', [
    wrapperId,
    { showContent: true },
  ]);
  const id = obj?.data?.content?.fields?.account?.fields?.account_id?.id;
  return typeof id === 'string' && id.startsWith('0x') ? id : null;
}

/** One `order_state` row from /accounts/{account_id}/positions. */
export interface Position624 {
  marketId: string;
  /** Packed u256 order id as a decimal string (expiry-local — pair with marketId). */
  orderId: string;
  status: string;
  /** Raw $0.01-grid tick indices; sentinels: 0 = −inf, 2^30−1 = +inf. */
  lowerTick: number;
  higherTick: number;
  /** Max payout, micro DUSDC. */
  qtyMicro: bigint;
  leverage1e9: number;
  entryProb1e9: number;
  netPremiumMicro: bigint;
  openedAtMs: number;
}

function rowToPosition624(r: Record<string, any>): Position624 {
  return {
    marketId: String(r.expiry_market_id ?? ''),
    orderId: String(r.order_id ?? ''),
    status: String(r.status ?? ''),
    lowerTick: Number(r.lower_tick ?? 0),
    higherTick: Number(r.higher_tick ?? 0),
    qtyMicro: BigInt(r.quantity ?? 0),
    leverage1e9: Number(r.leverage ?? FLOAT_SCALING_624),
    entryProb1e9: Number(r.entry_probability ?? 0),
    netPremiumMicro: BigInt(r.net_premium ?? 0),
    openedAtMs: Number(r.opened_at_ms ?? 0),
  };
}

/** OPEN positions for one inner account id (indexer default status). */
export async function fetchOpenPositions624(accountId: string): Promise<Position624[]> {
  const res = await fetch(`${PREDICT624.indexer}/accounts/${accountId}/positions?status=open`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`predict624 indexer /accounts/…/positions ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, any>>;
  return (Array.isArray(rows) ? rows : []).map(rowToPosition624);
}

/** One event row from the /accounts/{account_id}/orders interleaved feed. */
export interface OrderRow624 {
  /** order_minted | settled_order_redeemed | live_order_redeemed | liquidated_order_redeemed */
  kind: string;
  marketId: string;
  orderId: string;
  tsMs: number;
  digest: string;
  /** order_minted rows */
  lowerTick?: number;
  higherTick?: number;
  qtyMicro?: bigint;
  leverage1e9?: number;
  netPremiumMicro?: bigint;
  /** *_redeemed rows */
  payoutMicro?: bigint;
  quantityClosedMicro?: bigint;
  settlementUsd?: number;
}

/** Newest-first order event feed for one inner account id. */
export async function fetchAccountOrders624(accountId: string, limit = 40): Promise<OrderRow624[]> {
  const res = await fetch(`${PREDICT624.indexer}/accounts/${accountId}/orders?limit=${limit}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`predict624 indexer /accounts/…/orders ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, any>>;
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    kind: String(r.kind ?? ''),
    marketId: String(r.expiry_market_id ?? ''),
    orderId: String(r.order_id ?? ''),
    tsMs: Number(r.checkpoint_timestamp_ms ?? 0),
    digest: String(r.digest ?? ''),
    lowerTick: r.lower_tick != null ? Number(r.lower_tick) : undefined,
    higherTick: r.higher_tick != null ? Number(r.higher_tick) : undefined,
    qtyMicro: r.quantity != null ? BigInt(r.quantity) : undefined,
    leverage1e9: r.leverage != null ? Number(r.leverage) : undefined,
    netPremiumMicro: r.net_premium != null ? BigInt(r.net_premium) : undefined,
    payoutMicro: r.payout_amount != null ? BigInt(r.payout_amount) : undefined,
    quantityClosedMicro: r.quantity_closed != null ? BigInt(r.quantity_closed) : undefined,
    settlementUsd: r.settlement_price != null ? Number(r.settlement_price) / FLOAT_SCALING_624 : undefined,
  }));
}

/** Settlement snapshot for one market, from /markets/{id}/state. */
export interface MarketState624 {
  settled: boolean;
  /** Oracle settlement price in USD (1e9-descaled), null until settled. */
  settlementUsd: number | null;
  expiry: number;
}

export async function fetchMarketState624(marketId: string): Promise<MarketState624> {
  const res = await fetch(`${PREDICT624.indexer}/markets/${marketId}/state`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`predict624 indexer /markets/…/state ${res.status}`);
  const j = (await res.json()) as Record<string, any>;
  const settlement = j?.settlement ?? null;
  return {
    settled: settlement != null,
    settlementUsd: settlement?.settlement_price != null ? Number(settlement.settlement_price) / FLOAT_SCALING_624 : null,
    expiry: Number(j?.market?.expiry ?? 0),
  };
}

const toHexAddress = (bytes: Uint8Array | number[]): string =>
  `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;

/**
 * Find `owner`'s canonical derived AccountWrapper id, or null if they haven't
 * created one.
 *
 * APPROACH CHOSEN: on-chain derivation via gRPC simulation of the registry's
 * read-only view fns — `derived_wrapper_exists(registry, owner)` (bool) then
 * `derived_wrapper_address(registry, owner)` (address BCS, 32 bytes) — the repo's
 * modern replacement for devInspect (see modernClients.simulateReturnU64s).
 * Chosen over the AccountCreated-event scan because derivation is DETERMINISTIC:
 * no indexer lag right after account creation and no event-window pagination
 * fragility as usage grows (an owner's event can fall outside any fixed `last` N).
 * The event scan (GraphQL → JSON-RPC suix_queryEvents, strategyClient's exact
 * fallback dance) is kept only as a safety net for when simulation is unavailable.
 */
export async function findWrapperId624(owner: string): Promise<string | null> {
  // 1) gRPC simulate the two registry view fns in one tx.
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${PREDICT624.accountPackage}::account_registry::derived_wrapper_exists`,
      arguments: [tx.object(PREDICT624.accountRegistry), tx.pure.address(owner)],
    });
    tx.moveCall({
      target: `${PREDICT624.accountPackage}::account_registry::derived_wrapper_address`,
      arguments: [tx.object(PREDICT624.accountRegistry), tx.pure.address(owner)],
    });
    tx.setSenderIfNotSet(owner);
    const res = await grpc.simulateTransaction({ transaction: tx, include: { commandResults: true } });
    const cmds = res.commandResults ?? [];
    const existsBytes = cmds[0]?.returnValues?.[0]?.bcs;
    if (existsBytes && existsBytes[0] === 0) return null; // definitively: no wrapper yet
    const addrBytes = cmds[1]?.returnValues?.[0]?.bcs;
    if (existsBytes?.[0] === 1 && addrBytes && addrBytes.length === 32) return toHexAddress(addrBytes);
  } catch {
    /* fall through to events */
  }

  // 2) AccountCreated events, owner-matched (newest first; GraphQL → JSON-RPC).
  const type = `${PREDICT624.accountPackage}::account_events::AccountCreated`;
  const nodes = await queryEvents624(type, 200);
  const want = owner.toLowerCase();
  for (const j of nodes) {
    if (String(j.owner ?? '').toLowerCase() === want && j.self_owned !== true) {
      const id = String(j.wrapper_id ?? '');
      if (id) return id;
    }
  }
  return null;
}

// GraphQL events with JSON-RPC fallback — same reliability dance as strategyClient
// (testnet GraphQL event indexing lags/windows; suix_queryEvents is the safety net).
const EVENTS_624_Q = `query Ev($t: String!, $last: Int!) {
  events(last: $last, filter: { type: $t }) {
    nodes { contents { json } }
  }
}`;

async function queryEvents624(type: string, last = 100): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, errors } = await gql.query<{ events: { nodes: Array<{ contents: { json: Record<string, unknown> } }> } }>({
      query: EVENTS_624_Q,
      variables: { t: type, last },
    });
    const nodes = data?.events?.nodes ?? [];
    if (!errors?.length && nodes.length) return nodes.map((n) => n.contents?.json ?? {}).reverse(); // newest first
  } catch {
    /* fall through */
  }
  const r = await jsonRpc<{ data?: Array<{ parsedJson?: Record<string, unknown> }> }>('suix_queryEvents', [
    { MoveEventType: type },
    null,
    last,
    true,
  ]);
  return (r?.data ?? []).map((e) => e.parsedJson ?? {});
}
