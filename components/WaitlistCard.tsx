'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import { fetchWaitlist, buildJoinTx, fetchWaitlistLeaderboard, type WaitlistState, type WaitlistLeaderboard } from '@/lib/sui/waitlist';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * On-chain FOUNDER list (signed on TESTNET today). The app is free to play on testnet now;
 * joining reserves a priority spot for the FUTURE mainnet, real-money launch — a signed on-chain tx (verifiable
 * demand, not an email). Referrals move you UP the line (effective rank computed from the
 * on-chain `Joined` events); the top tier are Founders (first access + a badge).
 */
export default function WaitlistCard() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit, sponsorReady } = useSmartSubmit();

  const [state, setState] = useState<WaitlistState | null>(null);
  const [lb, setLb] = useState<WaitlistLeaderboard | null>(null);
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
    try { setLb(await fetchWaitlistLeaderboard(address)); } catch { /* keep last */ }
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
  const top = (lb?.entries ?? []).slice(0, 5);

  return (
    <div className="border border-white/[0.07] rounded-2xl bg-gradient-to-b from-[#15100f] to-[#0d0d10] p-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-1.5 h-1.5 rounded-full bg-vermilion" style={{ boxShadow: '0 0 12px var(--vermilion)' }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500">Founder list · on-chain (testnet)</span>
      </div>
      <h2 className="font-display text-2xl font-extrabold tracking-tight mb-1">
        {state ? `${state.count.toLocaleString()} ${state.count === 1 ? 'wallet' : 'wallets'} in line` : 'Claim your spot'}
      </h2>
      <p className="text-gray-400 text-sm leading-relaxed mb-5 max-w-xl">
        Free to play on testnet now. Joining signs your spot <span className="text-gray-200">on-chain (testnet today)</span> — a verifiable claim
        (not an email) on priority access when we go live on <span className="text-gray-200">mainnet, with real money</span>. <span className="text-gray-200">Referrals move you up the line</span>; the top tier
        are <span className="text-vermilion">Founders</span> — first access at launch + a permanent badge.
        {referrer && <span className="text-gray-500"> Referred by {short(referrer)}.</span>}
      </p>

      {!address ? (
        <div className="flex items-center gap-3">
          <ConnectButton />
          <span className="font-mono text-[11px] text-gray-500">connect to claim your spot</span>
        </div>
      ) : state?.joined ? (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {lb?.me?.tier === 'Founder' ? (
              <span className="inline-flex items-center gap-1.5 border border-vermilion/40 bg-vermilion/[0.08] rounded-full px-3 py-1.5 font-mono text-[12px] text-vermilion">★ FOUNDER</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 border border-emerald-500/20 bg-emerald-500/[0.06] rounded-full px-3 py-1.5 font-mono text-[12px] text-emerald-300">✓ EARLY</span>
            )}
            <span className="font-mono text-[12px] text-gray-300">
              Rank <span className="text-white">#{lb?.me?.rank ?? state.position ?? '—'}</span>
              {lb ? <span className="text-gray-600"> of {lb.total}</span> : null}
              {lb?.me ? <span className="text-gray-500"> · {lb.me.referrals} referral{lb.me.referrals === 1 ? '' : 's'}</span> : null}
            </span>
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
          <p className="font-mono text-[10px] text-gray-600 mt-2">each signed referral moves you up the line — climb into Founder.</p>
        </div>
      ) : (
        <button
          onClick={join}
          disabled={busy}
          className="bg-vermilion text-white font-semibold rounded-full px-6 py-3 hover:bg-vermilion-d transition-colors disabled:opacity-60"
        >
          {busy ? 'joining…' : sponsorReady ? 'Join the Founder list — free →' : 'Join the Founder list →'}
        </button>
      )}

      {top.length > 0 && (
        <div className="mt-5 pt-4 border-t border-white/[0.06]">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600 mb-2">Top of the line · by referrals</div>
          <div className="space-y-1">
            {top.map((e) => (
              <div key={e.address} className="flex items-center justify-between text-[12px] font-mono">
                <span className="flex items-center gap-2">
                  <span className={`w-5 text-right ${e.tier === 'Founder' ? 'text-vermilion' : 'text-gray-500'}`}>#{e.rank}</span>
                  <span className={address && e.address === address.toLowerCase() ? 'text-white' : 'text-gray-400'}>{short(e.address)}{address && e.address === address.toLowerCase() ? ' (you)' : ''}</span>
                </span>
                <span className="text-gray-500">{e.referrals} ref{e.referrals === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-rose-400 text-[12px] mt-3 font-mono">{err}</p>}
    </div>
  );
}
