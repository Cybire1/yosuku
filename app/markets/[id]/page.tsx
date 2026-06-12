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
import { useOracleState } from '@/lib/sui/hooks';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { Share2, Link2, Check, TrendingUp, TrendingDown } from 'lucide-react';
import PriceAlertsButton from '@/components/PriceAlerts';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';
import { checkAlerts, sendNotification } from '@/lib/priceAlerts';
import Tooltip from '@/components/Tooltip';
import { getTimeRemaining, nearestStrike, formatCountdown } from '@/lib/roundHelpers';
import { genCandles, drawPriceLine } from '@/lib/charts/canvasChart';
import { fetchPriceHistory } from '@/lib/sui/predictApi';

export default function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: oracleId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultSide = (searchParams.get('side') as 'UP' | 'DOWN') || 'UP';

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

  // Keyboard shortcuts: u → UP, d → DOWN, Escape → go back
  useKeyboardShortcuts(useMemo(() => ({
    'u': () => setActiveSide('UP'),
    'd': () => setActiveSide('DOWN'),
    'Escape': () => router.push('/markets'),
  }), [router]));

  // Single combined API call: oracle + prices + SVI
  const { state: oracleState, loading } = useOracleState(oracleId);
  const oracle = oracleState?.oracle ?? null;
  const prices = oracleState?.latest_price ?? null;
  const sviData = oracleState?.latest_svi ?? null;

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
    // Same strike the rest of the page shows — NOT the raw grid midpoint, which
    // can sit far from spot and squash the candles against the chart edge.
    const ref = prices?.forward || prices?.spot;
    const fallbackMid = ref
      ? nearestStrike(ref, oracle.min_strike, oracle.tick_size)
      : oracle.min_strike + oracle.tick_size * 25;
    const strikeD = (selectedStrike ?? pinnedStrike ?? fallbackMid) / FLOAT_SCALING;

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
        });
      }
    }
    renderChart();
    return () => { cancelled = true; };
  }, [prices, oracle, selectedStrike, pinnedStrike, oracleId]);

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
    if (pinnedStrike !== null || !oracle) return;
    const ref = prices?.forward || prices?.spot;
    if (ref) setPinnedStrike(nearestStrike(ref, oracle.min_strike, oracle.tick_size));
  }, [prices, oracle, pinnedStrike]);

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

  const refPriceForGrid = prices?.forward || prices?.spot;
  const midStrike = pinnedStrike ?? (refPriceForGrid
    ? nearestStrike(refPriceForGrid, oracle.min_strike, oracle.tick_size)
    : oracle.min_strike + oracle.tick_size * 25);
  const midStrikeDollars = (selectedStrike ?? midStrike) / FLOAT_SCALING;
  const asset = oracle.underlying_asset || 'BTC';

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
                isActive
                  ? 'text-vermilion bg-vermilion/10 border-vermilion/20'
                  : 'text-gray-400 bg-white/5 border-white/10'
              }`}>
                {oracle.status}
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
                    ? `$${Math.round(spot - midStrikeDollars).toLocaleString()} above the bar`
                    : `needs +$${Math.round(midStrikeDollars - spot).toLocaleString()}`}
                </span>
                <span className="text-gray-600">·</span>
                <span className={timeLeft.totalMs < 120_000 ? 'text-vermilion' : 'text-gray-400'}>
                  {formatCountdown(timeLeft)} left
                </span>
              </div>
            )}
            {/* Photo finish — dead zone between expiry and the settlement print */}
            {inDeadZone && spot !== null && (
              <div className="flex items-center gap-2 mt-3 font-mono text-base">
                <span className="text-gray-400">photo finish —</span>
                <span className={spot > midStrikeDollars ? 'text-profit font-semibold' : 'text-loss font-semibold'}>
                  last spot {formatPrice(spot)} {spot > midStrikeDollars ? 'above' : 'at/below'} the bar
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
                waiting for the oracle&apos;s print — usually under 2 min
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
              const url = `https://yosuku.xyz/markets/${oracleId}`;
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
              navigator.clipboard.writeText(`https://yosuku.xyz/markets/${oracleId}`);
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

        {/* Settlement result card */}
        {isSettled && oracle.settlement_price !== null && (() => {
          const settlementDollars = oracle.settlement_price / FLOAT_SCALING;
          const upWins = settlementDollars >= midStrikeDollars;
          return (
            <div className={`flex items-center gap-4 p-4 rounded-xl border mb-8 ${
              upWins
                ? 'border-emerald-500/20 bg-emerald-500/[0.06]'
                : 'border-rose-500/20 bg-rose-500/[0.06]'
            }`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                upWins ? 'bg-emerald-500/20' : 'bg-rose-500/20'
              }`}>
                {upWins
                  ? <TrendingUp style={{ width: 20, height: 20, color: '#34D399' }} />
                  : <TrendingDown style={{ width: 20, height: 20, color: '#F43F5E' }} />
                }
              </div>
              <div className="flex-1">
                <div className={`text-sm font-bold ${upWins ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {upWins ? 'UP Wins' : 'DOWN Wins'}
                </div>
                <div className="text-xs text-gray-400">
                  {asset} settled at {formatPrice(settlementDollars)} — {upWins ? 'above' : 'below'} strike {formatPrice(midStrikeDollars)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xs text-gray-500">Settlement</div>
                <div className="font-mono text-sm font-semibold text-white">{formatPrice(settlementDollars)}</div>
              </div>
            </div>
          );
        })()}

        {/* Personal verdict + next-round loop */}
        {isSettled && <Verdict oracle={oracle} />}

        {/* Live prices */}
        {(spot || forward) && (
          <div className="flex items-center gap-8 mb-8">
            {spot && (
              <div className="border-l border-white/[0.12] pl-3.5">
                <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 flex items-center gap-1">Spot <Tooltip text="Current Pyth oracle price for this asset." position="bottom" /></span>
                <span className="font-mono text-lg font-semibold text-white">{formatPrice(spot)}</span>
              </div>
            )}
            {forward && (
              <div className="border-l border-white/[0.12] pl-3.5">
                <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 flex items-center gap-1">Forward <Tooltip text="Where the market expects the price to be at expiry — what your odds are priced against." position="bottom" /></span>
                <span className="font-mono text-lg font-semibold text-gray-300">{formatPrice(forward)}</span>
              </div>
            )}
          </div>
        )}

        {/* Volume & Open Interest */}
        {trades.length > 0 && (
          <div className="flex items-center gap-8 mb-8">
            <div className="border-l border-white/[0.12] pl-3.5">
              <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 flex items-center gap-1">
                Volume <Tooltip text="Total minted volume for this oracle." position="bottom" />
              </span>
              <span className="font-mono text-lg font-semibold text-white">
                {(trades.filter(t => t.type === 'mint').reduce((sum, t) => sum + t.quantity, 0) / DUSDC_MULTIPLIER).toFixed(0)} DUSDC
              </span>
            </div>
            <div className="border-l border-white/[0.12] pl-3.5">
              <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 flex items-center gap-1">
                Open Interest <Tooltip text="Net minted minus redeemed positions." position="bottom" />
              </span>
              <span className="font-mono text-lg font-semibold text-white">
                {Math.max(0, (
                  trades.filter(t => t.type === 'mint').reduce((s, t) => s + t.quantity, 0) -
                  trades.filter(t => t.type === 'redeem').reduce((s, t) => s + t.quantity, 0)
                ) / DUSDC_MULTIPLIER).toFixed(0)} DUSDC
              </span>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: chart + trades + strikes */}
          <div className="flex-1 min-w-0 space-y-6">
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
                        {trade.type === 'mint' ? '↑ MINT' : '↓ REDEEM'}
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
            <div className="w-full lg:w-[380px] flex-shrink-0">
              <div className="lg:sticky lg:top-[120px] rounded-2xl border border-white/[0.08] bg-neutral-900/60 p-6 text-center">
                <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-500 mb-2">Trading closed</p>
                <p className="text-sm text-gray-400 leading-relaxed">
                  The bell has rung. The oracle posts the settlement print shortly — winners can claim from their portfolio right after.
                </p>
              </div>
            </div>
          )}
          {isTradable && (
            <div className="w-full lg:w-[380px] flex-shrink-0">
              <div className="lg:sticky lg:top-[120px] space-y-4">
                <CashOut oracleId={oracleId} expiry={oracle.expiry} isActive={isTradable} />
                <TradePanel
                  key={activeSide}
                  oracle={oracle}
                  spotPrice={prices?.spot}
                  forwardPrice={prices?.forward}
                  defaultSide={activeSide}
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
