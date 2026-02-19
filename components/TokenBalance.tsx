'use client';

import { useState, useEffect } from 'react';
import { Coins } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { formatPred, fetchOnChainBalance } from '@/lib/predictionContract';
import AnimatedNumber from './AnimatedNumber';

const BALANCE_KEY = 'dart_balance';

interface TokenBalanceProps {
  refreshTrigger?: number;
}

export default function TokenBalance({ refreshTrigger }: TokenBalanceProps) {
  const { publicKey } = useWallet();
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (!publicKey) {
      setBalance(0);
      return;
    }

    // Fetch on-chain balance immediately, then every 15s
    const syncChain = async () => {
      try {
        const onChain = await fetchOnChainBalance(publicKey);
        setBalance(onChain);
      } catch {
        // Fallback to localStorage
        setBalance(parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10));
      }
    };

    syncChain();
    const chainInterval = setInterval(syncChain, 15_000);

    // Also poll localStorage for fast local updates (mint/bet)
    const localInterval = setInterval(() => {
      setBalance(parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10));
    }, 2000);

    return () => {
      clearInterval(chainInterval);
      clearInterval(localInterval);
    };
  }, [publicKey, refreshTrigger]);

  if (!publicKey) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
      <Coins className="w-3.5 h-3.5 text-new-mint" />
      <AnimatedNumber
        value={formatPred(balance)}
        className="text-xs font-mono font-bold text-white tracking-widest"
      />
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">DART</span>
    </div>
  );
}
