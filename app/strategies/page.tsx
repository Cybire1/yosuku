'use client';

import { useEffect, useState, useCallback } from 'react';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import { BrainCircuit, Copy, Radio, Share2, Trophy } from 'lucide-react';
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
  fetchStrategySubscriptions,
  buildFundAndSubscribeTx,
  buildListStrategyTx,
  buildCancelSubscriptionTx,
  buildCopyTradeShareText,
  buildLeaderboardShareText,
  buildStrategyShareText,
  fetchSocialVaultBalance,
  fmtDusdc,
  fmtAddr,
  ago,
  glyphFromAddress,
  rankStrategies,
  SUISCAN_TX,
  SUISCAN_ACC,
  xIntentUrl,
  type StrategyCard,
  type CopyTrade,
  type StrategySubscription,
} from '@/lib/sui/strategyClient';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { getSponsorStatus, type SponsorStatus } from '@/lib/sponsor';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';

export default function StrategiesPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { coins: dusdcCoins, refresh: refreshDusdc } = useDUSDCBalance();
  const { toast } = useToast();
  const { submit } = useSmartSubmit();

  const [strategies, setStrategies] = useState<StrategyCard[]>([]);
  const [copyTrades, setCopyTrades] = useState<CopyTrade[]>([]);
  const [subscriptions, setSubscriptions] = useState<StrategySubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [socialVaultBalance, setSocialVaultBalance] = useState(0);
  const [targetBalances, setTargetBalances] = useState<Record<string, string>>({});

  // creator: "list a strategy" form
  const [showList, setShowList] = useState(false);
  const [listing, setListing] = useState(false);
  const [form, setForm] = useState({ agent: '', memoryAccount: '', capsuleBlob: '', maxLeverage: '3', maxMargin: '5', subFee: '0.1' });

  const leaderboard = rankStrategies(strategies);
  const topRows = leaderboard.slice(0, 5);
  const rankById = new Map(leaderboard.map((row) => [row.id, row.rank]));
  const subscriptionByStrategy = new Map(subscriptions.map((sub) => [sub.strategy, sub]));
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000000';

  function postToX(text: string) {
    window.open(xIntentUrl(text), '_blank', 'noopener,noreferrer');
  }

  const targetBalanceFor = (card: StrategyCard) => targetBalances[card.id] ?? '1';

  const refreshSocialVaultBalance = useCallback(async () => {
    if (!address) {
      setSocialVaultBalance(0);
      return;
    }
    try {
      setSocialVaultBalance(await fetchSocialVaultBalance(address));
    } catch {
      setSocialVaultBalance(0);
    }
  }, [address]);

  const refreshSubscriptions = useCallback(async () => {
    if (!address) {
      setSubscriptions([]);
      return;
    }
    try {
      setSubscriptions(await fetchStrategySubscriptions(address));
    } catch {
      setSubscriptions([]);
    }
  }, [address]);

  async function copyPost(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1400);
      toast('Post copied', 'success');
    } catch {
      toast('Could not copy post text', 'error');
    }
  }

  // discover the gas station once; if up, subscribing is gas-free.
  useEffect(() => {
    getSponsorStatus().then(setSponsor).catch(() => {});
  }, []);

  // default the strategy's executing agent to the connected wallet (a creator usually runs
  // their own agent key; they can paste a dedicated agent address instead).
  useEffect(() => {
    if (address && !form.agent) setForm((f) => ({ ...f, agent: address }));
  }, [address, form.agent]);

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

  useEffect(() => {
    refreshSocialVaultBalance();
    refreshSubscriptions();
    const id = setInterval(() => {
      refreshSocialVaultBalance();
      refreshSubscriptions();
    }, 20_000);
    return () => clearInterval(id);
  }, [refreshSocialVaultBalance, refreshSubscriptions]);

  // Subscriber: pay the fee + authorize the agent to copy-trade your budget, under
  // the strategy's hard caps. Mirrors WaitlistCard.join(): sponsored path if the gas
  // station is up, wallet-pays fallback otherwise — both execute off JSON-RPC over gRPC.
  async function subscribe(card: StrategyCard) {
    if (!address) return;
    const targetBalance = Number(targetBalanceFor(card).replace(',', '.'));
    if (!Number.isFinite(targetBalance) || targetBalance <= 0) {
      toast('Enter a Copy Budget above 0', 'error');
      return;
    }
    const targetMicro = BigInt(Math.floor(targetBalance * DUSDC_MULTIPLIER));
    const currentVaultMicro = BigInt(Math.floor(socialVaultBalance));
    const topUpMicro = targetMicro > currentVaultMicro ? targetMicro - currentVaultMicro : BigInt(0);
    const feeMicro = BigInt(Math.floor(card.subFee * DUSDC_MULTIPLIER));
    const walletMicro = dusdcCoins.reduce((sum, c) => sum + c.balance, BigInt(0));
    const neededMicro = topUpMicro + feeMicro;

    if (walletMicro < neededMicro) {
      toast(
        `Wallet DUSDC too low — needs ${(Number(neededMicro) / DUSDC_MULTIPLIER).toFixed(2)} for budget + fee`,
        'error',
      );
      return;
    }
    setSubscribingId(card.id);
    try {
      await submit(() =>
        buildFundAndSubscribeTx({
          owner: address,
          strategyId: card.id,
          coinIds: dusdcCoins.map((c) => c.coinObjectId),
          topUpMicro,
          subFeeMicro: feeMicro,
        }),
      );
      toast(
        topUpMicro > BigInt(0)
          ? `Copy Budget set. Now copying ${fmtAddr(card.agent)}`
          : `Now copying ${fmtAddr(card.agent)} with your Copy Budget`,
        'success',
      );
      await load();
      refreshSocialVaultBalance();
      refreshSubscriptions();
      refreshDusdc();
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 140);
      toast(`Could not start copying: ${msg}`, 'error');
    } finally {
      setSubscribingId(null);
    }
  }

  async function cancelSubscription(sub: StrategySubscription) {
    if (!address || cancelingId) return;
    setCancelingId(sub.id);
    try {
      await submit(() => buildCancelSubscriptionTx(sub.id));
      toast(`Paused future copies for ${fmtAddr(sub.agent)}`, 'success');
      refreshSubscriptions();
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 140);
      toast(`Pause failed: ${msg}`, 'error');
    } finally {
      setCancelingId(null);
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
    const memoryAccount = form.memoryAccount.trim() || ZERO_ADDR;
    let capsuleBlob = BigInt(0);
    try {
      capsuleBlob = BigInt(form.capsuleBlob.trim() || '0');
    } catch {
      toast('Strategy file ID must be a number, or blank', 'error');
      return;
    }
    if (maxLeverageBps < 10_000) { toast('Max leverage must be at least 1x', 'error'); return; }
    if (maxMarginMicro <= BigInt(0)) { toast('Max budget per trade must be greater than 0', 'error'); return; }
    if (!/^0x[0-9a-fA-F]{64}$/.test(agent)) { toast('Agent must be a 0x… address', 'error'); return; }
    if (memoryAccount !== ZERO_ADDR && !/^0x[0-9a-fA-F]{64}$/.test(memoryAccount)) {
      toast('Verified memory must be a 0x… address, or blank', 'error');
      return;
    }
    setListing(true);
    try {
      await submit(() =>
        buildListStrategyTx({
          agent,
          capsuleBlob,
          memoryAccount,
          maxLeverageBps,
          maxMarginMicro,
          subFeeMicro,
          creator: address,
        }),
      );
      toast('Strategy published — users can now copy it', 'success');
      setShowList(false);
      await load();
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 140);
      toast(`Publish failed: ${msg}`, 'error');
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
          Agent Strategies
        </h1>
        <p className="font-jp text-gray-500 text-sm mb-6">コピー取引</p>

        <p className="text-gray-400 text-sm leading-relaxed max-w-2xl mb-6">
          Copy prediction agents with a capped budget. They can trade for you, but they
          cannot withdraw your funds. Pause anytime.
        </p>

        {/* Creator: list a strategy */}
        <div className="mb-10">
          {address && (
            <button
              onClick={() => setShowList((v) => !v)}
              className="font-mono text-[12px] px-4 py-2 rounded-full border border-white/10 hover:border-white/25 hover:bg-white/[0.03] text-gray-300 hover:text-white transition-colors"
            >
              {showList ? '× Close creator mode' : '+ Creator mode'}
            </button>
          )}

          {address && showList && (
            <div className="border border-white/[0.08] rounded bg-bg p-5 mt-4 max-w-2xl">
              <h3 className="font-display font-[700] text-sm text-white mb-1">Publish an agent strategy</h3>
              <p className="text-gray-500 text-xs leading-relaxed mb-5">
                Set the risk limits subscribers see before they copy you. Your agent can trade
                only inside those limits and can never withdraw user funds. Verified memory and
                strategy files are optional.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Agent wallet</span>
                  <input
                    value={form.agent}
                    onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
                    placeholder="0x… (defaults to you)"
                    className="w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-[12px] outline-none transition-colors"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Subscription fee</span>
                  <input
                    type="number" min="0" step="0.1"
                    value={form.subFee}
                    onChange={(e) => setForm((f) => ({ ...f, subFee: e.target.value }))}
                    className="w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-sm outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Verified memory</span>
                  <input
                    value={form.memoryAccount}
                    onChange={(e) => setForm((f) => ({ ...f, memoryAccount: e.target.value }))}
                    placeholder="0x… optional"
                    className="w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-[12px] outline-none transition-colors"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Strategy file</span>
                  <input
                    value={form.capsuleBlob}
                    onChange={(e) => setForm((f) => ({ ...f, capsuleBlob: e.target.value }))}
                    placeholder="optional file id"
                    className="w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-[12px] outline-none transition-colors"
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
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">Max budget / trade</span>
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
          <div className="flex flex-col gap-8">
            {/* 02: Leaderboard + X distribution */}
            <section className="order-2">
              <SectionHeader
                number="02"
                title="Proof leaderboard"
                jp="拡散"
                live={topRows.length > 0}
                meta={`${topRows.length} ranked`}
              />

              <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.6fr] gap-5">
                <div className="border border-white/[0.08] rounded bg-bg p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full border border-vermilion/30 bg-vermilion/10 flex items-center justify-center">
                      <Radio className="w-4 h-4 text-vermilion" />
                    </div>
                    <div>
                      <h3 className="font-display font-[700] text-white text-base">Share the leaderboard</h3>
                      <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-gray-500">human-approved X post</p>
                    </div>
                  </div>
                  <p className="text-gray-400 text-sm leading-relaxed mb-5">
                    Turn live copy-trading activity into a clean X post. The claim links back here;
                    the proof lives in Sui events and verified memory pointers.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => postToX(buildLeaderboardShareText(leaderboard))}
                      className="inline-flex items-center justify-center gap-2 flex-1 py-3 rounded bg-white text-black text-sm font-semibold hover:bg-gray-200 transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                      Post leaderboard
                    </button>
                    <button
                      onClick={() => copyPost('leaderboard', buildLeaderboardShareText(leaderboard))}
                      className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded border border-white/10 text-gray-300 hover:text-white hover:border-white/25 transition-colors"
                      aria-label="Copy leaderboard post"
                    >
                      <Copy className="w-4 h-4" />
                      <span className="sr-only">{copiedId === 'leaderboard' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                <div className="border border-white/[0.08] rounded bg-bg divide-y divide-white/[0.05] overflow-hidden">
                  {topRows.length === 0 ? (
                    <div className="font-mono text-xs text-gray-600 px-5 py-8 text-center">no strategy proof yet</div>
                  ) : (
                    topRows.map((row) => {
                      const shareText = buildStrategyShareText(row, row.rank);
                      return (
                        <div key={row.id} className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                          <div className="flex items-start gap-4">
                            <div className="w-10 h-10 shrink-0 rounded-full border border-white/10 flex items-center justify-center">
                              {row.rank === 1 ? (
                                <Trophy className="w-4 h-4 text-vermilion" />
                              ) : (
                                <span className="font-mono text-xs text-gray-400">#{row.rank}</span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-2">
                                <a
                                  href={SUISCAN_ACC(row.agent)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-mono text-[13px] text-gray-200 hover:text-white transition-colors"
                                >
                                  agent {fmtAddr(row.agent)}
                                </a>
                                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-gray-500 border border-white/10 rounded px-2 py-1">
                                  {row.distributionLabel}
                                </span>
                                {row.hasMemory && (
                                  <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.16em] text-new-mint border border-new-mint/20 rounded px-2 py-1">
                                    <BrainCircuit className="w-3 h-3" />
                                    MemWal
                                  </span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                <MiniStat label="score" value={row.score.toFixed(0)} />
                                <MiniStat label="proof" value={String(row.proofCount)} />
                                <MiniStat label="trades" value={String(row.copyTrades)} />
                                <MiniStat label="copiers" value={String(row.subscribers)} />
                                <MiniStat
                                  label={row.realizedTrades > 0 ? 'realized' : 'copied'}
                                  value={
                                    row.realizedTrades > 0
                                      ? `${row.realizedPnl >= 0 ? '+' : ''}${fmtDusdc(row.realizedPnl)}`
                                      : fmtDusdc(row.volumeCopied)
                                  }
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => copyPost(`strategy-${row.id}`, shareText)}
                                className="w-9 h-9 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/25 transition-colors flex items-center justify-center"
                                aria-label="Copy strategy proof post"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => postToX(shareText)}
                                className="w-9 h-9 rounded bg-vermilion text-white hover:bg-vermilion-d transition-colors flex items-center justify-center"
                                aria-label="Post strategy proof to X"
                              >
                                <Share2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </section>

            {/* 01: The strategies */}
            <section className="order-1">
              <SectionHeader number="01" title="Copy an agent" jp="戦略" live={strategies.length > 0} meta={`${strategies.length} listed`} />

              {strategies.length === 0 ? (
                <div className="border border-white/[0.08] rounded bg-bg p-16 text-center">
                  <div className="w-16 h-16 mx-auto mb-6 border border-white/10 rounded-full flex items-center justify-center">
                    <span className="font-jp text-2xl text-gray-500">戦</span>
                  </div>
                  <h2 className="font-display font-[700] text-xl text-white mb-2">No strategies yet</h2>
                  <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    {loadError
                      ? "Couldn't reach the chain — retrying."
                      : 'Copyable agents will appear here as creators publish them. Each one is bound to risk limits before a single user dollar moves.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {strategies.map((card) => {
                    const busy = subscribingId === card.id;
                    const free = card.subFee === 0 && !!sponsor;
                    const rank = rankById.get(card.id);
                    const activeSub = subscriptionByStrategy.get(card.id);
                    const shareText = buildStrategyShareText(card, rank);
                    const targetText = targetBalanceFor(card);
                    const targetBalance = Number(targetText.replace(',', '.'));
                    const validTarget = Number.isFinite(targetBalance) && targetBalance > 0;
                    const currentVaultDusdc = socialVaultBalance / DUSDC_MULTIPLIER;
                    const topUpDusdc = validTarget ? Math.max(0, targetBalance - currentVaultDusdc) : 0;
                    const walletNeedDusdc = topUpDusdc + card.subFee;
                    const copyCapacity = validTarget ? Math.min(targetBalance, card.maxMargin) : 0;
                    const cta = topUpDusdc > 0.000001
                      ? `Add ${fmtDusdc(topUpDusdc)} + start copying →`
                      : free
                        ? 'Start copying — free →'
                        : `Start copying · ${fmtDusdc(card.subFee)} DUSDC`;
                    return (
                      <div key={card.id} id={`strategy-${card.id}`} className="border border-white/[0.08] rounded bg-bg p-5 flex flex-col">
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
                                Strategy file
                              </span>
                            )}
                            {card.hasMemory && (
                              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-gray-400 border border-white/10 rounded px-2 py-1">
                                Verified memory
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => copyPost(`card-${card.id}`, shareText)}
                              className="w-8 h-8 rounded border border-white/10 text-gray-500 hover:text-white hover:border-white/25 transition-colors flex items-center justify-center"
                              aria-label="Copy strategy post"
                              title={copiedId === `card-${card.id}` ? 'Copied' : 'Copy post'}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => postToX(shareText)}
                              className="w-8 h-8 rounded border border-vermilion/35 text-vermilion hover:bg-vermilion/10 transition-colors flex items-center justify-center"
                              aria-label="Post strategy to X"
                              title="Post to X"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* caps row */}
                        <div className="grid grid-cols-3 gap-4 pb-4 mb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Max leverage</span>
                            <span className="font-mono text-sm text-white">{card.maxLeverage}x</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Max / trade</span>
                            <span className="font-mono text-sm text-white">{fmtDusdc(card.maxMargin)} DUSDC</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Fee</span>
                            <span className="font-mono text-sm text-white">{fmtDusdc(card.subFee)} DUSDC</span>
                          </div>
                        </div>

                        {/* live performance row */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Copiers</span>
                            <span className="font-mono text-sm text-white tabular-nums">{card.subscribers}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Trades</span>
                            <span className="font-mono text-sm text-white tabular-nums">{card.copyTrades}</span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">
                              {card.realizedTrades > 0 ? 'Realized P&L' : 'Vol copied'}
                            </span>
                            <span className="font-mono text-sm text-white tabular-nums">
                              {card.realizedTrades > 0
                                ? `${card.realizedPnl >= 0 ? '+' : ''}${fmtDusdc(card.realizedPnl)}`
                                : fmtDusdc(card.volumeCopied)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1">Last active</span>
                            <span className="font-mono text-sm text-white">{ago(card.lastActive)}</span>
                          </div>
                        </div>

                        <div className="border border-new-mint/20 bg-new-mint/[0.04] rounded p-4 mb-5">
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div>
                              <h3 className="font-display font-[700] text-sm text-white mb-1">Copy Budget</h3>
                              <p className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-500">
                                your limit · pause anytime
                              </p>
                            </div>
                            <span className="shrink-0 font-mono text-[9px] tracking-[0.16em] uppercase text-new-mint border border-new-mint/20 rounded-full px-2.5 py-1">
                              auto capped
                            </span>
                          </div>
                          <div className="flex items-center gap-2 rounded border border-white/[0.08] bg-black/20 px-3 py-2 mb-3">
                            <input
                              type="number"
                              min="0"
                              step="0.1"
                              value={targetText}
                              onChange={(e) => setTargetBalances((m) => ({ ...m, [card.id]: e.target.value }))}
                              className="flex-1 bg-transparent outline-none text-white font-mono text-lg tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <span className="font-mono text-[11px] text-gray-500 tracking-[0.14em]">DUSDC</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mb-3">
                            <MiniStat label="current budget" value={`${fmtDusdc(currentVaultDusdc)} DUSDC`} />
                            <MiniStat label="add today" value={validTarget ? `${fmtDusdc(topUpDusdc)} DUSDC` : '—'} />
                            <MiniStat label="wallet needed" value={`${fmtDusdc(walletNeedDusdc)} DUSDC`} />
                            <MiniStat label="max copied" value={validTarget ? `${fmtDusdc(copyCapacity)} DUSDC` : '—'} />
                          </div>
                          <p className="text-[12px] leading-relaxed text-gray-500">
                            This agent can only use your Copy Budget and cannot withdraw it. Each copied trade is capped at
                            {' '}{fmtDusdc(card.maxMargin)} DUSDC, max {card.maxLeverage}x.
                          </p>
                        </div>

                        {/* subscribe action */}
                        <div className="mt-auto">
                          {!address ? (
                            <ConnectButton />
                          ) : activeSub ? (
                            <div className="border border-new-mint/25 bg-new-mint/[0.06] rounded p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-new-mint mb-1">
                                    copying
                                  </p>
                                  <p className="text-[12px] text-gray-400 leading-relaxed">
                                    Future copies are active. The agent cannot exceed {fmtDusdc(activeSub.maxMargin)}
                                    DUSDC per trade or {activeSub.maxLeverageBps / 10_000}x.
                                  </p>
                                </div>
                                <button
                                  onClick={() => cancelSubscription(activeSub)}
                                  disabled={cancelingId === activeSub.id}
                                  className="shrink-0 px-3 py-2 rounded border border-white/10 text-gray-300 hover:text-white hover:border-white/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[10px] uppercase tracking-[0.14em]"
                                >
                                  {cancelingId === activeSub.id ? 'pausing…' : 'pause'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => subscribe(card)}
                              disabled={busy || !validTarget}
                              className="w-full py-3 rounded text-sm font-semibold bg-vermilion hover:bg-vermilion-d text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {busy
                                ? 'starting…'
                                : cta}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 03: Recent copy-trades */}
            <section className="order-3">
              <SectionHeader number="03" title="Recent copy-trades" jp="コピー取引" meta={`${copyTrades.length}`} />
              <div className="border border-white/[0.08] rounded bg-bg divide-y divide-white/[0.05] overflow-hidden">
                {copyTrades.length === 0 ? (
                  <div className="font-mono text-xs text-gray-600 px-5 py-8 text-center">no copy-trades indexed yet</div>
                ) : (
                  copyTrades.map((t, i) => {
                    const strategy = strategies.find((s) => s.id === t.strategy);
                    const shareText = buildCopyTradeShareText(t, strategy);
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyPost(`trade-${i}`, shareText);
                          }}
                          className="w-7 h-7 rounded border border-white/10 text-gray-600 hover:text-white hover:border-white/25 transition-colors flex items-center justify-center"
                          aria-label="Copy copy-trade proof post"
                          title={copiedId === `trade-${i}` ? 'Copied' : 'Copy post'}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            postToX(shareText);
                          }}
                          className="w-7 h-7 rounded border border-vermilion/30 text-vermilion/80 hover:text-vermilion hover:bg-vermilion/10 transition-colors flex items-center justify-center"
                          aria-label="Post copy-trade proof to X"
                          title="Post to X"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-mono text-[11px] text-vermilion w-4 text-right shrink-0">{t.digest ? '↗' : ''}</span>
                      </div>
                    );
                    // Row opens the tx; the address inside is its own link. Clickable
                    // div (not <a>) so we never nest <a> in <a> (hydration error).
                    const txHref = t.digest ? SUISCAN_TX(t.digest) : null;
                    return txHref ? (
                      <div
                        key={i}
                        role="link"
                        tabIndex={0}
                        onClick={() => window.open(txHref, '_blank', 'noopener,noreferrer')}
                        onKeyDown={(e) => { if (e.key === 'Enter') window.open(txHref, '_blank', 'noopener,noreferrer'); }}
                        className="block cursor-pointer"
                      >
                        {inner}
                      </div>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-600 block mb-1">
        {label}
      </span>
      <span className="font-mono text-[12px] text-white tabular-nums">
        {value}
      </span>
    </div>
  );
}
