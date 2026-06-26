'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Check, Loader2, ShieldCheck, Twitter, KeyRound, Wallet, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCurrentAccount, useSuiClient, useSignPersonalMessage, ConnectButton } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import {
  fetchClaimAccount, unsealAccountKey, recoverFundsToWallet, type ClaimAccount,
} from '@/lib/sui/claim';

const BOT = 'yosuku0';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

type Step = 'connect' | 'prove' | 'recover' | 'done';

export default function ClaimPage() {
  const router = useRouter();
  const account = useCurrentAccount();
  const wallet = account?.address ?? null;
  const suiClient = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [acct, setAcct] = useState<ClaimAccount | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ amount: number; digest: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const step: Step = !wallet ? 'connect' : result ? 'done' : acct?.owner && acct.owner === wallet ? 'recover' : 'prove';

  // Poll the relay for this wallet's claimable account (appears once the proof tweet is seen + bound).
  const check = useCallback(async () => {
    if (!wallet) return;
    try {
      const a = await fetchClaimAccount(wallet);
      if (a) setAcct(a);
    } catch { /* keep polling */ }
  }, [wallet]);

  useEffect(() => {
    if (!wallet || result) { setPolling(false); return; }
    check();
    setPolling(true);
    pollRef.current = setInterval(check, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [wallet, result, check]);

  const tweetText = wallet ? `@${BOT} claim ${wallet}` : '';
  const tweetHref = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  async function recover() {
    if (!acct || !wallet) return;
    setBusy(true); setErr(null);
    try {
      const key = await unsealAccountKey({
        suiClient, walletAddress: wallet, sealIdHex: acct.sealId, blobId: acct.blobId, signPersonalMessage,
      });
      const amountMist = BigInt(Math.round(acct.balanceDusdc * 1e6));
      if (amountMist <= 0n) throw new Error('This account has no recoverable balance.');
      const { digest } = await recoverFundsToWallet({ suiClient, accountKeyBech32: key, toAddress: wallet, amountMist });
      setResult({ amount: acct.balanceDusdc, digest });
    } catch (e: any) {
      setErr(e?.message || 'Recovery failed. Make sure your wallet is the one bound to your handle.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#070708] text-white" style={{ fontFamily: 'var(--font-sora)' }}>
      <Header />
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.04]" style={{ backgroundImage: GRAIN }} />
      <main className="relative z-10 mx-auto max-w-2xl px-5 pb-28 pt-10">
        <button onClick={() => router.push('/')} className="mb-8 inline-flex items-center gap-2 text-sm text-white/50 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {/* hero */}
        <div className="mb-3 font-mono text-xs tracking-[0.35em] text-[#E04D26]">TWEET-TO-BET · CLAIM</div>
        <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          Claim your account.
        </h1>
        <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/55">
          We funded you from a tweet and sealed the key — only you can open it. Prove your X handle, and
          we'll release the funds to <span className="text-white/80">your</span> wallet. The relay can't:
          it threw the key away on purpose.
        </p>

        {/* stepper */}
        <div className="mt-8 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-white/40">
          {(['connect', 'prove', 'recover'] as Step[]).map((s, i) => {
            const order: Step[] = ['connect', 'prove', 'recover', 'done'];
            const active = order.indexOf(step) >= order.indexOf(s);
            return (
              <div key={s} className="flex items-center gap-2">
                <span className={active ? 'text-[#34D399]' : ''}>{i + 1}. {s}</span>
                {i < 2 && <span className="text-white/20">→</span>}
              </div>
            );
          })}
        </div>

        <div className="mt-6 space-y-4">
          {/* STEP 1 — connect */}
          <Card active={step === 'connect'} done={step !== 'connect'} icon={<Wallet className="h-4 w-4" />} title="Connect the wallet you want your funds in">
            {!wallet ? (
              <div className="mt-3"><ConnectButton /></div>
            ) : (
              <div className="mt-2 font-mono text-sm text-[#34D399]">{short(wallet)} connected</div>
            )}
          </Card>

          {/* STEP 2 — prove handle */}
          {wallet && step !== 'done' && (
            <Card active={step === 'prove'} done={step === 'recover'} icon={<Twitter className="h-4 w-4" />} title="Prove your X handle">
              {step === 'recover' ? (
                <div className="mt-2 font-mono text-sm text-[#34D399]">handle verified · bound to {short(wallet)}</div>
              ) : (
                <>
                  <p className="mt-2 text-sm text-white/55">
                    Post this from the X account that placed the bet. We watch for it and bind the account to your wallet.
                  </p>
                  <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-sm text-white/85">
                    {tweetText}
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <a href={tweetHref} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90">
                      Post on X <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {polling && (
                      <span className="inline-flex items-center gap-2 text-xs text-white/45">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> watching for your tweet…
                      </span>
                    )}
                  </div>
                </>
              )}
            </Card>
          )}

          {/* STEP 3 — recover */}
          {step === 'recover' && (
            <Card active icon={<KeyRound className="h-4 w-4" />} title="Recover your funds">
              <p className="mt-2 text-sm text-white/55">
                Your wallet signs once to unseal the key (in your browser), then we sweep the balance to you.
              </p>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-bold text-white">{acct!.balanceDusdc.toFixed(2)}</span>
                <span className="text-sm text-white/50">DUSDC recoverable</span>
              </div>
              <button onClick={recover} disabled={busy}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#E04D26] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#B83A1B] disabled:opacity-60">
                {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> unsealing…</> : <><ShieldCheck className="h-4 w-4" /> Recover {acct!.balanceDusdc.toFixed(2)} DUSDC</>}
              </button>
              {err && <p className="mt-3 text-sm text-[#FB7185]">{err}</p>}
            </Card>
          )}

          {/* DONE */}
          {step === 'done' && result && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-[#34D399]/30 bg-[#34D399]/[0.06] p-6">
              <div className="flex items-center gap-2 text-[#34D399]"><Check className="h-5 w-5" /><span className="font-semibold">Claimed.</span></div>
              <p className="mt-2 text-sm text-white/70">
                {result.amount.toFixed(2)} DUSDC recovered to {short(wallet!)}. It was always yours — now you hold the keys.
              </p>
              <a href={`https://suiscan.xyz/testnet/tx/${result.digest}`} target="_blank" rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 font-mono text-xs text-white/50 hover:text-white">
                {short(result.digest)} <ExternalLink className="h-3 w-3" />
              </a>
            </motion.div>
          )}
        </div>

        <p className="mt-10 text-center font-mono text-[11px] leading-relaxed text-white/30">
          The relay never held a usable key. Unsealing is gated on-chain by the wallet you bind — proof, not promise.
        </p>
      </main>
    </div>
  );
}

function Card({ active, done, icon, title, children }: {
  active: boolean; done?: boolean; icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border p-5 transition ${active ? 'border-white/20 bg-white/[0.03]' : done ? 'border-white/10 bg-transparent' : 'border-white/10 bg-transparent opacity-60'}`}>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${done ? 'border-[#34D399]/40 text-[#34D399]' : 'border-white/15 text-white/60'}`}>
          {done ? <Check className="h-4 w-4" /> : icon}
        </span>
        <h2 className="text-[15px] font-semibold text-white/90">{title}</h2>
      </div>
      {children}
    </div>
  );
}
