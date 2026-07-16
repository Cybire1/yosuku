'use client';

// The Settlement Receipt — the in-app record of ONE settled (or cashed-out /
// liquidated) trade. A trade-confirmation slip where the oracle's print at the
// exact settlement second is the monument — set bigger than the payout.
//
// One-spark color system: a win carries living vermilion heat — in the P&L,
// the stamp, and a low ember bloom behind the result strip; a loss is the
// exact same slip with the heat drained — a quiet, dignified record, never an
// alarm. No green, no red.
//
// Honesty is structural: kind='settled_order_redeemed' stamps ORACLE-SETTLED
// with the oracle print + second (the market EXPIRY — never the claim time);
// 'live_order_redeemed' says CASHED OUT at the live price (never claims
// oracle settlement); 'liquidated_order_redeemed' says LIQUIDATED, muted.
// Every number is real on-chain data (see lib/sui/settledTrade.ts) — if the
// row carried no price print, the hero is omitted rather than estimated. The
// strike↔settle relationship is shown as marks on an axis, never a fabricated
// price path.

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { SettledTrade } from '@/lib/sui/settledTrade';
import { SUISCAN_TX } from '@/lib/sui/strategyClient';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';

// ─── tiny formatters (local by design — mirror the 6-24 component idiom) ───

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPx = (n: number) => `$${fmt2(n)}`;
const fmtStrike = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const micro = (m: bigint) => Number(m) / DUSDC_MULTIPLIER;
const shortId = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Full verifiable second — `2026-07-08 · 14:32:07 UTC`. */
function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} · ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

/** Compact ledger-row time — `07-08 14:28:03 UTC`. */
function shortUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

