// @ts-nocheck
'use client';

import { useState } from 'react';
import { Trophy, Loader, XCircle } from 'lucide-react';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { redeemPermissionlessTx } from '@/lib/sui/predictClient';
import { useDUSDCBalance, useManager } from '@/lib/sui/hooks';
import {
  formatPred,
  type RoundState,
  type ReputationData,
} from '@/lib/predictionContract';
import { markClaimed } from '@/lib/roundHelpers';
import { humanizeTxError } from '@/lib/errorMessages';

interface ClaimWinningsProps {
  round: RoundState;
  userDeposit: number;
  userDirection: 'UP' | 'DOWN';
  strike: number;
  reputation?: ReputationData;
  onClaimed?: () => void;
}

export default function ClaimWinnings({
  round,
  userDeposit,
  userDirection,
  strike,
  reputation,
  onClaimed,
}: ClaimWinningsProps) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { manager } = useManager();
  const { refresh: refreshBalance } = useDUSDCBalance();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState(false);

  // Determine if user won based on settlement price
  const isWinner = (() => {
    if (!round.resolved || round.settlementPrice === null) return false;
    // UP = (strike, +inf] — wins if settlement > strike
    // DOWN = (-inf, strike] — wins if settlement <= strike
    if (userDirection === 'UP') return round.settlementPrice > strike;
    return round.settlementPrice <= strike;
  })();

  // Payout: winners get quantity (full $1 per unit), losers get 0
  const estimatedPayout = isWinner ? userDeposit : 0;

  const handleRedeem = async () => {
    if (!address || !manager) {
      setError('Connect wallet and create account first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Settled position → gas-negative permissionless redeem (no owner check needed).
      const tx = redeemPermissionlessTx({
        managerId: manager.manager_id,
        oracleId: round.oracleId,
        expiry: BigInt(round.expiry),
        strike: BigInt(strike),
        direction: userDirection,
        quantity: BigInt(userDeposit),
      });

      await signAndExecute({ transaction: tx });

      markClaimed(round.oracleId);
      setClaimed(true);
      await refreshBalance();
      onClaimed?.();
    } catch (err: unknown) {
      console.error('Redeem error:', err);
      setError(humanizeTxError(err).title);
    } finally {
      setLoading(false);
    }
  };

  // Already claimed
  if (claimed) {
    return (
      <div className="relative">
        <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-off-green/30 rounded-xl" />
        <div className="relative p-4">
          <div className="text-center">
            <Trophy className="w-6 h-6 mx-auto text-off-green mb-2" />
            <p className="text-off-green font-bold text-sm uppercase tracking-widest">
              {isWinner ? 'Claimed!' : 'Redeemed'}
            </p>
            {isWinner && (
              <p className="text-gray-400 text-xs mt-1">+{formatPred(estimatedPayout)} DUSDC</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Loser — can still redeem (gets 0 back, frees the position)
  if (!isWinner && round.resolved) {
    return (
      <div className="relative">
        <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-off-red/20 rounded-xl" />
        <div className="relative p-4">
          <div className="text-center space-y-3">
            <p className="text-off-red font-bold text-sm uppercase tracking-widest">Position Lost</p>
            <p className="text-gray-400 text-xs">Redeem to clear your position.</p>
            {error && (
              <p className="text-off-red text-xs font-medium break-words">{error}</p>
            )}
            <button
              onClick={handleRedeem}
              disabled={loading}
              className="w-full py-2.5 bg-white/[0.05] hover:bg-white/[0.08] border border-white/10 text-gray-400 rounded-lg font-bold uppercase tracking-widest text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Redeeming...
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5" />
                  Redeem Position
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Not resolved yet
  if (!round.resolved) return null;

  // Winner
  return (
    <div className="relative">
      <div className="absolute inset-0 bg-gradient-to-br from-off-green/10 to-new-mint/5 backdrop-blur-2xl border border-off-green/30 rounded-xl" />
      <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-xl pointer-events-none" />

      <div className="relative p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-5 h-5 text-off-green" />
              <span className="text-off-green font-black text-sm uppercase tracking-widest">Winner!</span>
            </div>
            <p className="text-xs text-gray-400">{round.underlyingAsset} settled</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-white font-mono">+{formatPred(estimatedPayout)}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">DUSDC</p>
          </div>
        </div>

        {error && (
          <p className="text-off-red text-xs font-medium text-center mb-3 break-words">
            {error}
          </p>
        )}

        <button
          onClick={handleRedeem}
          disabled={loading}
          className="w-full py-3 bg-off-green hover:bg-off-green/90 text-black rounded-lg font-bold uppercase tracking-widest text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Claiming...
            </>
          ) : (
            'Claim Winnings'
          )}
        </button>
        <p className="text-[10px] text-gray-500 text-center mt-2">
          ⚡ gas-negative · <span className="text-off-green/80">redeem_permissionless</span> — the claim pays its own gas
        </p>
      </div>
    </div>
  );
}
