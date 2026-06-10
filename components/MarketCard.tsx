'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { OracleData } from '@/lib/sui/predictApi';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import { getTimeRemaining, nearestStrike, formatCountdown } from '@/lib/roundHelpers';
import { genCandles, drawCandles, priceHistoryToCandles } from '@/lib/charts/canvasChart';
import { fetchPriceHistory } from '@/lib/sui/predictApi';
import { Star } from 'lucide-react';

interface MarketCardProps {
  oracle: OracleData;
  spotPrice?: number | null;
  forwardPrice?: number | null;
  isFavorite?: boolean;
  onToggleFavorite?: (oracleId: string) => void;
}

const ASSET_GLYPH: Record<string, string> = {
  BTC: '₿', ETH: 'Ξ', SOL: '◎', SUI: 'S',
};

export default function MarketCard({ oracle, spotPrice, forwardPrice, isFavorite, onToggleFavorite }: MarketCardProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeLeft, setTimeLeft] = useState(getTimeRemaining(oracle.expiry));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(getTimeRemaining(oracle.expiry));
    }, 1000);
    return () => clearInterval(interval);
  }, [oracle.expiry]);

  const spot = spotPrice ? spotPrice / FLOAT_SCALING : null;
  const forward = forwardPrice ? forwardPrice / FLOAT_SCALING : null;

  // Lock display strike on first price — question text shouldn't fluctuate
  const lockedStrikeRef = useRef<number | null>(null);
  const refPrice = forward || spot;
  // For settled oracles, use settlement_price as reference
  const settledRef = oracle.settlement_price ? oracle.settlement_price / FLOAT_SCALING : null;
  const priceRef = refPrice || settledRef;
  if (priceRef && lockedStrikeRef.current === null) {
    lockedStrikeRef.current = nearestStrike(priceRef * FLOAT_SCALING, oracle.min_strike, oracle.tick_size);
  }
  const hasRealStrike = lockedStrikeRef.current !== null;
  const midStrike = lockedStrikeRef.current ?? (oracle.min_strike + oracle.tick_size * 25);
  const midStrikeDollars = midStrike / FLOAT_SCALING;

  let yesProb = 50;
  if (forward && midStrikeDollars > 0) {
    const diff = (forward - midStrikeDollars) / midStrikeDollars;
    const minsLeft = Math.max(1, timeLeft.totalMs / 60000);
    const sigma = 0.001 * Math.sqrt(minsLeft);
    const z = diff / (sigma || 0.01);
    yesProb = Math.round(Math.max(1, Math.min(99, 100 / (1 + Math.exp(-1.7 * z)))));
  }
  const noProb = 100 - yesProb;

  const isExpired = timeLeft.expired;
  const isSettled = oracle.status === 'settled';
  const isUrgent = !isExpired && timeLeft.totalMs < 5 * 60 * 1000;

  // Sparkline chart — defer fetch until spot price is available to avoid connection exhaustion
  const chartDrawn = useRef(false);
  useEffect(() => {
    if (!canvasRef.current || isSettled) return;
    // Don't fetch price history until we have actual price data — use generated candles as placeholder
    if (!spot && !chartDrawn.current) {
      const strike = midStrikeDollars;
      const seed = oracle.oracle_id.charCodeAt(4) || 7;
      const range = strike * 0.012;
      const start = strike - range * 0.4;
      const candles = genCandles(seed, 28, start, strike, range * 0.5);
      drawCandles(canvasRef.current, candles, {
        strike, maxCandleW: 4, padX: 4, padTop: 6, padBot: 6, marker: true,
      });
      return;
    }
    const strike = midStrikeDollars;
    let cancelled = false;

    async function render() {
      let candles;
      try {
        const history = await fetchPriceHistory(oracle.oracle_id, 60);
        if (!cancelled && history.length > 5) {
          const scaled = history.map(h => ({ spot: h.spot / FLOAT_SCALING, timestamp: h.timestamp }));
          candles = priceHistoryToCandles(scaled, 28);
        }
      } catch { /* ignore */ }

      // Fallback to generated candles
      if (!candles || candles.length === 0) {
        const seed = oracle.oracle_id.charCodeAt(4) || 7;
        const spotVal = spot || strike;
        const range = strike * 0.012;
        const start = strike - range * 0.4;
        candles = genCandles(seed, 28, start, spotVal, range * 0.5);
      }

      if (!cancelled && canvasRef.current) {
        chartDrawn.current = true;
        drawCandles(canvasRef.current, candles, {
          strike, maxCandleW: 4, padX: 4, padTop: 6, padBot: 6, marker: true,
        });
      }
    }
    render();
    return () => { cancelled = true; };
  }, [spot, midStrikeDollars, isSettled, oracle.oracle_id]);

  const formatPrice = (n: number) =>
    '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const countdownStr = isSettled ? 'Settled' : formatCountdown(timeLeft);

  const asset = oracle.underlying_asset || 'BTC';
  const glyph = ASSET_GLYPH[asset] || asset[0];

  // Strike position for spark overlay (percentage from top)
  const strikeY = 50;

  return (
    <article
      className={`market-card ${isUrgent ? 'urgent' : ''}`}
      onClick={() => router.push(`/markets/${oracle.oracle_id}`)}
      data-cursor="hover"
    >
      {/* Head */}
      <div className="mc-head">
        <span className="mc-asset">
          <span className="glyph">{glyph}</span>
          {asset} · 15-min
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onToggleFavorite && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(oracle.oracle_id); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                display: 'flex', alignItems: 'center', transition: 'transform 150ms',
              }}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star
                style={{
                  width: 14, height: 14,
                  color: isFavorite ? 'var(--vermilion)' : 'var(--gray-600)',
                  fill: isFavorite ? 'var(--vermilion)' : 'none',
                  transition: 'color 150ms, fill 150ms',
                }}
              />
            </button>
          )}
          <span className={`mc-countdown ${isUrgent ? 'urgent' : ''}`}>
            <span className="clock-dot" />
            {countdownStr}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="mc-body">
        <div className="mc-question">
          {hasRealStrike
            ? <>{asset} above {formatPrice(midStrikeDollars)}?</>
            : <>{asset} above <span className="strike-loading">···</span></>
          }
          <span className="strike-dot" />
        </div>

        {!isSettled && (
          <div className="mc-spark">
            <canvas ref={canvasRef} />
            {hasRealStrike && (
              <>
                <div className="strike-line" style={{ top: `${strikeY}%` }} />
                <span className="strike-tick" style={{ top: `${strikeY}%` }}>
                  {midStrikeDollars.toLocaleString()}
                </span>
              </>
            )}
          </div>
        )}

        {!isSettled && (
          <div
            className="mc-weight"
            style={{ '--up-w': yesProb, '--down-w': noProb } as React.CSSProperties}
          >
            <span className="up-w" data-cursor="up">↑ {yesProb}¢</span>
            <span className="down-w" data-cursor="hover">↓ {noProb}¢</span>
          </div>
        )}

        <div className="mc-stats">
          {spot && <span>Spot <span className="v">{formatPrice(spot)}</span></span>}
          {hasRealStrike && <span>Strike <span className="v">{formatPrice(midStrikeDollars)}</span></span>}
        </div>

        {isSettled && oracle.settlement_price !== null && (
          <div className="settled-result up">
            <span className="arrow">↑</span>
            Settled at {formatPrice(oracle.settlement_price / FLOAT_SCALING)}
          </div>
        )}
      </div>

      {/* Foot */}
      {!isSettled && (
        <div className="mc-foot">
          <button
            className="mc-side up"
            data-cursor="up"
            onClick={(e) => { e.stopPropagation(); router.push(`/markets/${oracle.oracle_id}?side=UP`); }}
          >
            <span>UP</span>
            <span className="price">{yesProb}¢</span>
          </button>
          <button
            className="mc-side down"
            data-cursor="hover"
            onClick={(e) => { e.stopPropagation(); router.push(`/markets/${oracle.oracle_id}?side=DOWN`); }}
          >
            <span>DOWN</span>
            <span className="price">{noProb}¢</span>
          </button>
        </div>
      )}
    </article>
  );
}
