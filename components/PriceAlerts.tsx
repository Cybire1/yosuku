'use client';

import { useState, useEffect } from 'react';
import { Bell, X, Plus } from 'lucide-react';
import { loadAlerts, addAlert, removeAlert, requestNotificationPermission, type PriceAlert } from '@/lib/priceAlerts';

interface PriceAlertsProps {
  asset: string;
  currentPrice: number | null;
}

export default function PriceAlertsButton({ asset, currentPrice }: PriceAlertsProps) {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [targetPrice, setTargetPrice] = useState('');
  const [direction, setDirection] = useState<'above' | 'below'>('above');

  useEffect(() => {
    setAlerts(loadAlerts().filter(a => !a.triggered));
  }, []);

  useEffect(() => {
    if (currentPrice && !targetPrice) {
      setTargetPrice(Math.round(currentPrice).toString());
    }
  }, [currentPrice, targetPrice]);

  const handleAdd = async () => {
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) return;
    await requestNotificationPermission();
    const updated = addAlert(asset, price, direction);
    setAlerts(updated.filter(a => !a.triggered));
    setTargetPrice('');
  };

  const handleRemove = (id: string) => {
    const updated = removeAlert(id);
    setAlerts(updated.filter(a => !a.triggered));
  };

  const assetAlerts = alerts.filter(a => a.asset === asset);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-xs font-medium ${
          assetAlerts.length > 0
            ? 'border-vermilion/30 bg-vermilion/[0.06] text-vermilion'
            : 'border-white/10 bg-white/[0.03] text-gray-400 hover:text-white hover:border-white/20'
        }`}
      >
        <Bell style={{ width: 12, height: 12 }} />
        {assetAlerts.length > 0 ? assetAlerts.length : 'Alert'}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: '280px', zIndex: 900,
          }}
          className="bg-neutral-900/96 border border-white/10 rounded-xl backdrop-blur-xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Price Alerts</h4>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>

          {/* Add alert */}
          <div className="space-y-2">
            <div className="flex gap-1">
              <button
                onClick={() => setDirection('above')}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all ${
                  direction === 'above'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-transparent text-gray-500 border-white/10'
                }`}
              >
                Above
              </button>
              <button
                onClick={() => setDirection('below')}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all ${
                  direction === 'below'
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                    : 'bg-transparent text-gray-500 border-white/10'
                }`}
              >
                Below
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                placeholder="Target price"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white outline-none focus:border-white/30"
              />
              <button
                onClick={handleAdd}
                className="px-3 py-2 bg-vermilion/20 text-vermilion rounded-lg hover:bg-vermilion/30 transition-colors"
              >
                <Plus style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>

          {/* Active alerts */}
          {assetAlerts.length > 0 && (
            <div className="space-y-1 border-t border-white/5 pt-3">
              {assetAlerts.map(a => (
                <div key={a.id} className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-gray-400">
                    <span className={a.direction === 'above' ? 'text-emerald-400' : 'text-rose-400'}>
                      {a.direction === 'above' ? '↑' : '↓'}
                    </span>{' '}
                    ${a.targetPrice.toLocaleString()}
                  </span>
                  <button onClick={() => handleRemove(a.id)} className="text-gray-600 hover:text-rose-400">
                    <X style={{ width: 10, height: 10 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
