'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { ArrowRight, Layers, Wallet, X } from 'lucide-react';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { useDUSDCBalance, useTradingVaultBalance } from '@/lib/sui/hooks';
import { depositTradingBalanceTx, withdrawTradingBalanceTx } from '@/lib/sui/tradingVaultClient';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';

/**
 * Move funds between the user's wallet and their Trading Balance, in one modern sheet.
 *
 * - Deposit  = wallet DUSDC  → Trading Balance (one prefunded account for fast bets)
 * - Withdraw = Trading Balance → wallet DUSDC
 *
 * Both run through useSmartSubmit, so gas is sponsored when the station is up and falls
 * back to the wallet otherwise. Mounted only while open (the parent gates it) so the
 * balance polls don't run in the background.
 */
export default function TradingBalanceModal({ onClose }: { onClose: () => void }) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { balance: walletMicro, coins: walletCoins, refresh: refreshWallet } = useDUSDCBalance();
  const { balance: vault, refresh: refreshVault, configured } = useTradingVaultBalance();

  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const walletDusdc = walletMicro / DUSDC_MULTIPLIER;
  const tradingDusdc = vault.available / DUSDC_MULTIPLIER;
  const max = tab === 'deposit' ? walletDusdc : tradingDusdc;

  const amountMicro = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return BigInt(0);
    return BigInt(Math.floor(n * DUSDC_MULTIPLIER));
  }, [amount]);

  const maxMicro = tab === 'deposit' ? BigInt(Math.floor(walletDusdc * DUSDC_MULTIPLIER)) : BigInt(vault.available);
  const overMax = amountMicro > maxMicro;
  const canSubmit = !!address && configured && !busy && amountMicro > BigInt(0) && !overMax
    && (tab === 'deposit' ? walletCoins.length > 0 : true);

  // Esc to close + lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Clear any stale message when switching direction.
  useEffect(() => { setMsg(null); }, [tab]);

  async function run() {
    if (!canSubmit || !address) return;
    setBusy(true); setMsg(null);
    try {
      if (tab === 'deposit') {
        await submit(() => depositTradingBalanceTx({
          coinIds: walletCoins.map((c) => c.coinObjectId),
          amount: amountMicro,
        }));
      } else {
        await submit(() => withdrawTradingBalanceTx({ amount: amountMicro, owner: address }));
      }
      refreshWallet(); refreshVault();
      setMsg({ kind: 'ok', text: tab === 'deposit' ? 'Moved to your Trading Balance — ready to bet.' : 'Withdrawn to your wallet.' });
      setAmount('');
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const friendly = /reject|user\s*reject/i.test(raw)
        ? 'You declined the signature.'
        : /insufficient/i.test(raw)
          ? 'Not enough balance for that amount.'
          : 'That transfer didn’t go through. Try again in a moment.';
      setMsg({ kind: 'err', text: friendly });
    } finally {
      setBusy(false);
    }
  }

  const openFaucet = () => { onClose(); setTimeout(() => window.dispatchEvent(new Event('yosuku:open-funds')), 60); };
  const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" />
      <div
        className="relative w-full max-w-[380px] rounded-2xl border border-white/10 bg-[#0d0d10] p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="balance-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-2 text-gray-600 hover:bg-white/[0.05] hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 id="balance-title" className="font-display text-lg font-bold tracking-tight mb-3.5">Move funds</h2>

        {/* balances — label + amount, nothing more */}
        <div className="grid grid-cols-2 gap-2.5 mb-3.5">
          <div className={`rounded-lg border px-3 py-2 transition-colors ${tab === 'withdraw' ? 'border-vermilion/40 bg-vermilion/[0.05]' : 'border-white/[0.08] bg-white/[0.02]'}`}>
            <div className="flex items-center gap-1.5 text-gray-500"><Layers className="h-3.5 w-3.5" /><span className="font-mono text-[10px] uppercase tracking-wider">Trading</span></div>
            <div className="mt-0.5 font-display text-base font-bold tabular-nums text-white">{fmt(tradingDusdc)}</div>
          </div>
          <div className={`rounded-lg border px-3 py-2 transition-colors ${tab === 'deposit' ? 'border-vermilion/40 bg-vermilion/[0.05]' : 'border-white/[0.08] bg-white/[0.02]'}`}>
            <div className="flex items-center gap-1.5 text-gray-500"><Wallet className="h-3.5 w-3.5" /><span className="font-mono text-[10px] uppercase tracking-wider">Wallet</span></div>
            <div className="mt-0.5 font-display text-base font-bold tabular-nums text-white/90">{fmt(walletDusdc)}</div>
          </div>
        </div>

        {/* direction toggle */}
        <div className="flex rounded-full border border-white/[0.08] bg-white/[0.02] p-1 mb-3">
          {(['deposit', 'withdraw'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-bold transition-colors ${tab === t ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}
            >
              {t === 'deposit'
                ? <>Wallet <ArrowRight className="h-3.5 w-3.5" /> Trading</>
                : <>Trading <ArrowRight className="h-3.5 w-3.5" /> Wallet</>}
            </button>
          ))}
        </div>

        {/* amount */}
        <div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <input
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="w-full bg-transparent font-display text-2xl font-bold text-white outline-none placeholder:text-gray-700"
            />
            <span className="font-mono text-xs text-gray-500 shrink-0">DUSDC</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-gray-600">max {fmt(max)}</span>
            <div className="flex gap-1.5">
              {[0.25, 0.5, 1].map((f) => (
                <button
                  key={f}
                  onClick={() => setAmount((max * f).toFixed(2))}
                  className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[10px] text-gray-400 hover:border-vermilion/40 hover:text-white transition-colors"
                >
                  {f === 1 ? 'MAX' : `${f * 100}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {overMax && <p className="mt-2 text-[11px] text-rose-400">That’s more than your {tab === 'deposit' ? 'wallet' : 'Trading'} balance.</p>}

        <button
          onClick={run}
          disabled={!canSubmit}
          className="mt-3 w-full rounded-full bg-vermilion py-3 font-semibold text-white transition-colors hover:bg-vermilion-d disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Confirming…' : tab === 'deposit' ? 'Move to Trading Balance →' : 'Withdraw to Wallet →'}
        </button>

        {msg && (
          <p className={`mt-3 text-center text-[12px] ${msg.kind === 'err' ? 'text-rose-400' : 'text-emerald-400'}`}>{msg.text}</p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3.5">
          <span className="font-mono text-[10px] text-gray-600">Gas is on us · testnet</span>
          <button onClick={openFaucet} className="font-mono text-[11px] text-gray-500 hover:text-vermilion transition-colors">
            Need test USDC? ↗
          </button>
        </div>
      </div>
    </div>
  );
}
