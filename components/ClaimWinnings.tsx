'use client';

import { useState } from 'react';
import { Trophy, Loader, XCircle } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import {
  BTC_PREDICTION_PROGRAM,
  formatPred,
  calcPayoutWithBonus,
  setOptimisticBalance,
  fetchOnChainBalance,
  type RoundState,
  type ReputationData,
} from '@/lib/predictionContract';
import { getBetCommitment } from '@/lib/roundHelpers';

interface ClaimWinningsProps {
  round: RoundState;
  userDeposit: number;       // microcredits
  userSide: 'YES' | 'NO';
  reputation?: ReputationData;
  onClaimed?: () => void;
}

export default function ClaimWinnings({
  round,
  userDeposit,
  userSide,
  reputation,
  onClaimed,
}: ClaimWinningsProps) {
  const { address, executeTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState(false);

  const winningSide = round.outcome ? 'YES' : 'NO';
  const isWinner = round.resolved && userSide === winningSide;

  // Calculate payout with tier bonus — use revealed pools after resolution
  const totalPool = round.yesPool + round.noPool;
  const winPool = round.outcome ? round.yesPool : round.noPool;
  const bonusPct = reputation?.bonusPct ?? 0;
  const estimatedPayout = isWinner && winPool > 0
    ? calcPayoutWithBonus(userDeposit, winPool, totalPool, bonusPct)
    : 0;

  const handleClaim = async () => {
    if (!address || !executeTransaction) {
      setError('Please connect your wallet');
      return;
    }

    const commitment = getBetCommitment(address, round.id);
    if (!commitment) {
      setError('Commitment data not found. Did you bet from this browser?');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // v8 claim: claim(rid: u64, side: bool, amt: u128, salt: field, payout: u128)
      const sideVal = commitment.side === 'YES' ? 'true' : 'false';

      const inputs = [
        `${round.id}u64`,
        sideVal,
        `${commitment.amount}u128`,
        commitment.salt,
        `${estimatedPayout}u128`,
      ];

      await executeTransaction({
        program: BTC_PREDICTION_PROGRAM,
        function: 'claim',
        inputs,
        fee: 2_000_000,
        privateFee: false,
      });

      // Optimistic balance update
      const curBalance = parseInt(localStorage.getItem('usdcx_balance') || '0', 10);
      setOptimisticBalance(curBalance + estimatedPayout);

      // Mark as claimed
      const claimedRounds: number[] = JSON.parse(localStorage.getItem('v8_claimed') || '[]');
      if (!claimedRounds.includes(round.id)) {
        claimedRounds.push(round.id);
        localStorage.setItem('v8_claimed', JSON.stringify(claimedRounds));
      }

      setClaimed(true);
      onClaimed?.();

      // Refresh on-chain balance after delay
      setTimeout(() => {
        if (address) fetchOnChainBalance(address);
      }, 10_000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to claim winnings';
      console.error('Claim error:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleForfeit = async () => {
    if (!address || !executeTransaction) {
      setError('Please connect your wallet');
      return;
    }

    const commitment = getBetCommitment(address, round.id);
    if (!commitment) {
      setError('Commitment data not found.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // v8 forfeit: forfeit(rid: u64, side: bool, amt: u128, salt: field)
      const sideVal = commitment.side === 'YES' ? 'true' : 'false';

      const inputs = [
        `${round.id}u64`,
        sideVal,
        `${commitment.amount}u128`,
        commitment.salt,
      ];

      await executeTransaction({
        program: BTC_PREDICTION_PROGRAM,
        function: 'forfeit',
        inputs,
        fee: 500_000,
        privateFee: false,
      });

      // Mark as claimed (forfeited)
      const claimedRounds: number[] = JSON.parse(localStorage.getItem('v8_claimed') || '[]');
      if (!claimedRounds.includes(round.id)) {
        claimedRounds.push(round.id);
        localStorage.setItem('v8_claimed', JSON.stringify(claimedRounds));
      }

      setClaimed(true);
      onClaimed?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to forfeit';
      console.error('Forfeit error:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Loser — show forfeit option
  if (!isWinner && round.resolved) {
    if (claimed) {
      return (
        <div className="relative">
          <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/5 rounded-xl" />
          <div className="relative p-4">
            <div className="text-center">
              <p className="text-gray-400 font-bold text-sm uppercase tracking-widest">Forfeited</p>
              <p className="text-gray-500 text-xs mt-1">Commitment released</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="relative">
        <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-off-red/20 rounded-xl" />
        <div className="relative p-4">
          <div className="text-center space-y-3">
            <p className="text-off-red font-bold text-sm uppercase tracking-widest">Position Lost</p>
            <p className="text-gray-400 text-xs">Forfeit to release your commitment.</p>
            {error && (
              <p className="text-off-red text-xs font-bold animate-pulse">{error}</p>
            )}
            <button
              onClick={handleForfeit}
              disabled={loading}
              className="w-full py-2.5 bg-white/[0.05] hover:bg-white/[0.08] border border-white/10 text-gray-400 rounded-lg font-bold uppercase tracking-widest text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Forfeiting...
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5" />
                  Forfeit Position
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (claimed) {
    return (
      <div className="relative">
        <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-off-green/30 rounded-xl" />
        <div className="relative p-4">
          <div className="text-center">
            <Trophy className="w-6 h-6 mx-auto text-off-green mb-2" />
            <p className="text-off-green font-bold text-sm uppercase tracking-widest">Claimed!</p>
            <p className="text-gray-400 text-xs mt-1">+{formatPred(estimatedPayout)} USDCx</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isWinner) return null;

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
            <p className="text-xs text-gray-400">Round #{round.id}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-white font-mono">+{formatPred(estimatedPayout)}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">USDCx</p>
          </div>
        </div>

        {error && (
          <p className="text-off-red text-xs font-bold text-center mb-3 animate-pulse">
            {error}
          </p>
        )}

        <button
          onClick={handleClaim}
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
      </div>
    </div>
  );
}
