'use client';

// The Feed — a TikTok-style vertical scroll of live markets. One full-screen card per
// tradeable round: the live price chart, the take ("BTC above $X?"), the bell, and a
// one-tap UP/DOWN into the market. Each card lazy-draws its chart only when it scrolls
// into view (IntersectionObserver) so 20+ live charts don't all fetch at once.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil, ChevronDown, ArrowLeft } from 'lucide-react';
import TakeComposer from '@/components/TakeComposer';
import { useOracles } from '@/lib/sui/hooks';
import { fetchPriceHistory, fetchLatestPrices, type OracleData } from '@/lib/sui/predictApi';
import { getCanonicalMarketLine } from '@/lib/marketLine';
import { drawPriceLine } from '@/lib/charts/canvasChart';
import { getTimeRemaining, formatCountdown } from '@/lib/roundHelpers';
import { FLOAT_SCALING } from '@/lib/sui/constants';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function FeedCard({ oracle, settled }: { oracle: OracleData; settled: OracleData[] }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seriesRef = useRef<number[] | null>(null);
  const visibleRef = useRef(false);
  const rafRef = useRef(0);
  const drawDataRef = useRef<{ series: number[]; strike: number } | null>(null);
  const [strikeD, setStrikeD] = useState<number | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [upProb, setUpProb] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => { setNowMs(Date.now()); const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id); }, []);

  // Fetch (history once) + live price, compute the win-line + odds, and redraw.
  async function tick() {
    try {
      if (!seriesRef.current) {
        const history = await fetchPriceHistory(oracle.oracle_id, 100);
        if (history.length > 3) {
          seriesRef.current = history.slice().sort((a, b) => a.timestamp - b.timestamp).map(h => h.spot / FLOAT_SCALING);
        }
      }
      const p = await fetchLatestPrices(oracle.oracle_id).catch(() => null);
      const liveSpot = p?.spot ? p.spot / FLOAT_SCALING : null;
      const refP = p?.forward || p?.spot || (liveSpot ? liveSpot * FLOAT_SCALING : null);
      const line = getCanonicalMarketLine({ oracle, settledOracles: settled, referencePrice: refP });
      const strike = line && line.source !== 'grid-fallback' ? line.strike / FLOAT_SCALING : (oracle.min_strike / FLOAT_SCALING);
      setStrikeD(strike);
      if (liveSpot) setLive(liveSpot);

      const base = seriesRef.current ?? (liveSpot ? [liveSpot] : []);
      const series = liveSpot ? [...base, liveSpot] : base;
      if (series.length > 1) {
        const first = series[0], last = series[series.length - 1];
        setDelta(first > 0 ? ((last - first) / first) * 100 : 0);
      }
      // light logistic estimate for the UP odds (real price lives on the detail page)
      const fwd = refP ? refP / FLOAT_SCALING : liveSpot;
      if (fwd && strike > 0) {
        const diff = (fwd - strike) / strike;
        const secsLeft = Math.max(60, (oracle.expiry - Date.now()) / 1000);
        const sigma = 0.001 * Math.sqrt(secsLeft / 60);
        const z = diff / (sigma || 0.01);
        setUpProb(Math.round(Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z))))));
      }
      if (series.length > 1) {
        drawDataRef.current = { series, strike };
      }
    } catch { /* keep last frame */ }
  }

  // Lazy: only fetch/draw when the card is on screen; poll while visible.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const drawFrame = (now: number) => {
      const d = drawDataRef.current;
      if (canvasRef.current && d && d.series.length > 1) {
        drawPriceLine(canvasRef.current, d.series, {
          target: d.strike,
          targetLabel: `Win line · ${usd(d.strike)}`,
          gridLines: true,
          axisRight: 56,
          padX: 14,
          padTop: 12,
          padBot: 12,
          motion: true,
          now,
        });
      }
      rafRef.current = requestAnimationFrame(drawFrame);
    };
    const startRaf = () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(drawFrame); };
    const stopRaf = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
    const io = new IntersectionObserver(([e]) => {
      visibleRef.current = e.isIntersecting;
      if (e.isIntersecting) { tick(); startRaf(); } else { stopRaf(); }
    }, { threshold: 0.4 });
    io.observe(el);
    const poll = setInterval(() => { if (visibleRef.current) tick(); }, 10_000);
    return () => { io.disconnect(); clearInterval(poll); stopRaf(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oracle.oracle_id]);

  const t = getTimeRemaining(oracle.expiry);
  const closing = nowMs > 0 && nowMs >= oracle.expiry - 20_000;
  const asset = oracle.underlying_asset || 'BTC';
  const up = upProb ?? null;

  return (
    <section
      ref={cardRef}
      className="relative h-[100dvh] w-full snap-start shrink-0 flex items-center justify-center px-3 sm:px-4 bg-black"
    >
      {/* ambient glow behind the reel */}
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: 'radial-gradient(55% 45% at 50% 32%, rgba(224,77,38,0.10), transparent 70%)' }} />

      {/* the reel — a Shorts-style portrait card, a touch wider than 9:16, near full-height */}
      <div className="relative z-10 flex h-[97dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#070708] shadow-[0_30px_120px_rgba(0,0,0,0.6)]">
        {/* faint top glow inside the card */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.5]" style={{ background: 'radial-gradient(120% 50% at 50% 0%, rgba(224,77,38,0.10), transparent 58%)' }} />

        {/* top meta — pushed below the fixed top bar */}
        <div className="relative z-10 flex items-start justify-between px-5 pt-14">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full border border-white/15 flex items-center justify-center text-vermilion text-sm">{asset === 'BTC' ? '₿' : asset[0]}</span>
              <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-gray-500">{asset} · price-oracle settled</span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-gray-500">Closes in</div>
            <div className={`font-display text-xl font-extrabold tabular-nums ${closing ? 'text-vermilion' : 'text-white'}`}>{formatCountdown(t)}</div>
          </div>
        </div>

        {/* the take */}
        <div className="relative z-10 px-5 mt-4">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-white leading-[1.05]">
            Will {asset} be above<br /><span className="text-vermilion">{strikeD ? usd(strikeD) : '—'}</span>?
          </h2>
          <div className="mt-1.5 font-mono text-[11px] text-gray-500">when the timer hits zero · closes in {formatCountdown(t)}</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="font-mono text-lg text-white">{live ? usd(live) : '—'}</span>
            {delta !== null && (
              <span className={`font-mono text-xs ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{delta >= 0 ? '+' : ''}{delta.toFixed(2)}%</span>
            )}
            <span className="font-mono text-[10px] text-gray-600 uppercase tracking-wider">live oracle</span>
          </div>
        </div>

        {/* chart fills the middle */}
        <div className="relative z-10 flex-1 min-h-0 px-2 mt-2">
          <canvas ref={canvasRef} className="w-full h-full" />
        </div>

        {/* tap zone */}
        <div className="relative z-10 px-5 pb-6">
          <div className="font-mono text-[10px] text-gray-600 uppercase tracking-[0.16em] mb-2 text-center">winning side pays $1 · one tap</div>
          <div className="grid grid-cols-2 gap-3">
            <Link
              href={`/markets/${oracle.oracle_id}?side=UP`}
              className="rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold text-lg py-4 text-center active:scale-[0.98] transition-transform"
            >
              UP <span className="text-sm text-emerald-400/80">{up !== null ? `${up}¢` : ''}</span>
            </Link>
            <Link
              href={`/markets/${oracle.oracle_id}?side=DOWN`}
              className="rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-300 font-bold text-lg py-4 text-center active:scale-[0.98] transition-transform"
            >
              DOWN <span className="text-sm text-rose-400/80">{up !== null ? `${100 - up}¢` : ''}</span>
            </Link>
          </div>
          <Link href={`/markets/${oracle.oracle_id}`} className="block text-center mt-3 font-mono text-[11px] text-gray-500 hover:text-white transition-colors">
            full market · chart · strikes ↗
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function FeedPage() {
  const { active, settled, loading } = useOracles();
  const [composing, setComposing] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  return (
    <div className="bg-black text-white">
      {/* minimal top bar — keep it immersive */}
      <div className="fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 sm:px-6 py-3 bg-gradient-to-b from-black/85 to-transparent pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2.5">
          <Link
            href="/markets"
            aria-label="Back to markets"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.1] hover:text-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link href="/" aria-label="Yosuku home" className="flex items-center gap-2">
            <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]">
              <line x1="9" y1="2" x2="9" y2="6" stroke="white" strokeWidth="1.4" />
              <line x1="9" y1="12" x2="9" y2="16" stroke="white" strokeWidth="1.4" />
              <rect x="6" y="6" width="6" height="6" fill="none" stroke="white" strokeWidth="1.4" />
              <circle cx="13" cy="6" r="1.4" fill="var(--vermilion)" />
            </svg>
            <span className="font-display font-extrabold tracking-tight text-sm text-white">YOSUKU</span>
          </Link>
        </div>
        <div className="pointer-events-auto">
          <button
            onClick={() => setComposing(true)}
            className="flex items-center gap-2 rounded-full bg-vermilion hover:bg-vermilion-d text-white font-bold text-sm px-5 py-2.5 transition-colors shadow-[0_4px_20px_rgba(224,77,38,0.4)]"
          >
            <Pencil className="w-4 h-4" /> Post a take
          </button>
        </div>
      </div>

      {loading && active.length === 0 ? (
        <div className="h-[100dvh] flex items-center justify-center font-mono text-sm text-gray-500">loading the feed…</div>
      ) : active.length === 0 ? (
        <div className="h-[100dvh] flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-gray-400">No live rounds right now.</p>
          <Link href="/markets" className="font-mono text-[12px] text-vermilion">back to markets →</Link>
        </div>
      ) : (
        <main
          className="h-[100dvh] overflow-y-scroll snap-y snap-mandatory no-scrollbar"
          onScroll={(e) => { if (!scrolled && e.currentTarget.scrollTop > 40) setScrolled(true); }}
        >
          {active.map((o) => (
            <FeedCard key={o.oracle_id} oracle={o} settled={settled} />
          ))}
        </main>
      )}

      {/* minimalist scroll-down cue — fades the moment the user starts scrolling */}
      {!loading && active.length > 1 && (
        <div
          className={`pointer-events-none fixed bottom-5 left-1/2 z-30 -translate-x-1/2 flex flex-col items-center gap-1 transition-opacity duration-500 ${scrolled ? 'opacity-0' : 'opacity-100'}`}
        >
          <span className="font-mono text-[9px] uppercase tracking-[0.28em] text-white/40">Scroll</span>
          <ChevronDown className="h-4 w-4 text-white/50 animate-bounce" />
        </div>
      )}

      {composing && active.length > 0 && (
        <TakeComposer oracles={active} onClose={() => setComposing(false)} />
      )}
    </div>
  );
}
