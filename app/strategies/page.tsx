'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCurrentAccount, useSignTransaction, ConnectButton } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import SectionHeader from '@/components/SectionHeader';
import { useToast } from '@/components/Toast';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import {
  fetchStrategies,
  fetchCopyTrades,
  buildSubscribeTx,
  fmtDusdc,
  fmtAddr,
  ago,
  glyphFromAddress,
  SUISCAN_TX,
  SUISCAN_ACC,
  type StrategyCard,
  type CopyTrade,
} from '@/lib/sui/strategyClient';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { grpc, buildSignExecute } from '@/lib/sui/modernClients';
import { getSponsorStatus, submitSponsored, type SponsorStatus } from '@/lib/sponsor';

export default function StrategiesPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { mutateAsync: signTransaction } = useSignTransaction();
  const { coins: dusdcCoins, refresh: refreshDusdc } = useDUSDCBalance();
  const { toast } = useToast();

  const [strategies, setStrategies] = useState<StrategyCard[]>([]);
  const [copyTrades, setCopyTrades] = useState<CopyTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);
  const [subscribingId, setSubscribingId] = useState<string | null>(null);

  // discover the gas station once; if up, subscribing is gas-free.
  useEffect(() => {
    getSponsorStatus().then(setSponsor).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([fetchStrategies(), fetchCopyTrades(50)]);
      setStrategies(s);
      setCopyTrades(t);
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Subscriber: pay the fee + authorize the agent to copy-trade your vault funds, under
  // the strategy's hard caps. Mirrors WaitlistCard.join(): sponsored path if the gas
  // station is up, wallet-pays fallback otherwise — both execute off JSON-RPC over gRPC.
  async function subscribe(card: StrategyCard) {
    if (!address) return;
    if (dusdcCoins.length === 0) {
      toast('No DUSDC in wallet — claim some from the faucet first', 'error');
      return;
    }
    setSubscribingId(card.id);
    try {
      const tx = buildSubscribeTx({
        strategyId: card.id,
        coinIds: dusdcCoins.map((c) => c.coinObjectId),
        subFeeMicro: BigInt(Math.floor(card.subFee * DUSDC_MULTIPLIER)),
      });
      let digest: string;
      if (sponsor) {
        // sponsored: the gas station pays. User signs to authorize, Onara co-signs + executes.
        tx.setSender(address);
        tx.setGasOwner(sponsor.address);
        const bytes = await tx.build({ client: grpc });
        const signed = await signTransaction({ transaction: Transaction.from(bytes) });
        const r = await submitSponsored({ sender: address, txBytes: signed.bytes, txSignature: signed.signature });
        digest = r.digest;
      } else {
        // fallback: user pays gas (still off JSON-RPC — wallet signs, gRPC executes).
        const r = await buildSignExecute(tx, ({ transaction }) =>
          signTransaction({ transaction }).then((s) => ({ bytes: s.bytes, signature: s.signature })),
        );
        digest = r.digest;
      }
      await grpc.waitForTransaction({ digest });
      toast(`Subscribed to ${fmtAddr(card.agent)} — the agent can now copy-trade your vault`, 'success');
      await load();
      refreshDusdc();
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 140);
      toast(`Subscribe failed: ${msg}`, 'error');
    } finally {
      setSubscribingId(null);
    }
  }

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
          <span className="text-white">Strategies</span>
        </div>

        <h1 className="font-display font-[800] text-4xl text-white tracking-tight mb-2">
          Strategy Exchange
        </h1>
        <p className="font-jp text-gray-500 text-sm mb-6">戦略取引所</p>

        <p className="text-gray-400 text-sm leading-relaxed max-w-2xl mb-10">
          A catalogue of investable prediction-market agent strategies. Subscribe to one and the
          agent trades your funds under hard on-chain caps — and can never divert a cent: every
          position it opens is owned by you and force-pays you on exit.
        </p>

        {loading && strategies.length === 0 ? (
          <div className="font-mono text-sm text-gray-500 py-20 text-center">reading the chain…</div>
        ) : (
          <div className="space-y-8">
            {/* 01: The strategies */}
            <section>
              <SectionHeader number="01" title="The strategies" jp="戦略" live meta={`${strategies.length} listed`} />

              {strategies.length === 0 ? (
                <div className="border border-white/[0.08] rounded bg-bg p-16 text-center">
                  <div className="w-16 h-16 mx-auto mb-6 border border-white/10 rounded-full flex items-center justify-center">
                    <span className="font-jp text-2xl text-gray-500">戦</span>
                  </div>
                  <h2 className="font-display font-[700] text-xl text-white mb-2">No strategies yet</h2>
                  <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    {loadError
                      ? "Couldn't reach the chain — retrying."
                      : 'Investable strategies will appear here as creators publish them. Each one binds its agent to hard risk caps before a single subscriber dollar moves.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {strategies.map((card) => {
                    const busy = subscribingId === card.id;
                    const free = card.subFee === 0 && !!sponsor;
                    return (
                      <div key={card.id} className="border border-white/[0.08] rounded bg-bg p-5 flex flex-col">
                        {/* top row: avatar glyph + agent address + capability chips */}
                        <div className="flex items-center gap-3 mb-5">
                          <div className="w-10 h-10 shrink-0 border border-white/10 rounded-full flex items-center justify-center">
                            <span className="font-jp text-lg text-vermilion">{glyphFromAddress(card.agent)}</span>
                          </div>
                          <a
                            href={SUISCAN_ACC(card.agent)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[13px] text-gray-300 hover:text-white transition-colors"
                          >
                            {fmtAddr(card.agent)}
                          </a>
                          <span className="flex-1" />
                          <div className="flex items-center gap-1.5">
                            {card.hasCapsule && (
                              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-gray-400 border border-white/10 rounded px-2 py-1">
                                Seal playbook
                              </span>
                            )}
                            {card.hasMemory && (
                              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-gray-400 border border-white/10 rounded px-2 py-1">
                                MemWal memory
                              </span>
                            )}
                          </div>
                        </div>

                        {/* caps row */}
                        <div className="grid grid-cols-3 gap-4 pb-4 mb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Max leverage</span>
                            <span className="font-mono text-sm text-white">{card.maxLeverage}x</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Max margin</span>
                            <span className="font-mono text-sm text-white">{fmtDusdc(card.maxMargin)} DUSDC</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Sub fee</span>
                            <span className="font-mono text-sm text-white">{fmtDusdc(card.subFee)} DUSDC</span>
                          </div>
                        </div>

                        {/* live performance row */}
                        <div className="grid grid-cols-4 gap-4 mb-5">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Subs</span>
                            <span className="font-mono text-sm text-white tabular-nums">{card.subscribers}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Copy-trades</span>
                            <span className="font-mono text-sm text-white tabular-nums">{card.copyTrades}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Vol copied</span>
                            <span className="font-mono text-sm text-white tabular-nums">{fmtDusdc(card.volumeCopied)}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Last active</span>
                            <span className="font-mono text-sm text-white">{ago(card.lastActive)}</span>
                          </div>
                        </div>

                        {/* subscribe action */}
                        <div className="mt-auto">
                          {!address ? (
                            <ConnectButton />
                          ) : (
                            <button
                              onClick={() => subscribe(card)}
                              disabled={busy}
                              className="w-full py-3 rounded text-sm font-semibold bg-vermilion hover:bg-vermilion-d text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {busy
                                ? 'subscribing…'
                                : free
                                  ? 'Subscribe — free →'
                                  : `Subscribe · ${fmtDusdc(card.subFee)} DUSDC`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 02: Recent copy-trades */}
            <section>
              <SectionHeader number="02" title="Recent copy-trades" jp="コピー取引" meta={`${copyTrades.length}`} />
              <div className="border border-white/[0.08] rounded bg-bg divide-y divide-white/[0.05] overflow-hidden">
                {copyTrades.length === 0 ? (
                  <div className="font-mono text-xs text-gray-600 px-5 py-8 text-center">no copy-trades indexed yet</div>
                ) : (
                  copyTrades.map((t, i) => {
                    const inner = (
                      <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0 bg-vermilion"
                          style={{ boxShadow: '0 0 8px var(--vermilion)' }}
                        />
                        <span className="font-mono text-[12px] text-gray-300 w-24 shrink-0">copy-trade</span>
                        <a
                          href={SUISCAN_ACC(t.subscriber)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[12px] text-gray-500 hover:text-white transition-colors"
                        >
                          {fmtAddr(t.subscriber)}
                        </a>
                        <span className="flex-1" />
                        <span className="font-mono text-[12px] text-gray-300 tabular-nums">{fmtDusdc(t.notional)} DUSDC</span>
                        <span className="font-mono text-[11px] text-gray-500 w-12 text-right shrink-0 tabular-nums">{t.leverageBps / 10000}x</span>
                        <span className="font-mono text-[11px] text-gray-600 w-16 text-right shrink-0">{ago(t.ts)}</span>
                        <span className="font-mono text-[11px] text-vermilion w-4 text-right shrink-0">{t.digest ? '↗' : ''}</span>
                      </div>
                    );
                    return t.digest ? (
                      <a key={i} href={SUISCAN_TX(t.digest)} target="_blank" rel="noreferrer" className="block">
                        {inner}
                      </a>
                    ) : (
                      <div key={i}>{inner}</div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        )}

        <Footer />
      </main>
    </div>
  );
}
