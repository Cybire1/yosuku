// End-to-end testnet proof for the sponsored creator-recovery protocol.
// Uses disposable keys and a high BuilderCode index; no production wallet or creator is touched.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';

const ONARA = 'https://yosuku-gas.yosuku.workers.dev';
const RPC = 'https://fullnode.testnet.sui.io:443';
const JSON_RPC = 'https://sui-testnet-rpc.publicnode.com';
const RECOVERY = '0xbda838f23b7035f7372c5a6984f26dadef10c1c70a7c64701e71554abc3e2d32';
const PREDICT = '0xfe742239a3b033f7d52ed5275f238c17d27498ca0ee5ea5672ea732eb3f4dbbb';
const REGISTRY = '0x35970bfd0ff3703cb38b3fff3a3fbb0bc0e5638e7c747af3a8e42e2c95d353f0';
const CONFIG = '0x43703ceee4d5f5a9e8cbf728071c34dc65961dd6e878fafd9ac36d86a9a4ce5b';
const TYPE = `${RECOVERY}::creator_recovery::CreatorRecovery`;
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });

async function sponsor() {
  const status = await fetch(`${ONARA}/status`).then((r) => r.json());
  if (!status.address) throw new Error('sponsor unavailable');
  return status.address;
}

async function payment(owner) {
  const body = await fetch(JSON_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_getCoins', params: [owner, '0x2::sui::SUI', null, 50] }),
  }).then((r) => r.json());
  const coins = (body.result?.data || []).filter((coin) => BigInt(coin.balance) >= 150_000_000n);
  if (!coins.length) throw new Error('sponsor has no usable gas coin');
  const coin = coins[Math.floor(Math.random() * coins.length)];
  return [{ objectId: coin.coinObjectId, version: String(coin.version), digest: coin.digest }];
}

async function execute(tx, signer, combine = null) {
  const gasOwner = await sponsor();
  tx.setGasOwner(gasOwner);
  tx.setGasPayment(await payment(gasOwner));
  const bytes = await tx.build({ client });
  const partial = await signer.signTransaction(bytes);
  const signature = combine ? combine(partial.signature) : partial.signature;
  const response = await fetch(`${ONARA}/sponsor?waitForExecution=false`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender: tx.getData().sender, txBytes: partial.bytes, txSignature: signature }),
  });
  const json = await response.json();
  if (!response.ok || json.FailedTransaction) throw new Error(JSON.stringify(json));
  const digest = json.Transaction?.digest || json.digest;
  if (!digest) throw new Error(`no digest: ${JSON.stringify(json)}`);
  await client.waitForTransaction({ digest });
  return digest;
}

async function profileFor(login) {
  const query = `{ objects(filter: {type: "${TYPE}"}, first: 50) { nodes { address asMoveObject { contents { json } } } } }`;
  for (let i = 0; i < 30; i++) {
    const body = await fetch('https://graphql.testnet.sui.io/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }),
    }).then((r) => r.json());
    const found = body.data?.objects?.nodes?.find((node) =>
      String(node.asMoveObject?.contents?.json?.login || '').toLowerCase() === login.toLowerCase());
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('recovery profile did not index');
}

const login = new Ed25519Keypair();
const recoverySigner = new Ed25519Keypair();
const alternate = new Ed25519Keypair();
const controller = MultiSigPublicKey.fromPublicKeys({
  threshold: 1,
  publicKeys: [
    { publicKey: recoverySigner.getPublicKey(), weight: 1 },
    { publicKey: alternate.getPublicKey(), weight: 1 },
  ],
});

const register = new Transaction();
register.moveCall({
  target: `${RECOVERY}::creator_recovery::register`,
  arguments: [
    register.pure.address(controller.toSuiAddress()),
    register.pure.vector('u8', [...recoverySigner.getPublicKey().toRawBytes()]),
    register.pure.vector('u8', [2, ...new Array(32).fill(1)]),
  ],
});
register.setSender(login.toSuiAddress());
const registerDigest = await execute(register, login);
const profile = await profileFor(login.toSuiAddress());

const finalize = new Transaction();
const code = finalize.moveCall({
  target: `${PREDICT}::registry::create_and_share_builder_code`,
  arguments: [finalize.object(REGISTRY), finalize.object(CONFIG), finalize.pure.u64(BigInt(Date.now()))],
});
finalize.moveCall({
  target: `${RECOVERY}::creator_recovery::finalize`,
  arguments: [finalize.object(profile.address), code],
});
finalize.setSender(controller.toSuiAddress());
const finalizeDigest = await execute(
  finalize,
  recoverySigner,
  (partial) => controller.combinePartialSignatures([partial]),
);

console.log(JSON.stringify({
  ok: true,
  login: login.toSuiAddress(),
  controller: controller.toSuiAddress(),
  recovery: profile.address,
  registerDigest,
  finalizeDigest,
}, null, 2));
