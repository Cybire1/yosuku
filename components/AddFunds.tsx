'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { X } from 'lucide-react';

const OFFICIAL_FAUCET = 'https://tally.so/r/Xx102L';
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

/**
 * In-app "onramp" for testnet. A connected user taps once and gets test USDC
 * dripped to their wallet — no leaving the site, no wallet juggling. Falls
 * back to the official DeepBook faucet when the instant drip is empty.
 */
export default function AddFunds({ open, onClose, onFunded }: { open: boolean; onClose: () => void; onFunded?: () => void }) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  async function getFunds() {
    if (!address) return;
    setState('loading'); setMsg('');
    try {
      const r = await fetch('/api/faucet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Faucet error');
      setState('done');
      setMsg(d.alreadyFunded ? 'You already have wallet DUSDC — ready to trade.' : `${d.amount} test USDC added to your wallet.`);
      onFunded?.();
    } catch (e) {
      setState('error'); setMsg(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md border border-white/10 rounded-2xl bg-[#0d0d10] p-7 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-funds-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close add funds"
          className="absolute right-4 top-4 rounded-full p-2 text-gray-600 hover:bg-white/[0.05] hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-vermilion" style={{ boxShadow: '0 0 12px var(--vermilion)' }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500">Add funds · testnet</span>
        </div>
        <h2 id="add-funds-title" className="font-display text-2xl font-extrabold tracking-tight mb-1">Get test USDC</h2>
        <p className="text-gray-400 text-sm leading-relaxed mb-6">
          Yosuku runs on testnet — these are play chips, not real money. Tap once and they land in your wallet. When you bet, Yosuku moves only what is needed into your Trading Balance.
        </p>

        {!address ? (
          <div className="font-mono text-xs text-gray-500 text-center py-6">Connect a wallet first.</div>
        ) : (
          <>
            {/* account row */}
            <div className="flex items-center justify-between border border-white/[0.06] rounded-xl px-4 py-3 mb-4">
              <span className="font-mono text-[11px] text-gray-500">Your account</span>
              <button
                type="button"
                className="font-mono text-xs text-gray-300 hover:text-white transition-colors"
                aria-label="Copy account address"
                onClick={() => { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              >
                {copied ? 'copied ✓' : `${short(address)} ⧉`}
              </button>
            </div>

            {state === 'done' ? (
              <Link
                href="/markets"
                onClick={onClose}
                className="block w-full text-center bg-vermilion text-white font-semibold rounded-full py-3 hover:bg-vermilion-d transition-colors"
              >
                Trade from wallet →
              </Link>
            ) : (
              <button
                type="button"
                onClick={getFunds}
                disabled={state === 'loading'}
                className="w-full bg-white text-black font-semibold rounded-full py-3 hover:scale-[1.02] active:scale-[0.97] transition-transform disabled:opacity-60"
              >
                {state === 'loading' ? 'Adding…' : 'Get 2 test USDC'}
              </button>
            )}

            {msg && (
              <p className={`text-[12px] mt-3 text-center ${state === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>{msg}</p>
            )}

            <div className="mt-5 pt-4 border-t border-white/[0.06] text-center">
              <a href={OFFICIAL_FAUCET} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-gray-500 hover:text-vermilion transition-colors">
                Need more? Get test USDC from the DeepBook faucet ↗
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
