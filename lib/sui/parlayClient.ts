// PTB builders + pricing for the yolev PARLAY reserve.
//
// A parlay is ONE ticket bundling N binary BTC legs. It pays a combined payout
// ONLY IF every leg settles in-the-money; if any leg loses, the whole stake is
// lost. Combined win-prob p = Π(leg_prob_i), so the stake is small and the
// payout is large — the multiplied "lottery" framing.
//
// The reserve is the counterparty (mirrors yolev::underwrite): it pre-funds the
// full maxPayout into the ticket escrow at open, so it can never be short
// per-ticket. Legs are resolved permissionlessly the instant their bell settles
// by reading the public oracle getters (no mint / manager / keeper custody).
//
// NOTE: parlay.move ships in the SAME yolev package (0x75e00dc3) in one upgrade.
// Fill PARLAY_PACKAGE / PARLAY_RESERVE_ID once `yolev::parlay::create` has run.

import { Transaction } from '@mysten/sui/transactions';
import { fetchOnChainQuote } from './onchainQuote';
import {
  DUSDC_TYPE,
  CLOCK_ID,
  DUSDC_MULTIPLIER,
} from './constants';

// ── deployment constants (LIVE testnet, 2026-06-16) ──
// parlay.move shipped via the yolev v4 upgrade (digest 5DvFrxtFoy8…); it lives in a
// NEW package id (not the v2 0x75e00dc3 the rest of the app uses), so it is pinned
// here directly. Env vars override for redeploys.
export const PARLAY_PACKAGE =
  process.env.NEXT_PUBLIC_PARLAY_PACKAGE ||
  '0xd950420d3b3ac026c6f3b242010bec2dd2f7cdab6a7d68fb00087516094cbc02';
export const PARLAY_RESERVE_ID =
  process.env.NEXT_PUBLIC_PARLAY_RESERVE ||
  '0x939724d6fc82af88530368b06f952af0b7277d0da51bd419659a3bb1686c0851';

// Demo-cut params (match the smallest demoable cut in the spec).
export const PARLAY_MARGIN_BPS = 1200;       // 12% house edge
export const PARLAY_CORRELATION_BPS = 4000;  // λ = 0.40 same-oracle surcharge floor
export const PARLAY_MAX_LEGS = 3;
export const CONTRACT_UNIT = 1_000_000;      // 1.0 contract in µDUSDC

const BPS = 10_000;

// ── types ──
export interface ParlayLegSpec {
  oracleId: string;
  expiry: bigint;     // ms
  strike: bigint;     // 1e9-scaled (same scale as settlement_price)
  isUp: boolean;
  asset?: string;     // display only
}

export interface ParlayQuote {
  legProbs: number[];     // per-leg N(d2) win prob (0..1)
  combinedProb: number;   // post-surcharge joint win prob (0..1)
  rawCombined: number;    // pre-surcharge Π(prob) — for the "lottery" framing
  stake: bigint;          // µDUSDC the trader pays
  maxPayout: bigint;      // µDUSDC paid if every leg wins
  multiplier: number;     // maxPayout / stake — the big "×N" odds
  probBps: bigint[];      // per-leg ×1e4, passed into open_parlay
  correlated: boolean;    // any shared oracle → surcharge applied
}

export type ParlayMode =
  | { kind: 'fixPayout'; maxPayout: bigint }
  | { kind: 'fixStake'; stake: bigint };

// ── pricing ──
// Per-leg fair win-prob comes from the exact on-chain quote (identical to how
// TradePanel prices today): quote 1.0 contract (quantity = CONTRACT_UNIT); the
// returned mintCost in DUSDC IS the risk-neutral digital price ≈ N(d2).
//
// combined   = Π prob_i
// combined'  = max( Π prob_i , λ · min_i(prob_i) )  when ≥2 legs share an oracle
// fair_stake = max_payout × combined'
// stake      = ceil(fair_stake × (1 + margin))     (round UP — reserve never short)
async function legProb(leg: ParlayLegSpec): Promise<number> {
  const q = await fetchOnChainQuote({
    oracleId: leg.oracleId,
    expiry: leg.expiry,
    strike: leg.strike,
    isUp: leg.isUp,
    quantity: CONTRACT_UNIT,
  });
  // mintCost is per 1.0 contract in DUSDC → already the 0..1 digital price.
  return Math.min(0.9999, Math.max(0.0001, q.mintCost));
}

