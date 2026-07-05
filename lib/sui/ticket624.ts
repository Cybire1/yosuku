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
/** Leave enough time for wallet approval and submission before the market expires. */
export const MIN_MINT_MS = 15_000;
/** DeepBook Predict's on-chain minimum net premium. Fees are quoted separately. */
export const MIN_STAKE = 1;

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
  return /::order::assert_valid_quantity|::order::.*abort code:?\s*4/i.test(raw)
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
  /** Plain wallet submit — NO sponsor (Onara only covers old-deployment targets). */
  submitTx: (tx: Transaction) => Promise<string>;
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

  const submitTx = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!address) throw new Error('Connect a wallet first');
      const r = await buildSignExecute(tx, ({ transaction }) =>
        signTransaction({ transaction }).then((s) => ({ bytes: s.bytes, signature: s.signature })),
      );
      await grpc.waitForTransaction({ digest: r.digest });
      return r.digest;
    },
    [address, signTransaction],
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
    await submitTx(buildCreateAccountTx());
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
      const digest = await submitTx(
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
  submitTx: (tx: Transaction) => Promise<string>;
  address: string;
  wrapperId: string;
  marketId: string;
  dir: Dir624;
  /** Payout quantity, DUSDC display units. */
  qty: number;
  lev: number;
  spot: number;
  acctBalance: number;
}): Promise<{ digest: string; strikeUsd: number; costDusdc: number }> {
  const strikeUsd = strike624(p.spot, p.dir);
  const { lowerTick, higherTick } = ticks624(p.spot, p.dir);
  const qtyMicro = positionQuantityMicro624(p.qty);
  const leverage1e9 = BigInt(p.lev) * 1_000_000_000n;

  const fresh = await quoteMint624({
    sender: p.address,
    marketId: p.marketId,
    wrapperId: p.wrapperId,
    lowerTick,
    higherTick,
    qtyMicro,
    leverage1e9,
  });
  if ('error' in fresh) throw new Error(`quote: ${fresh.error}`);
  const freshCost = fresh.costMicro / DUSDC_MULTIPLIER;
  const maxCost = Math.min(p.acctBalance, freshCost * 1.1);
  if (maxCost < freshCost) throw new Error('balance below the live cost — deposit a little more');

  const digest = await p.submitTx(
    buildMintTx({
      marketId: p.marketId,
      wrapperId: p.wrapperId,
      lowerTick,
      higherTick,
      qtyMicro,
      leverage1e9,
      maxCostMicro: BigInt(Math.floor(maxCost * DUSDC_MULTIPLIER)),
      maxProb1e9: BigInt(990_000_000), // protocol max — the cost cap is the real guard
    }),
  );
  return { digest, strikeUsd, costDusdc: freshCost };
}

/**
 * Place a RANGE bet — same fresh-quote-at-click ×1.10 guard as placeMint624, but
 * with both band ends finite so it wins only if settlement lands inside [lower, higher].
 */
export async function placeRangeMint624(p: {
  submitTx: (tx: Transaction) => Promise<string>;
  address: string;
  wrapperId: string;
  marketId: string;
  lowerUsd: number;
  higherUsd: number;
  /** Payout quantity, DUSDC display units. */
  qty: number;
  lev: number;
  acctBalance: number;
}): Promise<{ digest: string; lowerUsd: number; higherUsd: number; costDusdc: number }> {
  const { lowerTick, higherTick } = rangeTicks624(p.lowerUsd, p.higherUsd);
  const qtyMicro = positionQuantityMicro624(p.qty);
  const leverage1e9 = BigInt(p.lev) * 1_000_000_000n;

  const fresh = await quoteMint624({
    sender: p.address,
    marketId: p.marketId,
    wrapperId: p.wrapperId,
    lowerTick,
    higherTick,
    qtyMicro,
    leverage1e9,
  });
  if ('error' in fresh) throw new Error(`quote: ${fresh.error}`);
  const freshCost = fresh.costMicro / DUSDC_MULTIPLIER;
  const maxCost = Math.min(p.acctBalance, freshCost * 1.1);
  if (maxCost < freshCost) throw new Error('balance below the live cost — deposit a little more');

  const digest = await p.submitTx(
    buildMintTx({
      marketId: p.marketId,
      wrapperId: p.wrapperId,
      lowerTick,
      higherTick,
      qtyMicro,
      leverage1e9,
      maxCostMicro: BigInt(Math.floor(maxCost * DUSDC_MULTIPLIER)),
      maxProb1e9: BigInt(990_000_000),
    }),
  );
  return { digest, lowerUsd: p.lowerUsd, higherUsd: p.higherUsd, costDusdc: freshCost };
}
