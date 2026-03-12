import { getBlockHeight, getProgramMappingValue, parseU32, parseU8 } from './aleo.js';
import { config, SECS_PER_BLOCK } from './config.js';
import { leoExecuteInProject } from './executor.js';
import { fetchMirrorCandidates, type MirrorCandidate } from './polymarket.js';

type SyncReason = 'startup' | 'scheduled' | 'manual';

interface MirrorSyncSummary {
  reason: SyncReason;
  catalogCount: number;
  createdOnChain: number;
  resolvedOnChain: number;
  syncedAt: string;
}

interface MirrorStatus {
  enabled: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  catalogCount: number;
  createOnChain: boolean;
  resolveOnChain: boolean;
  totalCreatedOnChain: number;
  totalResolvedOnChain: number;
}

let catalog: MirrorCandidate[] = [];
let syncing = false;
let lastSyncAt: string | null = null;
let lastError: string | null = null;
let totalCreatedOnChain = 0;
let totalResolvedOnChain = 0;
let tickHandle: NodeJS.Timeout | null = null;

const locallyCreated = new Set<string>();
const locallyResolved = new Set<string>();

function estimateCloseBlock(endDate: string, currentHeight: number): number {
  const msUntilClose = Date.parse(endDate) - Date.now();
  const secsUntilClose = Math.max(0, Math.ceil(msUntilClose / 1000));
  return currentHeight + Math.ceil(secsUntilClose / SECS_PER_BLOCK);
}

async function isMirroredOnChain(sourceHashField: string): Promise<boolean> {
  const raw = await getProgramMappingValue(config.mirrorProgram, 'sm', sourceHashField);
  return raw !== null;
}

async function isResolvedOnChain(marketId: string): Promise<boolean> {
  const raw = await getProgramMappingValue(config.mirrorProgram, 'mo', `${marketId}u64`);
  return parseU8(raw) > 0;
}

