'use client';

import { ReactNode, useMemo } from 'react';
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletModalProvider } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield';
import { Network } from '@provablehq/aleo-types';
import { WalletDecryptPermission } from '@provablehq/aleo-wallet-standard';

// Import wallet modal styles
import '@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css';

export default function WalletProvider({
  children,
}: {
  children: ReactNode;
}) {
  const wallets = useMemo(() => [new ShieldWalletAdapter()], []);

  return (
    <AleoWalletProvider
      wallets={wallets}
      network={Network.TESTNET}
      decryptPermission={WalletDecryptPermission.AutoDecrypt}
      programs={['btc_pred_v7.aleo', 'test_usdcx_stablecoin.aleo']}
      autoConnect
    >
      <WalletModalProvider>{children}</WalletModalProvider>
    </AleoWalletProvider>
  );
}
