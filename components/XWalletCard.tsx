'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Twitter, ArrowUpRight } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { buildEnableTweetTrading624, buildTweetVaultWithdraw624, fetchTweetLedger624Micro } from '@/lib/sui/vault624Client';
import { fetchDUSDCCoins, fetchDUSDCHeldMicro } from '@/lib/sui/queries';

type XMe = {
  handle: string | null;
  authorId?: string;
  account?: { address: string; balanceDusdc: number; owner: string | null } | null;
  // Which X account the relay actually routes to this wallet. `handle` alone only means "signed in
  // with X in this browser", which is not the same thing and does not make a tweet reach the money.
  binding?: { authorId: string; handle: string | null; address: string | null; sealed: boolean } | null;
  signedIn?: boolean;
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
  // No fallback address. A hardcoded one was left here as an audit scaffold, and because it is
  // an address that exists but holds nothing, every read below silently answered about IT rather
  // than about the person looking at the screen: balance $0.00, no coins, and "Not enough DUSDC
  // in your wallet. Grab some test DUSDC first." aimed at someone whose wallet was full. A wrong
  // answer is worse than no answer here, and every consumer below already guards on null.
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();

  const [me, setMe] = useState<XMe | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [balMicro, setBalMicro] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState<'' | 'fund' | 'cashout' | 'faucet' | 'link'>('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [needsFaucet, setNeedsFaucet] = useState(false);

  // Re-runs when the wallet changes: the binding is per-wallet, so switching accounts has to
  // re-ask, and passing ?wallet lets the answer come from the relay even with no session cookie.
  const refreshMe = useCallback(async () => {
    try {
      const q = address ? `?wallet=${encodeURIComponent(address)}` : '';
      const r = await fetch(`/api/claim/x/me${q}`, { cache: 'no-store' });
      setMe(r.ok ? await r.json() : null);
    } catch { setMe(null); }
    finally { setLoadingMe(false); }
  }, [address]);
  useEffect(() => { void refreshMe(); }, [refreshMe]);

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

      // What the wallet HOLDS, which is not the same question as what this transaction can
      // SPEND. getCoins (via fetchDUSDCCoins) returns coin OBJECTS only and is blind to the
      // address balance, so gating on it told users holding plenty to "grab some test DUSDC".
      // Same trap that once had the faucet call a wallet empty while it held 2000 DUSDC.
      // getBalance counts both pools, so it is the only honest basis for that sentence.
      const held = await fetchDUSDCHeldMicro(address);

      const all = (await fetchDUSDCCoins(null as never, address)).sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
      // Take what the amount actually needs instead of a blind top-15. Sorted big-first, so a
      // wallet fragmented across many small coins now funds where it used to fail: the old cap
      // could leave the money on the table purely because it arrived in more than fifteen pieces.
      // The cap is still there as a PTB-size guard, just no longer the deciding factor.
      const picked: typeof all = [];
      let total = 0n;
      for (const c of all) {
        if (total >= micro || picked.length >= 40) break;
        picked.push(c);
        total += c.balance;
      }

      if (total < micro) {
        if (held >= micro) {
          // Held but not spendable HERE: the balance lives in the address balance, and this
          // transaction merges and splits explicit coin objects. Say that, rather than send
          // someone to the faucet they do not need. Fixing it properly means spending via
          // coinWithBalance, which injects coin::redeem_funds / send_funds and so needs those
          // targets whitelisted in the yosuku-vault-624 gas policy first.
          throw new Error(
            `Your ${(Number(held) / DUSDC_MUL).toFixed(2)} DUSDC is sitting in your account balance rather than in spendable coins, so this top-up can't reach it yet. Send yourself any amount of DUSDC to turn it into a coin, then try again.`,
          );
        }
        setNeedsFaucet(true);
        throw new Error('Not enough DUSDC in your wallet. Grab some test DUSDC first.');
      }
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

  // The state that actually decides whether a tweet can spend this balance: does the relay route
  // this wallet to an X account? Signed in with X is NOT enough on its own, and treating the two as
  // the same is what let people fund a balance their replies could never reach.
  const routed = !!me?.binding;
  const needsLink = !!address && !!me?.signedIn && !routed;

  const link = useCallback(async () => {
    if (!address || busy) return;
    setErr(''); setOk(''); setBusy('link');
    try {
      const r = await fetch('/api/claim/x/link', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: address }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        if (j?.reason === 'already_claimed_other' && j?.boundWallet) {
          throw new Error(`That X account is already pointed at ${short(String(j.boundWallet))}. Connect that wallet instead.`);
        }
        throw new Error(typeof j?.reason === 'string' && j.reason ? j.reason : 'Could not link this wallet. Please try again.');
      }
      setOk('Linked. Your replies now bet from this balance.');
      await refreshMe();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(''); }
  }, [address, busy, refreshMe]);

  // Finish the job the Connect X button started. OAuth bounces back here with ?x=1 having only set
  // a cookie; without this the user is signed in, funded, and still unroutable, with nothing on
  // screen saying so. Fires once, only on that return, and only when a wallet is actually present.
  const autoLinked = useRef(false);
  useEffect(() => {
    if (autoLinked.current || loadingMe || !needsLink) return;
    if (!new URLSearchParams(window.location.search).has('x')) return;
    autoLinked.current = true;
    void link();
  }, [loadingMe, needsLink, link]);

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Twitter className="h-4 w-4 text-[#E04D26]" />
        <h2 className="font-display text-sm font-[700] uppercase tracking-wide text-white">X wallet</h2>
      </div>

      <div className="rounded border border-white/[0.08] bg-bg p-5">
        {/* WHO this balance bets for. The relay routes a reply by X account, so the binding is the
            thing that makes a funded balance reachable from a tweet. It used to sit in small gray
            type UNDER the fund controls, which read as a footnote instead of the first step. */}
        {!loadingMe && (needsLink ? (
          // Signed in with X, but the relay does not route this wallet yet. The dangerous state:
          // funding here produces a balance no tweet can spend, and until now nothing said so.
          <div className="mb-4 rounded-lg border border-[#E04D26]/30 bg-[#E04D26]/[0.07] px-3.5 py-3">
            <div className="text-[13px] font-bold text-white">One more step to bet from @{me!.handle}.</div>
            <p className="mt-1 text-[12px] leading-snug text-gray-400">
              Point that account at this wallet, so a reply you tweet spends this balance and not some other.
            </p>
            <button
              onClick={link}
              disabled={!!busy}
              className="mt-2.5 inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-[#E04D26]/45 px-4 py-2 text-sm font-bold text-[#E04D26] transition-colors hover:bg-[#E04D26]/10 disabled:opacity-60"
            >
              <Twitter className="h-4 w-4" /> {busy === 'link' ? 'Linking…' : 'Link @' + me!.handle + ' to this wallet'}
            </button>
          </div>
        ) : connected ? (
          <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2">
            <Twitter className="h-3.5 w-3.5 shrink-0 text-[#E04D26]" />
            <span className="font-display text-sm font-[700] text-white">@{me!.handle}</span>
            <span className="text-[12px] text-gray-500">{routed ? 'bets from this balance' : 'signed in'}</span>
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-[#E04D26]/30 bg-[#E04D26]/[0.07] px-3.5 py-3">
            <div className="text-[13px] font-bold text-white">Connect X first, then fund.</div>
            <p className="mt-1 text-[12px] leading-snug text-gray-400">
              Your replies have to point at this balance. Until an X account is linked, a bet you tweet has nowhere to land.
            </p>
            {/* explicit hex, not text-black/text-white: the theme maps those onto the foreground
                colour, which rendered this button white-on-white in dark mode. */}
            <a
              href="/api/claim/x/start?return=/portfolio"
              className="mt-2.5 inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-[#E04D26]/45 px-4 py-2 text-sm font-bold text-[#E04D26] transition-colors hover:bg-[#E04D26]/10"
            >
              <Twitter className="h-4 w-4" /> Connect X
            </a>
          </div>
        ))}

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

        {/* how to actually spend it, plus any SEPARATE sealed auto-account waiting to be claimed.
            The connect CTA moved to the top of the card, so this block is only the follow-through. */}
        <div className="mt-4 border-t border-white/[0.06] pt-4">
          {loadingMe ? (
            <div className="text-sm text-gray-500">Checking your X connection…</div>
          ) : !connected ? (
            <div className="text-xs text-gray-500">Once X is linked, you bet by replying YES or NO to a live line.</div>
          ) : sealed ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="font-mono text-xs text-gray-400">tweet-funded account {short(sealed.address)} · <span className="text-white">${sealed.balanceDusdc.toFixed(2)}</span></div>
              <a href="/claim" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-white/[0.06]">
                Cash out <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <div className="text-xs text-gray-500">Reply YES or NO to a live line to place a bet. Minimum $1.15.</div>
          )}
        </div>
      </div>
    </section>
  );
}
