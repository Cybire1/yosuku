'use client';

import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';

interface MiniPriceChartProps {
  data?: Array<{ timestamp: number; price: number }>;
  color?: string;
  className?: string;
}

const CustomizedDot = (props: any) => {
  const { cx, cy, index, length, stroke } = props;

  // Only render dot for the last data point
  if (index === length - 1) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill={stroke} fillOpacity={0.2} className="animate-ping" />
        <circle cx={cx} cy={cy} r={3} fill={stroke} stroke="#000" strokeWidth={1} />
      </g>
    );
  }
  return null;
};

export default function MiniPriceChart({
  data,
  color = '#34D399',
  className = ''
}: MiniPriceChartProps) {
  // Generate mock data if none provided (simulating price history)
  const chartData = data || generateMockData();

  // Determine if trending up or down
  const isUp = chartData[chartData.length - 1].price > chartData[0].price;
  const chartColor = isUp ? '#34D399' : '#EF4444'; // green or red

  return (
    <div className={`w-full h-full ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={['dataMin - 5', 'dataMax + 5']} hide />
          <Area
            type="monotone"
            dataKey="price"
            stroke={chartColor}
            strokeWidth={2}
            fill={`url(#gradient-${color})`}
            animationDuration={1500}
            dot={(props) => <CustomizedDot {...props} length={chartData.length} stroke={chartColor} />}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Generate realistic-looking mock price data
function generateMockData() {
  const points = 20;
  const data = [];
  let price = 50 + Math.random() * 30; // Start between 50-80

  for (let i = 0; i < points; i++) {
    // Random walk with slight upward bias
    const change = (Math.random() - 0.45) * 5;
    price = Math.max(10, Math.min(90, price + change));

    data.push({
      timestamp: Date.now() - (points - i) * 3600000, // Hours ago
      price: Math.round(price * 100) / 100
    });
  }

  return data;
}
