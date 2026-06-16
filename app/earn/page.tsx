'use client';

import { useState, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import SectionHeader from '@/components/SectionHeader';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import { useReserveStats, useMySupply, useMyPositions, useMyOrders } from '@/lib/sui/leverageHooks';
import { supplyTx, withdrawTx, cancelOrderTx, settleTx, type PositionData } from '@/lib/sui/leverageClient';
import { KEEPER_ADDRESS } from '@/lib/sui/constants';
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

// utilization donut — the reserve's "at risk" share, rendered as an arc
function Gauge({ bps }: { bps: number }) {
  const p = Math.min(1, Math.max(0, bps / 10000));
  const R = 58, C = 2 * Math.PI * R;
  return (
    <svg width="148" height="148" viewBox="0 0 148 148" className="block">
      <circle cx="74" cy="74" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
      <circle
        cx="74" cy="74" r={R} fill="none" stroke="var(--vermilion)" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform="rotate(-90 74 74)"
        style={{ filter: 'drop-shadow(0 0 8px rgba(224,77,38,0.45))' }}
      />
      <text x="74" y="68" textAnchor="middle" className="fill-white" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30 }}>{(p * 100).toFixed(0)}%</text>
      <text x="74" y="90" textAnchor="middle" style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: 3, fill: 'var(--gray-500)' }}>AT RISK</text>
    </svg>
  );
}

