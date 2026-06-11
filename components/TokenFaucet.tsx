'use client';

import { Droplets, Fuel } from 'lucide-react';

// DUSDC has no on-chain faucet (TreasuryCap is held by the deployer) —
// test funds are issued via Mysten's request form. SUI gas comes from
// the standard testnet faucet.
const DUSDC_REQUEST_FORM = 'https://tally.so/r/Xx102L';
const SUI_FAUCET = 'https://faucet.sui.io/';

interface TokenFaucetProps {
  onMinted?: () => void;
}

export default function TokenFaucet({ onMinted }: TokenFaucetProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={DUSDC_REQUEST_FORM}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-new-mint/10 hover:bg-new-mint/20 border border-new-mint/30 hover:border-new-mint/50 rounded-lg text-new-mint text-xs font-bold uppercase tracking-wider transition-all"
      >
        <Droplets className="w-3.5 h-3.5" />
        Request DUSDC
      </a>
      <a
        href={SUI_FAUCET}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 rounded-lg text-gray-300 text-xs font-bold uppercase tracking-wider transition-all"
      >
        <Fuel className="w-3.5 h-3.5" />
        SUI gas
      </a>
      <span className="text-[10px] text-gray-600">
        DUSDC (trading) via request form · SUI (gas) from the faucet
      </span>
    </div>
  );
}
