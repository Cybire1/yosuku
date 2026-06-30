'use client';

import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useCurrentAccount, useSuiClient, useSignPersonalMessage, ConnectButton } from '@mysten/dapp-kit';
import { Share2, X } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import { useToast } from '@/components/Toast';
import { useDUSDCBalance } from '@/lib/sui/hooks';
import {
  fetchStrategies,
  fetchCopyTrades,
  fetchStrategySubscriptions,
  buildFundAndSubscribeTx,
  buildListStrategyTx,
  buildCancelSubscriptionTx,
  buildStrategyShareText,
  fetchSocialVaultBalance,
  fmtDusdc,
  fmtAddr,
  ago,
  glyphFromAddress,
  codenameFromAddress,
  SUISCAN_TX,
  SUISCAN_ACC,
  xIntentUrl,
  type StrategyCard,
  type CopyTrade,
  type StrategySubscription,
} from '@/lib/sui/strategyClient';
import { fetchMemoryMarket, buildBuyPassTx, readMemory, type MemoryMarketInfo } from '@/lib/sui/memoryMarketClient';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { getSponsorStatus, type SponsorStatus } from '@/lib/sponsor';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000000';
const SUISCAN_OBJ = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;
const DAY = 86_400_000;

type Tier = { key: 'new' | 'active' | 'settled'; label: string; tone: 'gray' | 'vermilion' | 'white' };

