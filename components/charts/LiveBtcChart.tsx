'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';

interface PricePoint {
  time: string;
  price: number;
  timestamp: number;
}

interface LiveBtcChartProps {
  targetPrice?: number; // in cents — shown as reference line
  height?: number;
}

const MAX_POINTS = 300;
const STORAGE_KEY = 'dart_btc_chart';

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Load cached chart data from sessionStorage (discard if older than 10 min) */
function loadCachedData(): PricePoint[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const points: PricePoint[] = JSON.parse(raw);
    const cutoff = Date.now() - 10 * 60 * 1000;
    return points.filter(p => p.timestamp > cutoff);
  } catch {
    return [];
  }
}

function saveCachedData(points: PricePoint[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(points.slice(-MAX_POINTS)));
  } catch {
    // storage full, ignore
  }
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload as PricePoint;
  return (
    <div className="bg-neutral-900/95 backdrop-blur-xl border border-white/10 rounded-xl px-3 py-2 shadow-xl">
      <p className="text-[10px] text-gray-500 font-mono">{p.time}</p>
      <p className="text-sm font-mono font-bold text-white">
        ${p.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
    </div>
  );
};

// Pulsing dot on the last data point
const LiveDot = ({ cx, cy, index, total, color }: any) => {
  if (index !== total - 1) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={color} fillOpacity={0.15}>
        <animate attributeName="r" from="4" to="12" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="fill-opacity" from="0.3" to="0" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r={4} fill={color} stroke="#000" strokeWidth={1.5} />
    </g>
  );
};

export default function LiveBtcChart({ targetPrice, height }: LiveBtcChartProps) {
  const { price } = useBtcPrice();
  const [data, setData] = useState<PricePoint[]>(() => loadCachedData());
  const priceRef = useRef(0);

  const targetUsd = targetPrice ? targetPrice / 100 : undefined;

  // Keep ref in sync with latest price
  useEffect(() => {
    if (price > 0) priceRef.current = price;
  }, [price]);

  // Add a new data point every second, persist to sessionStorage
  useEffect(() => {
    const interval = setInterval(() => {
      const p = priceRef.current;
      if (p <= 0) return;
      const now = Date.now();
      setData(prev => {
        const point: PricePoint = { time: formatTime(now), price: p, timestamp: now };
        // If no data, seed with 2 points for immediate line
        if (prev.length === 0) {
          const seeded = [
            { time: formatTime(now - 1000), price: p, timestamp: now - 1000 },
            point,
          ];
          saveCachedData(seeded);
          return seeded;
        }
        const next = [...prev, point].slice(-MAX_POINTS);
        saveCachedData(next);
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Compute chart bounds — always include target price in view
  const { minY, maxY, isAboveTarget } = useMemo(() => {
    if (data.length === 0) return { minY: 0, maxY: 0, isAboveTarget: false };

    const prices = data.map(d => d.price);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);

    // Always include target in the visible range
    if (targetUsd) {
      lo = Math.min(lo, targetUsd);
      hi = Math.max(hi, targetUsd);
    }

    const range = hi - lo;
    // Tight padding — just enough to not clip the line
    const pad = Math.max(range * 0.2, 3);

    return {
      minY: lo - pad,
      maxY: hi + pad,
      isAboveTarget: targetUsd ? data[data.length - 1]?.price >= targetUsd : false,
    };
  }, [data, targetUsd]);

  if (data.length < 2) {
    return (
      <div style={height ? { height } : undefined} className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-new-mint/30 border-t-new-mint rounded-full animate-spin mx-auto mb-2" />
          <p className="text-[10px] text-gray-500 uppercase tracking-widest">Loading chart...</p>
        </div>
      </div>
    );
  }

  const first = data[0].price;
  const last = data[data.length - 1].price;
  const isUp = last >= first;
  const strokeColor = isUp ? '#34D399' : '#F43F5E';

  return (
    <div className="relative h-full" style={height ? { height } : undefined}>
      {/* Status badges — top overlay */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        {/* spacer */}
        <div />

        {/* Price delta */}
        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm ${
          isUp ? 'bg-new-mint/10 text-new-mint' : 'bg-off-red/10 text-off-red'
        }`}>
          {isUp ? '+' : ''}{(last - first).toFixed(2)}
          <span className="opacity-60">
            ({isUp ? '+' : ''}{((last - first) / first * 100).toFixed(3)}%)
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 30, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="btc-gradient-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34D399" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="btc-gradient-down" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F43F5E" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#F43F5E" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            horizontal={true}
            vertical={false}
            stroke="rgba(255,255,255,0.06)"
          />

          <XAxis
            dataKey="time"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: '#555' }}
            interval="preserveStartEnd"
            minTickGap={80}
          />
          <YAxis
            domain={[minY, maxY]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: '#666', fontFamily: 'monospace' }}
            tickFormatter={(v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            tickCount={5}
            width={62}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1 }} />

          {/* Target price line */}
          {targetUsd && (
            <ReferenceLine
              y={targetUsd}
              stroke="rgba(255,255,255,0.25)"
              strokeDasharray="6 4"
              strokeWidth={1.5}
              label={{
                value: 'Target',
                position: 'right',
                fill: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                fontWeight: 600,
              }}
            />
          )}

          <Area
            type="monotone"
            dataKey="price"
            stroke={strokeColor}
            strokeWidth={2}
            fill={`url(#btc-gradient-${isUp ? 'up' : 'down'})`}
            animationDuration={800}
            animationEasing="ease-in-out"
            isAnimationActive={true}
            dot={(props: any) => (
              <LiveDot {...props} total={data.length} color={strokeColor} />
            )}
            activeDot={{
              r: 5,
              stroke: strokeColor,
              strokeWidth: 2,
              fill: '#0a0a0a',
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
