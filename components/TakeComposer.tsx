'use client';

// "Post a take" — author your own market: pick a price (any strike, snapped to the grid)
// and a horizon (from the live bell ladder), see the real on-chain odds, then take it.
// Reuses the proven bet flow by deep-linking into the market with strike + side prefilled,
// so the actual mint + confirm happens in the battle-tested TradePanel.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import { fetchLatestPrices, type OracleData } from '@/lib/sui/predictApi';
import { fetchOnChainQuote } from '@/lib/sui/onchainQuote';
import { getCanonicalMarketLine } from '@/lib/marketLine';
import { nearestStrike } from '@/lib/roundHelpers';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
function horizon(expiry: number): string {
  const m = Math.max(0, Math.round((expiry - Date.now()) / 60000));
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export default function TakeComposer({ oracles, onClose }: { oracles: OracleData[]; onClose: () => void }) {
  const router = useRouter();
  const ladder = useMemo(
    () => oracles.filter(o => (o.underlying_asset || 'BTC') === 'BTC').sort((a, b) => a.expiry - b.expiry).slice(0, 8),
    [oracles],
  );
  const [side, setSide] = useState<'UP' | 'DOWN'>('UP');
  const [oracleId, setOracleId] = useState(ladder[0]?.oracle_id ?? '');
  const oracle = ladder.find(o => o.oracle_id === oracleId) ?? ladder[0];
  const [price, setPrice] = useState('');
  const [spot, setSpot] = useState<number | null>(null);
  const [cents, setCents] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('10');

  // default the price to the round's canonical strike (≈ spot) when the round changes
  useEffect(() => {
    if (!oracle) return;
    let on = true;
    fetchLatestPrices(oracle.oracle_id).then(p => {
      if (!on) return;
      const s = p?.spot ? p.spot / FLOAT_SCALING : null;
      setSpot(s);
      const line = getCanonicalMarketLine({ oracle, settledOracles: [], referencePrice: p?.forward || p?.spot || null });
      const def = line && line.source !== 'grid-fallback' ? line.strike / FLOAT_SCALING : (s ?? oracle.min_strike / FLOAT_SCALING);
      setPrice(String(Math.round(def)));
    }).catch(() => {});
    return () => { on = false; };
  }, [oracleId]); // eslint-disable-line react-hooks/exhaustive-deps

  const strikeScaled = useMemo(() => {
    const d = parseFloat(price);
    if (!oracle || !isFinite(d) || d <= 0) return null;
    return nearestStrike(Math.round(d * FLOAT_SCALING), oracle.min_strike, oracle.tick_size);
  }, [price, oracle]);
  const strikeDollars = strikeScaled != null ? strikeScaled / FLOAT_SCALING : null;

  // real on-chain odds: cost of one $1-payout contract = the ¢ price
  useEffect(() => {
    if (!oracle || strikeScaled == null) { setCents(null); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const q = await fetchOnChainQuote({ oracleId: oracle.oracle_id, expiry: oracle.expiry, strike: strikeScaled, isUp: side === 'UP', quantity: DUSDC_MULTIPLIER });
        if (!cancelled) setCents(Math.max(1, Math.min(99, Math.round(q.mintCost * 100))));
      } catch { if (!cancelled) setCents(null); }
      finally { if (!cancelled) setLoading(false); }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [oracle?.oracle_id, strikeScaled, side]); // eslint-disable-line react-hooks/exhaustive-deps

  const multiple = cents ? (100 / cents).toFixed(2) : null;
  const bump = useCallback((d: number) => setPrice(p => String(Math.max(0, Math.round((parseFloat(p || '0') || 0) + d)))), []);
  const takeIt = () => { if (oracle && strikeScaled != null) router.push(`/markets/${oracle.oracle_id}?strike=${strikeScaled}&side=${side}&amount=${amount}`); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          className="relative w-full max-w-[440px] bg-[#0c0c0e] border-t border-x border-white/10 rounded-t-3xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto w-10 h-1 rounded-full bg-white/15 mb-4" />
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-extrabold tracking-tight">Post a take</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
          </div>

          {/* live preview sentence */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] px-4 py-3 mb-4">
            <span className="font-display text-lg font-bold leading-snug">
              BTC <span className={side === 'UP' ? 'text-emerald-400' : 'text-rose-400'}>{side === 'UP' ? 'above' : 'below'}</span>{' '}
              <span className="text-vermilion">{strikeDollars ? usd(strikeDollars) : '—'}</span> by{' '}
              <span className="text-white">{oracle ? horizon(oracle.expiry) : '—'}</span>?
            </span>
          </div>

          {/* side */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {(['UP', 'DOWN'] as const).map(s => (
              <button key={s} onClick={() => setSide(s)}
                className={`rounded-xl py-3 font-bold text-sm uppercase tracking-wider border transition-all ${
                  side === s
                    ? s === 'UP' ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300' : 'bg-rose-500/15 border-rose-500/50 text-rose-300'
                    : 'border-white/10 text-gray-500 hover:text-gray-300'
                }`}>
                {s === 'UP' ? 'Above ↑' : 'Below ↓'}
              </button>
            ))}
          </div>

          {/* price */}
          <div className="mb-4">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">Your price</span>
              {spot && <span className="font-mono text-[10px] text-gray-600">now {usd(spot)}</span>}
            </div>
            <div className="flex items-center gap-2 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-white/25 transition-colors">
              <span className="text-gray-500 font-mono">$</span>
              <input value={price} onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0"
                className="bg-transparent flex-1 outline-none font-mono text-2xl min-w-0" />
              <div className="flex gap-1">
                <button onClick={() => bump(-500)} className="px-2 py-1 rounded-lg border border-white/10 text-[11px] font-mono text-gray-400 hover:text-white">−500</button>
                <button onClick={() => bump(500)} className="px-2 py-1 rounded-lg border border-white/10 text-[11px] font-mono text-gray-400 hover:text-white">+500</button>
              </div>
            </div>
            {strikeDollars != null && parseFloat(price) !== strikeDollars && (
              <div className="font-mono text-[10px] text-gray-600 mt-1">snaps to {usd(strikeDollars)}</div>
            )}
          </div>

          {/* horizon ladder */}
          <div className="mb-5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 block mb-1.5">By when</span>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
              {ladder.map(o => (
                <button key={o.oracle_id} onClick={() => setOracleId(o.oracle_id)}
                  className={`shrink-0 px-3.5 py-2 rounded-xl font-mono text-sm border transition-all ${
                    o.oracle_id === oracleId ? 'bg-vermilion/15 border-vermilion/50 text-white' : 'border-white/10 text-gray-500 hover:text-gray-300'
                  }`}>
                  {horizon(o.expiry)}
                </button>
              ))}
            </div>
          </div>

          {/* odds */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/[0.07] px-4 py-3 mb-4 flex items-center justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">Odds · on-chain</div>
              <div className="font-display text-2xl font-extrabold">
                {loading ? <Loader2 className="w-5 h-5 animate-spin text-gray-500" /> : cents != null ? <>{side} <span className={side === 'UP' ? 'text-emerald-400' : 'text-rose-400'}>{cents}¢</span></> : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500">If right</div>
              <div className="font-display text-2xl font-extrabold text-emerald-300">{multiple ? `${multiple}×` : '—'}</div>
            </div>
          </div>

          {/* stake — set the amount here so it carries straight into the bet */}
          <div className="mb-4">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">Amount</span>
              {cents != null && parseFloat(amount) > 0 && (
                <span className="font-mono text-[10px] text-emerald-300">win {usd(parseFloat(amount) * (100 / cents))}</span>
              )}
            </div>
            <div className="flex items-center gap-2 border border-white/10 rounded-xl px-3 py-2.5 focus-within:border-white/25 transition-colors mb-2">
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0"
                className="bg-transparent flex-1 outline-none font-mono text-2xl min-w-0" />
              <span className="text-gray-500 font-mono text-sm">DUSDC</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {['5', '10', '25', '100'].map(a => (
                <button key={a} onClick={() => setAmount(a)}
                  className={`rounded-lg py-2 font-mono text-sm border transition-all ${amount === a ? 'bg-vermilion/15 border-vermilion/50 text-white' : 'border-white/10 text-gray-500 hover:text-gray-300'}`}>
                  {a}
                </button>
              ))}
            </div>
          </div>

          <button onClick={takeIt} disabled={strikeScaled == null || !(parseFloat(amount) > 0)}
            className="w-full bg-vermilion hover:bg-vermilion-d text-white font-bold rounded-2xl py-4 text-sm uppercase tracking-wider transition-colors disabled:opacity-50">
            Take it →
          </button>
          <p className="text-center font-mono text-[10px] text-gray-600 mt-2.5">gas-free · exact price locked on the confirm screen</p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
