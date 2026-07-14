'use client';

// A take, as it appears in the feed — the social sibling of "The Call" card.
// A take is a public post backed by a real on-chain position: the caller's WORDS
// are the hero (the human voice), framed by the call and stamped with provenance
// (backed-by-a-position badge, Walrus content, verify-on-Suiscan). Same dark-island
// look as BetPlacedCard so the feed reads as one family.
//
// Honesty: the "✓ position" badge shows ONLY when the take is backed (orderId set);
// an unbacked take is plainly "open call — no bet linked". The call line is derived
// from the on-chain event fields, the caption from the Walrus blob.

import type { FeedTake } from '@/lib/sui/takeBoard';

const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const SUISCAN_ADDR = (a: string) => `https://suiscan.xyz/testnet/account/${a}`;

const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.5 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`;

const shortAddr = (a: string) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || 'anon');

function usd(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

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

/** The call, from on-chain event fields (side + strike, or band from the blob). */
function callParts(t: FeedTake): { glyph: string; dir: string; band: string } {
  if (t.side === 2) {
    const band = t.lowerUsd != null && t.higherUsd != null ? `${usd(t.lowerUsd)}–${usd(t.higherUsd)}` : 'a band';
    return { glyph: '◆', dir: 'RANGE', band: `BTC ${band}` };
  }
  if (t.side === 1) return { glyph: '▼', dir: 'DOWN', band: `BTC under ${usd(t.strikeUsd)}` };
  return { glyph: '▲', dir: 'UP', band: `BTC over ${usd(t.strikeUsd)}` };
}

// deterministic avatar hue from the address — a quiet identity mark, not the accent
function hue(addr: string): number {
  let h = 0;
  for (let i = 2; i < Math.min(addr.length, 12); i++) h = (h * 31 + addr.charCodeAt(i)) % 360;
  return h;
}

export default function TakeCard({ take }: { take: FeedTake }) {
  const { glyph, dir, band } = callParts(take);
  const h = hue(take.author);

  return (
    <article
      data-theme="dark"
      className="relative overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_24px_64px_-40px_rgba(0,0,0,0.9)]"
      style={{ background: 'radial-gradient(130% 90% at 50% -10%, #16110c 0%, #0d0a08 46%, #080605 100%)' }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-vermilion/50 to-transparent" />

      <div className="relative z-10 p-5">
        {/* author + provenance */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-8 w-8 shrink-0 rounded-full ring-1 ring-white/10"
              style={{ background: `radial-gradient(120% 120% at 30% 20%, hsl(${h} 55% 55%), hsl(${(h + 40) % 360} 45% 28%))` }}
            />
            <div className="min-w-0">
              <a href={SUISCAN_ADDR(take.author)} target="_blank" rel="noreferrer" className="block truncate font-mono text-[11px] text-white/80 hover:text-white transition-colors" data-cursor="hover">
                {shortAddr(take.author)}
              </a>
              <div className="font-mono text-[9px] text-white/40">{timeAgo(take.tsMs)}{take.cadence ? ` · ${take.cadence} market` : ''}</div>
            </div>
          </div>
          {take.backed ? (
            <span className="shrink-0 rounded-full border border-vermilion/40 bg-vermilion/[0.08] px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-vermilion">
              ✓ position
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-white/45">
              open call
            </span>
          )}
        </div>

        {/* the call */}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em]">
          <span className="text-vermilion">{glyph} {dir}</span>
          <span className="text-white/25">·</span>
          <span className="text-white/55">{band}</span>
          {take.stakeDusdc != null && take.stakeDusdc > 0 && (
            <>
              <span className="text-white/25">·</span>
              <span className="text-white/45 normal-case tracking-normal">{take.stakeDusdc.toFixed(2)} on it</span>
            </>
          )}
        </div>

        {/* the voice — the hero of a take */}
        {take.caption ? (
          <p className="mt-2.5 font-display text-[1.2rem] font-medium leading-snug text-white text-balance">
            {take.caption}
          </p>
        ) : (
          <p className="mt-2.5 font-mono text-[12px] italic leading-snug text-white/40">no note — the call speaks for itself.</p>
        )}

        {/* provenance footer */}
        <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-3">
          <div className="flex items-center gap-3 font-mono text-[9px] text-white/40">
            <span className="inline-flex items-center gap-1" title="Content stored on Walrus">◆ on Walrus</span>
            {take.digest && (
              <a href={SUISCAN_TX(take.digest)} target="_blank" rel="noreferrer" className="hover:text-white transition-colors" data-cursor="hover">
                verify ↗
              </a>
            )}
          </div>
          {/* comments land here in slice 4 (Seal-gated by position) */}
          <span className="font-mono text-[9px] text-white/30">comments soon</span>
        </div>
      </div>
    </article>
  );
}
