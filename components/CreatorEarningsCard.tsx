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
  creatorRecoveryById,
  creatorRecoveryFromRegistration,
  findCreatorRecoveryForLogin,
  loadCreatorPasskey,
  passkeyFromStored,
  storeCreatorPasskey,
  waitForCreatorRecovery,
  zkLoginPublicIdentifierForAddress,
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
        // If an older setup attempt registered with malformed zkLogin bytes, reuse its saved
        // credential rather than asking the user to create yet another passkey. The corrected
        // controller below is derived from that same passkey plus the verified zkLogin key.
        const stored = loadCreatorPasskey(account.address);
        const passkey = stored?.login === account.address.toLowerCase()
          ? passkeyFromStored(stored)
          : await PasskeyKeypair.getPasskeyInstance(creatorPasskeyProvider());
        const registrationArgs = {
          login: account.address,
          zkLoginPublicIdentifier: Uint8Array.from(account.publicKey),
          passkeyPublicKey: passkey.getPublicKey().toRawBytes(),
        };
        const registration = buildRegisterCreatorRecoveryTx(registrationArgs);
        // Setup is idempotent. A previous finalization may already have succeeded while the
        // global recovery index was still stale; in that case its derived BuilderCode exists and
        // a second create would abort with EObjectAlreadyExists. Detect it before asking for
        // another signature and reconstruct enough of the verified profile to render/claim now.
        const existingCode = await findCreatorCode(client, registration.controller.toSuiAddress());
        if (existingCode) {
          profile = {
            objectId: '',
            controller: registration.controller.toSuiAddress().toLowerCase(),
            login: account.address.toLowerCase(),
            builderCode: existingCode,
            zkLoginPublicIdentifier: zkLoginPublicIdentifierForAddress(
              registrationArgs.zkLoginPublicIdentifier,
              account.address,
            ),
            passkeyPublicKey: registrationArgs.passkeyPublicKey,
          };
          setRecovery(profile);
          setCodeId(existingCode);
          setMicro(await claimableFeesMicro(client, existingCode));
          toast('Creator mode is already ready');
          return;
        }
        // useSmartSubmit may rebuild after a sponsor failure; return a clean transaction each time.
        const registered = await submit(() => buildRegisterCreatorRecoveryTx(registrationArgs).transaction);
        storeCreatorPasskey(account.address, registration.controller.toSuiAddress(), passkey);
        // Read the created object from the confirmed transaction first. Unlike the global type
        // index, transaction effects are available immediately and cannot turn a successful
        // wallet signature into a misleading "still indexing" failure.
        profile = await creatorRecoveryFromRegistration(
          registered.digest,
          account.address,
          registration.controller.toSuiAddress(),
        ) ?? await waitForCreatorRecovery(account.address, registration.controller.toSuiAddress());
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
        const liveProfile = await creatorRecoveryById(profile.objectId);
        if (liveProfile?.builderCode) profile = liveProfile;
      }
      toast(legacyCodeId ? 'Creator earnings secured with a recovery passkey' : 'Creator mode ready with passkey recovery');
      if (profile.builderCode) {
        setRecovery(profile);
        setCodeId(profile.builderCode);
        setMicro(await claimableFeesMicro(client, profile.builderCode));
      } else {
        await refresh();
      }
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
              Make the call. Earn when people act.
            </h2>
            <p className="mt-2 max-w-[62ch] text-pretty text-[12px] leading-relaxed text-gray-400 sm:text-[13px]">
              Share a prediction card. When someone bets from it, your creator fee lands in a balance
              only you control.
            </p>
            <ul className="mt-4 flex flex-col gap-2 font-mono text-[9px] uppercase tracking-[0.11em] text-gray-500 min-[540px]:flex-row min-[540px]:flex-wrap min-[540px]:gap-x-5">
              <li className="flex items-center gap-2"><span aria-hidden="true" className="h-1 w-1 bg-vermilion/70" />Earn per attributed bet</li>
              <li className="flex items-center gap-2"><span aria-hidden="true" className="h-1 w-1 bg-vermilion/70" />Claim to your wallet</li>
              <li className="flex items-center gap-2"><span aria-hidden="true" className="h-1 w-1 bg-vermilion/70" />{socialWallet ? 'Recover with Face ID' : 'Owned by your wallet'}</li>
            </ul>
          </div>

          <div className="relative sm:min-w-[220px]">
            <button
              onClick={mint}
              disabled={busy}
              className="btn btn-primary min-h-12 w-full px-6 text-[13px] shadow-[0_12px_32px_-16px_rgba(224,77,38,0.9)] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:min-w-[220px]"
              data-cursor="hover"
            >
              <span>{busy ? 'Setting up…' : 'Turn on creator mode'}</span>
              {!busy && <span aria-hidden="true">→</span>}
            </button>
            <p className="mt-2 text-center font-mono text-[9px] leading-relaxed text-gray-500">
              {socialWallet ? 'One-time setup · Face ID protected' : 'One-time setup · wallet owned'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const hasEarnings = micro != null && micro > 0n;
  const recoveryLabel = recovery?.builderCode
    ? 'Google + passkey'
    : socialWallet
      ? 'Google login'
      : 'Wallet signature';

  return (
    <section
      id="creator-mode"
      data-theme="dark"
      aria-labelledby="creator-earnings-title"
      className="rounded-[30px] bg-[radial-gradient(circle_at_8%_0%,rgba(224,77,38,0.38),rgba(255,255,255,0.09)_34%,rgba(255,255,255,0.035)_72%)] p-px shadow-[0_28px_80px_-48px_rgba(224,77,38,0.72)]"
    >
      <div className="relative overflow-hidden rounded-[29px] bg-[#080706] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:px-8 sm:py-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-vermilion/[0.055]" />
        <div aria-hidden="true" className="pointer-events-none absolute right-16 top-7 h-1 w-1 rounded-full bg-vermilion shadow-[32px_17px_0_rgba(224,77,38,0.45),70px_-2px_0_rgba(224,77,38,0.28),104px_28px_0_rgba(224,77,38,0.2)]" />

        <header className="relative flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-vermilion/[0.12] font-display text-[11px] font-[700] text-vermilion ring-1 ring-inset ring-vermilion/25">
              YC
            </span>
            <div>
              <h2 id="creator-earnings-title" className="font-display text-[13px] font-[650] tracking-[-0.02em] text-white">
                Creator ledger
              </h2>
              <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-white/35">Protocol-paid · owner controlled</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a
              href="/creator/studio"
              className="group/studio inline-flex min-h-9 items-center gap-2 rounded-full bg-vermilion py-2 pl-4 pr-2 font-display text-[10px] font-[650] text-white shadow-[0_12px_28px_-16px_rgba(224,77,38,0.95)] transition-[background-color,transform] duration-300 hover:bg-vermilion-d active:scale-[0.98]"
            >
              <span>Create a card</span>
              <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-white/15 transition-transform duration-300 group-hover/studio:translate-x-0.5">→</span>
            </a>
            <a
              href={`https://suiscan.xyz/testnet/object/${codeId}`}
              target="_blank"
              rel="noreferrer"
              className="group/code inline-flex items-center gap-2 rounded-full bg-white/[0.045] py-1.5 pl-3 pr-1.5 font-mono text-[9px] text-white/45 ring-1 ring-inset ring-white/[0.07] transition-[background-color,color] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/[0.08] hover:text-white/75"
            >
              <span>{codeId.slice(0, 8)}…{codeId.slice(-4)}</span>
              <span aria-hidden="true" className="grid h-6 w-6 place-items-center rounded-full bg-white/[0.07] text-[10px] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/code:-translate-y-px group-hover/code:translate-x-px">↗</span>
            </a>
          </div>
        </header>

        <div className="relative grid gap-6 py-6 md:grid-cols-[minmax(0,1.45fr)_minmax(270px,0.65fr)] md:items-stretch md:gap-8 sm:py-8">
          <div className="flex min-w-0 flex-col justify-between">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/35">Available to claim</div>
              <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1 tabular-nums">
                <span className="font-display text-[clamp(2.9rem,6vw,5.4rem)] font-[650] leading-[0.92] tracking-[-0.075em] text-white">
                  {micro == null ? '—' : money(micro)}
                </span>
                <span className="pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/30 sm:pb-2">DUSDC</span>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-[0.13em] text-white/40">
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${hasEarnings ? 'bg-profit shadow-[0_0_14px_rgba(52,211,153,0.8)]' : 'bg-vermilion shadow-[0_0_14px_rgba(224,77,38,0.65)]'}`} />
              {hasEarnings ? 'Funds ready for withdrawal' : 'Waiting for the first attributed bet'}
            </div>
          </div>

          <aside className="flex flex-col justify-between rounded-[22px] bg-white/[0.035] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)] ring-1 ring-inset ring-white/[0.055]">
            {hasEarnings ? (
              <>
                <div>
                  <div className="font-display text-lg font-[650] tracking-[-0.035em] text-white">Ready when you are.</div>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/40">Your wallet signs the claim. The protocol pays it directly; Yosuku never takes custody.</p>
                </div>
                <button
                  onClick={claim}
                  disabled={busy}
                  className="group/claim mt-6 flex min-h-12 w-full items-center justify-between rounded-full bg-vermilion py-2 pl-5 pr-2 font-display text-[12px] font-[650] text-white shadow-[0_16px_34px_-18px_rgba(224,77,38,0.95)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-vermilion-d active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                  data-cursor="hover"
                >
                  <span>{busy ? 'Claiming…' : 'Claim earnings'}</span>
                  <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-sm transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/claim:-translate-y-px group-hover/claim:translate-x-1">↗</span>
                </button>
              </>
            ) : (
              <>
                <div>
                  <div className="font-display text-lg font-[650] tracking-[-0.035em] text-white">Your code is live.</div>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/40">Every attributed bet adds its creator fee here automatically.</p>
                </div>
                <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">
                  <div className="flex items-center justify-between gap-4"><span>Code status</span><span className="text-profit">Active</span></div>
                  <div className="flex items-center justify-between gap-4"><span>Next action</span><span className="text-white/60">Share a call</span></div>
                </div>
              </>
            )}
          </aside>
        </div>

        {socialWallet && !recovery?.builderCode && (
          <div className="relative mb-5 flex flex-col gap-3 rounded-[18px] bg-amber-300/[0.055] px-4 py-3 ring-1 ring-inset ring-amber-200/[0.12] sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-[10px] leading-relaxed text-amber-100/60">This older code depends only on Google login. Add a passkey before routing more earnings to it.</p>
            <button onClick={mint} disabled={busy} className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-amber-100/80 underline decoration-amber-200/30 underline-offset-4 transition-opacity duration-500 disabled:opacity-40">
              {busy ? 'Securing…' : recovery ? 'Finish setup' : 'Add recovery'}
            </button>
          </div>
        )}

        <footer className="relative grid grid-cols-1 gap-3 border-t border-white/[0.07] pt-4 sm:grid-cols-3 sm:gap-5">
          {[
            ['Ownership', 'Your creator code'],
            ['Recovery', recoveryLabel],
            ['Settlement', 'Direct on-chain'],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 sm:block">
              <div className="font-mono text-[8px] uppercase tracking-[0.17em] text-white/25">{label}</div>
              <div className="mt-0 font-display text-[10px] font-[550] text-white/60 sm:mt-1">{value}</div>
            </div>
          ))}
        </footer>

        {recovery?.builderCode && (
          <a href="/creator/recover" className="relative mt-4 inline-flex font-mono text-[8px] uppercase tracking-[0.14em] text-white/30 underline decoration-white/15 underline-offset-4 transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white/65">
            Open recovery controls
          </a>
        )}
      </div>
    </section>
  );
}
