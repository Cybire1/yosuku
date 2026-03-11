'use client';

import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';

interface InitSlotPromptProps {
  onInitialized?: () => void;
}

// v10: No per-user initialization needed. Atomic escrow means users can bet directly.
// This component is kept for backwards compatibility but auto-resolves.
export default function InitSlotPrompt({ onInitialized }: InitSlotPromptProps) {
  // Auto-resolve since v10 doesn't require init
  if (onInitialized) {
    setTimeout(onInitialized, 0);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-neutral-900/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
    >
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center mx-auto">
          <Shield className="w-8 h-8 text-sky-400" />
        </div>
        <div>
          <h3 className="text-lg font-black text-white">Ready to Bet</h3>
          <p className="text-sm text-gray-400 mt-2 leading-relaxed">
            Fixed-odds betting with atomic escrow. Your payout is locked the moment you place a bet.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
