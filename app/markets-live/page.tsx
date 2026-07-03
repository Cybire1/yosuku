'use client';

// /markets-live — the MAIN market flow on the NEW DeepBook Predict (predict-testnet-6-24).
//
// Promoted from /beta (founder-validated end-to-end: bet placed + won + claimed through
// it). Same machinery — account setup (AccountWrapper), deposit/withdraw, real dry-run
// quoting (quoteMint624), one legible cost guard, friendly abort toasts, positions via
// the /accounts indexer routes — evolved with a CADENCE TIER BAR as the primary market
// control: [ 1-minute ] [ 5-minute ] [ 1-hour ] tabs filtering the market cards.
// This deployment has NO 15-minute cadence — we do not show one.
//
// TX PATH: plain wallet signing (buildSignExecute over gRPC). The Onara sponsor
// only allowlists OLD-deployment targets, so nothing here routes through it.
//
// INDEXER (verified live 2026-07-03): per-user feeds are keyed by the wrapper's
// INNER `account.account_id` — /accounts/{account_id}/orders and
// /accounts/{account_id}/positions?status=open (see predict624Client).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConnectButton } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import { useToast } from '@/components/Toast';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import {
  POS_INF_TICK,
  FLOAT_SCALING_624,
  tickToUsd,
  fetchMarkets624,
  fetchSpot624,
  fetchOpenPositions624,
  fetchAccountOrders624,
  fetchMarketState624,
  buildWithdrawTx,
  buildRedeemSettledTx,
  type Cadence624,
  type Market624,
  type Position624,
  type OrderRow624,
  type MarketState624,
} from '@/lib/sui/predict624Client';
import {
  BAND_USD,
  EST_PROB,
  EST_PROB_HIGH,
  MIN_MINT_MS,
  friendlyMintAbort,
  placeMint624,
  useAccount624,
  useMintQuote624,
} from '@/lib/sui/ticket624';

// ─── constants ───
// (Ticket machinery — band, quote loop, place guard, abort mapping — lives in
// lib/sui/ticket624, SHARED with the /markets ticket drawer. Do not fork it.)

const POS_INF = Number(POS_INF_TICK);
const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const SUISCAN_OBJ = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;

// The venue's cadences on THIS deployment. There is no 15-minute cadence — we don't fake one.
const TIERS: Cadence624[] = ['1m', '5m', '1h'];
const CADENCE_WORD: Record<Cadence624, string> = { '1m': '1-minute', '5m': '5-minute', '1h': '1-hour' };

