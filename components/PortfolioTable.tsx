'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Clock,
  Loader2,
} from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { useManager, usePositions, useManagerBalance, getPositionDirection, getPositionStrike, useSviPricing, useVaultStats, useTradingVaultBalance } from '@/lib/sui/hooks';
import { useOracles, useOraclePrices } from '@/lib/sui/hooks';
import { redeemPositionTx, redeemRangePositionTx, redeemPermissionlessTx, redeemAllPermissionlessToTradingBalanceTx, type ClaimablePosition } from '@/lib/sui/predictClient';
import { sweepManagerToTradingBalanceTx, withdrawTradingBalanceTx } from '@/lib/sui/tradingVaultClient';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { computeSviPrice, computeRangePrice, computeFeeBreakdown } from '@/lib/sui/sviPricing';
import { computePositionPnL } from '@/lib/sui/pnlCalculator';
import Countdown from './Countdown';

export default function PortfolioTable() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { manager, loading: managerLoading } = useManager();
  const { positions, loading: positionsLoading, refresh: refreshPositions } = usePositions(manager?.manager_id ?? null);
  const { balance: managerBalance, refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);
  const { balance: tradingVaultBalance, refresh: refreshTradingVaultBalance } = useTradingVaultBalance();
  const { oracles } = useOracles();
  const { stats: vaultStats } = useVaultStats();
  const [redeemingKey, setRedeemingKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [partialQty, setPartialQty] = useState<Record<string, string>>({});
  const [claimingAll, setClaimingAll] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [tab, setTab] = useState<'open' | 'settled'>('open');

  // Winnings land in the trading account (the keeper auto-redeems winners);
  // this is how the user actually collects them to their wallet.
  const handleWithdraw = async () => {
    if (!address || tradingVaultBalance.available <= 0) return;
    setWithdrawing(true);
    try {
      await submit(() => withdrawTradingBalanceTx({
        amount: BigInt(tradingVaultBalance.available),
        owner: address,
      }));
      refreshTradingVaultBalance();
    } catch (err) {
      console.error('Withdraw error:', err);
    } finally {
      setWithdrawing(false);
    }
  };

  const handleSweepLegacy = async () => {
    if (!manager || !address || managerBalance <= 0) return;
    setWithdrawing(true);
    try {
      await submit(() => sweepManagerToTradingBalanceTx({
        managerId: manager.manager_id,
        amount: BigInt(managerBalance),
        owner: address,
      }));
      refreshManagerBalance();
      refreshTradingVaultBalance();
    } catch (err) {
      console.error('Legacy sweep error:', err);
    } finally {
      setWithdrawing(false);
    }
  };

  // Get unique oracle IDs from positions for SVI data
  const uniqueOracleIds = useMemo(() => {
    const ids = new Set(positions.map(p => p.oracle_id));
    return Array.from(ids);
  }, [positions]);

  // Fetch SVI for the first oracle (most common case)
  const primaryOracleId = uniqueOracleIds[0] ?? null;
  const { sviData } = useSviPricing(primaryOracleId);
  const { prices } = useOraclePrices(primaryOracleId);

  // Settled binary winners still open → claimable via the gas-negative crank.
  const claimableWinners = useMemo<ClaimablePosition[]>(() => {
    if (!manager) return [];
    const out: ClaimablePosition[] = [];
    for (const pos of positions) {
      const oracle = oracles.find(o => o.oracle_id === pos.oracle_id);
      if (!oracle || oracle.status !== 'settled' || oracle.settlement_price == null) continue;
      const direction = getPositionDirection(pos.lower_strike, pos.higher_strike);
      if (direction === 'RANGE') continue; // range has no permissionless redeem
      const strike = Number(getPositionStrike(pos.lower_strike, pos.higher_strike));
      const won = direction === 'UP' ? oracle.settlement_price > strike : oracle.settlement_price <= strike;
      if (!won) continue;
      out.push({
        managerId: manager.manager_id,
        oracleId: pos.oracle_id,
        expiry: BigInt(pos.expiry),
        strike: BigInt(getPositionStrike(pos.lower_strike, pos.higher_strike)),
        direction,
        quantity: BigInt(pos.quantity),
      });
    }
    return out;
  }, [positions, oracles, manager]);

  // Split positions into OPEN (live, still running) vs SETTLED (history), and sort
  // each — this is the whole fix: a flat unsorted list made it impossible to tell a
  // live bet from a finished one. Open = soonest bell first (most urgent on top);
  // Settled = most recent first. A position whose oracle isn't in the loaded set is
  // older than the recent-settled window → it's history.
  const { openPositions, settledPositions } = useMemo(() => {
    const open: typeof positions = [];
    const settled: typeof positions = [];
    for (const pos of positions) {
      const oracle = oracles.find(o => o.oracle_id === pos.oracle_id);
      // Live OR bell-rang-but-not-yet-settled → still "open" (unresolved). Only a
      // truly settled round (or an oracle too old to be in the loaded set) is history.
      if (oracle && oracle.status !== 'settled') open.push(pos);
      else settled.push(pos);
    }
    open.sort((a, b) => Number(a.expiry) - Number(b.expiry));      // soonest bell first
    settled.sort((a, b) => Number(b.expiry) - Number(a.expiry));   // most recent first
    return { openPositions: open, settledPositions: settled };
  }, [positions, oracles]);

  const handleClaimAll = async () => {
    if (!address || claimableWinners.length === 0) return;
    setClaimingAll(true);
    try {
      await submit(() => redeemAllPermissionlessToTradingBalanceTx(claimableWinners, address));
    } catch (err) {
      // abort 1 = already redeemed by the keeper — winnings are already in the
      // trading balance. Not an error; just refresh.
      if (!/abort code: 1|decrease_position|already/i.test(String(err))) {
        console.error('Claim all error:', err);
      }
    } finally {
      refreshPositions();
      refreshManagerBalance();
      refreshTradingVaultBalance();
      setClaimingAll(false);
    }
  };

  if (!address) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500">Connect wallet to see positions</p>
      </div>
    );
  }

  // Wait for the MANAGER to resolve too, not just the positions fetch. usePositions
  // sets loading=false immediately when managerId is still null (manager mid-load),
  // which used to flash the "No positions" empty state before the real data arrived
  // — the "shows then removes" flicker.
  if (managerLoading || positionsLoading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="w-6 h-6 text-gray-600 mx-auto animate-spin" />
        <p className="text-xs text-gray-600 mt-2">Loading positions...</p>
      </div>
    );
  }

  const handleRedeem = async (pos: typeof positions[0], quantity?: bigint, settled = false) => {
    if (!manager) return;
    const direction = getPositionDirection(pos.lower_strike, pos.higher_strike);
    const key = `${pos.oracle_id}-${pos.lower_strike}-${pos.higher_strike}`;
    setRedeemingKey(key);

    try {
      const redeemQty = quantity ?? BigInt(pos.quantity);

      if (direction === 'RANGE') {
        await submit(() => redeemRangePositionTx(
          manager.manager_id,
          pos.oracle_id,
          BigInt(pos.expiry),
          BigInt(pos.lower_strike),
          BigInt(pos.higher_strike),
          redeemQty,
        ));
      } else {
        const strike = BigInt(getPositionStrike(pos.lower_strike, pos.higher_strike));
        // Settled → gas-negative permissionless redeem; live → owner redeem (early close).
        await submit(() => settled
          ? redeemPermissionlessTx({
              managerId: manager.manager_id,
              oracleId: pos.oracle_id,
              expiry: BigInt(pos.expiry),
              strike,
              direction,
              quantity: redeemQty,
            })
          : redeemPositionTx(
              manager.manager_id,
              pos.oracle_id,
              BigInt(pos.expiry),
              strike,
              direction,
              redeemQty,
            ));
      }
      setExpandedKey(null);
    } catch (err) {
      // abort 1 = already redeemed by the keeper — the payout is already in the
      // trading balance. Treat as done, just refresh.
      if (!/abort code: 1|decrease_position|already/i.test(String(err))) {
        console.error('Redeem error:', err);
      }
    } finally {
      refreshPositions();
      refreshManagerBalance();
      setRedeemingKey(null);
    }
  };

  if (positions.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-400 mb-1">No open positions right now</p>
        <p className="text-xs text-gray-600 max-w-xs mx-auto leading-relaxed">Place a bet and it shows here live. When a round settles, winnings are auto-claimed to your trading balance above.</p>
      </div>
    );
  }

  // One row renderer, used for both Open and Settled lists so the card anatomy stays
  // identical and only the sorting/grouping differs.
  const renderRow = (pos: typeof positions[0], idx: number) => {
    const direction = getPositionDirection(pos.lower_strike, pos.higher_strike);
    const strike = getPositionStrike(pos.lower_strike, pos.higher_strike);
    const strikeDollars = strike / FLOAT_SCALING;
    const quantity = Number(pos.quantity) / DUSDC_MULTIPLIER;
    // include the row index so two positions in the same market (same oracle+strikes)
    // can't collide on key — the per-row key stays stable for the expand toggle.
    const key = `${pos.oracle_id}-${pos.lower_strike}-${pos.higher_strike}-${idx}`;

    // Find matching oracle for status
    const oracle = oracles.find(o => o.oracle_id === pos.oracle_id);
    const nowMs = Date.now();
    const isSettled = oracle?.status === 'settled';
    const isLive = oracle?.status === 'active' && oracle.expiry > nowMs;       // running, can sell
    const isPending = !!oracle && oracle.status !== 'settled' && oracle.expiry <= nowMs; // bell rang, awaiting oracle
    const isActive = isLive; // "active" = live/sellable; keeps the P&L + sell logic below intact

    // Determine if won (for settled)
    let isWinner = false;
    if (isSettled && oracle?.settlement_price !== null && oracle?.settlement_price !== undefined) {
      const settlement = oracle.settlement_price;
      if (direction === 'UP') {
        isWinner = settlement > strike;
      } else if (direction === 'DOWN') {
        isWinner = settlement <= strike;
      } else if (direction === 'RANGE') {
        isWinner = settlement > Number(pos.lower_strike) && settlement <= Number(pos.higher_strike);
      }
    }

    // Compute unrealized P&L for active positions
    let pnlData = null;
    if (isActive && sviData?.params && prices?.forward && pos.oracle_id === primaryOracleId) {
      pnlData = computePositionPnL(pos, sviData.params, prices.forward);
    }

    // Compute current fair price
    let currentFairPrice: number | null = null;
    if (isActive && sviData?.params && prices?.forward && pos.oracle_id === primaryOracleId) {
      if (direction === 'RANGE') {
        currentFairPrice = computeRangePrice(sviData.params, Number(pos.lower_strike), Number(pos.higher_strike), prices.forward);
      } else {
        const p = computeSviPrice(sviData.params, strike, prices.forward);
        currentFairPrice = direction === 'DOWN' ? 1 - p : p;
      }
    }

    // Button label based on context
    const buttonLabel = isActive ? 'Sell' : isSettled && isWinner ? 'Claim' : 'Close';
    const isExpanded = expandedKey === key;

    // Range display
    const isRange = direction === 'RANGE';
    const upperStrikeDollars = isRange ? Number(pos.higher_strike) / FLOAT_SCALING : 0;

    return (
      <motion.div
        key={key}
        layout
        className={`rounded-xl border p-4 transition-colors ${
          isSettled
            ? isWinner
              ? 'bg-emerald-500/5 border-emerald-500/20'
              : 'bg-rose-500/5 border-rose-500/10'
            : 'bg-white/[0.02] border-white/[0.08] hover:bg-white/[0.04]'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              direction === 'UP' ? 'bg-emerald-500/10' :
              direction === 'DOWN' ? 'bg-rose-500/10' :
              'bg-amber-500/10'
            }`}>
              {direction === 'UP' ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : direction === 'DOWN' ? (
                <TrendingDown className="w-4 h-4 text-rose-400" />
              ) : (
                <Activity className="w-4 h-4 text-amber-400" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${
                  direction === 'UP' ? 'text-emerald-400' :
                  direction === 'DOWN' ? 'text-rose-400' :
                  'text-amber-400'
                }`}>
                  {direction === 'UP' ? 'UP' : direction === 'DOWN' ? 'DOWN' : 'RANGE'}
                </span>
                <span className="text-sm text-gray-400">
                  {isRange
                    ? `$${strikeDollars.toLocaleString()} — $${upperStrikeDollars.toLocaleString()}`
                    : `@ $${strikeDollars.toLocaleString()}`
                  }
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">
                  {oracle?.underlying_asset || 'BTC/USD'}
                </span>
                {isActive && oracle && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/90">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    <Countdown expiryMs={oracle.expiry} className="text-[10px]" />
                  </span>
                )}
                {isPending && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" /> Awaiting oracle
                  </span>
                )}
                {isSettled && (
                  <span className={`text-[10px] font-bold ${isWinner ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isWinner ? 'Won' : 'Lost'}
                  </span>
                )}
                {/* Fair price on active positions */}
                {isActive && currentFairPrice !== null && (
                  <span className="text-[10px] font-mono text-gray-400">
                    ~{(currentFairPrice * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-sm font-mono font-bold text-white block">
                {quantity.toFixed(2)}
              </span>
              <span className="text-[10px] text-gray-500">DUSDC</span>
              {/* P&L display */}
              {pnlData && (
                <span className={`text-[10px] font-mono block ${pnlData.unrealizedPnLPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {pnlData.unrealizedPnLPct >= 0 ? '+' : ''}{pnlData.unrealizedPnLPct.toFixed(1)}%
                </span>
              )}
            </div>

            {/* No redeem for settled losers: nothing to claim and
                redeem_permissionless aborts on losing positions. */}
            {((isSettled && isWinner) || isActive) && (
              <button
                onClick={() => {
                  if (isActive && !isExpanded) {
                    setExpandedKey(key);
                  } else {
                    handleRedeem(pos, undefined, isSettled);
                  }
                }}
                disabled={redeemingKey === key}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                  isSettled && isWinner
                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                    : isActive
                      ? 'bg-white/5 hover:bg-white/10 border border-white/10 text-white'
                      : 'bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400'
                } disabled:opacity-50`}
              >
                {redeemingKey === key ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  buttonLabel
                )}
              </button>
            )}
          </div>
        </div>

        {/* Expanded: partial quantity sell */}
        <AnimatePresence>
          {isExpanded && isActive && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
                <input
                  type="number"
                  value={partialQty[key] || ''}
                  onChange={(e) => setPartialQty(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder="Qty"
                  min="0"
                  className="flex-1 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08] text-white font-mono text-sm outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={() => setPartialQty(prev => ({ ...prev, [key]: quantity.toString() }))}
                  className="px-2 py-2 rounded-lg border border-white/10 text-[10px] font-bold text-gray-400 hover:text-white transition-colors"
                >
                  MAX
                </button>
                <button
                  onClick={() => {
                    const qty = parseFloat(partialQty[key] || '0');
                    if (qty > 0) {
                      handleRedeem(pos, BigInt(Math.floor(qty * DUSDC_MULTIPLIER)));
                    }
                  }}
                  disabled={redeemingKey === key || !partialQty[key] || parseFloat(partialQty[key]) <= 0}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-sm font-bold text-white transition-all disabled:opacity-40"
                >
                  Sell
                </button>
                <button
                  onClick={() => setExpandedKey(null)}
                  className="px-2 py-2 text-[10px] text-gray-500 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
              {/* Fee estimate for live sell */}
              {currentFairPrice !== null && vaultStats && (
                <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-500">
                  <span>Est. fair value: <span className="font-mono text-gray-400">{(currentFairPrice * 100).toFixed(2)}%</span></span>
                  <span className="text-gray-700">|</span>
                  <span className="text-gray-600 italic">On-chain price is authoritative</span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  };

  const activeList = tab === 'open' ? openPositions : settledPositions;
  // Each settled binary winner pays ≈1 DUSDC/share → quantity is the payout.
  const claimableTotal = claimableWinners.reduce((s, w) => s + Number(w.quantity), 0) / DUSDC_MULTIPLIER;

  return (
    <div className="space-y-4">
      {/* Trading balance + withdraw — winnings land here (keeper auto-redeems);
          this is how the user collects to their wallet. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.015] px-4 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-0.5">
            Available Trading Balance
          </div>
          <div className="text-lg font-mono font-bold text-white tabular-nums">
            {(tradingVaultBalance.available / DUSDC_MULTIPLIER).toFixed(2)} <span className="text-xs text-gray-500">DUSDC</span>
          </div>
          <p className="text-[10px] text-gray-600 mt-1 max-w-sm">
            New TradingVault balance. Public bets debit this first; withdraw to wallet anytime.
            {managerBalance > 0 ? ` Legacy manager has ${(managerBalance / DUSDC_MULTIPLIER).toFixed(2)} DUSDC.` : ''}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {managerBalance > 0 && (
            <button
              onClick={handleSweepLegacy}
              disabled={withdrawing}
              className="px-4 py-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 text-white text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {withdrawing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Moving…</> : 'Move legacy'}
            </button>
          )}
          <button
            onClick={handleWithdraw}
            disabled={withdrawing || tradingVaultBalance.available <= 0}
            className="px-4 py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 hover:border-white/20 text-white text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {withdrawing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Withdrawing…</> : 'Withdraw to wallet'}
          </button>
        </div>
      </div>

      {/* Claim all settled winners — one gas-negative PTB. Pinned above the tabs so
          unclaimed money is never hidden behind a tab. */}
      {claimableWinners.length > 0 && (
        <button
          onClick={handleClaimAll}
          disabled={claimingAll}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/30 transition-all disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-sm font-bold text-emerald-400">
            {claimingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : '🏆'}
            Claim {claimableWinners.length} winner{claimableWinners.length === 1 ? '' : 's'} · +{claimableTotal.toFixed(2)} DUSDC
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/70">
            ⚡ gas-negative
          </span>
        </button>
      )}

      {/* Open / Settled segmented tabs — the core findability fix. Default is Open
          (your live bets) so a freshly-placed bet is the first thing you see. */}
      <div className="flex items-center gap-1 p-1 rounded-xl border border-white/[0.06] bg-white/[0.02] w-fit">
        {([
          ['open', 'Open', openPositions.length],
          ['settled', 'Settled', settledPositions.length],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            onClick={() => { setTab(id); setExpandedKey(null); }}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
              tab === id
                ? 'bg-white/[0.08] text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
              tab === id ? 'bg-white/10 text-gray-300' : 'bg-white/[0.04] text-gray-600'
            }`}>{count}</span>
          </button>
        ))}
      </div>

      {/* Active tab list */}
      <div className="space-y-2">
        {activeList.length > 0 ? (
          activeList.map((pos, idx) => renderRow(pos, idx))
        ) : tab === 'open' ? (
          <div className="text-center py-10">
            <Clock className="w-7 h-7 text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-400 mb-1">No open bets right now</p>
            <p className="text-xs text-gray-600 max-w-xs mx-auto leading-relaxed">
              Place a bet and it lands here live with a countdown to the bell.
              {settledPositions.length > 0 && <> Your finished bets are under <button onClick={() => setTab('settled')} className="text-gray-400 hover:text-white underline underline-offset-2">Settled ({settledPositions.length})</button>.</>}
            </p>
          </div>
        ) : (
          <div className="text-center py-10">
            <p className="text-sm text-gray-400 mb-1">No settled bets yet</p>
            <p className="text-xs text-gray-600">Finished bets — won or lost — will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
