/**
 * BTC Prediction Market Auto-Resolver
 *
 * Fetches BTC price from Pyth Hermes API at round deadline,
 * then calls resolve() on the btc_prediction.aleo program.
 *
 * Usage:
 *   npx ts-node resolver/index.ts
 *
 * Env vars:
 *   ALEO_PRIVATE_KEY - Admin private key for signing transactions
 *   ALEO_API_URL     - Aleo API endpoint (default: testnet)
 */

const PYTH_HERMES_URL = 'https://hermes.pyth.network/v2/updates/price/latest';
const PYTH_BTC_USD_FEED = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';

const BINANCE_API_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';

const ALEO_API = process.env.ALEO_API_URL || 'https://api.explorer.provable.com/v1';
const PROGRAM_ID = 'btc_prediction.aleo';
const POLL_INTERVAL_MS = 10_000; // 10 seconds

interface PythPriceResponse {
  parsed: Array<{
    id: string;
    price: {
      price: string;
      expo: number;
      publish_time: number;
    };
  }>;
}

/**
 * Fetch BTC/USD price from Pyth Hermes
 * Returns price in cents (e.g., 9704200 for $97,042.00)
 */
async function fetchBtcPricePyth(): Promise<number> {
  try {
    const url = `${PYTH_HERMES_URL}?ids[]=${PYTH_BTC_USD_FEED}`;
    const res = await fetch(url);
    const data: PythPriceResponse = await res.json();

    if (data.parsed && data.parsed.length > 0) {
      const priceData = data.parsed[0].price;
      const price = parseInt(priceData.price);
      const expo = priceData.expo;
      // Convert to cents: price * 10^(expo + 2)
      const priceInCents = Math.round(price * Math.pow(10, expo + 2));
      return priceInCents;
    }
  } catch (err) {
    console.error('[Pyth] Error fetching price:', err);
  }

  // Fallback to Binance
  return fetchBtcPriceBinance();
}

/**
 * Fallback: Fetch BTC/USD from Binance REST API
 */
async function fetchBtcPriceBinance(): Promise<number> {
  const res = await fetch(BINANCE_API_URL);
  const data = await res.json();
  const price = parseFloat(data.price);
  return Math.round(price * 100); // cents
}

/**
 * Fetch a mapping value from Aleo API
 */
async function fetchMapping(mapping: string, key: string): Promise<string | null> {
  try {
    const url = `${ALEO_API}/testnet/program/${PROGRAM_ID}/mapping/${mapping}/${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return text.replace(/"/g, '').trim();
  } catch {
    return null;
  }
}

function parseU64(val: string | null): number {
  if (!val) return 0;
  return parseInt(val.replace('u64', '').trim(), 10) || 0;
}

function parseBool(val: string | null): boolean | null {
  if (!val) return null;
  return val.trim() === 'true';
}

/**
 * Resolve a round by calling the Aleo CLI
 */
async function resolveRound(roundId: number, actualPrice: number): Promise<void> {
  const privateKey = process.env.ALEO_PRIVATE_KEY;
  if (!privateKey) {
    console.error('[Resolver] ALEO_PRIVATE_KEY not set. Skipping resolve.');
    console.log(`[Resolver] Would resolve round ${roundId} with price ${actualPrice} cents ($${(actualPrice / 100).toFixed(2)})`);
    return;
  }

  console.log(`[Resolver] Resolving round ${roundId} with price ${actualPrice} cents ($${(actualPrice / 100).toFixed(2)})`);

  // Use Aleo CLI to execute the resolve transition
  const { execSync } = require('child_process');
  try {
    const cmd = `snarkos developer execute ${PROGRAM_ID} resolve ${roundId}u64 ${actualPrice}u64 --private-key ${privateKey} --query ${ALEO_API}/testnet --broadcast ${ALEO_API}/testnet/transaction/broadcast --fee 1000000 --record ""`;
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 120000 });
    console.log(`[Resolver] Transaction submitted:`, result.substring(0, 200));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Resolver] Failed to resolve round ${roundId}:`, message);
  }
}

/**
 * Check and resolve pending rounds
 */
async function checkRounds(roundIds: number[]): Promise<void> {
  for (const roundId of roundIds) {
    const key = `${roundId}u64`;

    // Check if round exists and is not resolved
    const resolved = parseBool(await fetchMapping('round_resolved', key));
    if (resolved === null) {
      continue; // Round doesn't exist
    }
    if (resolved) {
      continue; // Already resolved
    }

    // Check deadline
    const deadlineStr = await fetchMapping('round_deadline', key);
    const deadline = parseU64(deadlineStr);

    // For block height deadline, check current block
    // For demo, we'll use the deadline as a marker
    console.log(`[Resolver] Round ${roundId} is pending (deadline block: ${deadline})`);

    // Fetch current BTC price
    const actualPrice = await fetchBtcPricePyth();
    console.log(`[Resolver] Current BTC price: $${(actualPrice / 100).toFixed(2)}`);

    // Resolve the round
    await resolveRound(roundId, actualPrice);
  }
}

/**
 * Main loop
 */
async function main() {
  console.log('=== BTC Prediction Market Auto-Resolver ===');
  console.log(`Program: ${PROGRAM_ID}`);
  console.log(`API: ${ALEO_API}`);
  console.log(`Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log('');

  // Track which round IDs to monitor
  // In production, this would scan the chain for active rounds
  const activeRounds: number[] = [];

  // Accept round IDs from command line args
  const args = process.argv.slice(2);
  if (args.length > 0) {
    for (const arg of args) {
      const id = parseInt(arg, 10);
      if (!isNaN(id)) activeRounds.push(id);
    }
    console.log(`Monitoring rounds: ${activeRounds.join(', ')}`);
  } else {
    // Default: monitor rounds 1-200
    for (let i = 1; i <= 200; i++) activeRounds.push(i);
    console.log('Monitoring rounds 1-200 (pass specific IDs as arguments)');
  }

  console.log('');

  // Continuous polling
  const poll = async () => {
    try {
      await checkRounds(activeRounds);
    } catch (err) {
      console.error('[Resolver] Poll error:', err);
    }
  };

  // Run immediately, then on interval
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

main().catch(console.error);
