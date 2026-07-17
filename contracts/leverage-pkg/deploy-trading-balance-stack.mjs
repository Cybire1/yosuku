// Deploy the live Trading Balance stack for the freshly published yolev package:
//   1. lending_pool::create<DUSDC>
//   2. optional lending_pool::supply<DUSDC> seed
//   3. DeepBook Predict manager owned by the keeper/admin
//   4. margin::create_desk<DUSDC>
//   5. trading_vault::create<DUSDC>
//
// Usage:
//   PKG=0x... node deploy-trading-balance-stack.mjs
//
// It signs with PKK if set; otherwise it exports the local Sui keystore key for
// KEEPER without printing it.
import { execFileSync } from 'child_process';
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = process.env.PKG;
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const KEEPER = '0xaa50ec0fe985825bd45fcc65d301da096a487349d6993fe8f9305890284a7244';
const SEED = BigInt(process.env.SEED || '1000000'); // 1 DUSDC default seed

if (!PKG) throw new Error('Set PKG=0x... to the freshly published yolev package id');

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

function localKeeperPrivateKey() {
  if (process.env.PKK) return process.env.PKK;
  const out = execFileSync('sui', ['keytool', 'export', '--key-identity', KEEPER, '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out);
  const key = parsed.exportedPrivateKey || parsed.privateKey || parsed.key;
  if (!key) throw new Error('Could not read keeper private key from sui keytool export');
  return key;
}

const signer = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(localKeeperPrivateKey()).secretKey);
const addr = signer.toSuiAddress();
if (addr.toLowerCase() !== KEEPER.toLowerCase()) {
  throw new Error(`Wrong signer ${addr}; expected keeper/admin ${KEEPER}`);
}

const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });

async function run(label, tx, budget = 200_000_000) {
  tx.setSender(addr);
  tx.setGasBudget(budget);
  const res = await client.signAndExecuteTransaction({ signer, transaction: tx });
  const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction?.digest;
  await new Promise((r) => setTimeout(r, 4500));
  const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
  const status = tb.effects?.status;
  console.log(label, JSON.stringify(status), digest);
  if (status?.status !== 'success') throw new Error(`${label} failed: ${JSON.stringify(status)}`);
  return { digest, tb };
}

function created(tb, needle) {
  return (tb?.objectChanges || []).find((c) => c.type === 'created' && String(c.objectType).includes(needle))?.objectId;
}

console.log('admin/keeper', addr);
console.log('package', PKG);

const txPool = new Transaction();
txPool.moveCall({
  target: `${PKG}::lending_pool::create`,
  typeArguments: [DUSDC],
  arguments: [txPool.pure.u64(0), txPool.pure.u64(0), txPool.object(CLOCK)],
});
const poolResult = await run('create pool', txPool);
const POOL = created(poolResult.tb, 'lending_pool::LendingPool');
if (!POOL) throw new Error('Could not find created LendingPool');

let SEEDED = false;
const coins = await rpc('suix_getCoins', [addr, DUSDC, null, 50]);
const coinData = coins?.data || [];
const total = coinData.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
if (SEED > 0n && total >= SEED && coinData.length > 0) {
  const txSeed = new Transaction();
  const primary = txSeed.object(coinData[0].coinObjectId);
  if (coinData.length > 1) {
    txSeed.mergeCoins(primary, coinData.slice(1).map((coin) => txSeed.object(coin.coinObjectId)));
  }
  const [seedCoin] = txSeed.splitCoins(primary, [SEED]);
  const supplyPosition = txSeed.moveCall({
    target: `${PKG}::lending_pool::supply`,
    typeArguments: [DUSDC],
    arguments: [txSeed.object(POOL), seedCoin, txSeed.object(CLOCK)],
  });
  txSeed.transferObjects([supplyPosition], txSeed.pure.address(addr));
  await run(`seed pool ${Number(SEED) / 1e6} DUSDC`, txSeed);
  SEEDED = true;
} else {
  console.log('seed pool skipped', JSON.stringify({ requested: Number(SEED) / 1e6, available: Number(total) / 1e6 }));
}

const txManager = new Transaction();
txManager.moveCall({ target: `${PREDICT}::predict::create_manager`, arguments: [] });
const managerResult = await run('create custody manager', txManager);
const MGR = created(managerResult.tb, 'predict_manager::PredictManager');
if (!MGR) throw new Error('Could not find created PredictManager');

const txDesk = new Transaction();
txDesk.moveCall({
  target: `${PKG}::margin::create_desk`,
  typeArguments: [DUSDC],
  arguments: [
    txDesk.object(POOL),
    txDesk.pure.id(MGR),
    txDesk.pure.address(addr),
    txDesk.pure.u64(30_000),
    txDesk.pure.u64(12_000),
    txDesk.pure.u64(500),
  ],
});
const deskResult = await run('create margin desk', txDesk);
const DESK = created(deskResult.tb, 'margin::MarginDesk');
if (!DESK) throw new Error('Could not find created MarginDesk');

const txVault = new Transaction();
txVault.moveCall({
  target: `${PKG}::trading_vault::create`,
  typeArguments: [DUSDC],
  arguments: [],
});
const vaultResult = await run('create trading vault', txVault);
const VAULT = created(vaultResult.tb, 'trading_vault::TradingVault');
if (!VAULT) throw new Error('Could not find created TradingVault');

console.log('\n=== EXPORTS ===');
console.log(`NEXT_PUBLIC_TRADING_VAULT_PACKAGE=${PKG}`);
console.log(`NEXT_PUBLIC_TRADING_VAULT_ID=${VAULT}`);
console.log(`NEXT_PUBLIC_MARGIN_DESK_ID=${DESK}`);
console.log(`TRADING_BALANCE_LENDING_POOL_ID=${POOL}`);
console.log(`TRADING_BALANCE_CUSTODY_MANAGER_ID=${MGR}`);
console.log(`TRADING_BALANCE_POOL_SEEDED=${SEEDED ? '1' : '0'}`);
