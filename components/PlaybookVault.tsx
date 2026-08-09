'use client';

import { useCallback, useEffect, useState } from 'react';
import { Lock, LockOpen, Loader2, ShieldCheck } from 'lucide-react';
import { sealPlaybook, readPlaybook, readOwnPlaybook } from '@/lib/sui/strategySealClient';

/**
 * The playbook, and the moment it opens.
 *
 * This screen is the product's promise made literal: you pay, and a thing that was genuinely
 * unreadable becomes readable. So the sealed state is not a grey "locked" placeholder, it shows
 * the actual ciphertext. Seeing real encrypted bytes and then watching them resolve into words is
 * the whole argument, and a lock icon over a blurred div would be theatre for something that is
 * actually true here.
 *
 * The decrypt happens in the browser against Seal's key servers. Nothing readable passes through
 * Yosuku, which is why the copy says the creator sealed it rather than that we store it.
 */
export default function PlaybookVault({
  strategyId,
  subscriptionId,
  blobId,
  coinType,
  role,
  walletAddress,
  signPersonalMessage,
  subFee,
  onSealed,
}: {
  strategyId: string;
  subscriptionId?: string | null;
  blobId?: string | null;
  coinType: string;
  role: 'creator' | 'subscriber' | 'visitor';
  walletAddress?: string | null;
  signPersonalMessage?: (a: { message: Uint8Array }) => Promise<{ signature: string }>;
  subFee?: number;
  onSealed?: (blobId: string) => void;
}) {
  const [text, setText] = useState('');
  const [plain, setPlain] = useState<string | null>(null);
  const [busy, setBusy] = useState<'seal' | 'open' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cipher, setCipher] = useState<string>('');

  // Show the ACTUAL first bytes of the capsule, not a synthetic stand-in. This panel's whole
  // claim is that the thing is really encrypted, so rendering `blobId.repeat(4)` would be a
  // fake screenshot of a true fact, and it visibly tiles. Head request only; the body is
  // useless without a key anyway.
  useEffect(() => {
    if (!blobId) return;
    let off = false;
    (async () => {
      try {
        const r = await fetch(`https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`);
        if (!r.ok) return;
        const buf = new Uint8Array((await r.arrayBuffer()).slice(0, 130));
        if (!off) setCipher(Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(''));
      } catch { /* no preview is better than a fabricated one */ }
    })();
    return () => { off = true; };
  }, [blobId]);

  const open = useCallback(async () => {
    if (!walletAddress || !signPersonalMessage || !blobId) return;
    setBusy('open'); setErr(null);
    try {
      const out = role === 'creator'
        ? await readOwnPlaybook({ walletAddress, strategyId, blobId, coinType, signPersonalMessage })
        : await readPlaybook({ walletAddress, strategyId, subscriptionId: subscriptionId!, blobId, coinType, signPersonalMessage });
      setPlain(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }, [walletAddress, signPersonalMessage, blobId, role, strategyId, subscriptionId, coinType]);

  const seal = useCallback(async () => {
    setBusy('seal'); setErr(null);
    try {
      const { blobId: id } = await sealPlaybook({ strategyId, playbook: text });
      onSealed?.(id);
      setPlain(text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }, [strategyId, text, onSealed]);

  // ── creator, nothing sealed yet ──
  if (role === 'creator' && !blobId) {
    return (
      <div className="pv">
        <div className="pv-head">
          <h4 className="pv-title">Seal your playbook</h4>
          <p className="pv-sub">Encrypted in your browser. Only people who subscribe can open it.</p>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="What does this agent actually do, and why?"
          className="pv-input"
        />
        <div className="pv-row">
          <button type="button" onClick={seal} disabled={!text.trim() || busy === 'seal'} className="pv-btn">
            {busy === 'seal' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Lock className="w-3.5 h-3.5" aria-hidden />}
            {busy === 'seal' ? 'Sealing' : 'Seal it'}
          </button>
          <span className="pv-note">Yosuku never sees this. Not once.</span>
        </div>
        {err && <p className="pv-err" role="alert">{err}</p>}
        <Styles />
      </div>
    );
  }

  if (!blobId) {
    return (
      <div className="pv">
        <p className="pv-sub">This creator hasn&rsquo;t sealed a playbook yet.</p>
        <Styles />
      </div>
    );
  }

  // ── opened ──
  if (plain !== null) {
    return (
      <div className="pv is-open">
        <div className="pv-head">
          <h4 className="pv-title"><LockOpen className="w-4 h-4 inline -mt-0.5 mr-1.5" aria-hidden />The playbook</h4>
          <span className="pv-verified"><ShieldCheck className="w-3.5 h-3.5" aria-hidden />Decrypted on your device</span>
        </div>
        <pre className="pv-plain">{plain}</pre>
        <Styles />
      </div>
    );
  }

  // ── sealed ──
  const canOpen = role === 'creator' || (role === 'subscriber' && !!subscriptionId);
  return (
    <div className="pv">
      <div className="pv-head">
        <h4 className="pv-title"><Lock className="w-4 h-4 inline -mt-0.5 mr-1.5" aria-hidden />Sealed</h4>
        <p className="pv-sub">
          {canOpen
            ? 'Yours to open.'
            : subFee != null
              ? `Subscribe for ${subFee.toFixed(2)} DUSDC to open this.`
              : 'Subscribe to open this.'}
        </p>
      </div>

      {/* the real ciphertext, not a blurred placeholder — the thing being unlocked is genuinely
          unreadable, so showing it is honest rather than decorative */}
      {cipher && <div className="pv-cipher" aria-hidden>{cipher}</div>}

      <div className="pv-row">
        <button type="button" onClick={open} disabled={!canOpen || busy === 'open'} className="pv-btn">
          {busy === 'open' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <LockOpen className="w-3.5 h-3.5" aria-hidden />}
          {busy === 'open' ? 'Opening' : 'Open the playbook'}
        </button>
        <span className="pv-note">
          {canOpen ? 'Opens in your browser. Nothing passes through us.' : 'The lock is on-chain, not in our app.'}
        </span>
      </div>
      {err && <p className="pv-err" role="alert">{err}</p>}
      <Styles />
    </div>
  );
}

function Styles() {
  return (
    <style jsx global>{`
      .pv { border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 16px; background: rgba(0,0,0,0.28); }
      .pv.is-open { border-color: rgba(52,211,153,0.35); }
      .pv-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .pv-title { font-size: 14px; font-weight: 700; color: #fff; margin: 0; }
      .pv-sub { font-size: 12px; color: rgba(255,255,255,0.55); margin: 2px 0 0; }
      .pv-input {
        width: 100%; margin-top: 12px; padding: 10px 12px; border-radius: 10px; resize: vertical;
        border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.03);
        color: #fff; font-size: 13px; line-height: 1.55; outline: none;
      }
      .pv-input:focus { border-color: rgba(255,255,255,0.28); }
      /* real ciphertext, clipped: it must read as bytes, never as a blurred paragraph */
      .pv-cipher {
        margin-top: 12px; padding: 12px; border-radius: 10px; max-height: 92px; overflow: hidden;
        font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.5; word-break: break-all;
        color: rgba(255,255,255,0.28); background: rgba(255,255,255,0.03);
        mask-image: linear-gradient(to bottom, #000 40%, transparent 100%);
        -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent 100%);
      }
      .pv-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
      .pv-btn {
        display: inline-flex; align-items: center; gap: 7px; border: 0; border-radius: 999px;
        padding: 8px 16px; font-size: 12px; font-weight: 700; color: #0B0B0B; background: #fff;
      }
      .pv-btn:disabled { opacity: 0.45; }
      .pv-note { font-size: 11px; color: rgba(255,255,255,0.4); }
      .pv-err { font-size: 12px; color: #FB7185; margin: 10px 0 0; }
      .pv-verified { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700; color: #34D399; }
      .pv-plain {
        margin: 12px 0 0; padding: 12px; border-radius: 10px; white-space: pre-wrap; word-break: break-word;
        font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.9); background: rgba(52,211,153,0.06);
        border: 1px solid rgba(52,211,153,0.18);
      }

      [data-theme='light'] .pv { border-color: rgba(20,18,16,0.1); background: rgba(255,255,255,0.72); }
      [data-theme='light'] .pv.is-open { border-color: rgba(20,120,80,0.3); }
      [data-theme='light'] .pv-title { color: #1A1613; }
      [data-theme='light'] .pv-sub { color: rgba(26,22,19,0.6); }
      [data-theme='light'] .pv-input { color: #1A1613; background: rgba(20,18,16,0.03); border-color: rgba(20,18,16,0.14); }
      [data-theme='light'] .pv-cipher { color: rgba(26,22,19,0.3); background: rgba(20,18,16,0.03); }
      [data-theme='light'] .pv-btn { color: #fff; background: #1A1613; }
      [data-theme='light'] .pv-note { color: rgba(26,22,19,0.45); }
      [data-theme='light'] .pv-plain { color: #1A1613; background: rgba(20,120,80,0.06); border-color: rgba(20,120,80,0.18); }
    `}</style>
  );
}
