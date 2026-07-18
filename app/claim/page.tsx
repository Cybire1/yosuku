'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import { useCurrentAccount, useSuiClient, useSignPersonalMessage, ConnectButton } from '@mysten/dapp-kit';
import {
  fetchClaimAccount, unsealAccountKey, recoverFundsToWallet, type ClaimAccount,
} from '@/lib/sui/claim';
import Header from '@/components/Header';

// Theme-aware tokens (follow the site's dark/light toggle via data-theme on <html>).
const BG = 'var(--bg)';               // #050505 dark · #F4EEE3 cream light
const FG = 'var(--white)';            // foreground — flips to ink on light
const MUTE = 'var(--gray-400)';
const VERM = 'var(--vermilion)';
const GREEN = 'var(--profit)';
const LIGHT = '#FBF7EE';              // fixed light label (for vermilion / inverted fills)
const HAIR = 'color-mix(in srgb, var(--white) 12%, transparent)';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
type XIdentity = { handle: string; authorId: string; account: ClaimAccount | null };

function ClaimInner() {
  const params = useSearchParams();
  const account = useCurrentAccount();
  const wallet = account?.address ?? null;
  const suiClient = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [me, setMe] = useState<XIdentity | null>(null);
  const [acct, setAcct] = useState<ClaimAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [binding, setBinding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ amount: number; digest: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // After the X OAuth round-trip we land back with ?x=1 — read who signed in + what they have waiting.
  useEffect(() => {
    if (params.get('x') !== '1') return;
    (async () => {
      try {
        const r = await fetch('/api/claim/x/me', { cache: 'no-store' });
        if (r.ok) { const j = await r.json(); if (j.handle) { setMe(j); setAcct(j.account ?? null); } }
      } catch { /* stay signed out */ }
    })();
  }, [params]);

  // Once both X + wallet are present, ask the relay to bind (set_owner) so the funds unlock to this wallet.
  // Surfaces the real reason on failure (esp. "already linked to another wallet") and bounds the poll,
  // so a failed bind never spins on "linking…" forever with no message.
  const bind = useCallback(async () => {
    if (!me || !wallet) return;
    setBinding(true); setErr(null);
    try {
      const r = await fetch('/api/claim/bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet }) });
      const j = await r.json().catch(() => ({} as { ok?: boolean; reason?: string; boundWallet?: string }));
      if (!r.ok || j?.ok === false) {
        setBinding(false);
        if (j?.reason === 'already_claimed_other' && j?.boundWallet) {
          setErr(`This account is already linked to ${short(j.boundWallet)}. Connect that wallet to claim your winnings.`);
        } else if (j?.reason === 'sign in with X first') {
          setErr('Your sign-in expired. Sign in with X again to claim.');
        } else {
          setErr(typeof j?.reason === 'string' && j.reason ? j.reason : 'Could not link this wallet. Please try again.');
        }
        return;
      }
    } catch { /* network hiccup — fall through to the bounded poll in case it landed */ }
    let tries = 0;
    const check = async () => {
      tries += 1;
      try { const a = await fetchClaimAccount(wallet); if (a && a.owner === wallet) { setAcct(a); setBinding(false); if (pollRef.current) clearInterval(pollRef.current); return; } }
      catch { /* keep polling */ }
      if (tries >= 12) { // ~36s, then stop and say so
        setBinding(false);
        if (pollRef.current) clearInterval(pollRef.current);
        setErr('Linking is taking longer than expected. Refresh and reconnect the same wallet to try again.');
      }
    };
    check();
    pollRef.current = setInterval(check, 3000);
  }, [me, wallet]);

  useEffect(() => {
    if (me && wallet && !(acct?.owner === wallet)) bind();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [me, wallet, acct?.owner, bind]);

  async function claim() {
    if (!acct || !wallet) return;
    setBusy(true); setErr(null);
    try {
      const key = await unsealAccountKey({ suiClient, walletAddress: wallet, sealIdHex: acct.sealId, blobId: acct.blobId, signPersonalMessage });
      const amountMist = BigInt(Math.round(acct.balanceDusdc * 1e6));
      if (amountMist <= BigInt(0)) throw new Error('This account has no balance to claim right now.');
      const { digest } = await recoverFundsToWallet({ suiClient, accountKeyBech32: key, toAddress: wallet, amountMist });
      setResult({ amount: acct.balanceDusdc, digest });
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong. Make sure this is the wallet you connected.');
    } finally { setBusy(false); }
  }

  const amount = acct?.balanceDusdc ?? me?.account?.balanceDusdc ?? null;
  const ready = !!(acct?.owner === wallet);
  const stage: 'in' | 'wallet' | 'ready' | 'done' = result ? 'done' : ready ? 'ready' : me ? 'wallet' : 'in';

  return (
    <div style={{ minHeight: '100vh', background: BG, color: FG, fontFamily: 'var(--font-sora), ui-sans-serif, system-ui', position: 'relative', overflow: 'hidden' }}>
      <Header />
      {/* vermilion editorial rail */}
      <div style={{ position: 'fixed', top: 0, left: 0, width: 5, height: '100%', background: VERM, zIndex: 40 }} />
      {/* atmosphere — warm wash so the reward page isn't flat */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, background: 'radial-gradient(58% 44% at 80% 30%, color-mix(in srgb, var(--vermilion) 13%, transparent), transparent 68%)' }} />
      <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, background: 'radial-gradient(46% 40% at 14% 90%, color-mix(in srgb, var(--profit) 8%, transparent), transparent 72%)' }} />
      <main className="container" style={{ position: 'relative', zIndex: 1, paddingTop: 'clamp(104px, 15vw, 150px)', paddingBottom: 120 }}>
        <div className="grid grid-cols-1 lg:grid-cols-[1.02fr_0.98fr] gap-12 lg:gap-16 items-center" style={{ maxWidth: 1080, margin: '0 auto' }}>
          {/* the claim flow */}
          <div className="order-2 lg:order-1" style={{ width: '100%', maxWidth: 560 }}>

        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 13, letterSpacing: '0.22em', color: VERM, fontWeight: 600, marginBottom: 16 }}>YOUR WINNINGS</div>
          {amount != null && amount > 0 ? (
            <>
              <h1 style={{ fontSize: 'clamp(46px, 15vw, 64px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, margin: 0, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
                <span>${amount.toFixed(2)}</span><span style={{ fontSize: 'clamp(22px, 7vw, 30px)', color: MUTE, fontWeight: 700 }}>waiting</span>
              </h1>
              <p style={{ fontSize: 17, color: MUTE, marginTop: 16, maxWidth: 420, lineHeight: 1.5 }}>
                {me ? `It’s yours, ${me.handle}. Cash it out to any wallet in two taps.` : 'It’s yours. Cash it out to any wallet in two taps.'}
              </p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 'clamp(40px, 13vw, 52px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, margin: 0 }}>
                Claim your<br />winnings.
              </h1>
              <p style={{ fontSize: 17, color: MUTE, marginTop: 16, maxWidth: 420, lineHeight: 1.5 }}>
                You bet from a tweet, so we made you an account and staked it. Prove it’s you, pick a wallet, and it’s yours.
              </p>
            </>
          )}
        </div>

        <Step index={1} label="Prove it’s you" done={!!me}>
          {me ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: GREEN, fontWeight: 600 }}><Dot /> signed in as @{me.handle}</div>
          ) : (
            <a href="/api/claim/x/start"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: FG, color: BG, borderRadius: 999, padding: '13px 22px', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
              <XGlyph /> Sign in with X
            </a>
          )}
        </Step>

        <Step index={2} label="Where do you want to cash out?" done={!!wallet} dim={!me}>
          {wallet ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: GREEN, fontWeight: 600, minWidth: 0 }}>
                <Dot /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{short(wallet)} connected{binding && <span style={{ color: MUTE, fontWeight: 500, marginLeft: 8 }}>· linking…</span>}</span>
              </div>
              {err && !ready && <p style={{ color: 'var(--loss)', fontSize: 13, marginTop: 10, fontWeight: 500, lineHeight: 1.5 }}>{err}</p>}
            </div>
          ) : (
            <div style={{ opacity: me ? 1 : 0.4, pointerEvents: me ? 'auto' : 'none' }}><ConnectButton /></div>
          )}
        </Step>

        <AnimatePresence>
          {stage === 'ready' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 12 }}>
              <button onClick={claim} disabled={busy} className="bg-vermilion"
                style={{ width: '100%', background: VERM, color: LIGHT, border: 0, borderRadius: 16, padding: 20, fontSize: 'clamp(16px, 4.6vw, 19px)', fontWeight: 800, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, letterSpacing: '-0.01em' }}>
                {busy ? 'Cashing out…' : `Claim $${acct!.balanceDusdc.toFixed(2)} to ${short(wallet!)}`}
              </button>
              {err && <p style={{ color: 'var(--loss)', fontSize: 14, marginTop: 12 }}>{err}</p>}
            </motion.div>
          )}
          {stage === 'done' && result && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              style={{ marginTop: 12, background: 'color-mix(in srgb, var(--profit) 10%, transparent)', border: `1px solid color-mix(in srgb, var(--profit) 45%, transparent)`, borderRadius: 16, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: GREEN, fontWeight: 800, fontSize: 18 }}><Dot /> It’s yours.</div>
              <p style={{ color: FG, marginTop: 8, fontSize: 15 }}>${result.amount.toFixed(2)} landed in {short(wallet!)}. Nobody could ever take it, and now it’s in your hands.</p>
              <a href={`https://suiscan.xyz/testnet/tx/${result.digest}`} target="_blank" rel="noreferrer" style={{ color: MUTE, fontSize: 12, marginTop: 10, display: 'inline-block' }}>receipt · {short(result.digest)}</a>
            </motion.div>
          )}
        </AnimatePresence>

        <p style={{ marginTop: 48, fontSize: 13, color: MUTE, lineHeight: 1.6, maxWidth: 440 }}>
          We made you an account and locked it to you. Only you can open it, not even us. Signing in with X just proves it’s the same you that placed the bet.
        </p>
          </div>

          {/* the reward, made tangible */}
          <div className="order-1 lg:order-2" style={{ width: '100%' }}>
            <ReceiptCard amount={amount} handle={me?.handle} done={stage === 'done'} />
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ClaimPage() {
  return <Suspense fallback={<div style={{ minHeight: '100vh', background: BG }} />}><ClaimInner /></Suspense>;
}

