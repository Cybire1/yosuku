'use client';

import { useState } from 'react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, BarChart3, Activity, DollarSign } from 'lucide-react';

interface MarketAnalyticsProps {
  marketId: string;
}

export default function MarketAnalytics({ marketId }: MarketAnalyticsProps) {
  const [timeframe, setTimeframe] = useState<'1H' | '24H' | '7D' | '30D' | 'ALL'>('24H');
  const [chartType, setChartType] = useState<'price' | 'volume'>('price');

  // Mock data - in production, this would come from your backend/indexer
  const generateMockPriceData = () => {
    const points = timeframe === '1H' ? 12 : timeframe === '24H' ? 24 : timeframe === '7D' ? 7 : timeframe === '30D' ? 30 : 90;
    const data = [];
    let yesPrice = 0.45;

    for (let i = 0; i < points; i++) {
      yesPrice += (Math.random() - 0.5) * 0.05;
      yesPrice = Math.max(0.2, Math.min(0.8, yesPrice));

      data.push({
        time: timeframe === '1H' ? `${i}:00` :
              timeframe === '24H' ? `${i}:00` :
              timeframe === '7D' ? `Day ${i + 1}` :
              timeframe === '30D' ? `Day ${i + 1}` :
              `Week ${i + 1}`,
        yes: yesPrice,
        no: 1 - yesPrice,
        volume: Math.random() * 10000 + 5000,
      });
    }
    return data;
  };

  const data = generateMockPriceData();

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-neutral-900/95 backdrop-blur-xl border border-white/10 rounded-xl p-4 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">{payload[0].payload.time}</p>
          <div className="space-y-1">
            <p className="text-sm font-bold text-off-green">
              YES: {(payload[0].value * 100).toFixed(1)}%
            </p>
            <p className="text-sm font-bold text-off-red">
              NO: {((1 - payload[0].value) * 100).toFixed(1)}%
            </p>
            {chartType === 'volume' && (
              <p className="text-sm font-bold text-new-blue">
                Volume: ${payload[1]?.value.toFixed(0)}
              </p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="relative">
      <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-2xl" />
      <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />

      <div className="relative p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-off-blue" />
            <h3 className="text-xl font-black uppercase tracking-tight">Market Analytics</h3>
          </div>

          {/* Chart Type Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setChartType('price')}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                chartType === 'price'
                  ? 'bg-off-blue text-white'
                  : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              <TrendingUp className="w-4 h-4 inline mr-1" />
              Price
            </button>
            <button
              onClick={() => setChartType('volume')}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                chartType === 'volume'
                  ? 'bg-off-blue text-white'
                  : 'bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4 inline mr-1" />
              Volume
            </button>
          </div>
        </div>

        {/* Timeframe Selector */}
        <div className="flex gap-2 mb-6">
          {(['1H', '24H', '7D', '30D', 'ALL'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
                timeframe === tf
                  ? 'bg-white text-black'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div className="h-80">
          {chartType === 'price' ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorYes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34D399" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#34D399" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis
                  dataKey="time"
                  stroke="#666"
                  style={{ fontSize: '11px', fontFamily: 'monospace' }}
                />
                <YAxis
                  stroke="#666"
                  tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  style={{ fontSize: '11px', fontFamily: 'monospace' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="yes"
                  stroke="#34D399"
                  strokeWidth={3}
                  fill="url(#colorYes)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis
                  dataKey="time"
                  stroke="#666"
                  style={{ fontSize: '11px', fontFamily: 'monospace' }}
                />
                <YAxis
                  stroke="#666"
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                  style={{ fontSize: '11px', fontFamily: 'monospace' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="volume" fill="#60A5FA" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/10">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Current</div>
            <div className="text-lg font-black text-off-green">{(data[data.length - 1].yes * 100).toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">24h Change</div>
            <div className="text-lg font-black text-off-green">+5.2%</div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Volume</div>
            <div className="text-lg font-black text-white">$12.4k</div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-1">Liquidity</div>
            <div className="text-lg font-black text-white">$45.2k</div>
          </div>
        </div>
      </div>
    </div>
  );
}
