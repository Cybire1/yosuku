'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSignPersonalMessage,
  useSuiClient,
} from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import { getListing, hasAccess, buildPurchaseTx, type Listing } from '@/lib/sui/marketplace';
import { decryptPlaybook } from '@/lib/sui/marketplaceDecrypt';

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;
type Step = 'idle' | 'buying' | 'bought' | 'unlocking' | 'unlocked' | 'error';

export default function ListingDetail() {
  const { id } = useParams<{ id: string }>();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();
  const suiClient = useSuiClient();

  const [listing, setListing] = useState<Listing | null>(null);
  const [owns, setOwns] = useState(false);
  const [step, setStep] = useState<Step>('idle');
  const [lessons, setLessons] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const l = await getListing(id);
    setListing(l);
    if (l && address) setOwns(await hasAccess(id, address));
  }, [id, address]);

  useEffect(() => { refresh(); }, [refresh]);

  async function buy() {
    if (!listing || !address) return;
    setStep('buying'); setError(null);
    try {
      const tx = await buildPurchaseTx(address, listing);
      await signAndExecute({ transaction: tx });
      setStep('bought');
      setOwns(true);
      refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e)); setStep('error');
    }
  }

  async function unlock() {
    if (!listing || !address) return;
    setStep('unlocking'); setError(null);
    try {
      // Native client-side Seal decrypt: your wallet authorizes a session key,
      // the key servers enforce the on-chain seal_approve gate, the playbook
      // decrypts in your browser. No server holds the strategy.
      const out = await decryptPlaybook({
        listing, address, suiClient,
        signPersonalMessage: (message) => signPersonalMessage({ message }),
      });
      setLessons(out);
      setStep('unlocked');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e)); setStep('error');
    }
  }

  if (!listing) {
    return (
      <div className="min-h-screen relative">
        <Marquee /><Header /><GrainOverlay />
        <main className="container pt-[140px] pb-24 font-mono text-sm text-gray-500">Loading…</main>
      </div>
    );
  }

  const m = listing.manifest;

  return (
    <div className="min-h-screen relative">
      <Marquee /><Header /><GrainOverlay />
      <main className="container pt-[140px] pb-24">
        <Link href="/market" className="font-mono text-[11px] uppercase tracking-[0.18em] text-gray-500 hover:text-white transition-colors">
          ← Strategy market
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10 mt-6">
          {/* left — the strategy + provenance */}
          <div>
            <h1 className="font-display text-3xl md:text-5xl font-extrabold tracking-tight mb-2">{listing.title}</h1>
            <p className="font-mono text-[12px] text-gray-500 mb-8">
              by {short(listing.strategist)}{m?.agent ? ` · ${m.agent}` : ''}
            </p>

            {/* verifiable track record */}
            <div className="border border-white/[0.06] rounded-2xl p-7 mb-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-4">
                Verifiable track record
              </div>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <Big label="Trades" value={m?.realized?.trades?.toString() ?? '—'} />
                <Big label="Lessons" value={m?.lessonCount?.toString() ?? '—'} />
                <Big label="Open cost" value={m?.realized?.openCost ?? '—'} />
              </div>
              {m?.provenance?.length ? (
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-600 mb-2">
                    Backed by on-chain trades — verify each one
                  </div>
                  <div className="space-y-1.5">
                    {m.provenance.map((d) => (
                      <a
                        key={d}
                        href={`https://suiscan.xyz/testnet/tx/${d}`}
                        target="_blank" rel="noreferrer"
                        className="block font-mono text-xs text-gray-400 hover:text-vermilion transition-colors truncate"
                      >
                        ↗ {d}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
              {m?.realized?.note ? <p className="text-gray-500 text-xs mt-4">{m.realized.note}</p> : null}
            </div>

            <div className="border border-white/[0.06] rounded-2xl p-7">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-3">
                What you&apos;re buying
              </div>
              <p className="text-gray-400 text-sm leading-relaxed">
                The full playbook — every distilled lesson — Seal-encrypted on Walrus. Your purchase
                registers you in the listing&apos;s on-chain access policy; the Seal key servers then
                release decryption only to your wallet. The strategist&apos;s edge never leaves the
                enclave of the chain&apos;s own permission check.
              </p>
            </div>
          </div>

          {/* right — buy / unlock */}
          <div className="lg:sticky lg:top-[120px] self-start">
            <div className="border border-white/[0.1] rounded-2xl p-7 bg-black/50">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-1">Access</div>
              <div className="font-display text-4xl font-extrabold mb-1">{listing.priceDusdc} <span className="text-lg text-gray-400">DUSDC</span></div>
              <div className="font-mono text-[11px] text-gray-500 mb-6">
                {listing.accessMs === 0 ? 'Perpetual access' : `${Math.round(listing.accessMs / 3_600_000)}h access`} · {listing.totalSales} sold
              </div>

              {!address ? (
                <div className="font-mono text-xs text-gray-500 text-center py-3">Connect a wallet to buy</div>
              ) : owns || step === 'unlocked' ? (
                <UnlockBlock step={step} lessons={lessons} onUnlock={unlock} />
              ) : (
                <button
                  onClick={buy}
                  disabled={step === 'buying'}
                  className="w-full bg-white text-black font-semibold rounded-full py-3 hover:scale-[1.02] active:scale-[0.97] transition-transform disabled:opacity-50"
                >
                  {step === 'buying' ? 'Confirming…' : `Buy for ${listing.priceDusdc} DUSDC`}
                </button>
              )}

              {error ? <p className="font-mono text-[11px] text-rose-400 mt-4 break-words">{error}</p> : null}

              <div className="mt-6 pt-5 border-t border-white/[0.06] space-y-2">
                <Row k="Encryption" v="Seal · threshold 2-of-n" />
                <Row k="Storage" v="Walrus" />
                <Row k="Paywall" v="on-chain seal_approve" />
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function UnlockBlock({ step, lessons, onUnlock }: { step: Step; lessons: string[] | null; onUnlock: () => void }) {
  if (step === 'unlocked' && lessons) {
    return (
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-400 mb-3">✓ unlocked — your playbook</div>
        <div className="space-y-3">
          {lessons.map((l, i) => (
            <div key={i} className="border border-emerald-400/20 bg-emerald-400/[0.04] rounded-xl p-4 text-sm text-gray-200 leading-relaxed">{l}</div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-400 mb-3">✓ access confirmed on-chain</div>
      <button
        onClick={onUnlock}
        disabled={step === 'unlocking'}
        className="w-full border border-emerald-400/40 text-emerald-300 font-semibold rounded-full py-3 hover:bg-emerald-400/[0.06] transition-colors disabled:opacity-50"
      >
        {step === 'unlocking' ? 'Decrypting via Seal…' : 'Unlock the playbook'}
      </button>
      <p className="font-mono text-[10px] text-gray-600 mt-2 text-center">sign once — your wallet proves access to the key servers</p>
    </div>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-gray-600 mb-1">{label}</div>
      <div className="font-mono text-lg text-white">{value}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-gray-600">{k}</span>
      <span className="font-mono text-[11px] text-gray-400">{v}</span>
    </div>
  );
}
