'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Loader } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';

interface ClaimWinningsProps {
  marketId: string;
  marketQuestion: string;
  winningSide: 'YES' | 'NO';
  userSide: 'YES' | 'NO';
  shares: number;
  onClaimed?: () => void;
}

export default function ClaimWinnings({
  marketId,
  marketQuestion,
  winningSide,
  userSide,
  shares,
  onClaimed
}: ClaimWinningsProps) {
  const { publicKey, requestTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState(false);

  const isWinner = userSide === winningSide;
  const estimatedPayout = isWinner ? shares * 2 : 0; // Simplified: 2x payout for winners

  const handleClaim = async () => {
    if (!publicKey || !requestTransaction) {
      setError('Please connect your wallet');
      return;
    }

    if (!isWinner) {
      setError('You did not win this market');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Call claim_winnings transition
      const inputs = [
        `${marketId}u64`, // market_id: u64
      ];

      const transaction = {
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: 'predictionmarket_v2.aleo',
          functionName: 'claim_winnings',
          inputs,
        }],
        fee: 1000000, // 1 ALEO
        feePrivate: false,
      };

      const txResult = await requestTransaction(transaction);
      console.log('Claim transaction:', txResult);

      setClaimed(true);

      if (onClaimed) {
        onClaimed();
      }

      alert(`Successfully claimed ${estimatedPayout.toFixed(2)} ALEO!`);
    } catch (err: any) {
      console.error('Claim error:', err);
      setError(err.message || 'Failed to claim winnings');
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
            <p className="text-gray-400 text-xs mt-1">+{estimatedPayout.toFixed(2)} ALEO</p>
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
            <p className="text-xs text-gray-400 line-clamp-1">{marketQuestion}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-white">+{estimatedPayout.toFixed(2)}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest">ALEO</p>
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
