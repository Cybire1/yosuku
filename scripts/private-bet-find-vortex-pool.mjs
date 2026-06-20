const DUSDC_TYPE =
  process.env.DUSDC_TYPE ?? '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const API_URL = (process.env.VORTEX_API_URL ?? 'https://api.vortexfi.xyz').replace(/\/$/, '');
const API_KEY = process.env.VORTEX_API_KEY ?? undefined;

const url = new URL('/api/v1/pools', API_URL);
url.searchParams.set('coin_type', DUSDC_TYPE);
url.searchParams.set('limit', '20');

let res;
try {
  res = await fetch(url, {
    headers: {
      'content-type': 'application/json',
      ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
    },
  });
} catch (error) {
  console.error(`Could not reach Vortex API at ${API_URL}.`);
  console.error(error instanceof Error ? error.message : String(error));
  console.error('Set VORTEX_API_URL to the current Interest/Vortex API endpoint, or ask them for the dUSDC pool object directly.');
  process.exit(1);
}
const json = await res.json().catch(() => ({}));
if (!res.ok || json.success === false) {
  console.error(json.error ?? `Vortex API failed: ${res.status}`);
  process.exit(1);
}

const pools = json?.data?.items ?? [];

if (!pools.length) {
  console.log('No Vortex pool found for:');
  console.log(DUSDC_TYPE);
  process.exit(1);
}

for (const pool of pools) {
  console.log(`PRIVATE_BET_DUSDC_POOL=${pool.objectId}`);
  console.log(`coinType=${pool.coinType}`);
  console.log(`checkpoint=${pool.checkpoint}`);
  console.log('');
}
