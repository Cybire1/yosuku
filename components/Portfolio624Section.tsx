'use client';

// Portfolio624Section — the "New venue" block at the TOP of /portfolio: the user's
// activity on the NEW DeepBook Predict (predict-testnet-6-24).
//
// Reads come EXCLUSIVELY from predict624Client: wrapper discovery (findWrapperId624)
// → inner account id (the indexer keys per-user feeds on the INNER account.account_id,
// NOT the wrapper object id) → stored balance + open positions + settled history from
// the beta indexer's /accounts/{account_id}/… routes. Claims build
// buildRedeemSettledTx, submitted sponsored-first via useSmartSubmit — the exact
// idiom of /beta, the founder-validated 6-24 surface: the Onara sponsor only
// allowlists old-deployment targets, so routing 6-24 txs through the sponsored path
// would cost the user a doomed extra signing popup.
//
// Everything below this section on /portfolio is the PREVIOUS venue (4-16) and stays
// untouched until cutover completes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAccount, useSignTransaction } from '@mysten/dapp-kit';
import type { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/components/Toast';
import SectionHeader from '@/components/SectionHeader';
import TradeReceipt from '@/components/TradeReceipt';
import ShareTradeButton from '@/components/ShareTradeButton';
import { joinSettledTrades, type SettledTrade } from '@/lib/sui/settledTrade';
import { readAccountCache, writeAccountCache } from '@/lib/sui/ticket624';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { fetchDUSDCHeldMicro, fetchDUSDCCoins } from '@/lib/sui/queries';
import CrossChainDeposit from '@/components/CrossChainDeposit';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import {
  POS_INF_TICK,
  FLOAT_SCALING_624,
  tickToUsd,
  findWrapperId624,
  fetchInnerAccountId624,
  fetchAccountBalance624,
  fetchAccountBalanceMicro624,
  fetchOpenPositions624,
  fetchAccountOrders624,
  fetchMarketState624,
  buildRedeemSettledTx,
  buildWithdrawTx,
  buildDepositTx,
  type Position624,
  type OrderRow624,
  type MarketState624,
} from '@/lib/sui/predict624Client';
import {
  fetchLedger624,
  fetchSub624,
  fetchVaultTrades624,
  type Sub624,
  type VaultEvent624,
} from '@/lib/sui/vault624Client';

const POS_INF = Number(POS_INF_TICK);
const HISTORY_ROWS = 8;
const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const SUISCAN_OBJ = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;

// ─── tiny formatters (local by design — this component has no old-deployment deps) ───

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

/** A settled position is a win when the oracle's close price landed inside its band. */
function isWonPos(pos: Position624, st?: MarketState624 | null): boolean {
  if (!st?.settled) return false;
  const u = st.settlementUsd;
  return u != null && u * 100 >= pos.lowerTick && u * 100 < pos.higherTick;
}

// ─── component ───

export default function Portfolio624Section() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { toast } = useToast();
  const { mutateAsync: signTransaction } = useSignTransaction();

  // clock — drives countdowns; 0 until mounted (avoids SSR hydration drift)
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [wrapperId, setWrapperId] = useState<string | null>(null);
  const [innerAccountId, setInnerAccountId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [acctBalance, setAcctBalance] = useState(0);
  const [positions, setPositions] = useState<Position624[]>([]);
  const [history, setHistory] = useState<OrderRow624[]>([]);
  const [orderRows, setOrderRows] = useState<OrderRow624[]>([]);
  const [mktStates, setMktStates] = useState<Record<string, MarketState624>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // trade receipts — joined mint+redeem pairs from the SAME order feed the history uses
  const settledTrades = useMemo(() => joinSettledTrades(orderRows), [orderRows]);
  const tradeByOrderId = useMemo(() => {
    const m = new Map<string, SettledTrade>();
    for (const t of settledTrades) if (!m.has(t.orderId)) m.set(t.orderId, t);
    return m;
  }, [settledTrades]);
  const [openReceipt, setOpenReceipt] = useState<SettledTrade | null>(null);
  // Open a receipt, resolving the oracle's TRUE second (= market expiry) for settled
  // trades — the order feed doesn't carry it, and the stamp must never present the
  // claim time as the oracle print. Opens instantly (honest "Claimed …" fallback),
  // upgrades in place once the market state lands.
  const openReceiptFor = useCallback((trade: SettledTrade) => {
    if (trade.kind === 'settled_order_redeemed' && trade.expiryMs == null) {
      const cached = mktStates[trade.marketId]?.expiry;
      if (cached) { setOpenReceipt({ ...trade, expiryMs: cached }); return; }
      setOpenReceipt(trade);
      fetchMarketState624(trade.marketId)
        .then((st) => {
          if (!st?.expiry) return;
          setOpenReceipt((cur) => (cur && cur.orderId === trade.orderId ? { ...cur, expiryMs: st.expiry } : cur));
        })
        .catch(() => { /* receipt stays in its honest "Claimed …" fallback */ });
      return;
    }
    setOpenReceipt(trade);
  }, [mktStates]);
  // set on a successful claim → auto-opens the receipt once the redeemed row lands
  const pendingReceiptRef = useRef<string | null>(null);
  useEffect(() => {
    const pending = pendingReceiptRef.current;
    if (!pending) return;
    const t = tradeByOrderId.get(pending);
    if (t) { pendingReceiptRef.current = null; openReceiptFor(t); }
  }, [tradeByOrderId, openReceiptFor]);

  // copy-trading desk (vault624) — independent of the personal wrapper: the desk
  // holds its own object-owned account, users only have a ledger entry + sub
  const [walletDusdc, setWalletDusdc] = useState(0);
  const [depositAmt, setDepositAmt] = useState('1');
  const [deskLedger, setDeskLedger] = useState(0);
  const [deskSub, setDeskSub] = useState<Sub624 | null>(null);
  const [deskRows, setDeskRows] = useState<VaultEvent624[]>([]);

  // sponsored-first — yosuku-trading-624 allowlists redeem_settled, so claims are gas-free
  const { submit } = useSmartSubmit();
  const submitTx = useCallback(
    async (build: () => Transaction): Promise<string> => {
      if (!address) throw new Error('Connect a wallet first');
      const { digest } = await submit(build);
      return digest;
    },
    [address, submit],
  );

  const refreshBalance = useCallback(async (wid?: string | null) => {
    const id = wid ?? wrapperId;
    if (!id) return;
    try { const b = await fetchAccountBalance624(id); if (b != null) setAcctBalance(b); } catch { /* keep last good */ }
  }, [wrapperId]);

  const loadPositions = useCallback(async (acctId?: string | null) => {
    const id = acctId ?? innerAccountId;
    if (!id) return;
    try {
      const [open, orders] = await Promise.all([fetchOpenPositions624(id), fetchAccountOrders624(id, 30)]);
      setPositions(open);
      setOrderRows(orders);
      setHistory(orders.filter((o) => o.kind.endsWith('_redeemed')).slice(0, HISTORY_ROWS));
      const ids = Array.from(new Set(open.map((p) => p.marketId)));
      const states = await Promise.all(ids.map((m) => fetchMarketState624(m).catch(() => null)));
      const map: Record<string, MarketState624> = {};
      ids.forEach((m, i) => { const s = states[i]; if (s) map[m] = s; });
      setMktStates(map);
    } catch { /* transient indexer hiccup — next poll wins */ }
  }, [innerAccountId]);

  // account discovery on connect
  useEffect(() => {
    let live = true;
    setWrapperId(null); setInnerAccountId(null); setChecked(false);
    setAcctBalance(0); setPositions([]); setHistory([]); setOrderRows([]); setMktStates({});
    setOpenReceipt(null); pendingReceiptRef.current = null;
    if (!address) { setChecked(true); return; }
    (async () => {
      try {
        // Reuse the ids the header already resolved (they are deterministic and permanent), so
        // /portfolio stops running a SECOND full discovery waterfall on every load.
        const hit = readAccountCache(address);
        if (hit) {
          setWrapperId(hit.wrapperId);
          setInnerAccountId(hit.innerAccountId);
          refreshBalance(hit.wrapperId);
          if (hit.innerAccountId) loadPositions(hit.innerAccountId);
          if (hit.innerAccountId) return;
        }
        const wid = hit?.wrapperId ?? (await findWrapperId624(address));
        if (!live) return;
        setWrapperId(wid);
        if (wid) {
          const inner = await fetchInnerAccountId624(wid);
          if (!live) return;
          setInnerAccountId(inner);
          writeAccountCache(address, { wrapperId: wid, innerAccountId: inner });
          refreshBalance(wid);
          if (inner) loadPositions(inner);
        }
      } finally { if (live) setChecked(true); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // copy-trading desk footprint: ledger + sub + this user's recent desk events
  const loadDesk = useCallback(async (addr: string) => {
    try {
      const [ledger, sub, rows] = await Promise.all([
        fetchLedger624(addr),
        fetchSub624(addr),
        fetchVaultTrades624(40),
      ]);
      setDeskLedger(ledger);
      setDeskSub(sub);
      const mine = addr.toLowerCase();
      setDeskRows(rows.filter((r) => r.user.toLowerCase() === mine && (r.kind === 'trade' || r.kind === 'settle')).slice(0, 4));
    } catch { /* transient read failure — next poll wins */ }
  }, []);

  useEffect(() => {
    setDeskLedger(0); setDeskSub(null); setDeskRows([]);
    if (!address) return;
    loadDesk(address);
    const id = setInterval(() => loadDesk(address), 20_000);
    return () => clearInterval(id);
  }, [address, loadDesk]);

  // steady polls once the account exists
  useEffect(() => {
    if (!wrapperId) return;
    const id = setInterval(() => refreshBalance(), 15_000);
    return () => clearInterval(id);
  }, [wrapperId, refreshBalance]);
  useEffect(() => {
    if (!innerAccountId) return;
    const id = setInterval(() => loadPositions(), 12_000);
    return () => clearInterval(id);
  }, [innerAccountId, loadPositions]);

  async function claim(pos: Position624) {
    if (!wrapperId || busy) return;
    setBusy(`claim:${pos.orderId}`);
    try {
      await submitTx(() => buildRedeemSettledTx({
        marketId: pos.marketId,
        wrapperId,
        orderId: BigInt(pos.orderId),
        qty: pos.qtyMicro,
      }));
      toast('Position redeemed — payout landed in your trading account', 'success');
      // auto-open the receipt once the redeemed row shows up in the order feed
      // (satisfied by the loadPositions() below or the steady 12s poll — no extra timers)
      pendingReceiptRef.current = pos.orderId;
      refreshBalance();
      loadPositions();
    } catch (e) {
      // F6: translate the known aborts instead of dumping raw Move errors on the user.
      const raw = String(e instanceof Error ? e.message : e);
      const friendly = /not.?settled|assert_settled|ENotSettled/i.test(raw)
        ? 'This round hasn’t settled yet — try again at close.'
        : /order|position.*not.*found|EOrderNotFound|already/i.test(raw)
          ? 'Already paid out — the auto-payout got here first.'
          : `Claim failed: ${raw.slice(0, 140)}`;
      toast(friendly, 'error');
    } finally { setBusy(null); }
  }

  // B3: the money's way OUT — trading account → wallet, right where the balance shows.
  async function withdrawToWallet() {
    if (!wrapperId || !address || busy) return;
    setBusy('withdraw');
    try {
      // Withdraw the EXACT current on-chain DUSDC balance, re-read at click time as
      // an integer (never the polled float, which can be stale/high). withdraw_funds
      // only checks stored >= amount and allows draining to exactly the stored value,
      // so an exact-integer amount clears regardless of open/settled positions.
      const amountMicro = await fetchAccountBalanceMicro624(wrapperId);
      if (amountMicro == null) {
        // read failed — never guess an amount here, an over-read aborts EBalanceTooLow
        toast('Could not read your balance just now. Try again in a moment.', 'error');
        return;
      }
      if (amountMicro <= BigInt(0)) {
        toast('Nothing to withdraw right now.', 'error');
        return;
      }
      await submitTx(() => buildWithdrawTx({ wrapperId, amountMicro, recipient: address }));
      toast(`${fmt2(micro(amountMicro))} DUSDC returned to your wallet`, 'success');
      refreshBalance();
    } catch (e) {
      // Translate the known abort instead of dumping a raw Move error (matches claim()).
      const raw = String(e instanceof Error ? e.message : e);
      const friendly = /EBalanceTooLow|::account::withdraw|MoveAbort[^)]*\b1\)/i.test(raw)
        ? 'Your balance just moved — reopen and try again; the amount refreshes to what’s actually there.'
        : /InsufficientGas|no valid gas|sponsor|budget/i.test(raw)
          ? 'The gas sponsor is busy — try again in a moment.'
          : `Withdraw failed: ${raw.slice(0, 120)}`;
      toast(friendly, 'error');
    } finally { setBusy(null); }
  }

  // settled wins the permissionless keeper is auto-collecting (verified live: it
  // redeem_settled's every winner ~every 2 min). Not "claimable chores" — money on its way.
  useEffect(() => {
    if (!address) { setWalletDusdc(0); return; }
    let dead = false;
    const read = async () => {
      try {
        const micro = await fetchDUSDCHeldMicro(address);
        if (!dead) setWalletDusdc(Number(micro) / 1_000_000);
      } catch { /* keep the last good number rather than flashing zero */ }
    };
    void read();
    const id = setInterval(read, 15_000);
    return () => { dead = true; clearInterval(id); };
  }, [address, busy]);

  // Money IN, next to the balance it lands in. Withdraw already lived here; deposit did not, so
  // the only way to fund the account you actually bet from was to start a bet.
  const depositToAccount = async () => {
    if (!address || !wrapperId || busy) return;
    const amt = Number(depositAmt);
    if (!Number.isFinite(amt) || amt <= 0) { toast('Enter an amount to deposit.', 'error'); return; }
    const amountMicro = BigInt(Math.round(amt * 1_000_000));
    setBusy('deposit');
    try {
      const coins = await fetchDUSDCCoins(null as never, address);
      if (!coins.length) throw new Error('No DUSDC in your wallet yet.');
      await submitTx(() => buildDepositTx({
        wrapperId,
        coinIds: coins.map((c) => c.coinObjectId),
        amountMicro,
      }));
      toast(`Deposited ${amt.toFixed(2)} DUSDC.`, 'success');
      refreshBalance();
    } catch (e) {
      toast(e instanceof Error ? e.message.slice(0, 140) : 'Deposit failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const autoPaying = positions.filter((p) => isWonPos(p, mktStates[p.marketId])).length;
  // "Open" = not yet settled. Settled-but-uncleared positions (lost, awaiting Close) must not
  // inflate the open count — they are shown in the list but are not open.
  const openCount = positions.filter((p) => !mktStates[p.marketId]?.settled).length;
  const hasDesk = deskLedger > 0 || deskSub != null || deskRows.length > 0;

  return (
    <section>
      <div className="group relative border border-white/[0.08] rounded bg-bg">
        <Crosshairs />

        {!checked ? (
          <>
            {/* skeleton mirrors the real balance strip — structure is instant, only the numbers load in */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-white/[0.06]">
              {['Trading account', 'Open positions', 'Auto-paying', 'Account'].map((label, i) => (
                <div key={label} className={`px-4 py-3.5 ${i > 0 ? 'border-l border-white/[0.06]' : ''} ${i === 3 ? 'hidden sm:block' : ''}`}>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1.5">{label}</div>
                  <div className="h-5 w-20 rounded bg-white/[0.06] animate-pulse" />
                </div>
              ))}
            </div>
            <div className="divide-y divide-white/[0.04]">
              {[0, 1].map((i) => (
                <div key={i} className="px-4 py-4 flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="h-3.5 w-40 rounded bg-white/[0.06] animate-pulse" />
                    <div className="h-2.5 w-24 rounded bg-white/[0.04] animate-pulse" />
                  </div>
                  <div className="h-6 w-16 rounded bg-white/[0.05] animate-pulse" />
                </div>
              ))}
            </div>
          </>
        ) : !wrapperId ? (
          // No trading account yet. Deposit still belongs here: cross-chain USDC lands in your
          // WALLET, not the account, so it needs no wrapper, and it is exactly what someone with
          // no balance is here to do. Hiding it until an account exists put the one useful action
          // behind the thing it helps you get.
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6">
            <a
              href="/beta"
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-vermilion hover:text-white transition-colors"
              data-cursor="hover"
            >
              Set it up on the beta wing →
            </a>
            <CrossChainDeposit />
          </div>
        ) : (
          <>
            {/* The account plate. Ported from the old-version card, which was the better piece of
                design: one big number, the wallet total under it, the breakdown on one line, and
                money in/out on the same row. The live account had a four-cell strip with no way to
                add money at all, so funding meant starting a bet. Same layout, live numbers. */}
            <div className="ledger-plate">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4 sm:mb-6">
                <div>
                  <span className="font-mono text-[9px] tracking-[0.16em] uppercase" style={{ color: '#6B6353' }}>
                    Your balance
                  </span>
                  {/* Page-headline size. This is what someone opened Portfolio to see. */}
                  <div className="font-display text-[34px] sm:text-6xl font-[800] tracking-tight tabular-nums mt-1" style={{ color: '#1A1612' }}>
                    {fmt2(acctBalance)}
                    <span className="font-mono text-xs sm:text-lg font-normal ml-1.5 sm:ml-2" style={{ color: '#6B6353' }}>DUSDC</span>
                  </div>
                  <p className="font-mono text-[10px] mt-1.5" style={{ color: '#6B6353' }}>
                    {fmt2(acctBalance + walletDusdc)} total with your wallet
                  </p>
                </div>
                <CrossChainDeposit />
              </div>

              <div
                className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-6 pt-4 sm:gap-y-4 sm:pt-5"
                style={{ borderTop: '1px solid rgba(201,191,166,0.3)' }}
              >
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Wallet</span>
                  <div className="font-mono text-sm" style={{ color: '#1A1612' }}>{fmt2(walletDusdc)}</div>
                </div>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Open</span>
                  <div className="font-mono text-sm" style={{ color: '#1A1612' }}>{openCount}</div>
                </div>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Paying out</span>
                  <div className="font-mono text-sm" style={{ color: autoPaying > 0 ? '#059669' : '#1A1612' }}>{autoPaying}</div>
                </div>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Account</span>
                  <a
                    href={SUISCAN_OBJ(wrapperId)}
                    target="_blank"
                    rel="noreferrer"
                    data-cursor="hover"
                    className="font-mono text-sm hover:underline"
                    style={{ color: '#1A1612' }}
                  >
                    {fmtAddr(wrapperId)} ↗
                  </a>
                </div>
              </div>

              <div className="mt-4 pt-4 sm:mt-6 sm:pt-5" style={{ borderTop: '1px solid rgba(201,191,166,0.3)' }}>
                {/* Just the controls. The label repeated the balance heading directly above it and
                    the sentence explained a Deposit/Withdraw pair that needs no explaining. */}
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-end">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input
                      value={depositAmt}
                      onChange={(e) => setDepositAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                      inputMode="decimal"
                      aria-label="Amount to deposit"
                      className="w-full sm:w-28 rounded-lg px-3 py-2 font-mono text-sm outline-none"
                      style={{ background: '#FFFDF8', border: '1px solid rgba(201,191,166,0.6)', color: '#1A1612' }}
                    />
                    <button
                      onClick={depositToAccount}
                      disabled={busy !== null || !wrapperId}
                      data-cursor="hover"
                      className="rounded-lg px-5 py-2 font-display text-[12px] font-bold uppercase tracking-[0.1em] transition-opacity disabled:opacity-40"
                      style={{ background: '#1A1612', color: '#FBF7EE' }}
                    >
                      {busy === 'deposit' ? 'Depositing' : 'Deposit'}
                    </button>
                    <button
                      onClick={withdrawToWallet}
                      disabled={busy !== null || acctBalance <= 0}
                      data-cursor="hover"
                      className="rounded-lg px-5 py-2 font-display text-[12px] font-bold uppercase tracking-[0.1em] transition-opacity disabled:opacity-40"
                      style={{ background: 'transparent', border: '1px solid rgba(201,191,166,0.7)', color: '#1A1612' }}
                    >
                      {busy === 'withdraw' ? 'Withdrawing' : 'Withdraw'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* open positions with countdown / claim states */}
            <div className="divide-y divide-white/[0.05]">
              {positions.length === 0 && history.length === 0 ? (
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30 px-5 py-8 text-center">
                  No bets here yet —{' '}
                  <a href="/beta" className="text-vermilion hover:text-white transition-colors normal-case tracking-normal">make your first call →</a>
                </div>
              ) : (
                <>
                  {positions.map((pos) => {
                    const st = mktStates[pos.marketId];
                    const expired = st ? now > 0 && now >= st.expiry : false;
                    const settled = !!st?.settled;
                    const won = isWonPos(pos, st);
                    const levX = pos.leverage1e9 / FLOAT_SCALING_624;
                    const claiming = busy === `claim:${pos.orderId}`;
                    const payout = fmt2(micro(pos.qtyMicro) - micro(pos.netPremiumMicro) * (levX - 1));
                    const status = settled ? (won ? 'Won · paying out' : 'Settled · no payout') : expired ? 'Awaiting settle' : 'Open';
                    return (
                      <div key={`${pos.marketId}:${pos.orderId}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                        <span className={`font-mono text-[10px] uppercase tracking-[0.18em] w-40 shrink-0 ${settled ? 'text-white' : 'text-white/50'}`}>
                          {!settled && <span className="text-vermilion mr-1.5">●</span>}{status}
                        </span>
                        <span className="font-display font-[700] text-[13px] text-white">BTC {bandLabel(pos.lowerTick, pos.higherTick)}</span>
                        {st && !settled && !expired && now > 0 && (
                          <span className="font-mono text-[10px] text-white/40">settles in {fmtCountdown(st.expiry - now)}</span>
                        )}
                        <span className="flex-1" />
                        <span className="font-mono text-[11px] text-white/70 tabular-nums">{fmt2(micro(pos.qtyMicro))} DUSDC</span>
                        <span className="font-mono text-[11px] text-white/40 tabular-nums w-8 text-right">{Number.isInteger(levX) ? levX : levX.toFixed(1)}×</span>
                        {settled ? (
                          won ? (
                            // Winners are auto-collected by the keeper — show the payout as on-its-way,
                            // with a quiet manual "collect now" for the impatient (or if the keeper lags).
                            <span className="shrink-0 flex items-center gap-2.5">
                              <span className="font-mono text-[11px] text-profit tabular-nums">won ≈ {payout}</span>
                              <button
                                onClick={() => claim(pos)}
                                disabled={claiming}
                                title="Winners are paid out automatically — this just collects it instantly"
                                className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40 hover:text-vermilion transition-colors disabled:opacity-60"
                              >
                                {claiming ? 'collecting…' : 'collect now'}
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => claim(pos)}
                              disabled={claiming}
                              className="shrink-0 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] font-semibold border border-white/15 text-white/60 hover:border-white/30 hover:text-white transition-colors disabled:opacity-60"
                            >
                              {claiming ? 'clearing…' : 'Close · no payout'}
                            </button>
                          )
                        ) : (
                          <span className="font-mono text-[10px] text-white/30 w-24 text-right">{ago(pos.openedAtMs, now || pos.openedAtMs)}</span>
                        )}
                      </div>
                    );
                  })}

                  {/* settled history — payouts + receipts + Suiscan links */}
                  {history.map((h, i) => {
                    const receipt = h.orderId ? tradeByOrderId.get(h.orderId) : undefined;
                    return (
                      <div key={`h-${h.orderId}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 w-40 shrink-0">
                          {h.kind === 'settled_order_redeemed' ? 'Claimed' : h.kind === 'liquidated_order_redeemed' ? 'Knocked out' : 'Closed early'}
                        </span>
                        <span className="font-display font-[700] text-[13px] text-white/60 tabular-nums">
                          paid {h.payoutMicro != null ? fmt2(micro(h.payoutMicro)) : '—'} DUSDC
                        </span>
                        <span className="flex-1" />
                        <span className="font-mono text-[11px] text-white/30 tabular-nums">{now > 0 ? ago(h.tsMs, now) : ''}</span>
                        {receipt && (
                          <button
                            onClick={() => openReceiptFor(receipt)}
                            data-cursor="hover"
                            className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40 hover:text-vermilion transition-colors"
                          >
                            Receipt ↗
                          </button>
                        )}
                        {h.digest && (
                          <a href={SUISCAN_TX(h.digest)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-vermilion hover:text-white transition-colors">↗</a>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

          </>
        )}
      </div>

      {/* copy-trading desk line (vault624) — only when the user has a footprint */}
      {hasDesk && (
        <div className="group relative border border-white/[0.08] rounded bg-bg mt-3">
          <Crosshairs />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 border-b border-white/[0.06]">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion">Copy-trading desk</span>
            <span className="font-mono text-[11px] text-white tabular-nums">ledger {fmt2(deskLedger)} DUSDC</span>
            {deskSub && (
              <span className="font-mono text-[10px] text-white/40">
                {deskSub.active
                  ? `agent ${fmtAddr(deskSub.agent)} · caps ${fmt2(deskSub.maxMarginMicro / DUSDC_MULTIPLIER)} DUSDC / ${(deskSub.maxLeverage1e9 / FLOAT_SCALING_624).toFixed(0)}× per trade`
                  : 'subscription paused'}
              </span>
            )}
            <span className="flex-1" />
            <a href="/strategies" className="font-mono text-[10px] uppercase tracking-[0.14em] text-vermilion hover:text-white transition-colors" data-cursor="hover">
              Manage →
            </a>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {deskRows.length === 0 ? (
              <div className="font-mono text-[10px] text-white/30 px-5 py-3">No desk trades for your address yet — the agent trades within your caps only.</div>
            ) : (
              deskRows.map((r, i) => (
                <div key={`d-${r.orderId ?? r.digest}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 hover:bg-white/[0.02] transition-colors">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 w-40 shrink-0">
                    {r.kind === 'trade' ? 'Agent traded' : 'Desk settled'}
                  </span>
                  <span className="font-display font-[700] text-[13px] text-white/60 tabular-nums">
                    {r.kind === 'trade'
                      ? `cost ${fmt2(r.costMicro / DUSDC_MULTIPLIER)} DUSDC`
                      : `paid ${fmt2(r.payoutMicro / DUSDC_MULTIPLIER)} DUSDC`}
                  </span>
                  {r.kind === 'trade' && r.leverage1e9 > 0 && (
                    <span className="font-mono text-[10px] text-white/35">{(r.leverage1e9 / FLOAT_SCALING_624).toFixed(0)}× · pays up to {fmt2(r.qtyMicro / DUSDC_MULTIPLIER)}</span>
                  )}
                  <span className="flex-1" />
                  <span className="font-mono text-[11px] text-white/30 tabular-nums">{r.ts > 0 && now > 0 ? ago(r.ts, now) : ''}</span>
                  {r.digest && (
                    <a href={SUISCAN_TX(r.digest)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-vermilion hover:text-white transition-colors">↗</a>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* trade receipt modal — one open receipt at a time; the component owns overlay/Esc/scroll-lock */}
      {openReceipt && (
        <TradeReceipt
          trade={openReceipt}
          onClose={() => setOpenReceipt(null)}
          shareSlot={<ShareTradeButton trade={openReceipt} />}
        />
      )}
    </section>
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
