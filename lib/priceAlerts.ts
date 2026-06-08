const STORAGE_KEY = 'yosuku_price_alerts';

export interface PriceAlert {
  id: string;
  asset: string;
  targetPrice: number;
  direction: 'above' | 'below';
  createdAt: number;
  triggered: boolean;
}

export function loadAlerts(): PriceAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveAlerts(alerts: PriceAlert[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch { /* ignore */ }
}

export function addAlert(asset: string, targetPrice: number, direction: 'above' | 'below'): PriceAlert[] {
  const alerts = loadAlerts();
  alerts.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    asset,
    targetPrice,
    direction,
    createdAt: Date.now(),
    triggered: false,
  });
  saveAlerts(alerts);
  return alerts;
}

export function removeAlert(id: string): PriceAlert[] {
  const alerts = loadAlerts().filter(a => a.id !== id);
  saveAlerts(alerts);
  return alerts;
}

export function checkAlerts(currentPrices: Record<string, number>): PriceAlert[] {
  const alerts = loadAlerts();
  const triggered: PriceAlert[] = [];

  const updated = alerts.map(a => {
    if (a.triggered) return a;
    const price = currentPrices[a.asset];
    if (!price) return a;
    const isTriggered = a.direction === 'above' ? price >= a.targetPrice : price <= a.targetPrice;
    if (isTriggered) {
      triggered.push(a);
      return { ...a, triggered: true };
    }
    return a;
  });

  if (triggered.length > 0) saveAlerts(updated);
  return triggered;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function sendNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/icon.svg' });
  }
}
