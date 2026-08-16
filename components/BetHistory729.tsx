'use client';
// Bet history, read from chain.
//
// Replaces the indexer-backed table, which had been rendering "no bets" for everyone because
// predict-server.testnet.mystenlabs.com stopped resolving and the fetch error was swallowed.
// A failed read now says so instead of pretending the account is empty; those two states look
// identical to a user and only one of them is their fault.

import { useCallback, useEffect, useState } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { fetchExpiryHistory, summarise, type ExpiryHistoryRow } from '@/lib/sui/history729';

const money = (m: bigint) => (Number(m) / 1e6).toFixed(2);

export default function BetHistory729({ wrapperId }: { wrapperId: string | null }) {
  const client = useSuiClient();
  const [rows, setRows] = useState<ExpiryHistoryRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!wrapperId) { setRows([]); return; }
    try {
      setErr(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setRows(await fetchExpiryHistory(client as any, wrapperId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [client, wrapperId]);

  useEffect(() => { void load(); }, [load]);

  if (err) {
    return (
      <div className="rounded-2xl border border-loss/20 bg-loss/[0.04] p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-loss mb-1">History unavailable</div>
        <p className="text-[11px] text-gray-400">{err.slice(0, 160)}</p>
      </div>
    );
  }
  if (!rows) return null;
  if (rows.length === 0) return null;

  const s = summarise(rows);

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-baseline justify-between mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500">Your bets</span>
        <span className="font-mono text-[10px] text-gray-600">{s.marketsTraded} markets</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="Staked" value={`${money(s.stakedMicro)}`} />
        <Stat label="Returned" value={`${money(s.returnedMicro)}`} />
        <Stat
          label="Net (settled)"
          value={`${s.netSettledMicro >= 0n ? '+' : ''}${money(s.netSettledMicro)}`}
          tone={s.netSettledMicro > 0n ? 'good' : s.netSettledMicro < 0n ? 'bad' : undefined}
        />
      </div>

      <div className="space-y-1.5">
        {rows.slice(0, 8).map((r) => (
          <div key={r.marketId} className="flex items-center justify-between py-1.5 border-b border-white/[0.05] last:border-0">
            <span className="font-mono text-[11px] text-gray-500">{r.marketId.slice(0, 10)}…</span>
            <span className="font-mono text-[11px] text-gray-400 tabular-nums">{money(r.grossPaidMicro)} in</span>
            <span className={`font-mono text-[11px] tabular-nums ${r.openCount > 0 ? 'text-gray-600' : r.netMicro > 0n ? 'text-profit' : 'text-loss'}`}>
              {r.openCount > 0 ? 'open' : `${r.netMicro >= 0n ? '+' : ''}${money(r.netMicro)}`}
            </span>
          </div>
        ))}
      </div>

      {s.openMarkets > 0 && (
        <p className="text-[10px] text-gray-600 mt-3">
          {s.openMarkets} still open. Settled winnings are redeemed for you, so nothing here needs claiming.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-gray-600 mb-1">{label}</div>
      <div className={`font-display font-[700] text-lg tabular-nums ${tone === 'good' ? 'text-profit' : tone === 'bad' ? 'text-loss' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}
