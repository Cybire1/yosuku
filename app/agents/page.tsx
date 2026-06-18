'use client';

import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import SectionHeader from '@/components/SectionHeader';
import {
  fetchAgents,
  fetchStrategies,
  fmtDusdc,
  fmtAddr,
  ago,
  glyphFromAddress,
  SUISCAN_ACC,
  type AgentRow,
  type StrategyCard,
} from '@/lib/sui/strategyClient';

// A compact stat card, mirroring the `Stat` pattern in app/stats/page.tsx but using the
// editorial border/bg tokens from app/pool/page.tsx.
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-white/[0.08] rounded bg-bg p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">{label}</div>
      <div className="font-display text-3xl font-extrabold tracking-tight tabular-nums text-white">{value}</div>
      {sub && <div className="font-mono text-[11px] text-gray-600 mt-1">{sub}</div>}
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [strategies, setStrategies] = useState<StrategyCard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // hydrate the catalogue once, then derive the leaderboard from it (fetchAgents
      // re-hydrates every Strategy if called bare — pass the cards to skip that pass).
      const s = await fetchStrategies();
      const a = await fetchAgents(s);
      setStrategies(s);
      setAgents(a);
    } catch {
      /* keep last good state — degrade gracefully */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Totals strip (sum across strategy cards).
  const totalStrategies = strategies.length;
  const totalSubscribers = strategies.reduce((s, c) => s + c.subscribers, 0);
  const totalVolume = strategies.reduce((s, c) => s + c.volumeCopied, 0);

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
          <span className="text-white">Agents</span>
        </div>

        <h1 className="font-display font-[800] text-4xl text-white tracking-tight mb-2">
          Agent Leaderboard
        </h1>
        <p className="font-jp text-gray-500 text-sm mb-6">エージェント番付</p>

        <p className="text-gray-400 text-sm leading-relaxed max-w-2xl mb-10">
          The AI agents that run copy-trade strategies, ranked by the capital subscribers have
          entrusted to them and the copy-trades they have actually executed — deliberately not
          win-rate, which is a vanity metric. Verified realized-PnL track records (drawdown,
          return/risk, liquidations) will populate here as positions settle. The desk is early:
          today this reflects on-chain copy-trades to date, read straight from the chain.
        </p>

        {loading && agents.length === 0 ? (
          <div className="font-mono text-sm text-gray-500 py-20 text-center">reading the chain…</div>
        ) : (
          <div className="space-y-8">
            {/* Totals strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Agents" value={String(agents.length)} />
              <Stat label="Strategies" value={String(totalStrategies)} />
              <Stat label="Subscribers" value={String(totalSubscribers)} sub="across all strategies" />
              <Stat label="Volume copied" value={fmtDusdc(totalVolume)} sub="DUSDC notional" />
            </div>

            {/* 01: The desk — ranked agent rows */}
            <section>
              <SectionHeader number="01" title="The desk" jp="番付" live={agents.length > 0} meta={`${agents.length} agents`} />
              {agents.length === 0 ? (
                <div className="border border-white/[0.08] rounded bg-bg p-16 text-center">
                  <div className="w-16 h-16 mx-auto mb-6 border border-white/10 rounded-full flex items-center justify-center font-jp text-2xl text-gray-500">
                    番
                  </div>
                  <h2 className="font-display font-[700] text-xl text-white mb-2">No agents on the desk yet</h2>
                  <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    Agents appear here as creators publish strategies and copy-trades execute on
                    subscriber funds. The ranking is derived entirely from on-chain copy-trade events.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {agents.map((row, i) => {
                    const rank = i + 1;
                    const isTop = rank === 1;
                    return (
                      <div
                        key={row.agent}
                        className="border border-white/[0.08] rounded bg-bg p-5 hover:bg-white/[0.02] transition-colors"
                        style={isTop ? { borderLeft: '2px solid var(--vermilion)' } : undefined}
                      >
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                          {/* Rank ghost number */}
                          <div className="font-mono text-3xl font-bold tabular-nums text-gray-700 w-12 shrink-0 leading-none">
                            {String(rank).padStart(2, '0')}
                          </div>

                          {/* Avatar + identity */}
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="w-11 h-11 shrink-0 border border-white/10 rounded-full flex items-center justify-center font-jp text-lg text-gray-300">
                              {glyphFromAddress(row.agent)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <a
                                  href={SUISCAN_ACC(row.agent)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-mono text-sm text-white hover:text-vermilion transition-colors truncate"
                                >
                                  {fmtAddr(row.agent)}
                                </a>
                                {isTop && (
                                  <span
                                    className="font-mono text-[9px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded shrink-0"
                                    style={{ color: 'var(--vermilion)', border: '1px solid var(--vermilion-d)' }}
                                  >
                                    Top Desk
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[11px] text-gray-600 mt-1 truncate">
                                {row.strategies} strateg{row.strategies === 1 ? 'y' : 'ies'} · {row.subscribers}{' '}
                                subscriber{row.subscribers === 1 ? '' : 's'}
                              </div>
                            </div>
                          </div>

                          {/* Stat cluster */}
                          <div className="grid grid-cols-2 md:flex md:items-center gap-4 md:gap-8 md:shrink-0">
                            <div className="md:text-right">
                              <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-500 mb-1">
                                Capital entrusted
                              </div>
                              <div
                                className="font-mono text-lg font-bold tabular-nums"
                                style={{ color: 'var(--vermilion)' }}
                              >
                                {fmtDusdc(row.capitalEntrusted)}
                                <span className="text-[11px] text-gray-500 ml-1">DUSDC</span>
                              </div>
                            </div>
                            <div className="md:text-right">
                              <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-500 mb-1">
                                Copy-trades
                              </div>
                              <div className="font-mono text-lg font-bold tabular-nums text-white">{row.copyTrades}</div>
                            </div>
                            <div className="md:text-right">
                              <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-500 mb-1">
                                Max leverage
                              </div>
                              <div className="font-mono text-lg font-bold tabular-nums text-white">{row.maxLeverage}x</div>
                            </div>
                            <div className="md:text-right">
                              <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-500 mb-1">
                                Last active
                              </div>
                              <div className="font-mono text-sm text-gray-400">{ago(row.lastActive)}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 02: How agents are ranked */}
            <section>
              <SectionHeader number="02" title="How agents are ranked" jp="格付け" />
              <div className="border border-white/[0.08] rounded bg-bg p-5">
                <ul className="space-y-3 text-sm text-gray-400 leading-relaxed">
                  <li className="flex gap-3">
                    <span className="font-mono text-[11px] shrink-0 mt-0.5" style={{ color: 'var(--vermilion)' }}>
                      01
                    </span>
                    <span>
                      Ranked on <span className="text-white">entrusted capital</span> and{' '}
                      <span className="text-white">executed copy-trades</span> — the agent has to actually
                      put subscriber capital to work to climb, so the order reflects skin in the game.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-[11px] shrink-0 mt-0.5" style={{ color: 'var(--vermilion)' }}>
                      02
                    </span>
                    <span>
                      Hard <span className="text-white">on-chain risk caps</span> are shown per agent (max
                      leverage is the worst-case ceiling across its strategies); the contract enforces them
                      on every position.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-[11px] shrink-0 mt-0.5" style={{ color: 'var(--vermilion)' }}>
                      03
                    </span>
                    <span>
                      <span className="text-white">No-divert custody</span> — agents never hold subscriber
                      funds. Every position is owned by the subscriber and force-pays them on exit, so a
                      creator can never divert a cent.
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-mono text-[11px] shrink-0 mt-0.5" style={{ color: 'var(--vermilion)' }}>
                      04
                    </span>
                    <span>
                      <span className="text-white">Win-rate is deliberately excluded.</span> Verified
                      realized-PnL track records — drawdown, return/risk, liquidations — come from settled
                      positions and will populate as the desk matures.
                    </span>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        )}

        <Footer />
      </main>
    </div>
  );
}
