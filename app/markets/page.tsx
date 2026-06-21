'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useOracles } from '@/lib/sui/hooks';
import { type PriceData } from '@/lib/sui/predictApi';
import { getTimeRemaining, formatCountdown } from '@/lib/roundHelpers';
import { getCanonicalMarketLine } from '@/lib/marketLine';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { drawPriceLine, genCandles } from '@/lib/charts/canvasChart';
import { fetchPriceHistory } from '@/lib/sui/predictApi';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import { Search, X, ChevronDown, Clock, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';
import { loadFavorites, toggleFavorite } from '@/lib/favorites';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import MarketCard from '@/components/MarketCard';
import TradePanel from '@/components/TradePanel';
import SectionHeader from '@/components/SectionHeader';
import TheBell from '@/components/TheBell';
import Tutorial from '@/components/Tutorial';

// Quick probability estimate from forward vs the resolved fixed market line.
function computeQuickProb(p: PriceData, marketStrike: number, expiry: number, nowMs: number) {
  const fwd = p.forward / FLOAT_SCALING;
  const strike = marketStrike / FLOAT_SCALING;
  const diff = (fwd - strike) / (strike || 1);
  const secsLeft = Math.max(60, (expiry - nowMs) / 1000);
  const sigma = 0.001 * Math.sqrt(secsLeft / 60);
  const z = diff / (sigma || 0.01);
  return Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z))));
}

const LIVE_HORIZON_LABELS = ['15-min', '30-min', '45-min', '1-hr'] as const;

