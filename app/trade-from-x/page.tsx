'use client';

// yosuku.xyz/trade-from-x — self-serve connect for trading by tweet.
//   1. connect wallet  2. deposit into your X-vault (gas-free)  3. get a one-time code
//   4. tweet "@yosukuapp connect <code>" — the relay redeems it and binds X -> your wallet.
// Custody is enforced on-chain: the agent can only ever open a position YOU own.
import { useState, useCallback } from 'react';
import Link from 'next/link';
import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { ArrowRight, ShieldCheck, Wallet, Coins, Twitter, Copy, Check, ExternalLink } from 'lucide-react';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { fetchDUSDCCoins } from '@/lib/sui/queries';
import { DUSDC_TYPE } from '@/lib/sui/constants';
import { NET } from '@/lib/sui/network';

const CONNECT_URL = process.env.NEXT_PUBLIC_CONNECT_URL || 'https://yosuku-connect.yosuku.workers.dev';
const SOCIAL_VAULT_ID = NET.socialVaultId;
const VAULT_PKG = NET.strategyPackage; // social_vault lives at the upgrade-#2 package
const DUSDC_MUL = 1_000_000;

export default function TradeFromXPage() {
  const account = useCurrentAccount();
  const { submit } = useSmartSubmit();
  const addr = account?.address ?? null;

  const [amount, setAmount] = useState('5');
  const [depositing, setDepositing] = useState(false);
  const [deposited, setDeposited] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const deposit = useCallback(async () => {
    if (!addr) return;
    setErr(''); setDepositing(true);
    try {
      const micro = BigInt(Math.round(parseFloat(amount || '0') * DUSDC_MUL));
      if (micro <= BigInt(0)) throw new Error('Enter an amount');
      const coins = await fetchDUSDCCoins(null as never, addr);
      if (!coins.length) throw new Error('No DUSDC in your wallet. Grab some from the faucet first.');
      await submit(() => {
        const tx = new Transaction();
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1, 15).map((c) => tx.object(c.coinObjectId)));
        const [dep] = tx.splitCoins(primary, [micro]);
        tx.moveCall({ target: `${VAULT_PKG}::social_vault::deposit`, typeArguments: [DUSDC_TYPE], arguments: [tx.object(SOCIAL_VAULT_ID), dep] });
        return tx;
      });
      setDeposited(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setDepositing(false); }
  }, [addr, amount, submit]);

  const getCode = useCallback(async () => {
    if (!addr) return;
    setErr(''); setBusy(true);
    try {
      const r = await fetch(`${CONNECT_URL}/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: addr }) });
      const j = await r.json();
      if (!r.ok || !j.code) throw new Error(j.error || 'Could not get a code — try again.');
      setCode(j.code);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [addr]);

  const tweetText = code ? `@yosukuapp connect ${code}` : '';
  const tweetHref = code ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}` : '#';
  const copy = () => { navigator.clipboard?.writeText(tweetText); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return (
    <main className="min-h-screen bg-[#08080b] text-white selection:bg-vermilion selection:text-white">
      <div className="sticky top-0 z-50 backdrop-blur bg-[#08080b]/70 border-b border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="font-display font-extrabold tracking-[0.18em] text-sm">YOSUKU <span className="text-gray-500 font-mono font-normal tracking-normal">/ trade from x</span></div>
          <Link href="/markets" className="font-mono text-[12px] text-vermilion inline-flex items-center gap-1.5">open the app <ArrowRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>

      <section className="max-w-3xl mx-auto px-6 pt-14 pb-8">
        <div className="font-mono text-[11px] tracking-[0.32em] text-vermilion/80 uppercase">予測 · trade from x</div>
        <h1 className="mt-5 font-display font-[800] tracking-tight text-[clamp(2.2rem,6vw,3.6rem)] leading-[1.02]">Trade by tweeting. <span className="font-jp italic text-vermilion">Un-drainably.</span></h1>
        <p className="mt-5 text-gray-400 leading-relaxed max-w-[58ch]">
          Connect once, then tweet your bets at <span className="text-white">@yosukuapp</span>. A bounded agent opens the position from <span className="text-white">your own</span> vault funds — and by design can only ever return funds to you. Even a perfect prompt injection gets nothing.
        </p>
      </section>

      {/* steps */}
      <section className="max-w-3xl mx-auto px-6 pb-20 space-y-4">
        {/* 1 — connect wallet */}
        <Step n="1" icon={Wallet} title="Connect your wallet" done={!!addr}>
          {addr ? (
            <div className="font-mono text-[13px] text-gray-300">connected · {addr.slice(0, 8)}…{addr.slice(-6)}</div>
          ) : (
            <div className="[&_button]:!bg-vermilion [&_button]:!rounded-full [&_button]:!font-display"><ConnectButton /></div>
          )}
        </Step>

        {/* 2 — deposit */}
        <Step n="2" icon={Coins} title="Fund your X-vault" done={deposited} dim={!addr}>
          <p className="text-[13px] text-gray-400 mb-3">Deposit DUSDC into your custodied vault — gas-free. Only you can ever withdraw it.</p>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 border border-white/10 rounded-xl px-3 py-2 focus-within:border-white/25">
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" disabled={!addr} className="bg-transparent w-20 outline-none font-mono text-lg" />
              <span className="text-gray-500 font-mono text-sm">DUSDC</span>
            </div>
            <button onClick={deposit} disabled={!addr || depositing} className="bg-white/10 hover:bg-white/15 disabled:opacity-40 transition-colors rounded-xl px-5 py-2.5 font-display font-bold text-sm">
              {depositing ? 'Depositing…' : deposited ? 'Deposit more' : 'Deposit'}
            </button>
          </div>
          {deposited && <div className="mt-2 font-mono text-[12px] text-new-mint">✓ funded</div>}
        </Step>

        {/* 3 — get code + tweet */}
        <Step n="3" icon={Twitter} title="Connect your X account" done={!!code} dim={!addr}>
          {!code ? (
            <>
              <p className="text-[13px] text-gray-400 mb-3">Get a one-time code, then tweet it from your X account to link it to this wallet.</p>
              <button onClick={getCode} disabled={!addr || busy} className="bg-vermilion hover:bg-vermilion-d disabled:opacity-40 transition-colors rounded-xl px-5 py-2.5 font-display font-bold text-sm inline-flex items-center gap-2">
                {busy ? 'Generating…' : 'Get my connect code'}
              </button>
            </>
          ) : (
            <div>
              <p className="text-[13px] text-gray-400 mb-2">Tweet this from your X account (it proves you own the handle):</p>
              <div className="flex items-center gap-2 border border-vermilion/40 bg-vermilion/[0.06] rounded-xl px-4 py-3">
                <code className="font-mono text-vermilion text-[15px] flex-1">@yosukuapp connect {code}</code>
                <button onClick={copy} className="text-gray-400 hover:text-white transition-colors">{copied ? <Check className="w-4 h-4 text-new-mint" /> : <Copy className="w-4 h-4" />}</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <a href={tweetHref} target="_blank" rel="noreferrer" className="bg-vermilion hover:bg-vermilion-d transition-colors rounded-full px-5 py-2.5 font-display font-bold text-sm inline-flex items-center gap-2">Open X to tweet <ArrowRight className="w-4 h-4" /></a>
              </div>
              <p className="mt-3 font-mono text-[11px] text-gray-500">Once the relay sees your tweet it replies “connected ✅”. Then just tweet your bets, e.g. <span className="text-gray-300">@yosukuapp BTC up 3x</span>. Code expires in 30 min.</p>
            </div>
          )}
        </Step>

        {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-[13px] text-rose-300 font-mono">{err}</div>}

        {/* trust */}
        <div className="mt-8 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent p-6">
          <div className="flex items-center gap-2 text-vermilion"><ShieldCheck className="w-5 h-5" /><span className="font-display font-bold">Why it can’t be drained</span></div>
          <p className="mt-2 text-[13.5px] text-gray-400 leading-relaxed">The agent signs with a bounded key whose only power over your funds is opening a position <span className="text-white">you</span> own; every exit force-pays you. The X-handle→wallet link is the only off-chain piece, and the contract only ever sees Sui addresses — so even a wrong link can’t divert anyone’s funds. Proven on-chain:</p>
          <div className="mt-3 flex flex-col gap-1.5">
            <a href="https://suiscan.xyz/testnet/tx/2cRyhNAVQRw7TGaDzgHWzkrDYVPfJrCMkKPFoxVSKnWt" target="_blank" rel="noreferrer" className="font-mono text-[12px] text-gray-400 hover:text-vermilion inline-flex items-center gap-2"><ExternalLink className="w-3.5 h-3.5" /> agent_trade (your funds, your order)</a>
            <a href="https://suiscan.xyz/testnet/tx/2PnQbQqR3bVyUWbT8PsUpb11QAzk27iRxaRz9e9igUb9" target="_blank" rel="noreferrer" className="font-mono text-[12px] text-gray-400 hover:text-vermilion inline-flex items-center gap-2"><ExternalLink className="w-3.5 h-3.5" /> filled into a position you own</a>
          </div>
        </div>
      </section>
    </main>
  );
}

function Step({ n, icon: Icon, title, done, dim, children }: { n: string; icon: typeof Wallet; title: string; done?: boolean; dim?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border p-5 transition-opacity ${done ? 'border-new-mint/30 bg-new-mint/[0.04]' : 'border-white/[0.08] bg-white/[0.02]'} ${dim ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-[13px] ${done ? 'bg-new-mint/20 text-new-mint' : 'bg-white/10 text-gray-300'}`}>{done ? '✓' : n}</div>
        <Icon className="w-4 h-4 text-gray-400" />
        <div className="font-display font-bold">{title}</div>
      </div>
      <div className="pl-10">{children}</div>
    </div>
  );
}
