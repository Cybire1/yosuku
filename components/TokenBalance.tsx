'use client';

import { Coins } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import { formatPred } from '@/lib/predictionContract';
import AnimatedNumber from './AnimatedNumber';

interface TokenBalanceProps {
  refreshTrigger?: number;
}

export default function TokenBalance({ refreshTrigger }: TokenBalanceProps) {
  const account = useCurrentAccount();
  const { balance } = useDUSDCBalance();

  if (!account?.address) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg">
      <Coins className="w-3.5 h-3.5 text-new-mint" />
      <AnimatedNumber
        value={formatPred(balance)}
        className="text-xs font-mono font-bold text-white tracking-widest"
      />
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">DUSDC</span>
    </div>
  );
}
