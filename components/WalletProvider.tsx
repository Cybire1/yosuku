'use client';

import { ReactNode } from 'react';
import { createNetworkConfig, SuiClientProvider, WalletProvider as DappKitWalletProvider } from '@mysten/dapp-kit';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SUI_NETWORK } from '@/lib/sui/network';
import RegisterEnoki from './RegisterEnoki';
import '@mysten/dapp-kit/dist/index.css';

// dapp-kit only needs a JSON-RPC URL for wallet plumbing; our data path runs on GraphQL/gRPC.
// Both networks are registered so flipping SUI_NETWORK retargets the wallet too.
// NOTE: fullnode.testnet.sui.io's JSON-RPC is sunset (empty 404 bodies on every method,
// verified 2026-07-11) — publicnode still serves the object/coin/balance surface that
// dapp-kit and the remaining useSuiClient() reads (vault stats, DUSDC/PLP balances) need.
const { networkConfig } = createNetworkConfig({
  testnet: {
    url: process.env.NEXT_PUBLIC_SUI_RPC_URL || 'https://sui-testnet-rpc.publicnode.com',
    network: 'testnet',
  },
  mainnet: { url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' },
});

const queryClient = new QueryClient();

export default function WalletProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={SUI_NETWORK}>
        <RegisterEnoki />
        <DappKitWalletProvider autoConnect>
          {children}
        </DappKitWalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
