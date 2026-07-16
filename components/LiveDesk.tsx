'use client';

// ── The Live Desk — join/copy flow for yosuku_spike::vault624 (DeepBook Predict 6-24) ──
//
// One attested desk: the enclave agent trades subscribers' pooled-but-ledgered
// DUSDC under per-user hard caps. Deposits credit YOUR ledger entry; the
// agent has no funds-out path; settles force-credit the position owner;
// withdraw pays the sender only.
//
// UX law this component implements:
//   · ONE decision after "join?" — the amount. Guardrails are defaulted (editable).
//   · ONE signature to join — deposit + subscribe composed in a single PTB.
//   · No dead ends — a zero wallet gets the faucet inline, never a wall.
//   · The moment after — joining flips to a living "copying · watching" state.
//   · Decision-moment honesty — wins AND losses, right next to the button.
//
// TX PATH: sponsored-first via useSmartSubmit — the yosuku-vault-624 Onara policy
// allowlists vault624 deposit/withdraw/subscribe/cancel, so a zero-SUI wallet can
// join gas-free; falls back to wallet payment only on a sponsor-side decline.

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useCurrentAccount, useSignTransaction, ConnectButton } from '@mysten/dapp-kit';
import type { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/components/Toast';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import {
  fmtDusdc,
  ago,
  codenameFromAddress,
  glyphFromAddress,
  SUISCAN_TX,
  SUISCAN_ACC,
} from '@/lib/sui/strategyClient';
import {
  VAULT624,
  LEV_1X_624,
  buildVaultDeposit624,
  buildVaultWithdraw624,
  buildSubscribe624,
  buildCancel624,
  buildJoinDesk624,
  fetchLedger624,
  fetchSub624,
  fetchVaultTrades624,
  friendlyVault624Error,
  type Sub624,
  type VaultEvent624,
} from '@/lib/sui/vault624Client';
import { grpc } from '@/lib/sui/modernClients';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import EquitySparkline, { type EquityPoint } from '@/components/EquitySparkline';

const M = DUSDC_MULTIPLIER;
const DEFAULT_CAP = 2; // suggested per-fill guardrail — always user-editable
// Keeper floor: it can only place a trade when ledger/1.15 clears the on-chain 1.4 DUSDC min premium
// (≈ 1.61). Below this the keeper silently skips the subscriber forever, so we don't let them join under it.
const MIN_LEDGER = 1.7;

// ── dev-only forced states for design review (?desk-preview=fresh|joined) ──
// The NODE_ENV check is inlined at build time, so this whole branch is dead
// code in a production bundle — it CANNOT activate in prod. "joined" renders
// a real on-chain subscriber's state (reads are address-keyed simulations);
// "fresh" renders a zero-balance newcomer. Signing is blocked while previewing.
type Preview = 'fresh' | 'joined' | null;
const PREVIEW_JOINED_ADDR = '0x0099f97251af2d072fc492316ae30de3ab5639beb09073509d54bf49197513b4';
const PREVIEW_FRESH_ADDR = `0x${'ab'.repeat(32)}`;

