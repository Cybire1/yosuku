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
import type { Signer } from '@mysten/sui/cryptography';
import { grpc, buildSignExecute } from './modernClients';
import { getSponsorStatus, submitSponsored, type SponsorStatus } from '../sponsor';

export interface SubmitResult {
  digest: string;
  sponsored: boolean; // true = Onara paid the gas; false = wallet paid
}

type TxFactory = () => Transaction | Promise<Transaction>;

// Pin ONE random gas coin from the sponsor's pool for a sponsored bet.
//
// Why this is required for concurrency: a Sui sponsored tx signs the gas coins INTO the
// bytes — the user signs them, the sponsor co-signs the same bytes, and neither can reassign
// gas afterward. If every bet builds with default gas resolution, the client locks the
// sponsor's WHOLE coin set, so two concurrent bets collide (equivocation) no matter how many
// coins the sponsor holds. Pinning a random coin per bet spreads concurrent bets across the
// pool. suix_getCoins is the one call returning {objectId, version, digest} together (exactly
// what setGasPayment needs); POSTed to the same fullnode the gRPC client uses. Best-effort:
// any failure returns null and we let the client resolve gas (serial fallback) rather than
// block the bet. Returns null when the pool has < 2 usable coins so we never pin a lone coin.
async function pickSponsorGasPayment(sponsor: string): Promise<{ objectId: string; version: string; digest: string }[] | null> {
  try {
    // The public fullnode's JSON-RPC is sunset (404s) — this read silently failed, so every
    // sponsored tx fell back to locking the WHOLE sponsor pool (collisions + pool re-merge).
    // publicnode still serves suix_getCoins.
    const res = await fetch('https://sui-testnet-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getCoins', params: [sponsor, '0x2::sui::SUI', null, 50] }),
      signal: AbortSignal.timeout(4000),
    });
    const coins: Array<{ coinObjectId: string; version: string; digest: string; balance: string }> =
      (await res.json())?.result?.data ?? [];
    const usable = coins.filter((c) => BigInt(c.balance) >= 150_000_000n); // ≥0.15 SUI comfortably covers one bet's gas
    if (usable.length < 2) return null; // single/empty pool → don't pin a lone coin; let the client resolve
    const c = usable[Math.floor(Math.random() * usable.length)];
    return [{ objectId: c.coinObjectId, version: String(c.version), digest: c.digest }];
  } catch {
    return null;
  }
}

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
          // Spread concurrent bets across the sponsor's gas pool (see pickSponsorGasPayment).
          // Without this, the client locks the sponsor's whole coin set and simultaneous bets
          // collide. Skipped gracefully (null) when the pool isn't split — falls back to the
          // client's default resolution, i.e. serial sponsorship, exactly as before.
          const gasPayment = await pickSponsorGasPayment(sponsor.address);
          if (gasPayment) tx.setGasPayment(gasPayment);
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

  // Sponsored submit signed by an ARBITRARY @mysten/sui Signer — used by The Room's
  // Ed25519 messaging delegate (it holds no gas, so this is sponsored-only, no wallet
  // fallback). Same Onara path as submit(); the sponsor pays gas, the delegate signs the tx.
  const submitAs = useCallback(
    async (as: Signer, build: TxFactory): Promise<SubmitResult> => {
      const s = sponsor ?? (await getSponsorStatus());
      if (!s) throw new Error('The gas sponsor is unavailable right now — joining the room needs it. Try again in a moment.');
      const address = as.toSuiAddress();
      const tx = await build();
      tx.setSender(address);
      tx.setGasOwner(s.address);
      const gasPayment = await pickSponsorGasPayment(s.address);
      if (gasPayment) tx.setGasPayment(gasPayment);
      const bytes = await tx.build({ client: grpc });
      const signed = await as.signTransaction(bytes);
      const r = await submitSponsored({ sender: address, txBytes: signed.bytes, txSignature: signed.signature });
      await grpc.waitForTransaction({ digest: r.digest });
      return { digest: r.digest, sponsored: true };
    },
    [sponsor],
  );

  return { submit, submitAs, sponsorReady: !!sponsor, sponsorAddress: sponsor?.address ?? null };
}