// ─── tiny formatters (kept local — this page has no deps on the old-deployment clients) ───

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUsd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const micro = (n: bigint) => Number(n) / DUSDC_MULTIPLIER;

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'settling';
  const m = Math.floor(msLeft / 60_000);
  const s = Math.floor((msLeft % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function ago(ts: number, now: number): string {
  const d = now - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

/** Human band: OVER $x (up), UNDER $y (down), or $x–$y. Ticks are $0.01-grid indices. */
function bandLabel(lowerTick: number, higherTick: number): string {
  if (higherTick >= POS_INF) return `over ${fmtUsd0(tickToUsd(lowerTick))}`;
  if (lowerTick <= 0) return `under ${fmtUsd0(tickToUsd(higherTick))}`;
  return `${fmtUsd0(tickToUsd(lowerTick))}–${fmtUsd0(tickToUsd(higherTick))}`;
}

// ─── page ───

type PendingMint = { marketId: string; dir: 'up' | 'down'; strikeUsd: number; qty: number; lev: number; ts: number };

export default function MarketsLivePage() {
  const { toast } = useToast();
  // account machinery — SHARED with the /markets ticket drawer (lib/sui/ticket624)
  const acct = useAccount624();
  const {
    address,
    wrapperId,
    innerAccountId,
    wrapperChecked,
    acctBalance,
    refreshAcctBalance,
    submitTx,
    walletMicro,
    dusdcCoins,
    refreshWallet,
  } = acct;
  const walletDusdc = walletMicro / DUSDC_MULTIPLIER;

  // clock — drives every countdown; 0 until mounted (avoids SSR hydration drift)
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // market + oracle
  const [markets, setMarkets] = useState<Market624[]>([]);
  const [marketsErr, setMarketsErr] = useState<string | null>(null);
  const [spot, setSpot] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // cadence tier — the primary market control
  const [tier, setTier] = useState<Cadence624>('1m');
  const tierAutoPicked = useRef(false);

  // ticket
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const [payoutStr, setPayoutStr] = useState(''); // user-owned; chips are ADDITIVE only
  const [lev, setLev] = useState(1);

  // fund card
  const [fundMode, setFundMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [fundStr, setFundStr] = useState('');

  // positions
  const [positions, setPositions] = useState<Position624[]>([]);
  const [history, setHistory] = useState<OrderRow624[]>([]);
  const [mktStates, setMktStates] = useState<Record<string, MarketState624>>({});
  const [pending, setPending] = useState<PendingMint[]>([]);

  const [busy, setBusy] = useState<string | null>(null);

  // ── loaders ──

  const loadMarkets = useCallback(async () => {
    try {
      const all = await fetchMarkets624();
      // Keep everything inside the hour — the tier bar slices per cadence below.
      setMarkets(all.filter((m) => m.minsOut < 65));
      setMarketsErr(null);
    } catch (e) {
      setMarketsErr(String(e instanceof Error ? e.message : e).slice(0, 120));
    }
  }, []);

  const loadSpot = useCallback(async () => {
    try { setSpot(await fetchSpot624()); } catch { /* keep last good spot */ }
  }, []);

  const loadPositions = useCallback(async (acctId?: string | null) => {
    const id = acctId ?? innerAccountId;
    if (!id) return;
    try {
      const [open, orders] = await Promise.all([fetchOpenPositions624(id), fetchAccountOrders624(id, 30)]);
      setPositions(open);
      setHistory(orders.filter((o) => o.kind.endsWith('_redeemed')));
      // settlement state for every market an open position sits in
      const ids = Array.from(new Set(open.map((p) => p.marketId)));
      const states = await Promise.all(ids.map((m) => fetchMarketState624(m).catch(() => null)));
      const map: Record<string, MarketState624> = {};
      ids.forEach((m, i) => { const s = states[i]; if (s) map[m] = s; });
      setMktStates(map);
      // optimistic rows: drop any that the indexer has since confirmed (or that went stale)
      setPending((p) => p.filter(
        (pm) => Date.now() - pm.ts < 120_000 && !open.some((o) => o.marketId === pm.marketId && o.openedAtMs >= pm.ts - 30_000),
      ));
    } catch { /* transient indexer hiccup — next poll wins */ }
  }, [innerAccountId]);

  // markets: load now, poll 15s
  useEffect(() => {
    loadMarkets();
    const id = setInterval(loadMarkets, 15_000);
    return () => clearInterval(id);
  }, [loadMarkets]);

  // spot: load now, poll 5s
  useEffect(() => {
    loadSpot();
    const id = setInterval(loadSpot, 5_000);
    return () => clearInterval(id);
  }, [loadSpot]);

  // page-local position state resets on wallet switch (wrapper discovery itself
  // lives in useAccount624)
  useEffect(() => {
    setPositions([]); setHistory([]); setPending([]);
  }, [address]);

  // positions: load as soon as the inner account id lands, then poll 10s
  useEffect(() => {
    if (!innerAccountId) return;
    loadPositions(innerAccountId);
    const id = setInterval(() => loadPositions(), 10_000);
    return () => clearInterval(id);
  }, [innerAccountId, loadPositions]);

  // ── the tier bar: markets grouped by cadence, soonest first (fetch is pre-sorted) ──
  const tierMarkets = useMemo(() => {
    const by: Record<Cadence624, Market624[]> = { '1m': [], '5m': [], '1h': [] };
    for (const m of markets) by[m.cadence].push(m);
    return by;
  }, [markets]);

  // If the default tier is empty on FIRST load, open on the soonest tier that
  // actually has a market — after that the choice is the user's.
  useEffect(() => {
    if (tierAutoPicked.current || markets.length === 0) return;
    tierAutoPicked.current = true;
    if (tierMarkets[tier].length === 0) {
      const first = TIERS.find((t) => tierMarkets[t].length > 0);
      if (first) setTier(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets.length]);

  // this hour's :00 settle — the 1-hour tier states it honestly even when the
  // venue hasn't listed the hourly market yet
  const nextHourMs = now > 0 ? (Math.floor(now / 3_600_000) + 1) * 3_600_000 : null;
  const nextHourMins = nextHourMs != null ? Math.max(1, Math.ceil((nextHourMs - now) / 60_000)) : null;

  const visibleMarkets = useMemo(
    () => tierMarkets[tier].filter((m) => now === 0 || m.expiry > now).slice(0, 6),
    [tierMarkets, tier, now],
  );

  // drop a selected market once it is no longer mintable
  const selected = useMemo(() => markets.find((m) => m.id === selectedId) ?? null, [markets, selectedId]);
  useEffect(() => {
    if (selected && now > 0 && selected.expiry - now < MIN_MINT_MS) setSelectedId(null);
  }, [selected, now]);
  // switching tiers hides the old tier's cards — clear a selection that no longer matches
  useEffect(() => {
    if (selected && selected.cadence !== tier) setSelectedId(null);
  }, [selected, tier]);

  // ── ticket math: estimates while sizing; the REAL number comes from a dry-run quote ──
  const qty = useMemo(() => { const n = parseFloat(payoutStr.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; }, [payoutStr]);
  const estCost = qty > 0 ? (EST_PROB * qty) / lev : 0;
  const estFloor = qty > 0 ? EST_PROB * qty * (1 - 1 / lev) : 0; // financed floor: a win pays qty − floor
  const estWin = qty > 0 ? qty - estFloor : 0;
  const belowMinHard = qty > 0 && (EST_PROB_HIGH * qty) / lev < 1; // even the high estimate misses min_net_premium (1 DUSDC)
  const belowMinSoft = qty > 0 && !belowMinHard && (EST_PROB * qty) / lev < 1;
  const strikeUsd = spot != null && dir ? (dir === 'up' ? spot - BAND_USD : spot + BAND_USD) : null;
  const msLeft = selected && now > 0 ? selected.expiry - now : null;

  // the REAL quote — the SHARED loop (dry-runs the exact mint, 12s refresh).
  // Probability on 1m cadences is far above the 5m estimate (a $20 band ≈ 0.75–0.9),
  // so estimates both mislead and abort EMintCostAboveMax — the quote is what
  // predict will actually charge.
  const { quote, quoteErr, quoting } = useMintQuote624({
    address,
    wrapperId,
    marketId: selected?.id ?? null,
    dir,
    qty,
    lev,
    spot,
    enabled: !belowMinHard && !(msLeft != null && msLeft < MIN_MINT_MS),
  });

  const quotedCost = quote ? quote.costMicro / DUSDC_MULTIPLIER : null;
  const quotedWin = quote ? quote.winMicro / DUSDC_MULTIPLIER : null;

  const blocker: string | null = !address
    ? 'Connect a wallet'
    : !wrapperId
      ? 'Set up your account — step 01'
      : !selected
        ? 'Pick a market — step 02'
        : msLeft != null && msLeft < MIN_MINT_MS
          ? 'Market closing — pick the next one'
          : !dir
            ? 'Call UP or DOWN'
            : qty <= 0
              ? 'Enter a payout amount'
              : belowMinHard
                ? 'Below the 1 DUSDC protocol minimum'
                : spot == null
                  ? 'Waiting for the oracle price…'
                  : quotedCost != null && quotedCost > acctBalance
                    ? `Deposit ${fmt2(quotedCost)} DUSDC first`
                    : quoteErr
                      ? 'Quote failed — see below'
                      : quotedCost == null
                        ? 'Quoting the live price…'
                        : null;

  // ── actions ──

  async function createAccount() {
    if (!address || busy) return;
    setBusy('create');
    try {
      const wid = await acct.createAccount(); // shared: submits + polls the derived wrapper id
      toast(wid ? 'Trading account created' : 'Account created — still indexing, refresh in a moment', 'success');
    } catch (e) {
      toast(`Could not create the account: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setBusy(null); }
  }

  async function fund() {
    if (!address || !wrapperId || busy) return;
    const amt = parseFloat(fundStr.replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) { toast('Enter an amount above 0', 'error'); return; }
    const amountMicro = BigInt(Math.floor(amt * DUSDC_MULTIPLIER));
    if (fundMode === 'deposit') {
      if (Number(amountMicro) > walletMicro) { toast(`Wallet DUSDC too low — you hold ${fmt2(walletDusdc)}`, 'error'); return; }
      if (dusdcCoins.length === 0) { toast('No DUSDC coins in this wallet', 'error'); return; }
    } else if (amt > acctBalance) {
      toast(`Account balance is ${fmt2(acctBalance)} DUSDC`, 'error'); return;
    }
    setBusy('fund');
    try {
      if (fundMode === 'deposit') {
        await acct.deposit(amountMicro); // shared: merge → split exact → deposit_funds
      } else {
        await submitTx(buildWithdrawTx({ wrapperId, amountMicro, recipient: address }));
      }
      toast(fundMode === 'deposit' ? `Deposited ${fmt2(amt)} DUSDC` : `Withdrew ${fmt2(amt)} DUSDC to your wallet`, 'success');
      setFundStr('');
      refreshWallet(); refreshAcctBalance();
    } catch (e) {
      toast(`${fundMode === 'deposit' ? 'Deposit' : 'Withdraw'} failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setBusy(null); }
  }

  async function placeBet() {
    if (blocker || !address || !wrapperId || !selected || !dir || spot == null || busy || !quote) return;
    setBusy('mint');
    try {
      // SHARED place path: re-quote at the moment of click (1m-market odds move while a
      // human reads a wallet popup), then ONE user-legible guard — fresh quote ×1.10,
      // never beyond your balance; maxProb stays at the protocol max.
      const r = await placeMint624({
        submitTx, address, wrapperId, marketId: selected.id, dir, qty, lev, spot, acctBalance,
      });
      setPending((p) => [{ marketId: selected.id, dir, strikeUsd: r.strikeUsd, qty, lev, ts: Date.now() }, ...p]);
      setPayoutStr('');
      toast(`Bet placed — ${dir.toUpperCase()} ${dir === 'up' ? `over ${fmtUsd0(r.strikeUsd)}` : `under ${fmtUsd0(r.strikeUsd)}`}`, 'success');
      refreshAcctBalance();
      setTimeout(() => { loadPositions(); refreshAcctBalance(); }, 2_500);
    } catch (e) {
      toast(`Bet failed: ${friendlyMintAbort(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally { setBusy(null); }
  }

  async function claim(pos: Position624) {
    if (!wrapperId || busy) return;
    setBusy(`claim:${pos.orderId}`);
    try {
      await submitTx(buildRedeemSettledTx({
        marketId: pos.marketId,
        wrapperId,
        orderId: BigInt(pos.orderId),
        qty: pos.qtyMicro,
      }));
      toast('Position redeemed — payout landed in your account', 'success');
      refreshAcctBalance();
      loadPositions();
    } catch (e) {
      toast(`Claim failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setBusy(null); }
  }

  const addPayout = (n: number) => setPayoutStr((s) => String(Math.max(0, (parseFloat(s || '0') || 0) + n)));
  const addFund = (n: number) => setFundStr((s) => String(Math.max(0, (parseFloat(s || '0') || 0) + n)));

  const openCount = positions.length + pending.length;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        {/* masthead — dateline */}
        <div className="border-t border-white/10 pt-3 flex items-center justify-between gap-4 font-mono text-[10px] md:text-[11px] uppercase tracking-[0.28em] text-white/40">
          <span><span className="text-vermilion">⊙</span> Yosuku Ledger · <span className="font-jp">予測</span> · Live markets</span>
          <span className="tabular-nums flex items-center gap-2">
            <span className="hidden sm:inline">BTC ·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-vermilion animate-pulse" />
              <span className="text-white">{spot != null ? fmtUsd(spot) : '—'}</span>
            </span>
          </span>
        </div>

        {/* nameplate + standfirst */}
        <div className="grid md:grid-cols-[1fr_300px] gap-6 md:gap-10 items-end mt-7 pb-6 border-b border-white/15">
          <h1 className="font-display font-[800] text-[2.6rem] leading-[0.95] md:text-7xl text-white tracking-tight">
            Call BTC. Up or down.<br /><span className="text-white/40">Settled by the oracle in minutes.</span>
          </h1>
          <div className="md:border-l md:border-white/10 md:pl-7">
            <div className="font-mono text-[12px] leading-[1.95] text-white/55">
              {['Set up an account', 'Fund it', 'Pick a market', 'Make the call'].map((s, i) => (
                <span key={s} className="mr-3 inline-block whitespace-nowrap"><span className="text-vermilion">{String(i + 1).padStart(2, '0')}</span> {s}</span>
              ))}
              <span className="text-white font-semibold">Claim when it settles.</span>
            </div>
          </div>
        </div>

        {/* trust dateline */}
        <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-white/40 mt-4 mb-10">
          DeepBook Predict (6-24) · native leverage · oracle-settled · testnet DUSDC
        </div>

        <div className="grid lg:grid-cols-[1fr_22rem] gap-10 items-start">
          {/* ══ left rail: the flow ══ */}
          <div className="space-y-12 min-w-0">
            {/* 01 — account */}
            <Step n="01" title="Account" hint="one on-chain trading account, owned by your wallet">
              {!address ? (
                <PanelCard>
                  <p className="text-[13px] text-gray-400 leading-snug mb-4 max-w-md">
                    Your bets settle into an on-chain trading account only your wallet can withdraw from.
                    Connect to set it up.
                  </p>
                  <ConnectButton />
                </PanelCard>
              ) : !wrapperChecked ? (
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 py-6">reading the chain…</div>
              ) : !wrapperId ? (
                <PanelCard>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-2">One-time setup</div>
                  <h3 className="font-display font-[800] text-xl text-white mb-2">Set up your trading account</h3>
                  <p className="text-[13px] text-gray-400 leading-snug mb-4 max-w-md">
                    Creates your account on the new DeepBook Predict — a shared object derived from your
                    address. Deposits, payouts and withdrawals all move through it; only you can withdraw.
                  </p>
                  <button
                    onClick={createAccount}
                    disabled={busy === 'create'}
                    className="rounded-full bg-vermilion hover:bg-vermilion-d text-white text-sm font-semibold px-6 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy === 'create' ? 'Creating…' : 'Create account →'}
                  </button>
                </PanelCard>
              ) : (
                <div className="space-y-4">
                  {/* balance strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 border border-white/[0.08] bg-white/[0.02]">
                    <LedgerStat label="Wallet DUSDC" value={fmt2(walletDusdc)} />
                    <LedgerStat label="Account DUSDC" value={fmt2(acctBalance)} divide />
                    <div className="hidden sm:block px-3 py-3 border-l border-white/[0.06]">
                      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">Account</div>
                      <a href={SUISCAN_OBJ(wrapperId)} target="_blank" rel="noreferrer" className="font-mono text-sm text-white/70 hover:text-white transition-colors">{fmtAddr(wrapperId)} ↗</a>
                    </div>
                  </div>

                  {/* fund card */}
                  <PanelCard>
                    <div className="flex items-center gap-5 mb-4 border-b border-white/[0.06] -mt-1">
                      {(['deposit', 'withdraw'] as const).map((m) => (
                        <button key={m} onClick={() => { setFundMode(m); setFundStr(''); }}
                          className={`px-1 pb-2 font-mono text-[11px] uppercase tracking-[0.14em] border-b-2 transition-colors ${fundMode === m ? 'text-white border-vermilion' : 'text-white/40 hover:text-white border-transparent'}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-2.5 transition-colors focus-within:border-vermilion/50 max-w-md">
                      <div className="flex items-center justify-between">
                        <input
                          inputMode="decimal" placeholder="0.00" value={fundStr}
                          onChange={(e) => setFundStr(e.target.value.replace(/[^0-9.]/g, ''))}
                          className="w-full bg-transparent font-display text-2xl font-bold text-white outline-none placeholder:text-gray-600"
                        />
                        <span className="font-mono text-xs font-semibold text-gray-300 shrink-0">DUSDC</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-gray-500">Your amount — edit it freely.</span>
                        <div className="flex gap-1.5">
                          {[1, 5, 10].map((n) => (
                            <button key={n} onClick={() => addFund(n)} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors">+{n}</button>
                          ))}
                          {fundMode === 'withdraw' && acctBalance > 0 && (
                            <button onClick={() => setFundStr(acctBalance.toFixed(2))} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors">max</button>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-4">
                      <button
                        onClick={fund}
                        disabled={busy === 'fund'}
                        className="rounded-full bg-vermilion hover:bg-vermilion-d text-white text-[13px] font-semibold px-5 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {busy === 'fund' ? 'Submitting…' : fundMode === 'deposit' ? 'Deposit to account' : 'Withdraw to wallet'}
                      </button>
                      <span className="font-mono text-[10px] text-gray-600">
                        {fundMode === 'deposit' ? 'Testnet DUSDC — grab some from the faucet on the home page.' : 'Withdrawals go to your connected wallet only.'}
                      </span>
                    </div>
                  </PanelCard>
                </div>
              )}
            </Step>

            {/* 02 — market: cadence tier bar (primary control) + the tier's soonest markets */}
            <Step n="02" title="Market" hint="pick your cadence — each market settles at its expiry, on the oracle print">
              {/* tier bar */}
              <div role="tablist" aria-label="Market cadence" className="grid grid-cols-3 border border-white/[0.08] bg-white/[0.02] mb-px">
                {TIERS.map((t) => {
                  const on = tier === t;
                  const soonest = tierMarkets[t].find((m) => now === 0 || m.expiry > now) ?? null;
                  // the 1-hour tier keys off the clock: hourly markets settle at :00
                  // whether or not the venue has listed the next one yet
                  const soonestLeft = soonest && now > 0 ? soonest.expiry - now : null;
                  const big = t === '1h'
                    ? (soonestLeft != null ? fmtCountdown(soonestLeft) : nextHourMins != null ? `${nextHourMins}m away` : '—')
                    : (soonestLeft != null ? fmtCountdown(soonestLeft) : '—');
                  const sub = t === '1h'
                    ? 'settles at :00'
                    : soonest ? 'next settle' : 'none open right now';
                  return (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTier(t)}
                      className={`group relative text-left px-4 py-3.5 border-r last:border-r-0 border-white/[0.06] transition-colors duration-200 ${on ? 'bg-vermilion/[0.07]' : 'hover:bg-white/[0.02]'}`}
                    >
                      {!on && <Crosshairs />}
                      {on && <span className="absolute left-0 right-0 top-0 h-[2px] bg-vermilion" aria-hidden="true" />}
                      <div className={`font-mono text-[10px] uppercase tracking-[0.2em] ${on ? 'text-vermilion' : 'text-white/40'}`}>
                        {on ? '⊙ ' : ''}{CADENCE_WORD[t]}
                      </div>
                      <div className={`font-display font-[800] text-lg leading-none tabular-nums mt-2 ${on ? 'text-white' : 'text-white/45'}`}>
                        {big}
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/30 mt-1.5">{sub}</div>
                    </button>
                  );
                })}
              </div>

              {/* the tier's markets */}
              {marketsErr && markets.length === 0 ? (
                <PanelCard>
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
                    Couldn&apos;t reach the market feed — retrying every 15s.
                  </p>
                </PanelCard>
              ) : markets.length === 0 ? (
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 py-6">reading markets…</div>
              ) : visibleMarkets.length === 0 ? (
                <div className="border border-t-0 border-white/[0.06] bg-bg px-4 py-8 text-center">
                  <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
                    No {CADENCE_WORD[tier]} market open right now
                  </div>
                  <div className="font-mono text-[10px] text-white/30 mt-2 max-w-md mx-auto leading-relaxed normal-case">
                    {tier === '1h' && nextHourMins != null
                      ? `The hourly market settles at :00 — ${nextHourMins}m away. The venue lists it closer to the hour; it will appear here.`
                      : 'Markets roll continuously on this venue — the next one appears here within minutes.'}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-px bg-white/[0.06] border border-t-0 border-white/[0.06]">
                  {visibleMarkets.map((m) => {
                    const left = now > 0 ? m.expiry - now : null;
                    const closing = left != null && left < MIN_MINT_MS;
                    const on = m.id === selectedId;
                    const minsAway = left != null ? Math.max(1, Math.ceil(left / 60_000)) : null;
                    return (
                      <button
                        key={m.id}
                        onClick={() => { if (!closing) setSelectedId(on ? null : m.id); }}
                        disabled={closing}
                        className={`group relative text-left bg-bg p-4 transition-colors duration-200 ${closing ? 'cursor-not-allowed' : on ? 'bg-vermilion/[0.06]' : 'hover:bg-white/[0.02]'}`}
                      >
                        {!closing && <Crosshairs />}
                        <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] mb-3">
                          <span className={on ? 'text-vermilion' : closing ? 'text-white/25' : 'text-white/40'}>{on ? '⊙ ' : ''}BTC · {CADENCE_WORD[m.cadence]}</span>
                          <span className={closing ? 'text-vermilion/60' : 'text-white/30'}>{closing ? '● settling' : `${Math.round(m.maxLeverage1e9 / FLOAT_SCALING_624)}× max`}</span>
                        </div>
                        <div className={`font-display font-[800] text-2xl leading-none tabular-nums ${closing ? 'text-white/35' : 'text-white'}`}>
                          {left == null ? '—' : fmtCountdown(left)}
                        </div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mt-1.5">
                          {closing
                            ? 'at the oracle — watch the print'
                            : m.cadence === '1h' && minsAway != null
                              ? `settles at :00 — ${minsAway}m away`
                              : 'until it settles'}
                        </div>
                      </button>
                    );
                  })}
                  {/* filler cells keep the ledger grid ruled when the count isn't a multiple of 3 */}
                  {Array.from({ length: (3 - (visibleMarkets.length % 3)) % 3 }).map((_, i) => (
                    <div key={`filler-${i}`} className="bg-bg p-4 flex items-end">
                      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/20">
                        {tier === '1h' ? 'one market per hour' : `markets roll every ${tier === '1m' ? 'minute' : '5 minutes'}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Step>

            {/* 03 — the call */}
            <Step n="03" title="Your call" hint="a range digital with a $20 cushion around the live price">
              <div className="space-y-6">
                {/* direction */}
                <div className="grid grid-cols-2 gap-3 max-w-xl">
                  {(['up', 'down'] as const).map((d) => {
                    const on = dir === d;
                    const line = spot == null
                      ? 'waiting for the oracle…'
                      : d === 'up' ? `wins if BTC settles over ${fmtUsd0(spot - BAND_USD)}` : `wins if BTC settles under ${fmtUsd0(spot + BAND_USD)}`;
                    return (
                      <button key={d} onClick={() => setDir(on ? null : d)}
                        className={`group relative text-left border p-6 transition-all duration-200 ${on ? 'border-vermilion bg-vermilion shadow-[0_14px_48px_-12px_var(--vermilion)]' : 'border-white/[0.08] hover:border-white/30 hover:bg-white/[0.02]'}`}>
                        {!on && <Crosshairs />}
                        <div className={`font-display font-[800] text-4xl leading-none tracking-tight ${on ? 'text-white' : 'text-white/55'}`}>
                          {d === 'up' ? '▲ UP' : '▼ DOWN'}
                        </div>
                        <div className={`font-mono text-[10px] tracking-[0.06em] mt-3 ${on ? 'text-white/90' : 'text-white/35'}`}>{line}</div>
                      </button>
                    );
                  })}
                </div>

                {/* payout size — user-owned, chips ADD, never pre-decided */}
                <div className="max-w-xl">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Payout if you win</span>
                    <span className="font-mono text-[10px] text-gray-600">account: {fmt2(acctBalance)} DUSDC</span>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-2.5 transition-colors focus-within:border-vermilion/50">
                    <div className="flex items-center justify-between">
                      <input
                        inputMode="decimal" placeholder="0" value={payoutStr}
                        onChange={(e) => setPayoutStr(e.target.value.replace(/[^0-9.]/g, ''))}
                        className="w-full bg-transparent font-display text-2xl font-bold text-white outline-none placeholder:text-gray-600"
                      />
                      <span className="font-mono text-xs font-semibold text-gray-300 shrink-0">DUSDC</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-gray-500">Your stake is the entry cost below — smaller than the payout.</span>
                      <div className="flex gap-1.5">
                        {[1, 5].map((n) => (
                          <button key={n} onClick={() => addPayout(n)} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors">+{n}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {belowMinHard && (
                    <p className="font-mono text-[10px] text-vermilion mt-2">Protocol minimum: entry premium must be ≥ 1 DUSDC — raise the payout{lev > 1 ? ' or lower the leverage' : ''} (≈ 2 DUSDC payout at 1×).</p>
                  )}
                  {belowMinSoft && (
                    <p className="font-mono text-[10px] text-white/40 mt-2">Close to the 1 DUSDC protocol minimum — the exact premium is set on-chain and may reject this size.</p>
                  )}
                </div>

                {/* leverage */}
                <div className="max-w-xl">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-1.5">Leverage <span className="text-gray-600 normal-case tracking-normal">— native knockout</span></div>
                  <div className="flex gap-1.5 max-w-[16rem]">
                    {[1, 2, 3].map((v) => (
                      <button key={v} onClick={() => setLev(v)}
                        className={`flex-1 py-2 rounded font-mono text-[12px] border transition-colors ${lev === v ? 'border-vermilion text-vermilion bg-vermilion/[0.06]' : 'border-white/[0.08] text-white/50 hover:border-white/20'}`}>
                        {v}×
                      </button>
                    ))}
                  </div>
                  <p className="font-mono text-[10px] text-white/40 leading-relaxed mt-2 max-w-md">
                    Leverage finances part of your entry; a win pays quantity minus the financed floor; it can knock out.
                  </p>
                </div>
              </div>
            </Step>
          </div>

          {/* ══ right rail: the ticket ══ */}
          <aside className="lg:sticky lg:top-24">
            <div className="group relative border border-white/[0.1] bg-bg p-5">
              <Crosshairs />
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/[0.08]">
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40"><span className="text-vermilion">⊙</span> Ticket</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/30 tabular-nums">
                  {selected && msLeft != null ? fmtCountdown(msLeft) : '—'}
                </span>
              </div>

              <div className="space-y-2.5 font-mono text-[11px]">
                <TicketLine k="Market" v={selected ? `BTC · ${CADENCE_WORD[selected.cadence]}` : 'pick one'} dim={!selected} />
                <TicketLine
                  k="Call"
                  v={dir && strikeUsd != null ? `${dir.toUpperCase()} — ${dir === 'up' ? 'over' : 'under'} ${fmtUsd0(strikeUsd)}` : dir ? dir.toUpperCase() : 'up or down'}
                  dim={!dir}
                />
                <TicketLine k="Leverage" v={`${lev}×`} />
              </div>

              {/* the REAL quote when sized (dry-run of the exact mint); a WORKED EXAMPLE before
                  that — the page plays without a wallet, and nothing is pre-decided. */}
              {(() => {
                const exCost = (EST_PROB * 5) / lev;
                const exWin = 5 - EST_PROB * 5 * (1 - 1 / lev);
                const ghost = qty === 0;
                const live = quote != null && !ghost;
                const payLabel = live ? 'You pay now' : 'You pay now ≈';
                const winLabel = live ? 'If you win' : 'If you win ≈';
                return (
                  <>
                    <div className={`grid grid-cols-1 mt-4 border-y border-white/[0.08] divide-y divide-white/[0.06] ${ghost ? 'opacity-60' : ''}`}>
                      <TicketStat label={payLabel} value={ghost ? `${fmt2(exCost)} DUSDC` : live ? `${fmt2(quotedCost!)} DUSDC (max ${fmt2(quotedCost! * 1.1)})` : quoting ? 'quoting…' : `${fmt2(estCost)} DUSDC`} ghost={ghost} />
                      <TicketStat label={winLabel} value={ghost ? `${fmt2(exWin)} DUSDC` : live ? `${fmt2(quotedWin!)} DUSDC` : quoting ? 'quoting…' : `${fmt2(estWin)} DUSDC`} strong ghost={ghost} />
                      <TicketStat label="If you lose" value={ghost ? `${fmt2(exCost)} gone` : live ? `${fmt2(quotedCost!)} gone` : '—'} ghost={ghost} />
                      {live ? <TicketStat label="Entry probability" value={`${(quote!.entryProb * 100).toFixed(1)}%`} ghost={false} /> : null}
                    </div>
                    <p className="font-mono text-[9.5px] leading-relaxed text-white/35 mt-3">
                      {ghost
                        ? 'Example at a 5 DUSDC payout — type your own size above for a live quote.'
                        : live
                          ? 'Live venue quote, refreshed every 12s. You never pay more than the max — if the price moves past it while you sign, the bet safely rejects instead.'
                          : quoteErr
                            ? `Quote failed: ${quoteErr}`
                            : address
                              ? 'Quoting the live price…'
                              : 'Connect to see your live price.'}
                      {lev > 1 ? ' A win pays quantity minus the financed floor; the position can knock out before expiry.' : ''}
                    </p>
                  </>
                );
              })()}

              <button
                onClick={placeBet}
                disabled={!!blocker || busy === 'mint'}
                className={`mt-4 w-full py-3 text-sm font-semibold transition-all ${!blocker && busy !== 'mint' ? 'bg-vermilion text-white hover:bg-vermilion-d shadow-[0_6px_28px_-8px_var(--vermilion)]' : 'cursor-not-allowed bg-white/[0.06] text-gray-500'}`}
              >
                {busy === 'mint' ? 'Placing…' : blocker ?? `Place the bet →`}
              </button>

              <p className="font-mono text-[9.5px] leading-relaxed text-white/30 mt-3">
                Wallet-signed on testnet. Payouts land in YOUR trading account only.
              </p>
            </div>
          </aside>
        </div>

        {/* 04 — positions */}
        <section className="mt-16">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/40"><span className="text-vermilion">04</span> Positions</h2>
            <div className="h-px flex-1 bg-white/10" />
            <span className="font-mono text-[11px] text-white/30 tabular-nums">{openCount} open</span>
          </div>

          <div className="border border-white/[0.08] bg-bg divide-y divide-white/[0.05]">
            {!address ? (
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30 px-5 py-8 text-center">Connect a wallet to see your positions.</div>
            ) : openCount === 0 && history.length === 0 ? (
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30 px-5 py-8 text-center">No positions yet — your first call will appear here.</div>
            ) : (
              <>
                {pending.map((p, i) => (
                  <div key={`pending-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion animate-pulse">confirming…</span>
                    <span className="font-display font-[700] text-[13px] text-white">{p.dir === 'up' ? '▲ UP' : '▼ DOWN'} {p.dir === 'up' ? 'over' : 'under'} {fmtUsd0(p.strikeUsd)}</span>
                    <span className="flex-1" />
                    <span className="font-mono text-[11px] text-white/50 tabular-nums">{fmt2(p.qty)} DUSDC · {p.lev}×</span>
                  </div>
                ))}
                {positions.map((pos) => {
                  const st = mktStates[pos.marketId];
                  const expired = st ? now > 0 && now >= st.expiry : false;
                  const settled = !!st?.settled;
                  const settleUsd = st?.settlementUsd ?? null;
                  const won = settled && settleUsd != null && settleUsd * 100 >= pos.lowerTick && settleUsd * 100 < pos.higherTick;
                  const levX = pos.leverage1e9 / FLOAT_SCALING_624;
                  const claiming = busy === `claim:${pos.orderId}`;
                  const status = settled ? (won ? 'Settled · in range' : 'Settled · out of range') : expired ? 'Awaiting settle' : 'Open';
                  return (
                    <div key={`${pos.marketId}:${pos.orderId}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                      <span className={`font-mono text-[10px] uppercase tracking-[0.18em] w-40 shrink-0 ${settled ? 'text-white' : 'text-white/50'}`}>
                        {!settled && <span className="text-vermilion mr-1.5">●</span>}{status}
                      </span>
                      <span className="font-display font-[700] text-[13px] text-white">BTC {bandLabel(pos.lowerTick, pos.higherTick)}</span>
                      <span className="font-mono text-[10px] text-white/40">
                        {st && !settled && !expired && now > 0 ? `settles in ${fmtCountdown(st.expiry - now)}` : settled && settleUsd != null ? `settled at ${fmtUsd(settleUsd)}` : ''}
                      </span>
                      <span className="flex-1" />
                      <span className="font-mono text-[11px] text-white/70 tabular-nums">{fmt2(micro(pos.qtyMicro))} DUSDC</span>
                      <span className="font-mono text-[11px] text-white/40 tabular-nums w-8 text-right">{Number.isInteger(levX) ? levX : levX.toFixed(1)}×</span>
                      {settled ? (
                        <button
                          onClick={() => claim(pos)}
                          disabled={claiming}
                          className={`shrink-0 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] font-semibold transition-colors disabled:opacity-60 ${won ? 'bg-vermilion text-white hover:bg-vermilion-d' : 'border border-white/15 text-white/60 hover:border-white/30 hover:text-white'}`}
                        >
                          {claiming ? 'Claiming…' : won ? `Claim ≈ ${fmt2(micro(pos.qtyMicro) - micro(pos.netPremiumMicro) * (levX - 1))}` : 'Close · no payout'}
                        </button>
                      ) : (
                        <span className="font-mono text-[10px] text-white/30 w-24 text-right">{ago(pos.openedAtMs, now || pos.openedAtMs)}</span>
                      )}
                    </div>
                  );
                })}
                {history.map((h, i) => (
                  <div key={`h-${h.orderId}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 w-40 shrink-0">
                      {h.kind === 'settled_order_redeemed' ? 'Claimed' : h.kind === 'liquidated_order_redeemed' ? 'Knocked out' : 'Closed early'}
                    </span>
                    <span className="font-display font-[700] text-[13px] text-white/60 tabular-nums">
                      paid {h.payoutMicro != null ? fmt2(micro(h.payoutMicro)) : '—'} DUSDC
                    </span>
                    {h.settlementUsd != null && <span className="font-mono text-[10px] text-white/35">at {fmtUsd(h.settlementUsd)}</span>}
                    <span className="flex-1" />
                    <span className="font-mono text-[11px] text-white/30 tabular-nums">{now > 0 ? ago(h.tsMs, now) : ''}</span>
                    {h.digest && (
                      <a href={SUISCAN_TX(h.digest)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-vermilion hover:text-white transition-colors">↗</a>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* standing disclosure + the quiet door back to the previous testnet */}
        <p className="mt-10 font-mono text-[10px] leading-relaxed text-gray-600 max-w-2xl">
          Testnet DUSDC only. Markets are oracle-settled — no committee, no vote. You can lose your
          full stake; leveraged positions can knock out before expiry. Positions pay out to YOUR
          trading account only — verify every order on Sui.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/[0.05]" />
          <a href="/markets" className="font-mono text-[10px] text-gray-600 hover:text-gray-400 transition-colors" data-cursor="hover">
            Markets overview ↗
          </a>
        </div>

        <Footer />
      </main>
    </div>
  );
}

// ─── local shells (mirroring the /strategies design system) ───

function Step({ n, title, hint, children }: { n: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4">
        <span className="font-mono text-[11px] text-vermilion tabular-nums">{n}</span>
        <h2 className="font-display font-[700] text-[17px] text-white">{title}</h2>
        {hint ? <span className="font-mono text-[10px] text-white/30 hidden sm:block">— {hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function PanelCard({ children }: { children: ReactNode }) {
  return (
    <div className="group relative border border-white/[0.08] bg-white/[0.02] p-5">
      <Crosshairs />
      {children}
    </div>
  );
}

function Crosshairs() {
  const t = 'pointer-events-none absolute w-2 h-2 opacity-0 transition-all duration-200 group-hover:opacity-100';
  return (
    <>
      <span className={`${t} left-1.5 top-1.5 border-l border-t border-vermilion`} />
      <span className={`${t} right-1.5 top-1.5 border-r border-t border-vermilion`} />
      <span className={`${t} left-1.5 bottom-1.5 border-l border-b border-vermilion`} />
      <span className={`${t} right-1.5 bottom-1.5 border-r border-b border-vermilion`} />
    </>
  );
}

function LedgerStat({ label, value, divide }: { label: string; value: string; divide?: boolean }) {
  return (
    <div className={`px-3 py-3 ${divide ? 'border-l border-white/[0.06]' : ''}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">{label}</div>
      <div className="font-mono text-sm text-white tabular-nums">{value}</div>
    </div>
  );
}

function TicketLine({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="uppercase tracking-[0.18em] text-white/35 text-[9.5px]">{k}</span>
      <span className={`text-right tabular-nums ${dim ? 'text-white/30' : 'text-white'}`}>{v}</span>
    </div>
  );
}

function TicketStat({ label, value, strong, ghost }: { label: string; value: string; strong?: boolean; ghost?: boolean }) {
  return (
    <div className="flex items-baseline justify-between px-0.5 py-2.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/40">
        {label}{ghost ? <span className="ml-1.5 text-vermilion/70 normal-case tracking-normal">e.g.</span> : null}
      </span>
      <span className={`font-mono tabular-nums ${ghost ? 'text-white/45' : strong ? 'text-white text-[15px] font-semibold' : 'text-white/80 text-[13px]'} ${strong && !ghost ? '' : ''}`}>{value}</span>
    </div>
  );
}
