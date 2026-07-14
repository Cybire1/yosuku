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
import { useReserveStats, useMySupply, useMyPositions, useMyOrders } from '@/lib/sui/leverageHooks';
import { supplyTx, withdrawTx, cancelOrderTx, settleTx, type PositionData } from '@/lib/sui/leverageClient';
import { supplyLpTx, withdrawAllPlpTx } from '@/lib/sui/predictClient';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { fetchOracles, type OracleData } from '@/lib/sui/predictApi';

const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function outcome(p: PositionData, o: OracleData | undefined): 'pending' | 'won' | 'lost' {
  const settled = o && o.settlement_price !== null && o.settlement_price !== undefined && (o.status === 'settled' || Date.now() > Number(p.expiry));
  if (!settled || o!.settlement_price == null) return 'pending';
  const s = o!.settlement_price;
  if (p.isRange) return (s >= Number(p.lowerStrike) && s <= Number(p.higherStrike)) ? 'won' : 'lost';
  return (p.isUp ? s > Number(p.lowerStrike) : s <= Number(p.lowerStrike)) ? 'won' : 'lost';
}

// utilization donut — the reserve's active capital share, rendered as an arc
function Gauge({ bps }: { bps: number }) {
  const p = Math.min(1, Math.max(0, bps / 10000));
  const R = 52, C = 2 * Math.PI * R;
  return (
    <svg width="132" height="132" viewBox="0 0 132 132" className="block shrink-0">
      <circle cx="66" cy="66" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9" />
      <circle
        cx="66" cy="66" r={R} fill="none" stroke="var(--vermilion)" strokeWidth="9" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 66 66)"
        style={{ filter: 'drop-shadow(0 0 8px rgba(224,77,38,0.45))' }}
      />
      <text x="66" y="61" textAnchor="middle" className="fill-white" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 27 }}>{(p * 100).toFixed(0)}%</text>
      <text x="66" y="81" textAnchor="middle" style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: 3, fill: 'var(--gray-500)' }}>IN USE</text>
    </svg>
  );
}

