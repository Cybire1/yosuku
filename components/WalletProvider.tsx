'use client';

import { ReactNode } from 'react';
import { createNetworkConfig, SuiClientProvider, WalletProvider as DappKitWalletProvider } from '@mysten/dapp-kit';
import { getFullnodeUrl } from '@mysten/sui/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@mysten/dapp-kit/dist/index.css';

const { networkConfig } = createNetworkConfig({
  testnet: { url: getFullnodeUrl('testnet') },
});

const queryClient = new QueryClient();

export default function WalletProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <DappKitWalletProvider autoConnect>
          {children}
        </DappKitWalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
