'use client';

// Shared 6-24 ticket machinery — ONE implementation behind BOTH /markets-live and
// the /markets Ticket624Drawer. Founder-validated on-chain (bet placed + won +
// claimed through it): REAL dry-run quoting via quoteMint624, ONE legible cost
// guard (fresh-quote-at-click ×1.10 with maxProb left at the protocol max), and
// the friendly abort-code → plain-words mapping.
//
// Nothing here forks the quoting logic: quotes come from predict624Client's
// quoteMint624 (a dry run of the exact mint), and every consumer sizes bets the
// same way — payout amount owned by the user, never pre-decided.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentAccount, useSignTransaction } from '@mysten/dapp-kit';
import type { Transaction } from '@mysten/sui/transactions';
import { grpc, buildSignExecute } from './modernClients';
import { useSmartSubmit } from './useSmartSubmit';
import { getSponsorStatus } from '../sponsor';
import { DUSDC_MULTIPLIER } from './constants';
import { useDUSDCBalance } from './hooks';
import {
  positionQuantityMicro624,
  quantizePositionQuantity624,
} from './predict624Math';
import {
  NEG_INF_TICK,
  POS_INF_TICK,
  usdToTick,
  findWrapperId624,
  fetchInnerAccountId624,
  fetchAccountBalance624,
  buildCreateAccountTx,
  buildDepositTx,
  buildMintTx,
  buildCreateFundAndMint624,
  buildTopUpAndMint624,
  probeCombinedMint624,
  quoteMint624,
  type MintQuote624,
} from './predict624Client';

// ─── proven venue constants ───

/** Near-the-money band: wider strikes abort EEntryProbabilityOutOfBounds (proven). */
export const BAND_USD = 20;
/** Conservative pre-quote probability; the $20 cushion targets at least 50%. */
export const EST_PROB = 0.5;
/** Upper bound used for balance checks before a live quote lands. */
export const EST_PROB_HIGH = 0.62;
/** Realistic entry-probability estimate when there is NO live quote (no account yet, or the
 *  account is underfunded so the quote dry-run aborts). A near-money directional band is
 *  HIGH-probability — and more so the shorter the cadence — so the flat 0.5 over-sizes the
 *  payout and the real cost then blows past maxCost (EMintCostAboveMax). Sizing qty off these
 *  keeps the no-quote paths (first-bet, top-up) close enough that they clear with the buffer. */
const EST_PROB_BY_CADENCE: Record<string, number> = { '1m': 0.8, '5m': 0.72, '1h': 0.62 };
export const estProb = (cadence?: string) => EST_PROB_BY_CADENCE[cadence ?? '5m'] ?? 0.68;
/** The sponsor's address, fetched once and cached — quotes/probes set it as gas owner so
 *  build-time gas selection works for SUI-less wallets (the whole flow is sponsored). */
let _sponsorAddrP: Promise<string | null> | null = null;
export const sponsorAddr = () =>
  (_sponsorAddrP ??= getSponsorStatus().then((s) => s?.address ?? null).catch(() => null));

/** Leave enough time for wallet approval and submission before the market expires. */
export const MIN_MINT_MS = 15_000;
/** Cadence-aware entry cutoff. A 1-minute market's dying seconds are where the entry
 *  probability races to 0/1 — quotes go stale mid-signature (EMintCostAboveMax) and the
 *  fill is terrible anyway. Stop entries 45s out; the ticket auto-rolls to the next round. */
export const minMintMs = (cadence?: string) => (cadence === '1m' ? 45_000 : MIN_MINT_MS);
/** The venue hard-rejects net premium < 1 DUSDC, and pricing wobbles a few percent with
 *  size/time — a stake of exactly 1.00 lands premium 0.99–1.09 and aborts about half the
 *  time (verified on-chain: 0.9978 → assert_mint_admission). 1.10 clears it reliably. */
export const MIN_STAKE = 1.1;

export type Dir624 = 'up' | 'down';

