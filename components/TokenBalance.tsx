'use client';

import { useState, useEffect } from 'react';
import { Coins } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { formatPred, fetchOnChainBalance } from '@/lib/predictionContract';
import AnimatedNumber from './AnimatedNumber';

const BALANCE_KEY = 'usdcx_balance';

interface TokenBalanceProps {
  refreshTrigger?: number;
}

export default function TokenBalance({ refreshTrigger }: TokenBalanceProps) {
  const { address } = useWallet();
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (!address) {
      setBalance(0);
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
    const chainInterval = setInterval(syncChain, 15_000);

    // Poll localStorage for fast local updates (mint/bet)
    const localInterval = setInterval(() => {
      setBalance(parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10));
    }, 2000);

    return () => {
      clearInterval(chainInterval);
      clearInterval(localInterval);
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
