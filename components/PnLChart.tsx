'use client';

import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Tooltip } from 'recharts';
import { formatPred, type RoundState, type UserPosition } from '@/lib/predictionContract';
import { getSavedPayout } from '@/lib/roundHelpers';

interface PnLChartProps {
  rounds: RoundState[];
  positions: UserPosition[];
  address?: string | null;
}

export default function PnLChart({ rounds, positions, address }: PnLChartProps) {
  const data = useMemo(() => {
    const resolved = rounds
      .filter(r => r.resolved && r.outcome !== null)
      .sort((a, b) => a.id - b.id);

    let cumPnl = 0;
    const points: { round: number; pnl: number }[] = [{ round: 0, pnl: 0 }];

    for (const round of resolved) {
      const pos = positions.find(p => p.roundId === round.id);
      if (!pos) continue;

      const userSide = pos.yesDeposit > 0 ? 'YES' : 'NO';
      const deposit = Math.max(pos.yesDeposit, pos.noDeposit);
      const winningSide = round.outcome ? 'YES' : 'NO';

      if (userSide === winningSide) {
        const payout = address ? getSavedPayout(address, round.id) : 0;
        cumPnl += payout - deposit;
      } else {
        cumPnl -= deposit;
      }

      points.push({ round: round.id, pnl: cumPnl });
    }

    return points;
  }, [address, rounds, positions]);

  if (data.length < 3) {
    return (
      <div className="bg-neutral-900/40 border border-white/5 rounded-xl p-4 text-center">
        <span className="text-[11px] text-gray-500">Place more bets to see your P&L chart</span>
      </div>
    );
  }

  const isPositive = data[data.length - 1].pnl >= 0;
  const color = isPositive ? '#34D399' : '#F43F5E';

  return (
    <div className="bg-neutral-900/40 border border-white/5 rounded-xl p-3 pt-2">
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
          Cumulative P&L
        </span>
        <span className={`text-xs font-mono font-bold ${isPositive ? 'text-new-mint' : 'text-off-red'}`}>
          {data[data.length - 1].pnl >= 0 ? '+' : ''}{formatPred(data[data.length - 1].pnl)}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="round" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <ReferenceLine y={0} stroke="#ffffff10" strokeDasharray="3 3" />
          <Tooltip
            contentStyle={{
              background: '#171717',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              fontSize: '11px',
            }}
            labelFormatter={(v) => `Round #${v}`}
            formatter={(value) => [`${formatPred(Number(value ?? 0))} USDCx`, 'P&L']}
          />
          <Area
            type="monotone"
            dataKey="pnl"
            stroke={color}
            strokeWidth={2}
            fill="url(#pnlGrad)"
            dot={false}
            activeDot={{ r: 3, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
