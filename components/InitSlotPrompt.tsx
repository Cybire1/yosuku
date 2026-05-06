// @ts-nocheck
'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, Loader, Wallet } from 'lucide-react';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { createManagerTx } from '@/lib/sui/predictClient';
import { executeWithRetry } from '@/lib/walletExecution';

interface InitSlotPromptProps {
  onInitialized?: () => void;
}

export default function InitSlotPrompt({ onInitialized }: InitSlotPromptProps) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleInit = async () => {
    if (!address) return;

    setLoading(true);
    setError('');

    try {
      const tx = createManagerTx();
      await executeWithRetry(() =>
        signAndExecute({ transaction: tx })
      );
      onInitialized?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create trading account';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-neutral-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
    >
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-new-mint/10 border border-new-mint/20 flex items-center justify-center mx-auto">
          <KeyRound className="w-8 h-8 text-new-mint" />
        </div>

        <div>
          <h3 className="text-lg font-black text-white">Create Trading Account</h3>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            Create your PredictManager on Sui. This is a one-time setup that enables
            you to deposit DUSDC and trade prediction positions.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-left">
          <Wallet className="w-4 h-4 text-new-mint flex-shrink-0" />
          <span className="text-xs text-gray-400">
            Your PredictManager tracks your DUSDC balance and all prediction positions on-chain.
          </span>
        </div>

        {error && (
          <p className="text-off-red text-xs font-bold animate-pulse">{error}</p>
        )}

        <button
          onClick={handleInit}
          disabled={loading || !address}
          className="w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider bg-new-mint hover:bg-new-mint/90 text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Creating Account...
            </>
          ) : (
            'Create Trading Account'
          )}
        </button>
      </div>
    </motion.div>
  );
}
