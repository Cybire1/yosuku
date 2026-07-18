'use client';

// SenseiTradeCards — the "control center" trade surface inside the Sensei drawer.
// Sensei reads the market above; here you act on it. Each near market is a minimal
// card; tap UP or DOWN and it expands to amount chips + Place. The bet runs on the
// EXACT proven, gasless engine the main ticket uses (ticket624.ts: placeFirstBet624
// for a first-time account, placeMint624 for an existing one), so there is no second
// trade path to keep honest. Sensei's own pick (from its read) gets a subtle mark so
// its words and the buttons agree.
import { useMemo, useState, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import type { Transaction } from '@mysten/sui/transactions';
import { useToast } from '@/components/Toast';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { useAccount624, placeMint624, placeFirstBet624, qtyForStake, strike624 } from '@/lib/sui/ticket624';
import { inferCadence624, fetchMarkets624, fetchSpot624, type Market624 } from '@/lib/sui/predict624Client';

type Dir = 'up' | 'down';
type Pick = { marketId: string; dir: Dir } | null;

const CHIPS = [1, 5, 25];
const fmtUsd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const cadenceLabel: Record<string, string> = { '1m': 'every minute', '5m': 'every 5 min', '1h': 'hourly' };

function mmss(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function SenseiTradeCards({ active, pick }: { active: boolean; pick?: Pick }) {
  const account = useCurrentAccount();
  const { toast } = useToast();
  const { submit } = useSmartSubmit();
  const acct = useAccount624();

  const [markets, setMarkets] = useState<Market624[]>([]);
  const [spot, setSpot] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  // dismissible: a tap on the ✕ hides the cards; reopening the drawer brings them back
  const [hidden, setHidden] = useState(false);
  useEffect(() => { if (active) setHidden(false); }, [active]);

  // self-contained live data: markets + spot (poll while open) + a ticking clock
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    let alive = true;
    const load = async () => {
      try {
        const [ms, sp] = await Promise.all([fetchMarkets624(), fetchSpot624()]);
        if (!alive) return;
        setMarkets(ms); setSpot(Math.round(sp));
      } catch { /* keep last-good */ }
    };
    load();
    const poll = setInterval(load, 15000);
    return () => { alive = false; clearInterval(clock); clearInterval(poll); };
  }, [active]);

  // armed = which (market,dir) is expanded for sizing; one at a time
  const [armed, setArmed] = useState<{ id: string; dir: Dir } | null>(null);
  const [stakeStr, setStakeStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; dir: Dir; strikeUsd: number } | null>(null);

  const near = useMemo(
    () => [...markets].filter((m) => m.expiry > now).sort((a, b) => a.expiry - b.expiry).slice(0, 3),
    [markets, now],
  );

  const stake = Math.max(0, Number(stakeStr) || 0);
  const canPlace = !!account?.address && stake > 0 && spot != null && !busy;

  const arm = (id: string, dir: Dir) => {
    setDone(null);
    setArmed((a) => (a && a.id === id && a.dir === dir ? null : { id, dir }));
    setStakeStr('');
  };

  async function place(m: Market624, dir: Dir) {
    if (!account?.address || spot == null || busy || stake <= 0) return;
    setBusy(true);
    try {
      const sponsored = (factory: () => Transaction) => submit(factory).then((x) => x.digest);
      const cadence = inferCadence624(m.expiry);
      // rough payout size; both helpers re-quote/re-probe on-chain and cap the real cost.
      const qty = qtyForStake(stake, 1, 0.5);
      const strikeUsd = strike624(spot, dir);
      if (!acct.wrapperId) {
        await placeFirstBet624({
          submit: sponsored, address: account.address, marketId: m.id, dir, qty, lev: 1, spot,
          stakeDusdc: stake, walletDusdcMicro: BigInt(Math.floor(acct.walletMicro)),
          coinIds: acct.dusdcCoins.map((c) => c.coinObjectId), cadence,
        });
        acct.refreshWallet();
      } else {
        await placeMint624({
          submit: sponsored, address: account.address, wrapperId: acct.wrapperId, marketId: m.id,
          dir, qty, lev: 1, spot, acctBalance: acct.acctBalance, cadence,
        });
      }
      acct.refreshAcctBalance();
      setDone({ id: m.id, dir, strikeUsd });
      setArmed(null);
      setStakeStr('');
      toast(`You're in. ${dir.toUpperCase()} ${dir === 'up' ? 'over' : 'under'} ${fmtUsd0(strikeUsd)}`, 'success');
    } catch (e) {
      const raw = String(e instanceof Error ? e.message : e);
      const friendly = /no DUSDC|faucet/i.test(raw) ? 'You need test dollars first. Add funds, then bet.'
        : /deposit a little more|not enough/i.test(raw) ? 'A little short. Top up, then place.'
        : `Could not place: ${raw.slice(0, 90)}`;
      toast(friendly, 'error');
    } finally { setBusy(false); }
  }

  if (hidden || spot == null || near.length === 0) return null;

  return (
    <div className="sensei-trade">
      <div className="st-head">
        <span>Trade this</span>
        <span className="st-headright">
          <span className="st-sub">tap a side</span>
          <button className="st-hide" onClick={() => setHidden(true)} aria-label="Hide trade cards" data-cursor="hover">✕</button>
        </span>
      </div>
      {near.map((m) => {
        const overUsd = strike624(spot, 'up');
        const underUsd = strike624(spot, 'down');
        const msLeft = m.expiry - now;
        const isArmed = armed?.id === m.id;
        const wonIt = done?.id === m.id;
        const cad = inferCadence624(m.expiry);
        return (
          <div key={m.id} className={`st-card ${isArmed ? 'armed' : ''}`}>
            <div className="st-row">
              <div className="st-q">
                BTC over <b>{fmtUsd0(overUsd)}</b>
                <span className="st-meta">{cadenceLabel[cad] ?? cad} · closes {mmss(msLeft)}</span>
              </div>
              {!wonIt ? (
                <div className="st-sides">
                  <button
                    className={`st-side up ${isArmed && armed?.dir === 'up' ? 'on' : ''} ${pick?.marketId === m.id && pick.dir === 'up' ? 'pick' : ''}`}
                    onClick={() => arm(m.id, 'up')} data-cursor="hover"
                  >UP</button>
                  <button
                    className={`st-side down ${isArmed && armed?.dir === 'down' ? 'on' : ''} ${pick?.marketId === m.id && pick.dir === 'down' ? 'pick' : ''}`}
                    onClick={() => arm(m.id, 'down')} data-cursor="hover"
                  >DOWN</button>
                </div>
              ) : (
                <div className="st-done">You&apos;re in · {done!.dir.toUpperCase()}</div>
              )}
            </div>

            {isArmed && (
              <div className="st-arm">
                {!account?.address ? (
                  <div className="st-connect">Connect a wallet to place this.</div>
                ) : (
                  <>
                    <div className="st-chips">
                      <input
                        value={stakeStr} onChange={(e) => setStakeStr(e.target.value.replace(/[^0-9.]/g, ''))}
                        inputMode="decimal" placeholder="Amount" aria-label="Bet amount in DUSDC" className="st-amt"
                      />
                      {CHIPS.map((c) => (
                        <button key={c} className="st-chip" onClick={() => setStakeStr(String((Number(stakeStr) || 0) + c))} data-cursor="hover">+{c}</button>
                      ))}
                    </div>
                    <button className="st-place" disabled={!canPlace} onClick={() => place(m, armed!.dir)} data-cursor="hover">
                      {busy ? 'Placing…' : `Bet ${armed?.dir === 'up' ? 'UP' : 'DOWN'}${stake > 0 ? ` · ${stake} DUSDC` : ''}`}
                    </button>
                    <div className="st-note">Gas-free · you win {armed?.dir === 'up' ? 'above' : 'below'} {fmtUsd0(armed?.dir === 'up' ? overUsd : underUsd)} at close</div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
