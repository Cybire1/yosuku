'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import { fetchWaitlist, buildJoinTx, type WaitlistState } from '@/lib/sui/waitlist';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * On-chain mainnet waitlist. Connecting + joining is a real signed transaction — the
 * spot is recorded on-chain with a referral, so the count is verifiable demand, not a
 * vanity signup. The join is signed by the wallet and executed over gRPC.
 */
export default function WaitlistCard() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit, sponsorReady } = useSmartSubmit();

  const [state, setState] = useState<WaitlistState | null>(null);
  const [referrer, setReferrer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref && /^0x[0-9a-fA-F]{64}$/.test(ref)) setReferrer(ref);
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    try { setState(await fetchWaitlist(address)); } catch { /* keep last */ }
  }, [address]);

  useEffect(() => { refresh(); }, [refresh]);

  async function join() {
    if (!address) return;
    setBusy(true); setErr(null);
    try {
      await submit(() => buildJoinTx(referrer && referrer !== address ? referrer : null));
      await refresh();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e).slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  const refLink = address ? `${typeof window !== 'undefined' ? window.location.origin : ''}/stats?ref=${address}` : '';

  return (
    <div className="border border-white/[0.07] rounded-2xl bg-gradient-to-b from-[#15100f] to-[#0d0d10] p-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-vermilion" style={{ boxShadow: '0 0 12px var(--vermilion)' }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500">Mainnet waitlist · on-chain</span>
      </div>
      <h2 className="font-display text-2xl font-extrabold tracking-tight mb-1">
        {state ? `${state.count.toLocaleString()} ${state.count === 1 ? 'wallet' : 'wallets'} in line` : 'Claim your spot'}
      </h2>
      <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-xl">
        Reserve early access for the mainnet launch. Your spot is a signed transaction recorded
        on-chain — real, verifiable demand, not an email in a spreadsheet.
        {referrer && <span className="text-gray-500"> Referred by {short(referrer)}.</span>}
      </p>

      {!address ? (
        <div className="flex items-center gap-3">
          <ConnectButton />
          <span className="font-mono text-[11px] text-gray-500">connect to claim your spot</span>
        </div>
      ) : state?.joined ? (
        <div>
          <div className="inline-flex items-center gap-2 border border-emerald-500/20 bg-emerald-500/[0.06] rounded-full px-4 py-2 mb-4">
            <span className="text-emerald-400">✓</span>
            <span className="font-mono text-[13px] text-emerald-300">You&apos;re #{state.position ?? '—'} on the mainnet waitlist</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              readOnly value={refLink}
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 font-mono text-[11px] text-gray-400 outline-none"
            />
            <button
              onClick={() => { navigator.clipboard.writeText(refLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="font-mono text-[11px] px-3 py-2 rounded-lg border border-white/10 hover:border-white/25 text-gray-300 hover:text-white transition-colors"
            >{copied ? 'copied ✓' : 'copy referral'}</button>
          </div>
          <p className="font-mono text-[10px] text-gray-600 mt-2">refer others — their join records you on-chain as the referrer.</p>
        </div>
      ) : (
        <button
          onClick={join}
          disabled={busy}
          className="bg-vermilion text-white font-semibold rounded-full px-6 py-3 hover:bg-vermilion-d transition-colors disabled:opacity-60"
        >
          {busy ? 'joining…' : sponsorReady ? 'Join the mainnet waitlist — free →' : 'Join the mainnet waitlist →'}
        </button>
      )}

      {err && <p className="text-rose-400 text-[12px] mt-3 font-mono">{err}</p>}
    </div>
  );
}
