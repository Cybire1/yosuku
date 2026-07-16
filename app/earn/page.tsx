'use client';

import { useState, useEffect } from 'react';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import SectionHeader from '@/components/SectionHeader';
import { useDUSDCBalance, usePLPBalance, useVaultStats } from '@/lib/sui/hooks';
import { supplyTx, withdrawTx, cancelOrderTx, settleTx, type PositionData } from '@/lib/sui/leverageClient';
import { supplyLpTx, withdrawAllPlpTx } from '@/lib/sui/predictClient';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { fetchOracles, type OracleData } from '@/lib/sui/predictApi';

const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

function outcome(p: PositionData, o: OracleData | undefined): 'pending' | 'won' | 'lost' {
  const settled = o && o.settlement_price !== null && o.settlement_price !== undefined && (o.status === 'settled' || Date.now() > Number(p.expiry));
  if (!settled || o!.settlement_price == null) return 'pending';
  const s = o!.settlement_price;
  if (p.isRange) return (s >= Number(p.lowerStrike) && s <= Number(p.higherStrike)) ? 'won' : 'lost';
  return (p.isUp ? s > Number(p.lowerStrike) : s <= Number(p.lowerStrike)) ? 'won' : 'lost';
}

// utilization donut — the reserve's active capital share, rendered as an arc
export default function EarnPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();

  // ── Protocol vault / PLP (the real, passive yield) ──
  // Everything below reads the live Predict object straight from chain (useVaultStats).
  // The old indexer summary/performance endpoints (predict-server …/vault/summary and
  // …/vault/performance) are dead — the legacy server can no longer read the object —
  // so nothing here depends on them anymore. No history source ⇒ no sparkline: we only
  // render numbers we actually have.
  const { stats: vaultStats, refresh: refreshVault } = useVaultStats();
  const { balance: plpBalance, coins: plpCoins, refresh: refreshPlp } = usePLPBalance();
  const { coins: dusdcCoins, refresh: refreshDusdc } = useDUSDCBalance();

  // ── Leverage reserve (advanced) ──

  const [plpAmount, setPlpAmount] = useState('');
  const [resAmount, setResAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [oracles, setOracles] = useState<Record<string, OracleData>>({});

  useEffect(() => {
    let on = true;
    const load = () => fetchOracles().then((os) => { if (on) setOracles(Object.fromEntries(os.map((o) => [o.oracle_id, o]))); }).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => { on = false; clearInterval(t); };
  }, []);

  // All vault figures derive from ONE live on-chain read — real numbers or nothing.
  const vaultValue = vaultStats ? vaultStats.vaultValue / DUSDC_MULTIPLIER : null;
  const sharePrice = vaultStats && vaultStats.totalPlpSupply > 0
    ? vaultStats.vaultValue / vaultStats.totalPlpSupply
    : null;
  const utilization = vaultStats && vaultStats.balance > 0
    ? vaultStats.maxPayout / vaultStats.balance
    : null;
  const myPlp = plpBalance / DUSDC_MULTIPLIER;
  const myValue = vaultStats && vaultStats.totalPlpSupply > 0
    ? (plpBalance / vaultStats.totalPlpSupply) * (vaultStats.vaultValue / DUSDC_MULTIPLIER)
    : sharePrice != null ? myPlp * sharePrice : 0;
  const walletDusdc = dusdcCoins.reduce((s, c) => s + Number(c.balance), 0) / DUSDC_MULTIPLIER;

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setMsg('');
    try {
      await fn();
      setMsg('Done ✓');
      setTimeout(() => { refreshVault(); refreshPlp(); refreshDusdc(); }, 1200);
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 120) : String(e));
    } finally { setBusy(null); }
  }

  // ── PLP handlers ──
  async function doDepositPlp() {
    if (!address) return;
    const walletMicro = BigInt(dusdcCoins.reduce((s, c) => s + Number(c.balance), 0));
    let micro = BigInt(Math.floor(Number(plpAmount) * DUSDC_MULTIPLIER));
    if (micro <= BigInt(0)) { setMsg('Enter an amount'); return; }
    if (walletMicro <= BigInt(0)) { setMsg('No DUSDC in your wallet — claim some from the faucet first.'); return; }
    if (micro > walletMicro) micro = walletMicro;
    await run('plp-deposit', async () => { await submit(() => supplyLpTx(dusdcCoins.map((c) => c.coinObjectId), micro, address)); setPlpAmount(''); });
  }
  async function doWithdrawPlp() {
    if (!address || plpCoins.length === 0) return;
    await run('plp-withdraw', async () => { await submit(() => withdrawAllPlpTx(plpCoins.map((c) => c.coinObjectId), address)); });
  }

  // ── Reserve handlers ──
  async function doSupplyReserve() {
    if (!address) return;
    const walletMicro = BigInt(dusdcCoins.reduce((s, c) => s + Number(c.balance), 0));
    let micro = BigInt(Math.floor(Number(resAmount) * DUSDC_MULTIPLIER));
    if (micro <= BigInt(0)) { setMsg('Enter an amount'); return; }
    if (walletMicro <= BigInt(0)) { setMsg('No DUSDC in your wallet to supply.'); return; }
    if (micro > walletMicro) micro = walletMicro;
    await run('res-supply', async () => { await submit(() => supplyTx(dusdcCoins.map((c) => c.coinObjectId), micro, address)); setResAmount(''); });
  }
  async function doWithdrawReserve(id: string) {
    if (!address) return;
    await run('w:' + id, async () => { await submit(() => withdrawTx(id, address)); });
  }
  async function doCancel(id: string) {
    if (!address) return;
    await run('x:' + id, async () => { await submit(() => cancelOrderTx(id, address)); });
  }
  // Permissionless self-settle: redeem the won position, repay the reserve, force-pay the
  // owner — works even if the keeper is down. Exposed to the position owner, not just the keeper.
  async function doSettle(p: PositionData) {
    if (!address) return;
    await run('s:' + p.id, async () => {
      await submit(() => settleTx({
        positionId: p.id, managerId: p.managerId, oracleId: p.oracleId,
        expiry: p.expiry, strike: p.lowerStrike, isUp: p.isUp, quantity: p.quantity,
      }));
    });
  }

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      {/* Hero — protocol vault yield */}
      <section className="page-hero">
        <span className="crop tl" /><span className="crop tr" /><span className="crop bl" /><span className="crop br" />
        {/* bottom corner metas removed — the live panel carries those numbers now, and they
            collided with the panel's lower edge at ~1280px */}

        <div className="container">
          <div className="breadcrumb">
            <a href="/" data-cursor="hover">Home</a>
            <span className="sep">/</span>
            <span style={{ color: 'var(--white)' }}>Earn</span>
          </div>

          <div className="hero-grid">
            <div className="hero-left">
              <h1 className="page-title">
                Earn the<br />
                <span className="accent">spread</span>.
              </h1>
            </div>

            {/* live vault dashboard — every number is the live on-chain object, or the panel says so */}
            <div className="earn-vault p-6 md:p-8 backdrop-blur-sm">
              <div className="earn-vault-glow" />
              <div className="earn-vault-accent" />
              {vaultStats ? (
                <div className="relative">
                  <div className="flex items-center justify-between mb-6">
                    <span className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] uppercase text-gray-500"><span className="earn-livedot" /> live vault</span>
                    <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-gray-500">Predict PLP</span>
                  </div>

                  {/* share price is the hero — with its growth since par + a rising micro-line */}
                  <div className="flex items-end gap-3">
                    <div className="font-display text-[clamp(2.8rem,5vw,3.5rem)] font-extrabold leading-[0.88] tracking-tight tabular-nums">
                      {sharePrice != null ? sharePrice.toFixed(4) : '—'}
                    </div>
                    {sharePrice != null && sharePrice > 1.0001 && (
                      <span className="earn-chipg rounded-full px-2.5 py-1 mb-1 inline-flex items-center gap-1.5 font-mono text-[11px] text-new-mint">
                        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden><path d="M4 0 L8 7 L0 7 Z" fill="#34D399" /></svg>
                        {((sharePrice - 1) * 100).toFixed(2)}%
                      </span>
                    )}
                  </div>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gray-500">Value per share</span>
                    <span className="font-mono text-[10px] text-gray-500/70 hidden sm:inline">· since 1.0000 par</span>
                    <svg width="58" height="16" viewBox="0 0 58 16" className="ml-auto shrink-0 opacity-90" aria-hidden>
                      <path d="M1,15 C15,13 26,11 36,7 C44,4 52,3 57,1" fill="none" stroke="#34D399" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>

                  <div className="earn-hair my-6" />

                  <div className="grid grid-cols-2 gap-5">
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-gray-500">Vault value</div>
                      <div className="font-mono text-[15px] tabular-nums">{vaultValue != null ? fmt(vaultValue) : '—'} <span className="text-xs text-gray-500">DUSDC</span></div>
                    </div>
                    <div>
                      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-gray-500">Utilization</div>
                      <div className="font-mono text-[15px] text-vermilion tabular-nums mb-2">{utilization != null ? `${(utilization * 100).toFixed(1)}%` : '—'}</div>
                      <div className="earn-meter"><div className="earn-meter-fill" style={{ width: `max(4px, ${Math.min(100, (utilization ?? 0) * 100)}%)` }} /></div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="relative font-mono text-xs text-gray-500 py-3">loading the vault…</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <main>
        <div className="container max-w-5xl mx-auto pt-6 md:pt-10 pb-16">
          <>
              <SectionHeader number="01" title="Supply the vault" meta="withdraw anytime" />
              <div className="grid md:grid-cols-2 gap-5 mb-10">
                {/* deposit */}
                <div className="earn-card p-6">
                  {!address ? (
                    <div className="py-8 text-center">
                      <p className="font-mono text-xs text-gray-500 mb-4">Connect a wallet to supply.</p>
                      <div className="flex justify-center"><ConnectButton /></div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between mb-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600">Amount</span>
                        <span className="font-mono text-[10px] text-gray-600">wallet {fmt(walletDusdc)} DUSDC</span>
                      </div>
                      <div className="flex items-center gap-2 earn-field rounded-xl px-4 py-3.5 mb-3">
                        <input value={plpAmount} onChange={(e) => setPlpAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal" className="bg-transparent flex-1 outline-none font-mono text-2xl min-w-0" />
                        <button onClick={() => setPlpAmount((Math.floor(walletDusdc * 100) / 100).toFixed(2))} className="font-mono text-[10px] uppercase tracking-wider text-vermilion hover:text-white transition-colors">Max</button>
                        <span className="font-mono text-sm text-gray-500">DUSDC</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {['50', '100', '250', '500'].map((a) => (
                          <button key={a} onClick={() => setPlpAmount(a)} className={`rounded-lg py-2 font-mono text-xs border transition-all ${plpAmount === a ? 'bg-vermilion/15 border-vermilion/50 text-white' : 'earn-chip text-gray-500 hover:text-gray-300'}`}>{a}</button>
                        ))}
                      </div>
                      <button onClick={doDepositPlp} disabled={busy === 'plp-deposit'} className="block w-full sm:w-auto sm:mx-auto sm:px-16 bg-vermilion text-white font-semibold rounded-full py-3.5 hover:bg-vermilion-d active:scale-[0.98] transition-all disabled:opacity-60">
                        {busy === 'plp-deposit' ? 'Supplying…' : 'Supply DUSDC'}
                      </button>
                    </>
                  )}
                </div>

                {/* your position */}
                <div className="earn-card p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600 mb-4">Your position</div>
                  {!address ? (
                    <p className="font-mono text-xs text-gray-500 py-10 text-center">Connect a wallet to see it.</p>
                  ) : plpBalance <= 0 ? (
                    <p className="font-mono text-xs text-gray-500 py-10 text-center">Nothing here yet. Add funds to start earning.</p>
                  ) : (
                    <>
                      <div className="font-display text-4xl font-extrabold tracking-tight">{fmt(myValue)} <span className="text-base text-gray-500 font-mono font-normal">DUSDC</span></div>
                      <div className="font-mono text-[11px] text-gray-500 mt-1 mb-5">{fmt(myPlp)} shares · at {sharePrice != null ? sharePrice.toFixed(4) : '—'} / share</div>
                      <button onClick={doWithdrawPlp} disabled={busy === 'plp-withdraw' || plpCoins.length === 0} className="w-full earn-ghost rounded-full py-3 font-mono text-xs uppercase tracking-wider text-vermilion hover:text-white transition-colors disabled:opacity-50">
                        {busy === 'plp-withdraw' ? 'Withdrawing…' : 'Withdraw all'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>

          {msg && <p className={`text-center mt-8 text-[12px] font-mono ${msg.includes('✓') ? 'text-gray-300' : 'text-vermilion'}`}>{msg}</p>}
        </div>
        {/* the global 120px footer top-margin leaves a void on this short page —
            neutralize it so the footer follows content at a normal rhythm */}
        <div className="[&_.footer]:mt-0">
          <Footer />
        </div>
      </main>
    </div>
  );
}

