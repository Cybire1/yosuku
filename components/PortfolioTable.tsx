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
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useManager, usePositions, useManagerBalance, getPositionDirection, getPositionStrike, useSviPricing, useVaultStats } from '@/lib/sui/hooks';
import { useOracles, useOraclePrices } from '@/lib/sui/hooks';
import { redeemPositionTx, redeemRangePositionTx, redeemPermissionlessTx, redeemAllPermissionlessTx, withdrawFromManagerTx, type ClaimablePosition } from '@/lib/sui/predictClient';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { computeSviPrice, computeRangePrice, computeFeeBreakdown } from '@/lib/sui/sviPricing';
import { computePositionPnL } from '@/lib/sui/pnlCalculator';
import Countdown from './Countdown';

export default function PortfolioTable() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { manager } = useManager();
  const { positions, loading: positionsLoading, refresh: refreshPositions } = usePositions(manager?.manager_id ?? null);
  const { balance: managerBalance, refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);
  const { oracles } = useOracles();
  const { stats: vaultStats } = useVaultStats();
  const [redeemingKey, setRedeemingKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [partialQty, setPartialQty] = useState<Record<string, string>>({});
  const [claimingAll, setClaimingAll] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  // Winnings land in the trading account (the keeper auto-redeems winners);
  // this is how the user actually collects them to their wallet.
  const handleWithdraw = async () => {
    if (!manager || !address || managerBalance <= 0) return;
    setWithdrawing(true);
    try {
      const tx = withdrawFromManagerTx(manager.manager_id, BigInt(managerBalance), address);
      const res = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest: res.digest });
      refreshManagerBalance();
    } catch (err) {
      console.error('Withdraw error:', err);
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
      const won = direction === 'UP' ? oracle.settlement_price >= strike : oracle.settlement_price < strike;
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

  const handleClaimAll = async () => {
    if (claimableWinners.length === 0) return;
    setClaimingAll(true);
    try {
      const tx = redeemAllPermissionlessTx(claimableWinners);
      const result = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest: result.digest });
    } catch (err) {
      // abort 1 = already redeemed by the keeper — winnings are already in the
      // trading balance. Not an error; just refresh.
      if (!/abort code: 1|decrease_position|already/i.test(String(err))) {
        console.error('Claim all error:', err);
      }
    } finally {
      refreshPositions();
      refreshManagerBalance();
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

  if (positionsLoading) {
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
        const tx = redeemRangePositionTx(
          manager.manager_id,
          pos.oracle_id,
          BigInt(pos.expiry),
          BigInt(pos.lower_strike),
          BigInt(pos.higher_strike),
          redeemQty,
        );
        const result = await signAndExecute({ transaction: tx });
        await client.waitForTransaction({ digest: result.digest });
      } else {
        const strike = BigInt(getPositionStrike(pos.lower_strike, pos.higher_strike));
        // Settled → gas-negative permissionless redeem; live → owner redeem (early close).
        const tx = settled
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
            );
        const result = await signAndExecute({ transaction: tx });
        await client.waitForTransaction({ digest: result.digest });
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
        <p className="text-sm text-gray-400 mb-1">No open positions</p>
        <p className="text-xs text-gray-600">Your active and settled positions will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Trading balance + withdraw — winnings land here (keeper auto-redeems);
          this is how the user collects to their wallet. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.015] px-4 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-0.5">
            Trading balance
          </div>
          <div className="text-lg font-mono font-bold text-white tabular-nums">
            {(managerBalance / DUSDC_MULTIPLIER).toFixed(2)} <span className="text-xs text-gray-500">DUSDC</span>
          </div>
        </div>
        <button
          onClick={handleWithdraw}
          disabled={withdrawing || managerBalance <= 0}
          className="px-4 py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 hover:border-white/20 text-white text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {withdrawing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Withdrawing…</> : 'Withdraw to wallet'}
        </button>
      </div>

      {/* Claim all settled winners — one gas-negative PTB */}
      {claimableWinners.length > 0 && (
        <button
          onClick={handleClaimAll}
          disabled={claimingAll}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/30 transition-all disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-sm font-bold text-emerald-400">
            {claimingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : '🏆'}
            Claim all winners ({claimableWinners.length})
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/70">
            ⚡ gas-negative
          </span>
        </button>
      )}

      {/* Positions list */}
      <div className="space-y-2">
        {positions.map((pos, idx) => {
          const direction = getPositionDirection(pos.lower_strike, pos.higher_strike);
          const strike = getPositionStrike(pos.lower_strike, pos.higher_strike);
          const strikeDollars = strike / FLOAT_SCALING;
          const quantity = Number(pos.quantity) / DUSDC_MULTIPLIER;
          // include the row index so two positions in the same market (same oracle+strikes)
          // can't collide on key — the per-row key stays stable for the expand toggle.
          const key = `${pos.oracle_id}-${pos.lower_strike}-${pos.higher_strike}-${idx}`;

          // Find matching oracle for status
          const oracle = oracles.find(o => o.oracle_id === pos.oracle_id);
          const isSettled = oracle?.status === 'settled';
          const isActive = oracle?.status === 'active';

          // Determine if won (for settled)
          let isWinner = false;
          if (isSettled && oracle?.settlement_price !== null && oracle?.settlement_price !== undefined) {
            const settlement = oracle.settlement_price;
            if (direction === 'UP') {
              isWinner = settlement >= strike;
            } else if (direction === 'DOWN') {
              isWinner = settlement < strike;
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
                        <span className="text-[10px] text-gray-600">
                          <Countdown expiryMs={oracle.expiry} className="text-[10px]" />
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
        })}
      </div>
    </div>
  );
}
