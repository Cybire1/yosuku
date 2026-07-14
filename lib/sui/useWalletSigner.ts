'use client';

// Adapts the connected dapp-kit wallet into the @mysten/sui `Signer` the messaging
// SDK expects. A browser wallet can't do raw `sign(bytes)` — but the SDK only ever
// calls `signTransaction` (for on-chain ops) and `signPersonalMessage` (for the Seal
// SessionKey), plus `getPublicKey`/`toSuiAddress`. We map those to the wallet's
// mutations and duck-type the rest. This is the one browser-only piece of the
// comments client (needs a real wallet to exercise — tested from the UI).

import { useMemo } from 'react';
import { useCurrentAccount, useSignTransaction, useSignPersonalMessage } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import type { Signer } from '@mysten/sui/cryptography';

/** A `Signer` backed by the connected wallet, or null when no wallet is connected. */
export function useWalletSigner(): Signer | null {
  const account = useCurrentAccount();
  const { mutateAsync: signTx } = useSignTransaction();
  const { mutateAsync: signMsg } = useSignPersonalMessage();

  return useMemo(() => {
    if (!account) return null;
    // Most Sui wallets are Ed25519; the raw account public key bytes construct it.
    const publicKey = new Ed25519PublicKey(account.publicKey);
    const signer = {
      getKeyScheme: () => 'ED25519' as const,
      getPublicKey: () => publicKey,
      toSuiAddress: () => account.address,
      // raw sign isn't available from a wallet; the SDK never calls it for our flow.
      sign: async () => { throw new Error('raw sign() is unsupported for a wallet signer'); },
      signWithIntent: async () => { throw new Error('use signTransaction/signPersonalMessage'); },
      // the wallet signs a Transaction (rebuild from the bytes the SDK produced), like useSmartSubmit.
      signTransaction: async (bytes: Uint8Array) => {
        const r = await signTx({ transaction: Transaction.from(bytes) });
        return { signature: r.signature, bytes: r.bytes };
      },
      // the Seal SessionKey personal-message signature (one wallet prompt per session).
      signPersonalMessage: async (message: Uint8Array) => {
        const r = await signMsg({ message });
        return { signature: r.signature, bytes: r.bytes };
      },
    };
    return signer as unknown as Signer;
  }, [account, signTx, signMsg]);
}
