export interface LocalLeverageOrder {
  id: string;
  txDigest: string;
  trader: string;
  margin: number;
  leverage: number;
  oracleId: string;
  expiry: number;
  isRange: boolean;
  isUp: boolean;
  lowerStrike: number;
  higherStrike: number;
  createdAt: number;
}

const LOCAL_LEVERAGE_ORDERS_KEY = 'yosuku_leverage_orders';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safeParse(raw: string | null): LocalLeverageOrder[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalLeverageOrder[];
    return Array.isArray(parsed) ? parsed.filter((order) => order?.txDigest && order?.trader) : [];
  } catch {
    return [];
  }
}

export function loadLocalLeverageOrders(owner?: string | null): LocalLeverageOrder[] {
  if (typeof window === 'undefined') return [];
  const cutoff = Date.now() - MAX_AGE_MS;
  const orders = safeParse(window.localStorage.getItem(LOCAL_LEVERAGE_ORDERS_KEY))
    .filter((order) => order.createdAt >= cutoff);
  if (orders.length) window.localStorage.setItem(LOCAL_LEVERAGE_ORDERS_KEY, JSON.stringify(orders.slice(0, 40)));
  return owner ? orders.filter((order) => order.trader.toLowerCase() === owner.toLowerCase()) : orders;
}

export function recordLocalLeverageOrder(order: Omit<LocalLeverageOrder, 'id'>) {
  if (typeof window === 'undefined') return;
  const next: LocalLeverageOrder = { ...order, id: `local:${order.txDigest}` };
  const orders = loadLocalLeverageOrders();
  const deduped = [next, ...orders.filter((existing) => existing.txDigest !== order.txDigest)];
  window.localStorage.setItem(LOCAL_LEVERAGE_ORDERS_KEY, JSON.stringify(deduped.slice(0, 40)));
}