function fmtHeld(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad2(s % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${pad2(m % 60)}m`;
}

/** Human band, same pattern as Portfolio624Section.bandLabel. */
function positionLabel(t: SettledTrade): string {
  if (t.dir === 'range' && t.lowerUsd != null && t.higherUsd != null) return `RANGE ${fmtStrike(t.lowerUsd)}–${fmtStrike(t.higherUsd)}`;
  if (t.dir === 'up') return `UP · over ${t.lowerUsd != null ? fmtStrike(t.lowerUsd) : '—'}`;
  if (t.dir === 'down') return `DOWN · under ${t.higherUsd != null ? fmtStrike(t.higherUsd) : '—'}`;
  return '—';
}

// ─── honest labels per redemption kind — never claim oracle settlement on a cash-out ───

interface KindMeta {
  receipt: string;      // masthead line
  stampWord: string;    // the seal's caption
  stampKanji: string;   // ONE seal language with the share card: 済 settled · 引 cashed out · 切 knocked out · 了 redeemed
  heroLabel: string;    // what the big price IS
  settleTxLabel: string;
  settleWord: string;   // the proof-scale mark word
}

function kindMeta(kind: SettledTrade['kind']): KindMeta {
  switch (kind) {
    case 'settled_order_redeemed':
      return { receipt: 'Settlement receipt', stampWord: 'Oracle-settled', stampKanji: '済', heroLabel: 'Oracle settlement price', settleTxLabel: 'Settle tx', settleWord: 'Settled' };
    case 'live_order_redeemed':
      return { receipt: 'Cash-out receipt', stampWord: 'Cashed out', stampKanji: '引', heroLabel: 'Live price at cash-out', settleTxLabel: 'Cash-out tx', settleWord: 'Print' };
    case 'liquidated_order_redeemed':
      return { receipt: 'Liquidation receipt', stampWord: 'Liquidated', stampKanji: '切', heroLabel: 'Price at liquidation', settleTxLabel: 'Liquidation tx', settleWord: 'Knockout' };
    default:
      return { receipt: 'Trade receipt', stampWord: 'Redeemed', stampKanji: '了', heroLabel: 'Redemption price', settleTxLabel: 'Redeem tx', settleWord: 'Print' };
  }
}

// ─── decorative bits — pure CSS / data-URI, no external assets ───

const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;

// Entrance choreography — backdrop fade, one card rise, one stamp press, and a
// late label reveal under the monument. `motion-safe:` on every use means
// prefers-reduced-motion users get the finished frame directly.
const KEYFRAMES = `
@keyframes ykReceiptFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ykReceiptIn { from { opacity: 0; transform: translateY(22px) scale(0.97) } to { opacity: 1; transform: none } }
@keyframes ykStampIn { 0% { opacity: 0; transform: rotate(-8deg) scale(1.9) } 60% { opacity: 1; transform: rotate(-8deg) scale(0.94) } 100% { opacity: 1; transform: rotate(-8deg) scale(1) } }
@keyframes ykRise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
`;

// ─── component ───

export default function TradeReceipt({
  trade,
  onClose,
  shareSlot,
}: {
  trade: SettledTrade;
  onClose: () => void;
  /** The share button plugs in here later — nothing renders when absent. */
  shareSlot?: ReactNode;
}) {
  // Esc closes · body scroll locked while open (same idiom as the /strategies drawer).
  // Tab is trapped inside the dialog, and focus returns to whatever opened it on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    dialogRef.current?.focus({ preventScroll: true }); // focus enters the dialog without painting a ring
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const meta = kindMeta(trade.kind);
  const isLiq = trade.kind === 'liquidated_order_redeemed';
  // The one spark: heat = a realized win. Liquidations stay drained regardless.
  const heat = !isLiq && trade.pnlMicro > BigInt(0);

  const stake = micro(trade.stakeMicro);
  const maxPayout = micro(trade.qtyMicro);
  const payout = micro(trade.payoutMicro);
  const pnl = micro(trade.pnlMicro);
  const pnlStr = `${pnl >= 0 ? '+' : '−'}${fmt2(Math.abs(pnl))}`;
  const levStr = `${trade.leverageX.toFixed(2).replace(/\.?0+$/, '')}×`;
  const folio = trade.orderId.replace(/^0x/, '').slice(0, 6).toUpperCase();
  const settle = trade.settlementUsd;

  const strikes: number[] =
    trade.dir === 'range'
      ? [trade.lowerUsd, trade.higherUsd].filter((v): v is number => v != null)
      : trade.dir === 'up'
        ? (trade.lowerUsd != null ? [trade.lowerUsd] : [])
        : (trade.higherUsd != null ? [trade.higherUsd] : []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={meta.receipt}
      onClick={onClose}
    >
      <style>{KEYFRAMES}</style>

      {/* backdrop — vignette + (on a win) a faint ember rising under the card */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md motion-safe:animate-[ykReceiptFade_.25s_ease_both]" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 motion-safe:animate-[ykReceiptFade_.6s_ease_both]"
        style={{
          background: heat
            ? 'radial-gradient(42% 34% at 50% 62%, rgba(224,77,38,0.13), transparent 70%)'
            : 'radial-gradient(46% 36% at 50% 58%, rgba(255,255,255,0.03), transparent 70%)',
        }}
      />

      {/* the slip — warm near-black, hairline edge, internal scroll on short screens */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative flex w-full max-w-[400px] max-h-[calc(100dvh-2rem)] flex-col overflow-hidden border border-white/[0.12] shadow-[0_48px_120px_-32px_rgba(0,0,0,0.95)] outline-none motion-safe:animate-[ykReceiptIn_.4s_var(--ease-out)_both]"
        style={{ background: 'radial-gradient(130% 90% at 50% -12%, #14100c 0%, #0c0a08 46%, #080605 100%)', outline: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* film grain, scoped to the card */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
        {/* top hairline glow — the printed edge */}
        <div aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 z-20 h-px ${heat ? 'bg-gradient-to-r from-transparent via-vermilion/60 to-transparent' : 'bg-gradient-to-r from-transparent via-white/25 to-transparent'}`} />

        {/* registration ticks — the print-proof corners */}
        <span aria-hidden="true" className="pointer-events-none absolute left-2 top-2 z-20 h-2.5 w-2.5 border-l border-t border-white/20" />
        <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 z-20 h-2.5 w-2.5 border-r border-t border-white/20" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2 z-20 h-2.5 w-2.5 border-b border-l border-white/20" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 z-20 h-2.5 w-2.5 border-b border-r border-white/20" />

        {/* No autoFocus here — script-focus paints the global focus ring on open.
            The dialog container takes initial focus instead; Tab reaches this first. */}
        <button
          onClick={onClose}
          aria-label="Close receipt"
          className="absolute right-2.5 top-2.5 z-40 rounded-full p-2 text-white/35 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:ring-1 focus-visible:ring-white/40"
          data-cursor="hover"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative overflow-y-auto overscroll-contain">
          {/* ── masthead — seal · wordmark · record line ── */}
          <header className="px-6 pt-6">
            <div className="flex items-center gap-3.5 pr-10">
              <div className={`grid h-11 w-11 shrink-0 -rotate-3 place-items-center border-[1.5px] font-jp text-[22px] leading-none ${heat ? 'border-vermilion/70 text-vermilion shadow-[inset_0_0_0_3px_rgba(224,77,38,0.12),0_0_24px_-6px_rgba(224,77,38,0.5)]' : 'border-white/20 text-white/50 shadow-[inset_0_0_0_3px_rgba(255,255,255,0.03)]'}`}>
                予
              </div>
              <div className="min-w-0">
                <div className="font-display text-[15px] font-[800] leading-none tracking-[0.26em] text-white">YOSUKU</div>
                <div className="mt-2 font-mono text-[8px] uppercase tracking-[0.3em] text-white/40">
                  Oracle-settled prediction markets
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-baseline justify-between border-t border-white/[0.1] pt-3 font-mono text-[9px] uppercase">
              <span className="tracking-[0.26em] text-white/60">{meta.receipt}</span>
              <span className="tabular-nums tracking-[0.16em] text-white/35">Nº {folio}</span>
            </div>
          </header>

          {/* ── ledger — dotted-leader rows, every figure from the chain ── */}
          <section className="px-6 pb-5 pt-3.5">
            <Row label="Market" value={`BTC / USD · ${shortId(trade.marketId)}`} />
            <Row label="Position" value={positionLabel(trade)} strong />
            <Row label="Stake" value={fmt2(stake)} />
            <Row label="Leverage" value={levStr} />
            <Row label="Max payout" value={fmt2(maxPayout)} />
            <Row label="Opened" value={shortUtc(trade.openedAtMs)} />
            {/* An oracle-settled position economically ends AT EXPIRY — the claim can land
                much later. Without the real expiry we show '—' rather than a padded hold. */}
            <Row
              label="Held"
              value={
                trade.kind === 'settled_order_redeemed'
                  ? (trade.expiryMs != null ? fmtHeld(trade.expiryMs - trade.openedAtMs) : '—')
                  : fmtHeld(trade.settledAtMs - trade.openedAtMs)
              }
            />
          </section>

          <Perforation />

          {/* ── the monument — the print at the exact second ── */}
          {settle != null ? (
            <section className="relative px-6 pb-1 pt-5">
              <span aria-hidden="true" className="pointer-events-none absolute -right-4 -top-7 select-none font-jp text-[120px] font-bold leading-none text-white/[0.03]">
                {meta.stampKanji}
              </span>
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className={`h-3.5 w-[3px] ${heat ? 'bg-vermilion' : 'bg-white/30'}`} />
                <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/55">{meta.heroLabel}</span>
              </div>
              <div className="mt-3 font-display text-[clamp(2.5rem,12vw,3.15rem)] font-[800] leading-[0.95] tracking-[-0.02em] tabular-nums text-white [text-shadow:0_1px_40px_rgba(255,255,255,0.08)]">
                {fmtPx(settle)}
              </div>
              {/* The oracle prints AT EXPIRY; the claim tx can land any time after. Only
                  stamp "the exact second" when we hold the real expiry — otherwise say
                  what we actually know (when it was claimed), never a false second. */}
              <div className="mt-2.5 font-mono text-[9.5px] tracking-[0.1em] tabular-nums text-white/50 motion-safe:animate-[ykRise_.4s_ease_.3s_both]">
                {trade.kind === 'settled_order_redeemed' ? (
                  trade.expiryMs != null ? (
                    <>
                      {utcStamp(trade.expiryMs)}
                      <span className={heat ? 'text-vermilion/80' : 'text-white/30'}> · the exact second</span>
                    </>
                  ) : (
                    <>Claimed {utcStamp(trade.settledAtMs)}</>
                  )
                ) : (
                  utcStamp(trade.settledAtMs)
                )}
              </div>
              {strikes.length > 0 && <ProofScale strikes={strikes} settle={settle} dir={trade.dir} settleWord={meta.settleWord} won={heat} />}
            </section>
          ) : (
            /* no print carried on-chain — record the payout only, never estimate */
            <section className="px-6 pb-1 pt-5">
              <div className="flex items-center gap-2.5">
                <span aria-hidden="true" className="h-3.5 w-[3px] bg-white/30" />
                <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/55">{meta.heroLabel}</span>
              </div>
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-white/40">
                This redemption carried no price print on-chain — the payout below is the full record.
              </p>
            </section>
          )}

          {/* ── result strip — payout · net · the stamp, with the ember bloom under a win ── */}
          <section className="relative mx-6 mt-5">
            {heat && (
              <div aria-hidden="true" className="pointer-events-none absolute -inset-x-6 -inset-y-4 bg-[radial-gradient(60%_100%_at_50%_100%,rgba(224,77,38,0.09),transparent_75%)]" />
            )}
            <div className="relative flex items-center gap-4 border-t border-white/[0.1] pb-6 pt-5">
              <div className="grid flex-1 grid-cols-2 gap-4">
                <div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.24em] text-white/40">Payout</div>
                  <div className="mt-2 font-display text-[22px] font-[700] leading-none tracking-tight tabular-nums text-white/90">{fmt2(payout)}</div>
                </div>
                <div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.24em] text-white/40">Net P&amp;L</div>
                  <div className={`mt-2 font-display text-[22px] font-[800] leading-none tracking-tight tabular-nums ${heat ? 'text-vermilion [text-shadow:0_0_28px_rgba(224,77,38,0.45)]' : 'text-white/60'}`}>
                    {pnlStr}
                  </div>
                </div>
              </div>
              <Stamp word={meta.stampWord} kanji={meta.stampKanji} heat={heat} />
            </div>
          </section>

          {/* ── verifiable footer — the proof links ── */}
          <footer className="border-t border-white/[0.1] bg-black/30 px-6 pb-5 pt-4">
            <TxRow label="Mint tx" digest={trade.mintDigest} />
            <TxRow label={meta.settleTxLabel} digest={trade.redeemDigest} />
            <p className="mt-3.5 whitespace-nowrap text-center font-mono text-[7.5px] uppercase tracking-[0.24em] text-white/30">
              All amounts in DUSDC · Sui testnet
            </p>
            {shareSlot ? (
              <div className={`mt-4 flex justify-center border px-4 py-2.5 transition-colors ${heat ? 'border-vermilion/35 bg-vermilion/[0.06] hover:border-vermilion/60' : 'border-white/[0.12] bg-white/[0.02] hover:border-white/25'}`}>
                {shareSlot}
              </div>
            ) : null}
          </footer>
        </div>
      </div>
    </div>
  );
}

