'use client';

// A take as a FULL-SCREEN reel card — the social sibling of the market ReelCard,
// so the /feed snap scroll (the TikTok moat) reads as one continuous stream of
// live bells + community calls. The caption (the human voice) is the hero; the
// call frames it; provenance (backed badge, Walrus, verify) grounds it as real.

import Link from 'next/link';
import type { FeedTake } from '@/lib/sui/takeBoard';

const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const SUISCAN_ADDR = (a: string) => `https://suiscan.xyz/testnet/account/${a}`;
const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || 'anon');

function timeAgo(ms: number): string {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function callParts(t: FeedTake): { glyph: string; dir: string; band: string; other: string } {
  if (t.side === 2) {
    const band = t.lowerUsd != null && t.higherUsd != null ? `${usd0(t.lowerUsd)}–${usd0(t.higherUsd)}` : 'a band';
    return { glyph: '◆', dir: 'RANGE', band: `BTC ${band}`, other: 'Trade this market' };
  }
  if (t.side === 1) return { glyph: '▼', dir: 'DOWN', band: `BTC under ${usd0(t.strikeUsd)}`, other: 'Take the other side' };
  return { glyph: '▲', dir: 'UP', band: `BTC over ${usd0(t.strikeUsd)}`, other: 'Take the other side' };
}

function hue(addr: string): number {
  let h = 0;
  for (let i = 2; i < Math.min(addr.length, 12); i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return h;
}

export default function TakeReelCard({ take }: { take: FeedTake }) {
  const { glyph, dir, band, other } = callParts(take);
  const h = hue(take.author);

  return (
    <section className="feed-card flex items-center justify-center px-3 pt-2 pb-[92px]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: 'radial-gradient(52% 42% at 50% 34%, rgba(224,77,38,0.07), transparent 70%)' }}
      />

      <div
        data-theme="dark"
        className="relative z-10 flex h-full w-full max-w-[460px] flex-col overflow-hidden rounded-[26px] border border-white/[0.1] shadow-[0_30px_120px_-30px_rgba(0,0,0,0.9)]"
        style={{ background: 'radial-gradient(130% 80% at 50% -8%, #16110d 0%, #0c0a08 44%, #080605 100%)' }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 z-30 opacity-[0.05] mix-blend-overlay"
          style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")" }} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-vermilion/50 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute -right-5 top-16 z-0 select-none font-jp text-[150px] font-bold leading-none text-white/[0.022]">賭</span>

        {/* author */}
        <div className="relative z-10 flex items-center justify-between px-5 pt-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="h-9 w-9 shrink-0 rounded-full ring-1 ring-white/10"
              style={{ background: `radial-gradient(120% 120% at 30% 20%, hsl(${h} 55% 55%), hsl(${(h + 40) % 360} 45% 28%))` }} />
            <div className="min-w-0">
              <a href={SUISCAN_ADDR(take.author)} target="_blank" rel="noreferrer" className="block truncate font-mono text-[12px] text-white/85 hover:text-white transition-colors">
                {shortAddr(take.author)}
              </a>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">
                {timeAgo(take.tsMs)}{take.cadence ? ` · ${take.cadence} market` : ''}
              </div>
            </div>
          </div>
          {take.backed ? (
            <span className="shrink-0 rounded-full border border-vermilion/40 bg-vermilion/[0.08] px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-vermilion">✓ position</span>
          ) : (
            <span className="shrink-0 rounded-full border border-white/12 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-white/45">open call</span>
          )}
        </div>

        {/* the call chip */}
        <div className="relative z-10 mt-5 px-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-vermilion/25 bg-vermilion/[0.05] px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
            <span className="text-vermilion">{glyph} {dir}</span>
            <span className="text-white/25">·</span>
            <span className="text-white/65">{band}</span>
          </div>
        </div>

        {/* the voice — the hero, fills the middle */}
        <div className="relative z-10 flex min-h-0 flex-1 items-center px-6">
          {take.caption ? (
            <p className="font-display text-[30px] font-bold leading-[1.12] tracking-tight text-white text-balance">
              {take.caption}
            </p>
          ) : (
            <p className="font-display text-[24px] font-medium italic leading-snug text-white/45">
              No note — the call speaks for itself.
            </p>
          )}
        </div>

        {/* footer: provenance + act */}
        <div className="relative z-10 px-5 pb-6 pt-2">
          <div className="mb-3 flex items-center gap-3 font-mono text-[9px] text-white/40">
            <span title="Content stored on Walrus">◆ on Walrus</span>
            {take.digest && <a href={SUISCAN_TX(take.digest)} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">verify ↗</a>}
            <span className="ml-auto text-white/30">comments soon</span>
          </div>
          <Link href="/markets" data-cursor="hover" style={{ outline: 'none' }}
            className="block rounded-2xl border border-white/15 bg-white/[0.02] py-3.5 text-center font-display text-[15px] font-bold text-white/85 transition-colors hover:border-vermilion/50 hover:text-white">
            {other} →
          </Link>
        </div>
      </div>
    </section>
  );
}
