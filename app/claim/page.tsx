'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchParams, useRouter } from 'next/navigation';
import { useCurrentAccount, useSuiClient, useSignPersonalMessage, ConnectButton } from '@mysten/dapp-kit';
import {
  fetchClaimAccount, unsealAccountKey, recoverFundsToWallet, type ClaimAccount,
} from '@/lib/sui/claim';

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
  const router = useRouter();
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
    <div style={{ minHeight: '100vh', background: BG, color: FG, fontFamily: 'var(--font-sora), ui-sans-serif, system-ui' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, width: 5, height: '100%', background: VERM, zIndex: 20 }} />
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 'clamp(40px, 9vw, 64px) clamp(20px, 6vw, 28px) 120px' }}>
        <button onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 0, cursor: 'pointer', color: FG, marginBottom: 'clamp(36px, 9vw, 56px)' }}>
          <Celebrant />
          <span style={{ fontWeight: 800, letterSpacing: '0.12em', fontSize: 18 }}>YOSUKU</span>
          <span style={{ color: VERM, letterSpacing: '0.2em', fontSize: 12 }}>予測</span>
        </button>

        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 13, letterSpacing: '0.22em', color: VERM, fontWeight: 600, marginBottom: 16 }}>YOUR WINNINGS</div>
          {amount != null && amount > 0 ? (
            <>
              <h1 style={{ fontSize: 'clamp(46px, 15vw, 64px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, margin: 0, display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
                <span>${amount.toFixed(2)}</span><span style={{ fontSize: 'clamp(22px, 7vw, 30px)', color: MUTE, fontWeight: 700 }}>waiting</span>
              </h1>
              <p style={{ fontSize: 17, color: MUTE, marginTop: 16, maxWidth: 420, lineHeight: 1.5 }}>
                {me ? `It’s yours, ${me.handle}. Send it to any wallet in two taps.` : 'It’s yours. Let’s get it to your wallet in two taps.'}
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

        <Step index={2} label="Where should we send it?" done={!!wallet} dim={!me}>
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
                {busy ? 'Sending to your wallet…' : `Claim $${acct!.balanceDusdc.toFixed(2)} to ${short(wallet!)}`}
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

        <p style={{ marginTop: 56, fontSize: 13, color: MUTE, lineHeight: 1.6, maxWidth: 440 }}>
          We made you an account and locked it to you. Only you can open it, not even us. Signing in with X just proves it’s the same you that placed the bet.
        </p>
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
const Celebrant = () => (
  <svg width="22" height="26" viewBox="0 0 266 322" fill="none"><path d="M133 96c-18 0-30-16-30-34 0-17 13-31 30-31s30 14 30 31c0 18-12 34-30 34Z" fill="var(--white)" /><path d="M133 120c8 0 15 6 15 30v150c0 12-7 20-15 20s-15-8-15-20V150c0-24 7-30 15-30Z" fill="var(--white)" /><path d="M120 140 40 70M146 140l80-70" stroke="var(--white)" strokeWidth="26" strokeLinecap="round" /><circle cx="133" cy="300" r="16" fill="var(--vermilion)" /></svg>
);
