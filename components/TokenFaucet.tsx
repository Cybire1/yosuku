'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Droplets, Loader, Check } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { PRED_TOKEN_PROGRAM, PRED_MULTIPLIER } from '@/lib/predictionContract';

const BALANCE_KEY = 'dart_balance';

interface TokenFaucetProps {
  onMinted?: () => void;
}

export default function TokenFaucet({ onMinted }: TokenFaucetProps) {
  const { publicKey, requestTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('1000');

  const handleMint = async () => {
    if (!publicKey || !requestTransaction) return;

    setLoading(true);
    setSuccess(false);
    setError('');

    try {
      const microAmount = Math.floor(parseFloat(amount) * PRED_MULTIPLIER);
      if (microAmount <= 0) return;

      const transaction = {
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: PRED_TOKEN_PROGRAM,
          functionName: 'mint_public',
          inputs: [`${microAmount}u64`],
        }],
        fee: 2_000_000,
        feePrivate: false,
      };

      await requestTransaction(transaction);

      // Update local balance tracker after successful tx
      const current = parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10);
      localStorage.setItem(BALANCE_KEY, String(current + microAmount));

      setSuccess(true);
      onMinted?.();

      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      setError(message);
      console.error('Mint error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-20 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs font-mono text-white text-center focus:outline-none focus:border-new-mint/50"
            min="1"
            max="10000"
          />
        </div>
        <button
          onClick={handleMint}
          disabled={loading || !publicKey}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-new-mint/10 hover:bg-new-mint/20 border border-new-mint/30 hover:border-new-mint/50 rounded-lg text-new-mint text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Loader className="w-3.5 h-3.5 animate-spin" />
              </motion.div>
            ) : success ? (
              <motion.div key="success" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                <Check className="w-3.5 h-3.5" />
              </motion.div>
            ) : (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Droplets className="w-3.5 h-3.5" />
              </motion.div>
            )}
          </AnimatePresence>
          {loading ? 'Minting...' : success ? 'Minted!' : 'Mint DART'}
        </button>
      </div>
      {error && (
        <p className="text-off-red text-[10px] font-bold truncate">{error}</p>
      )}
    </div>
  );
}