// ─── pieces ───

/** Dotted-leader ledger row — label … value, all mono, all tabular. */
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-2.5 py-[6px] font-mono text-[11px] leading-none">
      <span className="shrink-0 text-[8.5px] uppercase tracking-[0.18em] text-white/40">{label}</span>
      <span aria-hidden="true" className="flex-1 -translate-y-[2px] border-b border-dotted border-white/[0.16]" />
      <span className={`shrink-0 tabular-nums ${strong ? 'font-semibold text-white' : 'text-white/75'}`}>{value}</span>
    </div>
  );
}

/** Footer proof row — dotted leader into a Suiscan link. */
function TxRow({ label, digest }: { label: string; digest: string }) {
  return (
    <div className="flex items-baseline gap-2.5 py-[5px] font-mono text-[10px] leading-none">
      <span className="shrink-0 text-[8px] uppercase tracking-[0.2em] text-white/35">{label}</span>
      <span aria-hidden="true" className="flex-1 -translate-y-[2px] border-b border-dotted border-white/[0.12]" />
      <a
        href={SUISCAN_TX(digest)}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 tabular-nums text-white/60 outline-none transition-colors hover:text-vermilion focus-visible:text-vermilion"
        data-cursor="hover"
      >
        {digest.slice(0, 6)}…{digest.slice(-4)} ↗
      </a>
    </div>
  );
}

