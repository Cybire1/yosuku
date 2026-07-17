// Upgrade the latest yolev package to add trading_vault.
//
// Build first:
//   sui move build --dump-bytecode-as-base64 > /tmp/yolev-upgrade.json
//
// Dry-run:
//   DRY=1 node upgrade-trading-vault.mjs
//
// Execute:
//   node upgrade-trading-vault.mjs
//
// The script reads the current package id from the UpgradeCap, so it does not go stale
// when yolev has already been upgraded. It signs with PKK if provided, otherwise it
// exports the active keeper key from the local Sui keystore without printing it.
import fs from 'fs';
import { execFileSync } from 'child_process';
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const CAP = '0xb9c19a789f170d96f244e1eaa461719b3f9f4dc736e028d812b2eab946f95fdf';
const KEEPER = '0xaa50ec0fe985825bd45fcc65d301da096a487349d6993fe8f9305890284a7244';
const build = JSON.parse(fs.readFileSync('/tmp/yolev-upgrade.json', 'utf8'));
const DRY = process.env.DRY === '1';

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

const capObject = await rpc('sui_getObject', [CAP, { showContent: true, showOwner: true }]);
const cap = capObject?.data?.content?.fields;
const pkg = cap?.package;
if (!pkg) throw new Error(`Could not read package from UpgradeCap ${CAP}`);

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(localKeeperPrivateKey()).secretKey);
const sender = kp.toSuiAddress();
if (sender.toLowerCase() !== KEEPER.toLowerCase()) {
  throw new Error(`Wrong signer ${sender}; expected keeper/admin ${KEEPER}`);
}

const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });

console.log('signer', sender.slice(0, 12), '· current package', pkg.slice(0, 12), '· modules', build.modules.length, '· DRY', DRY);

const tx = new Transaction();
tx.setSender(sender);
const capArg = tx.object(CAP);
const ticket = tx.moveCall({
  target: '0x2::package::authorize_upgrade',
  arguments: [capArg, tx.pure.u8(0), tx.pure.vector('u8', build.digest)],
});
const receipt = tx.upgrade({
  modules: build.modules,
  dependencies: build.dependencies,
  package: pkg,
  ticket,
});
tx.moveCall({ target: '0x2::package::commit_upgrade', arguments: [capArg, receipt] });
tx.setGasBudget(900_000_000);

if (DRY) {
  const bytes = await tx.build({ client });
  const b64 = Buffer.from(bytes).toString('base64');
  const r = await rpc('sui_dryRunTransactionBlock', [b64]);
  console.log('DRY status:', JSON.stringify(r.effects?.status));
  for (const c of r.objectChanges || []) {
    if (c.type === 'published') console.log('WOULD_NEW_PACKAGE_ID', c.packageId);
  }
} else {
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
  const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction?.digest;
  console.log('digest', digest);
  await new Promise((r) => setTimeout(r, 5000));
  const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
  console.log('status', JSON.stringify(tb.effects?.status));
  for (const c of tb.objectChanges || []) {
    if (c.type === 'published') console.log('NEW_PACKAGE_ID', c.packageId);
  }
}
