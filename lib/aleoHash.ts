/**
 * Compute BHP256::hash_to_field(address) using @provablehq/wasm.
 * Lazily loads WASM on first call, caches results in localStorage.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hasherInstance: any = null;

const CACHE_KEY = 'aleo_bhp256_cache';

function loadCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, string>) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

async function getHasher() {
  if (hasherInstance) return { wasm: wasmModule, hasher: hasherInstance };

  wasmModule = await import('@provablehq/wasm');

  // SnarkVM's default BHP256 uses "aleo" as domain separator for hash_to_field
  // Try standard domain separators — the WASM will throw if invalid
  const domains = ['aleo', 'AleoHashBHP256', ''];
  for (const domain of domains) {
    try {
      hasherInstance = wasmModule.BHP256.setup(domain);
      // Quick test to make sure it works
      const testPlaintext = wasmModule.Plaintext.fromString(
        'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
      );
      hasherInstance.hash([testPlaintext]);
      return { wasm: wasmModule, hasher: hasherInstance };
    } catch {
      hasherInstance = null;
      continue;
    }
  }

  throw new Error('Failed to initialize BHP256 hasher with any domain separator');
}

/**
 * Computes BHP256::hash_to_field(address) — the same operation the Leo
 * contract uses for mapping keys like user_bets, user_wins, user_streak.
 *
 * Results are cached in localStorage so WASM only runs once per address.
 */
export async function bhp256HashToField(address: string): Promise<string> {
  // Check localStorage cache first
  const cache = loadCache();
  if (cache[address]) return cache[address];

  const { wasm, hasher } = await getHasher();

  // The hash input is an array of Plaintext values.
  // An Aleo address literal is parsed via Plaintext.fromString.
  const plaintext = wasm.Plaintext.fromString(address);
  const fieldResult = hasher.hash([plaintext]);
  const fieldStr: string = fieldResult.toString();

  // Cache the result
  cache[address] = fieldStr;
  saveCache(cache);

  return fieldStr;
}
