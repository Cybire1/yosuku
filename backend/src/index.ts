import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { getBlockHeight } from './aleo.js';
import { betTrackerRouter } from './bet-tracker.js';
import { getMirrorCatalog, getMirrorStatus, startMirrorManager, syncMirrorCatalog } from './mirror-manager.js';

const app = express();
app.use(cors());
app.use(express.json());
const startTime = Date.now();

// ── Health Endpoint ─────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const blockHeight = await getBlockHeight();
    res.json({
      status: 'healthy',
      mirror: getMirrorStatus(),
      blockHeight,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      status: 'degraded',
      error: message,
      mirror: getMirrorStatus(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  }
});

app.get('/', (_req, res) => {
  res.json({ service: 'dart-resolver', version: '13.0.0', mirror: getMirrorStatus() });
});

// ── Bet Tracker (dark pool accumulator) ─────────────────
app.use(betTrackerRouter);

// ── Polymarket mirror engine ────────────────────────────
app.get('/api/mirrors', (_req, res) => {
  res.json({
    success: true,
    status: getMirrorStatus(),
    markets: getMirrorCatalog(),
    count: getMirrorCatalog().length,
  });
});

app.post('/api/mirrors/sync', async (_req, res) => {
  try {
    const summary = await syncMirrorCatalog('manual');
    res.json({ success: true, summary, status: getMirrorStatus(), markets: getMirrorCatalog() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Mirror sync failed';
    res.status(500).json({
      success: false,
      error: message,
      status: getMirrorStatus(),
    });
  }
});

// ── Start ───────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════╗
║        DART Mirror Engine v13         ║
║  Hidden-Side Mirror Markets on Aleo   ║
║  dart_mirror_v13.aleo                 ║
╠═══════════════════════════════════════╣
║  Mirror limit: ${String(config.mirrorLimit).padEnd(4)} markets           ║
║  Sync:   every ${config.mirrorSyncMs / 1000}s                ║
║  Create: ${config.mirrorCreateOnChain ? 'on-chain' : 'catalog '}                    ║
║  Resolve: ${config.mirrorResolveOnChain ? 'on-chain' : 'catalog '}                   ║
╚═══════════════════════════════════════╝
`);

  // 1. Start Express server
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[Main] Health endpoint: http://0.0.0.0:${config.port}/health`);
  });

  // 2. Start mirror manager (Polymarket → Aleo)
  await startMirrorManager();
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  process.exit(1);
});
