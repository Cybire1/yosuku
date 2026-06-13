// Fresh-publish the yolev package (now incl. underwrite) via the SDK, bypassing
// the CLI's protocol-version panic. Signs with the publisher key (PK env, bech32).
import fs from 'fs';
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const build = JSON.parse(fs.readFileSync('/tmp/yolev-fresh.json', 'utf8'));
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const addr = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;

console.log('publisher', addr, '· modules', build.modules.length, '· deps', build.dependencies.length);

const tx = new Transaction();
const [cap] = tx.publish({ modules: build.modules, dependencies: build.dependencies });
tx.transferObjects([cap], addr);
tx.setGasBudget(600_000_000);

const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
console.log('digest', digest);
await new Promise((r) => setTimeout(r, 4000));
const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
console.log('status', JSON.stringify(tb?.effects?.status));
for (const c of tb?.objectChanges || []) {
  if (c.type === 'published') console.log('PACKAGE_ID', c.packageId);
  if (c.type === 'created') console.log('CREATED', c.objectType, c.objectId);
}
