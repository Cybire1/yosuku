'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Twitter, ArrowUpRight, ChevronDown, RefreshCw, Unlink } from 'lucide-react';
import {
  useConnectWallet,
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet,
  useSignPersonalMessage,
} from '@mysten/dapp-kit';
import { getSession, isEnokiWallet } from '@mysten/enoki';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { buildEnableTweetTrading624, buildTweetVaultWithdraw624, fetchTweetLedger624Micro } from '@/lib/sui/vault624Client';
import { fetchDUSDCCoins, fetchDUSDCHeldMicro } from '@/lib/sui/queries';
import { xLinkMessage, xUnlinkMessage } from '@/lib/xLink';

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
/** Wallet and RPC errors arrive as raw SDK strings. Translate the ones we know, pass anything
 *  else through rather than swallowing a real failure behind a friendly guess. */
function friendlyWalletError(raw: string): string {
  const e = raw.toLowerCase();
  if (/open popup|popup.*(block|fail)|window.*block/.test(e)) {
    return 'Your Google wallet session expired. Reconnect it, then try again.';
  }
  if (/user rejected|rejected the request|denied/.test(e)) return 'Cancelled.';
  if (/insufficient|balance too low|ebalancetoolow/.test(e)) return 'Not enough DUSDC in your wallet.';
  if (/no valid gas|gas coins|sponsor/.test(e)) return 'The gas sponsor is busy. Try again in a moment.';
  return raw.slice(0, 160);
}