/** Torn-slip perforation — punched side notches + dashed rule, pure CSS. */
function Perforation() {
  return (
    <div aria-hidden="true" className="relative flex h-6 items-center">
      <span className="-ml-[13px] h-[26px] w-[26px] shrink-0 rounded-full border border-white/[0.12] bg-black" />
      <span className="mx-3 flex-1 border-t-2 border-dashed border-white/[0.13]" />
      <span className="-mr-[13px] h-[26px] w-[26px] shrink-0 rounded-full border border-white/[0.12] bg-black" />
    </div>
  );
}

/** The hanko. Celebration lives HERE and only here — vermilion press on a win,
 *  drained ink on a loss or knockout. */
function Stamp({ word, kanji, heat }: { word: string; kanji: string; heat: boolean }) {
  return (
    <div className="relative shrink-0 select-none motion-safe:animate-[ykStampIn_.55s_var(--ease-bounce)_.3s_both]" style={{ transform: 'rotate(-8deg)' }}>
      <div
        className={`rounded-[4px] border-2 px-3.5 py-2.5 text-center ${
          heat
            ? 'border-vermilion text-vermilion shadow-[0_0_40px_-6px_rgba(224,77,38,0.75),inset_0_0_18px_rgba(224,77,38,0.14)]'
            : 'border-white/25 text-white/45'
        }`}
      >
        <span className="block font-jp text-[30px] leading-none">{kanji}</span>
        <span className="mt-2 block whitespace-nowrap font-mono text-[6.5px] font-bold uppercase tracking-[0.26em]">{word}</span>
      </div>
      {/* inner hairline ring — double-struck seal edge */}
      <span aria-hidden="true" className={`pointer-events-none absolute inset-[4px] rounded-[2px] border ${heat ? 'border-vermilion/40' : 'border-white/10'}`} />
    </div>
  );
}

