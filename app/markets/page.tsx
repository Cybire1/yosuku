'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useOracles } from '@/lib/sui/hooks';
import { type PriceData } from '@/lib/sui/predictApi';
import { getTimeRemaining, formatCountdown } from '@/lib/roundHelpers';
import { getCanonicalMarketLine } from '@/lib/marketLine';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { drawPriceLine, genCandles } from '@/lib/charts/canvasChart';
import { fetchPriceHistory } from '@/lib/sui/predictApi';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import { Search, X, ChevronDown } from 'lucide-react';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';
import { loadFavorites, toggleFavorite } from '@/lib/favorites';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import MarketCard from '@/components/MarketCard';
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
              drawPriceLine(heroCanvasRef.current, liveSeries, {
                target: midDollars,
                targetLabel: `Win line · $${Math.round(midDollars).toLocaleString()}`,
                verdict: true,
                gridLines: true,
                axisRight: 60,
                padX: 14,
                padTop: 12,
                padBot: 12,
              });
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
    return () => { cancelled = true; };
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

  // One card per asset — the next bell. The oracle operator ladders rounds
  // every 15 minutes, so rendering every oracle is a wall of near-identical
  // questions; later expiries collapse into time chips instead.
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
  // Computed per render (the 1s clock tick re-renders) so the live card
  // rotates to the next round the moment one expires — never stuck on
  // "Expired" while the oracle waits for its settlement print.
  const nextBell = Array.from(byAsset.values())
    .map(list => list.find(o => o.expiry > nowMs))
    .filter((o): o is NonNullable<typeof o> => Boolean(o))
    .sort((a, b) => a.expiry - b.expiry);
  const laterBells = Array.from(byAsset.entries())
    .map(([asset, list]) => [asset, list.filter(o => o.expiry > nowMs).slice(1)] as const)
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

          <div className="hero-grid">
            <div className="hero-left">
              <div className="eyebrow">
                <span className="dash" />
                <span className="live-dot" />
                <span>The floor · open</span>
                <span style={{ color: 'var(--gray-700)' }}>·</span>
                <span>15-min binary rounds</span>
              </div>
              <h1 className="page-title">
                The<br />
                <span className="accent">floor</span> is<br />
                open.
              </h1>

            </div>

            {/* Hero chart */}
            <div className="hero-chart">
              <div className="hero-chart-head">
                <div className="left">
                  <span className="glyph">₿</span>
                  <div>
                    <div className="pair">
                      {heroOracle ? `BTC above $${heroOracle.strikeDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}?` : 'BTC · USD'}
                    </div>
                    <div className="pair-meta">
                      {heroOracle ? (
                        <>
                          <span className="meta-soft">Tap a side below · </span>
                          closes in {formatCountdown(getTimeRemaining(heroOracle.expiry))}
                          <span className="meta-soft"> · settled by oracle</span>
                        </>
                      ) : 'spot · live stream · 1m candles'}
                    </div>
                  </div>
                </div>
                <div className="left" style={{ textAlign: 'right', flexDirection: 'column', alignItems: 'flex-end', gap: 0 }}>
                  <div>
                    <span className="price">
                      {btcPrice ? `$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
                    </span>
                    <span className="delta">{heroChartDelta || '\u2014'}</span>
                  </div>
                  <div className="pair-meta meta-soft" style={{ fontSize: '9px' }}>live oracle price · updates each tick</div>
                </div>
              </div>
              <canvas ref={heroCanvasRef} />
              <div className="hero-chart-foot">
                <span>WINNING SIDE PAYS $1 · PRICE-ORACLE SETTLED</span>
                {heroOracle ? (
                  <span className="hero-bet">
                    <Link href={`/markets/${heroOracle.id}?strike=${heroOracle.strike}&side=UP`} className="hero-bet-btn up" data-cursor="up">
                      UP <span className="c">{heroYesProb ?? '—'}¢</span>
                    </Link>
                    <Link href={`/markets/${heroOracle.id}?strike=${heroOracle.strike}&side=DOWN`} className="hero-bet-btn down" data-cursor="hover">
                      DOWN <span className="c">{heroYesProb !== null ? 100 - heroYesProb : '—'}¢</span>
                    </Link>
                  </span>
                ) : (
                  <span className="ramp">
                    <span>YES</span>
                    <span className="bar"><span className="fill" /></span>
                    <span style={{ color: 'var(--vermilion)' }}>{heroYesProb ? `${heroYesProb}¢` : '\u2014'}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

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

          {/* Next bell — one card per asset */}
          {nextBell.length > 0 && (
            <section className="markets-section" data-section="closing">
              <SectionHeader
                number="01"
                title="Live now"
                jp="開催中"
                live
                meta={`${nextBell.length} ${nextBell.length === 1 ? 'market' : 'markets'}`}
              />
              <div className="markets-grid">
                {nextBell.map((oracle) => {
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
