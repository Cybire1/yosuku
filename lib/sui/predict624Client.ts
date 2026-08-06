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
// Everything here follows the strategyClient/modernClients idioms: reads and
// simulations use GraphQL/gRPC (gql/grpc); writes are wallet-signed `Transaction`
// builders (no keys, no node imports — browser-safe).
//
// Proven-on-chain reference flows: suioverflow/x-relay/spike-624.mjs (owner path),
// spike-624b.mjs (delegated vault path), predict624.mjs (the node twin of this file).

import { Transaction, coinWithBalance, type TransactionObjectArgument } from '@mysten/sui/transactions';
import { gql, grpc, readClient } from './modernClients';
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

// predict-testnet-7-29, addresses read from the upstream manifest on 2026-08-06. Migrated off
// 6-24 that day because its Block Scholes feeds froze and it could no longer price a bet.
// A branch is REDEPLOYED IN PLACE, so never copy these from an older note — re-read:
//   gh api "repos/MystenLabs/deepbookv3/contents/packages/predict/deployment/deployment.testnet.json?ref=predict-testnet-7-29"
const PREDICT_PKG = '0xfe742239a3b033f7d52ed5275f238c17d27498ca0ee5ea5672ea732eb3f4dbbb';

export const PREDICT624 = {
  /** `predict` package — expiry_market / plp / registry / protocol_config. */
  predictPackage: PREDICT_PKG,
  /** `account` package — custody (AccountWrapper + Auth). */
  accountPackage: '0xbdbb60b00f2d4f30daeff62f2c642b18433a8fcdfbebccc808df578df2a0c203',
  /** predict::protocol_config::ProtocolConfig (shared). */
  protocolConfig: '0x43703ceee4d5f5a9e8cbf728071c34dc65961dd6e878fafd9ac36d86a9a4ce5b',
  /** Yosuku's native BuilderCode. EMPTY on 7-29 by design: a BuilderCode is a
   *  `<predict pkg>::builder_code::BuilderCode`, so the 6-24 object (0x3d02c41f…, tx HR2FoJ1z)
   *  is the WRONG TYPE here and passing it would abort the whole account-setup PTB. Every
   *  call site already guards on this being falsy, so setup simply skips attaching one until a
   *  fresh BuilderCode is created against the 7-29 package. Revenue stays a config flip. */
  builderCode: '',
  /** account::account_registry::AccountRegistry (shared) — wrapper derivation root. */
  accountRegistry: '0x21a7ed28397363b5550853c1f08795731257de81028cd1bf87f20c0752c8ca2f',
  /** propbook::registry::OracleRegistry (shared). */
  oracleRegistry: '0xc1dffc5f7a5404cb002ba3bd7c50d6a2dbe8bb6afd40080cd663965deff9d577',
  /** BTC_USD oracle feed objects. THREE now, not four: 7-29 collapsed the separate spot and
   *  forward stores into one BlockScholesValueStore, which is why load_live_pricer lost an arg. */
  pythFeed: '0xccafaa6c5a41f0493585cf268f2b4dc14c91ed798362444144cac2c745db8dde',
  bsValuesFeed: '0x6d9de17954f4c1a2f01fdd97c0bb8a2e682c1fea0f8f048dcd127d543a6ac051',
  bsSviFeed: '0x83c2d6307fd3591228052fc0d24c4f00a698b0eb4fef5e6083a213ca0d54bd35',
  /** Framework AccumulatorRoot (fund settlement) — required on every account-touching call. */
  accumulatorRoot: '0x0000000000000000000000000000000000000000000000000000000000000acc',
  clock: CLOCK_ID,
  dusdcType: DUSDC_TYPE,
  /** NO 7-29 INDEXER EXISTS. predict-server-beta serves 6-24 rows ONLY (every row it returns
   *  carries package 0xdb3ef5a5…), and propbook returns null for the 7-29 pyth feed. Market
   *  discovery and oracle reads therefore come from chain. Kept here only so legacy 6-24
   *  read paths still resolve; do NOT point new code at them. */
  indexer: 'https://predict-server-beta.testnet.mystenlabs.com',
  propbook: 'https://propbook.api.testnet.mystenlabs.com',
  marketCreatedEventType: `${PREDICT_PKG}::config_events::MarketCreated`,
  orderMintedEventType: `${PREDICT_PKG}::order_events::OrderMinted`,
  liveOrderRedeemedEventType: `${PREDICT_PKG}::order_events::LiveOrderRedeemed`,
  settledOrderRedeemedEventType: `${PREDICT_PKG}::order_events::SettledOrderRedeemed`,
  liquidatedOrderRedeemedEventType: `${PREDICT_PKG}::order_events::LiquidatedOrderRedeemed`,
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
// ─── shared read cache ───
// /markets is a ~534KB uncompressed payload and THREE components poll it independently at three
// different intervals (page 15s, word board 12s, marquee 15s), so a single tab pulled it several
// times a minute for the same handful of expiry timestamps. Spot had the same shape (page + word
// board, 5s each, against a ~1.7s endpoint with no in-flight guard).
//
// One TTL cache with in-flight dedup fixes both: concurrent callers share one request, and a
// caller inside the TTL gets the last value for free. Cheap, no new dependency, no API change.
function cachedFetch<T>(slot: { v: T | null; at: number; p: Promise<T> | null }, ttlMs: number, run: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (slot.v !== null && now - slot.at < ttlMs) return Promise.resolve(slot.v);
  if (slot.p) return slot.p; // a request is already in flight — join it
  slot.p = run()
    .then((v) => { slot.v = v; slot.at = Date.now(); return v; })
    .finally(() => { slot.p = null; });
  return slot.p;
}
const marketsSlot: { v: Market624[] | null; at: number; p: Promise<Market624[]> | null } = { v: null, at: 0, p: null };
const spotSlot: { v: number | null; at: number; p: Promise<number> | null } = { v: null, at: 0, p: null };
/** Markets change on expiry boundaries, so a few seconds of staleness is invisible. */
const MARKETS_TTL_MS = 10_000;
/** Spot is displayed to the nearest dollar; sub-3s staleness is not perceivable. */
const SPOT_TTL_MS = 3_000;

export function fetchMarkets624(): Promise<Market624[]> {
  return cachedFetch(marketsSlot, MARKETS_TTL_MS, fetchMarkets624Uncached);
}

async function fetchMarkets624Uncached(): Promise<Market624[]> {
  // Via our own route, which discovers markets ON CHAIN. The beta indexer this used to hit
  // serves 6-24 rows ONLY, so after the 7-29 cutover the board listed markets from the dead
  // deployment while pricing them with live data. Betting one then failed at execution with
  // `CommandArgumentError { arg_idx: 0, kind: TypeMismatch }` — arg 0 of mint_exact_quantity is
  // the market, and a 6-24 ExpiryMarket is simply a different type to the 7-29 package.
  const res = await fetch('/api/oracles', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`markets /api/oracles ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, unknown>>;
  const rows = (Array.isArray(raw) ? raw : []).map((r) => ({
    expiry_market_id: r.oracle_id,
    expiry: r.expiry,
    tick_size: r.tick_size,
    admission_tick_size: r.admission_tick_size,
    max_admission_leverage: r.max_admission_leverage,
    checkpoint_timestamp_ms: r.created_ms,
  })) as unknown as IndexerMarketRow[];
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

interface PythObservationEvent {
  propbook_oracle_id?: string;
  observation?: {
    source_timestamp_ms?: string | number;
    update_timestamp_ms?: string | number;
    value?: PythLatest;
  };
}

interface MarketSettledEvent {
  expiry_market_id?: string;
  expiry?: string | number;
  settlement_price?: string | number;
  settled_at_ms?: string | number;
}

function parsePythPrice(j: PythLatest | null | undefined): number {
  const exp = Number(j?.exponent_magnitude);
  const magnitude = Number(j?.price_magnitude);
  const scale = j?.exponent_is_negative === false ? 10 ** exp : 10 ** -exp;
  return magnitude * scale * (j?.price_is_negative ? -1 : 1);
}

/**
 * Pyth observation history from the SETTLEMENT feed (propbook), OLDEST-FIRST for
 * charting: [{ usd, tsMs }]. Observations land roughly once per second, so
 * `limit` ≈ seconds of lookback. Same parse as the proven node twin
 * (suioverflow/x-relay/predict624.mjs pythHistory), reversed for drawing.
 */
export async function fetchPythHistory624(limit = 120): Promise<{ usd: number; tsMs: number }[]> {
  // propbook indexes the 6-24 deployment only. For the 7-29 feed it returns 200 OK with an EMPTY
  // array — not an error, so `res.ok` is true and every caller's catch is bypassed; spot, strike
  // and the odds simply render blank forever. Go to our own on-chain route first and only fall
  // back to propbook, rather than the other way round.
  try {
    const r = await fetch('/api/spot', { headers: { accept: 'application/json' } });
    if (r.ok) {
      const j = (await r.json()) as { usd: number | null; tsMs: number | null; history?: { usd: number; tsMs: number }[] };
      const hist = Array.isArray(j.history) ? j.history : [];
      // Callers expect NEWEST-LAST (they read .at(-1) for spot), which is how the buffer is kept.
      if (hist.length >= 2) return hist.slice(-limit);
      if (j.usd != null) return [{ usd: j.usd, tsMs: j.tsMs ?? Date.now() }];
    }
  } catch { /* fall through to propbook for the legacy 6-24 feed */ }

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
    .reverse(); // newest-first from the API -> oldest-first for charts
}

/** Latest BTC/USD spot from the settlement pyth feed → USD number. */
export function fetchSpot624(): Promise<number> {
  return cachedFetch(spotSlot, SPOT_TTL_MS, fetchSpot624Uncached);
}

async function fetchSpot624Uncached(): Promise<number> {
  const latest = await fetchPythHistory624(1);
  const price = latest.at(-1)?.usd ?? NaN;
  if (!Number.isFinite(price) || price <= 0) throw new Error('pyth spot unavailable');
  return price;
}

export interface SettlementPrint624 {
  marketId: string;
  cadence: Cadence624;
  expiry: number;
  priceUsd: number;
  settledAtMs: number;
}

export async function fetchRecentSettlements624(limit = 6): Promise<SettlementPrint624[]> {
  const res = await fetch(`${PREDICT624.indexer}/markets?limit=${Math.max(120, limit * 8)}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`predict624 indexer /markets ${res.status}`);
  const rows = (await res.json()) as IndexerMarketRow[];
  const now = Date.now();
  const past = rows
    .map((m) => ({
      id: String(m.expiry_market_id ?? ''),
      expiry: Number(m.expiry),
    }))
    .filter((m) => m.id && Number.isFinite(m.expiry) && m.expiry <= now)
    .sort((a, b) => b.expiry - a.expiry)
    .slice(0, limit + 2);
  const prints = await Promise.all(
    past.map(async (m) => {
      try {
        const res = await fetch(`${PREDICT624.indexer}/markets/${m.id}/state`, {
          headers: { accept: 'application/json' },
        });
        if (!res.ok) return null;
        const j = (await res.json()) as {
          settlement?: { settlement_price?: string | number; settled_at_ms?: string | number } | null;
        };
        const settlement = j?.settlement;
        if (settlement?.settlement_price == null) return null;
        return {
          marketId: m.id,
          cadence: inferCadence624(m.expiry),
          expiry: m.expiry,
          priceUsd: Number(settlement.settlement_price) / FLOAT_SCALING_624,
          settledAtMs: Number(settlement.settled_at_ms ?? m.expiry),
        };
      } catch {
        return null;
      }
    }),
  );
  return prints.filter((p): p is SettlementPrint624 => p != null).slice(0, limit);
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
  if (!PREDICT624.builderCode) return;
  const w = typeof wrapper === 'string' ? tx.object(wrapper) : wrapper;
  const auth = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${PREDICT624.predictPackage}::predict_account::set_builder_code`,
    arguments: [w, auth, tx.object(PREDICT624.builderCode)],
  });
}

function appendLoadLivePricer(tx: Transaction, market: TransactionObjectArgument | string): TransactionObjectArgument {
  const m = typeof market === 'string' ? tx.object(market) : market;
  return tx.moveCall({
    target: `${PREDICT624.predictPackage}::expiry_market::load_live_pricer`,
    arguments: [
      m,
      tx.object(PREDICT624.protocolConfig),
      tx.object(PREDICT624.oracleRegistry),
      tx.object(PREDICT624.pythFeed),
      // 7 objects, was 8: bsSpot + bsForward collapsed into one BlockScholesValueStore.
      tx.object(PREDICT624.bsValuesFeed),
      tx.object(PREDICT624.bsSviFeed),
      tx.object(PREDICT624.clock),
    ],
  });
}

async function simulateOrderMinted624(tx: Transaction): Promise<{ event?: Record<string, any>; error?: string }> {
  const res = await grpc.simulateTransaction({ transaction: tx, include: { events: true, effects: true } });
  const simulated = (res as any).Transaction ?? (res as any).FailedTransaction;
  const event = (simulated?.events ?? []).find((e: { eventType?: string }) =>
    String(e.eventType ?? '').includes('OrderMinted'),
  )?.json as Record<string, any> | undefined;
  if (event) return { event };
  // NOT sliced to 160. A 6-24 MoveAbort renders its module name at index 187 and its function
  // name past 248, so a 160-char cut lands inside the module ADDRESS and throws away the only
  // part that says what failed. That is exactly how the mobile client's abort dictionary became
  // unreachable in production while passing its own unit checks.
  return { error: String(simulated?.status?.error ?? 'no OrderMinted in simulation').slice(0, 1024) };
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
  /** Fold in the Rooms bet_registry record. TRUE for the real mint, FALSE for quotes/probes:
   *  the record has no effect in a dry run, and including it put a FOREIGN package on the
   *  critical path of 100% of displayed odds (its outage blanked the whole board). */
  withRoomsGate?: boolean;
}): Transaction {
  const lower = BigInt(p.lowerTick);
  const higher = BigInt(p.higherTick);
  if (lower === NEG_INF_TICK && higher === POS_INF_TICK) {
    throw new Error('full open range (−inf, +inf) is prohibited on-chain (EInvalidRange)');
  }
  const tx = new Transaction();
  const pricer = appendLoadLivePricer(tx, p.marketId);
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
  if (p.withRoomsGate !== false) appendRecordBet(tx, p.marketId);
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
  const pricer = appendLoadLivePricer(tx, p.marketId);
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
  const pricer = appendLoadLivePricer(tx, p.marketId);
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
    const pricer = appendLoadLivePricer(tx, p.marketId);
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
    tx.setGasBudget(120_000_000); // skip build's gas-estimation simulation (nothing executes here)
    const { event: ev, error } = await simulateOrderMinted624(tx);
    if (!ev) return { error: error ?? 'no OrderMinted in probe' };
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
      withRoomsGate: false, // a quote must not depend on the Rooms package being up
    });
    tx.setSender(p.sender);
    if (p.gasOwner) tx.setGasOwner(p.gasOwner); // dry-runs need no signature — sponsor coins satisfy gas selection
    // Without an explicit budget, tx.build() runs a FULL simulation just to estimate gas — a whole
    // extra network round on every quote. The number is irrelevant here (nothing executes).
    tx.setGasBudget(120_000_000);
    const { event: ev, error } = await simulateOrderMinted624(tx);
    if (!ev) {
      return { error: error ?? 'no OrderMinted in simulation' };
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
 * DISPLAY ODDS: cost per $1 of payout, quoted with the mint the venue will actually take.
 *
 * Two reasons this exists instead of calling quoteMint624.
 *
 * 1. mint_exact_quantity is refused. Measured on 2026-08-05 against every live market, at the
 *    band the board asks for (spot−20 UP), 1x: mint_exact_quantity aborts
 *    strike_exposure_config::assert_mint_probability_and_leverage_policy #6 on ALL of them,
 *    while mint_exact_AMOUNT mints on the same market, same strike, same leverage, same funding.
 *    Ruled out one variable at a time first: maxProb (0.99 → 1.0), qty (1.0 → 20.0), strike grid
 *    ($1/$5/$10/$50/$100 snapping) and account funding all leave #6 unchanged. Only the FUNCTION
 *    changes the outcome. Every odds quote therefore returned {error}, quoteSide mapped it to
 *    null, and the board sat on "LOADING ODDS…" — a permanent failure worded as a wait.
 *
 * 2. The quote funds itself. devInspect runs against live chain state, so a dry run against an
 *    empty betting account is asking about a bet nobody can place, and the house account is
 *    empty (its 4 DUSDC sit in the WALLET; the mint debits the ACCOUNT). Carrying the deposit
 *    inside the inspected transaction means the quote describes a placeable bet and cannot drift
 *    out of funds later. Nothing is signed or executed; the deposit exists only in simulation.
 *
 * Cents come from the event itself: all-in cost ÷ contracts, which is exactly "what $1 of payout
 * costs" and stays correct however the venue sizes the fill.
 */
export async function quoteOddsCents624(p: {
  sender: string;
  wrapperId: string;
  marketId: string;
  lowerTick: number | bigint;
  higherTick: number | bigint;
  /** Premium budget to price with. Must clear the venue's 1 DUSDC net-premium floor. */
  amountMicro?: bigint;
  /** Simulated top-up. Needs only to cover the budget plus fees. */
  depositMicro?: bigint;
}): Promise<{ cents: number; entryProb: number } | { error: string }> {
  const amountMicro = p.amountMicro ?? 1_050_000n;
  const depositMicro = p.depositMicro ?? 2_000_000n;
  const lower = BigInt(p.lowerTick);
  const higher = BigInt(p.higherTick);
  if (lower === NEG_INF_TICK && higher === POS_INF_TICK) return { error: 'full open range prohibited' };
  try {
    const tx = new Transaction();
    const pay = coinWithBalance({ type: PREDICT624.dusdcType, balance: depositMicro });
    const authDep = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
    tx.moveCall({
      target: `${PREDICT624.accountPackage}::account::deposit_funds`,
      typeArguments: [PREDICT624.dusdcType],
      arguments: [tx.object(p.wrapperId), authDep, pay, tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock)],
    });
    const pricer = appendLoadLivePricer(tx, p.marketId);
    const authMint = tx.moveCall({ target: `${PREDICT624.accountPackage}::account::generate_auth`, arguments: [] });
    tx.moveCall({
      target: `${PREDICT624.predictPackage}::expiry_market::mint_exact_amount`,
      arguments: [
        tx.object(p.marketId), tx.object(p.wrapperId), authMint, tx.object(PREDICT624.protocolConfig), pricer,
        tx.pure.u64(lower), tx.pure.u64(higher), tx.pure.u64(amountMicro),
        tx.pure.u64(0n), // no slippage floor: this is price discovery, not an order
        tx.pure.u64(1_000_000_000n),
        tx.object(PREDICT624.accumulatorRoot), tx.object(PREDICT624.clock),
      ],
    });
    tx.setSender(p.sender);
    tx.setGasBudget(120_000_000);
    const { event: ev, error } = await simulateOrderMinted624(tx);
    if (!ev) return { error: error ?? 'no OrderMinted in simulation' };
    const n = (k: string) => Number(ev[k] ?? 0);
    const netPremium = n('net_premium');
    const fee = n('trading_fee') - n('fee_incentive_subsidy') + n('builder_fee');
    const penalty = n('penalty_fee');
    const entryProb = n('entry_probability') / FLOAT_SCALING_624;
    const qty = n('quantity') || (entryProb > 0 ? Math.round(netPremium / entryProb) : 0);
    if (!qty) return { error: 'no quantity in OrderMinted' };
    const cents = Math.round(((netPremium + fee + penalty) / qty) * 100);
    return { cents: Math.max(1, Math.min(99, cents)), entryProb };
  } catch (e) {
    return { error: String(e instanceof Error ? e.message : e) };
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
    // 7-29 split this: plain `redeem_settled` now REQUIRES an explicit Auth, and the app-authed
    // form the app relies on (claim-all, and the keeper that redeems on a user's behalf) moved to
    // `redeem_settled_permissionless`. It also dropped the oracleRegistry + pyth pair, since a
    // settled arm pays a fixed terminal payout and reads no live price.
    target: `${PREDICT624.predictPackage}::expiry_market::redeem_settled_permissionless`,
    arguments: [
      tx.object(p.marketId),
      tx.object(PREDICT624.accountRegistry),
      tx.object(p.wrapperId),
      tx.object(PREDICT624.protocolConfig),
      tx.pure.u256(p.orderId),
      tx.pure.u64(p.qty),
      tx.object(PREDICT624.accumulatorRoot),
      tx.object(PREDICT624.clock),
    ],
  });
  return tx;
}

// ─── reads ───

const asFields = (value: any): Record<string, any> =>
  (value?.fields && typeof value.fields === 'object' ? value.fields : value ?? {}) as Record<string, any>;

const objectFields = async (objectId: string): Promise<Record<string, any> | null> => {
  try {
    const obj = await readClient.getObject({ id: objectId, options: { showContent: true } });
    return obj?.data?.content?.fields ?? null;
  } catch {
    return null;
  }
};

/**
 * The account's STORED DUSDC balance as a display number, read from the wrapper's
 * `account.balances` Bag via the modern read client (getObject wrapper ->
 * balances Bag id -> getDynamicFields -> CoinKey<DUSDC> entry -> its `value` field) -
 * the exact reader proven in predict624.mjs. Mint debits and redeem payouts are
 * synchronous stored-balance ops, so this is exact for the trade path (only async
 * LP fills lag until the next account-touching call sweeps the accumulator).
 * Returns NULL when a read FAILS (RPC hiccup / rate limit) and 0 only when the account
 * genuinely holds no DUSDC row. Callers must keep their last-good value on null: returning
 * 0 on a failed read showed funded users $0.00 and then refused their bet with
 * "balance below the live cost" (a single 429 was enough).
 */
export async function fetchAccountBalanceMicro624(wrapperId: string): Promise<bigint | null> {
  const fields = await objectFields(wrapperId);
  if (fields == null) return null; // read failed — do NOT report zero
  const account = asFields(fields.account);
  const balances = asFields(account.balances);
  const bagId = asFields(balances.id).id ?? balances.id?.id ?? balances.id;
  if (!bagId) return BigInt(0); // account exists, no balances bag yet → genuinely zero
  let rows: Array<Record<string, any>>;
  try {
    rows = (await readClient.getDynamicFields({ parentId: String(bagId) })).data ?? [];
  } catch {
    return null;
  }
  // STRICT: match only the DUSDC CoinKey. Never fall back to rows[0] — the bag can
  // also hold PLP/DEEP balances, and a wrong-coin figure passed to
  // withdraw_funds<DUSDC> would overshoot and abort with EBalanceTooLow.
  const hit = rows.find(
    (f) =>
      String(f.name?.type ?? '').includes('CoinKey') &&
      String(f.objectType ?? f.type ?? f.valueType ?? f.name?.type ?? '').toLowerCase().includes('dusdc'),
  );
  if (!hit) return BigInt(0); // no DUSDC row in the bag → genuinely zero
  const v = await objectFields(String(hit.objectId));
  if (v == null) return null; // read failed
  try {
    return BigInt(v?.value ?? 0);
  } catch {
    return null;
  }
}

/** Display number (DUSDC) derived from the exact integer reader above. Null = read failed. */
export async function fetchAccountBalance624(wrapperId: string): Promise<number | null> {
  const micro = await fetchAccountBalanceMicro624(wrapperId);
  return micro == null ? null : Number(micro) / DUSDC_MULTIPLIER;
}

// ─── per-account order/position feeds ───
//
// 6-24 account events are keyed by the wrapper's INNER `account.account_id` field,
// not the AccountWrapper object id and not the owner address. We derive the user's
// open/history view from on-chain order events plus settlement state.

/** Read the wrapper's INNER `account.account_id` — the id the indexer feeds key on. */
export async function fetchInnerAccountId624(wrapperId: string): Promise<string | null> {
  return (await fetchAccountSnapshot624(wrapperId)).accountId;
}

/** ONE object read on the wrapper, returning BOTH the inner account id and the balances-bag id.
 *  Account discovery used to fetch this identical object twice (~811ms of pure duplicate), once
 *  for the account id and again as the first hop of the balance read. Null = read failed. */
export async function fetchAccountSnapshot624(
  wrapperId: string,
): Promise<{ accountId: string | null; bagId: string | null; ok: boolean }> {
  const fields = await objectFields(wrapperId);
  if (fields == null) return { accountId: null, bagId: null, ok: false };
  const acct = asFields(fields.account);
  const id = asFields(acct.account_id).id ?? acct.account_id?.id ?? acct.account_id;
  const balances = asFields(acct.balances);
  const bag = asFields(balances.id).id ?? balances.id?.id ?? balances.id;
  return {
    accountId: typeof id === 'string' && id.startsWith('0x') ? id : null,
    bagId: typeof bag === 'string' && bag.startsWith('0x') ? bag : null,
    ok: true,
  };
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

const ACCOUNT_EVENT_SCAN_LIMIT = 500;

async function queryRpcEvents624<T>(type: string, limit = ACCOUNT_EVENT_SCAN_LIMIT): Promise<Array<{
  parsedJson?: T;
  timestampMs?: string | number;
  id?: { txDigest?: string; eventSeq?: string };
}>> {
  return (await queryEvents624<T & Record<string, unknown>>(type, limit)).map((parsedJson) => ({
    parsedJson: parsedJson as T,
  }));
}

function mintedEventToPosition624(j: Record<string, any>): Position624 {
  return {
    marketId: String(j.expiry_market_id ?? ''),
    orderId: String(j.order_id ?? ''),
    status: 'open',
    lowerTick: Number(j.lower_tick ?? 0),
    higherTick: Number(j.higher_tick ?? 0),
    qtyMicro: BigInt(j.quantity ?? 0),
    leverage1e9: Number(j.leverage ?? FLOAT_SCALING_624),
    entryProb1e9: Number(j.entry_probability ?? 0),
    netPremiumMicro: BigInt(j.net_premium ?? 0),
    openedAtMs: Number(j.minted_at_ms ?? 0),
  };
}

async function fetchAccountOrderEvents624(accountId: string, limit = ACCOUNT_EVENT_SCAN_LIMIT): Promise<OrderRow624[]> {
  const want = accountId.toLowerCase();
  const [minted, liveRedeemed, settledRedeemed, liquidatedRedeemed] = await Promise.all([
    queryRpcEvents624<Record<string, any>>(PREDICT624.orderMintedEventType, limit),
    queryRpcEvents624<Record<string, any>>(PREDICT624.liveOrderRedeemedEventType, limit),
    queryRpcEvents624<Record<string, any>>(PREDICT624.settledOrderRedeemedEventType, limit),
    queryRpcEvents624<Record<string, any>>(PREDICT624.liquidatedOrderRedeemedEventType, limit),
  ]);

  const mintedRows: OrderRow624[] = minted
    .filter((e) => String(e.parsedJson?.account_id ?? '').toLowerCase() === want)
    .map((e) => {
      const r = e.parsedJson ?? {};
      return {
        kind: 'order_minted',
        marketId: String(r.expiry_market_id ?? ''),
        orderId: String(r.order_id ?? ''),
        tsMs: Number(r.minted_at_ms ?? e.timestampMs ?? 0),
        digest: String(e.id?.txDigest ?? ''),
        lowerTick: r.lower_tick != null ? Number(r.lower_tick) : undefined,
        higherTick: r.higher_tick != null ? Number(r.higher_tick) : undefined,
        qtyMicro: r.quantity != null ? BigInt(r.quantity) : undefined,
        leverage1e9: r.leverage != null ? Number(r.leverage) : undefined,
        entryProb1e9: r.entry_probability != null ? Number(r.entry_probability) : undefined,
        netPremiumMicro: r.net_premium != null ? BigInt(r.net_premium) : undefined,
      };
    });

  const redeemedRows: OrderRow624[] = [
    ...liveRedeemed.map((e) => ({ e, kind: 'live_order_redeemed' })),
    ...settledRedeemed.map((e) => ({ e, kind: 'settled_order_redeemed' })),
    ...liquidatedRedeemed.map((e) => ({ e, kind: 'liquidated_order_redeemed' })),
  ]
    .filter(({ e }) => String(e.parsedJson?.account_id ?? '').toLowerCase() === want)
    .map(({ e, kind }) => {
      const r = e.parsedJson ?? {};
      return {
        kind,
        marketId: String(r.expiry_market_id ?? ''),
        orderId: String(r.order_id ?? ''),
        tsMs: Number(r.redeemed_at_ms ?? e.timestampMs ?? 0),
        digest: String(e.id?.txDigest ?? ''),
        payoutMicro: r.payout_amount != null ? BigInt(r.payout_amount) : undefined,
        quantityClosedMicro: r.quantity_closed != null ? BigInt(r.quantity_closed) : undefined,
        settlementUsd: r.settlement_price != null ? Number(r.settlement_price) / FLOAT_SCALING_624 : undefined,
      };
    });

  return [...mintedRows, ...redeemedRows]
    .filter((r) => r.marketId && r.orderId)
    .sort((a, b) => b.tsMs - a.tsMs);
}

/** OPEN positions for one inner account id (indexer default status). */
export async function fetchOpenPositions624(accountId: string): Promise<Position624[]> {
  const orders = await fetchAccountOrderEvents624(accountId, ACCOUNT_EVENT_SCAN_LIMIT);
  const closed = new Set(
    orders
      .filter((r) => r.kind !== 'order_minted')
      .map((r) => `${r.marketId}:${r.orderId}`),
  );
  return orders
    .filter((r) => r.kind === 'order_minted' && !closed.has(`${r.marketId}:${r.orderId}`))
    .map((r) => mintedEventToPosition624({
      expiry_market_id: r.marketId,
      order_id: r.orderId,
      lower_tick: r.lowerTick,
      higher_tick: r.higherTick,
      quantity: r.qtyMicro ?? 0n,
      leverage: r.leverage1e9 ?? FLOAT_SCALING_624,
      entry_probability: r.entryProb1e9 ?? 0,
      net_premium: r.netPremiumMicro ?? 0n,
      minted_at_ms: r.tsMs,
    }));
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
  entryProb1e9?: number;
  netPremiumMicro?: bigint;
  /** *_redeemed rows */
  payoutMicro?: bigint;
  quantityClosedMicro?: bigint;
  settlementUsd?: number;
}

/** Newest-first order event feed for one inner account id. */
export async function fetchAccountOrders624(accountId: string, limit = 40): Promise<OrderRow624[]> {
  return (await fetchAccountOrderEvents624(accountId, ACCOUNT_EVENT_SCAN_LIMIT)).slice(0, limit);
}

/** Settlement snapshot for one market, from /markets/{id}/state. */
export interface MarketState624 {
  settled: boolean;
  /** Oracle settlement price in USD (1e9-descaled), null until settled. */
  settlementUsd: number | null;
  expiry: number;
}

export async function fetchMarketState624(marketId: string): Promise<MarketState624> {
  const fields = (await objectFields(marketId)) ?? {};
  const exposure = asFields(fields.strike_exposure);
  const settlement = exposure.settlement_price;
  return {
    settled: settlement != null,
    settlementUsd: settlement != null ? Number(settlement) / FLOAT_SCALING_624 : null,
    expiry: Number(fields.expiry ?? exposure.expiry_ms ?? 0),
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
 * The event scan is kept only as a safety net for when simulation is unavailable.
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

  // 2) AccountCreated events, owner-matched (newest first).
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

const EVENTS_624_Q = `query Ev($t: String!, $last: Int!) {
  events(last: $last, filter: { type: $t }) {
    nodes { contents { json } }
  }
}`;

async function queryEvents624<T = Record<string, unknown>>(
  type: string,
  last = 50,
): Promise<T[]> {
  const clamped = Math.max(1, Math.min(last, 50));
  const { data, errors } = await gql.query<{ events: { nodes: Array<{ contents: { json: T } }> } }>({
    query: EVENTS_624_Q,
    variables: { t: type, last: clamped },
  });
  if (errors?.length) throw new Error(errors[0].message);
  return (data?.events?.nodes ?? [])
    .map((n) => n.contents?.json)
    .filter(Boolean)
    .reverse(); // newest first
}
