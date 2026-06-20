'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { OracleData } from '@/lib/sui/predictApi';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import { getTimeRemaining, formatCountdown } from '@/lib/roundHelpers';
import { getCanonicalMarketLine } from '@/lib/marketLine';
import { genCandles, drawPriceLine, priceHistoryToCandles, type Candle } from '@/lib/charts/canvasChart';
import { fetchPriceHistory } from '@/lib/sui/predictApi';
import { seedOracle } from '@/lib/sui/oracleCache';
import { fetchOnChainQuote } from '@/lib/sui/onchainQuote';
import { Star } from 'lucide-react';

interface MarketCardProps {
  oracle: OracleData;
  spotPrice?: number | null;
  forwardPrice?: number | null;
  seedStrike?: number | null;
  horizonLabel?: string;
  isFavorite?: boolean;
  onToggleFavorite?: (oracleId: string) => void;
}

const ASSET_GLYPH: Record<string, string> = {
  BTC: '₿', ETH: 'Ξ', SOL: '◎', SUI: 'S',
};

export default function MarketCard({ oracle, spotPrice, forwardPrice, seedStrike, horizonLabel, isFavorite, onToggleFavorite }: MarketCardProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [timeLeft, setTimeLeft] = useState(getTimeRemaining(oracle.expiry));
  const [deltaPct, setDeltaPct] = useState<number | null>(null);
  const [askCents, setAskCents] = useState<{ up: number; down: number } | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(getTimeRemaining(oracle.expiry));
    }, 1000);
    return () => clearInterval(interval);
  }, [oracle.expiry]);

  // Keep the detail-page cache warm with what we already know about this oracle,
  // so opening it paints instantly instead of waiting on a /state round-trip.
  useEffect(() => {
    seedOracle(oracle, spotPrice, forwardPrice);
  }, [oracle, spotPrice, forwardPrice]);

  const spot = spotPrice ? spotPrice / FLOAT_SCALING : null;
  const forward = forwardPrice ? forwardPrice / FLOAT_SCALING : null;

  // Lock display strike on first price — question text shouldn't fluctuate
  const lockedStrikeRef = useRef<number | null>(null);
  const referencePrice = forwardPrice ?? spotPrice ?? oracle.settlement_price;
  const initialLine = getCanonicalMarketLine({
    oracle,
    referencePrice,
    explicitStrike: seedStrike,
  });
  if (lockedStrikeRef.current === null && initialLine && initialLine.source !== 'grid-fallback') {
    lockedStrikeRef.current = initialLine.strike;
  }
  const fallbackLine = getCanonicalMarketLine({ oracle, referencePrice });
  const displayStrike = lockedStrikeRef.current
    ?? (fallbackLine?.source !== 'grid-fallback' ? fallbackLine?.strike : null);
  const hasRealStrike = displayStrike !== null && displayStrike !== undefined;
  const midStrike = displayStrike
    ?? getCanonicalMarketLine({
      oracle,
      referencePrice,
    })?.strike ?? null;
  const midStrikeDollars = midStrike ? midStrike / FLOAT_SCALING : 0;
  const marketHref = hasRealStrike
    ? `/markets/${oracle.oracle_id}?strike=${midStrike}`
    : `/markets/${oracle.oracle_id}`;
  const sideHref = (side: 'UP' | 'DOWN') => hasRealStrike ? `${marketHref}&side=${side}` : marketHref;

  // On hover/touch, warm the exact route's JS chunk so the click is instant too.
  const warmed = useRef(false);
  const warm = () => {
    if (warmed.current) return;
    warmed.current = true;
    seedOracle(oracle, spotPrice, forwardPrice);
    router.prefetch(marketHref);
  };

  let yesProb = 50;
  if (forward && hasRealStrike && midStrikeDollars > 0) {
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
  const upAsk = askCents?.up ?? yesProb;
  const downAsk = askCents?.down ?? noProb;

  useEffect(() => {
    if (isSettled || isExpired || !hasRealStrike || midStrike === null) {
      setAskCents(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const [up, down] = await Promise.all([
          fetchOnChainQuote({
            oracleId: oracle.oracle_id,
            expiry: oracle.expiry,
            strike: midStrike,
            isUp: true,
            quantity: 1_000_000,
          }),
          fetchOnChainQuote({
            oracleId: oracle.oracle_id,
            expiry: oracle.expiry,
            strike: midStrike,
            isUp: false,
            quantity: 1_000_000,
          }),
        ]);
        if (!cancelled) {
          // Show Polymarket-style prices that SUM TO 100¢. The raw two-sided asks
          // each carry the vault spread, so up.mintCost + down.mintCost > 1 — printing
          // both bare reads as a broken market (e.g. 17¢ + 84¢ = 101¢). Normalise out
          // the spread into an implied price (= win chance), then derive the other side
          // as 100 − up so the pair always reads as clean complementary odds.
          const total = up.mintCost + down.mintCost;
          const upCents = total > 0
            ? Math.max(1, Math.min(99, Math.round((up.mintCost / total) * 100)))
            : Math.max(1, Math.min(99, Math.round(up.mintCost * 100)));
          setAskCents({ up: upCents, down: 100 - upCents });
        }
      } catch {
        if (!cancelled) setAskCents(null);
      }
    };

    load();
    const iv = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [hasRealStrike, isExpired, isSettled, midStrike, oracle.expiry, oracle.oracle_id]);

  // Sparkline chart. Price history barely changes over a card's lifetime, so we
  // fetch it ONCE per oracle and cache the candles — redraws (on spot/strike
  // ticks) reuse them instead of re-hitting /prices every 10s. That alone was
  // generating thousands of edge requests per oracle.
  const candlesRef = useRef<{ id: string; candles: Candle[] } | null>(null);
  useEffect(() => {
    if (!canvasRef.current || isSettled) return;
      const strike = midStrikeDollars || (spot ?? 0);
    let cancelled = false;

    const draw = (candles: Candle[]) => {
      if (cancelled || !canvasRef.current) return;
      const series = candles.map(c => c.close);
      const first = series[0], last = series[series.length - 1];
      if (first > 0) setDeltaPct(((last - first) / first) * 100);
      // Same metaphor as the detail page: one line vs the price-to-beat.
      drawPriceLine(canvasRef.current, series, {
        target: strike, verdict: true, padX: 4, padTop: 6, padBot: 6,
      });
    };

    // Already have real candles for this oracle → just redraw, no network.
    if (candlesRef.current?.id === oracle.oracle_id) {
      draw(candlesRef.current.candles);
      return;
    }

    // No price yet → cheap placeholder, don't fetch.
    if (!spot) {
      const seed = oracle.oracle_id.charCodeAt(4) || 7;
      const range = strike * 0.012;
      draw(genCandles(seed, 28, strike - range * 0.4, strike, range * 0.5));
      return;
    }

    // First time we have a price for this oracle → fetch history once, cache it.
    (async () => {
      let candles: Candle[] | undefined;
      try {
        const history = await fetchPriceHistory(oracle.oracle_id, 60);
        if (!cancelled && history.length > 5) {
          const scaled = history.map(h => ({ spot: h.spot / FLOAT_SCALING, timestamp: h.timestamp }));
          candles = priceHistoryToCandles(scaled, 28);
        }
      } catch { /* ignore */ }

      if (!candles || candles.length === 0) {
        const seed = oracle.oracle_id.charCodeAt(4) || 7;
        const range = strike * 0.012;
        candles = genCandles(seed, 28, strike - range * 0.4, spot || strike, range * 0.5);
      }
      if (!cancelled) {
        candlesRef.current = { id: oracle.oracle_id, candles };
        draw(candles);
      }
    })();
    return () => { cancelled = true; };
  }, [spot, midStrikeDollars, isSettled, oracle.oracle_id]);

  const formatPrice = (n: number) =>
    '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const countdownStr = isSettled ? 'Settled' : formatCountdown(timeLeft);

  const asset = oracle.underlying_asset || 'BTC';
  const glyph = ASSET_GLYPH[asset] || asset[0];
  const questionLabel = hasRealStrike
    ? `${asset} above ${formatPrice(midStrikeDollars)}`
    : `${asset} market`;

  return (
    <article
      className={`market-card ${isUrgent ? 'urgent' : ''}`}
      role="link"
      tabIndex={0}
      aria-label={`${questionLabel}. Opens market details.`}
      onClick={() => router.push(marketHref)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(marketHref);
        }
      }}
      onMouseEnter={warm}
      onPointerDown={warm}
      data-cursor="hover"
    >
      {/* Head */}
      <div className="mc-head">
        <span className="mc-asset">
          <span className="glyph">{glyph}</span>
          {asset} · {horizonLabel ?? '15-min'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onToggleFavorite && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(oracle.oracle_id); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                display: 'flex', alignItems: 'center', transition: 'transform 150ms',
              }}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-label={isFavorite ? `Remove ${questionLabel} from favorites` : `Add ${questionLabel} to favorites`}
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

        {/* Hero-chart language: big live price + change, chart, LIVE strip */}
        {!isSettled && (
          <div className="mc-pricebar">
            <div className="px">
              <span className="big">{spot ? formatPrice(spot) : '—'}</span>
              {deltaPct !== null && (
                <span className={`chg ${deltaPct >= 0 ? 'up' : 'down'}`}>
                  {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(2)}%
                </span>
              )}
            </div>
            <span className="strike-meta">
              STRIKE {hasRealStrike ? formatPrice(midStrikeDollars) : '···'}
            </span>
          </div>
        )}

        {!isSettled && (
          <div className="mc-spark">
            <canvas ref={canvasRef} />
          </div>
        )}

        {!isSettled && !isExpired && (
          <div className="mc-strip">
            <span>{askCents ? 'LIVE · ON-CHAIN ODDS' : 'EST · QUOTING'}</span>
            <span className="ramp">
              <span>UP</span>
              <span className="bar"><span className="fill" style={{ width: `${Math.min(99, Math.max(1, upAsk))}%` }} /></span>
              <span className="pct">{upAsk}¢</span>
            </span>
          </div>
        )}
        {!isSettled && isExpired && (
          <div className="mc-strip">
            <span>SETTLING · AWAITING THE ORACLE&apos;S PRINT</span>
          </div>
        )}

        {isSettled && oracle.settlement_price !== null && (() => {
          // Make the outcome explicit: UP wins if it closed above the line, else DOWN.
          // A bettor shouldn't have to mentally compare two numbers to see who won.
          const sp = oracle.settlement_price;
          const upWon = hasRealStrike && midStrike !== null ? sp > midStrike : null;
          return (
            <div className={`settled-result ${upWon === false ? 'down' : 'up'}`}>
              <span className="arrow">{upWon === false ? '↓' : '↑'}</span>
              {upWon === null ? 'Settled' : upWon ? 'UP won' : 'DOWN won'} · {formatPrice(sp / FLOAT_SCALING)}
            </div>
          );
        })()}
      </div>

      {/* Foot — bet buttons only while the round is actually tradable */}
      {!isSettled && !isExpired && hasRealStrike && (
        <div className="mc-foot">
          <button
            type="button"
            className="mc-side up"
            data-cursor="up"
            aria-label={`Buy UP on ${questionLabel} for ${upAsk} cents`}
            onClick={(e) => { e.stopPropagation(); router.push(sideHref('UP')); }}
          >
            <span>UP</span>
            <span className="price">{upAsk}¢</span>
          </button>
          <button
            type="button"
            className="mc-side down"
            data-cursor="hover"
            aria-label={`Buy DOWN on ${questionLabel} for ${downAsk} cents`}
            onClick={(e) => { e.stopPropagation(); router.push(sideHref('DOWN')); }}
          >
            <span>DOWN</span>
            <span className="price">{downAsk}¢</span>
          </button>
        </div>
      )}
    </article>
  );
}
