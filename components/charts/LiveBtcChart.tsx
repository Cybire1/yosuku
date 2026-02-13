'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';
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

const MAX_POINTS = 120;

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

export default function LiveBtcChart({ targetPrice, height = 370 }: LiveBtcChartProps) {
  const { price } = useBtcPrice();
  const [data, setData] = useState<PricePoint[]>([]);
  const lastAddTime = useRef(0);

  const targetUsd = targetPrice ? targetPrice / 100 : undefined;

  // Add points at a steady interval (every ~1s) for smooth cadence
  useEffect(() => {
    if (price <= 0) return;

    const now = Date.now();
    // Throttle to one point per second for smooth spacing
    if (now - lastAddTime.current < 900) return;
    lastAddTime.current = now;

    setData(prev => {
      const next = [...prev, { time: formatTime(now), price, timestamp: now }];
      return next.slice(-MAX_POINTS);
    });
  }, [price]);

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
    const pad = Math.max(range * 0.12, 10);

    return {
      minY: lo - pad,
      maxY: hi + pad,
      isAboveTarget: targetUsd ? data[data.length - 1]?.price >= targetUsd : false,
    };
  }, [data, targetUsd]);

  if (data.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center">
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
    <div className="relative" style={{ height }}>
      {/* Status badges — top overlay */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        {/* Above/Below target indicator */}
        {targetUsd && (
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm ${
            isAboveTarget
              ? 'bg-new-mint/15 text-new-mint border border-new-mint/20'
              : 'bg-off-red/15 text-off-red border border-off-red/20'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isAboveTarget ? 'bg-new-mint' : 'bg-off-red'} animate-pulse`} />
            {isAboveTarget ? 'Above Target — YES winning' : 'Below Target — NO winning'}
          </div>
        )}

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
              <stop offset="0%" stopColor="#34D399" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="btc-gradient-down" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F43F5E" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#F43F5E" stopOpacity={0} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="time"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: '#444' }}
            interval="preserveStartEnd"
            minTickGap={80}
          />
          <YAxis
            domain={[minY, maxY]}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: '#444' }}
            tickFormatter={(v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            width={62}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#333', strokeWidth: 1 }} />

          {/* Target price line — always visible */}
          {targetUsd && (
            <ReferenceLine
              y={targetUsd}
              stroke="#60A5FA"
              strokeDasharray="8 4"
              strokeWidth={2}
              label={{
                value: `TARGET  $${targetUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                position: 'insideTopRight',
                fill: '#60A5FA',
                fontSize: 11,
                fontWeight: 800,
              }}
            />
          )}

          <Area
            type="basis"
            dataKey="price"
            stroke={strokeColor}
            strokeWidth={2.5}
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
