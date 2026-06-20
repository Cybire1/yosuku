'use client';

import { useState, useEffect, useRef, use, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import TheBell from '@/components/TheBell';
import TradePanel from '@/components/TradePanel';
import CashOut from '@/components/CashOut';
import Verdict from '@/components/Verdict';
import { fetchTrades, type OracleData, type TradeData } from '@/lib/sui/predictApi';
import { useOracleState, useOracles } from '@/lib/sui/hooks';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { Share2, Link2, Check } from 'lucide-react';
import PriceAlertsButton from '@/components/PriceAlerts';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';
import { checkAlerts, sendNotification } from '@/lib/priceAlerts';
import Tooltip from '@/components/Tooltip';
import { getTimeRemaining, formatCountdown } from '@/lib/roundHelpers';
import { getCanonicalMarketLine, normalizeMarketStrike } from '@/lib/marketLine';
import { genCandles, drawPriceLine } from '@/lib/charts/canvasChart';
import { fetchPriceHistory } from '@/lib/sui/predictApi';

function parseSideParam(value: string | null): 'UP' | 'DOWN' {
  return value === 'DOWN' ? 'DOWN' : 'UP';
}

function parseStrikeParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeStrikeForOracle(strike: number | null, oracle: OracleData | null): number | null {
  if (strike === null || !oracle || oracle.tick_size <= 0) return null;
  return normalizeMarketStrike(strike, oracle);
}

export default function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: oracleId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const sideParam = searchParams.get('side');
  const strikeParam = searchParams.get('strike');
  const defaultSide = parseSideParam(sideParam);

  const [trades, setTrades] = useState<TradeData[]>([]);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  // Headline strike, pinned from the FIRST price sample. The oracle is a strike
  // grid with no single "market" strike — re-deriving nearest-to-forward on every
  // poll made the question itself drift with the price. Pin it; only an explicit
  // user strike selection changes the question.
  const [pinnedStrike, setPinnedStrike] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0, expired: false, totalMs: 0 });
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  // Price series cached per oracle so strike/price changes redraw the chart
  // without re-fetching /prices every poll.
  const chartSeriesRef = useRef<{ id: string; series: number[]; times: number[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeSide, setActiveSide] = useState<'UP' | 'DOWN'>(defaultSide);

  const handleSideChange = useCallback((nextSide: 'UP' | 'DOWN') => {
    setActiveSide(nextSide);
    const next = new URLSearchParams(searchParams.toString());
    next.set('side', nextSide);
    const strike = selectedStrike ?? pinnedStrike;
    if (strike !== null) next.set('strike', String(strike));
    router.replace(`/markets/${oracleId}?${next.toString()}`, { scroll: false });
  }, [oracleId, pinnedStrike, router, searchParams, selectedStrike]);

  useEffect(() => {
    setActiveSide(defaultSide);
  }, [defaultSide]);

  // Keyboard shortcuts: u → UP, d → DOWN, Escape → go back
  useKeyboardShortcuts(useMemo(() => ({
    'u': () => handleSideChange('UP'),
    'd': () => handleSideChange('DOWN'),
    'Escape': () => router.push('/markets'),
  }), [handleSideChange, router]));

  // Single combined API call: oracle + prices + SVI
  const { state: oracleState, loading } = useOracleState(oracleId);
  const { active, settled, loading: oracleListLoading } = useOracles();
  // Sub-second live BTC price stream — the chart's moving tip so it tracks
  // BTC in real time instead of the 15s oracle-state poll.
  const { price: livePrice } = useBtcPrice();
  const oracle = oracleState?.oracle ?? null;
  const prices = oracleState?.latest_price ?? null;
  const sviData = oracleState?.latest_svi ?? null;
  const refPriceForLine = prices?.forward || prices?.spot || (livePrice ? livePrice * FLOAT_SCALING : null);
  const canonicalLine = useMemo(
    () => (oracle ? getCanonicalMarketLine({
      oracle,
      settledOracles: settled,
      referencePrice: refPriceForLine,
      waitForSettledOracles: true,
      settledOraclesLoaded: !oracleListLoading,
    }) : null),
    [oracle, oracleListLoading, refPriceForLine, settled],
  );
  const canonicalStrike = canonicalLine?.source === 'grid-fallback' ? null : canonicalLine?.strike ?? null;
  const urlStrike = useMemo(
    () => normalizeStrikeForOracle(parseStrikeParam(strikeParam), oracle),
    [oracle, strikeParam],
  );

  useEffect(() => {
    if (urlStrike === null) return;
    setPinnedStrike((prev) => (prev === urlStrike ? prev : urlStrike));
    setSelectedStrike((prev) => (prev === urlStrike ? prev : urlStrike));
  }, [urlStrike]);

  const handleStrikeChange = useCallback((strike: number) => {
    setSelectedStrike(strike);
    setPinnedStrike(strike);
    const next = new URLSearchParams(searchParams.toString());
    next.set('strike', String(strike));
    next.set('side', activeSide);
    router.replace(`/markets/${oracleId}?${next.toString()}`, { scroll: false });
  }, [activeSide, oracleId, router, searchParams]);

  // Load trades
  useEffect(() => {
    let cancelled = false;
    async function loadTrades() {
      try {
        const t = await fetchTrades(oracleId);
        if (!cancelled) setTrades(t);
      } catch { /* ignore */ }
    }
    loadTrades();
    const interval = setInterval(loadTrades, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [oracleId]);

  // Countdown
  useEffect(() => {
    if (!oracle) return;
    const tick = () => setTimeLeft(getTimeRemaining(oracle.expiry));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [oracle]);

  // Canvas chart — real price history with genCandles fallback
  useEffect(() => {
    if (!chartCanvasRef.current || !oracle) return;
    let cancelled = false;
    let raf = 0;
    // Same strike the rest of the page shows — NOT the raw grid midpoint, which
    // can sit far from spot and squash the candles against the chart edge.
    const ref = prices?.forward || prices?.spot || (livePrice ? livePrice * FLOAT_SCALING : null);
    const fallbackMid = canonicalStrike ?? (ref ? normalizeMarketStrike(ref, oracle) : oracle.min_strike);
    const strikeD = (selectedStrike ?? pinnedStrike ?? fallbackMid) / FLOAT_SCALING;
    const animateChart = oracle.status === 'active';

    const fmtTime = (ms: number) =>
      new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    async function renderChart() {
      // Fetch the series once per oracle; redraw on strike/price changes reuse it.
      let cached = chartSeriesRef.current?.id === oracleId ? chartSeriesRef.current : null;
      if (!cached) {
        try {
          const history = await fetchPriceHistory(oracleId, 240);
          if (!cancelled && history.length > 5) {
            const sorted = history.slice().sort((a, b) => a.timestamp - b.timestamp);
            cached = {
              id: oracleId,
              series: sorted.map(h => h.spot / FLOAT_SCALING),
              times: sorted.map(h => h.timestamp),
            };
            chartSeriesRef.current = cached;
          }
        } catch { /* ignore */ }
      }

      // Append the live BTC price so the line tracks BTC in real time instead of
      // freezing on the first fetch. The live stream ticks sub-second; falls back to the
      // oracle spot. New points accumulate (capped).
      const liveSpot = livePrice || (prices?.spot ? prices.spot / FLOAT_SCALING : null);
      if (cached && liveSpot != null) {
        const last = cached.series[cached.series.length - 1];
        if (last !== liveSpot) {
          cached.series.push(liveSpot);
          cached.times.push(Date.now());
          if (cached.series.length > 300) { cached.series.shift(); cached.times.shift(); }
        }
      }

      // Fallback — generate a plausible series around spot.
      if (!cached || cached.series.length < 2) {
        const spot = prices?.spot ? prices.spot / FLOAT_SCALING : strikeD;
        cached = {
          id: oracleId,
          series: genCandles(oracleId.charCodeAt(2) || 5, 40, spot - spot * 0.01, spot, spot * 0.005).map(c => c.close),
          times: [],
        };
      }

      if (!cancelled && chartCanvasRef.current) {
        const t = cached.times;
        const xLabels = t.length > 2
          ? [fmtTime(t[0]), fmtTime(t[Math.floor(t.length / 2)]), fmtTime(t[t.length - 1])]
          : undefined;

        const drawFrame = (now: number) => {
          if (cancelled || !chartCanvasRef.current || !cached || cached.series.length < 2) return;

          drawPriceLine(chartCanvasRef.current, cached.series, {
            target: strikeD,
            targetLabel: 'Target',
            verdict: true,
            gridLines: true,
            axisRight: 58,
            xLabels,
            padX: 16,
            padTop: 14,
            padBot: 24,
            motion: animateChart,
            now,
          });

          raf = window.requestAnimationFrame(drawFrame);
        };

        raf = window.requestAnimationFrame(drawFrame);
      }
    }
    renderChart();
    return () => {
      cancelled = true;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [canonicalStrike, prices, oracle, selectedStrike, pinnedStrike, oracleId, livePrice, settled]);

  // Check price alerts — kept above the early returns (Rules of Hooks)
  useEffect(() => {
    const spot = prices?.spot ? prices.spot / FLOAT_SCALING : null;
    const asset = oracle?.underlying_asset || 'BTC';
    if (!spot || !asset) return;
    const triggered = checkAlerts({ [asset]: spot });
    triggered.forEach(a => {
      sendNotification(
        `${a.asset} Price Alert`,
        `${a.asset} is now ${a.direction === 'above' ? 'above' : 'below'} $${a.targetPrice.toLocaleString()}`
      );
    });
  }, [prices, oracle]);

  // Pin the headline strike once, from the first price sample
  useEffect(() => {
    if (pinnedStrike !== null || !oracle || urlStrike !== null) return;
    if (canonicalStrike === null) return;
    setPinnedStrike(canonicalStrike);
    setSelectedStrike(canonicalStrike);
    if (!strikeParam) {
      const next = new URLSearchParams(searchParams.toString());
      next.set('strike', String(canonicalStrike));
      next.set('side', activeSide);
      router.replace(`/markets/${oracleId}?${next.toString()}`, { scroll: false });
    }
  }, [activeSide, canonicalStrike, oracle, oracleId, pinnedStrike, router, searchParams, strikeParam, urlStrike]);

  if (loading) {
    return (
      <div className="min-h-screen relative">
        <Marquee />
        <Header />
        <CustomCursor />
        <GrainOverlay />
        <main className="container pt-[140px] pb-12 text-center py-20">
          <div className="w-6 h-6 border border-gray-600 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm font-mono">Loading market...</p>
        </main>
      </div>
    );
  }

  if (!oracle) {
    return (
      <div className="min-h-screen relative">
        <Marquee />
        <Header />
        <CustomCursor />
        <GrainOverlay />
        <main className="container pt-[140px] pb-12 text-center py-20">
          <p className="text-gray-400 mb-4">Market not found</p>
          <button onClick={() => router.push('/markets')} className="text-sm text-vermilion hover:underline">
            Back to Markets
          </button>
        </main>
      </div>
    );
  }

  const spot = prices?.spot ? prices.spot / FLOAT_SCALING : null;
  const forward = prices?.forward ? prices.forward / FLOAT_SCALING : null;
  const isSettled = oracle.status === 'settled';
  const isActive = oracle.status === 'active';
  // Dead zone: trading is over but the oracle's settlement print hasn't landed
  // yet. Without an explicit state the page looks frozen exactly when the user
  // is most anxious.
  const inDeadZone = !isSettled && (oracle.status === 'pending_settlement' || (isActive && timeLeft.expired));
  const isTradable = isActive && !timeLeft.expired;

  const midStrike = pinnedStrike ?? canonicalStrike;
  if (midStrike === null) {
    return (
      <div className="min-h-screen relative">
        <Marquee />
        <Header />
        <CustomCursor />
        <GrainOverlay />
        <main className="container pt-[140px] pb-12 text-center py-20">
          <div className="w-6 h-6 border border-gray-600 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-sm font-mono">Preparing market line...</p>
        </main>
      </div>
    );
  }
  const activeStrike = selectedStrike ?? midStrike;
  const midStrikeDollars = activeStrike / FLOAT_SCALING;
  const asset = oracle.underlying_asset || 'BTC';
  const marketUrlPath = `/markets/${oracleId}?strike=${activeStrike}&side=${activeSide}`;

  // When this round has closed, point the user at the next LIVE round for the same asset
  // (active is sorted soonest-first and filtered to expiry > now) so the detail page —
  // pinned to one oracleId — never strands them on a dead market.
  const nextRound = (inDeadZone || isSettled)
    ? active.find(o => (o.underlying_asset || 'BTC') === asset && o.oracle_id !== oracle.oracle_id) ?? null
    : null;

  const formatPrice = (n: number) =>
    '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        {/* Back */}
        <button
          onClick={() => router.push('/markets')}
          className="flex items-center gap-2 font-mono text-[11px] tracking-[0.16em] uppercase text-gray-500 hover:text-white transition-colors mb-8"
          data-cursor="hover"
        >
          ← Markets
        </button>

        {/* Market header */}
        <div className="flex items-start justify-between flex-wrap gap-6 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <span className={`font-mono text-[9px] tracking-[0.16em] uppercase px-2.5 py-1 rounded-full border ${
                isTradable
                  ? 'text-vermilion bg-vermilion/10 border-vermilion/20'
                  : inDeadZone
                    ? 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                    : 'text-gray-400 bg-white/5 border-white/10'
              }`}>
                {/* Derived state, not raw oracle.status — the indexer lags the
                    bell, so an expired-awaiting-settlement round still reads
                    "active" upstream. */}
                {isTradable ? 'Live' : inDeadZone ? 'Settling' : isSettled ? 'Settled' : oracle.status}
              </span>
              <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-gray-600">
                {asset}
              </span>
            </div>
            <h1 className="font-display font-[800] text-3xl sm:text-4xl text-white tracking-tight leading-tight">
              {asset} above <span className="text-vermilion">{formatPrice(midStrikeDollars)}</span>?
            </h1>
            {/* Price to beat — the heartbeat of a 15-min market: distance to the bar + time left */}
            {isTradable && spot !== null && (
              <div className="flex items-center gap-2 mt-3 font-mono text-base">
                <span className={spot >= midStrikeDollars ? 'text-profit font-semibold' : 'text-loss font-semibold'}>
                  {spot >= midStrikeDollars
                    ? `$${Math.round(spot - midStrikeDollars).toLocaleString()} above your line`
                    : `needs +$${Math.round(midStrikeDollars - spot).toLocaleString()} to win`}
                </span>
                <span className="text-gray-600">·</span>
                <span className={timeLeft.totalMs < 120_000 ? 'text-vermilion' : 'text-gray-400'}>
                  {formatCountdown(timeLeft)} left
                </span>
              </div>
            )}
            {/* Dead zone — round closed, waiting for the final price */}
            {inDeadZone && spot !== null && (
              <div className="flex items-center gap-2 mt-3 font-mono text-base">
                <span className="text-gray-400">Round closed —</span>
                <span className={spot > midStrikeDollars ? 'text-profit font-semibold' : 'text-loss font-semibold'}>
                  last price {formatPrice(spot)}, {spot > midStrikeDollars ? 'above' : 'below'} your line
                </span>
              </div>
            )}
          </div>

          {isTradable && (
            <div className="text-right">
              <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 block mb-1">
                Expires in
              </span>
              <span className="font-mono text-2xl font-semibold text-white">
                {formatCountdown(timeLeft)}
              </span>
            </div>
          )}

          {inDeadZone && (
            <div className="text-right">
              <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 block mb-1">
                Settling
              </span>
              <span className="font-mono text-2xl font-semibold text-vermilion animate-pulse">
                ● ● ●
              </span>
              <span className="font-mono text-[10px] text-gray-500 block mt-1">
                waiting for the final price — usually under 2 min
              </span>
            </div>
          )}

          {isSettled && oracle.settlement_price !== null && (
            <div className="text-right">
              <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 block mb-1">
                Settled at
              </span>
              <span className="font-mono text-2xl font-semibold text-white">
                {formatPrice(oracle.settlement_price / FLOAT_SCALING)}
              </span>
            </div>
          )}
        </div>

        {/* Share buttons */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => {
              const url = `https://yosuku.xyz${marketUrlPath}`;
              const text = `${asset} above ${formatPrice(midStrikeDollars)}? Trade on @yosuku_xyz`;
              window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-gray-400 hover:text-white hover:border-white/20 transition-all text-xs font-medium"
          >
            <Share2 style={{ width: 12, height: 12 }} />
            Share
          </button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`https://yosuku.xyz${marketUrlPath}`);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-gray-400 hover:text-white hover:border-white/20 transition-all text-xs font-medium"
          >
            {copied ? <Check style={{ width: 12, height: 12, color: '#34D399' }} /> : <Link2 style={{ width: 12, height: 12 }} />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <PriceAlertsButton asset={asset} currentPrice={spot} />
        </div>

        {/* One settled experience: personal result + claim (or neutral outcome
            for non-holders) + the next-round loop — all inside Verdict. */}
        {isSettled && <Verdict oracle={oracle} />}

        {/* Spot — the one orienting number a bettor needs. Forward (≈ spot on a
            15-min round) and volume/OI (terminal jargon, tiny testnet numbers)
            removed: they added density without helping the decision. */}
        {spot && (
          <div className="flex items-center mb-8">
            <div className="border-l border-white/[0.12] pl-3.5">
              <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 flex items-center gap-1">
                {asset} now <Tooltip text="Live BTC reference price for this market." position="bottom" />
              </span>
              <span className="font-mono text-lg font-semibold text-white">{formatPrice(spot)}</span>
            </div>
          </div>
        )}

        {/* Main content. On mobile the bet panel comes FIRST (a consumer wants to see
            where to bet, not scroll past the chart + trade history) — `order` flips it
            back to chart-left / panel-right on desktop. */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: chart + trades + strikes */}
          <div className="flex-1 min-w-0 space-y-6 order-2 lg:order-1">
            {/* Canvas chart */}
            <div className="relative border border-white/[0.08] rounded bg-bg overflow-hidden" style={{ height: '320px' }}>
              <div className="absolute top-0 left-0 right-0 flex justify-between items-center px-5 py-3 border-b border-white/5 z-[2] bg-bg/50 font-mono text-[10px] text-gray-500">
                <span>{asset} / USD · Live</span>
                <span>Price to beat {formatPrice(midStrikeDollars)}</span>
              </div>
              <canvas ref={chartCanvasRef} className="absolute inset-x-0 top-10 bottom-0 w-full h-[calc(100%-40px)]" />
            </div>


            {/* Recent Trades */}
            <div className="border border-white/[0.08] rounded bg-bg p-4">
              <h3 className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 mb-3">
                Recent Trades
              </h3>
              {trades.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-8">No trades yet</p>
              ) : (
                <div className="space-y-0.5 max-h-[300px] overflow-y-auto scrollbar-hide">
                  {trades.slice(0, 30).map((trade, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 rounded hover:bg-white/[0.02] transition-colors text-xs">
                      <span className={`font-mono font-semibold ${trade.type === 'mint' ? 'text-vermilion' : 'text-gray-400'}`}>
                        {trade.type === 'mint' ? '↑ BET' : '↓ CASH OUT'}
                      </span>
                      <span className="font-mono text-gray-400">
                        {(trade.quantity / DUSDC_MULTIPLIER).toFixed(2)} DUSDC
                      </span>
                      <span className="font-mono text-gray-600">
                        {new Date(trade.checkpoint_timestamp_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* Right: trade panel */}
          {inDeadZone && (
            <div className="w-full lg:w-[380px] flex-shrink-0 order-1 lg:order-2">
              <div className="lg:sticky lg:top-[120px] rounded-2xl border border-white/[0.08] bg-neutral-900/60 p-6 text-center">
                <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-500 mb-2">Trading closed</p>
                <p className="text-sm text-gray-400 leading-relaxed">
                  The bell has rung. The final price lands in a moment — if you won, your payout drops straight into your balance.
                </p>
                {nextRound && (
                  <button
                    onClick={() => router.push(`/markets/${nextRound.oracle_id}`)}
                    className="mt-5 w-full bg-vermilion hover:bg-vermilion-d text-white font-bold rounded-xl py-3 text-sm transition-colors"
                  >
                    Go to the next bell →
                  </button>
                )}
              </div>
            </div>
          )}
          {isTradable && (
            <div className="w-full lg:w-[380px] flex-shrink-0 order-1 lg:order-2">
              <div className="lg:sticky lg:top-[120px] space-y-4">
                <CashOut oracleId={oracleId} expiry={oracle.expiry} isActive={isTradable} />
                <TradePanel
                  oracle={oracle}
                  spotPrice={prices?.spot}
                  forwardPrice={prices?.forward}
                  defaultSide={activeSide}
                  initialStrike={activeStrike}
                  onSideChange={handleSideChange}
                  onStrikeChange={handleStrikeChange}
                />
              </div>
            </div>
          )}
        </div>

        <Footer />
      </main>

      {isActive && <TheBell targetTime={oracle.expiry} />}
    </div>
  );
}
