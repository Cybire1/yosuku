// Test: open a 2x UP leveraged position via the REAL frontend path (trading_vault::open_leverage).
// Run: PK=<trader key> node scripts/test-open-leverage.mjs
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const MPKG = '0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e';
const VAULT = '0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6';
const DESK = '0x5aa4be2fb3084660e584d29a7323ea73ab96a07728496c5a3832b3b9cc0f4e40';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';

const ORACLE = '0x66d413bb18628c7dc5e8701e1ce450e179a6e4cd2098b81edc14e30e8d3d03f0';
const EXPIRY = 1782161100000;
const MARGIN = 2_000_000;       // 2 DUSDC
const LEV_BPS = 20_000;         // 2x
const STRIKE = 64_000_000_000_000; // $64,000 (spot ~$64,306 -> UP is ITM)
const IS_UP = true;

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const me = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;

const coins = (await rpc('suix_getCoins', [me, DUSDC]))?.data || [];
console.log(`trader ${me} · DUSDC coins ${coins.length}`);
const tx = new Transaction();
const primary = tx.object(coins[0].coinObjectId);
if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1, 20).map((c) => tx.object(c.coinObjectId)));
const [funds] = tx.splitCoins(primary, [MARGIN]);
tx.moveCall({ target: `${MPKG}::trading_vault::deposit`, typeArguments: [DUSDC], arguments: [tx.object(VAULT), funds] });
tx.moveCall({
  target: `${MPKG}::trading_vault::open_leverage`, typeArguments: [DUSDC],
  arguments: [tx.object(VAULT), tx.object(DESK), tx.pure.id(ORACLE), tx.pure.u64(MARGIN), tx.pure.u64(LEV_BPS), tx.pure.u64(EXPIRY), tx.pure.bool(false), tx.pure.u64(STRIKE), tx.pure.u64(0), tx.pure.bool(IS_UP), tx.object(CLOCK)],
});
tx.setGasBudget(80_000_000);
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
const digest = res.$kind === 'Transaction' ? res.Transaction.digest : ('FAILED ' + JSON.stringify(res).slice(0, 300));
console.log('open_leverage tx:', digest);
