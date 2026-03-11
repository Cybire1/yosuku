import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

// Avg block time on Aleo testnet (~3.5s)
export const SECS_PER_BLOCK = 3.5;

/** Convert seconds to blocks (rounded up) */
export function secsToBlocks(secs: number): number {
  return Math.ceil(secs / SECS_PER_BLOCK);
}

export const config = {
  adminPrivateKey: required('ADMIN_PRIVATE_KEY'),
  roundIntervalSecs: parseInt(optional('ROUND_INTERVAL_SECS', '88380'), 10), // 1 day 33 min
  blocksPerRound: parseInt(optional('BLOCKS_PER_ROUND', '0'), 10) || secsToBlocks(parseInt(optional('ROUND_INTERVAL_SECS', '88380'), 10)),
  seedAmount: parseInt(optional('SEED_AMOUNT', '1000000'), 10), // 1 USDCx per side (2 total per round)
  pollIntervalMs: parseInt(optional('POLL_INTERVAL_MS', '15000'), 10),
  port: parseInt(optional('PORT', '3001'), 10),
  aleoEndpoint: optional('ALEO_ENDPOINT', 'https://api.explorer.provable.com/v1'),
  aleoNetwork: optional('ALEO_NETWORK', 'testnet'),
  leoProjectDir: optional('LEO_PROJECT_DIR', '/app/btc_pred_v8'),
  program: 'btc_pred_v8.aleo',
  programAddress: optional('PROGRAM_ADDRESS', 'aleo1v5wrxmqe2urj30wqxyhnfymghw03kcdgu2pdcv7hhlw3z2vcs5rqwl2f7e'),
  tokenProgram: 'test_usdcx_stablecoin.aleo',
} as const;
