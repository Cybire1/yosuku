// One-shot: supply DUSDC into the web margin lending pool so it can front leverage.
// Run: PK=<deployer key> AMOUNT=100 node scripts/fund-pool.mjs
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const MPKG = '0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e';
const POOL = '0x506023587cc1c08dc25882f9bc78e59fdc68c8cb6b58b04dee8d234a437cf12e';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const AMOUNT = Math.floor(parseFloat(process.env.AMOUNT || '100') * 1e6);

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const me = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;

const coins = (await rpc('suix_getCoins', [me, DUSDC]))?.data || [];
const total = coins.reduce((a, c) => a + Number(c.balance), 0);
console.log(`supplier ${me} · DUSDC coins ${coins.length} · total ${(total/1e6).toFixed(2)} · supplying ${(AMOUNT/1e6).toFixed(2)}`);
if (total < AMOUNT) { console.log('insufficient DUSDC'); process.exit(1); }

const tx = new Transaction();
const primary = tx.object(coins[0].coinObjectId);
if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1, 30).map((c) => tx.object(c.coinObjectId)));
const [supplyCoin] = tx.splitCoins(primary, [AMOUNT]);
const pos = tx.moveCall({ target: `${MPKG}::lending_pool::supply`, typeArguments: [DUSDC], arguments: [tx.object(POOL), supplyCoin, tx.object(CLOCK)] });
tx.transferObjects([pos], me);
tx.setGasBudget(60_000_000);
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
console.log('supply tx:', res.$kind === 'Transaction' ? res.Transaction.digest : JSON.stringify(res).slice(0, 200));