async function getMirrorVaultAddress(): Promise<string | null> {
  if (config.mirrorVaultAddress) return config.mirrorVaultAddress;
  const raw = await getProgramMappingValue(config.mirrorProgram, 'aa', '1u8');
  if (!raw) return null;
  return raw.replace(/"/g, '').trim();
}

async function annotateOnChainState(markets: MirrorCandidate[]): Promise<MirrorCandidate[]> {
  const vaultAddress = await getMirrorVaultAddress();

  return Promise.all(
    markets.map(async (market) => {
      const [sourceMapping, outcomeRaw, closeRaw] = await Promise.all([
        getProgramMappingValue(config.mirrorProgram, 'sm', market.sourceHashField),
        getProgramMappingValue(config.mirrorProgram, 'mo', `${market.marketId}u64`),
        getProgramMappingValue(config.mirrorProgram, 'mc', `${market.marketId}u64`),
      ]);

      const onChainCreated = sourceMapping !== null;
      const onChainResolved = parseU8(outcomeRaw) > 0;
      const onChainCloseBlock = closeRaw ? parseU32(closeRaw) : null;

      return {
        ...market,
        onChainCreated,
        onChainResolved,
        onChainCloseBlock,
        vaultAddress,
      };
    })
  );
}

async function mirrorActiveMarkets(markets: MirrorCandidate[]): Promise<number> {
  if (!config.mirrorCreateOnChain) return 0;

  let created = 0;
  const currentHeight = await getBlockHeight();
  const vaultAddress = await getMirrorVaultAddress();

  for (const market of markets) {
    if (!market.endDate) continue;
    if (locallyCreated.has(market.sourceHashField)) continue;

    const closeBlock = estimateCloseBlock(market.endDate, currentHeight);
    if (closeBlock <= currentHeight + config.mirrorCloseBufferBlocks) continue;

    const existing = await isMirroredOnChain(market.sourceHashField);
    if (existing) {
      locallyCreated.add(market.sourceHashField);
      continue;
    }

    const ok = leoExecuteInProject(config.mirrorProjectDir, 'create_market', [
      `${market.marketId}u64`,
      `${closeBlock}u32`,
      `${market.yesMultiplierBps}u64`,
      `${market.noMultiplierBps}u64`,
      market.sourceHashField,
      market.conditionHashField,
    ]);

    if (ok) {
      // Fund the market with bankroll so bets pass the solvency check
      if (vaultAddress && config.mirrorSeedAmount > 0) {
        const funded = leoExecuteInProject(config.mirrorProjectDir, 'fund_market', [
          vaultAddress,
          `${market.marketId}u64`,
          `${config.mirrorSeedAmount}u128`,
        ]);
        if (funded) {
          console.log(`  [Mirror] Funded market ${market.marketId} with ${config.mirrorSeedAmount} micro-USDCx`);
        } else {
          console.warn(`  [Mirror] Failed to fund market ${market.marketId} — bets may fail solvency check`);
        }
      }

      locallyCreated.add(market.sourceHashField);
      created += 1;
    }
  }

  return created;
}

async function resolveClosedMarkets(markets: MirrorCandidate[]): Promise<number> {
  if (!config.mirrorResolveOnChain) return 0;

  let resolved = 0;

  for (const market of markets) {
    if (market.resolvedOutcome === null) continue;
    if (!market.resolutionHashField) continue;
    if (locallyResolved.has(market.sourceHashField)) continue;

    const mirrored = await isMirroredOnChain(market.sourceHashField);
    if (!mirrored) continue;

    const alreadyResolved = await isResolvedOnChain(market.marketId);
    if (alreadyResolved) {
      locallyResolved.add(market.sourceHashField);
      continue;
    }

    const ok = leoExecuteInProject(config.mirrorProjectDir, 'resolve', [
      `${market.marketId}u64`,
      market.resolvedOutcome ? 'true' : 'false',
      market.resolutionHashField,
    ]);

    if (ok) {
      locallyResolved.add(market.sourceHashField);
      resolved += 1;
    }
  }

  return resolved;
}

export async function syncMirrorCatalog(reason: SyncReason = 'manual'): Promise<MirrorSyncSummary> {
  if (!config.mirrorEnabled) {
    return {
      reason,
      catalogCount: 0,
      createdOnChain: 0,
      resolvedOnChain: 0,
      syncedAt: new Date().toISOString(),
    };
  }

  if (syncing) {
    return {
      reason,
      catalogCount: catalog.length,
      createdOnChain: 0,
      resolvedOnChain: 0,
      syncedAt: lastSyncAt || new Date().toISOString(),
    };
  }

  syncing = true;

  try {
    const activeMarkets = await fetchMirrorCandidates({
      limit: config.mirrorLimit,
      query: config.mirrorQuery,
      active: true,
      closed: false,
      minVolume: config.mirrorMinVolume,
      maxDurationSecs: config.mirrorMaxDurationSecs,
    });

    catalog = await annotateOnChainState(activeMarkets);

    const createdOnChain = await mirrorActiveMarkets(catalog);
    totalCreatedOnChain += createdOnChain;

    let resolvedOnChain = 0;
    if (config.mirrorResolveOnChain) {
      const closedMarkets = await annotateOnChainState(
        await fetchMirrorCandidates({
        limit: Math.max(config.mirrorLimit * 4, 40),
        query: config.mirrorQuery,
        active: false,
        closed: true,
        minVolume: 0,
        maxDurationSecs: config.mirrorMaxDurationSecs,
      })
      );
      resolvedOnChain = await resolveClosedMarkets(closedMarkets);
      totalResolvedOnChain += resolvedOnChain;
    }

    if (createdOnChain > 0 || resolvedOnChain > 0) {
      catalog = await annotateOnChainState(catalog);
    }

    lastSyncAt = new Date().toISOString();
    lastError = null;

    return {
      reason,
      catalogCount: catalog.length,
      createdOnChain,
      resolvedOnChain,
      syncedAt: lastSyncAt,
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    syncing = false;
  }
}

export async function startMirrorManager(): Promise<void> {
  if (!config.mirrorEnabled) {
    console.log('[MirrorManager] Disabled');
    return;
  }

  console.log(`\n[MirrorManager] Starting Polymarket mirror engine...`);
  console.log(`  Query: ${config.mirrorQuery || '(all tracked markets)'}`);
  console.log(`  Limit: ${config.mirrorLimit} | Sync: ${config.mirrorSyncMs}ms`);
  console.log(`  Create on-chain: ${config.mirrorCreateOnChain ? 'yes' : 'no'} | Resolve on-chain: ${config.mirrorResolveOnChain ? 'yes' : 'no'}`);

  try {
    const initial = await syncMirrorCatalog('startup');
    console.log(`[MirrorManager] Initial sync complete: ${initial.catalogCount} markets`);
  } catch (error) {
    console.error('[MirrorManager] Initial sync failed:', error instanceof Error ? error.message : error);
  }

  tickHandle = setInterval(() => {
    void syncMirrorCatalog('scheduled').catch((error) => {
      console.error('[MirrorManager] Scheduled sync failed:', error instanceof Error ? error.message : error);
    });
  }, config.mirrorSyncMs);
}

export function stopMirrorManager(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

export function getMirrorCatalog(): MirrorCandidate[] {
  return [...catalog];
}

export function getMirrorStatus(): MirrorStatus {
  return {
    enabled: config.mirrorEnabled,
    syncing,
    lastSyncAt,
    lastError,
    catalogCount: catalog.length,
    createOnChain: config.mirrorCreateOnChain,
    resolveOnChain: config.mirrorResolveOnChain,
    totalCreatedOnChain,
    totalResolvedOnChain,
  };
}
