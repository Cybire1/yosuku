'use client';

import { useState } from 'react';
import { Trophy, Loader2, Check, ArrowRight } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { redeemPermissionlessTx } from '@/lib/sui/predictClient';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { useDUSDCBalance, useManager } from '@/lib/sui/hooks';
import { type RoundState, type ReputationData } from '@/lib/predictionContract';
import { markClaimed } from '@/lib/roundHelpers';
import { humanizeTxError } from '@/lib/errorMessages';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';

interface ClaimWinningsProps {
  round: RoundState;
  userDeposit: number;       // position quantity = gross payout on a win (base units, micro DUSDC)
  stake: number;             // net premium paid to open (base units, micro DUSDC) — for the P&L
  userDirection: 'UP' | 'DOWN';
  strike: number;            // FLOAT_SCALING-encoded
  reputation?: ReputationData;
  onClaimed?: () => void;
}

/**
 * The single settled-result card — outcome, payout, the story, and the claim
 * action in one place. Replaces the old stack of three near-identical cards.
 */
export default function ClaimWinnings({
  round,
  userDeposit,
  stake,
  userDirection,
  strike,
  onClaimed,
}: ClaimWinningsProps) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { manager } = useManager();
  const { refresh: refreshBalance } = useDUSDCBalance();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState(false);

  const settlement = round.settlementPrice;
  const isWinner = (() => {
    if (!round.resolved || settlement === null) return false;
    return userDirection === 'UP' ? settlement > strike : settlement <= strike;
  })();

  const payout = isWinner ? userDeposit : 0;
  const asset = round.underlyingAsset || 'BTC';
  const usd = (scaled: number) => '$' + (scaled / FLOAT_SCALING).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const diff = settlement !== null ? Math.abs(settlement - strike) / FLOAT_SCALING : 0;

  // Realized P&L: what you actually made = gross payout minus the premium you staked.
  const profitMicro = Math.max(0, payout - stake);
  const money = (micro: number) => (micro / DUSDC_MULTIPLIER).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const roiPct = stake > 0 ? Math.round((profitMicro / stake) * 100) : 0;

  const handleRedeem = async () => {
    if (!address || !manager) { setError('Connect your wallet first.'); return; }
    setLoading(true);
    setError('');
    try {
      await submit(() => redeemPermissionlessTx({
        managerId: manager.manager_id,
        oracleId: round.oracleId,
        expiry: BigInt(round.expiry),
        strike: BigInt(strike),
        direction: userDirection,
        quantity: BigInt(userDeposit),
      }));
      markClaimed(round.oracleId);
      setClaimed(true);
      await refreshBalance();
      onClaimed?.();
    } catch (err: unknown) {
      console.error('Redeem error:', err);
      // `decrease_position` abort 1 = the position was already redeemed — almost
      // always by the permissionless keeper, which auto-collects winners. The
      // payout is already in the trading balance, so this is a SUCCESS, not an
      // error: refresh and show it as settled.
      if (/abort code: 1|decrease_position|already/i.test(String(err))) {
        markClaimed(round.oracleId);
        await refreshBalance();
        setClaimed(true);
        onClaimed?.();
      } else {
        setError(humanizeTxError(err).title);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!round.resolved || settlement === null) return null;

  // ── Loser: honest, muted, no false cheer ──────────────────────────────────
  if (!isWinner) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.015] p-5">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-500 mb-1.5">Not this time</div>
        <p className="text-sm text-gray-400">
          {asset} closed <span className="text-gray-200 font-mono">{usd(settlement)}</span>,{' '}
          {settlement > strike ? 'above' : 'below'} your {userDirection} line at{' '}
          <span className="text-gray-200 font-mono">{usd(strike)}</span>.
        </p>
      </div>
    );
  }

  // ── Winner ────────────────────────────────────────────────────────────────
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.10] via-emerald-500/[0.03] to-transparent p-5">
      {/* soft glow */}
      <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 h-40 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-4 h-4 text-emerald-400" />
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-emerald-400">
            {claimed ? 'Claimed' : 'You won'}
          </span>
        </div>

        {/* Realized P&L — the profit is the hero, matching the share card's focal number */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-[2.75rem] leading-[0.9] font-[800] text-emerald-400 tracking-tight tabular-nums">
                +{money(profitMicro)}
              </span>
              <span className="font-mono text-sm text-emerald-400/60 pb-1">DUSDC</span>
            </div>
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-emerald-400/70 mt-1">Profit</div>
          </div>
          {roiPct > 0 && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-1.5 text-center shrink-0">
              <div className="font-mono text-lg font-bold text-emerald-300 tabular-nums leading-none">+{roiPct}%</div>
              <div className="font-mono text-[8px] tracking-[0.16em] uppercase text-emerald-400/60 mt-1">return</div>
            </div>
          )}
        </div>

        {/* stake → payout, so the profit is fully accounted for */}
        <div className="mt-3 flex items-center gap-2 font-mono text-[11px] text-gray-400">
          <span>Stake <span className="text-gray-200 tabular-nums">${money(stake)}</span></span>
          <ArrowRight className="w-3 h-3 text-gray-600 shrink-0" />
          <span>Payout <span className="text-gray-200 tabular-nums">${money(payout)}</span></span>
        </div>

        <p className="text-xs text-gray-400 mt-3">
          {asset} closed <span className="text-gray-200 font-mono">{usd(settlement)}</span>,{' '}
          <span className="text-gray-200 font-mono">{usd(diff * FLOAT_SCALING)}</span>{' '}
          above your {userDirection} line at <span className="text-gray-200 font-mono">{usd(strike)}</span>.
        </p>

        {error && <p className="text-rose-400 text-xs font-medium mt-3 break-words">{error}</p>}

        {claimed ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 py-3 text-emerald-400 text-xs font-bold uppercase tracking-widest">
            <Check className="w-4 h-4" /> Paid to your balance
          </div>
        ) : (
          <>
            <button
              onClick={handleRedeem}
              disabled={loading}
              className="mt-4 w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold uppercase tracking-widest text-sm transition-all shadow-[0_0_30px_rgba(52,211,153,0.18)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (<><Loader2 className="w-4 h-4 animate-spin" /> Collecting…</>) : 'Collect it now'}
            </button>
            <p className="text-[10px] text-gray-500 text-center mt-2">
              Winners are paid out automatically. This just collects it now. Gas-free.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
