'use client';

import { useState, useEffect } from 'react';
import { Coins } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { BALANCE_KEY, BALANCE_UPDATED_EVENT, formatPred, fetchOnChainBalance } from '@/lib/predictionContract';
import AnimatedNumber from './AnimatedNumber';

interface TokenBalanceProps {
  refreshTrigger?: number;
}

export default function TokenBalance({ refreshTrigger }: TokenBalanceProps) {
  const { address } = useWallet();
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (!address) {
      return;
    }

    // Fetch on-chain balance — reconciles with optimistic pending updates
    const syncChain = async () => {
      try {
        const resolved = await fetchOnChainBalance(address);
        setBalance(resolved);
      } catch {
        setBalance(parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10));
      }
    };

    syncChain();
    const chainInterval = setInterval(syncChain, 10_000);
    const handleBalanceUpdate = (event: Event) => {
      const next = (event as CustomEvent<{ balance?: number }>).detail?.balance;
      if (typeof next === 'number') {
        setBalance(next);
        return;
      }
      setBalance(parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10));
    };
    window.addEventListener(BALANCE_UPDATED_EVENT, handleBalanceUpdate);

    return () => {
      clearInterval(chainInterval);
      window.removeEventListener(BALANCE_UPDATED_EVENT, handleBalanceUpdate);
    };
  }, [address, refreshTrigger]);

  if (!address) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
      <Coins className="w-3.5 h-3.5 text-new-mint" />
      <AnimatedNumber
        value={formatPred(balance)}
        className="text-xs font-mono font-bold text-white tracking-widest"
      />
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">USDCx</span>
    </div>
  );
}
