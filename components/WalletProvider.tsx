'use client';

import { ReactNode } from 'react';
import { createNetworkConfig, SuiClientProvider, WalletProvider as DappKitWalletProvider } from '@mysten/dapp-kit';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RegisterEnoki from './RegisterEnoki';
import '@mysten/dapp-kit/dist/index.css';

const { networkConfig } = createNetworkConfig({
  testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' },
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
        <RegisterEnoki />
        <DappKitWalletProvider autoConnect>
          {children}
        </DappKitWalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
