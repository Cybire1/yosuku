'use client';

import { Droplets } from 'lucide-react';

interface TokenFaucetProps {
  onMinted?: () => void;
}

export default function TokenFaucet({ onMinted }: TokenFaucetProps) {
  return (
    <div className="flex items-center gap-3">
      <a
        href="https://faucet.testnet.sui.io/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-new-mint/10 hover:bg-new-mint/20 border border-new-mint/30 hover:border-new-mint/50 rounded-lg text-new-mint text-xs font-bold uppercase tracking-wider transition-all"
      >
        <Droplets className="w-3.5 h-3.5" />
        Get Test DUSDC
      </a>
      <span className="text-[10px] text-gray-600">
        Get DUSDC tokens on Sui testnet to start trading
      </span>
    </div>
  );
}
