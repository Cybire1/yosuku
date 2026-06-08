'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import SectionHeader from '@/components/SectionHeader';
import { fetchStatus, type StatusData } from '@/lib/sui/predictApi';

export default function StatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const data = await fetchStatus();
      if (!cancelled) {
        setStatus(data);
        setLoading(false);
        setLastChecked(new Date());
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const isHealthy = status && status.max_time_lag_seconds < 120;

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      <main className="container pt-[120px] pb-12">
        <div className="breadcrumb mb-6">
          <a href="/" data-cursor="hover">Home</a>
          <span className="sep">/</span>
          <span style={{ color: 'var(--white)' }}>Status</span>
        </div>

        <SectionHeader number="01" title="System Status" jp="システム状態" />

        {loading && (
          <div className="text-center py-12">
            <RefreshCw className="w-5 h-5 text-gray-500 animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Loading status...</p>
          </div>
        )}

        {!loading && !status && (
          <div className="text-center py-12">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-gray-400">Unable to reach the predict server.</p>
          </div>
        )}

        {status && (
          <div className="space-y-6">
            {/* Overall health */}
            <div className={`flex items-center gap-4 p-5 rounded-xl border ${
              isHealthy
                ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                : 'border-amber-500/20 bg-amber-500/[0.04]'
            }`}>
              {isHealthy
                ? <CheckCircle className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                : <AlertTriangle className="w-6 h-6 text-amber-400 flex-shrink-0" />
              }
              <div>
                <div className={`text-sm font-bold ${isHealthy ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isHealthy ? 'All Systems Operational' : 'Degraded Performance'}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Max lag: {status.max_time_lag_seconds.toFixed(0)}s ({status.max_lag_pipeline})
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600">
                  Checkpoint
                </div>
                <div className="font-mono text-sm text-white">
                  {status.latest_onchain_checkpoint.toLocaleString()}
                </div>
              </div>
            </div>

            {/* Pipeline table */}
            <div className="border border-white/[0.08] rounded-xl bg-bg overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5">
                <h3 className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600">
                  Pipeline Status ({status.pipelines.length})
                </h3>
              </div>
              <div className="divide-y divide-white/5">
                {status.pipelines.map(p => {
                  const lagColor = p.time_lag_seconds < 60
                    ? 'bg-emerald-400'
                    : p.time_lag_seconds < 300
                      ? 'bg-amber-400'
                      : 'bg-rose-400';
                  return (
                    <div key={p.pipeline} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${lagColor}`} />
                      <span className="text-xs text-white flex-1 font-medium truncate">
                        {p.pipeline}
                      </span>
                      <span className="font-mono text-xs text-gray-500">
                        {p.time_lag_seconds.toFixed(0)}s
                      </span>
                      <span className="font-mono text-[10px] text-gray-600 w-28 text-right">
                        cp {p.checkpoint_hi_inclusive.toLocaleString()}
                      </span>
                      {p.is_backfill && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          backfill
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Last checked */}
            {lastChecked && (
              <p className="text-center text-xs text-gray-600 font-mono">
                Last checked: {lastChecked.toLocaleTimeString()} · Auto-refreshes every 30s
              </p>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