export default function EarnPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { stats, refresh: refreshStats } = useReserveStats();
  const { positions, refresh: refreshMine } = useMySupply(stats);
  const { positions: myPositions, refresh: refreshPos } = useMyPositions();
  const { orders: myOrders, refresh: refreshOrders } = useMyOrders();
  const { coins, refresh: refreshBal } = useDUSDCBalance();

  const [amount, setAmount] = useState('');
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

  const supplied = positions.reduce((s, p) => s + p.value, 0);
  const earned = supplied - 0; // display value already includes accrued premiums

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setMsg('');
    try {
      await fn();
      setMsg('Done ✓');
      setTimeout(() => { refreshStats(); refreshMine(); refreshBal(); refreshPos(); refreshOrders(); }, 1200);
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 120) : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function doSupply() {
    if (!address) return;
    const micro = BigInt(Math.floor(Number(amount) * 1_000_000));
    if (micro <= BigInt(0)) { setMsg('Enter an amount'); return; }
    await run('supply', async () => { await submit(() => supplyTx(coins.map((c) => c.coinObjectId), micro, address)); setAmount(''); });
  }
  async function doWithdraw(id: string) {
    if (!address) return;
    await run('w:' + id, async () => { await submit(() => withdrawTx(id, address)); });
  }
  async function doCancel(id: string) {
    if (!address) return;
    await run('x:' + id, async () => { await submit(() => cancelOrderTx(id, address)); });
  }
  async function doSettle(p: PositionData) {
    if (!address) return;
    // permissionless self-settle: redeem the won position, repay the reserve, and the
    // PnL is force-paid to the owner on-chain — works even if the keeper is down.
    await run('s:' + p.id, async () => {
      await submit(() => settleTx({
        positionId: p.id,
        managerId: p.managerId,
        oracleId: p.oracleId,
        expiry: p.expiry,
        strike: p.lowerStrike, // binary: lowerStrike holds the strike
        isUp: p.isUp,
        quantity: p.quantity,
      }));
    });
  }

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      {/* Hero */}
      <section className="page-hero">
        <span className="crop tl" /><span className="crop tr" /><span className="crop bl" /><span className="crop br" />
        <span className="hero-meta tl">RESERVE V-03<span className="ln">UNDERWRITING DESK</span></span>
        <span className="hero-meta tr">EDITION 04 / 2026<span className="ln">SUI · TESTNET</span></span>
        <span className="hero-meta bl">PREMIUM {stats ? pct(stats.premiumBps) : '—'}<span className="ln">PAID BY TRADERS</span></span>
        <span className="hero-meta br">{stats ? `${fmt(stats.totalValue, 0)} DUSDC` : '—'}<span className="ln">RESERVE VALUE</span></span>

        <div className="container">
          <div className="breadcrumb">
            <a href="/" data-cursor="hover">Home</a>
            <span className="sep">/</span>
            <span style={{ color: 'var(--white)' }}>Earn</span>
          </div>

          <div className="hero-grid">
            <div className="hero-left">
              <div className="eyebrow">
                <span className="dash" />
                <span className="live-dot" />
                <span>The reserve · live</span>
                <span style={{ color: 'var(--gray-700)' }}>·</span>
                <span>you are the house</span>
              </div>
              <h1 className="page-title">
                Underwrite<br />
                the <span className="accent">upside</span>.
              </h1>
              <p className="mt-6 max-w-md text-gray-400 leading-relaxed text-[15px]">
                When a trader levers up, the reserve fronts the extra notional and pockets a premium. Supply DUSDC,
                take the other side, and earn what they pay. Traders carry no debt — so there&apos;s nothing to liquidate.
              </p>
            </div>

            {/* live reserve dashboard */}
            <div className="rounded-2xl border border-white/[0.10] bg-gradient-to-b from-white/[0.04] to-transparent p-7 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-5">
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-gray-500 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-vermilion" style={{ boxShadow: '0 0 8px var(--vermilion)' }} /> Live reserve
                </span>
                <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-gray-600">{stats ? `${stats.maxLeverageBps / 10000}× max` : '—'}</span>
              </div>
              <div className="flex items-center gap-6">
                <Gauge bps={stats?.utilizationBps ?? 0} />
                <div className="flex-1 space-y-3.5">
                  <ReserveRow label="Reserve value" value={stats ? `${fmt(stats.totalValue)}` : '—'} unit="DUSDC" big />
                  <ReserveRow label="Available now" value={stats ? `${fmt(stats.liquid)}` : '—'} unit="DUSDC" />
                  <ReserveRow label="Premium spread" value={stats ? pct(stats.premiumBps) : '—'} accent />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main>
        <div className="container max-w-5xl mx-auto pt-14 pb-20">
          {/* Supply */}
          <SectionHeader number="01" title="Supply the reserve" desc="Deposit DUSDC to back leveraged trades and earn the premiums they pay." meta="withdraw idle liquidity anytime" />
          <div className="grid md:grid-cols-2 gap-5 mb-16">
            {/* supply card */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
              {!address ? (
                <p className="font-mono text-xs text-gray-500 py-10 text-center">Connect a wallet to supply.</p>
              ) : (
                <>
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600">Amount</span>
                    <span className="font-mono text-[10px] text-gray-600">wallet {fmt((coins.reduce((s, c) => s + Number(c.balance), 0)) / 1e6)} DUSDC</span>
                  </div>
                  <div className="flex items-center gap-2 border border-white/10 rounded-xl px-4 py-3.5 mb-4 focus-within:border-white/25 transition-colors">
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="bg-transparent flex-1 outline-none font-mono text-2xl"
                    />
                    <button onClick={() => setAmount(((coins.reduce((s, c) => s + Number(c.balance), 0)) / 1e6).toFixed(2))} className="font-mono text-[10px] uppercase tracking-wider text-vermilion hover:text-white transition-colors">Max</button>
                    <span className="font-mono text-sm text-gray-500">DUSDC</span>
                  </div>
                  <button
                    onClick={doSupply}
                    disabled={busy === 'supply'}
                    className="w-full bg-white text-black font-semibold rounded-full py-3.5 hover:scale-[1.01] active:scale-[0.98] transition-transform disabled:opacity-60"
                  >
                    {busy === 'supply' ? 'Supplying…' : 'Supply DUSDC'}
                  </button>
                  <p className="font-mono text-[11px] text-gray-600 mt-3.5 leading-relaxed">
                    Earns the {stats ? pct(stats.premiumBps) : '—'} premium on every leveraged trade · your value grows with premiums, dips when a fronted trade loses.
                  </p>
                </>
              )}
            </div>

            {/* your supply card */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600 mb-4">Your supply</div>
              {!address ? (
                <p className="font-mono text-xs text-gray-500 py-10 text-center">—</p>
              ) : positions.length === 0 ? (
                <p className="font-mono text-xs text-gray-500 py-10 text-center">No active supply yet.</p>
              ) : (
                <>
                  <div className="font-display text-4xl font-extrabold tracking-tight">{fmt(supplied)} <span className="text-base text-gray-500 font-mono font-normal">DUSDC</span></div>
                  <div className="font-mono text-[11px] text-gray-500 mt-1 mb-5">across {positions.length} position{positions.length > 1 ? 's' : ''}{earned > 0 ? '' : ''}</div>
                  <div className="space-y-2">
                    {positions.map((p) => (
                      <div key={p.id} className="flex items-center justify-between border border-white/[0.06] rounded-xl px-4 py-3">
                        <span className="font-mono text-sm text-gray-300">{fmt(p.value)} DUSDC</span>
                        <button onClick={() => doWithdraw(p.id)} disabled={busy === 'w:' + p.id} className="font-mono text-xs text-vermilion hover:text-white transition-colors disabled:opacity-50">
                          {busy === 'w:' + p.id ? 'Withdrawing…' : 'Withdraw'}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Pending escrows — the keeper is filling these */}
          {address && myOrders.length > 0 && (
            <div className="mb-6 rounded-2xl border border-vermilion/20 bg-vermilion/[0.04] p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-vermilion" /></span>
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-vermilion">Keeper is opening {myOrders.length} position{myOrders.length > 1 ? 's' : ''}…</span>
              </div>
              <div className="space-y-2">
                {myOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] px-4 py-3">
                    <span className="font-mono text-sm text-gray-300"><span className="text-vermilion font-bold">{o.leverage.toFixed(0)}×</span> · {fmt(o.margin)} DUSDC margin {o.isRange ? '· range' : ''}</span>
                    <button onClick={() => doCancel(o.id)} disabled={busy === 'x:' + o.id} className="font-mono text-xs text-gray-500 hover:text-white transition-colors disabled:opacity-50">
                      {busy === 'x:' + o.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  </div>
                ))}
              </div>
              <p className="font-mono text-[10px] text-gray-600 mt-3">Margin escrowed on-chain. The keeper fills within a few seconds — or Cancel to reclaim it instantly.</p>
            </div>
          )}

          {/* Your leveraged positions */}
          {address && myPositions.length > 0 && (
            <>
              <SectionHeader number="02" title="Your leveraged positions" desc="Opened with margin + the reserve's fronted capital. Max loss is always your margin." meta="settled by you" />
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
                          <div className="font-mono text-[11px] text-gray-600 mt-0.5">{fmt(p.margin)} margin · {fmt(p.fronted)} fronted · {fmt(p.premium)} premium</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-5">
                        <div className="text-right">
                          <div className="font-mono text-[9px] uppercase tracking-wider text-gray-600">max payout</div>
                          <div className="font-mono text-sm text-emerald-400/90">{fmt(maxPayout)} DUSDC</div>
                        </div>
                        {oc === 'pending' ? (
                          <span className="font-mono text-[11px] text-gray-500 px-3 py-2 inline-flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-600" /> live
                          </span>
                        ) : oc === 'won' ? (
                          p.isRange ? (
                            <span className="font-mono text-[11px] px-3 py-2 rounded-full border border-emerald-500/30 text-emerald-300 inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> won · keeper settling
                            </span>
                          ) : address === KEEPER_ADDRESS ? (
                            <button
                              onClick={() => doSettle(p)}
                              disabled={busy === 's:' + p.id}
                              className="font-mono text-[11px] px-4 py-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-400/60 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                              title="keeper liveness crank"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              {busy === 's:' + p.id ? 'Settling…' : 'Settle now'}
                            </button>
                          ) : (
                            <span className="font-mono text-[11px] px-3 py-2 rounded-full border border-emerald-500/30 text-emerald-300 inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> won · keeper settling
                            </span>
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
                Positions are custodied by the protocol and <span className="text-vermilion/80">settled by the keeper crank</span> when the round ends —
                a win redeems, repays the reserve&apos;s fronted capital, and force-pays your PnL to your wallet on-chain; a loss costs only your margin.
                Redeem and settle are permissionless on-chain; the protocol-owned manager withdraw is keeper-gated, so the crank runs from the keeper.
              </p>
            </>
          )}

          {msg && <p className={`text-center mt-8 text-[12px] font-mono ${msg.includes('✓') ? 'text-emerald-400' : 'text-rose-400'}`}>{msg}</p>}

          <p className="text-center font-mono text-[10px] text-gray-700 mt-16 tracking-wider">
            yolev underwriting reserve · testnet · experimental
          </p>
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
