const PYTH_BTC_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';

let cachedPrice = 0;

export function getBtcPrice(): number {
  return cachedPrice;
}

/** Price in cents (integer) for on-chain use */
export function getBtcPriceCents(): number {
  return Math.round(cachedPrice * 100);
}

/** No-op — kept for compatibility, Pyth is fetched on demand */
export function startPriceFeed(): void {
  // Refresh cached price every 10s for display purposes
  const poll = async () => {
    try {
      const { priceUsd } = await fetchPythPrice();
      cachedPrice = priceUsd;
    } catch { /* ignore */ }
  };
  poll();
  setInterval(poll, 10_000);
}

/** Fetch from Pyth Hermes REST API */
export async function fetchPythPrice(): Promise<{ priceUsd: number; cents: number }> {
  const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_BTC_FEED}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pyth fetch failed: ${res.status}`);
  const data: any = await res.json();
  const p = data.parsed[0].price;
  const priceUsd = Number(p.price) * Math.pow(10, p.expo);
  const cents = Math.round(priceUsd * 100);
  return { priceUsd, cents };
}

/** Get price in cents from Pyth */
export async function getReliablePriceCents(): Promise<number> {
  const { cents, priceUsd } = await fetchPythPrice();
  cachedPrice = priceUsd;
  console.log(`[Price] Pyth: $${priceUsd.toFixed(2)}`);
  return cents;
}