function Step({ index, label, done, dim, children }: { index: number; label: string; done?: boolean; dim?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '22px 0', borderTop: `1px solid ${HAIR}`, opacity: dim ? 0.5 : 1, transition: 'opacity .2s' }}>
      <div style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 999, border: `1.5px solid ${done ? GREEN : HAIR}`, color: done ? GREEN : MUTE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>{done ? '✓' : index}</div>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{label}</div>{children}</div>
    </div>
  );
}

const Dot = () => <span style={{ width: 8, height: 8, borderRadius: 4, background: GREEN, display: 'inline-block', flexShrink: 0 }} />;
const XGlyph = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 1.2h3.7l-8 9.1 9.4 12.5h-7.4l-5.8-7.6-6.6 7.6H.5l8.5-9.8L0 1.2h7.6l5.2 6.9 6.1-6.9Zm-1.3 19.4h2L6.5 3.3H4.4l13.2 17.3Z" /></svg>);
// the mark in fixed ink, for the always-cream reward ticket
const CelebrantInk = () => (
  <svg width="20" height="24" viewBox="0 0 266 322" fill="none"><path d="M133 96c-18 0-30-16-30-34 0-17 13-31 30-31s30 14 30 31c0 18-12 34-30 34Z" fill="#141210" /><path d="M133 120c8 0 15 6 15 30v150c0 12-7 20-15 20s-15-8-15-20V150c0-24 7-30 15-30Z" fill="#141210" /><path d="M120 140 40 70M146 140l80-70" stroke="#141210" strokeWidth="26" strokeLinecap="round" /><circle cx="133" cy="300" r="16" fill="#E04D26" /></svg>
);