export async function quoteParlay(
  legs: ParlayLegSpec[],
  mode: ParlayMode,
  opts: { marginBps?: number; correlationBps?: number } = {},
): Promise<ParlayQuote> {
  const marginBps = opts.marginBps ?? PARLAY_MARGIN_BPS;
  const correlationBps = opts.correlationBps ?? PARLAY_CORRELATION_BPS;

  const legProbs = await Promise.all(legs.map(legProb));

  const rawCombined = legProbs.reduce((acc, p) => acc * p, 1);

  // Same-oracle correlation surcharge: bell-streak legs on one oracle are
  // positively correlated, so Π prob understates the true joint win-prob and the
  // reserve underprices. Charge against a conservative floor toward the most
  // likely single leg's price.
  const counts = new Map<string, number>();
  for (const l of legs) counts.set(l.oracleId, (counts.get(l.oracleId) ?? 0) + 1);
  const correlated = [...counts.values()].some((c) => c >= 2);
  const lambda = correlationBps / BPS;
  const minProb = Math.min(...legProbs);
  const combinedProb = correlated
    ? Math.max(rawCombined, lambda * minProb)
    : rawCombined;

  const marginMul = 1 + marginBps / BPS;

  let stake: bigint;
  let maxPayout: bigint;
  if (mode.kind === 'fixPayout') {
    maxPayout = mode.maxPayout;
    const fairStake = Number(maxPayout) * combinedProb;
    stake = BigInt(Math.ceil(fairStake * marginMul));
  } else {
    stake = mode.stake;
    // maxPayout = stake / (combined' × (1 + margin)) — round DOWN so the implied
    // stake floor on-chain (which rounds up) is still satisfied.
    const mp = Number(stake) / (combinedProb * marginMul);
    maxPayout = BigInt(Math.floor(mp));
  }

  const multiplier = stake > BigInt(0) ? Number(maxPayout) / Number(stake) : 0;
  const probBps = legProbs.map((p) => BigInt(Math.round(p * BPS)));

  return { legProbs, combinedProb, rawCombined, stake, maxPayout, multiplier, probBps, correlated };
}

// ── PTB builders ──
function mergedPrimary(tx: Transaction, coinIds: string[]) {
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  return primary;
}

/**
 * Open a parlay in ONE trader-signed PTB: split the stake from wallet DUSDC and
 * call yolev::parlay::open_parlay. Legs are passed as parallel pure vectors
 * (Move entry can't take vector<struct>); the module zips them into Legs and
 * escrows both sides (stake + house_locked) atomically.
 *
 * public fun open_parlay<T>(
 *   r, stake: Coin<T>, oracle_ids, expiries, strikes, is_ups, prob_bps,
 *   max_payout, clock, ctx)
 */
export function openParlayTx(p: {
  coinIds: string[];
  stake: bigint;
  legs: ParlayLegSpec[];
  probBps: bigint[];
  maxPayout: bigint;
}): Transaction {
  const tx = new Transaction();
  const [stakeCoin] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.stake]);
  tx.moveCall({
    target: `${PARLAY_PACKAGE}::parlay::open_parlay`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PARLAY_RESERVE_ID),
      stakeCoin,
      tx.pure.vector('id', p.legs.map((l) => l.oracleId)),
      tx.pure.vector('u64', p.legs.map((l) => l.expiry)),
      tx.pure.vector('u64', p.legs.map((l) => l.strike)),
      tx.pure.vector('bool', p.legs.map((l) => l.isUp)),
      tx.pure.vector('u64', p.probBps),
      tx.pure.u64(p.maxPayout),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

/**
 * Permissionless crank: resolve one leg the instant its bell's OracleSVI settles.
 * First losing leg kills the ticket and sweeps the full escrow to the reserve.
 * public fun resolve_leg<T>(r, p, leg_idx, o: &OracleSVI, clock, ctx)
 */
export function resolveLegTx(p: { parlay: string; legIdx: number; oracle: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PARLAY_PACKAGE}::parlay::resolve_leg`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PARLAY_RESERVE_ID),
      tx.object(p.parlay),
      tx.pure.u64(p.legIdx),
      tx.object(p.oracle),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

/**
 * Permissionless claim of an all-won ticket — escrow == maxPayout is force-paid
 * to the owner, never the caller (same invariant as underwrite::settle).
 * public fun claim<T>(r, p: Parlay<T>, ctx)
 */
export function claimParlayTx(p: { parlay: string }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PARLAY_PACKAGE}::parlay::claim`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(PARLAY_RESERVE_ID), tx.object(p.parlay)],
  });
  return tx;
}

// ── reader types / events ──
export const PARLAY_OPENED_EVENT = `${PARLAY_PACKAGE}::parlay::ParlayOpened`;

export type ParlayStatus = 'live' | 'won' | 'lost';
export type LegStatus = 'pending' | 'won' | 'lost';

export interface ParlayLegState extends ParlayLegSpec {
  status: LegStatus;
}

export interface MyParlay {
  id: string;
  owner: string;
  status: ParlayStatus;
  stake: number;       // DUSDC
  maxPayout: number;   // DUSDC
  combinedProbBps: number;
  legs: ParlayLegState[];
  wonCount: number;
  lastExpiry: number;  // ms
}

/** ST_LIVE | ST_WON | ST_LOST as encoded in the Move module. */
export function decodeParlayStatus(raw: string | number): ParlayStatus {
  const n = Number(raw);
  return n === 1 ? 'won' : n === 2 ? 'lost' : 'live';
}
export function decodeLegStatus(raw: string | number): LegStatus {
  const n = Number(raw);
  return n === 1 ? 'won' : n === 2 ? 'lost' : 'pending';
}

export { DUSDC_MULTIPLIER };