export default function EarnPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const [tab, setTab] = useState<'yield' | 'leverage'>('yield');

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
  const { stats: reserveStats, refresh: refreshReserve } = useReserveStats();
  const { positions: supplies, refresh: refreshSupplies } = useMySupply(reserveStats);
  const { positions: myPositions, refresh: refreshPos } = useMyPositions();
  const { orders: myOrders, refresh: refreshOrders } = useMyOrders();

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
  const availableWithdraw = vaultStats ? vaultStats.availableForWithdraw / DUSDC_MULTIPLIER : null;
  const utilization = vaultStats && vaultStats.balance > 0
    ? vaultStats.maxPayout / vaultStats.balance
    : null;
  const myPlp = plpBalance / DUSDC_MULTIPLIER;
  const myValue = vaultStats && vaultStats.totalPlpSupply > 0
    ? (plpBalance / vaultStats.totalPlpSupply) * (vaultStats.vaultValue / DUSDC_MULTIPLIER)
    : sharePrice != null ? myPlp * sharePrice : 0;
  const walletDusdc = dusdcCoins.reduce((s, c) => s + Number(c.balance), 0) / DUSDC_MULTIPLIER;
  const suppliedReserve = supplies.reduce((s, p) => s + p.value, 0);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setMsg('');
    try {
      await fn();
      setMsg('Done ✓');
      setTimeout(() => { refreshVault(); refreshPlp(); refreshDusdc(); refreshReserve(); refreshSupplies(); refreshPos(); refreshOrders(); }, 1200);
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
              {/* one text node so it reads as a single line — flex segments used to wrap into two columns on phones */}
              <div className="eyebrow">
                <span className="dash" />
                <span className="live-dot" />
                <span className="whitespace-nowrap">Be the house · earn the spread</span>
              </div>
              <h1 className="page-title">
                Earn real<br />
                <span className="accent">yield</span>.
              </h1>
              <p className="mt-6 max-w-md text-gray-400 leading-relaxed text-[15px]">
                Supply DUSDC to the protocol vault and earn the trading spread on every market — passive, and
                withdrawable anytime. The share price reflects yield as it accrues; it can dip if the vault takes losses.
              </p>
            </div>

            {/* live vault dashboard — every number below is the live on-chain object, or the panel says so */}
            <div className="rounded-2xl border border-white/[0.10] bg-gradient-to-b from-white/[0.04] to-transparent p-5 md:p-7 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gray-500 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-vermilion" style={{ boxShadow: '0 0 8px var(--vermilion)' }} /> Live vault
                </span>
                <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-gray-700">金庫 · on-chain</span>
              </div>
              {vaultStats ? (
                <>
                  <div className="font-display text-4xl font-extrabold tracking-tight">
                    {sharePrice != null ? sharePrice.toFixed(4) : '—'}
                    <span className="text-sm text-gray-500 font-mono font-normal ml-2">DUSDC / share</span>
                  </div>
                  <div className="mt-1.5 font-mono text-[11px] text-gray-600">yield accrues into the share price</div>
                  <div className="mt-5 space-y-3.5">
                    <ReserveRow label="Vault value" value={vaultValue != null ? fmt(vaultValue) : '—'} unit="DUSDC" />
                    <ReserveRow label="Available to withdraw" value={availableWithdraw != null ? fmt(availableWithdraw) : '—'} unit="DUSDC" />
                    <ReserveRow label="Utilization" value={utilization != null ? `${(utilization * 100).toFixed(1)}%` : '—'} accent />
                  </div>
                </>
              ) : (
                <p className="font-mono text-xs text-gray-600 py-3">syncing vault from chain…</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <main>
        <div className="container max-w-5xl mx-auto pt-6 md:pt-10 pb-24">
          {/* tab toggle — sits above the content it switches; page bottom padding + the global
              body clearance keep everything clear of the floating bottom nav on phones */}
          <div className="flex items-center gap-7 border-b border-white/[0.07] mb-8 md:mb-10">
            {([['yield', 'Earn yield'], ['leverage', 'Back leverage']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                style={{ outline: 'none' }}
                className={`relative pb-3 text-sm font-bold transition-colors ${tab === k ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {label}
                {k === 'leverage' && <span className="ml-2 font-mono text-[9px] uppercase tracking-wider text-gray-600">advanced</span>}
                {tab === k && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-vermilion" />}
              </button>
            ))}
          </div>

          {tab === 'yield' ? (
            <>
              <SectionHeader number="01" title="Supply the vault" desc="Earn the trading spread on every market. Your PLP rises in value as the vault earns." meta="withdraw anytime" />
              <div className="grid md:grid-cols-2 gap-5 mb-10">
                {/* deposit */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                  {!address ? (
                    <div className="py-8 text-center">
                      <p className="font-mono text-xs text-gray-500 mb-4">Connect a wallet to supply.</p>
                      <div className="flex justify-center"><ConnectButton /></div>
                    </div>
                  ) : (
                    <>
                      <p className="font-mono text-[11px] text-gray-500 mb-5 leading-relaxed">
                        You receive PLP at the live share price. Its value rises as the vault earns the spread — and can dip if the vault takes losses.
                      </p>
                      <div className="flex items-baseline justify-between mb-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600">Amount</span>
                        <span className="font-mono text-[10px] text-gray-600">wallet {fmt(walletDusdc)} DUSDC</span>
                      </div>
                      <div className="flex items-center gap-2 border border-white/10 rounded-xl px-4 py-3.5 mb-3 focus-within:border-white/25 transition-colors">
                        <input value={plpAmount} onChange={(e) => setPlpAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal" className="bg-transparent flex-1 outline-none font-mono text-2xl min-w-0" />
                        <button onClick={() => setPlpAmount((Math.floor(walletDusdc * 100) / 100).toFixed(2))} className="font-mono text-[10px] uppercase tracking-wider text-vermilion hover:text-white transition-colors">Max</button>
                        <span className="font-mono text-sm text-gray-500">DUSDC</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {['50', '100', '250', '500'].map((a) => (
                          <button key={a} onClick={() => setPlpAmount(a)} className={`rounded-lg py-2 font-mono text-xs border transition-all ${plpAmount === a ? 'bg-vermilion/15 border-vermilion/50 text-white' : 'border-white/10 text-gray-500 hover:text-gray-300'}`}>{a}</button>
                        ))}
                      </div>
                      <button onClick={doDepositPlp} disabled={busy === 'plp-deposit'} className="w-full bg-vermilion text-white font-semibold rounded-full py-3.5 hover:bg-vermilion-d active:scale-[0.98] transition-all disabled:opacity-60">
                        {busy === 'plp-deposit' ? 'Supplying…' : 'Supply DUSDC'}
                      </button>
                    </>
                  )}
                </div>

                {/* your position */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600 mb-4">Your position</div>
                  {!address ? (
                    <p className="font-mono text-xs text-gray-500 py-10 text-center">Connect a wallet to see it.</p>
                  ) : plpBalance <= 0 ? (
                    <p className="font-mono text-xs text-gray-500 py-10 text-center">No PLP yet. Supply to start earning.</p>
                  ) : (
                    <>
                      <div className="font-display text-4xl font-extrabold tracking-tight">{fmt(myValue)} <span className="text-base text-gray-500 font-mono font-normal">DUSDC</span></div>
                      <div className="font-mono text-[11px] text-gray-500 mt-1 mb-5">{fmt(myPlp)} PLP · at {sharePrice != null ? sharePrice.toFixed(4) : '—'} / share</div>
                      <button onClick={doWithdrawPlp} disabled={busy === 'plp-withdraw' || plpCoins.length === 0} className="w-full border border-white/15 rounded-full py-3 font-mono text-xs uppercase tracking-wider text-vermilion hover:text-white hover:border-white/30 transition-colors disabled:opacity-50">
                        {busy === 'plp-withdraw' ? 'Withdrawing…' : 'Withdraw all'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="font-mono text-[10px] text-gray-700 text-center tracking-wider">protocol vault (PLP) · share price &amp; yield are live on-chain · testnet</p>
            </>
          ) : (
            <>
              <SectionHeader number="01" title="Back boosted trades" desc="Supply DUSDC to the leverage reserve — back the extra exposure traders take and earn the premium they pay. Wins repay the reserve first; losses are absorbed by it." meta="higher yield · higher risk" />

              {/* reserve dashboard */}
              <div className="rounded-2xl border border-white/[0.10] bg-white/[0.02] p-6 mb-6 flex items-center gap-6 flex-wrap">
                <Gauge bps={reserveStats?.utilizationBps ?? 0} />
                <div className="flex-1 min-w-[220px] space-y-3.5">
                  <ReserveRow label="Reserve value" value={reserveStats ? fmt(reserveStats.totalValue) : '—'} unit="DUSDC" big />
                  <ReserveRow label="Available liquidity" value={reserveStats ? fmt(reserveStats.liquid) : '—'} unit="DUSDC" />
                  <ReserveRow label="Premium charged" value={reserveStats ? pct(reserveStats.premiumBps) : '—'} accent />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5 mb-10">
                {/* supply reserve */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                  {!address ? (
                    <p className="font-mono text-xs text-gray-500 py-10 text-center">Connect a wallet to supply.</p>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between mb-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600">Amount</span>
                        <span className="font-mono text-[10px] text-gray-600">wallet {fmt(walletDusdc)} DUSDC</span>
                      </div>
                      <div className="flex items-center gap-2 border border-white/10 rounded-xl px-4 py-3.5 mb-4 focus-within:border-white/25 transition-colors">
                        <input value={resAmount} onChange={(e) => setResAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal" className="bg-transparent flex-1 outline-none font-mono text-2xl min-w-0" />
                        <button onClick={() => setResAmount((Math.floor(walletDusdc * 100) / 100).toFixed(2))} className="font-mono text-[10px] uppercase tracking-wider text-vermilion hover:text-white transition-colors">Max</button>
                        <span className="font-mono text-sm text-gray-500">DUSDC</span>
                      </div>
                      <button onClick={doSupplyReserve} disabled={busy === 'res-supply'} className="w-full bg-white text-black font-semibold rounded-full py-3.5 hover:scale-[1.01] active:scale-[0.98] transition-transform disabled:opacity-60">
                        {busy === 'res-supply' ? 'Supplying…' : 'Supply to reserve'}
                      </button>
                      <p className="font-mono text-[11px] text-gray-600 mt-3.5 leading-relaxed">
                        Earns the {reserveStats ? pct(reserveStats.premiumBps) : '—'} fee on every leveraged trade · your value grows with fees, and dips when a boosted trade loses.
                      </p>
                    </>
                  )}
                </div>

                {/* your reserve supply */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600 mb-4">Your reserve position</div>
                  {!address ? (
                    <p className="font-mono text-xs text-gray-500 py-10 text-center">Connect a wallet to see it.</p>
                  ) : supplies.length === 0 ? (
                    <p className="font-mono text-xs text-gray-500 py-10 text-center">No active supply yet.</p>
                  ) : (
                    <>
                      <div className="font-display text-4xl font-extrabold tracking-tight">{fmt(suppliedReserve)} <span className="text-base text-gray-500 font-mono font-normal">DUSDC</span></div>
                      <div className="font-mono text-[11px] text-gray-500 mt-1 mb-5">across {supplies.length} position{supplies.length > 1 ? 's' : ''}</div>
                      <div className="space-y-2">
                        {supplies.map((p) => (
                          <div key={p.id} className="flex items-center justify-between border border-white/[0.06] rounded-xl px-4 py-3">
                            <span className="font-mono text-sm text-gray-300">{fmt(p.value)} DUSDC</span>
                            <button onClick={() => doWithdrawReserve(p.id)} disabled={busy === 'w:' + p.id} className="font-mono text-xs text-vermilion hover:text-white transition-colors disabled:opacity-50">
                              {busy === 'w:' + p.id ? 'Withdrawing…' : 'Withdraw'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Pending boost requests */}
              {address && myOrders.length > 0 && (
                <div className="mb-6 rounded-2xl border border-vermilion/20 bg-vermilion/[0.04] p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-vermilion" /></span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-vermilion">Opening {myOrders.length} boosted position{myOrders.length > 1 ? 's' : ''}…</span>
                  </div>
                  <div className="space-y-2">
                    {myOrders.map((o) => (
                      <div key={o.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] px-4 py-3 gap-3">
                        <div>
                          <span className="font-mono text-sm text-gray-300"><span className="text-vermilion font-bold">{o.leverage.toFixed(0)}×</span> · {fmt(o.margin)} DUSDC margin {o.isRange ? '· range' : ''}</span>
                          <p className={`font-mono text-[10px] mt-1 ${
                            o.expiry && Number(o.expiry) < Date.now()
                              ? 'text-vermilion'
                              : o.createdAt && Date.now() - o.createdAt > 90_000
                                ? 'text-gray-300'
                                : 'text-gray-600'
                          }`}>
                            {o.source === 'local'
                              ? 'getting started'
                              : o.expiry && Number(o.expiry) < Date.now()
                                ? 'round ended before this opened - cancel to get your margin back'
                                : o.createdAt && Date.now() - o.createdAt > 90_000
                                  ? 'taking longer than usual - you can cancel'
                                  : 'opening your position'}
                          </p>
                        </div>
                        <button onClick={() => doCancel(o.id)} disabled={busy === 'x:' + o.id || o.source === 'local'} className="font-mono text-xs text-gray-500 hover:text-white transition-colors disabled:opacity-50 shrink-0">
                          {o.source === 'local' ? 'Syncing…' : busy === 'x:' + o.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="font-mono text-[10px] text-gray-600 mt-3">Your margin is held while your boosted position opens. If it takes too long or the round expires, Cancel returns it.</p>
                </div>
              )}

              {/* Your leveraged positions */}
              {address && myPositions.length > 0 && (
                <>
                  <SectionHeader number="02" title="Your boosted positions" desc="Opened with your margin plus reserve capital. Max loss is always your margin." meta="settle anytime once won" />
                  <div className="space-y-2.5">
                    {myPositions.map((p) => {
                      const oc = outcome(p, oracles[p.oracleId]);
                      const maxPayout = Number(p.quantity) / 1_000_000;
                      return (
                        <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-4 flex-wrap hover:border-white/[0.14] transition-colors">
                          <div className="flex items-center gap-4">
                            <span className="font-display text-2xl font-extrabold text-vermilion w-12">{p.leverage.toFixed(0)}×</span>
                            <div>
                              <div className="font-mono text-sm text-white">{fmt(p.notional)} DUSDC <span className="text-gray-500">· {p.isRange ? 'range' : p.isUp ? 'UP' : 'DOWN'}</span></div>
                              <div className="font-mono text-[11px] text-gray-600 mt-0.5">{fmt(p.margin)} margin · {fmt(p.fronted)} backed · {fmt(p.premium)} premium</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-5">
                            <div className="text-right">
                              <div className="font-mono text-[9px] uppercase tracking-wider text-gray-600">max payout</div>
                              <div className="font-mono text-sm text-white/90">{fmt(maxPayout)} DUSDC</div>
                            </div>
                            {oc === 'pending' ? (
                              <span className="font-mono text-[11px] text-gray-500 px-3 py-2 inline-flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-600" /> live
                              </span>
                            ) : oc === 'won' ? (
                              p.isRange ? (
                                <span className="font-mono text-[11px] px-3 py-2 rounded-full border border-vermilion/30 text-vermilion inline-flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-vermilion animate-pulse" /> won · paying out
                                </span>
                              ) : (
                                <button
                                  onClick={() => doSettle(p)}
                                  disabled={busy === 's:' + p.id}
                                  style={{ outline: 'none' }}
                                  className="font-mono text-[11px] px-4 py-2 rounded-full border border-vermilion/40 bg-vermilion/10 text-vermilion hover:bg-vermilion/20 hover:border-vermilion/60 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                                  title="Cash out your win"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-vermilion animate-pulse" />
                                  {busy === 's:' + p.id ? 'Settling…' : 'Cash out win'}
                                </button>
                              )
                            ) : (
                              <span className="font-mono text-[11px] px-3 py-2 rounded-full border border-white/10 text-gray-500">lost · margin only</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="font-mono text-[10px] text-gray-600 mt-4 leading-relaxed max-w-2xl">
                    When a boosted position wins, the borrowed amount is paid back first and the remaining profit goes to your wallet. A loss costs only your margin. You can cash out a win yourself anytime — you don&apos;t have to wait for it to happen automatically.
                  </p>
                </>
              )}

              <p className="font-mono text-[10px] text-gray-700 text-center tracking-wider mt-12">leverage reserve · testnet preview</p>
            </>
          )}

          {msg && <p className={`text-center mt-8 text-[12px] font-mono ${msg.includes('✓') ? 'text-gray-300' : 'text-vermilion'}`}>{msg}</p>}
        </div>
        <Footer />
      </main>
    </div>
  );
}

function ReserveRow({ label, value, unit, big, accent }: { label: string; value: string; unit?: string; big?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] pb-2.5 last:border-0 last:pb-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-600">{label}</span>
      <span className={`font-mono ${big ? 'text-xl font-bold' : 'text-sm'} ${accent ? 'text-vermilion' : 'text-white'}`}>
        {value} {unit && <span className="text-xs text-gray-600 font-normal">{unit}</span>}
      </span>
    </div>
  );
}
