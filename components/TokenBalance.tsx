'use client';

import { useState, useEffect } from 'react';
import { Coins } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { formatPred } from '@/lib/predictionContract';

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

    const read = () => {
      const val = parseInt(localStorage.getItem(BALANCE_KEY) || '0', 10);
      setBalance(val);
    };

    read();
    // Poll localStorage every 2s for updates
    const interval = setInterval(read, 2000);
    return () => clearInterval(interval);
  }, [publicKey, refreshTrigger]);

  if (!publicKey) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
      <Coins className="w-3.5 h-3.5 text-new-mint" />
      <span className="text-xs font-mono font-bold text-white">
        {formatPred(balance)}
      </span>
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">DART</span>
    </div>
  );
}
