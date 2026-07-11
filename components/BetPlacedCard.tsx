'use client';

// The Call — the award-winning, shareable card shown the instant a bet lands.
// The live-position sibling of the Settlement Receipt: same near-black ground,
// grain, registration ticks and JP hanko language, but the vermilion heat here
// reads as CONVICTION (skin in the game), not a win. The clock is alive — a
// ticking countdown over a draining bar — because the call is still open.
//
// The PNG export (lib/openBetShareCard.ts) freezes this exact moment for sharing.
// Honesty mirrors the export: no result is implied, the return is conditional
// ("win if it lands"), leverage carries its knockout caveat, and the settle time
// is the market's real expiry.

import { useMemo, type ReactNode } from 'react';
import {
  callBandLabel,
  callDirLabel,
  fmtLeverage,
  fmtSettleUtc,
  shortCallId,
  type OpenBetCard,
} from '@/lib/openBetShareCard';
import ShareBetButton from '@/components/ShareBetButton';

const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad2 = (n: number) => String(n).padStart(2, '0');

// scoped film grain — same tile the Settlement Receipt uses, for one visual family
const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'Settling…';
  const s = Math.floor(msLeft / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

export default function BetPlacedCard({
  call,
  nowMs,
  actions,
}: {
  call: OpenBetCard;
  /** ticking clock (ms) — parent owns the interval so the countdown stays live */
  nowMs: number;
  /** secondary buttons rendered under the share CTA (portfolio / place another) */
  actions?: ReactNode;
}) {
  const band = callBandLabel(call);
  const dirLine = callDirLabel(call);
  const isRange = call.kind === 'range';
  const msLeft = nowMs > 0 ? call.expiryMs - nowMs : call.expiryMs;

  // draining bar: fraction of MY holding window still to run (placed → bell)
  const drainPct = useMemo(() => {
    if (!call.placedAtMs || nowMs <= 0) return null;
    const total = call.expiryMs - call.placedAtMs;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, (call.expiryMs - nowMs) / total));
  }, [call.placedAtMs, call.expiryMs, nowMs]);

  return (
    <div>
      {/* ── the ticket — a forced-dark island (see globals.css DARK ISLANDS): a
          photographic dark surface that keeps true light-on-dark ink even when
          the page is in cream light mode, matching the shared PNG export. ── */}
      <div
        data-theme="dark"
        className="relative overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]"
        style={{ background: 'radial-gradient(130% 90% at 50% -10%, #16110c 0%, #0d0a08 46%, #080605 100%)' }}
      >
        {/* film grain */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
        {/* top spark rule */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-vermilion/60 to-transparent" />
        {/* registration ticks */}
        <span aria-hidden="true" className="pointer-events-none absolute left-2 top-2 z-20 h-2.5 w-2.5 border-l border-t border-white/20" />
        <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 z-20 h-2.5 w-2.5 border-r border-t border-white/20" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-2 left-2 z-20 h-2.5 w-2.5 border-b border-l border-white/20" />
        <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 z-20 h-2.5 w-2.5 border-b border-r border-white/20" />
        {/* ghost hanko — 賭 (wager) */}
        <span aria-hidden="true" className="pointer-events-none absolute -right-5 top-14 z-0 select-none font-jp text-[150px] leading-none text-white/[0.035]">賭</span>

        <div className="relative z-10 p-6">
          {/* masthead */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-jp text-[15px] leading-none text-white/55">予</span>
              <span className="font-display text-[11px] font-extrabold tracking-[0.2em] text-white/90">YOSUKU</span>
            </div>
            <span className="font-mono text-[9px] tracking-[0.18em] text-white/40">N° {shortCallId(call)}</span>
          </div>
          <div className="mt-3 h-px bg-white/[0.08]" />

          {/* eyebrow + hero call */}
          <div className="mt-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-vermilion">
            <span>{dirLine}</span>
            <span className="text-white/25">·</span>
            <span className="text-white/45">Call placed</span>
          </div>
          <h3 className="mt-2 font-display text-[1.9rem] font-[850] leading-[1.06] text-white text-balance">
            {band}
          </h3>
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-white/40">
            {isRange
              ? 'Wins if BTC is inside the band at the bell.'
              : `Wins if BTC is ${call.dir === 'up' ? 'above' : 'below'} the strike at the bell.`}
          </p>

          {/* wager strip */}
          <div className="mt-4 flex items-stretch justify-between gap-3 border-y border-white/[0.08] py-3.5">
            <div className="min-w-0">
              <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-white/40">You stake</div>
              <div className="mt-1 font-display text-[1.35rem] font-bold leading-none tabular-nums text-white">{fmt2(call.stakeDusdc)}</div>
            </div>
            <div className="flex items-center text-white/25" aria-hidden="true">→</div>
            <div className="min-w-0 text-right">
              <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-white/40">Win if it lands</div>
              <div className="mt-1 font-display text-[1.35rem] font-bold leading-none tabular-nums text-vermilion">
                {fmt2(call.winDusdc)}
                {call.lev > 1 && <span className="align-super text-[0.6em] text-vermilion/70"> ✦</span>}
              </div>
            </div>
          </div>
          {call.lev > 1 && (
            <p className="mt-2 font-mono text-[8.5px] leading-relaxed text-white/40">
              ✦ {fmtLeverage(call.lev)} leverage — can knock out before the bell.
            </p>
          )}

          {/* live countdown + draining bar */}
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-white/40">Settles in</span>
              <span className="font-mono text-[9.5px] tabular-nums text-white/40">{fmtSettleUtc(call.expiryMs)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion/70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-vermilion" />
              </span>
              <span className="font-display text-[1.5rem] font-bold leading-none tabular-nums text-white">{fmtCountdown(msLeft)}</span>
            </div>
            {drainPct != null && (
              <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                <div className="h-full rounded-full bg-vermilion transition-[width] duration-1000 ease-linear" style={{ width: `${drainPct * 100}%` }} />
              </div>
            )}
          </div>

          {/* verify */}
          <a
            href={SUISCAN_TX(call.digest)}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1 font-mono text-[10px] text-white/40 transition-colors hover:text-white"
            data-cursor="hover"
          >
            verify on Suiscan ↗
          </a>
        </div>
      </div>

      {/* ── share = the whole point of this moment ── */}
      <ShareBetButton
        call={call}
        label="Share this call"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-vermilion px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-vermilion-d disabled:cursor-wait disabled:opacity-60"
      />

      {actions}
    </div>
  );
}
