'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, Loader, Shield } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { BTC_PREDICTION_PROGRAM } from '@/lib/predictionContract';

interface InitSlotPromptProps {
  onInitialized?: () => void;
}

export default function InitSlotPrompt({ onInitialized }: InitSlotPromptProps) {
  const { address, executeTransaction } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleInit = async () => {
    if (!address || !executeTransaction) return;

    setLoading(true);
    setError('');

    try {
      await executeTransaction({
        program: BTC_PREDICTION_PROGRAM,
        function: 'init_slot',
        inputs: [address],
        fee: 500_000,
        privateFee: false,
      });

      onInitialized?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize';
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
        <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mx-auto">
          <KeyRound className="w-8 h-8 text-sky-400" />
        </div>

        <div>
          <h3 className="text-lg font-black text-white">Initialize Private Account</h3>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            Create your encrypted betting slot. This is a one-time setup that enables
            private bets — nobody can see which side you choose.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-left">
          <Shield className="w-4 h-4 text-sky-400 flex-shrink-0" />
          <span className="text-xs text-gray-400">
            Your BetSlot record is encrypted on Aleo. Only you can decrypt it to see your bet side and amount.
          </span>
        </div>

        {error && (
          <p className="text-off-red text-xs font-bold animate-pulse">{error}</p>
        )}

        <button
          onClick={handleInit}
          disabled={loading || !address}
          className="w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider bg-sky-500 hover:bg-sky-400 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Creating Encrypted Slot...
            </>
          ) : (
            'Initialize Account'
          )}
        </button>
      </div>
    </motion.div>
  );
}
