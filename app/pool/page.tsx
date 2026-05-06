'use client';

import { useState, useCallback } from 'react';
import { Loader2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import SectionHeader from '@/components/SectionHeader';
import { useVaultStats, useDUSDCBalance, usePLPBalance } from '@/lib/sui/hooks';
import { supplyLpTx, withdrawAllPlpTx } from '@/lib/sui/predictClient';
import { DUSDC_MULTIPLIER, FLOAT_SCALING } from '@/lib/sui/constants';

type SupplyStep = 'idle' | 'supplying' | 'success' | 'error';
type WithdrawStep = 'idle' | 'withdrawing' | 'success' | 'error';

export default function PoolPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const { stats, loading: statsLoading, refresh: refreshStats } = useVaultStats();
  const { balance: walletBalance, coins: dusdcCoins, refresh: refreshDusdc } = useDUSDCBalance();
  const { balance: plpBalance, coins: plpCoins, refresh: refreshPlp } = usePLPBalance();

  const [supplyAmount, setSupplyAmount] = useState('100');
  const [supplyStep, setSupplyStep] = useState<SupplyStep>('idle');
  const [withdrawStep, setWithdrawStep] = useState<WithdrawStep>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const supplyAmountMicro = Math.floor(parseFloat(supplyAmount || '0') * DUSDC_MULTIPLIER);

  const handleSupply = useCallback(async () => {
    if (!address || supplyAmountMicro <= 0 || dusdcCoins.length === 0) return;
    setSupplyStep('supplying');
    setErrorMsg('');
    try {
      const coinIds = dusdcCoins.map(c => c.coinObjectId);
      const tx = supplyLpTx(coinIds, BigInt(supplyAmountMicro), address);
      const result = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest: result.digest });
      setSupplyStep('success');
      refreshDusdc();
      refreshPlp();
      refreshStats();
      setTimeout(() => { setSupplyStep('idle'); setSupplyAmount('100'); }, 3000);
    } catch (err) {
      console.error('Supply error:', err);
      setSupplyStep('error');
      setErrorMsg(err instanceof Error ? err.message : 'Supply failed');
    }
  }, [address, supplyAmountMicro, dusdcCoins, signAndExecute, client, refreshDusdc, refreshPlp, refreshStats]);

  const handleWithdraw = useCallback(async () => {
    if (!address || plpCoins.length === 0) return;
    setWithdrawStep('withdrawing');
    setErrorMsg('');
    try {
      const coinIds = plpCoins.map(c => c.coinObjectId);
      const tx = withdrawAllPlpTx(coinIds, address);
      const result = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest: result.digest });
      setWithdrawStep('success');
      refreshDusdc();
      refreshPlp();
      refreshStats();
      setTimeout(() => setWithdrawStep('idle'), 3000);
    } catch (err) {
      console.error('Withdraw error:', err);
      setWithdrawStep('error');
      setErrorMsg(err instanceof Error ? err.message : 'Withdraw failed');
    }
  }, [address, plpCoins, signAndExecute, client, refreshDusdc, refreshPlp, refreshStats]);

  const quickAmounts = [50, 100, 250, 500, 1000];
  const plpDisplay = plpBalance / DUSDC_MULTIPLIER;
  const shareOfVault = stats && stats.totalPlpSupply > 0
    ? (plpBalance / stats.totalPlpSupply) * 100
    : 0;
  const estimatedValue = stats && stats.totalPlpSupply > 0
    ? (plpBalance / stats.totalPlpSupply) * (stats.vaultValue / DUSDC_MULTIPLIER)
    : 0;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-gray-500 mb-7 flex items-center gap-3">
          <a href="/" className="hover:text-white transition-colors">Yosuku</a>
          <span className="text-gray-700">/</span>
          <span className="text-white">Pool</span>
        </div>

        <h1 className="font-display font-[800] text-4xl text-white tracking-tight mb-2">
          Liquidity Pool
        </h1>
        <p className="font-jp text-gray-500 text-sm mb-10">流動性プール</p>

        {!address ? (
          <div className="border border-white/[0.08] rounded bg-bg p-16 text-center">
            <div className="w-16 h-16 mx-auto mb-6 border border-white/10 rounded-full flex items-center justify-center">
              <ArrowDownToLine className="w-6 h-6 text-gray-500" />
            </div>
            <h2 className="font-display font-[700] text-xl text-white mb-2">Connect Wallet</h2>
            <p className="text-gray-500 text-sm max-w-sm mx-auto">
              Connect your Sui wallet to supply liquidity and earn fees.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 01: Vault Overview */}
            <section>
              <SectionHeader number="01" title="Vault Overview" jp="ボールト" />
              <div className="ledger-plate">
                {statsLoading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: '#6B6353' }} />
                  </div>
                ) : stats ? (
                  <>
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <span className="font-mono text-[9px] tracking-[0.16em] uppercase" style={{ color: '#6B6353' }}>
                          Vault Value
                        </span>
                        <div className="font-mono text-3xl font-semibold mt-1" style={{ color: '#1A1612' }}>
                          {(stats.vaultValue / DUSDC_MULTIPLIER).toFixed(2)}
                          <span className="text-sm ml-2" style={{ color: '#6B6353' }}>DUSDC</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-[9px] tracking-[0.16em] uppercase" style={{ color: '#6B6353' }}>
                          Total PLP Supply
                        </span>
                        <div className="font-mono text-sm mt-1" style={{ color: '#1A1612' }}>
                          {(stats.totalPlpSupply / DUSDC_MULTIPLIER).toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 pt-4" style={{ borderTop: '1px solid rgba(201,191,166,0.3)' }}>
                      <div>
                        <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Balance</span>
                        <div className="font-mono text-sm" style={{ color: '#1A1612' }}>
                          {(stats.balance / DUSDC_MULTIPLIER).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>MTM</span>
                        <div className="font-mono text-sm" style={{ color: '#1A1612' }}>
                          {(stats.totalMtm / DUSDC_MULTIPLIER).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Max Payout</span>
                        <div className="font-mono text-sm" style={{ color: '#1A1612' }}>
                          {(stats.maxPayout / DUSDC_MULTIPLIER).toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <span className="font-mono text-[8px] tracking-[0.14em] uppercase" style={{ color: '#6B6353' }}>Withdrawable</span>
                        <div className="font-mono text-sm" style={{ color: '#1A1612' }}>
                          {(stats.availableForWithdraw / DUSDC_MULTIPLIER).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-center py-4" style={{ color: '#6B6353' }}>Failed to load vault data</p>
                )}
              </div>
            </section>

            {/* 02: Your LP Position */}
            <section>
              <SectionHeader number="02" title="Your LP Position" jp="LPポジション" />
              <div className="border border-white/[0.08] rounded bg-bg p-5">
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">PLP Balance</span>
                    <span className="text-lg font-mono font-bold text-white">{plpDisplay.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Share of Vault</span>
                    <span className="text-lg font-mono font-bold text-white">{shareOfVault.toFixed(2)}%</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Est. Value</span>
                    <span className="text-lg font-mono font-bold text-white">{estimatedValue.toFixed(2)} DUSDC</span>
                  </div>
                </div>
              </div>
            </section>

            {/* 03: Supply & Withdraw */}
            <section>
              <SectionHeader number="03" title="Supply & Withdraw" jp="供給と出金" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Supply */}
                <div className="border border-white/[0.08] rounded bg-bg p-5 space-y-4">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
                    Supply DUSDC
                  </h4>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Amount</label>
                      <span className="text-[10px] text-gray-600">
                        Wallet: {(walletBalance / DUSDC_MULTIPLIER).toFixed(2)}
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        value={supplyAmount}
                        onChange={(e) => setSupplyAmount(e.target.value)}
                        placeholder="0.00"
                        min="0"
                        className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-lg outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500">DUSDC</span>
                    </div>
                    <div className="flex gap-2 mt-2">
                      {quickAmounts.map((qa) => (
                        <button
                          key={qa}
                          onClick={() => setSupplyAmount(String(qa))}
                          className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                            supplyAmount === String(qa)
                              ? 'border-white/20 bg-white/10 text-white'
                              : 'border-white/5 bg-white/[0.02] text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {qa}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={handleSupply}
                    disabled={supplyStep !== 'idle' || supplyAmountMicro <= 0 || walletBalance < supplyAmountMicro}
                    className="w-full py-3 rounded-xl text-sm font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {supplyStep === 'supplying' ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Supplying...
                      </span>
                    ) : supplyStep === 'success' ? (
                      'Supplied!'
                    ) : (
                      'Supply DUSDC'
                    )}
                  </button>
                </div>

                {/* Withdraw */}
                <div className="border border-white/[0.08] rounded bg-bg p-5 space-y-4">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <ArrowUpFromLine className="w-4 h-4 text-vermilion" />
                    Withdraw PLP
                  </h4>
                  <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">
                      Your PLP Balance
                    </span>
                    <span className="text-2xl font-mono font-bold text-white">{plpDisplay.toFixed(2)}</span>
                    <span className="text-xs text-gray-500 ml-2">PLP</span>
                    {estimatedValue > 0 && (
                      <p className="text-[10px] text-gray-500 mt-1">
                        ~{estimatedValue.toFixed(2)} DUSDC estimated
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleWithdraw}
                    disabled={withdrawStep !== 'idle' || plpCoins.length === 0}
                    className="w-full py-3 rounded-xl text-sm font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {withdrawStep === 'withdrawing' ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Withdrawing...
                      </span>
                    ) : withdrawStep === 'success' ? (
                      'Withdrawn!'
                    ) : plpCoins.length === 0 ? (
                      'No PLP to withdraw'
                    ) : (
                      'Withdraw All PLP'
                    )}
                  </button>
                </div>
              </div>

              {/* Error display */}
              {(supplyStep === 'error' || withdrawStep === 'error') && errorMsg && (
                <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <p className="text-xs text-rose-400">{errorMsg.slice(0, 200)}</p>
                  <button
                    onClick={() => { setSupplyStep('idle'); setWithdrawStep('idle'); setErrorMsg(''); }}
                    className="text-[10px] text-rose-400 underline flex-shrink-0"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </section>

            {/* 04: Composability */}
            <section>
              <SectionHeader number="04" title="Composability" jp="構成可能性" />
              <div className="border border-white/[0.08] rounded bg-bg p-5 space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">DeepBook Spot</h4>
                  <p className="text-xs text-gray-400 mt-1">
                    PLP tokens can be traded on DeepBook spot markets, enabling secondary market liquidity for LP positions without needing to withdraw from the vault.
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">DeepBook Margin</h4>
                  <p className="text-xs text-gray-400 mt-1">
                    Binary positions could serve as margin collateral in DeepBook perpetuals, allowing hedged strategies across prediction and derivatives markets.
                  </p>
                </div>
                <a
                  href="https://deepbook.tech"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-vermilion hover:text-vermilion/80 transition-colors inline-block"
                >
                  Learn more about DeepBook composability ↗
                </a>
              </div>
            </section>
          </div>
        )}

        <Footer />
      </main>
    </div>
  );
}