// The reward, as a tangible cream ticket (borrows the brand's won-card language) — makes the page
// feel like a prize, not a form. Always cream so it reads as a physical object in both themes.
function ReceiptCard({ amount, handle, done }: { amount: number | null; handle?: string; done?: boolean }) {
  const cPaper = '#FBF7EF', cInk = '#141210', cMute = '#6E6353', cGreen = '#2E6B4F', cFaint = '#9A8E7B';
  const known = amount != null && amount > 0;
  const bars = Array.from({ length: 46 }, (_, i) => 2 + ((i * 7 + 3) % 5));
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 420, margin: '0 auto', background: cPaper, color: cInk, borderRadius: 22, boxShadow: '0 2px 4px rgba(40,28,18,0.06), 0 34px 80px -30px rgba(40,28,18,0.55)', overflow: 'hidden', fontFamily: 'var(--font-sora), ui-sans-serif, system-ui' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, background: cVermConst }} />
      <div style={{ padding: '30px 30px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CelebrantInk />
            <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.3px' }}>yosuku</span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: known ? 'rgba(46,107,79,0.12)' : 'rgba(20,18,16,0.06)', color: known ? cGreen : cFaint, borderRadius: 999, padding: '6px 13px', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono), ui-monospace, monospace', letterSpacing: '0.08em' }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: known ? cGreen : cFaint }} />{done ? 'CLAIMED' : known ? 'SETTLED · WON' : 'WAITING'}
          </span>
        </div>

        <div style={{ marginTop: 32, fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: 12, letterSpacing: '0.22em', color: cFaint }}>YOUR WINNINGS</div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, fontSize: 'clamp(46px, 12vw, 60px)', letterSpacing: '-0.03em', lineHeight: 1, color: known ? cGreen : cInk }}>{known ? `$${amount!.toFixed(2)}` : '$ • •'}</span>
          <span style={{ fontSize: 20, color: cMute, fontWeight: 700 }}>{done ? 'sent' : 'waiting'}</span>
        </div>
        <div style={{ marginTop: 12, fontSize: 14, color: cMute, fontFamily: 'var(--font-mono), ui-monospace, monospace' }}>{done ? 'paid straight to your wallet' : handle ? `waiting for @${handle}` : 'sign in with X to reveal'}</div>

        <div style={{ height: 1, background: 'rgba(20,18,16,0.1)', margin: '26px 0 18px' }} />

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 42 }} aria-hidden>
          {bars.map((w, i) => <div key={i} style={{ width: w, height: '100%', background: cInk, opacity: 0.8 }} />)}
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: 11, color: cFaint }}>
          <span>Only you can cash out.</span>
          <span>Sui testnet</span>
        </div>
      </div>
    </div>
  );
}
const cVermConst = '#E04D26';