export default function LiveDesk() {
  const account = useCurrentAccount();
  const { toast } = useToast();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const { submit } = useSmartSubmit();
  const { balance: walletMicro, coins: dusdcCoins, refresh: refreshWallet } = useDUSDCBalance();
  const walletDusdc = walletMicro / M;

  const [preview, setPreview] = useState<Preview>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return; // dev-only — compiled out of prod
    const v = new URLSearchParams(window.location.search).get('desk-preview');
    if (v === 'fresh' || v === 'joined') {
      setPreview(v);
      if (v === 'joined') setJoinedFlash({ digest: null });
    }
  }, []);
  const address = preview
    ? (preview === 'joined' ? PREVIEW_JOINED_ADDR : PREVIEW_FRESH_ADDR)
    : (account?.address ?? null);

  const deskName = codenameFromAddress(VAULT624.enclaveAgent);
  const deskGlyph = glyphFromAddress(VAULT624.enclaveAgent);
  const [deskImgFail, setDeskImgFail] = useState(false);
  const deskAvatarSrc = `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(VAULT624.enclaveAgent)}&backgroundColor=f4eee1&radius=12`;

  const [ledger, setLedger] = useState(0);
  const [sub, setSub] = useState<Sub624 | null>(null);
  const [feed, setFeed] = useState<VaultEvent624[]>([]);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [history, setHistory] = useState<VaultEvent624[]>([]); // full event history — the ALL-TIME record

  const [depositStr, setDepositStr] = useState('');   // ADDITIVE chips only — never pre-decided
  const [withdrawStr, setWithdrawStr] = useState('');
  const [capStr, setCapStr] = useState('');           // guardrail — empty, placeholder suggests 2
  const [levCap, setLevCap] = useState(1);            // leverage ceiling the agent may use: 1× | 2×
  const [showGuardrails, setShowGuardrails] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false); // pre-join footprint stays small until the user opts in
  const [manage, setManage] = useState<'add' | 'withdraw' | 'caps' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fauceting, setFauceting] = useState(false);
  const [joinedFlash, setJoinedFlash] = useState<{ digest: string | null } | null>(null);

  const submitTx = useCallback(async (build: () => Transaction): Promise<string> => {
    const { digest } = await submit(build); // sponsored-first; wallet fallback rebuilds via the factory
    return digest;
  }, [submit]);

  const refreshDesk = useCallback(async () => {
    try { setFeed(await fetchVaultTrades624(40)); } catch { /* next poll wins */ } finally { setFeedLoaded(true); }
  }, []);
  // the record is ALL-TIME, not a rolling window — walk the full event history (paginated),
  // on mount and then slowly; the 20s poll above stays light for the live feed rail.
  const refreshHistory = useCallback(async () => {
    try { setHistory(await fetchVaultTrades624(600)); } catch { /* keep the last good history */ }
  }, []);
  const refreshUser = useCallback(async () => {
    if (!address) { setLedger(0); setSub(null); return; }
    const [l, s] = await Promise.all([fetchLedger624(address), fetchSub624(address)]);
    setLedger(l); setSub(s);
  }, [address]);

  useEffect(() => { refreshDesk(); const id = setInterval(refreshDesk, 20_000); return () => clearInterval(id); }, [refreshDesk]);
  useEffect(() => { refreshHistory(); const id = setInterval(refreshHistory, 120_000); return () => clearInterval(id); }, [refreshHistory]);
  useEffect(() => { refreshUser(); const id = setInterval(refreshUser, 15_000); return () => clearInterval(id); }, [refreshUser]);

  // The app-wide faucet fires 'yosuku:credited' when it drips — pick the new
  // balance up immediately instead of waiting out the 30s poll.
  useEffect(() => {
    const onCredited = () => refreshWallet();
    window.addEventListener('yosuku:credited', onCredited);
    return () => window.removeEventListener('yosuku:credited', onCredited);
  }, [refreshWallet]);

  // After any tx: refresh now, then a short burst so the new state visibly lands.
  const burstTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { burstTimers.current.forEach(clearTimeout); }, []);
  const burst = useCallback(() => {
    refreshWallet(); refreshUser(); refreshDesk();
    burstTimers.current.forEach(clearTimeout);
    burstTimers.current = [2000, 5000, 10_000].map((t) =>
      setTimeout(() => { refreshUser(); refreshDesk(); }, t));
  }, [refreshWallet, refreshUser, refreshDesk]);

  // ── the desk's record, derived from on-chain events — losses counted, always ──
  // Also builds the equity curve: cumulative net P&L across settled trades,
  // oldest→newest, so the sparkline draws every win AND every drawdown.
  const stats = useMemo(() => {
    const src = history.length ? history : feed; // all-time once loaded; live feed as a warm-up
    const trades = src.filter((e) => e.kind === 'trade');
    const settles = src.filter((e) => e.kind === 'settle');
    const wins = settles.filter((s) => s.payoutMicro > 0).length;
    const losses = settles.length - wins;
    const byOrder = new Map(trades.filter((t) => t.orderId).map((t) => [t.orderId, t]));

    // Match each settle to its opening trade so a leg contributes payout − cost.
    // Order the matched legs oldest→newest for the curve (settle ts, then trade ts).
    const matchedLegs = settles
      .map((s) => {
        const t = s.orderId ? byOrder.get(s.orderId) : undefined;
        return t ? { deltaMicro: s.payoutMicro - t.costMicro, ts: s.ts || t.ts || 0 } : null;
      })
      .filter((x): x is { deltaMicro: number; ts: number } => x !== null)
      .sort((a, b) => a.ts - b.ts);

    let running = 0;
    const curve: EquityPoint[] = matchedLegs.map((leg) => {
      running += leg.deltaMicro;
      return { t: leg.ts, cum: running / M };
    });
    const netMicro = matchedLegs.reduce((a, l) => a + l.deltaMicro, 0);
    const matched = matchedLegs.length;

    const costs = trades.map((t) => t.costMicro).sort((a, b) => a - b);
    const typicalCost = (costs.length ? costs[Math.floor(costs.length / 2)] : 0) / M;
    const paid = settles.reduce((s, e) => s + e.payoutMicro, 0) / M;
    const copiers = new Set(trades.map((e) => e.user)).size;
    return { opened: trades.length, settled: settles.length, wins, losses, netMicro, matched, typicalCost, paid, copiers, curve };
  }, [feed, history]);

  // The last three SETTLED results, newest first — a tight strip, not a log.
  // Only settles carry a win/loss outcome, which is the one thing this strip says.
  const latest3 = useMemo(
    () => feed
      .filter((e) => e.kind === 'settle')
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 3),
    [feed],
  );

  const copying = !!sub?.active;
  const subCap = sub ? sub.maxMarginMicro / M : 0;
  const subLev = sub ? sub.maxLeverage1e9 / Number(LEV_1X_624) : 0;
  const capValue = (() => { const c = parseFloat(capStr.replace(',', '.')); return Number.isFinite(c) && c > 0 ? c : DEFAULT_CAP; })();
  const depositValue = (() => { const d = parseFloat(depositStr.replace(',', '.')); return Number.isFinite(d) && d > 0 ? d : 0; })();
  const effLedger = ledger + depositValue; // what the desk can actually trade with the moment you join
  const belowFloor = effLedger < MIN_LEDGER; // too little for the keeper to ever place a trade
  const addChip = (set: (fn: (s: string) => string) => void) => (n: number) =>
    set((s) => String(Math.max(0, (parseFloat(s || '0') || 0) + n)));
  const addDeposit = addChip(setDepositStr);

  // Underfunded truth-telling: "copying" while the desk can't afford you is a lie.
  const underfundedBalance = copying && stats.typicalCost > 0 && ledger < stats.typicalCost;
  const underfundedCap = copying && !underfundedBalance && stats.typicalCost > 0 && subCap < stats.typicalCost;

  // ── inline faucet: the no-funds path never dead-ends ──
  async function getTestUsdc() {
    if (!address || fauceting || preview) return;
    setFauceting(true);
    try {
      const r = await fetch('/api/faucet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && !d.error) {
        toast(`${d.amount ?? 2} DUSDC added to your wallet`, 'success');
        refreshWallet();
      } else {
        // rate-limited / empty — hand off to the full Add-funds panel, not a wall
        window.dispatchEvent(new Event('yosuku:open-funds'));
      }
    } catch {
      window.dispatchEvent(new Event('yosuku:open-funds'));
    } finally { setFauceting(false); }
  }

  // ── ONE signature: deposit + subscribe in a single PTB ──
  async function joinDesk() {
    if (!address || busy || preview) return;
    const amt = depositValue;
    if (amt <= 0 && ledger <= 0) { toast('Enter an amount to put on the desk', 'error'); return; }
    if (amt > walletDusdc) {
      toast(`Your wallet holds ${fmtDusdc(walletDusdc)} DUSDC — tap “Get free DUSDC” or lower the amount`, 'error');
      return;
    }
    setBusy('join');
    try {
      const digest = await submitTx(() => buildJoinDesk624({
        coinIds: dusdcCoins.map((c) => c.coinObjectId),
        amountMicro: BigInt(Math.floor(amt * M)),
        agent: VAULT624.enclaveAgent,
        maxMarginMicro: BigInt(Math.round(capValue * M)),
        maxLeverage1e9: BigInt(levCap) * LEV_1X_624,
      }));
      setJoinedFlash({ digest });
      setDepositStr(''); setCapStr(''); setShowGuardrails(false); setManage(null);
      burst();
    } catch (e) {
      toast(`Couldn't join: ${friendlyVault624Error(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally { setBusy(null); }
  }

  // ── post-join management (each its own small tx, never blocking the join) ──
  async function deposit() {
    if (!address || busy || preview) return;
    const amt = parseFloat(depositStr.replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) { toast('Enter an amount above 0', 'error'); return; }
    if (amt > walletDusdc) { toast(`Your wallet holds ${fmtDusdc(walletDusdc)} DUSDC`, 'error'); return; }
    if (dusdcCoins.length === 0) { toast('No DUSDC in this wallet yet — tap “Get free DUSDC”', 'error'); return; }
    setBusy('deposit');
    try {
      await submitTx(() => buildVaultDeposit624({
        coinIds: dusdcCoins.map((c) => c.coinObjectId),
        amountMicro: BigInt(Math.floor(amt * M)),
      }));
      toast(`Added ${fmtDusdc(amt)} DUSDC to your desk balance`, 'success');
      setDepositStr(''); setManage(null);
      burst();
    } catch (e) {
      toast(`Deposit failed: ${friendlyVault624Error(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally { setBusy(null); }
  }

  async function withdraw() {
    if (!address || busy || preview) return;
    const amt = parseFloat(withdrawStr.replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) { toast('Enter an amount above 0', 'error'); return; }
    if (amt > ledger + 0.000001) { toast(`Your desk balance is ${fmtDusdc(ledger)} DUSDC`, 'error'); return; }
    setBusy('withdraw');
    try {
      await submitTx(() => buildVaultWithdraw624({ amountMicro: BigInt(Math.floor(amt * M)) }));
      toast(`${fmtDusdc(amt)} DUSDC is back in your wallet`, 'success');
      setWithdrawStr(''); setManage(null);
      burst();
    } catch (e) {
      toast(`Withdraw failed: ${friendlyVault624Error(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally { setBusy(null); }
  }

  async function updateCaps() {
    if (!address || busy || preview) return;
    setBusy('caps');
    try {
      await submitTx(() => buildSubscribe624({
        agent: VAULT624.enclaveAgent,
        maxMarginMicro: BigInt(Math.round(capValue * M)),
        maxLeverage1e9: BigInt(levCap) * LEV_1X_624,
      }));
      toast(`Limits updated — at most ${fmtDusdc(capValue)} DUSDC per trade, ${levCap}×`, 'success');
      setCapStr(''); setManage(null);
      burst();
    } catch (e) {
      toast(`Couldn't update: ${friendlyVault624Error(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally { setBusy(null); }
  }

  async function resume() {
    if (!address || !sub || busy || preview) return;
    setBusy('resume');
    try {
      await submitTx(() => buildSubscribe624({
        agent: VAULT624.enclaveAgent,
        maxMarginMicro: BigInt(sub.maxMarginMicro),
        maxLeverage1e9: BigInt(sub.maxLeverage1e9),
      }));
      toast('Copying resumed — same limits as before', 'success');
      burst();
    } catch (e) {
      toast(`Couldn't resume: ${friendlyVault624Error(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally { setBusy(null); }
  }

  async function pause() {
    if (!address || busy || preview) return;
    setBusy('pause');
    try {
      await submitTx(() => buildCancel624());
      toast('Paused — no new trades. Your balance stays yours; withdraw anytime.', 'success');
      burst();
    } catch (e) {
      toast(`Pause failed: ${friendlyVault624Error(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally { setBusy(null); }
  }

  const chipCls = 'rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors';
  const manageChip = (key: 'add' | 'withdraw' | 'caps', label: string) => (
    <button key={key} onClick={() => setManage((m) => (m === key ? null : key))}
      className={`rounded-full border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
        manage === key ? 'border-vermilion text-vermilion bg-vermilion/[0.06]' : 'border-white/15 text-gray-300 hover:text-white hover:border-white/30'
      }`}>
      {label}
    </button>
  );

  // The inline faucet chip — rendered anywhere a zero wallet would otherwise dead-end.
  const faucetChip = (
    <button onClick={getTestUsdc} disabled={fauceting}
      className="whitespace-nowrap rounded-md border border-vermilion/50 bg-vermilion/[0.06] px-2.5 py-0.5 font-mono text-[10px] text-vermilion hover:bg-vermilion/[0.12] transition-colors disabled:opacity-60">
      {fauceting ? 'Sending…' : 'Get free DUSDC →'}
    </button>
  );

  const netUp = stats.netMicro >= 0;
  const netStr = `${netUp ? '+' : '−'}${fmtDusdc(Math.abs(stats.netMicro) / M)}`;

  // ── the record, as a curve + a tight trio — the striking honest visual ──
  // A cumulative-P&L sparkline (rises on wins, drops into drawdown on losses)
  // sitting over exactly three numbers: Won · Lost · Net. Losses are never hidden
  // — the curve draws them and the net can read negative in muted white.
  // When there's no settled record yet, show nothing here — an empty placeholder box + copy
  // just adds noise. The record appears once trades settle.
  const recordCard = stats.settled === 0 ? null : (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.015] overflow-hidden">
      {/* framing: young + public. The net can read negative — that's transparency, not spin. */}
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40">Track record</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">{stats.settled} trades · public</span>
      </div>
      <div className="px-4 pt-2 pb-2">
        <EquitySparkline points={stats.curve} width={520} height={64} className="w-full h-[64px]" />
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/[0.07] border-t border-white/[0.07]">
        <RecordStat label="Won" value={String(stats.wins)} />
        <RecordStat label="Lost" value={String(stats.losses)} />
        <RecordStat label="Net so far" value={netStr} accent={netUp ? 'up' : 'down'} />
      </div>
    </div>
  );

  return (
    <section className="mt-2 mb-4">

      <div className="group/desk relative rounded-xl border border-white/[0.1] bg-bg overflow-hidden">
        <div className="grid">
          {/* ── left: the hero card + join flow (min-w-0 stops the mobile grid blowout) ── */}
          <div className="p-6 sm:p-7 min-w-0">
            {/* hero identity — glyph · name · ONE attested chip · one line of what it does */}
            <div className="flex items-start gap-4">
              {deskImgFail ? (
                <div className="shrink-0 h-14 w-14 rounded-lg border border-vermilion/40 bg-vermilion/[0.07] flex items-center justify-center">
                  <span className="font-jp text-2xl text-vermilion leading-none">{deskGlyph}</span>
                </div>
              ) : (
                <div className="strat-sigil shrink-0 h-14 w-14">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={deskAvatarSrc} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setDeskImgFail(true)} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h3 className="font-display font-[800] text-[1.7rem] text-white tracking-tight leading-none">{deskName}</h3>
                  <span className="inline-flex items-center gap-1 rounded-full border border-vermilion/40 bg-vermilion/[0.06] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-vermilion">
                    ⊙ Autopilot
                  </span>
                </div>
                <p className="text-[13.5px] text-white/70 leading-snug mt-2 break-words">
                  An automated strategy that follows Bitcoin&apos;s trend, up or down.
                </p>
              </div>
            </div>

            {/* the record — a curve, not a log: the striking visual */}
            <div className="mt-6">{recordCard}</div>

            {!address ? (
              /* ── state: disconnected — small footprint, one CTA ── */
              <div className="mt-5">
                <ConnectButton />
                <p className="font-mono text-[10px] text-white/30 mt-3">Withdraw anytime · testnet · you can lose what you put on.</p>
              </div>
            ) : copying ? (
              /* ── state: COPYING — the living moment-after ── */
              <div className="pt-5 space-y-4">
                {joinedFlash && (
                  <div className="border border-vermilion/40 bg-vermilion/[0.05] px-4 py-3 relative">
                    <button onClick={() => setJoinedFlash(null)} aria-label="Dismiss"
                      className="absolute right-2 top-2 font-mono text-[11px] text-white/40 hover:text-white px-1.5 transition-colors">×</button>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1">⊙ You&apos;re on the desk</p>
                    <p className="text-[12.5px] text-white/80 leading-snug pr-6">
                      One signature did it. You&apos;re following {deskName} now — its next trade carries you.
                    </p>
                    {joinedFlash.digest && (
                      <a href={SUISCAN_TX(joinedFlash.digest)} target="_blank" rel="noreferrer"
                        className="mt-1.5 inline-block font-mono text-[10px] text-white/40 hover:text-white transition-colors">your join receipt ↗</a>
                    )}
                  </div>
                )}

                <div className="border-l-2 border-vermilion pl-3 py-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-vermilion mr-1.5 align-middle animate-pulse" />
                    Copying · watching Bitcoin
                  </span>
                </div>

                {/* your live numbers */}
                <div className="grid grid-cols-2 max-w-md border border-white/[0.08] bg-white/[0.02]">
                  <div className="px-3 py-3">
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">Your desk balance</div>
                    <div className="font-display font-[800] text-2xl text-white tabular-nums leading-none">{fmtDusdc(ledger)}</div>
                    <div className="font-mono text-[9px] text-white/30 mt-1">only you can withdraw</div>
                  </div>
                  <div className="px-3 py-3 border-l border-white/[0.06]">
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">Your limits</div>
                    <div className="font-mono text-sm text-white tabular-nums">≤ {fmtDusdc(subCap)} / trade</div>
                    <div className="font-mono text-[9px] text-white/30 mt-1">≤ {subLev}× · on-chain cap</div>
                  </div>
                </div>

                {/* truth-telling: "copying" while unaffordable is a lie — say so */}
                {underfundedCap && (
                  <div className="border border-white/15 bg-white/[0.02] px-4 py-3 max-w-md">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/60 mb-1">Your cap sits below recent trades</p>
                    <p className="text-[12px] text-white/60 leading-snug break-words">
                      Recent trades cost about {fmtDusdc(stats.typicalCost)} each; your limit is {fmtDusdc(subCap)} per trade —
                      anything above it skips you. Raise it if you want in on every trade.
                    </p>
                    <button onClick={() => setManage('caps')} className="mt-2 rounded-md border border-white/20 px-2.5 py-0.5 font-mono text-[10px] text-white/70 hover:text-white hover:border-white/40 transition-colors">Adjust limits →</button>
                  </div>
                )}

                {/* exit affordances — always one glance away */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {manageChip('add', '+ Add money')}
                  {manageChip('withdraw', 'Withdraw')}
                  {manageChip('caps', 'Limits')}
                  <button onClick={pause} disabled={busy === 'pause'}
                    className="rounded-full border border-white/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-gray-300 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50">
                    {busy === 'pause' ? 'Pausing…' : 'Pause'}
                  </button>
                </div>

                {manage === 'add' && (
                  <div className="max-w-md">
                    <AmountRow
                      value={depositStr} onChange={setDepositStr}
                      hint={<span>Wallet: {fmtDusdc(walletDusdc)} DUSDC{walletDusdc <= 0 ? <> · {faucetChip}</> : null}</span>}
                      chips={[1, 5]} onChip={addDeposit} chipCls={chipCls}
                      action={<button onClick={deposit} disabled={busy === 'deposit'} className={BTN_PRIMARY}>{busy === 'deposit' ? 'Adding…' : 'Add to desk →'}</button>}
                    />
                  </div>
                )}
                {manage === 'withdraw' && (
                  <div className="max-w-md">
                    <AmountRow
                      value={withdrawStr} onChange={setWithdrawStr}
                      hint={<span>Goes to your connected wallet — nobody else&apos;s.</span>}
                      chips={[]} onChip={() => {}} chipCls={chipCls}
                      extra={ledger > 0 ? <button onClick={() => setWithdrawStr(ledger.toFixed(2))} className={chipCls}>max</button> : null}
                      action={<button onClick={withdraw} disabled={busy === 'withdraw'} className={BTN_GHOST}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}</button>}
                    />
                  </div>
                )}
                {manage === 'caps' && (
                  <div className="max-w-md space-y-3">
                    <CapsEditor capStr={capStr} setCapStr={setCapStr} levCap={levCap} setLevCap={setLevCap} suggested={subCap || DEFAULT_CAP} />
                    <button onClick={updateCaps} disabled={busy === 'caps'} className={BTN_PRIMARY}>
                      {busy === 'caps' ? 'Signing…' : `Set limits — ≤ ${fmtDusdc(capValue)} / trade · ${levCap}×`}
                    </button>
                  </div>
                )}

              </div>
            ) : sub ? (
              /* ── state: PAUSED ── */
              <div className="pt-5 space-y-4">
                <div className="border-l-2 border-white/20 pl-3 py-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">Paused — no new trades</span>
                  <p className="font-mono text-[10px] text-white/40 mt-1 leading-relaxed">
                    Your {fmtDusdc(ledger)} DUSDC stays yours. Resume with one signature, or take it back below.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={resume} disabled={busy === 'resume'} className={BTN_PRIMARY}>
                    {busy === 'resume' ? 'Signing…' : `Resume copying — ≤ ${fmtDusdc(subCap)} / trade · ${subLev}×`}
                  </button>
                  {manageChip('withdraw', 'Withdraw')}
                  {manageChip('add', '+ Add money')}
                </div>
                {manage === 'withdraw' && (
                  <div className="max-w-md">
                    <AmountRow
                      value={withdrawStr} onChange={setWithdrawStr}
                      hint={<span>Goes to your connected wallet — nobody else&apos;s.</span>}
                      chips={[]} onChip={() => {}} chipCls={chipCls}
                      extra={ledger > 0 ? <button onClick={() => setWithdrawStr(ledger.toFixed(2))} className={chipCls}>max</button> : null}
                      action={<button onClick={withdraw} disabled={busy === 'withdraw'} className={BTN_GHOST}>{busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}</button>}
                    />
                  </div>
                )}
                {manage === 'add' && (
                  <div className="max-w-md">
                    <AmountRow
                      value={depositStr} onChange={setDepositStr}
                      hint={<span>Wallet: {fmtDusdc(walletDusdc)} DUSDC{walletDusdc <= 0 ? <> · {faucetChip}</> : null}</span>}
                      chips={[1, 5]} onChip={addDeposit} chipCls={chipCls}
                      action={<button onClick={deposit} disabled={busy === 'deposit'} className={BTN_PRIMARY}>{busy === 'deposit' ? 'Adding…' : 'Add to desk →'}</button>}
                    />
                  </div>
                )}
              </div>
            ) : !joinOpen ? (
              /* ── state: JOIN (collapsed) — one CTA, small footprint ── */
              <div className="mt-5">
                <button onClick={() => setJoinOpen(true)}
                  className="w-full sm:w-auto rounded-full bg-vermilion hover:bg-vermilion-d text-white text-[13px] font-semibold px-7 py-3 transition-colors">
                  Copy this strategy →
                </button>
              </div>
            ) : (
              /* ── state: JOIN (open) — one decision (the amount), one signature ── */
              <div className="mt-5 space-y-4">
                {/* the one decision — amount */}
                <div>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="font-display font-[700] text-[14px] text-white">How much goes on the desk?</span>
                    <button onClick={() => { setJoinOpen(false); setShowGuardrails(false); }}
                      className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/35 hover:text-white transition-colors">back</button>
                  </div>
                  <AmountRow
                    value={depositStr} onChange={setDepositStr}
                    hint={walletDusdc <= 0
                      ? <span className="inline-flex flex-wrap items-center gap-1.5">Wallet empty — no problem: {faucetChip}</span>
                      : <span>Wallet: {fmtDusdc(walletDusdc)} DUSDC — edit freely.</span>}
                    chips={[1, 5]} onChip={addDeposit} chipCls={chipCls}
                  />
                  {ledger > 0 && (
                    <p className="font-mono text-[10px] text-white/40 mt-2">
                      Already on the desk: {fmtDusdc(ledger)} — leave empty to copy with just that.
                    </p>
                  )}
                  {stats.typicalCost > 0 && (
                    <p className="font-mono text-[10px] text-white/30 mt-2 break-words">
                      Recent trades cost ~{fmtDusdc(stats.typicalCost)} each — put on at least that or the strategy skips you.
                    </p>
                  )}
                </div>

                {/* guardrails — defaulted safety, one quiet line + adjust */}
                <div className="text-[12.5px] text-white/60 leading-snug max-w-md break-words">
                  Risks at most <span className="text-white font-semibold">{fmtDusdc(capValue)} per trade</span> at{' '}
                  <span className="text-white font-semibold">{levCap}×</span>, enforced on-chain.{' '}
                  <button onClick={() => setShowGuardrails((v) => !v)}
                    className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40 hover:text-vermilion transition-colors underline decoration-white/20 underline-offset-2">
                    {showGuardrails ? 'done' : 'adjust limits'}
                  </button>
                  {showGuardrails && (
                    <div className="mt-3 max-w-md">
                      <CapsEditor capStr={capStr} setCapStr={setCapStr} levCap={levCap} setLevCap={setLevCap} suggested={DEFAULT_CAP} />
                    </div>
                  )}
                </div>

                {/* one CTA, one signature */}
                <div>
                  <button onClick={joinDesk} disabled={busy === 'join' || belowFloor}
                    className="w-full sm:w-auto rounded-full bg-vermilion hover:bg-vermilion-d text-white text-[13px] font-semibold px-6 py-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    {busy === 'join'
                      ? 'One signature…'
                      : belowFloor
                        ? `Put on at least ${fmtDusdc(MIN_LEDGER)} to copy`
                        : depositValue > 0
                          ? `Put ${fmtDusdc(depositValue)} on & copy →`
                          : `Copy with your ${fmtDusdc(ledger)} →`}
                  </button>
                  <p className="font-mono text-[10px] text-white/30 mt-2">
                    {belowFloor
                      ? `The desk needs about ${fmtDusdc(MIN_LEDGER)} DUSDC on it to place a trade — anything less gets skipped.`
                      : 'Deposit and copy-permission in one signature.'}
                  </p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

    </section>
  );
}

const BTN_PRIMARY = 'shrink-0 rounded-full bg-vermilion hover:bg-vermilion-d text-white text-[13px] font-semibold px-5 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
const BTN_GHOST = 'shrink-0 rounded-full border border-white/15 text-gray-200 hover:text-white hover:border-white/30 text-[13px] font-semibold px-5 py-2.5 transition-colors disabled:opacity-50';

// One amount input in the house style: big figure, unit tag, hint line, additive chips.
function AmountRow(props: {
  value: string;
  onChange: (s: string) => void;
  hint: React.ReactNode;
  chips: number[];
  onChip: (n: number) => void;
  chipCls: string;
  extra?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const { value, onChange, hint, chips, onChip, chipCls, extra, action } = props;
  return (
    <div className="flex flex-col sm:flex-row sm:items-stretch gap-3">
      <div className="flex-1 sm:max-w-xs min-w-0 rounded-xl border border-white/[0.08] bg-black/30 px-4 py-2 transition-colors focus-within:border-vermilion/50">
        <div className="flex items-center justify-between">
          <input
            inputMode="decimal" placeholder="0.00" value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full min-w-0 bg-transparent font-display text-xl font-bold text-white outline-none placeholder:text-gray-600"
          />
          <span className="font-mono text-[10px] font-semibold text-gray-300 shrink-0">USDC</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] text-gray-600 min-w-0">{hint}</span>
          <div className="flex gap-1.5 shrink-0">
            {chips.map((n) => (
              <button key={n} onClick={() => onChip(n)} className={chipCls}>+{n}</button>
            ))}
            {extra}
          </div>
        </div>
      </div>
      {action && <div className="self-start sm:self-center shrink-0">{action}</div>}
    </div>
  );
}

// The guardrail editor — suggested placeholder, user-owned value, plain-words leverage.
function CapsEditor(props: {
  capStr: string;
  setCapStr: (s: string) => void;
  levCap: number;
  setLevCap: (n: number) => void;
  suggested: number;
}) {
  const { capStr, setCapStr, levCap, setLevCap, suggested } = props;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Most it may risk per trade</span>
        <div className="w-44 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 transition-colors focus-within:border-vermilion/50 flex items-center justify-between">
          <input
            inputMode="decimal" placeholder={`${suggested} (suggested)`} value={capStr}
            onChange={(e) => setCapStr(e.target.value.replace(/[^0-9.]/g, ''))}
            className="w-full min-w-0 bg-transparent font-mono text-[13px] font-semibold text-white outline-none placeholder:text-gray-600"
          />
          <span className="font-mono text-[9px] text-gray-500 shrink-0 ml-1">USDC</span>
        </div>
      </label>
      <div>
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Multiplier</span>
        <div className="flex gap-1.5">
          {[1, 2].map((v) => (
            <button key={v} onClick={() => setLevCap(v)}
              className={`px-3 py-2 rounded font-mono text-[11px] border transition-colors ${levCap === v ? 'border-vermilion text-vermilion bg-vermilion/[0.06]' : 'border-white/[0.08] text-white/50 hover:border-white/20'}`}>
              {v === 1 ? '1× plain' : '2× doubled'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// One cell of the record trio under the sparkline — the honest 3-stat row.
// The Net figure is the most honesty-critical number on the page: a loss reads in
// muted white (never green, never alarm-red) — a fact, not a scare. A win reads in
// vermilion. Numbers are the loud element; the label sits small and quiet above.
function RecordStat({ label, value, accent }: { label: string; value: string; accent?: 'up' | 'down' }) {
  const valueTone = accent === 'up' ? 'text-vermilion' : accent === 'down' ? 'text-white/80' : 'text-white';
  return (
    <div className="px-4 py-3.5 min-w-0 text-center sm:text-left">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1.5 whitespace-normal">{label}</div>
      <div className={`font-display font-[800] text-[1.4rem] leading-none tabular-nums whitespace-normal break-words ${valueTone}`}>{value}</div>
    </div>
  );
}
