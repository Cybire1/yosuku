'use client';

import { useState, useEffect, useRef, use } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import TheBell from '@/components/TheBell';
import TradePanel from '@/components/TradePanel';
import PriceChart from '@/components/PriceChart';
import { fetchOracles, fetchTrades, type OracleData, type TradeData } from '@/lib/sui/predictApi';
import { useOraclePrices, useSviPricing } from '@/lib/sui/hooks';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { computeSviPrice } from '@/lib/sui/sviPricing';
import { generateStrikeGrid, getTimeRemaining } from '@/lib/roundHelpers';
import { genCandles, drawCandles } from '@/lib/charts/canvasChart';

export default function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: oracleId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultSide = (searchParams.get('side') as 'UP' | 'DOWN') || 'UP';

  const [oracle, setOracle] = useState<OracleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 0, seconds: 0, expired: false, totalMs: 0 });
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);

  const { prices } = useOraclePrices(oracleId, 5_000);
  const { sviData } = useSviPricing(oracleId);

  // Load oracle data
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const all = await fetchOracles();
        if (cancelled) return;
        const found = all.find(o => o.oracle_id === oracleId);
        setOracle(found || null);
      } catch (err) {
        console.error('Failed to load oracle:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [oracleId]);

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

  // Canvas chart
  useEffect(() => {
    if (!chartCanvasRef.current || !oracle) return;
    const midStrike = oracle.min_strike + oracle.tick_size * 25;
    const strikeD = (selectedStrike || midStrike) / FLOAT_SCALING;
    const spot = prices?.spot ? prices.spot / FLOAT_SCALING : strikeD;
    const candles = genCandles(oracleId.charCodeAt(2) || 5, 60, spot - spot * 0.01, spot, spot * 0.005);
    drawCandles(chartCanvasRef.current, candles, {
      strike: strikeD,
      maxCandleW: 6,
      gridLines: true,
      marker: true,
      padX: 14,
      padTop: 12,
      padBot: 12,
    });
  }, [prices, oracle, selectedStrike, oracleId]);

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

  const strikes = generateStrikeGrid(oracle.min_strike, oracle.tick_size, 50);
  const midStrike = oracle.min_strike + oracle.tick_size * Math.floor(strikes.length / 2);
  const midStrikeDollars = midStrike / FLOAT_SCALING;
  const asset = oracle.underlying_asset || 'BTC';

  const formatPrice = (n: number) =>
    '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const pad = (n: number) => String(n).padStart(2, '0');

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
          </div>

          {isActive && (
            <div className="text-right">
              <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 block mb-1">
                Expires in
              </span>
              <span className="font-mono text-2xl font-semibold text-white">
                {timeLeft.expired ? 'Expired' : `${pad(timeLeft.hours)}:${pad(timeLeft.minutes)}:${pad(timeLeft.seconds)}`}
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

        {/* Live prices */}
        {(spot || forward) && (
          <div className="flex items-center gap-8 mb-8">
            {spot && (
              <div className="border-l border-white/[0.12] pl-3.5">
                <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 block">Spot</span>
                <span className="font-mono text-lg font-semibold text-white">{formatPrice(spot)}</span>
              </div>
            )}
            {forward && (
              <div className="border-l border-white/[0.12] pl-3.5">
                <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 block">Forward</span>
                <span className="font-mono text-lg font-semibold text-vermilion">{formatPrice(forward)}</span>
              </div>
            )}
          </div>
        )}

        {/* Main content */}
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: chart + trades + strikes */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Canvas chart */}
            <div className="relative border border-white/[0.08] rounded bg-bg overflow-hidden" style={{ height: '320px' }}>
              <div className="absolute top-0 left-0 right-0 flex justify-between items-center px-5 py-3 border-b border-white/5 z-[2] bg-bg/50 font-mono text-[10px] text-gray-500">
                <span>{asset} / USD · Candlestick</span>
                <span>Strike {formatPrice(midStrikeDollars)}</span>
              </div>
              <canvas ref={chartCanvasRef} className="absolute inset-x-0 top-10 bottom-0 w-full h-[calc(100%-40px)]" />
            </div>

            {/* Recharts fallback */}
            <div className="border border-white/[0.08] rounded bg-bg p-4">
              <PriceChart oracleId={oracleId} strikePrice={selectedStrike || midStrike} />
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
                      <span className={`font-mono font-semibold ${trade.side === 'mint' ? 'text-vermilion' : 'text-gray-400'}`}>
                        {trade.side === 'mint' ? '↑ UP' : '↓ DOWN'}
                      </span>
                      <span className="font-mono text-gray-400">
                        {(Number(trade.quantity) / DUSDC_MULTIPLIER).toFixed(2)} DUSDC
                      </span>
                      <span className="font-mono text-gray-600">
                        {new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Strike grid */}
            <div className="border border-white/[0.08] rounded bg-bg p-4">
              <h3 className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 mb-3">
                Strike Grid
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {strikes.map((strike) => {
                  const dollars = strike / FLOAT_SCALING;
                  const isSelected = strike === (selectedStrike || midStrike);
                  const isNearSpot = spot && Math.abs(dollars - spot) < (oracle.tick_size / FLOAT_SCALING) * 1.5;
                  // SVI fair price
                  let sviFairPrice: number | null = null;
                  if (sviData?.params && prices?.forward) {
                    sviFairPrice = computeSviPrice(sviData.params, strike, prices.forward);
                  }
                  return (
                    <button
                      key={strike}
                      onClick={() => setSelectedStrike(strike)}
                      data-cursor="hover"
                      className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all border flex flex-col items-center ${
                        isSelected
                          ? 'bg-white/15 text-white border-white/20'
                          : isNearSpot
                            ? 'bg-vermilion/5 text-vermilion/70 border-vermilion/10 hover:bg-vermilion/10'
                            : 'bg-white/[0.02] text-gray-500 border-white/5 hover:text-gray-300'
                      }`}
                    >
                      <span>${dollars.toLocaleString()}</span>
                      {sviFairPrice !== null && (
                        <span className="text-[9px] font-mono text-vermilion/70">{(sviFairPrice * 100).toFixed(1)}%</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: trade panel */}
          {isActive && (
            <div className="w-full lg:w-[380px] flex-shrink-0">
              <div className="lg:sticky lg:top-[120px]">
                <TradePanel
                  oracle={oracle}
                  spotPrice={prices?.spot}
                  forwardPrice={prices?.forward}
                  defaultSide={defaultSide}
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
