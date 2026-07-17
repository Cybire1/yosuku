// Upgrade the live yolev package to ADD the `parlay` module (additive → COMPATIBLE).
// Targets the real latest package the UpgradeCap points at (v3 → v4). Dry-runs first
// (DRY=1) so any dependency-linkage mismatch is caught before gas is spent.
//
//   PKK=<suiprivkey for 0xaa50ec0f> DRY=1 node upgrade-parlay.mjs   # validate
//   PKK=<suiprivkey for 0xaa50ec0f>       node upgrade-parlay.mjs   # execute
import fs from 'fs';
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0x47d3c108b2165cb1190eefd0b67f73a386e8ca71b870f87a9afb096056795388'; // latest yolev (v3)
const CAP = '0xb9c19a789f170d96f244e1eaa461719b3f9f4dc736e028d812b2eab946f95fdf'; // UpgradeCap
const build = JSON.parse(fs.readFileSync('/tmp/yolev-upgrade.json', 'utf8'));
const DRY = process.env.DRY === '1';

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKK).secretKey);
const sender = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());

console.log('signer', sender.slice(0, 12), '· modules', build.modules.length, '· deps', build.dependencies.length, '· DRY', DRY);

const tx = new Transaction();
tx.setSender(sender);
const cap = tx.object(CAP);
const ticket = tx.moveCall({
  target: '0x2::package::authorize_upgrade',
  arguments: [cap, tx.pure.u8(0 /* COMPATIBLE */), tx.pure.vector('u8', build.digest)],
});
const receipt = tx.upgrade({ modules: build.modules, dependencies: build.dependencies, package: PKG, ticket });
tx.moveCall({ target: '0x2::package::commit_upgrade', arguments: [cap, receipt] });
tx.setGasBudget(900_000_000);

if (DRY) {
  const bytes = await tx.build({ client });
  const b64 = Buffer.from(bytes).toString('base64');
  const r = await rpc('sui_dryRunTransactionBlock', [b64]);
  if (r.error) { console.log('DRY RPC error:', JSON.stringify(r.error)); process.exit(1); }
  console.log('DRY status:', JSON.stringify(r.result?.effects?.status));
  for (const c of r.result?.objectChanges || []) {
    if (c.type === 'published') console.log('WOULD-PUBLISH new package:', c.packageId);
  }
} else {
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
  const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction?.digest;
  console.log('digest', digest);
  await new Promise((r) => setTimeout(r, 5000));
  const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true }]);
  console.log('status', JSON.stringify(tb.result?.effects?.status));
  for (const c of tb.result?.objectChanges || []) {
    if (c.type === 'published') console.log('NEW_PACKAGE_ID', c.packageId);
  }
}
