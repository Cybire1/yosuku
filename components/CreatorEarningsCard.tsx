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
import { useCurrentAccount, useCurrentWallet, useSuiClient } from '@mysten/dapp-kit';
import { isEnokiWallet } from '@mysten/enoki';
import { PasskeyKeypair } from '@mysten/sui/keypairs/passkey';
import { buildClaimCreatorFeesTx, buildCreateCreatorCodeTx, claimableFeesMicro, findCreatorCode } from '@/lib/sui/creatorCode';
import {
  buildFinalizeRecoverableCreatorCodeTx,
  buildRegisterCreatorRecoveryTx,
  creatorController,
  creatorPasskeyProvider,
  findCreatorRecoveryForLogin,
  storeCreatorPasskey,
  waitForCreatorRecovery,
  type CreatorRecoveryProfile,
} from '@/lib/sui/creatorRecovery';
import { useCreatorMultisigSubmit } from '@/lib/sui/useCreatorMultisigSubmit';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { useToast } from '@/components/Toast';

const money = (micro: bigint) => (Number(micro) / 1e6).toFixed(4);

export default function CreatorEarningsCard() {
  const account = useCurrentAccount();
  const { currentWallet } = useCurrentWallet();
  const client = useSuiClient();
  const { submit } = useSmartSubmit();
  const { submitWithWallet } = useCreatorMultisigSubmit();
  const { toast } = useToast();

  const [codeId, setCodeId] = useState<string | null>(null);
  const [legacyCodeId, setLegacyCodeId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<CreatorRecoveryProfile | null>(null);
  const [micro, setMicro] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const socialWallet = !!currentWallet && isEnokiWallet(currentWallet);

  const refresh = useCallback(async () => {
    if (!account?.address) { setLoading(false); return; }
    setLoadError('');
    const [protectedProfile, directCode] = await Promise.all([
      findCreatorRecoveryForLogin(account.address),
      findCreatorCode(client, account.address),
    ]);
    const id = protectedProfile?.builderCode ?? directCode;
    setRecovery(protectedProfile);
    setLegacyCodeId(directCode);
    setCodeId(id);
    setMicro(id ? await claimableFeesMicro(client, id) : null);
    setLoading(false);
  }, [account?.address, client]);

  useEffect(() => {
    setLoading(true);
    void refresh().catch((e) => {
      setLoadError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    });
  }, [refresh]);

  const claim = async () => {
    if (!codeId || !account?.address || busy) return;
    setBusy(true);
    try {
      if (recovery?.builderCode === codeId) {
        await submitWithWallet(
          buildClaimCreatorFeesTx(codeId, account.address),
          creatorController(recovery.zkLoginPublicIdentifier, recovery.passkeyPublicKey),
        );
      } else {
        await submit(() => buildClaimCreatorFeesTx(codeId, account.address));
      }
      toast('Claimed to your wallet');
      await refresh();
    } catch (e) {
      toast(`Claim failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 140), 'error');
    } finally {
      setBusy(false);
    }
  };

  const mint = async () => {
    if (busy || !account?.address) return;
    setBusy(true);
    try {
      if (!socialWallet) {
        // A normal wallet already has its own portable recovery method, so direct ownership is
        // correct. The signer remains the immutable fee owner.
        await submit(() => buildCreateCreatorCodeTx());
        toast('Creator code minted — it is yours, not ours');
        await refresh();
        return;
      }

      let profile = recovery;
      if (!profile) {
        // One native Face ID / Touch ID / Windows Hello prompt. This passkey is an independent
        // 1-of-2 recovery signer; it never leaves the user's password manager/device ecosystem.
        const passkey = await PasskeyKeypair.getPasskeyInstance(creatorPasskeyProvider());
        const registrationArgs = {
          login: account.address,
          zkLoginPublicIdentifier: Uint8Array.from(account.publicKey),
          passkeyPublicKey: passkey.getPublicKey().toRawBytes(),
        };
        const registration = buildRegisterCreatorRecoveryTx(registrationArgs);
        // useSmartSubmit may rebuild after a sponsor failure; return a clean transaction each time.
        await submit(() => buildRegisterCreatorRecoveryTx(registrationArgs).transaction);
        storeCreatorPasskey(account.address, registration.controller.toSuiAddress(), passkey);
        profile = await waitForCreatorRecovery(account.address, registration.controller.toSuiAddress());
      }

      if (!profile.builderCode) {
        // If this is a legacy direct zkLogin code, sweep it before future attribution moves to
        // the recovered controller. Nothing is left behind at the old immutable address.
        if (legacyCodeId && micro && micro > 0n) {
          await submit(() => buildClaimCreatorFeesTx(legacyCodeId, account.address));
        }
        const controller = creatorController(profile.zkLoginPublicIdentifier, profile.passkeyPublicKey);
        await submitWithWallet(
          buildFinalizeRecoverableCreatorCodeTx({ recoveryId: profile.objectId, controller }),
          controller,
        );
      }
      toast(legacyCodeId ? 'Creator earnings secured with a recovery passkey' : 'Creator mode ready with passkey recovery');
      await refresh();
    } catch (e) {
      toast(`Could not mint: ${e instanceof Error ? e.message : String(e)}`.slice(0, 140), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 text-[12px] text-gray-500">
        Checking creator account…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-400/15 bg-red-400/[0.03] p-4">
        <div className="text-[12px] text-red-200/70">Creator account could not be loaded.</div>
        <button onClick={() => void refresh()} className="mt-2 text-[11px] text-gray-400 hover:text-white">Try again</button>
      </div>
    );
  }

  // Not a creator yet: offer it once, quietly, rather than hiding the whole programme behind
  // a link nobody finds.
  if (!codeId) {
    return (
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">
          Post calls, get paid
        </div>
        <div className="flex items-end justify-between gap-4">
          <p className="text-[12px] text-gray-400 leading-relaxed max-w-[380px]">
            {socialWallet
              ? 'Create a code protected by both your Google login and a recovery passkey. Either one can claim your earnings.'
              : 'Mint a creator code and every attributed bet pays you. Your wallet remains its permanent owner.'}
          </p>
          <button
            onClick={mint}
            disabled={busy}
            className="btn btn-secondary shrink-0 disabled:opacity-40"
            data-cursor="hover"
          >
            {busy ? 'Setting up…' : socialWallet ? 'Set up creator mode' : 'Become a creator'}
          </button>
        </div>
      </div>
    );
  }

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

      {socialWallet && !recovery?.builderCode && (
        <div className="mb-3 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-[11px] leading-relaxed text-amber-100/70">
          This older code depends only on your Google login. Secure future earnings with a passkey before sharing more calls.
          <button onClick={mint} disabled={busy} className="ml-2 underline underline-offset-2 disabled:opacity-40">
            {busy ? 'Securing…' : recovery ? 'Finish setup' : 'Secure now'}
          </button>
        </div>
      )}

      {recovery?.builderCode && (
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300/70">
          Recovery protected · zkLogin + passkey
        </div>
      )}

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
        Paid by the protocol to your own code. Yosuku never holds it. Recovery-protected codes
        remain claimable with your passkey even if social login stops working.
        {recovery?.builderCode && (
          <> <a href="/creator/recover" className="text-gray-400 hover:text-white underline underline-offset-2">Open recovery</a>.</>
        )}
      </p>
    </div>
  );
}
