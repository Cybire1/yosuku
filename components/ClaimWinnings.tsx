'use client';

import { useState } from 'react';
import { Trophy, Loader } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import {
  BTC_PREDICTION_PROGRAM,
  formatPred,
  calcPayoutWithBonus,
  setOptimisticBalance,
  fetchOnChainBalance,
  type RoundState,
  type ReputationData,
} from '@/lib/predictionContract';

interface ClaimWinningsProps {
  round: RoundState;
  userDeposit: number;       // micro DART
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
  const { publicKey, requestTransaction, requestRecords } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState(false);

  const winningSide = round.outcome ? 'YES' : 'NO';
  const isWinner = round.resolved && userSide === winningSide;

  // Calculate payout with tier bonus
  const totalPool = round.yesPool + round.noPool;
  const winPool = round.outcome ? round.yesPool : round.noPool;
  const bonusPct = reputation?.bonusPct ?? 0;
  const estimatedPayout = isWinner && winPool > 0
    ? calcPayoutWithBonus(userDeposit, winPool, totalPool, bonusPct)
    : 0;

  const handleClaim = async () => {
    if (!publicKey || !requestTransaction) {
      setError('Please connect your wallet');
      return;
    }

    if (!isWinner) {
      setError('You did not win this round');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Fetch user's BetReceipt records from wallet
      const records = await requestRecords?.(BTC_PREDICTION_PROGRAM);
      const receiptList = Array.isArray(records) ? records : [];

      // Find the receipt matching this round
      const receipt = receiptList.find((r: Record<string, unknown>) => {
        const data = (r as Record<string, unknown>).data as Record<string, string> | undefined;
        const plaintext = (r as Record<string, unknown>).plaintext as string | undefined;
        if (data?.round_id) {
          return data.round_id === `${round.id}u64` || data.round_id === `${round.id}u64.private`;
        }
        if (plaintext) {
          return plaintext.includes(`round_id: ${round.id}u64`);
        }
        return false;
      });

      if (!receipt) {
        setError('BetReceipt not found in wallet. It may have already been consumed.');
        setLoading(false);
        return;
      }

      const recordInput = (receipt as Record<string, unknown>).plaintext as string
        || JSON.stringify(receipt);

      await requestTransaction({
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: BTC_PREDICTION_PROGRAM,
          functionName: 'claim',
          inputs: [recordInput, `${estimatedPayout}u64`],
        }],
        fee: 2_000_000,
        feePrivate: false,
      });

      // Optimistic balance update
      const curBalance = parseInt(localStorage.getItem('dart_balance') || '0', 10);
      setOptimisticBalance(curBalance + estimatedPayout);

      // Mark as claimed
      const claimedRounds: number[] = JSON.parse(localStorage.getItem('pred_claimed') || '[]');
      if (!claimedRounds.includes(round.id)) {
        claimedRounds.push(round.id);
        localStorage.setItem('pred_claimed', JSON.stringify(claimedRounds));
      }

      setClaimed(true);
      onClaimed?.();

      // Refresh on-chain balance after delay
      setTimeout(() => {
        if (publicKey) fetchOnChainBalance(publicKey);
      }, 10_000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to claim winnings';
      console.error('Claim error:', err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (!isWinner) {
    return (
      <div className="relative">
        <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-off-red/20 rounded-xl" />
        <div className="relative p-4">
          <div className="text-center">
            <p className="text-off-red font-bold text-sm uppercase tracking-widest">Position Lost</p>
            <p className="text-gray-400 text-xs mt-1">Better luck next time!</p>
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
            <p className="text-gray-400 text-xs mt-1">+{formatPred(estimatedPayout)} DART</p>
          </div>
        </div>
      </div>
    );
  }

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
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">DART</p>
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
