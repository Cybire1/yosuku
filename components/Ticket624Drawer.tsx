'use client';

// Ticket drawer for the 6-24 venue — the slide-over bet flow behind /markets.
// Same idiom as the /strategies copy drawer (slide-over, Esc, scroll lock);
// same MACHINERY as /markets-live (shared lib/sui/ticket624): account setup,
// inline deposit, REAL dry-run quote refreshed every 12s, fresh-quote-at-click
// ×1.10 cost guard, friendly abort toasts. The tapped side arrives preselected —
// the user's tap IS the choice. The amount is always theirs: empty + additive chips.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ConnectButton } from '@mysten/dapp-kit';
import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import { drawPriceLine } from '@/lib/charts/canvasChart';
import { useToast } from '@/components/Toast';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { type Market624 } from '@/lib/sui/predict624Client';
import {
  BAND_USD,
  EST_PROB,
  MIN_MINT_MS,
  MIN_STAKE,
  RANGE_CENTER_MAX,
  RANGE_PRESETS,
  friendlyMintAbort,
  placeMint624,
  placeRangeMint624,
  qtyForStake,
  strike624,
  useAccount624,
  useMintQuote624,
  winForQty,
  type Dir624,
  type RangePresetKey,
} from '@/lib/sui/ticket624';

// A ±$30 band is trivial on a 1-minute market but a real call on 1h — BTC's
// expected move scales with the window. Scale the preset widths per cadence.
const CADENCE_BAND_FACTOR: Record<Market624['cadence'], number> = { '1m': 0.5, '5m': 1, '1h': 4 };

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;