/** Marks on one axis — where the strike sat, where the print landed. Deliberately
 *  NOT a price path: we don't hold historical tape for old trades, so the receipt
 *  shows only the numbers the chain actually recorded. */
function ProofScale({
  strikes,
  settle,
  dir,
  settleWord,
  won,
}: {
  strikes: number[];
  settle: number;
  dir: SettledTrade['dir'];
  settleWord: string;
  won: boolean;
}) {
  const sorted = [...strikes].sort((a, b) => a - b);
  const vals = [...sorted, settle];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  // pad the axis so marks never sit on the edge; floor keeps a strike-touching
  // print (settle ≈ strike) from collapsing the scale to zero width
  const pad = Math.max((max - min) * 0.35, Math.abs(settle) * 0.0004, 4);
  const lo = min - pad;
  const hi = max + pad;
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const clampLabel = (p: number) => Math.min(84, Math.max(16, p));

  const isBand = dir === 'range' && sorted.length === 2;
  const strikeLabel = isBand ? `BAND ${fmtStrike(sorted[0])}–${fmtStrike(sorted[1])}` : `STRIKE ${fmtStrike(sorted[0])}`;
  const strikeLabelPct = clampLabel(isBand ? (pct(sorted[0]) + pct(sorted[1])) / 2 : pct(sorted[0]));
  const settlePct = pct(settle);

  // The in-the-money side of the axis — a real fact (band geometry), drawn as a
  // faint zone so the print visibly lands in (or out of) the money.
  const zone = isBand
    ? { left: pct(sorted[0]), right: 100 - pct(sorted[1]) }
    : dir === 'up'
      ? { left: pct(sorted[0]), right: 0 }
      : { left: 0, right: 100 - pct(sorted[0]) };

  return (
    <div className="mt-6 border border-white/[0.09] bg-white/[0.015] px-4 pb-3 pt-2.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[7.5px] uppercase tracking-[0.26em] text-white/35">
          Proof · strike vs {settleWord.toLowerCase()}
        </span>
        <span className={`font-mono text-[7.5px] uppercase tracking-[0.2em] ${won ? 'text-vermilion/80' : 'text-white/30'}`}>
          {won ? 'In the money' : 'Out of the money'}
        </span>
      </div>
      <div className="relative mt-2 h-[58px]">
        {/* strike label above the axis */}
        <div
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[8.5px] tracking-[0.06em] tabular-nums text-white/55"
          style={{ left: `${strikeLabelPct}%` }}
        >
          {strikeLabel}
        </div>

        {/* the in-the-money zone — band geometry, a real on-chain fact */}
        <div
          aria-hidden="true"
          className={`absolute top-1/2 h-3.5 -translate-y-1/2 ${won ? 'bg-vermilion/[0.13]' : 'bg-white/[0.05]'}`}
          style={{ left: `${zone.left}%`, right: `${zone.right}%` }}
        />

        {/* axis + end caps */}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-white/20" />
        <span aria-hidden="true" className="absolute left-0 top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/30" />
        <span aria-hidden="true" className="absolute right-0 top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/30" />

        {/* strike tick(s) */}
        {sorted.map((s) => (
          <span key={s} className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-white/60" style={{ left: `${pct(s)}%` }} />
        ))}

        {/* where the print landed — the one hot mark on a win */}
        <span
          className={`absolute top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 ${won ? 'bg-vermilion shadow-[0_0_14px_rgba(224,77,38,0.8)]' : 'bg-white/90'}`}
          style={{ left: `${settlePct}%` }}
        />
        <span
          aria-hidden="true"
          className={`absolute top-[calc(50%-14px)] h-1.5 w-1.5 -translate-x-1/2 rounded-full ${won ? 'bg-vermilion' : 'bg-white/90'}`}
          style={{ left: `${settlePct}%` }}
        />

        {/* settle label below the axis */}
        <div
          className={`absolute bottom-0 -translate-x-1/2 whitespace-nowrap font-mono text-[8.5px] uppercase tracking-[0.06em] tabular-nums ${won ? 'text-vermilion' : 'text-white/80'}`}
          style={{ left: `${clampLabel(settlePct)}%` }}
        >
          {settleWord} {fmtPx(settle)}
        </div>
      </div>
    </div>
  );
}
