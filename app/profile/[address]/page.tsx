'use client';

import { useState, useEffect, useRef, use } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import SectionHeader from '@/components/SectionHeader';
import { fetchManagers, fetchManagerSummary, fetchManagerPositionsSummary, fetchManagerPnL } from '@/lib/sui/predictApi';
import type { ManagerSummaryData, ManagerPositionSummary, ManagerPnLData } from '@/lib/sui/predictApi';
import { DUSDC_MULTIPLIER, FLOAT_SCALING } from '@/lib/sui/constants';
import { drawEquityCurve } from '@/lib/charts/canvasChart';

export default function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ManagerSummaryData | null>(null);
  const [positions, setPositions] = useState<ManagerPositionSummary[]>([]);
  const [pnl, setPnl] = useState<ManagerPnLData | null>(null);
  const equityRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const managers = await fetchManagers(address);
        if (cancelled || managers.length === 0) { setLoading(false); return; }
        const managerId = managers[0].manager_id;
        const [s, p, pnlData] = await Promise.all([
          fetchManagerSummary(managerId),
          fetchManagerPositionsSummary(managerId),
          fetchManagerPnL(managerId),
        ]);
        if (!cancelled) {
          setSummary(s);
          setPositions(p);
          setPnl(pnlData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [address]);

  // Draw equity curve
  useEffect(() => {
    if (!equityRef.current || !pnl?.points?.length) return;
    const data = pnl.points.map(p => p.cumulative_realized_pnl / DUSDC_MULTIPLIER);
    if (data.length > 1) drawEquityCurve(equityRef.current, data);
  }, [pnl]);

  const tradeCount = positions.length;
  const winCount = positions.filter(p => p.realized_pnl > 0).length;
  const settledCount = positions.filter(p => p.status === 'settled').length;
  const winRate = settledCount > 0 ? ((winCount / settledCount) * 100).toFixed(1) : '—';
  const totalPnl = summary?.realized_pnl ?? positions.reduce((s, p) => s + p.realized_pnl, 0);
  const truncAddr = `${address.slice(0, 8)}…${address.slice(-6)}`;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        <div className="breadcrumb mb-6">
          <a href="/leaderboard" data-cursor="hover">Leaderboard</a>
          <span className="sep">/</span>
          <span style={{ color: 'var(--white)' }}>Profile</span>
        </div>

        <h1 className="font-display font-[800] text-2xl sm:text-3xl text-white tracking-tight mb-2">
          {truncAddr}
        </h1>
        <p className="font-mono text-xs text-gray-600 mb-8 break-all">{address}</p>

        {loading && (
          <div className="text-center py-16">
            <p className="text-sm text-gray-500">Loading profile...</p>
          </div>
        )}

        {!loading && !summary && positions.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4 opacity-20">空</div>
            <h3 className="text-lg font-bold text-white mb-2">No Trading Activity</h3>
            <p className="text-sm text-gray-500">This address has no positions on DeepBook Predict.</p>
          </div>
        )}

        {!loading && (summary || positions.length > 0) && (
          <div className="space-y-8">
            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total Trades', value: String(tradeCount) },
                { label: 'Win Rate', value: `${winRate}%` },
                { label: 'Realized P&L', value: `${totalPnl >= 0 ? '+' : ''}${(totalPnl / DUSDC_MULTIPLIER).toFixed(2)}`, color: totalPnl >= 0 ? '#34D399' : '#F43F5E' },
                { label: 'Open Positions', value: String(summary?.open_positions ?? 0) },
              ].map(stat => (
                <div key={stat.label} className="border border-white/[0.08] rounded-xl bg-bg p-4">
                  <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 mb-1">{stat.label}</div>
                  <div className="font-mono text-lg font-semibold" style={{ color: stat.color || 'var(--white)' }}>
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Equity curve */}
            {pnl?.points && pnl.points.length > 1 && (
              <div className="border border-white/[0.08] rounded-xl bg-bg p-5">
                <h3 className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600 mb-3">Equity Curve</h3>
                <canvas ref={equityRef} className="w-full" style={{ height: '200px' }} />
              </div>
            )}

            {/* Position history */}
            <div>
              <SectionHeader number="01" title="Position History" jp="取引履歴" count={positions.length} />
              <div className="border border-white/[0.08] rounded-xl bg-bg overflow-hidden">
                {positions.length === 0 ? (
                  <p className="text-center text-sm text-gray-600 py-8">No positions</p>
                ) : (
                  <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
                    {positions.map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors">
                        <div className="flex items-center gap-3">
                          <span className={`font-mono text-xs font-bold ${p.is_up ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {p.is_up ? '↑ UP' : '↓ DN'}
                          </span>
                          <span className="text-xs text-white">{p.underlying_asset} ${(p.strike / FLOAT_SCALING).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-6">
                          <span className="font-mono text-xs text-gray-400">
                            {(p.minted_quantity / DUSDC_MULTIPLIER).toFixed(2)} DUSDC
                          </span>
                          <span className={`font-mono text-xs font-semibold ${p.realized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {p.realized_pnl >= 0 ? '+' : ''}{(p.realized_pnl / DUSDC_MULTIPLIER).toFixed(2)}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                            p.status === 'settled'
                              ? 'bg-white/5 border-white/10 text-gray-400'
                              : 'bg-vermilion/10 border-vermilion/20 text-vermilion'
                          }`}>
                            {p.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
