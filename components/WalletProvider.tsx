'use client';

import { WalletProvider as AleoWalletProvider } from '@demox-labs/aleo-wallet-adapter-react';
import { WalletModalProvider } from '@demox-labs/aleo-wallet-adapter-reactui';
import { LeoWalletAdapter } from '@demox-labs/aleo-wallet-adapter-leo';
import { useMemo } from 'react';

// Import wallet adapter CSS
import '@demox-labs/aleo-wallet-adapter-reactui/styles.css';

export default function WalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const wallets = useMemo(
    () => [
      new LeoWalletAdapter({
        appName: 'Dart',
      }),
    ],
    []
  );

  return (
    <AleoWalletProvider wallets={wallets}>
      <WalletModalProvider>{children}</WalletModalProvider>
    </AleoWalletProvider>
  );
}