// ─── stake-first bet math ───
// Consumers enter a STAKE (what they pay). The venue's on-chain parameter is a payout
// QUANTITY whose entry cost ≈ prob·qty/lev, so the quantity that costs `stake` is
// qty = stake·lev/prob. A win pays that quantity minus the financed leverage floor.

/** Payout quantity whose entry cost equals `stake`, at this leverage + win probability. */
export function qtyForStake(stake: number, lev: number, prob: number): number {
  if (stake <= 0 || prob <= 0) return 0;
  return quantizePositionQuantity624((stake * lev) / prob);
}

/** The venue hard-rejects mints whose net premium (= prob·qty/lev) is under 1 DUSDC
 *  (assert_mint_admission). A 1.00 stake sizes premium to EXACTLY 1.00, and lot rounding
 *  can shave it a hair under → abort. Floor the on-chain qty so the premium always clears
 *  the minimum with a small safety margin — a 1.00 bet costs ~1.02 instead of failing. */
export function minQtyMicroForPremium(lev: number, prob: number): bigint {
  if (prob <= 0) return 0n;
  const LOT = 10_000n;
  const micro = BigInt(Math.ceil(((1.02 * lev) / prob) * 1_000_000));
  return ((micro + LOT - 1n) / LOT) * LOT;
}
const bigMax = (a: bigint, b: bigint) => (a > b ? a : b);
/** What a winning payout `qty` returns: quantity minus the financed floor (= qty at 1×). */
export function winForQty(qty: number, lev: number, prob: number): number {
  return Math.max(0, qty * (1 - prob * (1 - 1 / lev)));
}

/** The line the ticket actually uses: spot − $20 for UP, spot + $20 for DOWN. */
export function strike624(spot: number, dir: Dir624): number {
  return dir === 'up' ? spot - BAND_USD : spot + BAND_USD;
}

/** Band ticks for a direction: UP = [spot−20, +inf), DOWN = (−inf, spot+20]. */
export function ticks624(spot: number, dir: Dir624): { lowerTick: bigint; higherTick: bigint } {
  const strike = strike624(spot, dir);
  return dir === 'up'
    ? { lowerTick: usdToTick(strike), higherTick: POS_INF_TICK }
    : { lowerTick: NEG_INF_TICK, higherTick: usdToTick(strike) };
}

// ─── range (band) bets ───
// The venue's mint takes an arbitrary [lowerTick, higherTick]; the directional
// bets above just pin one end to ±inf. A RANGE bet gives BOTH ends a finite
// price — it wins only if settlement lands INSIDE the band, so a tighter band is
// less likely and pays more. The band must sit near spot (far strikes abort
// EEntryProbabilityOutOfBounds), which the UI clamps.

/** Suggested band half-widths (± USD from center). Tighter → higher payout. */
export const RANGE_PRESETS = [
  { key: 'tight', label: 'Tight', half: 15 },
  { key: 'medium', label: 'Medium', half: 30 },
  { key: 'wide', label: 'Wide', half: 55 },
] as const;
export type RangePresetKey = (typeof RANGE_PRESETS)[number]['key'];
/** How far the band CENTER may drift from spot (keeps both edges near-the-money). */
export const RANGE_CENTER_MAX = 35;

/** Both-finite band ticks: bet BTC settles INSIDE [lowerUsd, higherUsd]. */
export function rangeTicks624(lowerUsd: number, higherUsd: number): { lowerTick: bigint; higherTick: bigint } {
  return { lowerTick: usdToTick(lowerUsd), higherTick: usdToTick(higherUsd) };
}

