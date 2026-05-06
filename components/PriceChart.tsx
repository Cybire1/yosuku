'use client';

import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { fetchPriceHistory, type PriceData } from '@/lib/sui/predictApi';
import { FLOAT_SCALING } from '@/lib/sui/constants';
import { Activity } from 'lucide-react';

interface PriceChartProps {
  oracleId: string;
  strikePrice?: number | null; // in FLOAT_SCALING
  className?: string;
}

interface ChartPoint {
  time: string;
  timestamp: number;
  spot: number;
  forward: number;
}

export default function PriceChart({ oracleId, strikePrice, className = '' }: PriceChartProps) {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const history = await fetchPriceHistory(oracleId, 200);
        if (cancelled) return;

        const points: ChartPoint[] = history.map((p: PriceData) => ({
          time: new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          timestamp: p.timestamp,
          spot: p.spot / FLOAT_SCALING,
          forward: p.forward / FLOAT_SCALING,
        }));

        setData(points);
      } catch (err) {
        console.error('Failed to load price history:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 10_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [oracleId]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-16 ${className}`}>
        <Activity className="w-6 h-6 text-gray-600 animate-pulse" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-16 ${className}`}>
        <Activity className="w-6 h-6 text-gray-600 mb-2" />
        <p className="text-xs text-gray-600">No price data yet</p>
      </div>
    );
  }

  const strikeDollars = strikePrice ? strikePrice / FLOAT_SCALING : null;

  // Calculate chart domain
  const allValues = data.flatMap(d => [d.spot, d.forward]);
  if (strikeDollars) allValues.push(strikeDollars);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const padding = (maxVal - minVal) * 0.1 || 100;

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="spotGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34D399" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#34D399" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="forwardGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: '#666' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={60}
          />
          <YAxis
            domain={[minVal - padding, maxVal + padding]}
            tick={{ fontSize: 10, fill: '#666' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
            width={55}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1a1a1a',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '12px',
              fontSize: '11px',
              color: '#fff',
            }}
            formatter={(value: number | undefined) => [`$${(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, '']}
            labelStyle={{ color: '#888', fontSize: '10px' }}
          />
          {strikeDollars && (
            <ReferenceLine
              y={strikeDollars}
              stroke="#FB923C"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{
                value: `Strike $${strikeDollars.toLocaleString()}`,
                position: 'right',
                fill: '#FB923C',
                fontSize: 10,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="spot"
            stroke="#34D399"
            strokeWidth={2}
            fill="url(#spotGradient)"
            dot={false}
            name="Spot"
          />
          <Area
            type="monotone"
            dataKey="forward"
            stroke="#60A5FA"
            strokeWidth={1.5}
            fill="url(#forwardGradient)"
            dot={false}
            strokeDasharray="3 3"
            name="Forward"
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-[2px] bg-emerald-400 rounded" />
          <span className="text-[10px] text-gray-500">Spot</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-[2px] bg-blue-400 rounded" style={{ borderTop: '2px dashed' }} />
          <span className="text-[10px] text-gray-500">Forward</span>
        </div>
        {strikeDollars && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-[2px] bg-orange-400 rounded" style={{ borderTop: '2px dashed' }} />
            <span className="text-[10px] text-gray-500">Strike</span>
          </div>
        )}
      </div>
    </div>
  );
}
