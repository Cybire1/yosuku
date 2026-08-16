'use client';

import { useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { claimableFeesMicro, buildClaimCreatorFeesTx } from '@/lib/sui/creatorCode';
import { creatorController, recoverCreatorPasskey, type CreatorRecoveryProfile } from '@/lib/sui/creatorRecovery';
import { useCreatorMultisigSubmit } from '@/lib/sui/useCreatorMultisigSubmit';
import type { PasskeyKeypair } from '@mysten/sui/keypairs/passkey';

const short = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;
const validAddress = (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value);

export default function RecoverCreatorPage() {
  const client = useSuiClient();
  const { submitWithRecovery } = useCreatorMultisigSubmit();
  const [profile, setProfile] = useState<CreatorRecoveryProfile | null>(null);
  const [passkey, setPasskey] = useState<PasskeyKeypair | null>(null);
  const [claimable, setClaimable] = useState<bigint | null>(null);
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState<'' | 'find' | 'claim'>('');
  const [message, setMessage] = useState('');

  const find = async () => {
    if (busy) return;
    setBusy('find'); setMessage('');
    try {
      const recovered = await recoverCreatorPasskey();
      if (!recovered.profile.builderCode) throw new Error('This creator recovery was never finalized');
      setProfile(recovered.profile);
      setPasskey(recovered.keypair);
      setClaimable(await claimableFeesMicro(client, recovered.profile.builderCode));
      setMessage('Creator account recovered. Enter any Sui address to receive the claim.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally { setBusy(''); }
  };

  const claim = async () => {
    if (!profile?.builderCode || !passkey || busy) return;
    if (!validAddress(destination)) { setMessage('Enter a complete Sui destination address.'); return; }
    setBusy('claim'); setMessage('');
    try {
      const controller = creatorController(profile.zkLoginPublicIdentifier, profile.passkeyPublicKey);
      await submitWithRecovery(
        buildClaimCreatorFeesTx(profile.builderCode, destination.toLowerCase()),
        controller,
        passkey,
      );
      setClaimable(0n);
      setMessage('Claimed successfully to the destination wallet.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally { setBusy(''); }
  };

  return (
    <div className="min-h-screen">
      <Header />
      <main className="container max-w-2xl pt-[110px] pb-24">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-500 mb-4">Creator recovery</div>
        <h1 className="font-display text-3xl sm:text-5xl font-[700] leading-tight text-white">
          Recover earnings without social login.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-gray-400">
          Your passkey can independently control the creator account. Two native passkey checks
          identify its public key; no Google session, seed phrase, or Yosuku-held secret is used.
        </p>

        <div className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
          {!profile ? (
            <button onClick={find} disabled={!!busy} className="btn btn-primary disabled:opacity-40">
              {busy === 'find' ? 'Checking passkey…' : 'Recover with passkey'}
            </button>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-600">Creator controller</div>
                  <div className="mt-1 font-mono text-xs text-gray-300">{short(profile.controller)}</div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-600">Claimable</div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {claimable == null ? '—' : (Number(claimable) / 1e6).toFixed(4)} DUSDC
                  </div>
                </div>
              </div>
              <label className="block">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-600">Send earnings to</span>
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value.trim())}
                  placeholder="0x…"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-3 font-mono text-xs text-white outline-none focus:border-white/25"
                />
              </label>
              <button onClick={claim} disabled={!!busy || !claimable || claimable === 0n} className="btn btn-primary disabled:opacity-40">
                {busy === 'claim' ? 'Claiming…' : 'Claim with passkey'}
              </button>
            </div>
          )}
          {message && <p className="mt-4 text-xs leading-relaxed text-gray-400">{message}</p>}
        </div>

        <p className="mt-5 text-[11px] leading-relaxed text-gray-600">
          Recovery metadata is public on Sui and contains no secret. Your passkey remains in your
          device or synced password manager; Yosuku cannot use it.
        </p>
      </main>
      <Footer />
    </div>
  );
}
