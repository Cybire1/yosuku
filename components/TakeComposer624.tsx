'use client';

// "Post a take" — author a public call on a live 6-24 bell and publish it.
// The words go to Walrus (gas-free publisher upload); the pointer + call go
// on-chain via take_board::post_take (gas-free through the sponsor, wallet
// fallback). This composer posts an OPEN call (no bet linked) — the founder's
// "optional + badge" model; a bet-backed take comes from the place-a-bet flow,
// where the order id is already in hand.
//
// Honest by construction: the strike defaults to live spot and is the user's to
// set; nothing is auto-forced. The take is a call ("BTC under $X at the bell"),
// not a fabricated prediction of odds.

import { useEffect, useMemo, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { X } from 'lucide-react';
import { fetchMarkets624, fetchSpot624, type Cadence624, type Market624 } from '@/lib/sui/predict624Client';
import { BAND_USD } from '@/lib/sui/ticket624';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { useToast } from '@/components/Toast';
import { writeTake, normalizeCaption, TAKE_MAX_CAPTION, type Take } from '@/lib/sui/takes';
import { buildPostTakeTx, type TakeSide } from '@/lib/sui/takeBoard';

type Dir = 'up' | 'down' | 'range';
const CAD_LABEL: Record<Cadence624, string> = { '1m': '1 min', '5m': '5 min', '1h': '1 hour' };
const CADENCES: Cadence624[] = ['1m', '5m', '1h'];
const usd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export default function TakeComposer624({ onClose, onPosted }: { onClose: () => void; onPosted?: () => void }) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { toast } = useToast();

  const [dir, setDir] = useState<Dir>('down');
  const [cadence, setCadence] = useState<Cadence624>('5m');
  const [strikeStr, setStrikeStr] = useState('');
  const [caption, setCaption] = useState('');
  const [markets, setMarkets] = useState<Market624[]>([]);
  const [spot, setSpot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // live markets + spot (spot seeds the default strike)
  useEffect(() => {
    let dead = false;
    fetchMarkets624().then((m) => { if (!dead) setMarkets(m); }).catch(() => {});
    fetchSpot624().then((s) => { if (!dead) setSpot(s); }).catch(() => {});
    return () => { dead = true; };
  }, []);

  // the soonest live market of the chosen cadence carries the on-chain marketId
  const market = useMemo(() => {
    const now = Date.now();
    return markets
      .filter((m) => m.cadence === cadence && m.expiry > now)
      .sort((a, b) => a.expiry - b.expiry)[0] ?? null;
  }, [markets, cadence]);

  const strike = useMemo(() => {
    const n = parseFloat(strikeStr.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
    return spot != null ? Math.round(spot) : null; // default to live spot
  }, [strikeStr, spot]);

  const bandLabel = useMemo(() => {
    if (strike == null) return '—';
    if (dir === 'range') return `BTC ${usd0(strike - BAND_USD)}–${usd0(strike + BAND_USD)}`;
    return dir === 'up' ? `BTC over ${usd0(strike)}` : `BTC under ${usd0(strike)}`;
  }, [dir, strike]);

  const esc = useMemo(() => (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }, [onClose]);
  useEffect(() => { document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, [esc]);

  const canPost = !!address && !!market && strike != null && !busy;

  async function post() {
    if (!canPost || !market || strike == null || !address) return;
    setBusy(true);
    try {
      const side: TakeSide = dir === 'up' ? 0 : dir === 'down' ? 1 : 2;
      const take: Take = {
        v: 1,
        author: address,
        kind: dir === 'range' ? 'range' : 'dir',
        ...(dir === 'range'
          ? { lowerUsd: strike - BAND_USD, higherUsd: strike + BAND_USD }
          : { dir, strikeUsd: strike }),
        marketId: market.id,
        caption: normalizeCaption(caption),
        cadence: market.cadence,
        expiryMs: market.expiry,
        ts: Date.now(),
      };
      const { blobId } = await writeTake(take);
      await submit(() =>
        buildPostTakeTx({ blobId, marketId: market.id, orderId: '0', side, strikeUsd: strike }),
      );
      toast('Take posted', 'success');
      onPosted?.();
      onClose();
    } catch (e) {
      toast(`Couldn't post the take: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center" role="dialog" aria-label="Post a take">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        data-theme="dark"
        className="relative z-10 max-h-[92dvh] w-full max-w-[440px] overflow-y-auto rounded-t-3xl border border-white/[0.1] sm:rounded-3xl"
        style={{ background: 'radial-gradient(130% 90% at 50% -10%, #16110c 0%, #0d0a08 46%, #080605 100%)' }}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-vermilion/60 to-transparent" />

        <div className="relative z-10 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-extrabold text-white">Post a take</h2>
            <button onClick={onClose} className="rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white" aria-label="Close" style={{ outline: 'none' }}>
              <X size={18} />
            </button>
          </div>
          <p className="mt-1 font-mono text-[10px] text-white/40">Your words go on Walrus (free) · your call, on-chain.</p>

          {/* side */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {(['up', 'down', 'range'] as Dir[]).map((d) => (
              <button
                key={d}
                onClick={() => setDir(d)}
                style={{ outline: 'none' }}
                className={`rounded-xl border py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors ${
                  dir === d ? 'border-vermilion/70 bg-vermilion/[0.08] text-vermilion' : 'border-white/12 text-white/50 hover:text-white'
                }`}
              >
                {d === 'up' ? '▲ Up' : d === 'down' ? '▼ Down' : '◆ Range'}
              </button>
            ))}
          </div>

          {/* strike */}
          <div className="mt-3 rounded-xl border border-white/[0.1] bg-white/[0.02] px-3.5 py-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">{dir === 'range' ? 'Band center' : 'Strike'}</span>
              <span className="font-mono text-[9px] text-white/35">spot {spot != null ? usd0(spot) : '—'}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-display text-xl font-bold text-white/40">$</span>
              <input
                inputMode="decimal"
                placeholder={spot != null ? String(Math.round(spot)) : '—'}
                value={strikeStr}
                onChange={(e) => setStrikeStr(e.target.value.replace(/[^0-9.]/g, ''))}
                className="min-w-0 flex-1 bg-transparent font-display text-xl font-bold text-white tabular-nums outline-none placeholder:text-white/25"
                aria-label="Strike price"
              />
            </div>
          </div>

          {/* horizon */}
          <div className="mt-3">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">Horizon</div>
            <div className="grid grid-cols-3 gap-2">
              {CADENCES.map((c) => {
                const hasMarket = markets.some((m) => m.cadence === c && m.expiry > Date.now());
                return (
                  <button
                    key={c}
                    onClick={() => setCadence(c)}
                    disabled={!hasMarket}
                    style={{ outline: 'none' }}
                    className={`rounded-xl border py-2 font-mono text-[10px] transition-colors disabled:opacity-30 ${
                      cadence === c ? 'border-white/40 bg-white/[0.05] text-white' : 'border-white/12 text-white/50 hover:text-white'
                    }`}
                  >
                    {CAD_LABEL[c]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* caption */}
          <div className="mt-3">
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, TAKE_MAX_CAPTION))}
              placeholder="Why this call? (optional)"
              rows={2}
              className="w-full resize-none rounded-xl border border-white/[0.1] bg-white/[0.02] px-3.5 py-2.5 font-display text-[15px] leading-snug text-white outline-none placeholder:text-white/25 focus:border-white/25"
            />
            <div className="mt-1 text-right font-mono text-[9px] text-white/30">{caption.length}/{TAKE_MAX_CAPTION}</div>
          </div>

          {/* preview + post */}
          <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">You're calling</div>
            <div className="mt-0.5 font-mono text-[12px] text-vermilion">
              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '◆'} {bandLabel}
              <span className="text-white/40"> · {market ? `${CAD_LABEL[market.cadence]} bell` : 'no live bell'}</span>
            </div>
          </div>

          <button
            onClick={post}
            disabled={!canPost}
            style={{ outline: 'none' }}
            className="mt-3 w-full rounded-full bg-vermilion px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-vermilion-d disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Posting…' : !address ? 'Connect a wallet' : !market ? 'No live bell for this horizon' : 'Post take'}
          </button>
        </div>
      </div>
    </div>
  );
}
