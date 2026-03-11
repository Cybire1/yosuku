import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { startPriceFeed, getBtcPrice } from './price.js';
import { getBlockHeight } from './aleo.js';
import { startRoundManager, getCurrentRoundId, getRoundStatus } from './round-manager.js';
import { betTrackerRouter } from './bet-tracker.js';

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
      currentRoundId: getCurrentRoundId(),
      roundStatus: getRoundStatus(),
      btcPrice: getBtcPrice(),
      blockHeight,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  } catch (err: any) {
    res.status(500).json({
      status: 'degraded',
      error: err.message,
      currentRoundId: getCurrentRoundId(),
      roundStatus: getRoundStatus(),
      btcPrice: getBtcPrice(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  }
});

app.get('/', (_req, res) => {
  res.json({ service: 'dart-resolver', version: '8.0.0' });
});

// ── Bet Tracker (dark pool accumulator) ─────────────────
app.use(betTrackerRouter);

// ── Start ───────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════╗
║       DART Auto-Resolver v8.0         ║
║   BTC Prediction Market on Aleo       ║
║   btc_pred_v8 (commitment + dark pool)║
╠═══════════════════════════════════════╣
║  Duration:  ${config.roundIntervalSecs}s (${config.roundIntervalSecs / 60} min)              ║
║  Blocks:    ${config.blocksPerRound} per round               ║
║  Poll:      ${config.pollIntervalMs / 1000}s interval               ║
║  Seed:      ${config.seedAmount} micro-USDCx      ║
║  Price:     Pyth oracle               ║
╚═══════════════════════════════════════╝
`);

  // 1. Start price feed (Binance WS)
  startPriceFeed();

  // 2. Wait a moment for first price to come in
  console.log('[Main] Waiting 3s for initial price feed...');
  await new Promise((r) => setTimeout(r, 3000));

  // 3. Start Express server
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`[Main] Health endpoint: http://0.0.0.0:${config.port}/health`);
  });

  // 4. Start round manager (main tick loop)
  await startRoundManager();
}

main().catch((err) => {
  console.error('[Main] Fatal error:', err);
  process.exit(1);
});