/** Translate the venue's mint aborts into plain words (codes from expiry_market.move). */
export function friendlyMintAbort(raw: string): string {
  return /::account::withdraw/i.test(raw)
    ? 'Your trading account can’t cover this yet — placing the bet tops it up automatically.'
    : /assert_mint_admission/i.test(raw)
    ? 'Just under the venue’s minimum ticket — bet a touch more (1.05+) and it clears.'
    : /::order::assert_valid_quantity|::order::.*abort code:?\s*4/i.test(raw)
    ? 'This bet size was not on the venue lot grid. The quote has been corrected — try again.'
    : /abort code:?\s*4/.test(raw)
    ? 'The price moved past your max while you were signing — nothing was charged. Quote refreshed, try again.'
    : /abort code:?\s*5/.test(raw)
      ? 'The odds moved past the cap while you were signing — nothing was charged. Try again.'
      : /abort code:?\s*6/.test(raw)
        ? 'Too small for the venue — raise the payout (≥ 2 DUSDC at 1×).'
        : /abort code:?\s*0/.test(raw)
          ? 'Minting is paused on this market — pick another.'
          : raw.slice(0, 160);
}

// ─── the account half of the ticket ───

export interface Account624 {
  address: string | null;
  /** The user's shared AccountWrapper id (null = none yet / not connected). */
  wrapperId: string | null;
  /** The wrapper's inner account id — what the indexer feeds key on. */
  innerAccountId: string | null;
  /** True once wrapper discovery has resolved (either way). */
  wrapperChecked: boolean;
  /** Stored DUSDC in the trading account (display units). */
  acctBalance: number;
  refreshAcctBalance: (wid?: string | null) => Promise<void>;
  /** Sponsored-first submit (yosuku-trading-624 covers all 6-24 targets); wallet fallback rebuilds via the factory. */
  submitTx: (build: () => Transaction) => Promise<string>;
  /** One-time account creation. Resolves the wrapper id (null = still indexing). */
  createAccount: () => Promise<string | null>;
  /** Deposit micro-DUSDC from the connected wallet into the trading account. */
  deposit: (amountMicro: bigint) => Promise<string>;
  /** Wallet-side DUSDC (micro units) + coins, for deposit sizing. */
  walletMicro: number;
  dusdcCoins: { coinObjectId: string; balance: bigint }[];
  refreshWallet: () => void;
}

/**
 * Wrapper discovery + balance polling + one-time setup + deposits — identical
 * behavior to the founder-validated /markets-live flow, hoisted so the ticket
 * drawer and the page run the SAME code.
 */
