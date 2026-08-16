'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import {
  depositTradingBalanceTx,
  sweepManagerToTradingBalanceTx,
  withdrawPrivateTradingBalanceTx,
  withdrawTradingBalanceTx,
} from '@/lib/sui/tradingVaultClient';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Portfolio624Section from '@/components/Portfolio624Section';
import XWalletCard from '@/components/XWalletCard';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import SectionHeader from '@/components/SectionHeader';
import PortfolioTable from '@/components/PortfolioTable';
import CreatorEarningsCard from '@/components/CreatorEarningsCard';
import BetHistory729 from '@/components/BetHistory729';
import { useManager, useDUSDCBalance, useManagerBalance, usePositions, useManagerSummary, useManagerPnL, usePLPBalance, useTradingVaultBalance } from '@/lib/sui/hooks';
import { DUSDC_MULTIPLIER, FLOAT_SCALING } from '@/lib/sui/constants';
import { useLeverageHealth, useMyOrders, useMyPositions } from '@/lib/sui/leverageHooks';
import { cancelOrderTx, type LeverageHealth, type OrderData, type PositionData as LeveragePositionData } from '@/lib/sui/leverageClient';
import { fetchReputation, type ReputationData } from '@/lib/predictionContract';
import { drawEquityCurve } from '@/lib/charts/canvasChart';
import Tooltip from '@/components/Tooltip';
import { Download } from 'lucide-react';
import { fetchManagerPositionsSummary } from '@/lib/sui/predictApi';
import { positionsToCSV, downloadCSV } from '@/lib/csvExport';
import { computeBadges } from '@/lib/badges';
import BadgeDisplay from '@/components/BadgeDisplay';
import { loadPrivateBetTickets, privateBalanceDusdc, type PrivateBetTicket } from '@/lib/privateBet';
import PrivateClaims from '@/components/PrivateClaims';
import { computeTradingAccountSnapshot } from '@/lib/tradingAccount';

