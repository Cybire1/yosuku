'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import { withdrawFromManagerTx } from '@/lib/sui/predictClient';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import SectionHeader from '@/components/SectionHeader';
import PortfolioTable from '@/components/PortfolioTable';
import TokenBalance from '@/components/TokenBalance';
import { useManager, useDUSDCBalance, useManagerBalance, usePositions, useManagerSummary, useManagerPnL, usePLPBalance } from '@/lib/sui/hooks';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { fetchReputation, type ReputationData } from '@/lib/predictionContract';
import { drawEquityCurve } from '@/lib/charts/canvasChart';
import Tooltip from '@/components/Tooltip';
import { Download } from 'lucide-react';
import { fetchManagerPositionsSummary } from '@/lib/sui/predictApi';
import { positionsToCSV, downloadCSV } from '@/lib/csvExport';
import { computeBadges } from '@/lib/badges';
import BadgeDisplay from '@/components/BadgeDisplay';

export default function PortfolioPage() {
  const router = useRouter();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [mounted, setMounted] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const equityRef = useRef<HTMLCanvasElement>(null);

  const { manager, loading: managerLoading } = useManager();
  const { balance: walletBalance } = useDUSDCBalance();
  const { balance: managerBalance, refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);
  const { submit } = useSmartSubmit();
  const [withdrawing, setWithdrawing] = useState(false);

  const handleWithdraw = async () => {
    if (!manager || !address || managerBalance <= 0) return;
    setWithdrawing(true);
    try {
      await submit(() => withdrawFromManagerTx(manager.manager_id, BigInt(managerBalance), address));
      refreshManagerBalance();
    } catch (err) {
      console.error('Withdraw error:', err);
    } finally {
      setWithdrawing(false);
    }
  };
  const { positions, loading: positionsLoading } = usePositions(manager?.manager_id ?? null);

  // API-driven manager summary and P&L
  const { summary: managerSummary } = useManagerSummary(manager?.manager_id ?? null);
  const { pnlData } = useManagerPnL(manager?.manager_id ?? null);
  const { balance: plpBalance } = usePLPBalance();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (address) {
      fetchReputation(address).then(setReputation).catch(() => {});
    } else {
      setReputation(null);
    }
  }, [address]);

  // Use API-driven unrealized P&L, fallback to 0
  const totalUnrealizedPnL = managerSummary?.unrealized_pnl ?? 0;
  const realizedPnL = managerSummary?.realized_pnl ?? 0;
  const accountValue = managerSummary?.account_value ?? 0;

  // Draw equity curve from API P&L time series
  useEffect(() => {
    if (!equityRef.current || !address) return;

    if (pnlData && pnlData.points.length > 0) {
      // Build equity curve from API time series
      const curveData = pnlData.points.map(p => p.cumulative_realized_pnl);
      // Append current unrealized P&L
      curveData.push(curveData[curveData.length - 1] + pnlData.current_unrealized_pnl);
      drawEquityCurve(equityRef.current!, curveData);
    } else {
      // Fallback: flat line at current total
      const total = (walletBalance + managerBalance) / DUSDC_MULTIPLIER;
      drawEquityCurve(equityRef.current!, [total, total]);
    }
  }, [walletBalance, managerBalance, address, pnlData]);

  const totalPositions = positions.length;

  // Badges from position summaries
  const [positionSummaries, setPositionSummaries] = useState<import('@/lib/sui/predictApi').ManagerPositionSummary[]>([]);
  useEffect(() => {
    if (!manager?.manager_id) return;
    let cancelled = false;
    fetchManagerPositionsSummary(manager.manager_id).then(ps => {
      if (!cancelled) setPositionSummaries(ps);
    });
    return () => { cancelled = true; };
  }, [manager?.manager_id]);

  const badges = computeBadges(positionSummaries, plpBalance);

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        {/* Breadcrumb */}
        <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-gray-500 mb-7 flex items-center gap-3">
          <a href="/" className="hover:text-white transition-colors">Yosuku</a>
          <span className="text-gray-700">/</span>
          <span className="text-white">Portfolio</span>
        </div>

        <h1 className="font-display font-[800] text-4xl text-white tracking-tight mb-2">
          Portfolio
        </h1>
        <p className="font-jp text-gray-500 text-sm mb-10">ポートフォリオ</p>

        {!mounted ? (
          <div className="text-center py-20">
            <div className="w-6 h-6 border border-gray-600 border-t-white rounded-full animate-spin mx-auto" />
          </div>
        ) : !address ? (
          <div className="border border-white/[0.08] rounded bg-bg p-16 text-center">
            <div className="w-16 h-16 mx-auto mb-6 border border-white/10 rounded-full flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-500">
                <rect x="2" y="6" width="20" height="14" rx="2" />
                <path d="M22 10H2" />
              </svg>
            </div>
            <h2 className="font-display font-[700] text-xl text-white mb-2">Connect Wallet</h2>
            <p className="text-gray-500 text-sm max-w-sm mx-auto mb-6">
              Connect your Sui wallet to view positions, balances, and trade history.
            </p>
            <div className="flex flex-col items-center gap-3">
              <ConnectButton />
              <a href="/how-it-works" className="text-[11px] text-gray-600 hover:text-white transition-colors">New to Sui? Any wallet works — test funds are free →</a>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Ledger Plate — stats overview */}
            <div className="ledger-plate">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                  <span className="font-mono text-[9px] tracking-[0.16em] uppercase" style={{ color: '#6B6353' }}>
                    Account Overview
                  </span>
                  <div className="font-mono text-3xl font-semibold mt-1" style={{ color: '#1A1612' }}>
                    {managerSummary
                      ? (managerSummary.account_value / DUSDC_MULTIPLIER).toFixed(2)
                      : ((walletBalance + managerBalance) / DUSDC_MULTIPLIER).toFixed(2)
                    }
                    <span className="text-sm ml-2" style={{ color: '#6B6353' }}>DUSDC</span>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <span className="font-mono text-[9px] tracking-[0.16em] uppercase" style={{ color: '#6B6353' }}>
                      {reputation?.tier || 'Novice'}
                    </span>
                    <div className="font-mono text-sm mt-1" style={{ color: '#1A1612' }}>
                      {reputation ? `${reputation.bets} bets` : '0 bets'}
                    </div>
                  </div>
                  {managerBalance > 0 && (
                    <button
                      onClick={handleWithdraw}
                      disabled={withdrawing}
                      className="rounded-xl bg-black text-white font-bold text-sm px-5 py-3 hover:bg-black/85 transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap shadow-[0_2px_12px_rgba(0,0,0,0.15)]"
                    >
                      {withdrawing
                        ? 'Withdrawing…'
                        : <>Withdraw {(managerBalance / DUSDC_MULTIPLIER).toFixed(2)} to wallet <span className="text-base leading-none">↑</span></>}
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 gap-y-5 pt-4" style={{ borderTop: '1px solid rgba(201,191,166,0.3)' }}>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Wallet</span>
                  <div className="font-mono text-sm" style={{ color: '#1A1612' }}>{(walletBalance / DUSDC_MULTIPLIER).toFixed(2)}</div>
                </div>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Trading</span>
                  <div className="font-mono text-sm" style={{ color: '#1A1612' }}>
                    {(managerBalance / DUSDC_MULTIPLIER).toFixed(2)}
                  </div>
                </div>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Positions</span>
                  <div className="font-mono text-sm" style={{ color: '#1A1612' }}>
                    {managerSummary?.open_positions ?? totalPositions}
                  </div>
                </div>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase inline-flex items-center gap-1" style={{ color: '#6B6353' }}>Realized P&L <Tooltip text="Profit or loss from settled positions." position="bottom" /></span>
                  <div className="font-mono text-sm" style={{ color: realizedPnL >= 0 ? '#34D399' : '#F43F5E' }}>
                    {realizedPnL >= 0 ? '+' : ''}{(realizedPnL / DUSDC_MULTIPLIER).toFixed(2)}
                  </div>
                </div>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase inline-flex items-center gap-1" style={{ color: '#6B6353' }}>Unrealized P&L <Tooltip text="Estimated P&L on open positions based on current prices." position="bottom" /></span>
                  <div className="font-mono text-sm" style={{ color: totalUnrealizedPnL >= 0 ? '#34D399' : '#F43F5E' }}>
                    {totalUnrealizedPnL >= 0 ? '+' : ''}{(totalUnrealizedPnL / DUSDC_MULTIPLIER).toFixed(2)}
                  </div>
                </div>
                <div>
                  <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Address</span>
                  <div className="font-mono text-sm" style={{ color: '#1A1612' }}>{address.slice(0, 8)}…</div>
                </div>
              </div>
            </div>

            {/* Equity Curve */}
            <section>
              <SectionHeader number="01" title="Equity Curve" jp="損益曲線" />
              <div className="border border-white/[0.08] rounded bg-bg p-4">
                <canvas ref={equityRef} className="w-full h-[200px]" />
              </div>
            </section>

            {/* Manager info */}
            {manager && (
              <div className="border border-white/[0.06] rounded px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600">Trading account</span>
                  <p className="text-xs font-mono text-gray-400 mt-0.5 truncate max-w-[300px]">{manager.manager_id}</p>
                </div>
                <a
                  href={`https://suiscan.xyz/testnet/object/${manager.manager_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[10px] text-vermilion/60 hover:text-vermilion transition-colors"
                  data-cursor="hover"
                >
                  Suiscan ↗
                </a>
              </div>
            )}

            {!manager && !managerLoading && (
              <div className="border border-white/[0.06] rounded p-4 text-center">
                <p className="text-sm text-gray-400 mb-1">No trading account yet</p>
                <p className="text-xs text-gray-600 font-mono">Set up automatically on your first bet</p>
              </div>
            )}

            {/* Positions */}
            <section>
              <div className="flex items-center justify-between">
                <SectionHeader number="02" title="Your Positions" jp="ポジション" count={totalPositions} />
                {manager?.manager_id && (
                  <button
                    onClick={async () => {
                      const positions = await fetchManagerPositionsSummary(manager.manager_id);
                      if (positions.length === 0) return;
                      const csv = positionsToCSV(positions);
                      downloadCSV(csv, `yosuku-positions-${new Date().toISOString().slice(0, 10)}.csv`);
                    }}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.03] text-gray-400 hover:text-white hover:border-white/20 transition-all text-xs font-medium"
                  >
                    <Download style={{ width: 12, height: 12 }} />
                    Export CSV
                  </button>
                )}
              </div>
              <div className="border border-white/[0.08] rounded bg-bg p-5">
                <PortfolioTable />
              </div>
            </section>

            {/* Badges */}
            {address && (
              <section>
                <SectionHeader number="03" title="Achievements" jp="実績" />
                <div>
                  <BadgeDisplay badges={badges} />
                </div>
              </section>
            )}

            {/* CTA */}
            {totalPositions === 0 && (
              <div className="text-center py-6">
                <button
                  onClick={() => router.push('/markets')}
                  className="btn btn-primary"
                  data-cursor="hover"
                >
                  Go to Markets →
                </button>
              </div>
            )}
          </div>
        )}

        <Footer />
      </main>
    </div>
  );
}
