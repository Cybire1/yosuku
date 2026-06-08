import type { ManagerPositionSummary } from '@/lib/sui/predictApi';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';

export function positionsToCSV(positions: ManagerPositionSummary[]): string {
  const headers = [
    'Oracle ID',
    'Asset',
    'Direction',
    'Strike',
    'Expiry',
    'Minted Qty',
    'Open Qty',
    'Total Cost (DUSDC)',
    'Total Payout (DUSDC)',
    'Realized P&L (DUSDC)',
    'Unrealized P&L (DUSDC)',
    'Status',
  ];

  const rows = positions.map(p => [
    p.oracle_id,
    p.underlying_asset,
    p.is_up ? 'UP' : 'DOWN',
    (p.strike / FLOAT_SCALING).toFixed(2),
    new Date(p.expiry).toISOString(),
    (p.minted_quantity / DUSDC_MULTIPLIER).toFixed(2),
    (p.open_quantity / DUSDC_MULTIPLIER).toFixed(2),
    (p.total_cost / DUSDC_MULTIPLIER).toFixed(4),
    (p.total_payout / DUSDC_MULTIPLIER).toFixed(4),
    (p.realized_pnl / DUSDC_MULTIPLIER).toFixed(4),
    (p.unrealized_pnl / DUSDC_MULTIPLIER).toFixed(4),
    p.status,
  ]);

  const escape = (v: string) => v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
  return [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}

export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