// Later rounds per asset, as live countdown chips. One shared 1s ticker.
function BellChips({ rows }: { rows: ReadonlyArray<readonly [string, { oracle_id: string; expiry: number }[]]> }) {
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  return (
    <div className="later-bells">
      {rows.map(([asset, list]) => (
        <div key={asset} className="later-bells-row">
          <span className="later-bells-asset">{asset}</span>
          <div className="later-bells-chips">
            {list.slice(0, 8).map(o => (
              <Link key={o.oracle_id} href={`/markets/${o.oracle_id}`} className="bell-chip" data-cursor="hover">
                {fmt(o.expiry - nowMs)}
              </Link>
            ))}
            {list.length > 8 && <span className="bell-chip more">+{list.length - 8}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MarketsPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const router = useRouter();
  const { active, settled, loading, error } = useOracles();
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const { price: btcPrice } = useBtcPrice();
  const heroCanvasRef = useRef<HTMLCanvasElement>(null);
  const heroStrikeRef = useRef<number | null>(null);
  const heroStrikeSourceRef = useRef<string | null>(null);
  // Cache the hero price series per oracle so live ticks redraw without
  // re-fetching /prices — this effect runs on every btcPrice/prices change.
  const heroSeriesRef = useRef<{ id: string; series: number[] } | null>(null);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'closing' | 'probability'>('closing');
  const [sortOpen, setSortOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Keyboard shortcuts
  useKeyboardShortcuts(useMemo(() => ({
    '/': () => searchRef.current?.focus(),
  }), []));

  // Load favorites from localStorage on mount
  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  const handleToggleFavorite = useCallback((oracleId: string) => {
    const updated = toggleFavorite(oracleId);
    setFavorites(new Set(updated));
  }, []);

  // Fetch prices via combined server route (avoids proxy bottleneck)
  useEffect(() => {
    let cancelled = false;
    async function loadPrices() {
      try {
        const res = await fetch('/api/oracles?prices=1');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.prices) {
          setPrices(data.prices as Record<string, PriceData>);
        }
      } catch { /* ignore */ }
    }
    loadPrices();
    const interval = setInterval(loadPrices, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Hero chart — use real BTC price history from first BTC oracle
  const [heroChartDelta, setHeroChartDelta] = useState<string | null>(null);
  const [heroYesProb, setHeroYesProb] = useState<number | null>(null);
  // The hero chart IS the headline live market — tradable, not decoration.
  const [heroOracle, setHeroOracle] = useState<{ id: string; expiry: number; strike: number; strikeDollars: number } | null>(null);
  // Raw OracleData for the hero market — feeds the embedded TradePanel (same panel the detail page uses).
  const heroRawOracle = useMemo(
    () => (heroOracle ? active.find(o => o.oracle_id === heroOracle.id) ?? null : null),
    [active, heroOracle],
  );
  // Expand the hero market into a full detail modal (click the card → morph open).
  const [expanded, setExpanded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const modalCanvasRef = useRef<HTMLCanvasElement>(null);
  // Fade the "scroll for markets" cue once the user starts scrolling.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Lock body scroll + close on Escape while the modal is open.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [expanded]);
  // Draw the expanded chart from the cached hero series (+ live tick), retrying until the canvas mounts.
  useEffect(() => {
    if (!expanded || !heroOracle) return;
    let raf = 0;
    const tryDraw = () => {
      if (!modalCanvasRef.current) { raf = requestAnimationFrame(tryDraw); return; }
      const base = heroSeriesRef.current?.series ?? [];
      const series = btcPrice ? [...base, btcPrice] : base;
      if (series.length >= 2) {
        drawPriceLine(modalCanvasRef.current, series, {
          target: heroOracle.strikeDollars,
          targetLabel: `Win line · $${Math.round(heroOracle.strikeDollars).toLocaleString()}`,
          verdict: true, gridLines: true, axisRight: 64, padX: 18, padTop: 16, padBot: 16,
        });
      }
    };
    tryDraw();
    return () => cancelAnimationFrame(raf);
  }, [expanded, heroOracle, btcPrice]);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!heroCanvasRef.current) return;
    let cancelled = false;
    let raf = 0;

    async function renderHeroChart() {
      // Soonest BTC round that is still TRADABLE — skip expired-but-unsettled
      // rounds so the hero rotates at the bell instead of going stale.
      const btcOracle = active
        .filter(o => o.underlying_asset === 'BTC' && (!nowMs || o.expiry > nowMs))
        .sort((a, b) => a.expiry - b.expiry)[0];
      if (btcOracle) {
        // New round → forget the previous round's pinned strike and series.
        if (heroSeriesRef.current && heroSeriesRef.current.id !== btcOracle.oracle_id) {
          heroSeriesRef.current = null;
          heroStrikeRef.current = null;
          heroStrikeSourceRef.current = null;
        }
        try {
          // Fetch history once per oracle; live ticks reuse the cached series.
          let series = heroSeriesRef.current?.id === btcOracle.oracle_id
            ? heroSeriesRef.current.series
            : null;
          if (!series) {
            const history = await fetchPriceHistory(btcOracle.oracle_id, 100);
            if (!cancelled && history.length > 5) {
              series = history
                .slice()
                .sort((a, b) => a.timestamp - b.timestamp)
                .map(h => h.spot / FLOAT_SCALING);
              heroSeriesRef.current = { id: btcOracle.oracle_id, series };
            }
          }
          if (series && series.length > 1) {
            // Append the live oracle price as the newest tick so the end-dot + delta
            // track the header price instead of lagging on the historical series.
            const liveSeries = (btcPrice && Number.isFinite(btcPrice)) ? [...series, btcPrice] : series;
            const first = liveSeries[0];
            const last = liveSeries[liveSeries.length - 1];
            const delta = first > 0 ? ((last - first) / first * 100).toFixed(2) : '0.00';
            if (!cancelled) setHeroChartDelta(`${Number(delta) >= 0 ? '+' : ''}${delta}%`);

            const p0 = prices[btcOracle.oracle_id];
            const refP = p0?.forward || p0?.spot || (btcPrice ? btcPrice * FLOAT_SCALING : null);
            const line = getCanonicalMarketLine({
              oracle: btcOracle,
              settledOracles: settled,
              referencePrice: refP,
            });
            if (
              line &&
              line.source !== 'grid-fallback' &&
              (heroStrikeRef.current === null ||
                (heroStrikeSourceRef.current !== 'previous-settlement' && line.source === 'previous-settlement'))
            ) {
              heroStrikeRef.current = line.strike;
              heroStrikeSourceRef.current = line.source;
            }
            const midStrike = heroStrikeRef.current;
            if (midStrike === null) {
              if (!cancelled) setHeroOracle(null);
              return;
            }
            const midDollars = midStrike / FLOAT_SCALING;
            if (!cancelled) {
              // Functional update with identity bail-out — returning a fresh
              // object unconditionally here loops the render cycle to death
              // (effect deps get new identities every render).
              setHeroOracle(prev =>
                prev && prev.id === btcOracle.oracle_id && prev.expiry === btcOracle.expiry && prev.strike === midStrike
                  ? prev
                  : { id: btcOracle.oracle_id, expiry: btcOracle.expiry, strike: midStrike, strikeDollars: midDollars },
              );
            }

            if (!cancelled) {
              // Compute yes probability from forward
              const p = prices[btcOracle.oracle_id];
              const fwdScaled = p?.forward || p?.spot || (btcPrice ? btcPrice * FLOAT_SCALING : null);
              if (fwdScaled) {
                const fwd = fwdScaled / FLOAT_SCALING;
                const diff = (fwd - midDollars) / midDollars;
                const secsLeft = Math.max(60, (btcOracle.expiry - nowMs) / 1000);
                const sigma = 0.001 * Math.sqrt(secsLeft / 60);
                const z = diff / (sigma || 0.01);
                setHeroYesProb(Math.round(Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z))))));
              }
            }

            if (!cancelled && heroCanvasRef.current) {
              const drawFrame = (now: number) => {
                if (cancelled || !heroCanvasRef.current) return;
                drawPriceLine(heroCanvasRef.current, liveSeries, {
                  target: midDollars,
                  targetLabel: `Win line · $${Math.round(midDollars).toLocaleString()}`,
                  verdict: true,
                  gridLines: true,
                  axisRight: 60,
                  padX: 14,
                  padTop: 12,
                  padBot: 12,
                  motion: true,
                  now,
                });
                raf = window.requestAnimationFrame(drawFrame);
              };
              raf = window.requestAnimationFrame(drawFrame);
              return;
            }
          }
        } catch { /* ignore, fall through to fallback */ }
      }

      // Fallback — generate a series from the live BTC stream
      if (!cancelled && heroCanvasRef.current) {
        const spot = btcPrice || 80000;
        const series = genCandles(42, 60, spot - spot * 0.008, spot, spot * 0.003).map(c => c.close);
        drawPriceLine(heroCanvasRef.current, series, {
          target: spot,
          targetLabel: `Win line · $${Math.round(spot).toLocaleString()}`,
          gridLines: true,
          axisRight: 60,
          padX: 14,
          padTop: 12,
          padBot: 12,
        });
      }
    }

    renderHeroChart();
    return () => { cancelled = true; if (raf) window.cancelAnimationFrame(raf); };
  }, [btcPrice, active, settled, prices, nowMs]);

  const recentSettled = settled.slice(0, 6);

  // Determine next expiry for TheBell
  const nextExpiry = useMemo(() => {
    if (active.length === 0) return undefined;
    const sorted = [...active].sort((a, b) => a.expiry - b.expiry);
    return sorted[0]?.expiry;
  }, [active]);

  // Filter + search + sort
  const filterOracles = useCallback((oracles: typeof active) => {
    let result = oracles;
    if (filter === 'FAV') {
      result = result.filter(o => favorites.has(o.oracle_id));
    } else if (filter !== 'all') {
      result = result.filter(o => o.underlying_asset === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(o =>
        (o.underlying_asset || '').toLowerCase().includes(q) ||
        o.oracle_id.toLowerCase().includes(q)
      );
    }
    if (sortBy === 'closing') {
      result = [...result].sort((a, b) => a.expiry - b.expiry);
    } else if (sortBy === 'probability') {
      // Sort by forward-based logistic probability (descending)
      result = [...result].sort((a, b) => {
        const pA = prices[a.oracle_id];
        const pB = prices[b.oracle_id];
        const refA = pA?.forward || pA?.spot || (btcPrice ? btcPrice * FLOAT_SCALING : null);
        const refB = pB?.forward || pB?.spot || (btcPrice ? btcPrice * FLOAT_SCALING : null);
        const lineA = getCanonicalMarketLine({ oracle: a, settledOracles: settled, referencePrice: refA });
        const lineB = getCanonicalMarketLine({ oracle: b, settledOracles: settled, referencePrice: refB });
        const probA = pA && lineA && nowMs ? computeQuickProb(pA, lineA.strike, a.expiry, nowMs) : 50;
        const probB = pB && lineB && nowMs ? computeQuickProb(pB, lineB.strike, b.expiry, nowMs) : 50;
        // Sort by distance from 50% (most decisive first)
        return Math.abs(probB - 50) - Math.abs(probA - 50);
      });
    }
    return result;
  }, [filter, searchQuery, sortBy, prices, favorites, nowMs, settled, btcPrice]);

  // Show the next four tradable bells as the active ladder. Predict still runs
  // 15-minute rounds; the labels describe how far out each round closes.
  const filteredActive = useMemo(() => filterOracles(active), [filterOracles, active]);
  const byAsset = useMemo(() => {
    const m = new Map<string, typeof active>();
    for (const o of filteredActive) {
      const a = o.underlying_asset || 'BTC';
      if (!m.has(a)) m.set(a, []);
      m.get(a)!.push(o);
    }
    for (const list of m.values()) list.sort((a, b) => a.expiry - b.expiry);
    return m;
  }, [filteredActive]);
  // Computed per render (the 1s clock tick re-renders) so the live ladder
  // rotates to the next round the moment one expires — never stuck on
  // "Expired" while the oracle waits for its settlement print.
  const liveLadder = [...filteredActive]
    .filter(o => o.expiry > nowMs)
    .sort((a, b) => a.expiry - b.expiry)
    .slice(0, LIVE_HORIZON_LABELS.length)
    .map((oracle, index) => ({
      oracle,
      horizonLabel: LIVE_HORIZON_LABELS[index] ?? `${(index + 1) * 15}-min`,
    }));
  const liveLadderIds = new Set(liveLadder.map(({ oracle }) => oracle.oracle_id));
  const laterBells = Array.from(byAsset.entries())
    .map(([asset, list]) => [asset, list.filter(o => o.expiry > nowMs && !liveLadderIds.has(o.oracle_id))] as const)
    .filter(([, list]) => list.length > 0);

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const close = () => setSortOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [sortOpen]);

  const FILTERS = ['all', 'FAV', 'BTC'];
  const favCount = active.filter(o => favorites.has(o.oracle_id)).length;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      {/* Page Hero */}
      <section className="page-hero markets-hero">
        <span className="crop tl" />
        <span className="crop tr" />
        <span className="crop bl" />
        <span className="crop br" />

        <span className="hero-meta tl">
          LAT 35.6762
          <span className="ln">LON 139.6503 / TOKYO</span>
        </span>
        <span className="hero-meta tr">
          EDITION 04 / OF 2026
          <span className="ln">SUI · TESTNET</span>
        </span>
        <span className="hero-meta bl">
          PLATE M-04
          <span className="ln">FLOOR · OPEN</span>
        </span>
        <span className="hero-meta br">
          R/N 015-2026-Q2
          <span className="ln">15 MIN CADENCE</span>
        </span>

        <div className="container">
          <div className="breadcrumb">
            <a href="/" data-cursor="hover">Home</a>
            <span className="sep">/</span>
            <span style={{ color: 'var(--white)' }}>Markets</span>
          </div>

          <div className="hero-grid hero-grid-mini">
            {/* Hero chart */}
            <div
              className="hero-chart"
              role={heroOracle ? 'button' : undefined}
              tabIndex={heroOracle ? 0 : undefined}
              aria-label={heroOracle ? 'Expand this market' : undefined}
              data-cursor={heroOracle ? 'hover' : undefined}
              style={{ cursor: heroOracle ? 'zoom-in' : undefined }}
              onClick={() => { if (heroOracle) setExpanded(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && heroOracle) setExpanded(true); }}
            >
              <div className="hero-chart-head">
                <div>
                  <div className="flex items-center gap-3 mb-2.5">
                    <span className="font-mono text-[9px] tracking-[0.16em] uppercase px-2.5 py-1 rounded-full border text-vermilion bg-vermilion/10 border-vermilion/20">Live</span>
                    <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-gray-600">BTC</span>
                  </div>
                  <h2 className="font-display font-[800] text-3xl sm:text-4xl text-white tracking-tight leading-[1.05]">
                    {heroOracle ? (
                      <>BTC above <span className="text-vermilion">{`$${heroOracle.strikeDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</span>?</>
                    ) : 'BTC · USD'}
                  </h2>
                  {heroOracle && btcPrice != null && (
                    <div className="flex items-center gap-2 mt-2.5 font-mono text-sm sm:text-base">
                      <span className={btcPrice >= heroOracle.strikeDollars ? 'text-profit font-semibold' : 'text-loss font-semibold'}>
                        {btcPrice >= heroOracle.strikeDollars
                          ? `$${Math.round(btcPrice - heroOracle.strikeDollars).toLocaleString()} above your line`
                          : `needs +$${Math.round(heroOracle.strikeDollars - btcPrice).toLocaleString()} to win`}
                      </span>
                      <span className="text-gray-600">·</span>
                      <span className="text-gray-400">{formatCountdown(getTimeRemaining(heroOracle.expiry))} left</span>
                    </div>
                  )}
                </div>
                {heroOracle && (
                  <div className="text-right shrink-0">
                    <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 block mb-1">Expires in</span>
                    <span className="font-mono text-2xl sm:text-3xl font-semibold text-white tabular-nums">{formatCountdown(getTimeRemaining(heroOracle.expiry))}</span>
                  </div>
                )}
              </div>
              <div className="hero-chart-canvas">
                <canvas ref={heroCanvasRef} />
                {heroOracle && (
                  <button
                    type="button"
                    className="hero-expand-btn"
                    aria-label="Expand market"
                    onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                  >
                    <Maximize2 />
                  </button>
                )}
              </div>
              <div className="hero-chart-foot">
                <span>WINNING SIDE PAYS $1 · PRICE-ORACLE SETTLED</span>
                <span className="ramp">
                  <span>YES</span>
                  <span className="bar"><span className="fill" style={{ width: heroYesProb != null ? `${heroYesProb}%` : '50%' }} /></span>
                  <span style={{ color: 'var(--vermilion)' }}>{heroYesProb != null ? `${heroYesProb}¢` : '—'}</span>
                </span>
              </div>
            </div>

            {/* Mini bet panel — the same TradePanel the full market page uses */}
            <div className="hero-mini-panel">
              {heroRawOracle ? (
                <TradePanel
                  oracle={heroRawOracle}
                  spotPrice={prices[heroRawOracle.oracle_id]?.spot ?? null}
                  forwardPrice={prices[heroRawOracle.oracle_id]?.forward ?? null}
                  defaultSide="UP"
                  initialStrike={heroOracle?.strike ?? null}
                  initialMode="simple"
                />
              ) : (
                <div className="hero-mini-loading">Loading live market…</div>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          className={`scroll-cue${scrolled ? ' gone' : ''}`}
          aria-label="Scroll to markets"
          onClick={() => window.scrollTo({ top: window.innerHeight * 0.78, behavior: 'smooth' })}
        >
          <span className="scroll-cue-label">Markets below</span>
          <span className="scroll-cue-track"><span className="scroll-cue-dot" /></span>
        </button>
      </section>

      {/* Expanded market modal — morphs open from the hero card */}
      <AnimatePresence>
        {expanded && heroOracle && heroRawOracle && (
          <motion.div
            className="market-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setExpanded(false)}
          >
            <motion.div
              className="market-modal"
              initial={{ opacity: 0, scale: 0.96, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="market-modal-head">
                <div className="mm-title">
                  <span className="glyph">B</span>
                  <div>
                    <div className="mm-q">{`BTC above $${heroOracle.strikeDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}?`}</div>
                    <div className="hero-chart-tags">
                      <span className="hc-countdown"><Clock />Closes in <b>{formatCountdown(getTimeRemaining(heroOracle.expiry))}</b></span>
                      <span className="hc-chip">Oracle-settled</span>
                    </div>
                  </div>
                </div>
                <div className="mm-head-right">
                  <div className="mm-price">
                    <span className="price">{btcPrice ? `$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</span>
                    <span className="delta">{heroChartDelta || '—'}</span>
                  </div>
                  <button type="button" className="mm-close" aria-label="Close" onClick={() => setExpanded(false)}><X /></button>
                </div>
              </div>
              <div className="market-modal-body">
                <div className="market-modal-chart">
                  <canvas ref={modalCanvasRef} />
                  <div className="mm-chart-foot">
                    <span>WINNING SIDE PAYS $1 · PRICE-ORACLE SETTLED</span>
                    <Link href={`/markets/${heroOracle.id}`} className="mm-fullpage" data-cursor="hover">Open full page →</Link>
                  </div>
                </div>
                <div className="market-modal-panel">
                  <TradePanel
                    oracle={heroRawOracle}
                    spotPrice={prices[heroRawOracle.oracle_id]?.spot ?? null}
                    forwardPrice={prices[heroRawOracle.oracle_id]?.forward ?? null}
                    defaultSide="UP"
                    initialStrike={heroOracle?.strike ?? null}
                    initialMode="pro"
                    onSuccess={() => setExpanded(false)}
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter bar (sticky) */}
      <div className="filter-bar">
        <div className="container">
          <div className="filter-row">
            <div className="filter-tabs">
              {FILTERS.map(f => (
                <button
                  key={f}
                  type="button"
                  className={`filter-tab ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                >
                  {f === 'all' ? 'All' : f === 'FAV' ? '★' : f}
                  <span className="ct">
                    {f === 'all'
                      ? String(active.length).padStart(2, '0')
                      : f === 'FAV'
                        ? String(favCount).padStart(2, '0')
                        : String(active.filter(o => o.underlying_asset === f).length).padStart(2, '0')
                    }
                  </span>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {/* Search */}
              <div className="search-box">
                <Search />
                <input
                  ref={searchRef}
                  type="text"
                  aria-label="Search markets"
                  placeholder="Search markets…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery ? (
                  <button
                    type="button"
                    aria-label="Clear market search"
                    onClick={() => setSearchQuery('')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                  >
                    <X style={{ width: 12, height: 12, color: 'var(--gray-500)' }} />
                  </button>
                ) : (
                  <span className="kbd">/</span>
                )}
              </div>

              {/* Sort */}
              <div style={{ position: 'relative', userSelect: 'none' }}>
                <button
                  type="button"
                  className="sort-select"
                  onClick={() => setSortOpen(!sortOpen)}
                  aria-haspopup="menu"
                  aria-expanded={sortOpen}
                  aria-label={`Sort markets by ${sortBy === 'closing' ? 'closing soon' : 'top probability'}`}
                >
                  <span className="lbl">Sort</span>
                  <span className="val">{sortBy === 'closing' ? 'Closing Soon' : 'Top Probability'}</span>
                  <ChevronDown aria-hidden="true" />
                </button>
                {sortOpen && (
                  <div
                    role="menu"
                    style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                      background: 'rgba(20,20,20,0.96)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px', padding: '4px', zIndex: 900, minWidth: '160px',
                      backdropFilter: 'blur(12px)',
                    }}
                  >
                    {([['closing', 'Closing Soon'], ['probability', 'Top Probability']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSortBy(key); setSortOpen(false); }}
                        role="menuitemradio"
                        aria-checked={sortBy === key}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '8px 12px', background: sortBy === key ? 'rgba(255,255,255,0.06)' : 'transparent',
                          border: 'none', color: sortBy === key ? 'var(--white)' : 'var(--gray-400)',
                          fontSize: '12px', fontFamily: 'var(--font-body)', cursor: 'pointer',
                          borderRadius: '8px', transition: 'background 150ms',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main>
        <div className="container">
          {/* Loading */}
          {loading && (
            <div className="empty-state">
              <div className="jp">予</div>
              <h3>Loading markets...</h3>
              <p>Fetching oracles from DeepBook Predict</p>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="empty-state">
              <div className="jp">誤</div>
              <h3>Connection error</h3>
              <p>{error}</p>
            </div>
          )}

          {/* No markets */}
          {!loading && !error && active.length === 0 && (
            <div className="empty-state">
              <div className="jp">空</div>
              <h3>No active markets</h3>
              <p>New oracle rounds are created every 15 minutes</p>
            </div>
          )}

          {/* Live ladder — next four tradable bells */}
          {liveLadder.length > 0 && (
            <section className="markets-section" data-section="closing">
              <SectionHeader
                number="01"
                title="Live now"
                jp="開催中"
                live
                meta={`${liveLadder.length} ${liveLadder.length === 1 ? 'horizon' : 'horizons'} · 15 / 30 / 45 / 60 min`}
              />
              <div className="markets-grid markets-grid-live">
                {liveLadder.map(({ oracle, horizonLabel }) => {
                  const price = prices[oracle.oracle_id];
                  const referencePrice = price?.forward || price?.spot || (btcPrice ? btcPrice * FLOAT_SCALING : null);
                  const line = getCanonicalMarketLine({
                    oracle,
                    settledOracles: settled,
                    referencePrice,
                  });
                  return (
                  <MarketCard
                    key={oracle.oracle_id}
                    oracle={oracle}
                    spotPrice={price?.spot}
                    forwardPrice={price?.forward}
                    seedStrike={line?.source === 'grid-fallback' ? null : line?.strike}
                    horizonLabel={horizonLabel}
                    isFavorite={favorites.has(oracle.oracle_id)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                  );
                })}
              </div>
            </section>
          )}

          {/* Later bells — same question, later rounds, as time chips */}
          {laterBells.length > 0 && (
            <section className="markets-section" data-section="later">
              <SectionHeader
                number="02"
                title="Upcoming"
                jp="今後"
                meta={`${laterBells.reduce((n, [, l]) => n + l.length, 0)} rounds · tap a time to trade it`}
              />
              <BellChips rows={laterBells} />
            </section>
          )}

          {/* Recently Settled */}
          {recentSettled.length > 0 && (
            <section className="markets-section settled" data-section="settled" style={{ paddingTop: '96px' }}>
              <SectionHeader
                number="03"
                title="Recently settled"
                jp="確定済"
                desc="Last 60 minutes. Receipts on Suiscan, payouts in DUSDC."
                meta="last 60 minutes"
              />
              <div className="markets-grid">
                {recentSettled.map(oracle => (
                  <MarketCard
                    key={oracle.oracle_id}
                    oracle={oracle}
                    isFavorite={favorites.has(oracle.oracle_id)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <Footer />

      {/* The Bell */}
      {nextExpiry && <TheBell targetTime={nextExpiry} />}

      {/* First-visit tutorial */}
      <Tutorial />
    </div>
  );
}
