'use client';

// Portfolio624Section — the "New venue" block at the TOP of /portfolio: the user's
// activity on the NEW DeepBook Predict (predict-testnet-6-24).
//
// Reads come EXCLUSIVELY from predict624Client: wrapper discovery (findWrapperId624)
// → inner account id (the indexer keys per-user feeds on the INNER account.account_id,
// NOT the wrapper object id) → stored balance + open positions + settled history from
// the beta indexer's /accounts/{account_id}/… routes. Claims build
// buildRedeemSettledTx, submitted sponsored-first via useSmartSubmit — the exact
// idiom of /beta, the founder-validated 6-24 surface: the Onara sponsor only
// allowlists old-deployment targets, so routing 6-24 txs through the sponsored path
// would cost the user a doomed extra signing popup.
//
// Everything below this section on /portfolio is the PREVIOUS venue (4-16) and stays
// untouched until cutover completes.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentAccount, useSignTransaction } from '@mysten/dapp-kit';
import type { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/components/Toast';
import SectionHeader from '@/components/SectionHeader';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import {
  POS_INF_TICK,
  FLOAT_SCALING_624,
  tickToUsd,
  findWrapperId624,
  fetchInnerAccountId624,
  fetchAccountBalance624,
  fetchOpenPositions624,
  fetchAccountOrders624,
  fetchMarketState624,
  buildRedeemSettledTx,
  type Position624,
  type OrderRow624,
  type MarketState624,
} from '@/lib/sui/predict624Client';
import {
  fetchLedger624,
  fetchSub624,
  fetchVaultTrades624,
  type Sub624,
  type VaultEvent624,
} from '@/lib/sui/vault624Client';

const POS_INF = Number(POS_INF_TICK);
const HISTORY_ROWS = 8;
const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const SUISCAN_OBJ = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;

// ─── tiny formatters (local by design — this component has no old-deployment deps) ───

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtUsd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const micro = (n: bigint) => Number(n) / DUSDC_MULTIPLIER;

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'settling';
  const m = Math.floor(msLeft / 60_000);
  const s = Math.floor((msLeft % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function ago(ts: number, now: number): string {
  const d = now - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

/** Human band: OVER $x (up), UNDER $y (down), or $x–$y. Ticks are $0.01-grid indices. */
function bandLabel(lowerTick: number, higherTick: number): string {
  if (higherTick >= POS_INF) return `over ${fmtUsd0(tickToUsd(lowerTick))}`;
  if (lowerTick <= 0) return `under ${fmtUsd0(tickToUsd(higherTick))}`;
  return `${fmtUsd0(tickToUsd(lowerTick))}–${fmtUsd0(tickToUsd(higherTick))}`;
}

// ─── component ───

export default function Portfolio624Section() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { toast } = useToast();
  const { mutateAsync: signTransaction } = useSignTransaction();

  // clock — drives countdowns; 0 until mounted (avoids SSR hydration drift)
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [wrapperId, setWrapperId] = useState<string | null>(null);
  const [innerAccountId, setInnerAccountId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [acctBalance, setAcctBalance] = useState(0);
  const [positions, setPositions] = useState<Position624[]>([]);
  const [history, setHistory] = useState<OrderRow624[]>([]);
  const [mktStates, setMktStates] = useState<Record<string, MarketState624>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // copy-trading desk (vault624) — independent of the personal wrapper: the desk
  // holds its own object-owned account, users only have a ledger entry + sub
  const [deskLedger, setDeskLedger] = useState(0);
  const [deskSub, setDeskSub] = useState<Sub624 | null>(null);
  const [deskRows, setDeskRows] = useState<VaultEvent624[]>([]);

  // sponsored-first — yosuku-trading-624 allowlists redeem_settled, so claims are gas-free
  const { submit } = useSmartSubmit();
  const submitTx = useCallback(
    async (build: () => Transaction): Promise<string> => {
      if (!address) throw new Error('Connect a wallet first');
      const { digest } = await submit(build);
      return digest;
    },
    [address, submit],
  );

  const refreshBalance = useCallback(async (wid?: string | null) => {
    const id = wid ?? wrapperId;
    if (!id) return;
    try { setAcctBalance(await fetchAccountBalance624(id)); } catch { /* keep last good */ }
  }, [wrapperId]);

  const loadPositions = useCallback(async (acctId?: string | null) => {
    const id = acctId ?? innerAccountId;
    if (!id) return;
    try {
      const [open, orders] = await Promise.all([fetchOpenPositions624(id), fetchAccountOrders624(id, 30)]);
      setPositions(open);
      setHistory(orders.filter((o) => o.kind.endsWith('_redeemed')).slice(0, HISTORY_ROWS));
      const ids = Array.from(new Set(open.map((p) => p.marketId)));
      const states = await Promise.all(ids.map((m) => fetchMarketState624(m).catch(() => null)));
      const map: Record<string, MarketState624> = {};
      ids.forEach((m, i) => { const s = states[i]; if (s) map[m] = s; });
      setMktStates(map);
    } catch { /* transient indexer hiccup — next poll wins */ }
  }, [innerAccountId]);

  // account discovery on connect
  useEffect(() => {
    let live = true;
    setWrapperId(null); setInnerAccountId(null); setChecked(false);
    setAcctBalance(0); setPositions([]); setHistory([]); setMktStates({});
    if (!address) { setChecked(true); return; }
    (async () => {
      try {
        const wid = await findWrapperId624(address);
        if (!live) return;
        setWrapperId(wid);
        if (wid) {
          const inner = await fetchInnerAccountId624(wid);
          if (!live) return;
          setInnerAccountId(inner);
          refreshBalance(wid);
          if (inner) loadPositions(inner);
        }
      } finally { if (live) setChecked(true); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // copy-trading desk footprint: ledger + sub + this user's recent desk events
  const loadDesk = useCallback(async (addr: string) => {
    try {
      const [ledger, sub, rows] = await Promise.all([
        fetchLedger624(addr),
        fetchSub624(addr),
        fetchVaultTrades624(40),
      ]);
      setDeskLedger(ledger);
      setDeskSub(sub);
      const mine = addr.toLowerCase();
      setDeskRows(rows.filter((r) => r.user.toLowerCase() === mine && (r.kind === 'trade' || r.kind === 'settle')).slice(0, 4));
    } catch { /* transient read failure — next poll wins */ }
  }, []);

  useEffect(() => {
    setDeskLedger(0); setDeskSub(null); setDeskRows([]);
    if (!address) return;
    loadDesk(address);
    const id = setInterval(() => loadDesk(address), 20_000);
    return () => clearInterval(id);
  }, [address, loadDesk]);

  // steady polls once the account exists
  useEffect(() => {
    if (!wrapperId) return;
    const id = setInterval(() => refreshBalance(), 15_000);
    return () => clearInterval(id);
  }, [wrapperId, refreshBalance]);
  useEffect(() => {
    if (!innerAccountId) return;
    const id = setInterval(() => loadPositions(), 12_000);
    return () => clearInterval(id);
  }, [innerAccountId, loadPositions]);

  async function claim(pos: Position624) {
    if (!wrapperId || busy) return;
    setBusy(`claim:${pos.orderId}`);
    try {
      await submitTx(() => buildRedeemSettledTx({
        marketId: pos.marketId,
        wrapperId,
        orderId: BigInt(pos.orderId),
        qty: pos.qtyMicro,
      }));
      toast('Position redeemed — payout landed in your trading account', 'success');
      refreshBalance();
      loadPositions();
    } catch (e) {
      toast(`Claim failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setBusy(null); }
  }

  const claimable = positions.filter((p) => mktStates[p.marketId]?.settled).length;
  const hasDesk = deskLedger > 0 || deskSub != null || deskRows.length > 0;

  return (
    <section>
      <SectionHeader
        number="00"
        title="New venue"
        jp="新会場"
        meta="DeepBook Predict 6-24 · testnet"
      />

      <div className="group relative border border-white/[0.08] rounded bg-bg">
        <Crosshairs />

        {!checked ? (
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40 px-5 py-8">
            reading the new venue…
          </div>
        ) : !wrapperId ? (
          <div className="px-5 py-6">
            <p className="text-[13px] text-gray-400 leading-snug max-w-lg">
              No trading account on the new venue yet. Yosuku is moving to the rewritten
              DeepBook Predict — minute-cadence BTC markets, native leverage, oracle-settled.
            </p>
            <a
              href="/beta"
              className="inline-block mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-vermilion hover:text-white transition-colors"
              data-cursor="hover"
            >
              Set it up on the beta wing →
            </a>
          </div>
        ) : (
          <>
            {/* balance strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-white/[0.06]">
              <div className="px-4 py-3.5">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">Trading account</div>
                <div className="font-mono text-lg text-white tabular-nums">
                  {fmt2(acctBalance)} <span className="text-[11px] text-white/40">DUSDC</span>
                </div>
              </div>
              <div className="px-4 py-3.5 border-l border-white/[0.06]">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">Open positions</div>
                <div className="font-mono text-lg text-white tabular-nums">{positions.length}</div>
              </div>
              <div className="px-4 py-3.5 border-l border-white/[0.06]">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">Claimable</div>
                <div className={`font-mono text-lg tabular-nums ${claimable > 0 ? 'text-vermilion' : 'text-white'}`}>{claimable}</div>
              </div>
              <div className="px-4 py-3.5 border-l border-white/[0.06] hidden sm:block">
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">Account</div>
                <a
                  href={SUISCAN_OBJ(wrapperId)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm text-white/70 hover:text-white transition-colors"
                >
                  {fmtAddr(wrapperId)} ↗
                </a>
              </div>
            </div>

            {/* open positions with countdown / claim states */}
            <div className="divide-y divide-white/[0.05]">
              {positions.length === 0 && history.length === 0 ? (
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30 px-5 py-8 text-center">
                  No activity on the new venue yet —{' '}
                  <a href="/beta" className="text-vermilion hover:text-white transition-colors normal-case tracking-normal">make your first call →</a>
                </div>
              ) : (
                <>
                  {positions.map((pos) => {
                    const st = mktStates[pos.marketId];
                    const expired = st ? now > 0 && now >= st.expiry : false;
                    const settled = !!st?.settled;
                    const settleUsd = st?.settlementUsd ?? null;
                    const won = settled && settleUsd != null && settleUsd * 100 >= pos.lowerTick && settleUsd * 100 < pos.higherTick;
                    const levX = pos.leverage1e9 / FLOAT_SCALING_624;
                    const claiming = busy === `claim:${pos.orderId}`;
                    const status = settled ? (won ? 'Settled · in range' : 'Settled · out of range') : expired ? 'Awaiting settle' : 'Open';
                    return (
                      <div key={`${pos.marketId}:${pos.orderId}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                        <span className={`font-mono text-[10px] uppercase tracking-[0.18em] w-40 shrink-0 ${settled ? 'text-white' : 'text-white/50'}`}>
                          {!settled && <span className="text-vermilion mr-1.5">●</span>}{status}
                        </span>
                        <span className="font-display font-[700] text-[13px] text-white">BTC {bandLabel(pos.lowerTick, pos.higherTick)}</span>
                        <span className="font-mono text-[10px] text-white/40">
                          {st && !settled && !expired && now > 0 ? `settles in ${fmtCountdown(st.expiry - now)}` : settled && settleUsd != null ? `settled at ${fmtUsd(settleUsd)}` : ''}
                        </span>
                        <span className="flex-1" />
                        <span className="font-mono text-[11px] text-white/70 tabular-nums">{fmt2(micro(pos.qtyMicro))} DUSDC</span>
                        <span className="font-mono text-[11px] text-white/40 tabular-nums w-8 text-right">{Number.isInteger(levX) ? levX : levX.toFixed(1)}×</span>
                        {settled ? (
                          <button
                            onClick={() => claim(pos)}
                            disabled={claiming}
                            className={`shrink-0 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] font-semibold transition-colors disabled:opacity-60 ${won ? 'bg-vermilion text-white hover:bg-vermilion-d' : 'border border-white/15 text-white/60 hover:border-white/30 hover:text-white'}`}
                          >
                            {claiming ? 'Claiming…' : won ? `Claim ≈ ${fmt2(micro(pos.qtyMicro) - micro(pos.netPremiumMicro) * (levX - 1))}` : 'Close · no payout'}
                          </button>
                        ) : (
                          <span className="font-mono text-[10px] text-white/30 w-24 text-right">{ago(pos.openedAtMs, now || pos.openedAtMs)}</span>
                        )}
                      </div>
                    );
                  })}

                  {/* settled history — payouts + Suiscan links */}
                  {history.map((h, i) => (
                    <div key={`h-${h.orderId}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 w-40 shrink-0">
                        {h.kind === 'settled_order_redeemed' ? 'Claimed' : h.kind === 'liquidated_order_redeemed' ? 'Knocked out' : 'Closed early'}
                      </span>
                      <span className="font-display font-[700] text-[13px] text-white/60 tabular-nums">
                        paid {h.payoutMicro != null ? fmt2(micro(h.payoutMicro)) : '—'} DUSDC
                      </span>
                      {h.settlementUsd != null && <span className="font-mono text-[10px] text-white/35">at {fmtUsd(h.settlementUsd)}</span>}
                      <span className="flex-1" />
                      <span className="font-mono text-[11px] text-white/30 tabular-nums">{now > 0 ? ago(h.tsMs, now) : ''}</span>
                      {h.digest && (
                        <a href={SUISCAN_TX(h.digest)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-vermilion hover:text-white transition-colors">↗</a>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* footer line — honest, exact */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-t border-white/[0.06]">
              <span className="font-mono text-[9.5px] text-white/30">
                Oracle-settled on testnet · payouts land in YOUR trading account only · balances read on-chain
              </span>
              <a href="/beta" className="font-mono text-[10px] uppercase tracking-[0.14em] text-vermilion hover:text-white transition-colors" data-cursor="hover">
                Trade on the new venue →
              </a>
            </div>
          </>
        )}
      </div>

      {/* copy-trading desk line (vault624) — only when the user has a footprint */}
      {hasDesk && (
        <div className="group relative border border-white/[0.08] rounded bg-bg mt-3">
          <Crosshairs />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 border-b border-white/[0.06]">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion">Copy-trading desk</span>
            <span className="font-mono text-[11px] text-white tabular-nums">ledger {fmt2(deskLedger)} DUSDC</span>
            {deskSub && (
              <span className="font-mono text-[10px] text-white/40">
                {deskSub.active
                  ? `agent ${fmtAddr(deskSub.agent)} · caps ${fmt2(deskSub.maxMarginMicro / DUSDC_MULTIPLIER)} DUSDC / ${(deskSub.maxLeverage1e9 / FLOAT_SCALING_624).toFixed(0)}× per trade`
                  : 'subscription paused'}
              </span>
            )}
            <span className="flex-1" />
            <a href="/strategies" className="font-mono text-[10px] uppercase tracking-[0.14em] text-vermilion hover:text-white transition-colors" data-cursor="hover">
              Manage →
            </a>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {deskRows.length === 0 ? (
              <div className="font-mono text-[10px] text-white/30 px-5 py-3">No desk trades for your address yet — the agent trades within your caps only.</div>
            ) : (
              deskRows.map((r, i) => (
                <div key={`d-${r.orderId ?? r.digest}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 hover:bg-white/[0.02] transition-colors">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 w-40 shrink-0">
                    {r.kind === 'trade' ? 'Agent traded' : 'Desk settled'}
                  </span>
                  <span className="font-display font-[700] text-[13px] text-white/60 tabular-nums">
                    {r.kind === 'trade'
                      ? `cost ${fmt2(r.costMicro / DUSDC_MULTIPLIER)} DUSDC`
                      : `paid ${fmt2(r.payoutMicro / DUSDC_MULTIPLIER)} DUSDC`}
                  </span>
                  {r.kind === 'trade' && r.leverage1e9 > 0 && (
                    <span className="font-mono text-[10px] text-white/35">{(r.leverage1e9 / FLOAT_SCALING_624).toFixed(0)}× · pays up to {fmt2(r.qtyMicro / DUSDC_MULTIPLIER)}</span>
                  )}
                  <span className="flex-1" />
                  <span className="font-mono text-[11px] text-white/30 tabular-nums">{r.ts > 0 && now > 0 ? ago(r.ts, now) : ''}</span>
                  {r.digest && (
                    <a href={SUISCAN_TX(r.digest)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-vermilion hover:text-white transition-colors">↗</a>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Crosshairs() {
  const t = 'pointer-events-none absolute w-2 h-2 opacity-0 transition-all duration-200 group-hover:opacity-100';
  return (
    <>
      <span className={`${t} left-1.5 top-1.5 border-l border-t border-vermilion`} />
      <span className={`${t} right-1.5 top-1.5 border-r border-t border-vermilion`} />
      <span className={`${t} left-1.5 bottom-1.5 border-l border-b border-vermilion`} />
      <span className={`${t} right-1.5 bottom-1.5 border-r border-b border-vermilion`} />
    </>
  );
}