export default function PortfolioPage() {
  const router = useRouter();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [mounted, setMounted] = useState(false);
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [privateTickets, setPrivateTickets] = useState<PrivateBetTicket[]>([]);
  const equityRef = useRef<HTMLCanvasElement>(null);

  const { manager, loading: managerLoading } = useManager();
  const { balance: walletBalance, coins: walletCoins, refresh: refreshWalletBalance } = useDUSDCBalance();
  const { balance: managerBalance, refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);
  const { balance: tradingVaultBalance, loading: tradingVaultLoading, refresh: refreshTradingVaultBalance, configured: tradingVaultConfigured } = useTradingVaultBalance();
  const { submit } = useSmartSubmit();
  const [sweepingManager, setSweepingManager] = useState(false);
  const [vaultAmount, setVaultAmount] = useState('1');
  const [vaultBusy, setVaultBusy] = useState<'deposit' | 'withdraw' | 'withdraw-private' | null>(null);

  const handleSweepManagerBalance = async () => {
    if (!manager || !address || managerBalance <= 0) return;
    setSweepingManager(true);
    try {
      await submit(() => sweepManagerToTradingBalanceTx({
        managerId: manager.manager_id,
        amount: BigInt(managerBalance),
        owner: address,
      }));
      refreshBalances();
    } catch (err) {
      console.error('Manager sweep error:', err);
    } finally {
      setSweepingManager(false);
    }
  };

  const parsedVaultAmount = Math.max(0, Math.floor((Number(vaultAmount) || 0) * DUSDC_MULTIPLIER));
  const vaultAmountMicro = BigInt(parsedVaultAmount);

  const refreshBalances = () => {
    refreshWalletBalance();
    refreshManagerBalance();
    refreshTradingVaultBalance();
  };

  const handleVaultDeposit = async () => {
    if (!address || vaultAmountMicro <= BigInt(0) || walletCoins.length === 0) return;
    setVaultBusy('deposit');
    try {
      await submit(() => depositTradingBalanceTx({
        coinIds: walletCoins.map((coin) => coin.coinObjectId),
        amount: vaultAmountMicro,
      }));
      refreshBalances();
    } catch (err) {
      console.error('TradingVault deposit error:', err);
    } finally {
      setVaultBusy(null);
    }
  };

  const handleVaultWithdraw = async () => {
    if (!address || tradingVaultBalance.available <= 0) return;
    setVaultBusy('withdraw');
    try {
      await submit(() => withdrawTradingBalanceTx({
        amount: BigInt(tradingVaultBalance.available),
        owner: address,
      }));
      refreshBalances();
    } catch (err) {
      console.error('TradingVault withdraw error:', err);
    } finally {
      setVaultBusy(null);
    }
  };


  const handleVaultWithdrawPrivate = async () => {
    if (!address || tradingVaultBalance.privateAvailable <= 0) return;
    setVaultBusy('withdraw-private');
    try {
      await submit(() => withdrawPrivateTradingBalanceTx({
        amount: BigInt(tradingVaultBalance.privateAvailable),
        owner: address,
      }));
      refreshBalances();
    } catch (err) {
      console.error('TradingVault private withdraw error:', err);
    } finally {
      setVaultBusy(null);
    }
  };
  const { positions, loading: positionsLoading } = usePositions(manager?.manager_id ?? null);
  const { orders: leverageOrders, refresh: refreshLeverageOrders } = useMyOrders();
  const { positions: leveragePositions } = useMyPositions();
  const { healthByPosition } = useLeverageHealth(leveragePositions);
  const [leverageBusy, setLeverageBusy] = useState<string | null>(null);

  // API-driven manager summary and P&L
  const { summary: managerSummary } = useManagerSummary(manager?.manager_id ?? null);
  const { pnlData } = useManagerPnL(manager?.manager_id ?? null);
  const { balance: plpBalance } = usePLPBalance();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!address) {
      setPrivateTickets([]);
      return;
    }
    const refreshPrivateTickets = () => setPrivateTickets(loadPrivateBetTickets(address));
    refreshPrivateTickets();
    const id = window.setInterval(refreshPrivateTickets, 4_000);
    window.addEventListener('storage', refreshPrivateTickets);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('storage', refreshPrivateTickets);
    };
  }, [address]);

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
  const walletDusdc = walletBalance / DUSDC_MULTIPLIER;
  const vaultAvailableDusdc = tradingVaultBalance.available / DUSDC_MULTIPLIER;
  const vaultPrivateDusdc = tradingVaultBalance.privateAvailable / DUSDC_MULTIPLIER;
  const vaultAgentDusdc = tradingVaultBalance.agentAvailable / DUSDC_MULTIPLIER;
  const vaultLockedMarginDusdc = tradingVaultBalance.lockedMargin / DUSDC_MULTIPLIER;
  const tradingAvailableDusdc = (managerBalance + tradingVaultBalance.available) / DUSDC_MULTIPLIER;
  const managerAccountValueDusdc = managerSummary
    ? managerSummary.account_value / DUSDC_MULTIPLIER
    : managerBalance / DUSDC_MULTIPLIER;
  const tradingAccountValueDusdc = managerAccountValueDusdc + (tradingVaultBalance.accountValue / DUSDC_MULTIPLIER);
  const privateBalance = privateBalanceDusdc(privateTickets) + vaultPrivateDusdc;
  const leverageEscrowDusdc = leverageOrders.reduce((sum, order) => sum + order.margin, 0) + vaultLockedMarginDusdc;
  const leverageEquityDusdc = leveragePositions.reduce((sum, position) => {
    const health = healthByPosition[position.id];
    return sum + Math.max(0, health?.equity ?? position.margin);
  }, 0);
  const accountSnapshot = computeTradingAccountSnapshot({
    walletDusdc,
    tradingAvailableDusdc,
    tradingAccountValueDusdc,
    privateBalanceDusdc: privateBalance,
    leverageEscrowDusdc,
    leverageEquityDusdc,
    agentAllocationDusdc: vaultAgentDusdc,
  });

  const handleCancelLeverageOrder = async (order: OrderData) => {
    if (!address || order.source === 'local' || order.id.startsWith('local:')) return;
    setLeverageBusy(order.id);
    try {
      await submit(() => cancelOrderTx(order.id, address));
      setTimeout(() => {
        refreshLeverageOrders();
        refreshManagerBalance();
      }, 1200);
    } catch (err) {
      console.error('Leverage cancel error:', err);
    } finally {
      setLeverageBusy(null);
    }
  };

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
      const total = (walletBalance + managerBalance + tradingVaultBalance.accountValue) / DUSDC_MULTIPLIER;
      drawEquityCurve(equityRef.current!, [total, total]);
    }
  }, [walletBalance, managerBalance, tradingVaultBalance.accountValue, address, pnlData]);

  const totalPositions = positions.length + leverageOrders.length + leveragePositions.length;

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

  // Does this person have anything on the OLD deployment at all?
  //
  // Everything below the divider is pre-migration: a second balance, its own P&L columns, its own
  // deposit box. It used to render for everyone, so a brand new wallet was shown two balances and
  // a settlement history for a venue it had never touched. Nobody signing up today has money
  // there, and the split is an artefact of our migration, not something they chose. So it only
  // exists for the people who actually left something behind.
  const hasEarlierFunds =
    accountSnapshot.yosukuBalanceDusdc > 0.005 ||
    positions.length > 0 ||
    leverageOrders.length > 0 ||
    leveragePositions.length > 0 ||
    privateTickets.length > 0;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[92px] pb-10 sm:pt-[120px] sm:pb-32">
        {/* No "Portfolio" headline. The nav already says where you are, and the thing people open
            this page for is the number. The balance IS the header now, and Deposit sits beside it
            inside the account plate. */}

        {!mounted ? (
          <div className="text-center py-20">
            <div className="w-6 h-6 border border-gray-600 border-t-white rounded-full animate-spin mx-auto" />
          </div>
        ) : !address ? (
          <div className="space-y-4">
          <div className="w-full border border-white/[0.08] rounded bg-bg p-10 text-center">
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
              <a href="/how-it-works" className="text-[11px] text-gray-600 hover:text-white transition-colors">New to Sui? Any wallet works, test funds are free →</a>
            </div>
          </div>
          {/* Kept below the primary action, not above it: someone landing here from a tweet still
              needs to claim their X account, but connecting a wallet is what the page is FOR. */}
          <XWalletCard />
          </div>
        ) : (
          <div className="space-y-5 sm:space-y-8">
            {/* ── New venue (DeepBook Predict 6-24) — balance, open positions, settled history ── */}
            <Portfolio624Section />

            {/* Money-in sits under the positions. Leading with it meant a first-time visitor was
                asked to link X before they had connected anything. */}
            <XWalletCard />

            {/* Creator onboarding and earnings live beside the linked X identity they accrue
                from. The card handles both states: mint a code, then view and claim fees. */}
            <CreatorEarningsCard />

            {/* Only for people who actually have something on the old deployment. See
                hasEarlierFunds: for everyone else this whole section does not exist, so the
                product shows ONE balance. */}
            {/* The old-deployment section lived here: its own balance card, equity curve,
                private positions, leveraged trades, positions and achievements. Removed as
                dead weight. Anything still sitting on that deployment is untouched on-chain
                and reachable by its own contract; it just no longer has a surface here. */}

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

function formatStrikeValue(strike?: bigint) {
  if (!strike || strike <= BigInt(0)) return 'market';
  return `$${(Number(strike) / FLOAT_SCALING).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function LeveragePortfolioPanel({
  orders,
  positions,
  healthByPosition,
  busy,
  onCancel,
}: {
  orders: OrderData[];
  positions: LeveragePositionData[];
  healthByPosition: Record<string, LeverageHealth>;
  busy: string | null;
  onCancel: (order: OrderData) => void;
}) {
  return (
    <div className="border border-vermilion/20 rounded bg-vermilion/[0.035] p-5 space-y-4">
      {orders.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion">
              Margin set aside
            </span>
            <span className="font-mono text-[10px] text-gray-600">
              opening…
            </span>
          </div>
          {orders.map((order) => {
            const syncing = order.source === 'local' || order.id.startsWith('local:');
            const expired = order.expiry ? Number(order.expiry) < Date.now() : false;
            const stale = order.createdAt ? Date.now() - order.createdAt > 90_000 : false;
            return (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3">
                <div>
                  <div className="font-mono text-sm text-white">
                    <span className="text-vermilion font-bold">{order.leverage.toFixed(0)}x</span>
                    {' '}{order.isRange ? 'RANGE' : order.isUp ? 'UP' : 'DOWN'}
                    <span className="text-gray-500"> · {order.margin.toFixed(2)} DUSDC margin</span>
                  </div>
                  <div className="font-mono text-[10px] text-gray-600 mt-1">
                    {formatStrikeValue(order.lowerStrike)}
                    {order.isRange && order.higherStrike ? ` - ${formatStrikeValue(order.higherStrike)}` : ''}
                    {syncing && order.txDigest ? (
                      <>
                        {' '}· confirming{' '}
                        <a
                          href={`https://suiscan.xyz/testnet/tx/${order.txDigest}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-vermilion/70 hover:text-vermilion"
                        >
                          {order.txDigest.slice(0, 6)}...{order.txDigest.slice(-4)}
                        </a>
                      </>
                    ) : null}
                  </div>
                  <div className={`font-mono text-[10px] mt-1 ${expired ? 'text-rose-400' : stale ? 'text-amber-400' : 'text-gray-600'}`}>
                    {expired ? 'this round closed before your position opened — tap to refund' : stale ? 'taking a little longer than usual — your stake is safe' : 'opening your position…'}
                  </div>
                </div>
                {syncing ? (
                  <span className="font-mono text-[10px] text-gray-500 rounded-full border border-white/10 px-3 py-1.5">
                    confirming
                  </span>
                ) : (
                  <button
                    onClick={() => onCancel(order)}
                    disabled={busy === order.id}
                    className="font-mono text-[10px] uppercase tracking-[0.14em] rounded-full border border-vermilion/30 px-3 py-1.5 text-vermilion hover:bg-vermilion/10 disabled:opacity-50"
                  >
                    {busy === order.id ? 'Refunding...' : 'Cancel'}
                  </button>
                )}
              </div>
            );
          })}
          <p className="font-mono text-[10px] text-gray-600 leading-relaxed">
            Your stake is held safely while the position opens. Taking too long? Cancel anytime to get it straight back.
          </p>
        </div>
      )}

      {positions.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
              Your leverage positions
            </span>
            <span className="font-mono text-[10px] text-gray-600">
              open
            </span>
          </div>
          {positions.map((position) => {
            const health = healthByPosition[position.id];
            const pnl = health?.equity == null ? null : health.equity - position.margin;
            return (
              <div key={position.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm text-white">
                      <span className="text-vermilion font-bold">{position.leverage.toFixed(0)}x</span>
                      {' '}{position.isRange ? 'RANGE' : position.isUp ? 'UP' : 'DOWN'}
                      <span className="text-gray-500"> · {position.notional.toFixed(2)} DUSDC position size</span>
                    </div>
                    <div className="font-mono text-[10px] text-gray-600 mt-1">
                      {position.margin.toFixed(2)} DUSDC margin · {formatStrikeValue(position.lowerStrike)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <HealthBadge health={health} />
                    <a
                      href={`https://suiscan.xyz/testnet/object/${position.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.14em] rounded-full border border-white/10 px-3 py-1.5 text-gray-500 hover:text-white"
                    >
                      View details
                    </a>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <RiskStat label="Your value" value={health?.equity == null ? 'quoting' : `${health.equity.toFixed(2)} DUSDC`} tone="white" />
                  <RiskStat label="Cashout" value={health?.redeemValue == null ? 'quoting' : `${health.redeemValue.toFixed(2)} DUSDC`} tone="muted" />
                  <RiskStat
                    label="Live P&L"
                    value={pnl == null ? 'quoting' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} DUSDC`}
                    tone={pnl != null && pnl < 0 ? 'bad' : 'good'}
                  />
                  <RiskStat
                    label="Health"
                    value={health?.healthBps == null ? 'quoting' : `${(health.healthBps / 100).toFixed(0)}%`}
                    tone={health?.status === 'liquidatable' ? 'bad' : health?.status === 'watch' ? 'warn' : 'good'}
                  />
                </div>
                <details className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
                  <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.14em] text-gray-600">
                    How this works
                  </summary>
                  <p className="font-mono text-[10px] text-gray-600 mt-2 leading-relaxed">
                    Leverage adds {position.fronted.toFixed(2)} DUSDC on top of your stake. Health compares your live cash-out value to that extra amount plus a safety buffer; your position auto-closes if health reaches 100% so you can't lose more than your stake.
                  </p>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HealthBadge({ health }: { health?: LeverageHealth }) {
  const label = !health || health.status === 'unknown'
    ? 'QUOTING'
    : health.status === 'liquidatable'
      ? 'AT RISK'
      : health.status === 'watch'
        ? 'WATCH'
        : 'HEALTHY';
  const cls = !health || health.status === 'unknown'
    ? 'border-white/10 text-gray-500'
    : health.status === 'liquidatable'
      ? 'border-rose-500/30 text-rose-300 bg-rose-500/10'
      : health.status === 'watch'
        ? 'border-amber-400/30 text-amber-300 bg-amber-400/10'
        : 'border-emerald-400/30 text-emerald-300 bg-emerald-400/10';
  return (
    <span className={`font-mono text-[10px] uppercase tracking-[0.14em] rounded-full border px-3 py-1.5 ${cls}`}>
      {label}
    </span>
  );
}

function RiskStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'white' | 'muted' | 'good' | 'warn' | 'bad';
}) {
  const color = tone === 'good'
    ? 'text-emerald-300'
    : tone === 'warn'
      ? 'text-amber-300'
      : tone === 'bad'
        ? 'text-rose-300'
        : tone === 'white'
          ? 'text-white'
          : 'text-gray-500';
  return (
    <div className="rounded-lg border border-white/[0.05] bg-black/20 px-3 py-2">
      <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-gray-600">{label}</div>
      <div className={`font-mono text-xs mt-1 ${color}`}>{value}</div>
    </div>
  );
}
