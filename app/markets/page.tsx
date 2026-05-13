'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useOracles } from '@/lib/sui/hooks';
import { fetchLatestPrices, type PriceData } from '@/lib/sui/predictApi';
import { groupOraclesByTimeframe, nearestStrike } from '@/lib/roundHelpers';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { drawCandles, genCandles, priceHistoryToCandles } from '@/lib/charts/canvasChart';
import { fetchPriceHistory } from '@/lib/sui/predictApi';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import MarketCard from '@/components/MarketCard';
import SectionHeader from '@/components/SectionHeader';
import TheBell from '@/components/TheBell';

export default function MarketsPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { active, settled, loading, error } = useOracles();
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const { price: btcPrice } = useBtcPrice();
  const heroCanvasRef = useRef<HTMLCanvasElement>(null);
  const [filter, setFilter] = useState('all');

  // Fetch prices for active oracles
  useEffect(() => {
    if (active.length === 0) return;
    let cancelled = false;
    async function loadPrices() {
      const results = await Promise.allSettled(
        active.map(o => fetchLatestPrices(o.oracle_id))
      );
      if (cancelled) return;
      const newPrices: Record<string, PriceData> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          newPrices[active[i].oracle_id] = r.value;
        }
      });
      setPrices(newPrices);
    }
    loadPrices();
    const interval = setInterval(loadPrices, 5_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [active]);

  // Hero chart — use real BTC price history from first BTC oracle
  const [heroChartDelta, setHeroChartDelta] = useState<string | null>(null);
  const [heroYesProb, setHeroYesProb] = useState<number | null>(null);

  useEffect(() => {
    if (!heroCanvasRef.current) return;
    let cancelled = false;

    async function renderHeroChart() {
      // Find a BTC oracle to get real price history
      const btcOracle = active.find(o => o.underlying_asset === 'BTC');
      if (btcOracle) {
        try {
          const history = await fetchPriceHistory(btcOracle.oracle_id, 100);
          if (!cancelled && history.length > 5) {
            const scaled = history.map(h => ({ spot: h.spot / FLOAT_SCALING, timestamp: h.timestamp }));
            const candles = priceHistoryToCandles(scaled, 60);
            if (candles.length > 0) {
              const first = candles[0].open;
              const last = candles[candles.length - 1].close;
              const delta = first > 0 ? ((last - first) / first * 100).toFixed(2) : '0.00';
              if (!cancelled) setHeroChartDelta(`${Number(delta) >= 0 ? '+' : ''}${delta}%`);

              // Use nearest strike to forward price
              const p0 = prices[btcOracle.oracle_id];
              const refP = p0?.forward || p0?.spot;
              const midStrike = refP
                ? nearestStrike(refP, btcOracle.min_strike, btcOracle.tick_size)
                : btcOracle.min_strike + btcOracle.tick_size * 25;
              const midDollars = midStrike / FLOAT_SCALING;

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
                drawCandles(heroCanvasRef.current, candles, {
                  strike: midDollars,
                  maxCandleW: 6,
                  gridLines: true,
                  marker: true,
                  padX: 14,
                  padTop: 12,
                  padBot: 12,
                });
                return;
              }
            }
          }
        } catch { /* ignore, fall through to fallback */ }
      }

      // Fallback — generate candles from live Pyth price
      if (!cancelled && heroCanvasRef.current) {
        const spot = btcPrice || 80000;
        const candles = genCandles(42, 60, spot - spot * 0.008, spot, spot * 0.003);
        drawCandles(heroCanvasRef.current, candles, {
          strike: spot,
          maxCandleW: 6,
          gridLines: true,
          marker: true,
          padX: 14,
          padTop: 12,
          padBot: 12,
        });
      }
    }

    renderHeroChart();
    return () => { cancelled = true; };
  }, [btcPrice, active, prices]);

  const groups = groupOraclesByTimeframe(active);
  const recentSettled = settled.slice(0, 6);

  // Determine next expiry for TheBell
  const nextExpiry = useMemo(() => {
    if (active.length === 0) return undefined;
    const sorted = [...active].sort((a, b) => a.expiry - b.expiry);
    return sorted[0]?.expiry;
  }, [active]);

  // Filter
  const filterOracles = (oracles: typeof active) => {
    if (filter === 'all') return oracles;
    return oracles.filter(o => o.underlying_asset === filter);
  };

  const FILTERS = ['all', 'BTC', 'ETH', 'SOL', 'SUI'];

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      {/* Page Hero */}
      <section className="page-hero">
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
              <div className="page-title-jp">予測の場が、開いています。</div>
              <p className="page-subtitle">
                Binary rounds across BTC, ETH, SOL and SUI. Strike, window
                and oracle are deterministic. Take a side before the bell.
              </p>

              <div className="hero-status">
                <div className="item">
                  <div className="lbl">Open markets</div>
                  <div className="val">{active.length}</div>
                  <div className="meta">{filterOracles(groups.expiringSoon).length} closing &lt; 10:00</div>
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
                    <div className="pair">BTC · USD</div>
                    <div className="pair-meta">spot · pyth · 1m candles</div>
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
                <span className="ramp">
                  <span>YES</span>
                  <span className="bar"><span className="fill" /></span>
                  <span style={{ color: 'var(--vermilion)' }}>{heroYesProb ? `${heroYesProb}¢` : '\u2014'}</span>
                </span>
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
                  {f === 'all' ? 'All' : f}
                  <span className="ct">
                    {f === 'all'
                      ? String(active.length).padStart(2, '0')
                      : String(active.filter(o => o.underlying_asset === f).length).padStart(2, '0')
                    }
                  </span>
                </button>
              ))}
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

          {/* Closing soon */}
          {filterOracles(groups.expiringSoon).length > 0 && (
            <section className="markets-section" data-section="closing">
              <SectionHeader
                number="01"
                title="Closing soon"
                jp="締切間近"
                desc="Last call. Strike, side, and stake — the bell does the rest."
                live
                meta={`${filterOracles(groups.expiringSoon).length} markets · < 10:00`}
              />
              <div className="markets-grid">
                {filterOracles(groups.expiringSoon).map(oracle => (
                  <MarketCard
                    key={oracle.oracle_id}
                    oracle={oracle}
                    spotPrice={prices[oracle.oracle_id]?.spot}
                    forwardPrice={prices[oracle.oracle_id]?.forward}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Next hour */}
          {filterOracles(groups.nextHour).length > 0 && (
            <section className="markets-section" data-section="hour">
              <SectionHeader
                number="02"
                title="Next hour"
                jp="次の一時間"
                desc="Open positions ahead of the next four bells. Liquidity is forming."
                meta={`${filterOracles(groups.nextHour).length} markets · 15:00 → 60:00`}
              />
              <div className="markets-grid">
                {filterOracles(groups.nextHour).map(oracle => (
                  <MarketCard
                    key={oracle.oracle_id}
                    oracle={oracle}
                    spotPrice={prices[oracle.oracle_id]?.spot}
                    forwardPrice={prices[oracle.oracle_id]?.forward}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Later */}
          {filterOracles(groups.later).length > 0 && (
            <section className="markets-section" data-section="later">
              <SectionHeader
                number="03"
                title="Later today"
                jp="後ほど"
                desc="Longer horizons. Lower density, higher conviction."
                meta={`${filterOracles(groups.later).length} markets · 1h → 24h`}
              />
              <div className="markets-grid">
                {filterOracles(groups.later).map(oracle => (
                  <MarketCard
                    key={oracle.oracle_id}
                    oracle={oracle}
                    spotPrice={prices[oracle.oracle_id]?.spot}
                    forwardPrice={prices[oracle.oracle_id]?.forward}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Fallback: show all active */}
          {!loading && active.length > 0 &&
            groups.expiringSoon.length === 0 &&
            groups.nextHour.length === 0 &&
            groups.later.length === 0 && (
            <section className="markets-section">
              <SectionHeader
                number="01"
                title="Active Markets"
                jp="市場"
                count={filterOracles(active).length}
              />
              <div className="markets-grid">
                {filterOracles(active).map(oracle => (
                  <MarketCard
                    key={oracle.oracle_id}
                    oracle={oracle}
                    spotPrice={prices[oracle.oracle_id]?.spot}
                    forwardPrice={prices[oracle.oracle_id]?.forward}
                  />
                ))}
              </div>
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
    </div>
  );
}
