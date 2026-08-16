'use client';
// Creator earnings — what your calls have earned, and claiming it.
//
// Shown only to people who actually have a BuilderCode, so it is invisible to everyone else
// rather than being an empty box asking to be understood.
//
// The number here is read straight off chain with `claimable_builder_fees`, and the claim is
// signed by the creator's own wallet. Yosuku never holds this money: `claim_all_builder_fees`
// asserts sender == owner, so we could not pay it out or withhold it even if we wanted to.
// That is the honest version of a creator programme, and it is worth the surface saying so.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { PREDICT624 } from '@/lib/sui/predict624Client';
import { buildClaimCreatorFeesTx, claimableFeesMicro, findCreatorCode } from '@/lib/sui/creatorCode';
import { useToast } from '@/components/Toast';

const money = (micro: bigint) => (Number(micro) / 1e6).toFixed(4);

export default function CreatorEarningsCard() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { toast } = useToast();

  const [codeId, setCodeId] = useState<string | null>(null);
  const [micro, setMicro] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!account?.address) return;
    const id = await findCreatorCode(client, account.address).catch(() => null);
    setCodeId(id);
    if (!id) return;
    const m = await claimableFeesMicro(client, id).catch(() => null);
    if (m != null) setMicro(m);
  }, [account?.address, client]);

  useEffect(() => { void refresh(); }, [refresh]);

  const claim = async () => {
    if (!codeId || !account?.address || busy) return;
    setBusy(true);
    try {
      const tx = buildClaimCreatorFeesTx(codeId, account.address);
      await signAndExecute({ transaction: tx });
      toast('Claimed to your wallet');
      await refresh();
    } catch (e) {
      toast(`Claim failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 140), 'error');
    } finally {
      setBusy(false);
    }
  };

  // No code, no card. A creator surface for someone who is not a creator is just clutter.
  if (!codeId) return null;

  const nothingYet = micro != null && micro === 0n;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500">
          Creator earnings
        </span>
        <a
          href={`https://suiscan.xyz/testnet/object/${codeId}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
        >
          {codeId.slice(0, 10)}…
        </a>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-display font-[700] text-2xl text-white tabular-nums">
            {micro == null ? '—' : money(micro)}{' '}
            <span className="text-sm text-gray-500 font-mono font-normal">DUSDC</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            {nothingYet
              ? 'Nothing yet. Fees land here when someone bets off one of your calls.'
              : 'Earned from bets placed off your calls.'}
          </p>
        </div>
        <button
          onClick={claim}
          disabled={busy || !micro || micro === 0n}
          className="btn btn-primary shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          data-cursor="hover"
        >
          {busy ? 'Claiming…' : 'Claim'}
        </button>
      </div>

      <p className="text-[10px] text-gray-600 mt-3 leading-relaxed">
        Paid by the protocol to your own code. Only your wallet can claim it, so Yosuku never
        holds it and cannot hold it back.
      </p>
    </div>
  );
}
