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

function optionalBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
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
  leoProjectDir: optional('LEO_PROJECT_DIR', '/app/btc_pred_v10'),
  program: 'btc_pred_v10.aleo',
  programAddress: optional('PROGRAM_ADDRESS', 'aleo1v5wrxmqe2urj30wqxyhnfymghw03kcdgu2pdcv7hhlw3z2vcs5rqwl2f7e'),
  tokenProgram: 'test_usdcx_stablecoin.aleo',
  mirrorEnabled: optionalBool('MIRROR_ENABLED', true),
  mirrorSyncMs: parseInt(optional('MIRROR_SYNC_MS', '300000'), 10),
  mirrorLimit: parseInt(optional('MIRROR_LIMIT', '50'), 10),
  mirrorMinVolume: parseInt(optional('MIRROR_MIN_VOLUME', '50'), 10),
  mirrorMaxDurationSecs: parseInt(optional('MIRROR_MAX_DURATION_SECS', '5184000'), 10), // 60 days
  mirrorQuery: optional('MIRROR_QUERY', ''),
  mirrorCreateOnChain: optionalBool('MIRROR_CREATE_ON_CHAIN', true),
  mirrorResolveOnChain: optionalBool('MIRROR_RESOLVE_ON_CHAIN', true),
  mirrorCloseBufferBlocks: parseInt(optional('MIRROR_CLOSE_BUFFER_BLOCKS', '5'), 10),
  mirrorProjectDir: optional('MIRROR_PROJECT_DIR', '/app/dart_mirror_v13'),
  mirrorProgram: optional('MIRROR_PROGRAM', 'dart_mirror_v13.aleo'),
  mirrorProgramAddress: optional('MIRROR_PROGRAM_ADDRESS', ''),
  mirrorVaultAddress: optional('MIRROR_VAULT_ADDRESS', ''),
  mirrorSeedAmount: parseInt(optional('MIRROR_SEED_AMOUNT', '10000000'), 10), // 10 USDCx per market
} as const;
