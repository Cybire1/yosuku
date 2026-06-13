'use client';

import { useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import { usePoolStats, useMySupply } from '@/lib/sui/leverageHooks';
import { supplyTx, withdrawTx } from '@/lib/sui/leverageClient';

const fmt = (n: number, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export default function EarnPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { stats, refresh: refreshStats } = usePoolStats();
  const { positions, refresh: refreshMine } = useMySupply(stats);
  const { coins, refresh: refreshBal } = useDUSDCBalance();

  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const supplied = positions.reduce((s, p) => s + p.value, 0);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setMsg('');
    try {
      await fn();
      setMsg('Done ✓');
      setTimeout(() => { refreshStats(); refreshMine(); refreshBal(); }, 1200);
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
    const ids = coins.map((c) => c.coinObjectId);
    await run('supply', async () => { await signAndExecute({ transaction: supplyTx(ids, micro, address) }); setAmount(''); });
  }

  async function doWithdraw(positionId: string) {
    if (!address) return;
    await run('w:' + positionId, async () => { await signAndExecute({ transaction: withdrawTx(positionId, address) }); });
  }

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />
      <main className="container pt-[120px] pb-16 max-w-4xl mx-auto">
        {/* hero */}
        <div className="mb-8">
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-vermilion mb-2">● Earn · the lending pool</div>
          <h1 className="font-display font-extrabold text-4xl tracking-tight">Supply DUSDC, earn the yield from leverage.</h1>
          <p className="text-gray-400 mt-3 max-w-2xl leading-relaxed">
            Traders borrow from this pool to open leveraged Predict positions. You supply the liquidity and earn the
            interest they pay — utilization-based, settled on-chain. Withdraw anytime there&apos;s idle liquidity.
          </p>
        </div>

        {/* stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <Stat label="Supply APR" value={stats ? pct(stats.supplyAprBps) : '—'} accent />
          <Stat label="Total value" value={stats ? `${fmt(stats.totalValue)}` : '—'} unit="DUSDC" />
          <Stat label="Utilization" value={stats ? pct(stats.utilizationBps) : '—'} />
          <Stat label="Available" value={stats ? `${fmt(stats.liquidity)}` : '—'} unit="DUSDC" />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* supply */}
          <div className="border border-white/[0.08] rounded-2xl bg-white/[0.02] p-6">
            <h2 className="font-display font-bold text-xl mb-4">Supply</h2>
            {!address ? (
              <p className="font-mono text-xs text-gray-500 py-6 text-center">Connect a wallet to supply.</p>
            ) : (
              <>
                <div className="flex items-center gap-2 border border-white/10 rounded-xl px-4 py-3 mb-3">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="bg-transparent flex-1 outline-none font-mono text-lg"
                  />
                  <span className="font-mono text-sm text-gray-500">DUSDC</span>
                </div>
                <button
                  onClick={doSupply}
                  disabled={busy === 'supply'}
                  className="w-full bg-white text-black font-semibold rounded-full py-3 hover:scale-[1.01] active:scale-[0.98] transition-transform disabled:opacity-60"
                >
                  {busy === 'supply' ? 'Supplying…' : 'Supply DUSDC'}
                </button>
                <p className="font-mono text-[11px] text-gray-600 mt-3">
                  Earns {stats ? pct(stats.supplyAprBps) : '—'} APR · interest accrues continuously.
                </p>
              </>
            )}
          </div>

          {/* your position */}
          <div className="border border-white/[0.08] rounded-2xl bg-white/[0.02] p-6">
            <h2 className="font-display font-bold text-xl mb-4">Your supply</h2>
            {!address ? (
              <p className="font-mono text-xs text-gray-500 py-6 text-center">—</p>
            ) : positions.length === 0 ? (
              <p className="font-mono text-xs text-gray-500 py-6 text-center">No active supply yet.</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between mb-4">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-gray-500">Total supplied</span>
                  <span className="font-mono text-2xl font-semibold">{fmt(supplied)} <span className="text-sm text-gray-500">DUSDC</span></span>
                </div>
                <div className="space-y-2">
                  {positions.map((p) => (
                    <div key={p.id} className="flex items-center justify-between border border-white/[0.06] rounded-xl px-4 py-3">
                      <span className="font-mono text-sm text-gray-300">{fmt(p.value)} DUSDC</span>
                      <button
                        onClick={() => doWithdraw(p.id)}
                        disabled={busy === 'w:' + p.id}
                        className="font-mono text-xs text-vermilion hover:text-white transition-colors disabled:opacity-50"
                      >
                        {busy === 'w:' + p.id ? 'Withdrawing…' : 'Withdraw'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {msg && <p className={`text-center mt-5 text-[12px] font-mono ${msg.includes('✓') ? 'text-emerald-400' : 'text-rose-400'}`}>{msg}</p>}

        <p className="text-center font-mono text-[10px] text-gray-700 mt-10">
          yolev lending pool · testnet · interest paid by leveraged traders
        </p>
        <Footer />
      </main>
    </div>
  );
}

function Stat({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <div className="border border-white/[0.08] rounded-xl bg-white/[0.02] px-4 py-3">
      <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600">{label}</div>
      <div className={`font-mono text-lg font-semibold mt-1 ${accent ? 'text-vermilion' : 'text-white'}`}>
        {value} {unit && <span className="text-xs text-gray-500">{unit}</span>}
      </div>
    </div>
  );
}
