'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useOracles } from '@/lib/sui/hooks';
import { type PriceData } from '@/lib/sui/predictApi';
import { nearestStrike, getTimeRemaining, formatCountdown } from '@/lib/roundHelpers';
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

// Quick probability estimate from forward vs nearest strike
function computeQuickProb(p: PriceData, oracle: { min_strike: number; tick_size: number; expiry: number }) {
  const fwd = p.forward / FLOAT_SCALING;
  const strike = nearestStrike(p.forward || p.spot, oracle.min_strike, oracle.tick_size) / FLOAT_SCALING;
  const diff = (fwd - strike) / (strike || 1);
  const secsLeft = Math.max(60, (oracle.expiry - Date.now()) / 1000);
  const sigma = 0.001 * Math.sqrt(secsLeft / 60);
  const z = diff / (sigma || 0.01);
  return Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z))));
}

// Later rounds per asset, as live countdown chips. One shared 1s ticker.
function BellChips({ rows }: { rows: ReadonlyArray<readonly [string, { oracle_id: string; expiry: number }[]]> }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000);
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
                {fmt(o.expiry - Date.now())}
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
  const [heroOracle, setHeroOracle] = useState<{ id: string; expiry: number; strikeDollars: number } | null>(null);
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setClockTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!heroCanvasRef.current) return;
    let cancelled = false;

    async function renderHeroChart() {
      // Find a BTC oracle to get real price history
      const btcOracle = active.find(o => o.underlying_asset === 'BTC');
      if (btcOracle) {
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
            const first = series[0];
            const last = series[series.length - 1];
            const delta = first > 0 ? ((last - first) / first * 100).toFixed(2) : '0.00';
            if (!cancelled) setHeroChartDelta(`${Number(delta) >= 0 ? '+' : ''}${delta}%`);

            // Nearest strike to forward price = the dashed "Target" line.
            const p0 = prices[btcOracle.oracle_id];
            const refP = p0?.forward || p0?.spot;
            if (refP && heroStrikeRef.current === null) {
              heroStrikeRef.current = nearestStrike(refP, btcOracle.min_strike, btcOracle.tick_size);
            }
            const midStrike = heroStrikeRef.current ?? (btcOracle.min_strike + btcOracle.tick_size * 25);
            const midDollars = midStrike / FLOAT_SCALING;
            if (!cancelled) setHeroOracle({ id: btcOracle.oracle_id, expiry: btcOracle.expiry, strikeDollars: midDollars });

            if (!cancelled) {
              // Compute yes probability from forward
              const p = prices[btcOracle.oracle_id];
              if (p) {
                const fwd = p.forward / FLOAT_SCALING;
                const diff = (fwd - midDollars) / midDollars;
                const secsLeft = Math.max(60, (btcOracle.expiry - Date.now()) / 1000);
                const sigma = 0.001 * Math.sqrt(secsLeft / 60);
                const z = diff / (sigma || 0.01);
                setHeroYesProb(Math.round(Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z))))));
              }
            }

            if (!cancelled && heroCanvasRef.current) {
              drawPriceLine(heroCanvasRef.current, series, {
                target: midDollars,
                targetLabel: 'Target',
                verdict: true,
                gridLines: true,
                padX: 14,
                padTop: 12,
                padBot: 12,
              });
              return;
            }
          }
        } catch { /* ignore, fall through to fallback */ }
      }

      // Fallback — generate a series from live Pyth price
      if (!cancelled && heroCanvasRef.current) {
        const spot = btcPrice || 80000;
        const series = genCandles(42, 60, spot - spot * 0.008, spot, spot * 0.003).map(c => c.close);
        drawPriceLine(heroCanvasRef.current, series, {
          target: spot,
          targetLabel: 'Target',
          gridLines: true,
          padX: 14,
          padTop: 12,
          padBot: 12,
        });
      }
    }

    renderHeroChart();
    return () => { cancelled = true; };
  }, [btcPrice, active, prices]);

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
        const probA = pA ? computeQuickProb(pA, a) : 50;
        const probB = pB ? computeQuickProb(pB, b) : 50;
        // Sort by distance from 50% (most decisive first)
        return Math.abs(probB - 50) - Math.abs(probA - 50);
      });
    }
    return result;
  }, [filter, searchQuery, sortBy, prices, favorites]);

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
  const nextBell = useMemo(
    () => Array.from(byAsset.values()).map(l => l[0]).filter(Boolean).sort((a, b) => a.expiry - b.expiry),
    [byAsset],
  );
  const laterBells = useMemo(
    () => Array.from(byAsset.entries())
      .map(([asset, list]) => [asset, list.slice(1)] as const)
      .filter(([, list]) => list.length > 0),
    [byAsset],
  );

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const handler = () => setSortOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [sortOpen]);

  const FILTERS = ['all', 'FAV', 'BTC', 'ETH', 'SOL', 'SUI'];
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

              <div className="hero-status">
                <div className="item">
                  <div className="lbl">Open markets</div>
                  <div className="val">{active.length}</div>
                  <div className="meta">{nextBell.length} live now</div>
                </div>
                <div className="item">
                  <div className="lbl">BTC Spot</div>
                  <div className="val">{btcPrice ? `$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</div>
                  <div className="meta">Pyth · live</div>
                </div>
                {address && (
                  <div className="item">
                    <div className="lbl">Wallet</div>
                    <div className="val">{address.slice(0, 6)}…{address.slice(-4)}</div>
                    <div className="meta">Connected</div>
                  </div>
                )}
              </div>
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
                      {heroOracle
                        ? `closes in ${formatCountdown(getTimeRemaining(heroOracle.expiry))} · pyth · live`
                        : 'spot · pyth · 1m candles'}
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
                  <div className="pair-meta" style={{ fontSize: '9px' }}>last update · live</div>
                </div>
              </div>
              <canvas ref={heroCanvasRef} />
              <div className="hero-chart-foot">
                <span>LIVE · PYTH ORACLE</span>
                {heroOracle ? (
                  <span className="hero-bet">
                    <Link href={`/markets/${heroOracle.id}?side=UP`} className="hero-bet-btn up" data-cursor="up">
                      UP <span className="c">{heroYesProb ?? '\u2014'}¢</span>
                    </Link>
                    <Link href={`/markets/${heroOracle.id}?side=DOWN`} className="hero-bet-btn down" data-cursor="hover">
                      DOWN <span className="c">{heroYesProb !== null ? 100 - heroYesProb : '\u2014'}¢</span>
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
                  className={`filter-tab ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
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
                  placeholder="Search markets…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchQuery ? (
                  <button
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
              <div
                className="sort-select"
                onClick={() => setSortOpen(!sortOpen)}
                style={{ position: 'relative', userSelect: 'none' }}
              >
                <span className="lbl">Sort</span>
                <span className="val">{sortBy === 'closing' ? 'Closing Soon' : 'Top Probability'}</span>
                <ChevronDown />
                {sortOpen && (
                  <div
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
                        onClick={(e) => { e.stopPropagation(); setSortBy(key); setSortOpen(false); }}
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
                {nextBell.map(oracle => (
                  <MarketCard
                    key={oracle.oracle_id}
                    oracle={oracle}
                    spotPrice={prices[oracle.oracle_id]?.spot}
                    forwardPrice={prices[oracle.oracle_id]?.forward}
                    isFavorite={favorites.has(oracle.oracle_id)}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
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
                number="04"
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