export function useAccount624(): Account624 {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { mutateAsync: signTransaction } = useSignTransaction();
  const { balance: walletMicro, coins: dusdcCoins, refresh: refreshWallet } = useDUSDCBalance();

  const [wrapperId, setWrapperId] = useState<string | null>(null);
  const [innerAccountId, setInnerAccountId] = useState<string | null>(null);
  const [wrapperChecked, setWrapperChecked] = useState(false);
  const [acctBalance, setAcctBalance] = useState(0);

  const { submit } = useSmartSubmit();
  const submitTx = useCallback(
    async (build: () => Transaction): Promise<string> => {
      if (!address) throw new Error('Connect a wallet first');
      const { digest } = await submit(build); // sponsored-first; wallet fallback rebuilds clean
      return digest;
    },
    [address, submit],
  );

  const refreshAcctBalance = useCallback(
    async (wid?: string | null) => {
      const id = wid ?? wrapperId;
      if (!id) return;
      try {
        setAcctBalance(await fetchAccountBalance624(id));
      } catch {
        /* keep last good balance */
      }
    },
    [wrapperId],
  );

  // wrapper discovery on connect / disconnect
  useEffect(() => {
    let live = true;
    setWrapperId(null);
    setInnerAccountId(null);
    setWrapperChecked(false);
    setAcctBalance(0);
    if (!address) {
      setWrapperChecked(true);
      return;
    }
    (async () => {
      try {
        const wid = await findWrapperId624(address);
        if (!live) return;
        setWrapperId(wid);
        if (wid) {
          const inner = await fetchInnerAccountId624(wid);
          if (!live) return;
          setInnerAccountId(inner);
          fetchAccountBalance624(wid)
            .then((b) => {
              if (live) setAcctBalance(b);
            })
            .catch(() => {});
        }
      } finally {
        if (live) setWrapperChecked(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);

  // steady balance poll once the account exists
  useEffect(() => {
    if (!wrapperId) return;
    const id = setInterval(() => refreshAcctBalance(), 12_000);
    return () => clearInterval(id);
  }, [wrapperId, refreshAcctBalance]);

  const createAccount = useCallback(async (): Promise<string | null> => {
    if (!address) throw new Error('Connect a wallet first');
    await submitTx(() => buildCreateAccountTx());
    // the wrapper id is derived — poll until the read layer sees it
    let wid: string | null = null;
    for (let i = 0; i < 6 && !wid; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      wid = await findWrapperId624(address);
    }
    if (wid) {
      setWrapperId(wid);
      const inner = await fetchInnerAccountId624(wid);
      setInnerAccountId(inner);
      refreshAcctBalance(wid);
    }
    return wid;
  }, [address, submitTx, refreshAcctBalance]);

  const deposit = useCallback(
    async (amountMicro: bigint): Promise<string> => {
      if (!address || !wrapperId) throw new Error('No trading account yet');
      if (dusdcCoins.length === 0) throw new Error('No DUSDC coins in this wallet');
      const digest = await submitTx(() =>
        buildDepositTx({ wrapperId, coinIds: dusdcCoins.map((c) => c.coinObjectId), amountMicro }),
      );
      refreshWallet();
      refreshAcctBalance();
      return digest;
    },
    [address, wrapperId, dusdcCoins, submitTx, refreshWallet, refreshAcctBalance],
  );

  return {
    address,
    wrapperId,
    innerAccountId,
    wrapperChecked,
    acctBalance,
    refreshAcctBalance,
    submitTx,
    createAccount,
    deposit,
    walletMicro,
    dusdcCoins,
    refreshWallet,
  };
}

// ─── the quote half of the ticket ───

/**
 * The live-quote loop: debounce typing 350ms, re-quote every 12s (short-cadence
 * probability moves), fresh strike from the latest spot on every run. The quote
 * is what predict will actually charge — estimates both mislead and abort
 * EMintCostAboveMax on 1m cadences.
 */
export function useMintQuote624(p: {
  address: string | null;
  wrapperId: string | null;
  marketId: string | null;
  dir: Dir624 | null;
  /** Range band (both finite). When set it OVERRIDES dir — a range bet. */
  band?: { lowerUsd: number; higherUsd: number } | null;
  /** Payout quantity, DUSDC display units. */
  qty: number;
  lev: number;
  spot: number | null;
  /** Extra gate (e.g. below protocol minimum / market closing). Default true. */
  enabled?: boolean;
}): { quote: MintQuote624 | null; quoteErr: string | null; quoting: boolean } {
  const [quote, setQuote] = useState<MintQuote624 | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const spotRef = useRef(p.spot);
  spotRef.current = p.spot;
  const enabled = p.enabled !== false;
  const hasBand = p.band != null && p.band.lowerUsd < p.band.higherUsd;

  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    if (!enabled || !p.address || !p.wrapperId || !p.marketId || p.qty <= 0 || p.spot == null) return;
    if (!hasBand && !p.dir) return;
    let dead = false;
    const run = async () => {
      const spot = spotRef.current;
      if (spot == null) return;
      setQuoting(true);
      const { lowerTick, higherTick } = hasBand
        ? rangeTicks624(p.band!.lowerUsd, p.band!.higherUsd)
        : ticks624(spot, p.dir!);
      const q = await quoteMint624({
        sender: p.address!,
        marketId: p.marketId!,
        wrapperId: p.wrapperId!,
        lowerTick,
        higherTick,
        qtyMicro: positionQuantityMicro624(p.qty),
        leverage1e9: BigInt(p.lev) * 1_000_000_000n,
        gasOwner: await sponsorAddr(), // SUI-less wallets: sponsor satisfies build-time gas selection
      });
      if (dead) return;
      setQuoting(false);
      if ('error' in q) {
        setQuote(null);
        setQuoteErr(q.error);
      } else {
        setQuote(q);
        setQuoteErr(null);
      }
    };
    const t = setTimeout(run, 350); // debounce typing
    const iv = setInterval(run, 12_000); // re-quote — short-cadence probability moves
    return () => {
      dead = true;
      clearTimeout(t);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, p.address, p.wrapperId, p.marketId, p.dir, hasBand, p.band?.lowerUsd, p.band?.higherUsd, p.qty, p.lev, p.spot != null]);

  return { quote, quoteErr, quoting };
}

// ─── the place half of the ticket ───

// The mint caps the ALL-IN cost at maxCost and REVERTS if the live cost exceeds it. On short
// cadences the entry probability swings fast while a human reads a wallet popup (~10s), so a
// tight cap aborts EMintCostAboveMax("price moved past your max"). Give the cap more headroom
// the shorter the market — 1m moves far more in 10s (≈17% of its life) than 1h (≈0.3%). The
// user still pays only the EXACT measured cost; the wider cap just absorbs sign-time movement.
const COST_CAP_BUFFER: Record<string, number> = { '1m': 1.6, '5m': 1.2, '1h': 1.1 };
export const costCapBuffer = (cadence?: string) => COST_CAP_BUFFER[cadence ?? '5m'] ?? 1.2;

/**
 * Place a bet with the founder-validated guard: re-quote at the moment of click
 * (1m-market odds move while a human reads a wallet popup), then ONE user-legible
 * cap — you never pay more than the fresh quote ×1.10 (never beyond your balance).
 * maxProb is left at the protocol max: a second probability guard duplicates the
 * cost cap and was sniping signers mid-popup (EMintProbabilityAboveMax).
 *
 * Throws raw errors — map with friendlyMintAbort at the call site.
 */
export async function placeMint624(p: {
  /** Sponsor-capable submit (factory form) — every bet is gas-free via the sponsor,
   *  falling back to the wallet if the sponsor declines/is down. */
  submit: (factory: () => Transaction) => Promise<string>;
  address: string;
  wrapperId: string;
  marketId: string;
  dir: Dir624;
  /** Payout quantity, DUSDC display units. */
  qty: number;
  lev: number;
  spot: number;
  acctBalance: number;
  /** Market cadence — scales the cost-cap headroom (short markets move faster while signing). */
  cadence?: string;
}): Promise<{ digest: string; strikeUsd: number; costDusdc: number }> {
  const strikeUsd = strike624(p.spot, p.dir);
  const { lowerTick, higherTick } = ticks624(p.spot, p.dir);
  let qtyMicro = positionQuantityMicro624(p.qty);
  const leverage1e9 = BigInt(p.lev) * 1_000_000_000n;

  const fresh = await quoteMint624({
    sender: p.address,
    marketId: p.marketId,
    wrapperId: p.wrapperId,
    lowerTick,
    higherTick,
    qtyMicro,
    leverage1e9,
    gasOwner: await sponsorAddr(),
  });
  if ('error' in fresh) throw new Error(`quote: ${fresh.error}`);
  // clear the venue's 1-DUSDC min-premium floor (a 1.00 stake sizes premium to exactly 1.00
  // and lot rounding can shave it under → admission abort). Scale the cost guard with the bump.
  const bumped = bigMax(qtyMicro, minQtyMicroForPremium(p.lev, fresh.entryProb));
  const costScale = Number(bumped) / Number(qtyMicro);
  qtyMicro = bumped;
  const freshCost = (fresh.costMicro * costScale) / DUSDC_MULTIPLIER;
  const maxCost = Math.min(p.acctBalance, freshCost * costCapBuffer(p.cadence));
  if (maxCost < freshCost) throw new Error('balance below the live cost — deposit a little more');

  const mintArgs = {
    marketId: p.marketId,
    wrapperId: p.wrapperId,
    lowerTick,
    higherTick,
    qtyMicro,
    leverage1e9,
    maxCostMicro: BigInt(Math.floor(maxCost * DUSDC_MULTIPLIER)),
    maxProb1e9: BigInt(990_000_000), // protocol max — the cost cap is the real guard
  };
  const digest = await p.submit(() => buildMintTx(mintArgs));
  return { digest, strikeUsd, costDusdc: freshCost };
}

/**
 * Place a RANGE bet — same fresh-quote-at-click ×1.10 guard as placeMint624, but
 * with both band ends finite so it wins only if settlement lands inside [lower, higher].
 */
export async function placeRangeMint624(p: {
  /** Sponsor-capable submit (factory form) — gas-free via the sponsor, wallet fallback. */
  submit: (factory: () => Transaction) => Promise<string>;
  address: string;
  wrapperId: string;
  marketId: string;
  lowerUsd: number;
  higherUsd: number;
  /** Payout quantity, DUSDC display units. */
  qty: number;
  lev: number;
  acctBalance: number;
  /** Market cadence — scales the cost-cap headroom (short markets move faster while signing). */
  cadence?: string;
}): Promise<{ digest: string; lowerUsd: number; higherUsd: number; costDusdc: number }> {
  const { lowerTick, higherTick } = rangeTicks624(p.lowerUsd, p.higherUsd);
  let qtyMicro = positionQuantityMicro624(p.qty);
  const leverage1e9 = BigInt(p.lev) * 1_000_000_000n;

  const fresh = await quoteMint624({
    sender: p.address,
    marketId: p.marketId,
    wrapperId: p.wrapperId,
    lowerTick,
    higherTick,
    qtyMicro,
    leverage1e9,
    gasOwner: await sponsorAddr(),
  });
  if ('error' in fresh) throw new Error(`quote: ${fresh.error}`);
  // min-premium floor + scaled cost guard (see placeMint624)
  const bumped = bigMax(qtyMicro, minQtyMicroForPremium(p.lev, fresh.entryProb));
  const costScale = Number(bumped) / Number(qtyMicro);
  qtyMicro = bumped;
  const freshCost = (fresh.costMicro * costScale) / DUSDC_MULTIPLIER;
  const maxCost = Math.min(p.acctBalance, freshCost * costCapBuffer(p.cadence));
  if (maxCost < freshCost) throw new Error('balance below the live cost — deposit a little more');

  const mintArgs = {
    marketId: p.marketId,
    wrapperId: p.wrapperId,
    lowerTick,
    higherTick,
    qtyMicro,
    leverage1e9,
    maxCostMicro: BigInt(Math.floor(maxCost * DUSDC_MULTIPLIER)),
    maxProb1e9: BigInt(990_000_000),
  };
  const digest = await p.submit(() => buildMintTx(mintArgs));
  return { digest, lowerUsd: p.lowerUsd, higherUsd: p.higherUsd, costDusdc: freshCost };
}

/**
 * FIRST BET for a user with no trading account yet — creates the account, funds it, and
 * places the bet in ONE signature (gas-free via the sponsor). There is no account to quote
 * against, so instead of the fresh-quote guard we deposit the stake + 15% headroom (capped at
 * the wallet's DUSDC) and cap the mint at that deposit — the whole PTB reverts if the live cost
 * can't fit, so funds are never stranded. The headroom that isn't spent stays as account
 * balance, ready for the next bet. Handles a directional bet (dir) or a range bet (band).
 */
export async function placeFirstBet624(p: {
  /** A sponsor-capable submit (factory form) — a new user has no SUI, so the first bet MUST
   *  be gas-free; every target here is in the yosuku-trading-624 sponsor policy. */
  submit: (factory: () => Transaction) => Promise<string>;
  address: string;
  marketId: string;
  dir?: Dir624;
  band?: { lowerUsd: number; higherUsd: number };
  /** Payout quantity, DUSDC display units. */
  qty: number;
  lev: number;
  spot: number;
  /** The user's intended stake (DUSDC display units) and their wallet DUSDC coins. */
  stakeDusdc: number;
  walletDusdcMicro: bigint;
  coinIds: string[];
  /** Market cadence — scales the cost-cap headroom (short markets move faster while signing). */
  cadence?: string;
}): Promise<{ digest: string; costDusdc: number; strikeUsd?: number; lowerUsd?: number; higherUsd?: number }> {
  if (!p.coinIds.length) throw new Error('no DUSDC in your wallet — grab some from the faucet first');
  const stakeMicro = BigInt(Math.round(p.stakeDusdc * DUSDC_MULTIPLIER));
  // deposit the stake + cadence-scaled headroom for pricing movement during signing, never more
  // than the wallet holds (the cost cap = the deposit, so this is what lets a 1m bet clear).
  const buffered = (stakeMicro * BigInt(Math.round(costCapBuffer(p.cadence) * 100))) / 100n;
  const depositMicro = buffered < p.walletDusdcMicro ? buffered : p.walletDusdcMicro;
  if (depositMicro < stakeMicro) throw new Error('not enough DUSDC to cover the bet + fees — top up your wallet');

  const isRange = p.band != null && p.band.lowerUsd < p.band.higherUsd;
  const { lowerTick, higherTick } = isRange
    ? rangeTicks624(p.band!.lowerUsd, p.band!.higherUsd)
    : ticks624(p.spot, p.dir!);
  // Probe the REAL entry probability (dry-run of this same combined PTB — the deposit inside
  // funds the account mid-dry-run). Static estimates abort EMintCostAboveMax when conditions
  // push the band's probability past them (measured 0.6→0.9 on the same band in one day).
  // Sponsor as gas owner satisfies gas selection for a SUI-less wallet; falls back to the
  // caller's estimate-sized qty only if the probe itself fails.
  let qtyDisplay = p.qty;
  const sponsor = await getSponsorStatus().catch(() => null);
  const probe = await probeCombinedMint624({
    wrapperId: null,
    coinIds: p.coinIds,
    probeDepositMicro: p.walletDusdcMicro,
    marketId: p.marketId,
    lowerTick,
    higherTick,
    leverage1e9: BigInt(p.lev) * 1_000_000_000n,
    sender: p.address,
    gasOwner: sponsor?.address ?? null,
  });
  if (!('error' in probe) && probe.entryProb > 0.01) {
    qtyDisplay = qtyForStake(p.stakeDusdc, p.lev, probe.entryProb);
  }
  // probe-sized qty puts the premium EXACTLY at the stake — floor it over the venue minimum
  const qtyMicroFirst = !('error' in probe) && probe.entryProb > 0.01
    ? bigMax(positionQuantityMicro624(qtyDisplay), minQtyMicroForPremium(p.lev, probe.entryProb))
    : positionQuantityMicro624(qtyDisplay);
  const mintArgs = {
    coinIds: p.coinIds,
    depositMicro,
    marketId: p.marketId,
    lowerTick,
    higherTick,
    qtyMicro: qtyMicroFirst,
    leverage1e9: BigInt(p.lev) * 1_000_000_000n,
    maxCostMicro: depositMicro, // can't cost more than we just deposited
    maxProb1e9: BigInt(990_000_000),
  };
  // factory form: the sponsored path rebuilds the tx per attempt (sets gas owner = sponsor)
  const digest = await p.submit(() => buildCreateFundAndMint624(mintArgs));
  const out: { digest: string; costDusdc: number; strikeUsd?: number; lowerUsd?: number; higherUsd?: number } = {
    digest,
    costDusdc: p.stakeDusdc,
  };
  if (isRange) { out.lowerUsd = p.band!.lowerUsd; out.higherUsd = p.band!.higherUsd; }
  else { out.strikeUsd = strike624(p.spot, p.dir!); }
  return out;
}

/**
 * TOP UP AND BET for an EXISTING account whose balance is below the bet: deposit the shortfall
 * from the wallet AND place, in ONE sponsored signature — no separate "deposit, then bet" step.
 * Like placeFirstBet624 but the account already exists (no create/share). No live quote (an
 * underfunded account can't dry-run the mint), so we top the balance up to stake + cadence
 * headroom and cap the cost there; the PTB reverts if it can't fit, so funds are never stranded.
 */
export async function placeTopUpAndBet624(p: {
  submit: (factory: () => Transaction) => Promise<string>;
  address: string;
  wrapperId: string;
  marketId: string;
  dir?: Dir624;
  band?: { lowerUsd: number; higherUsd: number };
  /** Payout quantity, DUSDC display units. */
  qty: number;
  lev: number;
  spot: number;
  stakeDusdc: number;
  /** The existing account balance (DUSDC display units). */
  acctBalance: number;
  walletDusdcMicro: bigint;
  coinIds: string[];
  cadence?: string;
}): Promise<{ digest: string; costDusdc: number; strikeUsd?: number; lowerUsd?: number; higherUsd?: number }> {
  if (!p.coinIds.length) throw new Error('no DUSDC in your wallet to top up — grab some from the faucet');
  const stakeMicro = BigInt(Math.round(p.stakeDusdc * DUSDC_MULTIPLIER));
  const acctMicro = BigInt(Math.round(p.acctBalance * DUSDC_MULTIPLIER));
  // top the account up to stake + cadence headroom; deposit only the shortfall, capped at wallet
  const targetMicro = (stakeMicro * BigInt(Math.round(costCapBuffer(p.cadence) * 100))) / 100n;
  const shortfall = targetMicro > acctMicro ? targetMicro - acctMicro : 0n;
  const depositMicro = shortfall < p.walletDusdcMicro ? shortfall : p.walletDusdcMicro;
  if (depositMicro <= 0n) throw new Error('account already funded — no top-up needed');
  const totalMicro = acctMicro + depositMicro;
  if (totalMicro < stakeMicro) throw new Error('not enough test USDC to cover the bet + fees — top up your wallet');

  const isRange = p.band != null && p.band.lowerUsd < p.band.higherUsd;
  const { lowerTick, higherTick } = isRange
    ? rangeTicks624(p.band!.lowerUsd, p.band!.higherUsd)
    : ticks624(p.spot, p.dir!);
  // Probe the REAL entry probability (see placeFirstBet624) — sizes qty so the measured cost
  // lands near the stake instead of blowing past maxCost when the band's prob runs high.
  let qtyDisplay = p.qty;
  const sponsor = await getSponsorStatus().catch(() => null);
  const probe = await probeCombinedMint624({
    wrapperId: p.wrapperId,
    coinIds: p.coinIds,
    probeDepositMicro: depositMicro,
    marketId: p.marketId,
    lowerTick,
    higherTick,
    leverage1e9: BigInt(p.lev) * 1_000_000_000n,
    sender: p.address,
    gasOwner: sponsor?.address ?? null,
  });
  if (!('error' in probe) && probe.entryProb > 0.01) {
    qtyDisplay = qtyForStake(p.stakeDusdc, p.lev, probe.entryProb);
  }
  // probe-sized qty puts the premium EXACTLY at the stake — floor it over the venue minimum
  const qtyMicroTop = !('error' in probe) && probe.entryProb > 0.01
    ? bigMax(positionQuantityMicro624(qtyDisplay), minQtyMicroForPremium(p.lev, probe.entryProb))
    : positionQuantityMicro624(qtyDisplay);
  const mintArgs = {
    wrapperId: p.wrapperId,
    coinIds: p.coinIds,
    depositMicro,
    marketId: p.marketId,
    lowerTick,
    higherTick,
    qtyMicro: qtyMicroTop,
    leverage1e9: BigInt(p.lev) * 1_000_000_000n,
    maxCostMicro: totalMicro, // cost can't exceed the post-deposit balance
    maxProb1e9: BigInt(990_000_000),
  };
  const digest = await p.submit(() => buildTopUpAndMint624(mintArgs));
  const out: { digest: string; costDusdc: number; strikeUsd?: number; lowerUsd?: number; higherUsd?: number } = {
    digest,
    costDusdc: p.stakeDusdc,
  };
  if (isRange) { out.lowerUsd = p.band!.lowerUsd; out.higherUsd = p.band!.higherUsd; }
  else { out.strikeUsd = strike624(p.spot, p.dir!); }
  return out;
}
