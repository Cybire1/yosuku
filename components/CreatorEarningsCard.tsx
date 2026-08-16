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
      <section
        id="creator-mode"
        aria-label="Checking creator account"
        className="overflow-hidden rounded-[22px] border border-white/[0.07] bg-white/[0.02] px-5 py-5 sm:px-7 sm:py-6"
      >
        <div className="animate-pulse">
          <div className="h-2.5 w-24 rounded bg-white/10" />
          <div className="mt-4 h-6 w-56 max-w-full rounded bg-white/[0.06]" />
          <div className="mt-3 h-3 w-80 max-w-full rounded bg-white/[0.05]" />
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section id="creator-mode" className="rounded-[22px] border border-red-400/15 bg-red-400/[0.03] p-5 sm:p-6">
        <div className="text-[12px] text-red-200/70">Creator account could not be loaded.</div>
        <button onClick={() => void refresh()} className="mt-2 text-[11px] text-gray-400 hover:text-white">Try again</button>
      </section>
    );
  }

  // Not a creator yet: offer it once, quietly, rather than hiding the whole programme behind
  // a link nobody finds.
  if (!codeId) {
    return (
      <section
        id="creator-mode"
        aria-labelledby="creator-mode-title"
        className="group relative overflow-hidden rounded-[22px] border border-vermilion/25 bg-vermilion/[0.045] px-5 py-5 sm:px-7 sm:py-6"
      >
        <div aria-hidden="true" className="absolute -right-14 -top-20 h-48 w-48 rounded-full border border-vermilion/10 transition-transform duration-500 group-hover:scale-105" />
        <div aria-hidden="true" className="absolute -right-5 -top-10 h-28 w-28 rounded-full border border-vermilion/15" />

        <div className="relative grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-vermilion">
              <span aria-hidden="true" className="h-1.5 w-1.5 bg-vermilion" />
              Creator mode
            </div>
            <h2 id="creator-mode-title" className="max-w-xl text-balance font-display text-xl font-[750] leading-[1.15] tracking-[-0.035em] text-white sm:text-[26px]">
              Your call. Your code. Your earnings.
            </h2>
            <p className="mt-2 max-w-[62ch] text-pretty text-[12px] leading-relaxed text-gray-400 sm:text-[13px]">
              When someone bets from your card, protocol fees accrue directly to a creator code you own.
              Yosuku never holds the payout.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-gray-500">
              <span>Paid on-chain</span>
              <span aria-hidden="true" className="text-vermilion/50">/</span>
              <span>Claim anytime</span>
              <span aria-hidden="true" className="text-vermilion/50">/</span>
              <span>{socialWallet ? 'Passkey recovery' : 'Wallet owned'}</span>
            </div>
          </div>

          <div className="relative sm:min-w-[220px]">
            <button
              onClick={mint}
              disabled={busy}
              className="btn btn-primary min-h-12 w-full px-6 text-[13px] shadow-[0_12px_32px_-16px_rgba(224,77,38,0.9)] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:min-w-[220px]"
              data-cursor="hover"
            >
              <span>{busy ? 'Setting up…' : socialWallet ? 'Set up creator mode' : 'Become a creator'}</span>
              {!busy && <span aria-hidden="true">→</span>}
            </button>
            <p className="mt-2 text-center font-mono text-[9px] leading-relaxed text-gray-500">
              {socialWallet ? 'One Face ID or passkey prompt' : 'One wallet signature'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const nothingYet = micro != null && micro === 0n;

  return (
    <section id="creator-mode" aria-labelledby="creator-earnings-title" className="rounded-[22px] border border-vermilion/20 bg-vermilion/[0.035] p-5 sm:p-6">
      <div className="flex items-baseline justify-between mb-3">
        <span id="creator-earnings-title" className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion">
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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
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
          className="btn btn-primary min-h-11 w-full shrink-0 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
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
    </section>
  );
}