// Honest tiers. "Settled" means it has CLOSED, on-chain P&L (win OR loss) — it never implies
// profit; the realized number itself carries the sign. Never a red "unproven" on a clean new agent.
function tierOf(c: StrategyCard): Tier {
  if (c.realizedTrades > 0) return { key: 'settled', label: `Settled · ${c.realizedTrades} closed`, tone: 'white' };
  if (c.copyTrades >= 1) return { key: 'active', label: `Active · ${c.copyTrades} copy-trades`, tone: 'vermilion' };
  return { key: 'new', label: 'New · no track record yet', tone: 'gray' };
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'settled', label: 'Settled' },
  { key: 'memwal', label: 'Has memory' },
  { key: 'copied', label: 'Most copied' },
  { key: 'safest', label: 'Safest' },
  { key: 'new', label: 'New' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function filterSort(list: StrategyCard[], tab: TabKey): StrategyCard[] {
  let out = [...list];
  if (tab === 'settled') out = out.filter((c) => tierOf(c).key === 'settled');
  else if (tab === 'new') out = out.filter((c) => tierOf(c).key === 'new');
  else if (tab === 'memwal') out = out.filter((c) => c.hasMemory);
  const settledFirst = (a: StrategyCard, b: StrategyCard) =>
    (tierOf(b).key === 'settled' ? 1 : 0) - (tierOf(a).key === 'settled' ? 1 : 0);
  if (tab === 'copied') out.sort((a, b) => b.subscribers - a.subscribers || b.copyTrades - a.copyTrades);
  else if (tab === 'safest') out.sort((a, b) => a.maxLeverage - b.maxLeverage || a.maxMargin - b.maxMargin);
  else out.sort((a, b) => settledFirst(a, b) || b.copyTrades - a.copyTrades || b.subscribers - a.subscribers);
  return out;
}

export default function StrategiesPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { coins: dusdcCoins, refresh: refreshDusdc } = useDUSDCBalance();
  const { toast } = useToast();
  const { submit } = useSmartSubmit();
  const suiClient = useSuiClient();
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const [strategies, setStrategies] = useState<StrategyCard[]>([]);
  const [copyTrades, setCopyTrades] = useState<CopyTrade[]>([]);
  const [subscriptions, setSubscriptions] = useState<StrategySubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<SponsorStatus | null>(null);
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [socialVaultBalance, setSocialVaultBalance] = useState(0);

  const [tab, setTab] = useState<TabKey>('all');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [budget, setBudget] = useState(''); // copy-budget in the drawer (additive, never forced)
  const [memoryInfo, setMemoryInfo] = useState<MemoryMarketInfo | null>(null);
  const [buyingMemory, setBuyingMemory] = useState(false);
  const [memoryText, setMemoryText] = useState<string | null>(null);
  const [readingMemory, setReadingMemory] = useState(false);

  // creator: "list a strategy" form (demoted to a footer affordance)
  const [showList, setShowList] = useState(false);
  const [listing, setListing] = useState(false);
  const [form, setForm] = useState({ agent: '', memoryAccount: '', capsuleBlob: '', maxLeverage: '3', maxMargin: '5', subFee: '0.1' });

  const subscriptionByStrategy = useMemo(
    () => new Map(subscriptions.map((sub) => [sub.strategy, sub])),
    [subscriptions],
  );
  const visible = useMemo(() => filterSort(strategies, tab), [strategies, tab]);
  const totalCopiers = strategies.reduce((s, c) => s + (c.subscribers || 0), 0);
  const drawerCard = drawerId ? strategies.find((s) => s.id === drawerId) ?? null : null;
  const walletDusdc = dusdcCoins.reduce((s, c) => s + c.balance, BigInt(0));
  const walletDusdcNum = Number(walletDusdc) / DUSDC_MULTIPLIER;
  const currentVaultDusdc = socialVaultBalance / DUSDC_MULTIPLIER;
  const tabCount = (k: TabKey) => filterSort(strategies, k).length;

  function postToX(text: string) {
    window.open(xIntentUrl(text), '_blank', 'noopener,noreferrer');
  }

  const refreshSocialVaultBalance = useCallback(async () => {
    if (!address) return setSocialVaultBalance(0);
    try { setSocialVaultBalance(await fetchSocialVaultBalance(address)); } catch { setSocialVaultBalance(0); }
  }, [address]);

  const refreshSubscriptions = useCallback(async () => {
    if (!address) return setSubscriptions([]);
    try { setSubscriptions(await fetchStrategySubscriptions(address)); } catch { setSubscriptions([]); }
  }, [address]);

  useEffect(() => { getSponsorStatus().then(setSponsor).catch(() => {}); }, []);

  useEffect(() => {
    if (address && !form.agent) setForm((f) => ({ ...f, agent: address }));
  }, [address, form.agent]);

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([fetchStrategies(), fetchCopyTrades(50)]);
      setStrategies(s); setCopyTrades(t); setLoadError(null);
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e).slice(0, 160));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    refreshSocialVaultBalance(); refreshSubscriptions();
    const id = setInterval(() => { refreshSocialVaultBalance(); refreshSubscriptions(); }, 20_000);
    return () => clearInterval(id);
  }, [refreshSocialVaultBalance, refreshSubscriptions]);

  // open/close the copy drawer: reset budget, lock scroll, Esc to close.
  const openDrawer = (id: string) => { setBudget(''); setMemoryText(null); setDrawerId(id); };
  const closeDrawer = useCallback(() => setDrawerId(null), []);
  useEffect(() => {
    if (!drawerId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [drawerId, closeDrawer]);

  // memory market: is this agent's memory for sale, and do you already hold a pass?
  useEffect(() => {
    if (!drawerId) { setMemoryInfo(null); return; }
    let live = true;
    fetchMemoryMarket(drawerId, address).then((m) => { if (live) setMemoryInfo(m); });
    return () => { live = false; };
  }, [drawerId, address]);

  async function buyMemoryPass() {
    if (!address || !memoryInfo || !drawerId) return;
    const priceMicro = BigInt(Math.round(memoryInfo.price * DUSDC_MULTIPLIER));
    const walletMicro = dusdcCoins.reduce((s, c) => s + c.balance, BigInt(0));
    if (walletMicro < priceMicro) { toast(`Wallet DUSDC too low — needs ${memoryInfo.price} for the memory pass`, 'error'); return; }
    setBuyingMemory(true);
    try {
      await submit(() => buildBuyPassTx({ listingId: memoryInfo.listingId, coinIds: dusdcCoins.map((c) => c.coinObjectId), priceMicro, owner: address }));
      toast('Memory Pass bought', 'success');
      setMemoryInfo(await fetchMemoryMarket(drawerId, address));
      refreshDusdc();
    } catch (e) {
      toast(`Could not buy memory: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setBuyingMemory(false); }
  }

  async function readMemoryHandler() {
    if (!address || !memoryInfo?.passId) return;
    setReadingMemory(true);
    try {
      const text = await readMemory({ suiClient, walletAddress: address, listingId: memoryInfo.listingId, passId: memoryInfo.passId, signPersonalMessage });
      setMemoryText(text);
    } catch (e) {
      toast(`Couldn't read the playbook: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setReadingMemory(false); }
  }

  // Subscriber: top up the capped budget + authorize the agent to copy-trade under hard caps.
  async function subscribe(card: StrategyCard, budgetStr: string) {
    if (!address) return;
    const target = Number(budgetStr.replace(',', '.'));
    if (!Number.isFinite(target) || target <= 0) { toast('Enter a copy budget above 0', 'error'); return; }
    const targetMicro = BigInt(Math.floor(target * DUSDC_MULTIPLIER));
    const currentMicro = BigInt(Math.floor(socialVaultBalance));
    const topUpMicro = targetMicro > currentMicro ? targetMicro - currentMicro : BigInt(0);
    const feeMicro = BigInt(Math.floor(card.subFee * DUSDC_MULTIPLIER));
    const needed = topUpMicro + feeMicro;
    if (walletDusdc < needed) {
      toast(`Wallet DUSDC too low — needs ${(Number(needed) / DUSDC_MULTIPLIER).toFixed(2)} for budget + fee`, 'error');
      return;
    }
    setSubscribingId(card.id);
    try {
      await submit(() => buildFundAndSubscribeTx({
        owner: address, strategyId: card.id,
        coinIds: dusdcCoins.map((c) => c.coinObjectId),
        topUpMicro, subFeeMicro: feeMicro,
      }));
      toast(`Now copying ${codenameFromAddress(card.agent)}`, 'success');
      closeDrawer();
      await load(); refreshSocialVaultBalance(); refreshSubscriptions(); refreshDusdc();
    } catch (e) {
      toast(`Could not start copying: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setSubscribingId(null); }
  }

  async function cancelSubscription(sub: StrategySubscription) {
    if (!address || cancelingId) return;
    setCancelingId(sub.id);
    try {
      await submit(() => buildCancelSubscriptionTx(sub.id));
      toast(`Paused future copies for ${codenameFromAddress(sub.agent)}`, 'success');
      refreshSubscriptions();
    } catch (e) {
      toast(`Pause failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setCancelingId(null); }
  }

  async function listStrategy() {
    if (!address) return;
    const maxLeverageBps = Math.round(parseFloat(form.maxLeverage || '0') * 10_000);
    const maxMarginMicro = BigInt(Math.floor(parseFloat(form.maxMargin || '0') * DUSDC_MULTIPLIER));
    const subFeeMicro = BigInt(Math.floor(parseFloat(form.subFee || '0') * DUSDC_MULTIPLIER));
    const agent = form.agent.trim() || address;
    const memoryAccount = form.memoryAccount.trim() || ZERO_ADDR;
    let capsuleBlob = BigInt(0);
    try { capsuleBlob = BigInt(form.capsuleBlob.trim() || '0'); }
    catch { toast('Playbook file ID must be a number, or blank', 'error'); return; }
    if (maxLeverageBps < 10_000) { toast('Max leverage must be at least 1×', 'error'); return; }
    if (maxMarginMicro <= BigInt(0)) { toast('Max budget per trade must be greater than 0', 'error'); return; }
    if (!/^0x[0-9a-fA-F]{64}$/.test(agent)) { toast('Agent must be a 0x… address', 'error'); return; }
    if (memoryAccount !== ZERO_ADDR && !/^0x[0-9a-fA-F]{64}$/.test(memoryAccount)) { toast('Memory must be a 0x… address, or blank', 'error'); return; }
    setListing(true);
    try {
      await submit(() => buildListStrategyTx({ agent, capsuleBlob, memoryAccount, maxLeverageBps, maxMarginMicro, subFeeMicro, creator: address }));
      toast('Strategy published — users can now copy it', 'success');
      setShowList(false); await load();
    } catch (e) {
      toast(`Publish failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally { setListing(false); }
  }

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        {/* masthead — dateline with live counts */}
        <div className="border-t border-white/10 pt-3 flex items-center justify-between gap-4 font-mono text-[10px] md:text-[11px] uppercase tracking-[0.28em] text-white/40">
          <span><span className="text-vermilion">⊙</span> Yosuku Ledger · <span className="font-jp">戦略</span></span>
          <span className="tabular-nums flex items-center gap-2">
            <span className="hidden sm:inline">Est. on Sui ·</span>
            <span className="text-white">{strategies.length}</span> listed
            <span className="text-white/20">·</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-vermilion animate-pulse" /><span className="text-white">{totalCopiers}</span> copying</span>
          </span>
        </div>

        {/* nameplate + standfirst */}
        <div className="grid md:grid-cols-[1fr_300px] gap-6 md:gap-10 items-end mt-7 pb-6 border-b border-white/15">
          <h1 className="font-display font-[800] text-[2.6rem] leading-[0.95] md:text-7xl text-white tracking-tight">
            Copy AI traders.<br /><span className="text-white/40">Without giving them custody.</span>
          </h1>
          <div className="md:border-l md:border-white/10 md:pl-7">
            <div className="font-mono text-[12px] leading-[1.95] text-white/55">
              {['Pick a trader', 'See its record', 'Set a Copy Balance', 'Copy it'].map((s, i) => (
                <span key={s} className="mr-3 inline-block whitespace-nowrap"><span className="text-vermilion">{String(i + 1).padStart(2, '0')}</span> {s}</span>
              ))}
              <span className="text-white font-semibold">Stop anytime.</span>
            </div>
          </div>
        </div>

        {/* trust dateline — the dot-leader line that replaces the old pill */}
        <div className="font-mono text-[10px] md:text-[11px] uppercase tracking-[0.22em] text-white/40 mt-4 mb-8">
          Non-custodial · Caps enforced on Sui · Past results do not guarantee future
        </div>

        {/* control bar — curated tabs (replaces the dead leaderboard) */}
        <div className="sticky top-[64px] z-20 -mx-4 px-4 py-3 mb-7 bg-bg/85 backdrop-blur-md border-b border-white/[0.06]">
          <div className="flex items-center gap-5 overflow-x-auto no-scrollbar">
            {TABS.map((t) => {
              const on = tab === t.key;
              const n = tabCount(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`shrink-0 px-1 pb-2 font-mono text-[11px] uppercase tracking-[0.12em] border-b-2 transition-colors ${
                    on ? 'text-white border-vermilion' : 'text-white/40 hover:text-white border-transparent'
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 tabular-nums ${on ? 'text-white/30' : 'text-white/20'}`}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loading && strategies.length === 0 ? (
          <div className="font-mono text-sm text-gray-500 py-24 text-center">reading the chain…</div>
        ) : (
          <>
            {/* 01 — the marketplace grid (primary) */}
            {visible.length === 0 ? (
              <div className="border border-white/[0.08] bg-white/[0.02] p-16 text-center">
                <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-white/40 mb-4"><span className="text-vermilion">⊙</span> Yosuku Ledger</div>
                <h2 className="font-display font-[800] text-2xl text-white mb-2">
                  {strategies.length === 0 ? 'No editions filed yet' : `No ${tab} agents`}
                </h2>
                <p className="text-white/40 text-sm max-w-md mx-auto leading-relaxed">
                  {loadError
                    ? "Couldn't reach the chain — retrying every 30s."
                    : strategies.length === 0
                      ? 'Copyable agents appear here the moment a creator publishes one. Every agent is bound to hard risk caps on Sui before a dollar of yours can move.'
                      : 'Nothing matches this filter yet — try another tab.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-white/[0.06] border border-white/[0.06]">
                {visible.map((card, i) => {
                  const tier = tierOf(card);
                  const sub = subscriptionByStrategy.get(card.id);
                  const folio = String(i + 1).padStart(2, '0');
                  return (
                    <div
                      key={card.id}
                      id={`strategy-${card.id}`}
                      className="group relative bg-bg p-5 flex flex-col transition-colors duration-200 hover:bg-white/[0.02]"
                    >
                      <Crosshairs />

                      {/* dateline: folio · tier — last filed */}
                      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.25em] pb-3 mb-4 border-b border-white/[0.08]">
                        <span className="flex items-center gap-3">
                          <span className="text-white/30">Nº {folio}</span>
                          <TierWord tier={tier} />
                        </span>
                        <span className="text-white/40">{ago(card.lastActive) || '—'}</span>
                      </div>

                      {/* identity — ruled square glyph that ignites on hover */}
                      <div className="flex items-start gap-3">
                        <div className="w-11 h-11 shrink-0 border border-white/10 flex items-center justify-center transition-transform duration-200 group-hover:scale-[1.04] group-hover:drop-shadow-[0_0_22px_rgba(224,77,38,0.3)]">
                          <span className="font-jp text-xl text-vermilion">{glyphFromAddress(card.agent)}</span>
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <h3 className="font-display font-[800] text-xl text-white truncate tracking-tight leading-[1.05]">{codenameFromAddress(card.agent)}</h3>
                          <a href={SUISCAN_ACC(card.agent)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            className="font-mono text-[11px] text-white/40 hover:text-white transition-colors">{fmtAddr(card.agent)}</a>
                        </div>
                      </div>

                      {/* filed stamps — agent memory / Walrus playbook */}
                      {(card.hasMemory || card.hasCapsule) && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {card.hasMemory && (
                            <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-vermilion border border-vermilion/40 px-2 py-1">◈ Agent memory</span>
                          )}
                          {card.hasCapsule && (
                            <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 border border-white/15 px-2 py-1">▤ Walrus playbook</span>
                          )}
                        </div>
                      )}

                      {/* leverage pull-quote — the focal mass that carries sparse cards */}
                      <div className="border-l-2 border-vermilion pl-3 my-5">
                        <div className="font-display font-[800] text-3xl text-white leading-none tabular-nums">{card.maxLeverage}<span className="text-vermilion">×</span></div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40 mt-1.5">Max leverage</div>
                      </div>

                      {/* ruled stat table */}
                      <div className="grid grid-cols-3 border-y border-white/[0.08]">
                        <LedgerStat label="Max / trade" value={`${fmtDusdc(card.maxMargin)}`} />
                        <LedgerStat label="Fee" value={card.subFee === 0 ? 'Free' : fmtDusdc(card.subFee)} divide />
                        <LedgerStat label="Copiers" value={card.subscribers > 0 ? String(card.subscribers) : '—'} divide />
                      </div>

                      {/* record line — never blank */}
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] py-4 mb-1">
                        {card.copyTrades > 0 ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-white/60 tabular-nums">{card.copyTrades} copy-trades</span>
                            {card.realizedTrades > 0 && (
                              <>
                                <span className="text-white/20">·</span>
                                <span className="text-white tabular-nums">{card.realizedPnl >= 0 ? '▲' : '▼'} {card.realizedPnl >= 0 ? '+' : ''}{fmtDusdc(card.realizedPnl)}</span>
                              </>
                            )}
                          </span>
                        ) : (
                          <span className="text-white/40 tracking-[0.22em]">[ Awaiting first copy ]</span>
                        )}
                      </div>

                      {/* CTA */}
                      <div className="mt-auto">
                        {sub ? (
                          <button onClick={() => openDrawer(card.id)}
                            className="w-full py-3 font-mono text-[11px] uppercase tracking-[0.14em] font-semibold border border-white/20 text-white hover:border-white/40 hover:bg-white/[0.03] transition-colors inline-flex items-center justify-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-vermilion" /> Copying — manage
                          </button>
                        ) : (
                          <button onClick={() => openDrawer(card.id)}
                            className="group/cta w-full py-3 text-sm font-semibold bg-vermilion text-white hover:bg-vermilion-d transition-colors inline-flex items-center justify-center gap-2">
                            Copy this agent <span className="transition-transform group-hover/cta:translate-x-0.5">→</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 02 — recent copy-trades (slimmed; liveness + on-chain proof) */}
            <section className="mt-14">
              <div className="flex items-center gap-3 mb-4">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">Recent copy-trades</h2>
                <div className="h-px flex-1 bg-white/10" />
                <span className="font-mono text-[11px] text-white/30 tabular-nums">{copyTrades.length}</span>
              </div>
              <div className="border border-white/[0.08] bg-bg divide-y divide-white/[0.05] overflow-hidden">
                {copyTrades.length === 0 ? (
                  <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/30 px-5 py-8 text-center">No copy-trades settled yet — be the first.</div>
                ) : (
                  copyTrades.map((t, i) => {
                    const inner = (
                      <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                        <span className="font-jp text-sm text-vermilion w-5 shrink-0 text-center">{glyphFromAddress(t.agent || t.strategy)}</span>
                        <span className="font-display font-[700] text-[13px] text-white w-28 shrink-0 truncate">{codenameFromAddress(t.agent || t.strategy)}</span>
                        <a
                          href={SUISCAN_ACC(t.subscriber)} target="_blank" rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[12px] text-white/40 hover:text-white transition-colors hidden sm:inline"
                        >
                          {fmtAddr(t.subscriber)}
                        </a>
                        <span className="flex-1" />
                        <span className="font-mono text-[12px] text-white/70 tabular-nums">{fmtDusdc(t.notional)} DUSDC</span>
                        <span className="font-mono text-[11px] text-white/40 w-10 text-right shrink-0 tabular-nums">{t.leverageBps / 10000}×</span>
                        <span className="font-mono text-[11px] text-white/30 w-14 text-right shrink-0">{ago(t.ts)}</span>
                        <span className="font-mono text-[11px] text-vermilion w-4 text-right shrink-0">{t.digest ? '↗' : ''}</span>
                      </div>
                    );
                    const txHref = t.digest ? SUISCAN_TX(t.digest) : null;
                    return txHref ? (
                      <div
                        key={i} role="link" tabIndex={0}
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

            {/* creator mode — demoted to a quiet footer affordance */}
            <section className="mt-12">
              <div className="border border-white/[0.08] rounded-xl bg-bg p-5 flex flex-wrap items-center gap-4 justify-between">
                <div className="min-w-0">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion mb-1">For builders</div>
                  <p className="text-[13px] text-gray-300 max-w-md leading-snug">
                    Run an agent? Publish it as a copyable strategy — set the hard caps, earn a fee, and
                    users keep custody the whole time.
                  </p>
                </div>
                {address ? (
                  <button
                    onClick={() => setShowList((v) => !v)}
                    className="shrink-0 rounded-full border border-vermilion/40 bg-vermilion/[0.07] px-5 py-2.5 text-[13px] font-semibold text-vermilion hover:bg-vermilion/[0.14] transition-colors"
                  >
                    {showList ? '× Close' : 'Publish a strategy →'}
                  </button>
                ) : (
                  <span className="shrink-0 font-mono text-[12px] text-gray-600">Connect a wallet to publish.</span>
                )}
              </div>

              {address && showList && (
                <div className="border border-white/[0.08] rounded-xl bg-bg p-5 mt-4 max-w-2xl">
                  <h3 className="font-display font-[700] text-sm text-white mb-1">Publish an agent strategy</h3>
                  <p className="text-gray-500 text-xs leading-relaxed mb-5">
                    These limits become the hard ceiling your agent is bound to on every subscriber&apos;s
                    funds. It can trade only inside them and can never withdraw user money. Memory and
                    playbook files are optional.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Agent wallet">
                      <input value={form.agent} onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))} placeholder="0x… (defaults to you)" className={INPUT} />
                    </Field>
                    <Field label="Subscription fee (DUSDC)">
                      <input type="number" min="0" step="0.1" value={form.subFee} onChange={(e) => setForm((f) => ({ ...f, subFee: e.target.value }))} className={INPUT_NUM} />
                    </Field>
                    <Field label="Agent memory (optional)">
                      <input value={form.memoryAccount} onChange={(e) => setForm((f) => ({ ...f, memoryAccount: e.target.value }))} placeholder="0x… optional" className={INPUT} />
                    </Field>
                    <Field label="Playbook file (optional)">
                      <input value={form.capsuleBlob} onChange={(e) => setForm((f) => ({ ...f, capsuleBlob: e.target.value }))} placeholder="optional file id" className={INPUT} />
                    </Field>
                    <Field label="Max leverage (×)">
                      <input type="number" min="1" step="1" value={form.maxLeverage} onChange={(e) => setForm((f) => ({ ...f, maxLeverage: e.target.value }))} className={INPUT_NUM} />
                    </Field>
                    <Field label="Max budget / trade (DUSDC)">
                      <input type="number" min="0" step="1" value={form.maxMargin} onChange={(e) => setForm((f) => ({ ...f, maxMargin: e.target.value }))} className={INPUT_NUM} />
                    </Field>
                  </div>
                  <button
                    onClick={listStrategy} disabled={listing}
                    className="w-full mt-5 py-3 rounded-full text-sm font-semibold bg-vermilion hover:bg-vermilion-d text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {listing ? 'publishing…' : 'Publish strategy'}
                  </button>
                </div>
              )}
            </section>

            {/* standing disclosure */}
            <p className="mt-10 font-mono text-[10px] leading-relaxed text-gray-600 max-w-2xl">
              Agents trade testnet DUSDC on 15-min BTC markets. You can lose your full budget. The agent
              cannot withdraw or divert it — verify every position on Sui.
            </p>
          </>
        )}

        <Footer />
      </main>

      {/* ── copy drawer (slide-over) ── */}
      {drawerCard && (
        <CopyDrawer
          card={drawerCard}
          sub={subscriptionByStrategy.get(drawerCard.id) ?? null}
          address={address}
          sponsor={sponsor}
          currentVaultDusdc={currentVaultDusdc}
          walletDusdcNum={walletDusdcNum}
          budget={budget}
          setBudget={setBudget}
          busy={subscribingId === drawerCard.id}
          canceling={!!cancelingId}
          onConfirm={(b) => subscribe(drawerCard, b)}
          onPause={cancelSubscription}
          onShare={() => postToX(buildStrategyShareText(drawerCard))}
          onClose={closeDrawer}
          memoryInfo={memoryInfo}
          onBuyMemory={buyMemoryPass}
          buyingMemory={buyingMemory}
          onReadMemory={readMemoryHandler}
          readingMemory={readingMemory}
          memoryText={memoryText}
        />
      )}
    </div>
  );
}

const INPUT = 'w-full px-3 py-2 rounded bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-[12px] outline-none transition-colors';
const INPUT_NUM = INPUT + ' [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function CapStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-500 block mb-1">{label}</span>
      <span className="font-mono text-sm text-white tabular-nums">
        {value}{unit && <span className="text-gray-500 text-[11px] ml-1">{unit}</span>}
      </span>
    </div>
  );
}

// Crosshair registration ticks — four L-corners that ignite vermilion on card/panel hover.
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

// Tier as an editorial dateline word — never a colored pill. Color never encodes win/loss.
function TierWord({ tier }: { tier: Tier }) {
  if (tier.key === 'settled') return <span className="text-white"><span className="text-vermilion">⊙</span> Settled</span>;
  if (tier.key === 'active') return <span className="text-white/70"><span className="text-vermilion">●</span> Active</span>;
  return <span className="text-white/40">New</span>;
}

// One ruled cell of the card's stat table.
function LedgerStat({ label, value, divide }: { label: string; value: string; divide?: boolean }) {
  return (
    <div className={`px-3 py-3 ${divide ? 'border-l border-white/[0.06]' : ''}`}>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1">{label}</div>
      <div className="font-mono text-sm text-white tabular-nums">{value}</div>
    </div>
  );
}

// ── Copy drawer: the focused subscribe flow (review → size → worked example → confirm) ──
function CopyDrawer(props: {
  card: StrategyCard;
  sub: StrategySubscription | null;
  address: string | null;
  sponsor: SponsorStatus | null;
  currentVaultDusdc: number;
  walletDusdcNum: number;
  budget: string;
  setBudget: (s: string) => void;
  busy: boolean;
  canceling: boolean;
  onConfirm: (budget: string) => void;
  onPause: (sub: StrategySubscription) => void;
  onShare: () => void;
  onClose: () => void;
  memoryInfo: MemoryMarketInfo | null;
  onBuyMemory: () => void;
  buyingMemory: boolean;
  onReadMemory: () => void;
  readingMemory: boolean;
  memoryText: string | null;
}) {
  const { card, sub, address, sponsor, currentVaultDusdc, walletDusdcNum, budget, setBudget, busy, canceling, onConfirm, onPause, onShare, onClose, memoryInfo, onBuyMemory, buyingMemory, onReadMemory, readingMemory, memoryText } = props;
  const tier = tierOf(card);
  const maxTarget = currentVaultDusdc + Math.max(0, walletDusdcNum - card.subFee);
  const target = Number(budget.replace(',', '.'));
  const valid = Number.isFinite(target) && target > 0;
  const topUp = valid ? Math.max(0, target - currentVaultDusdc) : 0;
  const walletNeed = topUp + card.subFee;
  const cap = valid ? Math.min(target, card.maxMargin) : 0;
  const free = card.subFee === 0 && !!sponsor;
  const add = (n: number) => setBudget(String(Math.max(0, (parseFloat(budget || '0') || 0) + n)));

  const cta = topUp > 0.000001
    ? `Add ${fmtDusdc(topUp)} DUSDC & start copying`
    : `Start copying with current Copy Balance${free ? ' · gas-free' : ''}`;

  return (
    <div className="fixed inset-0 z-[9999] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative h-full w-full max-w-[440px] overflow-y-auto border-l border-white/10 bg-[#0b0b0e] p-6 shadow-2xl animate-[slideIn_.22s_ease]"
        role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-2 text-gray-600 hover:bg-white/[0.05] hover:text-white transition-colors">
          <X className="h-4 w-4" />
        </button>

        {/* identity */}
        <div className="flex items-center gap-3 mb-5 pr-8">
          <div className="w-11 h-11 shrink-0 border border-white/10 rounded-full flex items-center justify-center">
            <span className="font-jp text-xl text-vermilion">{glyphFromAddress(card.agent)}</span>
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-[800] text-lg text-white truncate">{codenameFromAddress(card.agent)}</h2>
            <a href={SUISCAN_ACC(card.agent)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-gray-500 hover:text-gray-300">{fmtAddr(card.agent)}</a>
          </div>
          <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.2em]"><TierWord tier={tier} /></span>
        </div>

        {/* the guarantee */}
        <div className="border-l-2 border-vermilion pl-4 mb-5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-vermilion mb-1.5 block">Non-custodial</span>
          <p className="text-[12.5px] text-white/70 leading-snug">
            Your balance stays in your vault. The agent can open positions for you under hard caps, but it
            <span className="text-white font-semibold"> cannot withdraw or divert it.</span>
          </p>
          <a href={SUISCAN_OBJ(card.id)} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[10px] text-white/40 hover:text-white transition-colors">verify caps on-chain ↗</a>
        </div>

        {/* caps + record */}
        <div className="grid grid-cols-3 gap-3 mb-2">
          <CapStat label="Max leverage" value={`${card.maxLeverage}×`} unit="" />
          <CapStat label="Max / trade" value={fmtDusdc(card.maxMargin)} unit="DUSDC" />
          <CapStat label="Fee" value={card.subFee === 0 ? 'Free' : fmtDusdc(card.subFee)} unit={card.subFee === 0 ? '' : 'DUSDC'} />
        </div>
        <div className="grid grid-cols-3 gap-3 pb-4 mb-4 border-b border-white/[0.06]">
          <CapStat label="Copiers" value={card.subscribers > 0 ? String(card.subscribers) : '—'} unit="" />
          <CapStat label="Copy-trades" value={String(card.copyTrades)} unit="" />
          <CapStat label="Last active" value={ago(card.lastActive) || 'never'} unit="" />
        </div>
        {(card.hasMemory || card.hasCapsule) && (
          <div className="border border-vermilion/30 px-4 py-3 mb-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-vermilion mb-1.5">◈ Agent memory</p>
            <p className="text-[12px] text-white/70 leading-snug">
              This agent keeps its own trading memory on Walrus — open, verifiable, and (with a pass) readable. It guides the agent&apos;s decisions but can never touch your funds.
            </p>
            <div className="flex flex-wrap gap-3 mt-2">
              {card.hasMemory && (
                <a href={SUISCAN_ACC(card.memoryAccount)} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-white/40 hover:text-white transition-colors">verify memory ↗</a>
              )}
              {card.hasCapsule && <span className="font-mono text-[10px] text-white/40">▤ Walrus playbook</span>}
            </div>
          </div>
        )}
        {memoryInfo && (
          <div className="border border-vermilion/25 bg-vermilion/[0.05] rounded-lg px-4 py-3 mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-vermilion">◇ Memory market</span>
              <span className="font-mono text-[10px] text-gray-500">{memoryInfo.passesSold} sold</span>
            </div>
            {memoryInfo.ownsPass ? (
              <div>
                <p className="text-[12px] text-vermilion leading-snug mb-2">● Pass held — your on-chain access right to this agent&apos;s memory.</p>
                {memoryInfo.hasCapsule && !memoryText && (
                  <button
                    onClick={onReadMemory}
                    disabled={readingMemory}
                    className="w-full py-2 text-[12px] font-semibold border border-vermilion/40 text-vermilion hover:bg-vermilion/[0.08] transition-colors disabled:opacity-60"
                  >
                    {readingMemory ? 'Decrypting…' : 'Read the playbook →'}
                  </button>
                )}
                {memoryText && (
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-gray-300 border border-white/10 rounded p-3 bg-black/30">{memoryText}</pre>
                )}
              </div>
            ) : !address ? (
              <>
                <p className="text-[12px] text-gray-300 leading-snug mb-2">Own this agent&apos;s memory as a tradable on-chain asset — {fmtDusdc(memoryInfo.price)} DUSDC.</p>
                <ConnectButton />
              </>
            ) : (
              <>
                <p className="text-[12px] text-gray-300 leading-snug mb-2.5">
                  Own this agent&apos;s memory as a tradable on-chain asset. The creator earns; the pass is yours to keep or transfer.
                </p>
                <button
                  onClick={onBuyMemory}
                  disabled={buyingMemory}
                  className="w-full rounded-full py-2.5 text-[13px] font-semibold bg-vermilion text-white hover:bg-vermilion-d transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {buyingMemory ? 'Buying…' : `Buy Memory Pass · ${fmtDusdc(memoryInfo.price)} DUSDC`}
                </button>
              </>
            )}
          </div>
        )}
        {tier.key === 'new' && (
          <p className="font-mono text-[11px] text-gray-500 mb-4">Young strategy — short track record. Size accordingly.</p>
        )}

        {sub ? (
          /* manage / exit */
          <div>
            <div className="border-l-2 border-vermilion pl-4 mb-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-vermilion mr-1.5 align-middle" />Copying</p>
              <p className="text-[12.5px] text-white/70 leading-relaxed">
                Future trades are copied at up to {fmtDusdc(sub.maxMargin)} DUSDC each, max {sub.maxLeverageBps / 10_000}×.
              </p>
            </div>
            <p className="text-[12px] text-gray-500 leading-relaxed mb-4">
              Pause stops new copies. Your open positions keep running and stay yours — the agent
              can&apos;t close or claim them out from under you.
            </p>
            <button
              onClick={() => onPause(sub)} disabled={canceling}
              className="w-full py-3 rounded-full text-sm font-semibold border border-white/12 text-gray-200 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50"
            >
              {canceling ? 'pausing…' : 'Pause copying'}
            </button>
          </div>
        ) : !address ? (
          <div className="pt-1"><ConnectButton /></div>
        ) : (
          /* size + confirm */
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Copy Balance</span>
              <span className="font-mono text-[10px] text-gray-600">in vault: {fmtDusdc(currentVaultDusdc)} DUSDC</span>
            </div>
            <p className="font-mono text-[10px] text-gray-600 leading-relaxed mb-2">
              Add funds to your shared Copy Balance. Your current balance remains at risk across copied agents until you withdraw or pause them.
            </p>
            <div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-2.5 transition-colors focus-within:border-vermilion/50">
              <div className="flex items-center justify-between">
                <input
                  autoFocus inputMode="decimal" placeholder="0.00"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="w-full bg-transparent font-display text-2xl font-bold text-white outline-none focus:outline-none focus-visible:outline-none placeholder:text-gray-600"
                />
                <span className="font-mono text-xs font-semibold text-gray-300 shrink-0">DUSDC</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-gray-500">Your limit. Edit anytime. Pause anytime.</span>
                <div className="flex gap-1.5">
                  {[1, 5, 25].map((n) => (
                    <button key={n} onClick={() => add(n)} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors">+{n}</button>
                  ))}
                  <button onClick={() => setBudget(maxTarget.toFixed(2))} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors">max</button>
                </div>
              </div>
            </div>

            {/* live worked example */}
            <p className="mt-3 text-[12px] text-gray-400 leading-relaxed">
              {valid ? (
                <>You set a <span className="text-white font-semibold">{fmtDusdc(target)} DUSDC</span> copy balance (shared across the agents you copy). This agent can deploy at most <span className="text-white font-semibold">{fmtDusdc(cap)} DUSDC</span> per copied trade, up to {card.maxLeverage}×. It can never exceed this — or withdraw your balance.</>
              ) : (
                <>Set a copy balance (shared across the agents you copy). This agent deploys at most {fmtDusdc(card.maxMargin)} DUSDC per trade, up to {card.maxLeverage}× — never more, and can never withdraw it.</>
              )}
            </p>

            {valid && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <CapStat label="Add now" value={fmtDusdc(topUp)} unit="DUSDC" />
                <CapStat label="Wallet needed" value={fmtDusdc(walletNeed)} unit="DUSDC" />
              </div>
            )}

            {/* risk line */}
            <p className="mt-4 text-[11px] text-gray-500 leading-relaxed">
              Copied trades can lose money. Only fund what you can afford to lose.
            </p>

            <button
              onClick={() => onConfirm(budget)} disabled={busy || !valid}
              className={`mt-3 w-full rounded-full py-3 font-semibold transition-all ${
                busy || !valid ? 'cursor-not-allowed bg-white/[0.07] text-gray-400' : 'bg-vermilion text-white hover:bg-vermilion-d shadow-[0_6px_28px_-8px_var(--vermilion)]'
              }`}
            >
              {busy ? 'Starting…' : !valid ? 'Enter an amount' : cta}
            </button>
          </div>
        )}

        {/* share — moved off the card face */}
        <button onClick={onShare} className="mt-5 inline-flex items-center gap-1.5 font-mono text-[11px] text-gray-600 hover:text-vermilion transition-colors">
          <Share2 className="w-3.5 h-3.5" /> Share this agent
        </button>
      </div>
    </div>
  );
}
