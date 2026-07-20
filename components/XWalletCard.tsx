'use client';

import { useState, useEffect, useCallback } from 'react';
import { Twitter, ArrowUpRight } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { buildEnableTweetTrading624, buildTweetVaultWithdraw624, fetchTweetLedger624Micro } from '@/lib/sui/vault624Client';
import { fetchDUSDCCoins } from '@/lib/sui/queries';

type XMe = {
  handle: string | null;
  authorId?: string;
  account?: { address: string; balanceDusdc: number; owner: string | null } | null;
};

const DUSDC_MUL = 1_000_000;
const TWEET_MAX_LEVERAGE_1E9 = 3_000_000_000n; // authorize the relay agent up to 3x a trade (it clamps to the tweet)
const QUICK = ['5', '10', '25'];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Portfolio card for the trade-from-X account. Shows your betting balance in the dedicated tweet
// vault (VAULT624_TWEET, 0x3f99…, the ledger the relay trades your replies from), lets you Fund it
// in one signature (deposit + keep the bounded agent authorized), and Cash out straight back to
// your wallet — only you can, the agent has no withdraw path. Below that: Connect X to bind your
// handle, and claim any sealed tweet-funded account we spun up for you.
export default function XWalletCard() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();

  const [me, setMe] = useState<XMe | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [balMicro, setBalMicro] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState<'' | 'fund' | 'cashout' | 'faucet'>('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [needsFaucet, setNeedsFaucet] = useState(false);

  useEffect(() => {
    fetch('/api/claim/x/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMe(j))
      .catch(() => setMe(null))
      .finally(() => setLoadingMe(false));
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!address) { setBalMicro(null); return; }
    setBalMicro(await fetchTweetLedger624Micro(address));
  }, [address]);
  useEffect(() => { void refreshBalance(); }, [refreshBalance]);

  const balNum = balMicro == null ? null : Number(balMicro) / DUSDC_MUL;

  const fund = useCallback(async () => {
    if (!address || busy) return;
    setErr(''); setOk(''); setNeedsFaucet(false); setBusy('fund');
    try {
      const n = parseFloat(amount || '0');
      if (!Number.isFinite(n) || n <= 0) throw new Error('Enter an amount to fund.');
      const micro = BigInt(Math.round(n * DUSDC_MUL));
      const all = (await fetchDUSDCCoins(null as never, address)).sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
      const picked = all.slice(0, 15); // buildEnableTweetTrading624 merges + splits from EXACTLY these — guard on the same set
      const total = picked.reduce((s, c) => s + c.balance, 0n);
      if (total < micro) { setNeedsFaucet(true); throw new Error('Not enough DUSDC in your wallet. Grab some test DUSDC first.'); }
      await submit(() =>
        buildEnableTweetTrading624({
          coinIds: picked.map((c) => c.coinObjectId),
          amountMicro: micro,
          maxMarginMicro: micro,
          maxLeverage1e9: TWEET_MAX_LEVERAGE_1E9,
        }),
      );
      setOk(`Funded $${(Number(micro) / DUSDC_MUL).toFixed(2)}. Reply YES or NO to a live line to bet it.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
      void refreshBalance();
    }
  }, [address, amount, busy, submit, refreshBalance]);

  const cashOut = useCallback(async () => {
    if (!address || busy) return;
    setErr(''); setOk(''); setBusy('cashout');
    try {
      const exact = await fetchTweetLedger624Micro(address); // freshest exact micro — withdraw wants the precise integer
      if (exact <= 0n) throw new Error('Nothing to cash out yet.');
      await submit(() => buildTweetVaultWithdraw624({ amountMicro: exact }));
      setOk(`Cashed out $${(Number(exact) / DUSDC_MUL).toFixed(2)} to your wallet.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
      void refreshBalance();
    }
  }, [address, busy, submit, refreshBalance]);

  const getFaucet = useCallback(async () => {
    if (!address || busy) return;
    setErr(''); setOk(''); setBusy('faucet');
    try {
      const r = await fetch('/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) });
      const j = await r.json().catch(() => ({}));
      if (j?.alreadyFunded) { setOk('You already have test DUSDC. Hit Fund X wallet.'); setNeedsFaucet(false); return; }
      if (!r.ok && !j?.ok) throw new Error(j?.error ? String(j.error).slice(0, 120) : 'Faucet is tapped out, try again shortly.');
      setOk('Test DUSDC on the way. Give it a few seconds, then Fund X wallet.');
      setNeedsFaucet(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }, [address, busy]);

  const connected = !!me?.handle;
  const acct = me?.account ?? null;
  // a SEPARATE sealed auto-account (key held by us, cashed out via seal-decrypt at /claim) —
  // only surface it when it isn't the connected wallet itself (that balance already shows above).
  const sealed = acct && acct.balanceDusdc > 0 && address && acct.address.toLowerCase() !== address.toLowerCase() ? acct : null;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Twitter className="h-4 w-4 text-[#E04D26]" />
        <h2 className="font-display text-sm font-[700] uppercase tracking-wide text-white">X wallet</h2>
      </div>

      <div className="rounded border border-white/[0.08] bg-bg p-5">
        {!address ? (
          <div className="text-sm text-gray-400">Connect a wallet above to fund your X betting balance.</div>
        ) : (
          <>
            {/* balance + cash out */}
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">Your X betting balance</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-[800] text-white tabular-nums">{balNum == null ? '$0.00' : `$${balNum.toFixed(2)}`}</span>
                  <span className="text-[13px] text-gray-500">bet it from a reply</span>
                </div>
              </div>
              {balMicro != null && balMicro > 0n && (
                <button
                  onClick={cashOut}
                  disabled={!!busy}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                >
                  {busy === 'cashout' ? 'Cashing out…' : 'Cash out'} <ArrowUpRight className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* fund controls */}
            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="flex items-center gap-1.5">
                {QUICK.map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className={`rounded-lg border px-3 py-2 font-mono text-xs transition-colors ${amount === v ? 'border-[#E04D26] text-white' : 'border-white/10 text-gray-400 hover:text-white'}`}
                  >${v}</button>
                ))}
                <div className="flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2">
                  <span className="text-sm text-gray-500">$</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    aria-label="Amount to fund in DUSDC"
                    className="w-14 bg-transparent text-sm text-white outline-none"
                  />
                  <span className="font-mono text-[10px] text-gray-600">DUSDC</span>
                </div>
              </div>
              <button
                onClick={fund}
                disabled={!!busy}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-xl bg-[#E04D26] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#B83A1B] disabled:opacity-60"
              >
                {busy === 'fund' ? 'Funding…' : 'Fund X wallet'}
              </button>
            </div>

            <p className="mt-3 text-[11px] leading-snug text-gray-500">
              Funds your trade-from-X account and keeps the bounded agent authorized, up to 3x a trade. It can open the bets you tweet, it can never withdraw. Only you can cash out.
            </p>

            {needsFaucet && (
              <button
                onClick={getFaucet}
                disabled={!!busy}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/[0.06] disabled:opacity-50"
              >
                {busy === 'faucet' ? 'Requesting…' : 'Get test DUSDC'}
              </button>
            )}
            {err && <div className="mt-2 text-[12px] text-[#E04D26]">{err}</div>}
            {ok && <div className="mt-2 text-[12px] text-emerald-400">{ok}</div>}
          </>
        )}

        {/* X handle connect + sealed auto-account claim */}
        <div className="mt-4 border-t border-white/[0.06] pt-4">
          {loadingMe ? (
            <div className="text-sm text-gray-500">Checking your X connection…</div>
          ) : !connected ? (
            <a
              href="/api/claim/x/start?return=/portfolio"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-black px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-black/85"
            >
              <Twitter className="h-4 w-4" /> Connect X to bet from your tweets
            </a>
          ) : sealed ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="font-mono text-xs text-gray-400">@{me!.handle} · tweet-funded account {short(sealed.address)} · <span className="text-white">${sealed.balanceDusdc.toFixed(2)}</span></div>
              <a href="/claim" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/[0.06]">
                Cash out <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <div className="font-mono text-xs text-gray-400">@{me!.handle} connected · reply YES or NO to a live line to place a bet.</div>
          )}
        </div>
      </div>
    </section>
  );
}
