'use client';

// One submit path for the whole app: gas-free via the Onara sponsor when it can, the
// user's wallet when it can't. "Can't" covers ALL of: sponsor unreachable, sponsor
// policy-declines the tx (no matching allowlist), or the sponsor gas pool is too low —
// any of those throws, and we transparently rebuild a fresh tx and have the wallet pay.
//
// Usage: pass a tx *factory* (not a built tx), because the sponsored attempt mutates the
// transaction (sets gas owner = sponsor) and a built tx can't be rebuilt for the wallet
// fallback. The factory is called once per attempt to get a clean Transaction.
//
//   const { submit } = useSmartSubmit();
//   const { digest, sponsored } = await submit(() => buildSomeTx(args));
//
// Everything runs off JSON-RPC: the wallet only signs; gRPC executes (sponsored path goes
// through Onara, which also executes over gRPC).
import { useCallback, useEffect, useState } from 'react';
import { useCurrentAccount, useSignTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { grpc, buildSignExecute } from './modernClients';
import { getSponsorStatus, submitSponsored, type SponsorStatus } from '../sponsor';

export interface SubmitResult {
  digest: string;
  sponsored: boolean; // true = Onara paid the gas; false = wallet paid
}

type TxFactory = () => Transaction | Promise<Transaction>;

export function useSmartSubmit() {
  const account = useCurrentAccount();
  const { mutateAsync: signTransaction } = useSignTransaction();
  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);

  // discover the gas station once (graceful: stays null if unset/unreachable).
  useEffect(() => {
    let cancelled = false;
    getSponsorStatus().then((s) => { if (!cancelled) setSponsor(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const submit = useCallback(
    async (build: TxFactory): Promise<SubmitResult> => {
      const address = account?.address;
      if (!address) throw new Error('Connect a wallet first');

      // 1) Try sponsored (gas-free) — only if the station is up. The user signs to
      //    authorize; Onara policy-checks, co-signs as gas owner, and executes.
      if (sponsor) {
        try {
          const tx = await build();
          tx.setSender(address);
          tx.setGasOwner(sponsor.address);
          const bytes = await tx.build({ client: grpc });
          const signed = await signTransaction({ transaction: Transaction.from(bytes) });
          const r = await submitSponsored({ sender: address, txBytes: signed.bytes, txSignature: signed.signature });
          await grpc.waitForTransaction({ digest: r.digest });
          return { digest: r.digest, sponsored: true };
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          // Don't make the user sign a SECOND doomed popup. A genuine on-chain abort
          // (MoveAbort — e.g. the round just closed) or a user rejection will fail/repeat
          // under the wallet too, so surface it now. Only a SPONSOR-SIDE issue (sponsor
          // unreachable, policy decline, low gas) should fall through to wallet payment.
          if (/moveabort|move_?abort|vmverification|command\s+\d+\s+failed|rejected|user\s+reject/i.test(m)) {
            throw err;
          }
          console.warn('[smart-submit] sponsor path failed, falling back to wallet:', m);
        }
      }

      // 2) Wallet pays. Rebuild a CLEAN tx (the sponsored attempt set a sponsor gas owner);
      //    the wallet signs and gRPC executes the exact signed bytes.
      const tx = await build();
      const r = await buildSignExecute(tx, ({ transaction }) =>
        signTransaction({ transaction }).then((s) => ({ bytes: s.bytes, signature: s.signature })),
      );
      await grpc.waitForTransaction({ digest: r.digest });
      return { digest: r.digest, sponsored: false };
    },
    [account?.address, sponsor, signTransaction],
  );

  return { submit, sponsorReady: !!sponsor, sponsorAddress: sponsor?.address ?? null };
}
