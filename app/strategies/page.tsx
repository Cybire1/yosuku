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
  buildListStrategyTx,
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

  // creator: "list a strategy" form
  const [showList, setShowList] = useState(false);
  const [listing, setListing] = useState(false);
  const [form, setForm] = useState({ agent: '', maxLeverage: '3', maxMargin: '5', subFee: '0.1' });

  // discover the gas station once; if up, subscribing is gas-free.
  useEffect(() => {
    getSponsorStatus().then(setSponsor).catch(() => {});
  }, []);

  // default the strategy's executing agent to the connected wallet (a creator usually runs
  // their own agent key; they can paste a dedicated agent address instead).
  useEffect(() => {
    if (address && !form.agent) setForm((f) => ({ ...f, agent: address }));
  }, [address, form.agent]);

  // Build → sign → execute, off JSON-RPC: sponsored (gas-free) path when the gas station is
  // up, wallet-pays fallback otherwise. Shared by subscribe + list. Returns the digest.
  const signSend = useCallback(async (tx: Transaction): Promise<string> => {
    if (sponsor) {
      tx.setSender(address!);
      tx.setGasOwner(sponsor.address);
      const bytes = await tx.build({ client: grpc });
      const signed = await signTransaction({ transaction: Transaction.from(bytes) });
      const r = await submitSponsored({ sender: address!, txBytes: signed.bytes, txSignature: signed.signature });
      return r.digest;
    }
    const r = await buildSignExecute(tx, ({ transaction }) =>
      signTransaction({ transaction }).then((s) => ({ bytes: s.bytes, signature: s.signature })),
    );
    return r.digest;
  }, [sponsor, address, signTransaction]);

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
      const digest = await signSend(tx);
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

  // Creator: publish a new investable strategy. The caps become the hard ceiling the agent
  // is bound to on every subscriber's funds. Capsule/memory pointers are optional (0 = none).
  async function listStrategy() {
    if (!address) return;
    const maxLeverageBps = Math.round(parseFloat(form.maxLeverage || '0') * 10_000);
    const maxMarginMicro = BigInt(Math.floor(parseFloat(form.maxMargin || '0') * DUSDC_MULTIPLIER));
    const subFeeMicro = BigInt(Math.floor(parseFloat(form.subFee || '0') * DUSDC_MULTIPLIER));
    const agent = form.agent.trim() || address;
    if (maxLeverageBps < 10_000) { toast('Max leverage must be at least 1x', 'error'); return; }
    if (maxMarginMicro <= BigInt(0)) { toast('Max margin must be greater than 0', 'error'); return; }
    if (!/^0x[0-9a-fA-F]{64}$/.test(agent)) { toast('Agent must be a 0x… address', 'error'); return; }
    setListing(true);
    try {
      const tx = buildListStrategyTx({
        agent,
        capsuleBlob: BigInt(0), // Seal playbook can be attached later via update_strategy
        memoryAccount: '0x0',   // MemWal pointer optional
        maxLeverageBps,
        maxMarginMicro,
        subFeeMicro,
        creator: address,
      });
      const digest = await signSend(tx);
      await grpc.waitForTransaction({ digest });
      toast('Strategy listed — it now appears in the marketplace', 'success');
      setShowList(false);
      await load();
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 140);
      toast(`List failed: ${msg}`, 'error');
    } finally {
      setListing(false);
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

        <p className="text-gray-400 text-sm leading-relaxed max-w-2xl mb-6">
          A catalogue of investable prediction-market agent strategies. Subscribe to one and the
          agent trades your funds under hard on-chain caps — and can never divert a cent: every
          position it opens is owned by you and force-pays you on exit.
        </p>

        {/* Creator: list a strategy */}
        <div className="mb-10">
          {address && (
            <button
              onClick={() => setShowList((v) => !v)}
              className="font-mono text-[12px] px-4 py-2 rounded-full border border-white/10 hover:border-white/25 hover:bg-white/[0.03] text-gray-300 hover:text-white transition-colors"
            >
              {showList ? '× Close' : '+ List a strategy'}
            </button>
          )}

          {address && showList && (
            <div className="border border-white/[0.08] rounded bg-bg p-5 mt-4 max-w-2xl">
              <h3 className="font-display font-[700] text-sm text-white mb-1">Publish a strategy</h3>
              <p className="text-gray-500 text-xs leading-relaxed mb-5">
                Your caps are the hard ceiling your agent is bound to on every subscriber&apos;s funds —
                it can never exceed them, and never holds subscriber capital. A Seal playbook capsule
                can be attached later.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Executing agent</span>
                  <input
                    value={form.agent}
                    onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
                    placeholder="0x… (defaults to you)"
                    className="w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-[12px] outline-none transition-colors"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Sub fee (DUSDC)</span>
                  <input
                    type="number" min="0" step="0.1"
                    value={form.subFee}
                    onChange={(e) => setForm((f) => ({ ...f, subFee: e.target.value }))}
                    className="w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-sm outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Max leverage (x)</span>
                  <input
                    type="number" min="1" step="1"
                    value={form.maxLeverage}
                    onChange={(e) => setForm((f) => ({ ...f, maxLeverage: e.target.value }))}
                    className="w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-sm outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Max margin / trade (DUSDC)</span>
                  <input
                    type="number" min="0" step="1"
                    value={form.maxMargin}
                    onChange={(e) => setForm((f) => ({ ...f, maxMargin: e.target.value }))}
                    className="w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-sm outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </label>
              </div>
              <button
                onClick={listStrategy}
                disabled={listing}
                className="w-full mt-5 py-3 rounded text-sm font-semibold bg-vermilion hover:bg-vermilion-d text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {listing ? 'listing…' : 'List strategy'}
              </button>
            </div>
          )}
        </div>

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