const CADENCE_WORD: Record<Market624['cadence'], string> = { '1m': '1-minute', '5m': '5-minute', '1h': '1-hour' };

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'settling';
  const m = Math.floor(msLeft / 60_000);
  const s = Math.floor((msLeft % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

type BetMode = 'dir' | 'range';

interface Placed {
  digest: string;
  kind: BetMode;
  dir?: Dir624;
  strikeUsd?: number;
  lowerUsd?: number;
  higherUsd?: number;
  qty: number;
  lev: number;
  costDusdc: number;
  expiry: number;
}

export default function Ticket624Drawer({
  market,
  side,
  sessionId,
  spot,
  series,
  mobileOpen = false,
  onClose,
}: {
  market: Market624 | null;
  /** Preselected by the tap on the card — null when the card body was tapped. */
  side: Dir624 | null;
  /** Changes only when the user explicitly opens a new ticket. */
  sessionId: number | null;
  spot: number | null;
  /** Live price series (same feed as the page charts) — drawn inside the ticket. */
  series: number[];
  /** Mobile slide-in open state. On desktop the rail is ALWAYS docked/visible. */
  mobileOpen?: boolean;
  onClose: () => void;
}) {
  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const rangeTrackRef = useRef<HTMLDivElement | null>(null);
  const rangeDragRef = useRef<{ pointerId: number; startX: number; startOffset: number; usdPerPx: number } | null>(null);
  const { toast } = useToast();
  const acct = useAccount624();
  const { address, wrapperId, wrapperChecked, acctBalance } = acct;

  const [dir, setDir] = useState<Dir624 | null>(side);
  const [mode, setMode] = useState<BetMode>('dir'); // Up/Down vs Range band
  const [preset, setPreset] = useState<RangePresetKey>('medium'); // band width tier (scaled per cadence)
  const [centerOffset, setCenterOffset] = useState<number>(0);     // band center vs spot
  const [rangeDragging, setRangeDragging] = useState(false);
  const [stakeStr, setStakeStr] = useState(''); // what you BET (the amount you pay) — user-owned
  const [lev, setLev] = useState(1);
  const [fundStr, setFundStr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  // clock for the countdown
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!market) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [market]);

  // Fresh ticket on an explicit card tap. A same-session market rollover must
  // preserve the side, amount, leverage, and mode the user already entered.
  useEffect(() => {
    if (!market || sessionId == null) return;
    setDir(side);
    setMode('dir');
    setPreset('medium');
    setCenterOffset(0);
    setRangeDragging(false);
    rangeDragRef.current = null;
    setStakeStr('');
    setFundStr('');
    setLev(1);
    setPlaced(null);
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes. No body scroll lock / backdrop — the ticket is a DOCKED panel so
  // the charts and the rest of the page stay visible while you set up a bet.
  useEffect(() => {
    if (!market) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [market, onClose]);

  // STAKE = what the user bets (what they pay). The venue's parameter is a payout quantity,
  // which we derive from the stake so "you bet X" is exactly what they typed.
  const stake = useMemo(() => {
    const n = parseFloat(stakeStr.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [stakeStr]);
  const addStake = (n: number) => setStakeStr((s) => String(Math.max(0, (parseFloat(s || '0') || 0) + n)));
  const addFund = (n: number) => setFundStr((s) => String(Math.max(0, (parseFloat(s || '0') || 0) + n)));

  const msLeft = market && now > 0 ? market.expiry - now : null;
  const closing = msLeft != null && msLeft < MIN_MINT_MS;
  const belowMinHard = stake > 0 && stake < MIN_STAKE;
  const strikeUsd = spot != null && dir ? strike624(spot, dir) : null;

  // range band — centered near spot, both edges finite. Wins only if BTC lands inside.
  const isRange = mode === 'range';
  const cadFactor = market ? CADENCE_BAND_FACTOR[market.cadence] : 1;
  const half = Math.max(5, Math.round((RANGE_PRESETS.find((p) => p.key === preset)?.half ?? 30) * cadFactor));
  const centerMax = Math.max(10, Math.round(RANGE_CENTER_MAX * cadFactor));
  const clampedOffset = Math.max(-centerMax, Math.min(centerMax, centerOffset));
  const bandCenter = spot != null ? Math.round(spot + clampedOffset) : null;
  const lowerUsd = bandCenter != null ? bandCenter - half : null;
  const higherUsd = bandCenter != null ? bandCenter + half : null;
  const band = isRange && lowerUsd != null && higherUsd != null ? { lowerUsd, higherUsd } : null;

  const snapRangeOffset = useCallback((value: number) => {
    const snapped = Math.round(value / 5) * 5;
    return Math.max(-centerMax, Math.min(centerMax, snapped));
  }, [centerMax]);

  const startRangeDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const track = rangeTrackRef.current;
    if (!track) return;
    const width = track.getBoundingClientRect().width;
    if (width <= 0) return;
    const axisHalf = Math.max(90, half + 35);
    rangeDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startOffset: clampedOffset,
      usdPerPx: (axisHalf * 2) / width,
    };
    setRangeDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [clampedOffset, half]);

  const moveRangeDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rangeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setCenterOffset(snapRangeOffset(drag.startOffset + (e.clientX - drag.startX) * drag.usdPerPx));
  }, [snapRangeOffset]);

  const finishRangeDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rangeDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    rangeDragRef.current = null;
    setRangeDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const moveRangeWithKeyboard = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setCenterOffset(snapRangeOffset(clampedOffset - 5));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCenterOffset(snapRangeOffset(clampedOffset + 5));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCenterOffset(0);
    }
  }, [clampedOffset, snapRangeOffset]);

  // Quote a STABLE payout qty derived from the stake via EST_PROB (non-circular). We read the
  // live probability from the quote, then derive the real payout qty + win from that.
  const qtyForQuote = qtyForStake(stake, lev, EST_PROB);
  const { quote, quoteErr, quoting } = useMintQuote624({
    address,
    wrapperId,
    marketId: market?.id ?? null,
    dir: isRange ? null : dir,
    band,
    qty: qtyForQuote,
    lev,
    spot,
    enabled: !closing && !belowMinHard && !placed && !rangeDragging,
  });

  const showLive = quote != null && stake > 0;
  const showEstimate = !showLive && stake > 0;
  const probUsed = quote?.entryProb ?? EST_PROB;
  const payoutQty = qtyForStake(stake, lev, probUsed);      // costs stake at this probability
  const winAmt = winForQty(payoutQty, lev, probUsed);       // what a win returns
  const currentCost = quote ? quote.costMicro / DUSDC_MULTIPLIER : stake;
  const needsDeposit = stake > 0 && stake > acctBalance;

  const blocker: string | null = closing
    ? 'Market closing — pick the next one'
    : !address
      ? 'Connect a wallet'
      : !wrapperChecked
        ? 'Reading the chain…'
        : !wrapperId
          ? 'Set up your account below'
          : !isRange && !dir
            ? 'Call UP or DOWN'
            : stake <= 0
              ? 'Enter your bet'
              : belowMinHard
                ? `Bet at least ${fmt2(MIN_STAKE)} test USDC`
                : spot == null
                  ? 'Waiting for the oracle price…'
                  : needsDeposit
                    ? `Add ${fmt2(stake - acctBalance)} test USDC below first`
                    : quoteErr
                      ? 'Quote failed — see below'
                      : !quote
                        ? 'Getting the live price…'
                        : null;

  const createAccount = useCallback(async () => {
    if (busy) return;
    setBusy('create');
    try {
      const wid = await acct.createAccount();
      toast(wid ? 'Trading account created' : 'Account created — still indexing, one moment', 'success');
    } catch (e) {
      toast(`Could not create the account: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally {
      setBusy(null);
    }
  }, [acct, busy, toast]);

  const deposit = useCallback(async () => {
    if (busy) return;
    const amt = parseFloat(fundStr.replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) {
      toast('Enter an amount above 0', 'error');
      return;
    }
    if (Math.floor(amt * DUSDC_MULTIPLIER) > acct.walletMicro) {
      toast(`Wallet balance too low — you hold ${fmt2(acct.walletMicro / DUSDC_MULTIPLIER)} test USDC`, 'error');
      return;
    }
    setBusy('fund');
    try {
      await acct.deposit(BigInt(Math.floor(amt * DUSDC_MULTIPLIER)));
      toast(`Added ${fmt2(amt)} test USDC`, 'success');
      setFundStr('');
    } catch (e) {
      toast(`Deposit failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally {
      setBusy(null);
    }
  }, [acct, busy, fundStr, toast]);

  const place = useCallback(async () => {
    if (blocker || !address || !wrapperId || !market || spot == null || busy || !quote) return;
    setBusy('mint');
    try {
      if (isRange && lowerUsd != null && higherUsd != null) {
        const r = await placeRangeMint624({
          submitTx: acct.submitTx,
          address,
          wrapperId,
          marketId: market.id,
          lowerUsd,
          higherUsd,
          qty: payoutQty, // payout quantity derived so the entry cost ≈ the user's bet
          lev,
          acctBalance,
        });
        setPlaced({ digest: r.digest, kind: 'range', lowerUsd: r.lowerUsd, higherUsd: r.higherUsd, qty: winAmt, lev, costDusdc: r.costDusdc, expiry: market.expiry });
        toast(`Range bet placed — ${fmtUsd0(r.lowerUsd)}–${fmtUsd0(r.higherUsd)}`, 'success');
      } else if (dir) {
        const r = await placeMint624({
          submitTx: acct.submitTx,
          address,
          wrapperId,
          marketId: market.id,
          dir,
          qty: payoutQty,
          lev,
          spot,
          acctBalance,
        });
        setPlaced({ digest: r.digest, kind: 'dir', dir, strikeUsd: r.strikeUsd, qty: winAmt, lev, costDusdc: r.costDusdc, expiry: market.expiry });
        toast(`Bet placed — ${dir.toUpperCase()} ${dir === 'up' ? 'over' : 'under'} ${fmtUsd0(r.strikeUsd)}`, 'success');
      }
      acct.refreshAcctBalance();
    } catch (e) {
      toast(`Bet failed: ${friendlyMintAbort(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally {
      setBusy(null);
    }
  }, [blocker, address, wrapperId, market, dir, isRange, lowerUsd, higherUsd, spot, busy, quote, acct, payoutQty, winAmt, lev, acctBalance, toast]);

  // draw the market's live price chart inside the ticket — strike line (verdict
  // colors) for a side bet, shaded band for a range bet.
  useEffect(() => {
    const c = chartRef.current;
    if (!c || series.length < 2) return;
    if (isRange && lowerUsd != null && higherUsd != null) {
      drawPriceLine(c, series, { band: [lowerUsd, higherUsd], color: '#E04D26', axisRight: 48, gridLines: true, padTop: 10, padBot: 14 });
    } else if (strikeUsd != null) {
      drawPriceLine(c, series, { target: strikeUsd, verdict: true, targetLabel: dir === 'up' ? 'UP line' : 'DOWN line', axisRight: 48, gridLines: true, padTop: 10, padBot: 14 });
    } else {
      drawPriceLine(c, series, { axisRight: 48, gridLines: true, padTop: 10, padBot: 14 });
    }
  }, [series, isRange, lowerUsd, higherUsd, strikeUsd, dir, placed]);

  if (!market) return null;

  return (
    <>
      {/* mobile-only backdrop when the ticket is slid in */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      )}
      <div
        className={`overflow-y-auto border-l border-white/10 bg-[#0b0b0e]
          fixed top-0 right-0 z-[9999] h-full w-full max-w-[440px] p-6 shadow-2xl transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:static lg:z-auto lg:h-auto lg:w-full lg:max-w-none lg:p-5 lg:overflow-visible lg:translate-x-0 lg:border lg:rounded-lg lg:shadow-none`}
        role="dialog"
        aria-label="Bet ticket"
      >
        {/* close is mobile-only — the desktop rail is persistent */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="lg:hidden absolute right-4 top-4 rounded-full p-2 text-gray-600 hover:bg-white/[0.05] hover:text-white transition-colors"
          data-cursor="hover"
        >
          <X className="h-4 w-4" />
        </button>

        {/* head — hidden on desktop (the hero header shows the market beside this); shown in the mobile drawer */}
        <div className="lg:hidden flex items-center gap-3 mb-5 pr-8">
          <span className="w-9 h-9 rounded-full border border-white/20 flex items-center justify-center font-mono text-sm text-white shrink-0">₿</span>
          <div className="min-w-0">
            <h2 className="font-display font-[800] text-xl text-white leading-tight">BTC · {CADENCE_WORD[market.cadence]}</h2>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500 mt-0.5">
              {closing ? (
                <span className="text-vermilion">settling — at the oracle</span>
              ) : (
                <>
                  settles in <span className="text-white tabular-nums">{msLeft != null ? fmtCountdown(msLeft) : '—'}</span>
                  {spot != null && <span className="ml-2">· BTC ${Math.round(spot).toLocaleString()}</span>}
                </>
              )}
            </div>
          </div>
        </div>

        {placed ? (
          /* ── success state ── */
          <div>
            <div className={`border p-5 mb-5 ${placed.kind === 'range' ? 'border-vermilion/40 bg-vermilion/[0.05]' : placed.dir === 'up' ? 'border-profit/40 bg-profit/[0.05]' : 'border-loss/40 bg-loss/[0.05]'}`}>
              <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] mb-2 ${placed.kind === 'range' ? 'text-vermilion' : placed.dir === 'up' ? 'text-profit' : 'text-loss'}`}>
                ✓ Bet placed
              </div>
              <div className="font-display font-[800] text-2xl text-white leading-tight">
                {placed.kind === 'range' ? (
                  <>◆ RANGE — BTC {fmtUsd0(placed.lowerUsd ?? 0)}–{fmtUsd0(placed.higherUsd ?? 0)}</>
                ) : (
                  <>{placed.dir === 'up' ? '▲ UP' : '▼ DOWN'} — BTC {placed.dir === 'up' ? 'over' : 'under'} {fmtUsd0(placed.strikeUsd ?? 0)}</>
                )}
              </div>
              <div className="mt-3 space-y-1.5 font-mono text-[11px] text-white/70">
                <div className="flex justify-between"><span className="text-white/40 uppercase tracking-[0.14em] text-[9.5px]">You bet</span><span className="tabular-nums">{fmt2(placed.costDusdc)} test USDC</span></div>
                <div className="flex justify-between"><span className="text-white/40 uppercase tracking-[0.14em] text-[9.5px]">You win if it lands</span><span className="tabular-nums text-vermilion">{fmt2(placed.qty)} test USDC{placed.lev > 1 ? ' (before knockout)' : ''}</span></div>
                <div className="flex justify-between"><span className="text-white/40 uppercase tracking-[0.14em] text-[9.5px]">Settles</span><span className="tabular-nums">{now > 0 ? fmtCountdown(placed.expiry - now) : '—'}</span></div>
              </div>
              <a href={SUISCAN_TX(placed.digest)} target="_blank" rel="noreferrer" className="mt-3 inline-block font-mono text-[10px] text-white/40 hover:text-white transition-colors" data-cursor="hover">
                verify on Suiscan ↗
              </a>
            </div>
            <a
              href="/portfolio"
              className="block w-full text-center rounded-full bg-vermilion hover:bg-vermilion-d text-white text-sm font-semibold px-6 py-3 transition-colors"
              data-cursor="hover"
            >
              View in Portfolio →
            </a>
            <button
              onClick={() => { setPlaced(null); setStakeStr(''); }}
              className="mt-2.5 w-full rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 text-sm font-semibold px-6 py-3 transition-colors"
              data-cursor="hover"
            >
              Place another
            </button>
            <p className="font-mono text-[9.5px] leading-relaxed text-white/30 mt-4">
              Oracle-settled at expiry. Your payout lands in YOUR trading account — claim it from Portfolio once the market settles.
            </p>
          </div>
        ) : (
          /* ── the ticket ── */
          <div>
            {/* live chart — mobile only; on desktop the big hero chart beside it does this job */}
            {series.length > 1 && (
              <div className="lg:hidden mb-4 rounded-xl border border-white/[0.08] bg-white/[0.015] overflow-hidden">
                <canvas ref={chartRef} className="block w-full h-[128px]" />
              </div>
            )}

            {/* mode — call a side (Up/Down) or a band (Range) */}
            <div className="flex gap-1 mb-3 rounded-md border border-white/[0.08] bg-white/[0.015] p-1">
              {(['dir', 'range'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${mode === m ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/75'}`}
                  aria-pressed={mode === m}
                  data-cursor="hover"
                >
                  {m === 'dir' ? 'Up / Down' : 'Range'}
                </button>
              ))}
            </div>

            {mode === 'dir' ? (
              /* direction — tapped side arrives preselected */
              <div className="grid grid-cols-2 gap-2 mb-4">
                {(['up', 'down'] as const).map((d) => {
                  const on = dir === d;
                  const line = spot == null
                    ? 'waiting for the oracle…'
                    : d === 'up'
                      ? `wins if BTC settles over ${fmtUsd0(spot - BAND_USD)}`
                      : `wins if BTC settles under ${fmtUsd0(spot + BAND_USD)}`;
                  const palette = d === 'up'
                    ? on
                      ? 'border-profit bg-profit/[0.14] text-profit'
                      : 'border-white/[0.1] text-white/45 hover:border-profit/50 hover:text-profit'
                    : on
                      ? 'border-loss bg-loss/[0.14] text-loss'
                      : 'border-white/[0.1] text-white/45 hover:border-loss/50 hover:text-loss';
                  return (
                    <button
                      key={d}
                      onClick={() => setDir(on ? null : d)}
                      className={`text-left border rounded-md px-3 py-2.5 transition-all duration-150 ${palette}`}
                      aria-pressed={on}
                      data-cursor="hover"
                    >
                      <div className="font-display font-[750] text-[15px] leading-none tracking-normal">
                        {d === 'up' ? '▲ UP' : '▼ DOWN'}
                      </div>
                      <div className={`font-mono text-[8.5px] leading-snug mt-1.5 ${on ? 'opacity-85' : 'opacity-55'}`}>{line}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              /* range — explicit bounds, compact width control, precise center steps */
              <div className="mb-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/45">Winning range</span>
                  <span className="font-mono text-[8.5px] text-white/35">BTC must finish inside</span>
                </div>

                <div className="rounded-md border border-white/[0.1] bg-white/[0.015] overflow-hidden" aria-live="polite">
                  {spot != null && bandCenter != null && lowerUsd != null && higherUsd != null ? (
                    (() => {
                      const AXIS_HALF = Math.max(90, half + 35);
                      const lo = spot - AXIS_HALF;
                      const hi = spot + AXIS_HALF;
                      const pct = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
                      const bl = pct(lowerUsd);
                      const bh = pct(higherUsd);
                      const sp = pct(spot);
                      return (
                        <>
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 pt-2.5">
                            <div>
                              <span className="block font-mono text-[7.5px] uppercase tracking-[0.14em] text-white/30">From</span>
                              <strong className="block mt-0.5 font-mono text-[13px] font-medium tabular-nums text-vermilion">{fmtUsd0(lowerUsd)}</strong>
                            </div>
                            <span className="font-mono text-[10px] text-white/20" aria-hidden="true">→</span>
                            <div className="text-right">
                              <span className="block font-mono text-[7.5px] uppercase tracking-[0.14em] text-white/30">To</span>
                              <strong className="block mt-0.5 font-mono text-[13px] font-medium tabular-nums text-vermilion">{fmtUsd0(higherUsd)}</strong>
                            </div>
                          </div>
                          <div ref={rangeTrackRef} className="relative mx-3 h-8">
                            <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.1]" />
                            <div
                              role="slider"
                              tabIndex={0}
                              aria-label="Range center relative to the current BTC price"
                              aria-valuemin={-centerMax}
                              aria-valuemax={centerMax}
                              aria-valuenow={clampedOffset}
                              aria-valuetext={clampedOffset === 0 ? 'Centered on market price' : `${Math.abs(clampedOffset)} dollars ${clampedOffset > 0 ? 'above' : 'below'} market price`}
                              title="Drag to move the range"
                              className={`absolute top-1 z-10 h-6 touch-none select-none rounded-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-vermilion/70 ${rangeDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                              style={{ left: `${bl}%`, right: `${100 - bh}%` }}
                              onPointerDown={startRangeDrag}
                              onPointerMove={moveRangeDrag}
                              onPointerUp={finishRangeDrag}
                              onPointerCancel={finishRangeDrag}
                              onLostPointerCapture={finishRangeDrag}
                              onKeyDown={moveRangeWithKeyboard}
                            >
                              <span className={`absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-sm border-x border-vermilion transition-colors ${rangeDragging ? 'bg-vermilion/45' : 'bg-vermilion/25 hover:bg-vermilion/35'}`} />
                              <span className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-px" aria-hidden="true">
                                <span className="h-2.5 w-px bg-vermilion/80" />
                                <span className="h-2.5 w-px bg-vermilion/80" />
                                <span className="h-2.5 w-px bg-vermilion/80" />
                              </span>
                            </div>
                            <div className="pointer-events-none absolute top-2.5 z-20 h-3 w-px bg-white/80" style={{ left: `${sp}%` }} />
                            <div className="pointer-events-none absolute top-[13px] z-20 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white" style={{ left: `${sp}%` }} />
                          </div>
                          <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-1.5 font-mono text-[8px] text-white/35">
                            <span>BTC now</span>
                            <span className="tabular-nums text-white/65">{fmtUsd0(spot)}</span>
                          </div>
                        </>
                      );
                    })()
                  ) : (
                    <div className="flex h-[84px] items-center justify-center font-mono text-[9px] text-white/30">Waiting for the oracle price…</div>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1" aria-label="Range width">
                  {RANGE_PRESETS.map((p) => {
                    const on = preset === p.key;
                    const eff = Math.max(5, Math.round(p.half * cadFactor));
                    const label = p.key === 'medium' ? 'Balanced' : p.label;
                    return (
                      <button
                        key={p.key}
                        onClick={() => setPreset(p.key)}
                        className={`rounded border px-2 py-1.5 text-left transition-all duration-150 active:scale-[0.98] ${on ? 'border-vermilion/70 bg-vermilion/[0.08] text-white' : 'border-white/[0.09] text-white/45 hover:border-white/20 hover:text-white/75'}`}
                        aria-pressed={on}
                        data-cursor="hover"
                      >
                        <span className="block font-display text-[11px] font-semibold leading-none">{label}</span>
                        <span className={`mt-1 block font-mono text-[7.5px] tabular-nums ${on ? 'text-vermilion' : 'text-white/30'}`}>${eff * 2} span</span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 flex min-h-10 items-center justify-between gap-3 border-t border-white/[0.08] pt-2">
                  <div className="min-w-0">
                    <span className="block font-mono text-[7.5px] uppercase tracking-[0.14em] text-white/30">Range center</span>
                    <span className="block mt-0.5 truncate font-mono text-[9px] tabular-nums text-white/60">
                      {clampedOffset === 0 ? 'At market price' : `$${Math.abs(clampedOffset)} ${clampedOffset > 0 ? 'above' : 'below'} market`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCenterOffset(Math.max(-centerMax, clampedOffset - 5))}
                      className="grid h-8 w-8 place-items-center rounded border border-white/[0.1] text-white/55 transition-colors hover:border-white/25 hover:text-white active:scale-95"
                      aria-label="Move range five dollars lower"
                      title="Move range $5 lower"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCenterOffset(0)}
                      disabled={clampedOffset === 0}
                      className="grid h-8 w-8 place-items-center rounded border border-white/[0.1] text-white/55 transition-colors hover:border-white/25 hover:text-white active:scale-95 disabled:cursor-default disabled:opacity-25"
                      aria-label="Recenter range on the market price"
                      title="Recenter range"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCenterOffset(Math.min(centerMax, clampedOffset + 5))}
                      className="grid h-8 w-8 place-items-center rounded border border-white/[0.1] text-white/55 transition-colors hover:border-white/25 hover:text-white active:scale-95"
                      aria-label="Move range five dollars higher"
                      title="Move range $5 higher"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* amount + leverage — the only sizing controls */}
            <div className="mb-4 border-y border-white/[0.08] py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/45">Bet amount</span>
                <span className="font-mono text-[9px] text-white/35">Balance {fmt2(acctBalance)}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={stakeStr}
                  onChange={(e) => setStakeStr(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="min-w-0 flex-1 bg-transparent font-display text-[1.75rem] leading-none font-bold text-white tabular-nums outline-none placeholder:text-white/18 caret-vermilion"
                  aria-label="Bet amount in test USDC"
                />
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">test USDC</span>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <div className="flex gap-1">
                  {[1, 5, 20].map((n) => (
                    <button key={n} onClick={() => addStake(n)} className="min-w-10 rounded border border-white/[0.1] px-2 py-1 font-mono text-[9px] text-white/55 hover:border-white/25 hover:text-white transition-colors active:scale-95" data-cursor="hover">
                      +{n}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1" aria-label="Leverage">
                  {[1, 2, 3].map((v) => (
                    <button
                      key={v}
                      onClick={() => setLev(v)}
                      className={`min-w-10 rounded border px-2 py-1 font-mono text-[9px] transition-colors ${lev === v ? 'border-vermilion/70 bg-vermilion/[0.08] text-vermilion' : 'border-white/[0.1] text-white/45 hover:text-white'}`}
                      aria-pressed={lev === v}
                      data-cursor="hover"
                    >
                      {v}×
                    </button>
                  ))}
                </div>
              </div>
              {belowMinHard && (
                <p className="font-mono text-[9px] text-vermilion mt-2">
                  Minimum {fmt2(MIN_STAKE)} test USDC.
                </p>
              )}
            </div>

            {/* one quote strip, no example table */}
            <div className={`grid grid-cols-3 divide-x divide-white/[0.07] border-b mb-2 ${showLive ? 'border-vermilion/30' : 'border-white/[0.08]'}`}>
              <CompactQuote label="Current cost" value={stake > 0 ? fmt2(currentCost) : '—'} />
              <CompactQuote label="Return" value={stake > 0 ? fmt2(winAmt) : '—'} accent={stake > 0} />
              <CompactQuote label="Max loss" value={stake > 0 ? fmt2(currentCost) : '—'} />
            </div>
            <div className="flex items-start justify-between gap-3 min-h-7 mb-3 font-mono text-[8.5px] leading-relaxed text-white/35">
              <span>
                {rangeDragging
                  ? 'Release to price this range'
                  : quoteErr
                  ? `Quote failed: ${friendlyMintAbort(quoteErr)}`
                  : showLive
                    ? 'Live venue quote'
                    : showEstimate
                      ? (quoting ? 'Getting live quote…' : 'Estimated until wallet quote')
                      : 'Enter an amount to quote'}
              </span>
              {showLive && <span className="shrink-0 text-white/55">{(probUsed * 100).toFixed(0)}% chance</span>}
            </div>
            {lev > 1 && (
              <p className="font-mono text-[8.5px] text-white/35 leading-relaxed -mt-1 mb-3">
                {lev}× can knock out before expiry.
              </p>
            )}

            {/* account gates, inline */}
            {!address && (
              <div className="border border-white/[0.08] bg-white/[0.02] p-4 mb-4">
                <p className="text-[12.5px] text-gray-400 leading-snug mb-3">
                  Your bets settle into an on-chain trading account only your wallet can withdraw from. Connect to set it up.
                </p>
                <ConnectButton />
              </div>
            )}
            {address && wrapperChecked && !wrapperId && (
              <div className="border border-white/[0.08] bg-white/[0.02] p-4 mb-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1.5">One-time setup</div>
                <p className="text-[12.5px] text-gray-400 leading-snug mb-3">
                  Creates your trading account on DeepBook Predict — deposits, payouts and withdrawals all move through it; only you can withdraw.
                </p>
                <button
                  onClick={createAccount}
                  disabled={busy === 'create'}
                  className="rounded-full bg-vermilion hover:bg-vermilion-d text-white text-[13px] font-semibold px-5 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  data-cursor="hover"
                >
                  {busy === 'create' ? 'Creating…' : 'Create account →'}
                </button>
              </div>
            )}
            {address && wrapperId && needsDeposit && (
              <div className="border border-vermilion/25 bg-vermilion/[0.04] p-4 mb-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1.5">Top up to place this</div>
                <p className="font-mono text-[10px] text-gray-500 mb-2.5">
                  Account holds {fmt2(acctBalance)} · this bet is {fmt2(stake)} · wallet holds {fmt2(acct.walletMicro / DUSDC_MULTIPLIER)} test USDC
                </p>
                <div className="rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 focus-within:border-vermilion/50">
                  <div className="flex items-center justify-between">
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={fundStr}
                      onChange={(e) => setFundStr(e.target.value.replace(/[^0-9.]/g, ''))}
                      className="w-full bg-transparent font-display text-xl font-bold text-white outline-none placeholder:text-gray-600"
                      aria-label="Deposit amount in test USDC"
                    />
                    <div className="flex gap-1.5 shrink-0">
                      {[1, 5, 10].map((n) => (
                        <button key={n} onClick={() => addFund(n)} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors" data-cursor="hover">
                          +{n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={deposit}
                  disabled={busy === 'fund'}
                  className="mt-2.5 rounded-full bg-vermilion hover:bg-vermilion-d text-white text-[13px] font-semibold px-5 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  data-cursor="hover"
                >
                  {busy === 'fund' ? 'Submitting…' : 'Deposit to account'}
                </button>
              </div>
            )}

            {/* place */}
            <button
              onClick={place}
              disabled={!!blocker || busy === 'mint'}
              className={`w-full py-3 text-sm font-semibold transition-all rounded ${
                !blocker && busy !== 'mint'
                  ? isRange
                    ? 'bg-vermilion text-white hover:opacity-90 shadow-[0_6px_28px_-8px_var(--vermilion)]'
                    : dir === 'down'
                      ? 'bg-loss text-white hover:opacity-90 shadow-[0_6px_28px_-8px_var(--loss)]'
                      : 'bg-profit text-black hover:opacity-90 shadow-[0_6px_28px_-8px_var(--profit)]'
                  : 'cursor-not-allowed bg-white/[0.06] text-gray-500'
              }`}
              data-cursor="hover"
            >
              {busy === 'mint'
                ? 'Placing…'
                : blocker ??
                  (isRange
                    ? `Place RANGE — ${lowerUsd != null && higherUsd != null ? `${fmtUsd0(lowerUsd)}–${fmtUsd0(higherUsd)}` : ''} →`
                    : `Place ${dir === 'up' ? 'UP' : 'DOWN'} — ${strikeUsd != null ? `${dir === 'up' ? 'over' : 'under'} ${fmtUsd0(strikeUsd)}` : ''} →`)}
            </button>

            <p className="font-mono text-[8.5px] leading-relaxed text-white/25 mt-2.5">
              Oracle-settled test market · wallet-signed · payouts return to your trading account.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

function CompactQuote({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 px-2.5 py-2.5 first:pl-0 last:pr-0">
      <span className="block font-mono text-[7.5px] uppercase tracking-[0.12em] text-white/30 mb-1">{label}</span>
      <span className={`block truncate font-mono text-[13px] tabular-nums ${accent ? 'text-vermilion' : 'text-white/75'}`}>{value}</span>
    </div>
  );
}