export default function XWalletCard() {
  const account = useCurrentAccount();
  const { currentWallet } = useCurrentWallet();
  const { mutateAsync: disconnectWallet } = useDisconnectWallet();
  const { mutateAsync: connectWallet } = useConnectWallet();
  // No fallback address. A hardcoded one was left here as an audit scaffold, and because it is
  // an address that exists but holds nothing, every read below silently answered about IT rather
  // than about the person looking at the screen: balance $0.00, no coins, and "Not enough DUSDC
  // in your wallet. Grab some test DUSDC first." aimed at someone whose wallet was full. A wrong
  // answer is worse than no answer here, and every consumer below already guards on null.
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [me, setMe] = useState<XMe | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [balMicro, setBalMicro] = useState<bigint | null>(null);
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState<'' | 'fund' | 'cashout' | 'faucet' | 'link' | 'unlink' | 'reconnect'>('');
  const [manageX, setManageX] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [needsFaucet, setNeedsFaucet] = useState(false);
  const [needsWalletReconnect, setNeedsWalletReconnect] = useState(false);
  const reconnectWalletRef = useRef(currentWallet);

  // Enoki keeps exposing the deterministic zkLogin address after its signing session expires.
  // Reads still work, but a later write tries to open Google auth after transaction preparation,
  // when browsers reject the popup. Detect that state before the user presses Fund or Cash out.
  useEffect(() => {
    let cancelled = false;
    if (!currentWallet || !isEnokiWallet(currentWallet)) {
      if (!reconnectWalletRef.current) setNeedsWalletReconnect(false);
      return;
    }
    reconnectWalletRef.current = currentWallet;
    getSession(currentWallet, { network: 'testnet' })
      .then((session) => {
        if (!cancelled) setNeedsWalletReconnect(!session?.jwt || Date.now() >= session.expiresAt);
      })
      .catch(() => {
        if (!cancelled) setNeedsWalletReconnect(true);
      });
    return () => { cancelled = true; };
  }, [currentWallet, account?.address]);

  // Reauthentication is intentionally two explicit clicks. First clear the expired session;
  // then "Continue with Google" runs directly from a fresh click, so the browser permits Enoki's
  // authorization window. Chaining disconnect -> connect behind one click recreates the popup bug.
  const startWalletReconnect = useCallback(async () => {
    if (!currentWallet || busy) return;
    reconnectWalletRef.current = currentWallet;
    setErr(''); setOk(''); setBusy('reconnect');
    try {
      await disconnectWallet();
      setNeedsWalletReconnect(true);
      setOk('Continue with Google to authorize funding and cash-out.');
    } catch (e) {
      setErr(friendlyWalletError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy('');
    }
  }, [busy, currentWallet, disconnectWallet]);

  const finishWalletReconnect = useCallback(async () => {
    const wallet = reconnectWalletRef.current;
    if (!wallet || busy) return;
    setErr(''); setOk(''); setBusy('reconnect');
    try {
      await connectWallet({ wallet });
      setNeedsWalletReconnect(false);
      reconnectWalletRef.current = null;
      setOk('Wallet ready. You can fund or cash out now.');
    } catch (e) {
      setNeedsWalletReconnect(true);
      setErr(friendlyWalletError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy('');
    }
  }, [busy, connectWallet]);

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
      if (needsWalletReconnect) throw new Error('Your Google wallet session expired. Reconnect it, then try again.');
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
      const raw = e instanceof Error ? e.message : String(e);
      if (/failed to open popup|session.*expired/i.test(raw)) setNeedsWalletReconnect(true);
      setErr(friendlyWalletError(raw));
    } finally {
      setBusy('');
      void refreshBalance();
    }
  }, [address, amount, busy, needsWalletReconnect, submit, refreshBalance]);

  const cashOut = useCallback(async () => {
    if (!address || busy) return;
    setErr(''); setOk(''); setBusy('cashout');
    try {
      if (needsWalletReconnect) throw new Error('Your Google wallet session expired. Reconnect it, then try again.');
      const exact = await fetchTweetLedger624Micro(address); // freshest exact micro — withdraw wants the precise integer
      if (exact <= 0n) throw new Error('Nothing to cash out yet.');
      await submit(() => buildTweetVaultWithdraw624({ amountMicro: exact }));
      setOk(`Cashed out $${(Number(exact) / DUSDC_MUL).toFixed(2)} to your wallet.`);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (/failed to open popup|session.*expired/i.test(raw)) setNeedsWalletReconnect(true);
      setErr(friendlyWalletError(raw));
    } finally {
      setBusy('');
      void refreshBalance();
    }
  }, [address, busy, needsWalletReconnect, submit, refreshBalance]);

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
      setErr(friendlyWalletError(e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy('');
    }
  }, [address, busy]);

  // A successful signed session or a durable relay binding means X is connected. The username is
  // display metadata and can be absent during a transient X/relay lookup; it must not send the
  // user back through OAuth after they already authorized it.
  const connected = Boolean(me?.signedIn || me?.binding);
  const acct = me?.account ?? null;
  // a SEPARATE sealed auto-account (key held by us, cashed out via seal-decrypt at /claim) —
  // only surface it when it isn't the connected wallet itself (that balance already shows above).
  const sealed = acct && acct.balanceDusdc > 0 && address && acct.address.toLowerCase() !== address.toLowerCase() ? acct : null;

  // The state that actually decides whether a tweet can spend this balance: does the relay route
  // this wallet to an X account? Signed in with X is NOT enough on its own, and treating the two as
  // the same is what let people fund a balance their replies could never reach.
  const routed = !!me?.binding;
  const sessionMatchesBinding = !!me?.signedIn && !!me?.authorId && me.authorId === me.binding?.authorId;
  // A binding for the wallet is not enough after a fresh OAuth return. If that binding belongs to
  // another immutable X user ID, the wallet must sign the replacement before the new account can
  // touch the balance. Until then, the old route remains live and the funds remain unchanged.
  const needsLink = !!address && !!me?.signedIn && (!routed || !sessionMatchesBinding);

  const link = useCallback(async () => {
    if (!address || !me?.authorId || busy) return;
    setErr(''); setOk(''); setBusy('link');
    try {
      const { signature } = await signPersonalMessage({
        message: xLinkMessage(me.authorId, address),
      });
      const r = await fetch('/api/claim/x/link', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: address, signature }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        if (j?.reason === 'already_claimed_other' && j?.boundWallet) {
          throw new Error(`That X account is already pointed at ${short(String(j.boundWallet))}. Connect that wallet instead.`);
        }
        throw new Error(typeof j?.reason === 'string' && j.reason ? j.reason : 'Could not link this wallet. Please try again.');
      }
      // The relay has already committed the route when this response arrives. Reflect that fact
      // locally before re-reading it: otherwise the success message renders for a network round
      // trip beside the stale "One more step" card, which makes a completed link look unfinished.
      // The background refresh remains the source of truth and fills in any relay-side metadata.
      setMe((current) => current ? {
        ...current,
        binding: {
          authorId: me.authorId!,
          handle: current.handle,
          address: typeof j?.address === 'string' ? j.address : address,
          sealed: j?.mode === 'claimed',
        },
      } : current);
      setOk('Linked. Your replies now bet from this balance.');
      await refreshMe();
    } catch (e) {
      setErr(friendlyWalletError(e instanceof Error ? e.message : String(e)));
    } finally { setBusy(''); }
  }, [address, busy, me?.authorId, refreshMe, signPersonalMessage]);

  const unlink = useCallback(async () => {
    if (!address || !me?.authorId || !sessionMatchesBinding || busy) return;
    setErr(''); setOk(''); setBusy('unlink');
    try {
      const { signature } = await signPersonalMessage({
        message: xUnlinkMessage(me.authorId, address),
      });
      const response = await fetch('/api/claim/x/unlink', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: address, signature }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        if (body?.reason === 'sealed_binding_cannot_disconnect') {
          throw new Error('This X account secures a sealed recovery wallet and cannot be disconnected here.');
        }
        throw new Error(typeof body?.reason === 'string' && body.reason ? body.reason : 'Could not disconnect X.');
      }
      setManageX(false);
      setOk(`X disconnected. Your ${balNum?.toFixed(2) ?? '0.00'} DUSDC remains in this wallet's betting balance.`);
      await refreshMe();
    } catch (cause) {
      setErr(friendlyWalletError(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setBusy('');
    }
  }, [address, balNum, busy, me?.authorId, refreshMe, sessionMatchesBinding, signPersonalMessage]);

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('x') !== 'err') return;
    const reason = params.get('x_reason');
    const messages: Record<string, string> = {
      denied: 'X authorization was cancelled. Please try again.',
      state: 'Your X sign-in session expired. Please try again.',
      token: 'X could not complete the connection. Please try again.',
      profile: 'X connected, but your profile could not be read. Please try again.',
      config: 'X connection is temporarily unavailable.',
      server: 'X connection is temporarily unavailable. Please try again.',
    };
    if (reason?.startsWith('token_')) {
      const code = reason.slice('token_'.length);
      setErr(code === 'invalid_grant'
        ? 'Your X approval expired before it could finish. Please connect again.'
        : `X rejected the connection (${code.replaceAll('_', ' ')}). Please try again.`);
      return;
    }
    setErr(messages[reason || ''] || 'X authorization did not finish. Please try again.');
  }, []);

  return (
    <section id="x-wallet">
      <div className="mb-3 flex items-center gap-2">
        <Twitter className="h-4 w-4 text-[#E04D26]" />
        <h2 className="font-display text-sm font-[700] uppercase tracking-wide text-[#1A1612]">X wallet</h2>
      </div>

      <div className="ledger-plate">
        {/* WHO this balance bets for. The relay routes a reply by X account, so the binding is the
            thing that makes a funded balance reachable from a tweet. It used to sit in small gray
            type UNDER the fund controls, which read as a footnote instead of the first step. */}
        {!loadingMe && (needsLink ? (
          // Signed in with X, but the relay does not route this wallet yet. The dangerous state:
          // funding here produces a balance no tweet can spend, and until now nothing said so.
          <div className="mb-4 rounded-lg border border-[#E04D26]/30 bg-[#E04D26]/[0.07] px-3.5 py-3">
            <div className="text-[13px] font-bold text-[#1A1612]">
              {routed ? `Switch @${me?.binding?.handle || 'linked account'} to @${me!.handle}?` : `One more step to bet from @${me!.handle}.`}
            </div>
            {routed && (
              <p className="mt-1 text-[12px] leading-snug text-[#6B6353]">
                Your balance stays here. Only which X account can bet changes.
              </p>
            )}
            <button
              onClick={link}
              disabled={!!busy}
              className="mt-2.5 inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-[#E04D26]/45 px-4 py-2 text-sm font-bold text-[#E04D26] transition-colors hover:bg-[#E04D26]/10 disabled:opacity-60"
            >
              <Twitter className="h-4 w-4" /> {busy === 'link' ? 'Linking…' : routed ? `Use @${me!.handle}` : `Link @${me!.handle} to this wallet`}
            </button>
          </div>
        ) : connected ? (
          <div className="relative mb-4">
            <button
              type="button"
              onClick={() => setManageX((value) => !value)}
              aria-expanded={manageX}
              className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left"
            >
              <Twitter className="h-3.5 w-3.5 shrink-0 text-[#E04D26]" />
              <span className="font-display text-sm font-[700] text-[#1A1612]">{me?.binding?.handle ? `@${me.binding.handle}` : 'X connected'}</span>
              <ChevronDown className={`ml-auto h-3.5 w-3.5 text-[#6B6353] transition-transform ${manageX ? 'rotate-180' : ''}`} />
            </button>
            {manageX && (
              <div className={`mt-2 grid gap-2 rounded-lg border border-[#C9BFA6]/50 bg-[#FFFDF8] p-2 ${me?.binding?.sealed ? '' : 'sm:grid-cols-2'}`}>
                <a
                  href="/api/claim/x/start?return=/portfolio"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#C9BFA6]/60 px-3 py-2 text-[12px] font-bold text-[#1A1612] transition-colors hover:bg-[#E04D26]/[0.06]"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Switch X account
                </a>
                {me?.binding?.sealed ? null : sessionMatchesBinding ? (
                  <button
                    type="button"
                    onClick={unlink}
                    disabled={!!busy}
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold text-[#B53D30] transition-colors hover:bg-[#B53D30]/[0.06] disabled:opacity-50"
                  >
                    <Unlink className="h-3.5 w-3.5" /> {busy === 'unlink' ? 'Disconnecting…' : 'Disconnect X'}
                  </button>
                ) : (
                  <a
                    href="/api/claim/x/start?return=/portfolio"
                    className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold text-[#6B6353]"
                  >
                    Verify to disconnect
                  </a>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-[#E04D26]/30 bg-[#E04D26]/[0.07] px-3.5 py-3">
            <div className="text-[13px] font-bold text-[#1A1612]">Connect X first, then fund.</div>
            {/* explicit hex, not text-black/text-[#1A1612]: the theme maps those onto the foreground
                colour, which rendered this button white-on-white in dark mode. */}
            <a
              href="/api/claim/x/start?return=/portfolio"
              className="mt-2.5 inline-flex items-center gap-2 whitespace-nowrap rounded-xl border border-[#E04D26]/45 px-4 py-2 text-sm font-bold text-[#E04D26] transition-colors hover:bg-[#E04D26]/10"
            >
              <Twitter className="h-4 w-4" /> Connect X
            </a>
            {err && <div className="mt-2 text-[12px] text-[#E04D26]">{err}</div>}
          </div>
        ))}

        {needsWalletReconnect && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E04D26]/30 bg-[#E04D26]/[0.07] px-3.5 py-3">
            <div>
              <div className="text-[13px] font-bold text-[#1A1612]">Wallet authorization needed</div>
              <p className="mt-0.5 text-[12px] text-[#6B6353]">Your balance is safe.</p>
            </div>
            <button
              onClick={currentWallet ? startWalletReconnect : finishWalletReconnect}
              disabled={!!busy}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-lg px-4 py-2 font-display text-[12px] font-bold transition-opacity disabled:opacity-40"
              style={{ background: '#1A1612', color: '#FBF7EE' }}
            >
              {busy === 'reconnect' ? 'Opening…' : currentWallet ? 'Reconnect wallet' : 'Continue with Google'}
            </button>
          </div>
        )}

        {!address ? (
          !needsWalletReconnect && <div className="text-sm text-[#6B6353]">Connect your Sui wallet to fund your X betting balance.</div>
        ) : (
          <>
            {/* balance + cash out */}
            <div className="flex items-end justify-between gap-4">
              <div>
                <span className="font-mono text-[9px] tracking-[0.16em] uppercase" style={{ color: '#6B6353' }}>
                  Your X betting balance
                </span>
                <div className="font-mono text-3xl font-semibold mt-1 tabular-nums" style={{ color: '#E04D26' }}>
                  {balNum == null ? '0.00' : balNum.toFixed(2)}
                  <span className="text-sm ml-2" style={{ color: '#6B6353' }}>DUSDC</span>
                </div>

              </div>
              {balMicro != null && balMicro > 0n && (
                <button
                  onClick={cashOut}
                  disabled={!!busy}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-5 py-2 font-display text-[12px] font-bold uppercase tracking-[0.1em] transition-opacity disabled:opacity-40"
                  style={{ background: 'transparent', border: '1px solid rgba(201,191,166,0.7)', color: '#1A1612' }}
                >
                  {busy === 'cashout' ? 'Cashing out' : 'Cash out'} <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* fund controls */}
            <div className="mt-6 pt-5 flex flex-col gap-2.5 sm:flex-row sm:items-center" style={{ borderTop: '1px solid rgba(201,191,166,0.3)' }}>
              <div className="flex items-center gap-1.5">
                {QUICK.map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className="rounded-lg px-3 py-2 font-mono text-xs transition-colors"
                    style={amount === v
                      ? { border: '1px solid #1A1612', color: '#1A1612' }
                      : { border: '1px solid rgba(201,191,166,0.6)', color: '#6B6353' }}
                  >${v}</button>
                ))}
                <div className="flex items-center gap-1 rounded-lg px-3 py-2" style={{ border: '1px solid rgba(201,191,166,0.6)', background: '#FFFDF8' }}>
                  <span className="text-sm" style={{ color: '#6B6353' }}>$</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    aria-label="Amount to fund in DUSDC"
                    className="w-14 bg-transparent text-sm outline-none"
                    style={{ color: '#1A1612' }}
                  />
                  <span className="font-mono text-[10px]" style={{ color: '#6B6353' }}>DUSDC</span>
                </div>
              </div>
              <button
                onClick={fund}
                disabled={!!busy}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-lg px-5 py-2 font-display text-[12px] font-bold uppercase tracking-[0.1em] transition-opacity disabled:opacity-40"
                style={{ background: '#1A1612', color: '#FBF7EE' }}
              >
                {busy === 'fund' ? 'Funding' : 'Fund'}
              </button>
            </div>

            <p className="mt-3 font-mono text-[10px] leading-snug" style={{ color: '#6B6353' }}>
              The agent can bet from this balance. Only you can cash out.
            </p>

            {needsFaucet && (
              <button
                onClick={getFaucet}
                disabled={!!busy}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-[#1A1612] transition-colors hover:bg-white/[0.06] disabled:opacity-50"
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
            <div className="text-sm text-[#6B6353]">Checking…</div>
          ) : !connected ? null : sealed ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="font-mono text-xs text-[#6B6353]"><span className="text-[#1A1612]">${sealed.balanceDusdc.toFixed(2)}</span> in your tweet-funded account</div>
              <a href="/claim" className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-4 py-2 text-sm font-bold text-[#1A1612] transition-colors hover:bg-white/[0.06]">
                Cash out <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <div className="text-xs text-[#6B6353]">Reply YES or NO to a live line. Minimum $1.15.</div>
          )}
        </div>
      </div>
    </section>
  );
}
