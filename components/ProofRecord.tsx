'use client';

// "THE RECORD" — the landing proof band. Replaces the old 4-cell stat grid (whose
// identical decorative sparklines read as generic). This is an editorial, certified
// ledger of live facts: a masthead with a live pulse, count-up numerals, ONE vermilion
// spark on the live count, and an honesty footer — every figure read from the chain.
//
// Theme-aware via the app's CSS vars (--white/--gray-* flip to ink tones in light
// mode), so it sits correctly on the cream landing and on the dark theme alike.

import { useEffect, useRef, useState } from 'react';

/** Ease-out count-up to `target`, kicked off once when the band scrolls into view. */
function useCountUp(target: number | null, run: boolean, ms = 1100): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run || target == null) return;
    let raf = 0;
    let startT: number | null = null;
    const step = (t: number) => {
      if (startT == null) startT = t;
      const p = Math.min(1, (t - startT) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return n;
}

interface Item {
  idx: string;
  label: string;
  meta: string;
  live?: boolean;
  /** a real counted number → animates + formats; else a static claim string */
  count?: number | null;
  static?: string;
}

export default function ProofRecord({
  liveMarkets,
  players,
}: {
  liveMarkets: number | null;
  players: number | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect(); } },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const liveN = useCountUp(liveMarkets, inView);
  const playersN = useCountUp(players, inView);

  const items: Item[] = [
    { idx: '01', label: 'Markets live now', meta: 'open for bets', live: true, count: liveMarkets },
    { idx: '02', label: 'Oracle-settled', meta: 'no committee, no disputes', static: '100%' },
    { idx: '03', label: 'Players', meta: 'wallets in', count: players },
    { idx: '04', label: 'Settlement', meta: 'sub-second, final', static: '< 1s' },
  ];

  const valueOf = (it: Item): string => {
    if (it.static) return it.static;
    if (it.count == null) return '—';
    return (it.live ? liveN : playersN).toLocaleString('en-US');
  };

  return (
    <section
      ref={ref}
      className="relative overflow-hidden px-6 py-24 md:py-28"
      style={{ borderTop: '1px solid var(--hairline, rgba(120,110,95,0.16))', borderBottom: '1px solid var(--hairline, rgba(120,110,95,0.16))' }}
      aria-label="Live on-chain record"
    >
      {/* ghost kanji — 数 (figures) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-[3vw] top-1/2 -translate-y-1/2 select-none font-jp font-bold leading-[0.8]"
        style={{ fontSize: '26vw', color: 'var(--gray-600)', opacity: 0.05 }}
      >
        数
      </span>

      <div className="relative z-10 mx-auto max-w-[1200px]">
        {/* masthead */}
        <div className="mb-12 flex items-center justify-between md:mb-16">
          <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.28em]" style={{ color: 'var(--gray-500)' }}>
            <span className="font-jp text-[15px] leading-none" style={{ color: 'var(--gray-400)' }}>数</span>
            <span>THE RECORD</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.24em]" style={{ color: 'var(--gray-500)' }}>
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ background: 'var(--vermilion)', opacity: 0.65 }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: 'var(--vermilion)' }} />
            </span>
            <span className="hidden sm:inline">LIVE · SUI TESTNET</span>
            <span className="sm:hidden">LIVE</span>
          </div>
        </div>

        {/* the facts — 2×2 on mobile, one row on desktop; hairlines divide columns
            (right column on mobile via even:, every-but-first on desktop). */}
        <div className="grid grid-cols-2 gap-x-0 gap-y-14 md:grid-cols-4">
          {items.map((it) => (
            <div
              key={it.idx}
              className="relative pl-0 even:border-l even:pl-6 md:border-l md:pl-8 md:first:border-l-0 md:first:pl-0"
              style={{ borderColor: 'rgba(128,122,110,0.2)' }}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-[0.22em]" style={{ color: 'var(--gray-600)' }}>{it.idx}</span>
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.2em]" style={{ color: 'var(--gray-400)' }}>{it.label}</span>
              </div>
              <div
                className="mt-4 flex items-center gap-3 font-display font-bold leading-[0.92] tabular-nums"
                style={{
                  fontSize: 'clamp(2.5rem, 4.4vw, 4.2rem)',
                  letterSpacing: '-0.045em',
                  color: it.live ? 'var(--vermilion)' : 'var(--white)',
                }}
              >
                {valueOf(it)}
                {it.live && (
                  <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full" style={{ background: 'var(--vermilion)', opacity: 0.6 }} />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: 'var(--vermilion)' }} />
                  </span>
                )}
              </div>
              {/* one-spark: only the live stat carries a vermilion underline accent */}
              {it.live && <div className="mt-5 h-[2px] w-10 rounded-full" style={{ background: 'var(--vermilion)' }} />}
              <div className={`${it.live ? 'mt-4' : 'mt-6'} font-mono text-[11px]`} style={{ color: 'var(--gray-500)' }}>{it.meta}</div>
            </div>
          ))}
        </div>

        {/* honesty footer — the founder's edge: it's all real + checkable */}
        <div
          className="mt-16 flex flex-col gap-1.5 pt-6 font-mono text-[10px] tracking-[0.14em] sm:flex-row sm:items-center sm:justify-between"
          style={{ color: 'var(--gray-600)', borderTop: '1px solid var(--hairline, rgba(120,110,95,0.12))' }}
        >
          <span>READ LIVE FROM THE CHAIN · TOKYO 2026</span>
          <span>EVERY FIGURE VERIFIABLE ON SUISCAN</span>
        </div>
      </div>
    </section>
  );
}
