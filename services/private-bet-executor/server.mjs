import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { issueTicket, decodeTicket, verifyTicketSignature } from './enclaveTicket.mjs';
import { verifyOpenAuthorization } from './openAuth.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// predict-testnet-7-29. The desk used to be written against 4-16, whose whole custody model
// (PredictManager, market_key, predict::mint) was replaced. Those five modules do not exist on
// this package at all, so every private bet the UI offered would have aborted on chain no
// matter how the box was configured. Addresses mirror lib/sui/predict624Client.ts, which is the
// proven path; a branch is REDEPLOYED IN PLACE, so re-read the manifest rather than trusting an
// older copy of these.
const TESTNET = {
  // fullnode.testnet.sui.io no longer serves JSON-RPC.
  rpcUrl: 'https://sui-testnet-rpc.publicnode.com',
  predictPackage: '0xfe742239a3b033f7d52ed5275f238c17d27498ca0ee5ea5672ea732eb3f4dbbb',
  accountPackage: '0xbdbb60b00f2d4f30daeff62f2c642b18433a8fcdfbebccc808df578df2a0c203',
  protocolConfig: '0x43703ceee4d5f5a9e8cbf728071c34dc65961dd6e878fafd9ac36d86a9a4ce5b',
  accountRegistry: '0x21a7ed28397363b5550853c1f08795731257de81028cd1bf87f20c0752c8ca2f',
  oracleRegistry: '0xc1dffc5f7a5404cb002ba3bd7c50d6a2dbe8bb6afd40080cd663965deff9d577',
  pythFeed: '0xccafaa6c5a41f0493585cf268f2b4dc14c91ed798362444144cac2c745db8dde',
  // THREE feeds, not four: 7-29 collapsed spot and forward into one BlockScholesValueStore.
  bsValuesFeed: '0x6d9de17954f4c1a2f01fdd97c0bb8a2e682c1fea0f8f048dcd127d543a6ac051',
  bsSviFeed: '0x83c2d6307fd3591228052fc0d24c4f00a698b0eb4fef5e6083a213ca0d54bd35',
  accumulatorRoot: '0x0000000000000000000000000000000000000000000000000000000000000acc',
  dusdcType: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  clock: '0x6',
};

// Ticks, not dollars. 7-29 prices a band between two ticks at 100 per dollar, and an
// UP/DOWN bet is that band with one side open.
const TICKS_PER_USD = 100n;
const NEG_INF_TICK = 0n;
const POS_INF_TICK = (1n << 30n) - 1n;
const ONE_X_1E9 = 1_000_000_000n;
const usdToTick = (usd) => BigInt(Math.round(Number(usd))) * TICKS_PER_USD;
/** UP wins above the strike, DOWN wins below it. */
function bandTicks(strike, isUp) {
  const t = usdToTick(strike);
  return isUp ? [t, POS_INF_TICK] : [NEG_INF_TICK, t];
}

const cfg = {
  host: process.env.PRIVATE_BET_EXECUTOR_HOST ?? '127.0.0.1',
  port: Number(process.env.PRIVATE_BET_EXECUTOR_PORT ?? process.env.PORT ?? 8787),
  rpcUrl: process.env.SUI_RPC_URL ?? TESTNET.rpcUrl,
  network: process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
  packageId: process.env.PREDICT_PACKAGE_ID ?? TESTNET.predictPackage,
  accountPackage: process.env.PREDICT_ACCOUNT_PACKAGE ?? TESTNET.accountPackage,
  protocolConfig: process.env.PREDICT_PROTOCOL_CONFIG ?? TESTNET.protocolConfig,
  accountRegistry: process.env.PREDICT_ACCOUNT_REGISTRY ?? TESTNET.accountRegistry,
  dusdcType: process.env.DUSDC_TYPE ?? TESTNET.dusdcType,
  // Trading Balance vault — private-bet winnings settle straight here (no separate "Private Balance").
  tradingVaultPkg: process.env.TRADING_VAULT_PACKAGE ?? '0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e',
  tradingVault: process.env.TRADING_VAULT_ID ?? '0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6',
  vortexPool: process.env.PRIVATE_BET_DUSDC_POOL || '0x0',
  sharedSecret: process.env.PRIVATE_BET_SHARED_SECRET ?? '',
  // The attested enclave that issues ticket signatures, and the public key we check them
  // against. The key is pinned here AND on chain (ticket_seal::PrivateDesk.binder) so a user can
  // verify a ticket without asking this box to be honest about which key it used.
  enclaveCmd: process.env.PRIVATE_BET_ENCLAVE_CMD ?? '',
  enclavePubkey: (process.env.PRIVATE_BET_ENCLAVE_PUBKEY ?? '').replace(/^0x/, ''),
  // The on-chain desk holding that same key. Published in /health because the guarantee only
  // means something if a user can call ticket_seal::verify_ticket themselves — otherwise a
  // ticket is just this box's word for it. Empty until a desk exists.
  ticketSealPkg: process.env.PRIVATE_BET_TICKET_SEAL_PKG ?? '',
  privateDeskId: process.env.PRIVATE_BET_DESK_ID ?? '',
  onaraUrl: (process.env.PRIVATE_BET_ONARA_URL ?? process.env.NEXT_PUBLIC_ONARA_URL ?? '').replace(/\/$/, ''),
  useOnara: process.env.PRIVATE_BET_USE_ONARA !== '0',
  privateKey: process.env.EXECUTOR_PRIVATE_KEY ?? process.env.PRIVATE_BET_EXECUTOR_PRIVATE_KEY ?? '',
  maxStakeMicro: BigInt(process.env.PRIVATE_BET_MAX_STAKE_MICRO ?? '2000000'),
  sponsoredBeta: process.env.PRIVATE_BET_SPONSORED_BETA === '1',
  allowlist: (process.env.PRIVATE_BET_OWNER_ALLOWLIST ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
  ticketStore: process.env.PRIVATE_BET_TICKET_STORE
    ? resolve(process.env.PRIVATE_BET_TICKET_STORE)
    : resolve(__dirname, '.private-bet-tickets.json'),
};

const client = new SuiJsonRpcClient({ url: cfg.rpcUrl, network: cfg.network });
const signer = cfg.privateKey ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(cfg.privateKey).secretKey) : null;
const sessionAddress = signer?.toSuiAddress() ?? '';
let sponsorStatusPromise = null;

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requireAuth(req) {
  if (!cfg.sharedSecret) return;
  const expected = `Bearer ${cfg.sharedSecret}`;
  if (req.headers.authorization !== expected) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
}

function assertAddress(value, field) {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{1,64}$/.test(value)) {
    throw new Error(`${field} must be a Sui address`);
  }
  return value;
}

function assertObjectId(value, field) {
  return assertAddress(value, field);
}

function assertU64String(value, field) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${field} must be an integer string`);
  }
  return BigInt(value);
}

function assertReadyForOpen(owner, stakeMicro) {
  if (!signer) throw new Error('EXECUTOR_PRIVATE_KEY is not configured');
  if (!cfg.sponsoredBeta) {
    throw new Error(
      'User-funded private deposits are not enabled yet. Set PRIVATE_BET_SPONSORED_BETA=1 for a testnet sponsored beta.',
    );
  }
  if (stakeMicro <= 0n) throw new Error('stakeMicro must be positive');
  if (stakeMicro > cfg.maxStakeMicro) {
    throw new Error(`stakeMicro exceeds executor cap of ${cfg.maxStakeMicro.toString()}`);
  }
  if (cfg.allowlist.length && !cfg.allowlist.includes(owner.toLowerCase())) {
    throw new Error('owner is not allowlisted for the private beta');
  }
}

/** 7-29 prices every mint through a Pricer built in the same PTB. Seven objects, not eight. */
function loadLivePricer(tx, marketId) {
  return tx.moveCall({
    target: `${cfg.packageId}::expiry_market::load_live_pricer`,
    arguments: [
      tx.object(marketId),
      tx.object(cfg.protocolConfig),
      tx.object(TESTNET.oracleRegistry),
      tx.object(TESTNET.pythFeed),
      tx.object(TESTNET.bsValuesFeed),
      tx.object(TESTNET.bsSviFeed),
      tx.object(TESTNET.clock),
    ],
  });
}

async function signAndExecute(tx, gasBudget = 120_000_000) {
  // Say so plainly. Without this the first use of `signer` throws
  // "Cannot read properties of null (reading 'toSuiAddress')", which sends whoever is on call
  // hunting through the SDK instead of setting one env var.
  if (!signer) throw new Error('EXECUTOR_PRIVATE_KEY is not configured');
  if (cfg.useOnara && cfg.onaraUrl) {
    // Sponsored-only. Do NOT fall back to a self-paid retry of the SAME tx: it still carries
    // gas owner = sponsor, so re-submitting it with a single signature throws the misleading
    // "Expect 2 signer signatures but got 1". Let the real sponsor / simulation error surface.
    return await signAndExecuteSponsored(tx, gasBudget);
  }
  tx.setGasBudget(gasBudget);
  const res = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  });
  await client.waitForTransaction({ digest: res.digest });
  if (res.effects?.status?.status !== 'success') {
    throw new Error(res.effects?.status?.error ?? `transaction failed: ${res.digest}`);
  }
  return res;
}

async function sponsorStatus() {
  if (!sponsorStatusPromise) {
    sponsorStatusPromise = fetch(`${cfg.onaraUrl}/status`, { signal: AbortSignal.timeout(5_000) })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.address) throw new Error(`Onara status failed: ${res.status}`);
        return json;
      });
  }
  return sponsorStatusPromise;
}

async function signAndExecuteSponsored(tx, gasBudget) {
  if (!signer) throw new Error('EXECUTOR_PRIVATE_KEY is not configured');
  const sponsor = await sponsorStatus();
  tx.setSender(sessionAddress);
  tx.setGasOwner(sponsor.address);
  tx.setGasBudget(gasBudget);
  const bytes = await tx.build({ client });
  const signed = await signer.signTransaction(bytes);
  const res = await fetch(`${cfg.onaraUrl}/sponsor?waitForExecution=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender: sessionAddress, txBytes: signed.bytes, txSignature: signed.signature }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ? `Sponsor declined: ${json.error}` : `Sponsor declined: ${res.status}`);
  }
  if (json.FailedTransaction) {
    const err = json.FailedTransaction.effects?.status?.error;
    throw new Error(typeof err === 'string' ? err : `Sponsored transaction failed: ${JSON.stringify(json.FailedTransaction).slice(0, 300)}`);
  }
  const digest = json.Transaction?.digest ?? json.digest;
  if (!digest) throw new Error(`Sponsor response had no digest: ${JSON.stringify(json).slice(0, 300)}`);
  await client.waitForTransaction({ digest });
  return client.getTransactionBlock({
    digest,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  });
}

/**
 * The u256 order id 7-29 assigns to a minted position.
 *
 * 4-16 let a redeem rebuild its own market_key from strike and side, so nothing had to be
 * remembered between opening and cashing out. 7-29 addresses a position by this id instead, so
 * if it is not captured here the position is only reachable by scanning the account, and the
 * ticket becomes un-redeemable through this desk. It is not identifying, so it is safe to keep
 * in the on-disk record alongside the rest.
 */
function orderIdFromMint(res) {
  for (const ev of res?.events ?? []) {
    if (!String(ev.type ?? '').includes('OrderMinted')) continue;
    const j = ev.parsedJson ?? {};
    const id = j.order_id ?? j.orderId ?? j.id ?? j.position_id;
    if (id != null) return String(id);
  }
  return null;
}

/**
 * A fresh account per bet. This is the whole unlinkability primitive: the position lives in an
 * account that has never held anything of the user's, so nothing on chain joins it to their
 * wallet. 4-16 spelled this `predict::create_manager`; 7-29 replaced the manager with an
 * AccountWrapper from the account registry, created here and shared so it survives the tx.
 *
 * The account is owned by this desk's session address, exactly as the manager was, so private
 * bets remain unlinkable to the BETTOR but are linkable to each other. `new_self_owned` would
 * bind each account to an object instead and break even that link; it is the upgrade, not a
 * blocker, and it needs a per-bet on-chain object to hang the account off.
 */
async function createAccount() {
  const tx = new Transaction();
  const wrapper = tx.moveCall({
    target: `${cfg.accountPackage}::account_registry::new`,
    arguments: [tx.object(cfg.accountRegistry)],
  });
  tx.moveCall({ target: `${cfg.accountPackage}::account::share`, arguments: [wrapper] });
  const res = await signAndExecute(tx, 60_000_000);
  const created = res.objectChanges?.find(
    (c) => c.type === 'created' && typeof c.objectType === 'string' && c.objectType.includes('AccountWrapper'),
  );
  if (!created?.objectId) throw new Error('AccountWrapper was not created');
  return { digest: res.digest, managerId: created.objectId };
}


async function buildFundAndMintTx({ managerId, stakeMicro, oracleId, expiry, strike, isUp, quantity }) {
  // A Sui address holds DUSDC in two places and only one of them is a coin object. getCoins is
  // blind to the address balance, so gating on it called this desk broke while it was holding
  // 200 DUSDC with 0.25 of that in objects, and every private bet would have died on the first
  // stake. getBalance counts both, and coinWithBalance spends both: it uses coins where they
  // exist and injects coin::redeem_funds where the money sits in the balance.
  const held = BigInt((await client.getBalance({ owner: sessionAddress, coinType: cfg.dusdcType })).totalBalance);
  if (held < stakeMicro) {
    throw new Error(`executor has ${(Number(held) / 1e6).toFixed(2)} DUSDC, needs ${(Number(stakeMicro) / 1e6).toFixed(2)}`);
  }

  const tx = new Transaction();
  const stakeCoin = coinWithBalance({ type: cfg.dusdcType, balance: stakeMicro });

  const authDep = tx.moveCall({ target: `${cfg.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${cfg.accountPackage}::account::deposit_funds`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(managerId), authDep, stakeCoin,
      tx.object(TESTNET.accumulatorRoot), tx.object(TESTNET.clock),
    ],
  });

  // 7-29 mints a band between two ticks rather than a market_key, and prices it off a Pricer
  // built in this same PTB.
  const [lower, higher] = bandTicks(strike, isUp);
  const premiumMicro = (stakeMicro * 9n) / 10n;
  const pricer = loadLivePricer(tx, oracleId);
  const authMint = tx.moveCall({ target: `${cfg.accountPackage}::account::generate_auth`, arguments: [] });
  tx.moveCall({
    target: `${cfg.packageId}::expiry_market::mint_exact_amount`,
    arguments: [
      tx.object(oracleId), tx.object(managerId), authMint, tx.object(cfg.protocolConfig), pricer,
      // lower_tick, higher_tick, max_premium, min_quantity, leverage, max_cost
      tx.pure.u64(lower),
      tx.pure.u64(higher),
      // Premium, NOT the whole stake. 7-29 charges the trading and builder fees on top of the
      // premium and then checks the all-in total against max_cost, so premium == max_cost
      // leaves nothing for fees and aborts inside mint_prepared every time. Verified against
      // the live venue: premium 2.00 with cost 2.00 aborts, premium 1.80 with cost 2.00 fills
      // at 1.85 all-in. A tenth is comfortable headroom at the observed fee of roughly 3%.
      tx.pure.u64(premiumMicro),
      tx.pure.u64(BigInt(quantity)),
      // 1x, always. The desk has no margin and never had: the old rail minted plain positions
      // too. The ticket UI now says so out loud instead of quoting a leveraged return.
      tx.pure.u64(ONE_X_1E9),
      // The stake is a HARD ceiling on what can leave the account, so an unfavourable fill
      // reverts the whole PTB rather than spending more than the user agreed to.
      tx.pure.u64(stakeMicro),
      tx.object(TESTNET.accumulatorRoot), tx.object(TESTNET.clock),
    ],
  });

  return tx;
}

/**
 * Redeem a settled position back into its own account.
 *
 * 7-29 identifies a position by the u256 order id the mint emitted, not by reconstructing a
 * market_key from strike and side, so `orderId` has to have been captured at open time. It is
 * permissionless: no Auth, and the proceeds are credited to the account that holds the
 * position, which is this bet's own throwaway account.
 */
function redeemTx({ managerId, oracleId, orderId, quantity }) {
  if (orderId == null) throw new Error('this ticket predates order-id capture and cannot be redeemed automatically');
  const tx = new Transaction();
  tx.moveCall({
    target: `${cfg.packageId}::expiry_market::redeem_settled_permissionless`,
    arguments: [
      tx.object(oracleId),
      tx.object(cfg.accountRegistry),
      tx.object(managerId),
      tx.object(cfg.protocolConfig),
      tx.pure.u256(BigInt(orderId)),
      tx.pure.u64(BigInt(quantity)),
      tx.object(TESTNET.accumulatorRoot),
      tx.object(TESTNET.clock),
    ],
  });
  return tx;
}

/**
 * What this bet's account is holding.
 *
 * 4-16 kept balances in a bag under the manager and this walked its dynamic fields. 7-29's
 * AccountWrapper carries the figure directly, so read it off the object and fall back to the
 * dynamic-field walk only if the shape is not what we expect, rather than reporting zero and
 * making a real balance look spent.
 */
async function managerDusdcBalance(managerId) {
  const obj = await client.getObject({ id: managerId, options: { showContent: true } });
  const content = obj.data?.content;
  if (content?.dataType !== 'moveObject') return 0n;
  const f = content.fields ?? {};
  const direct =
    f.account?.fields?.balance ??
    f.balance ??
    f.account?.fields?.balances?.fields?.value;
  if (direct != null && typeof direct !== 'object') return BigInt(direct);
  const bagId =
    f.account?.fields?.balances?.fields?.id?.id ??
    f.balances?.fields?.id?.id;
  if (!bagId) return 0n;
  const fields = await client.getDynamicFields({ parentId: bagId });
  const entry = fields.data.find((x) => String(x.name?.type ?? '').includes('dusdc::DUSDC'));
  if (!entry) return 0n;
  const fieldObj = await client.getObject({ id: entry.objectId, options: { showContent: true } });
  const value = fieldObj.data?.content?.fields?.value;
  return value ? BigInt(value) : 0n;
}

function withdrawManyTx(items, owner) {
  const tx = new Transaction();
  // Each account authorises its own withdrawal. generate_auth reads the tx sender, and this
  // desk owns every throwaway account it created, so one PTB can drain several at once.
  const coins = items.map(({ managerId, amount }) => {
    const auth = tx.moveCall({ target: `${cfg.accountPackage}::account::generate_auth`, arguments: [] });
    return tx.moveCall({
      target: `${cfg.accountPackage}::account::withdraw_funds`,
      typeArguments: [cfg.dusdcType],
      arguments: [
        tx.object(managerId), auth, tx.pure.u64(amount),
        tx.object(TESTNET.accumulatorRoot), tx.object(TESTNET.clock),
      ],
    });
  });
  tx.transferObjects(coins, tx.pure.address(owner));
  return tx;
}

async function loadTickets() {
  try {
    return JSON.parse(await readFile(cfg.ticketStore, 'utf8'));
  } catch {
    return {};
  }
}

async function saveTickets(tickets) {
  await mkdir(dirname(cfg.ticketStore), { recursive: true });
  await writeFile(cfg.ticketStore, JSON.stringify(tickets, null, 2));
}

// Serialize every read-modify-write of the store. Two cashouts landing together would both
// load the same JSON, both mark their own position settled, and the second write would discard
// the first, leaving a redeemed position still marked 'open' and replayable.
let storeChain = Promise.resolve();
function withStoreLock(fn) {
  const next = storeChain.then(fn, fn);
  storeChain = next.then(() => undefined, () => undefined);
  return next;
}

async function recordTicket(ticket) {
  return withStoreLock(async () => {
    const tickets = await loadTickets();
    tickets[ticket.digest] = ticket;
    await saveTickets(tickets);
  });
}

async function updateTicket(digest, patch) {
  return withStoreLock(async () => {
    const tickets = await loadTickets();
    if (!tickets[digest]) throw new Error('private ticket not found in executor store');
    tickets[digest] = { ...tickets[digest], ...patch, updatedAt: Date.now() };
    await saveTickets(tickets);
    return tickets[digest];
  });
}

/**
 * Prove the enclave can sign BEFORE any money moves.
 *
 * The mint used to run first and the ticket second, so an unreachable or mis-keyed enclave meant
 * the desk had already bought a position that nobody could ever claim. Funds spent, no proof of
 * ownership, and the user has nothing to show for it. So the desk now proves it can produce a
 * VERIFIABLE ticket, signed by the key we pin, before it opens anything.
 *
 * Probed once and cached: the answer only changes when the enclave is redeployed, and spawning it
 * per bet would add a process launch to the critical path of every trade.
 */
let enclaveReady = null;
async function assertEnclaveReady() {
  if (enclaveReady === true) return;
  if (!cfg.enclaveCmd) throw new Error('PRIVATE_BET_ENCLAVE_CMD is not set; refusing to open a bet nobody could claim');
  if (!cfg.enclavePubkey) throw new Error('PRIVATE_BET_ENCLAVE_PUBKEY is not set; a ticket we cannot verify is not a claim');
  if (enclaveReady instanceof Promise) return enclaveReady;

  enclaveReady = (async () => {
    const probe = await issueTicket(
      {
        owner: '0x' + '11'.repeat(32),
        sessionManager: '0x' + '22'.repeat(32),
        oracleId: '0x' + '33'.repeat(32),
        expiry: Math.floor(Date.now() / 1000) + 3600,
        strike: 1, isUp: true, stakeMicro: 1, quantity: 1,
        nonce: 1, issuedAtMs: Date.now(),
      },
      { command: cfg.enclaveCmd },
    );
    // The enclave signing is not enough: it has to be THE enclave whose key we pin, or every
    // ticket it issues would be rejected later at cashout, after the money was already spent.
    if (probe.publicKeyHex.replace(/^0x/, '').toLowerCase() !== cfg.enclavePubkey.toLowerCase()) {
      throw new Error('enclave public key does not match PRIVATE_BET_ENCLAVE_PUBKEY');
    }
    enclaveReady = true;
  })();
  return enclaveReady;
}

async function openPrivateBet(body) {
  const owner = assertAddress(body.owner, 'owner');
  assertObjectId(body.vortexPool, 'vortexPool');
  const oracleId = assertObjectId(body.oracleId, 'oracleId');
  const expiry = assertU64String(body.expiry, 'expiry');
  const strike = assertU64String(body.strike, 'strike');
  const stakeMicro = assertU64String(body.stakeMicro, 'stakeMicro');
  const quantity = assertU64String(body.quantity, 'quantity');
  if (typeof body.isUp !== 'boolean') throw new Error('isUp must be boolean');

  // Prove the caller IS the owner before spending desk funds on their behalf. Without this the
  // endpoint mints house-funded positions for anyone who can send a POST.
  await verifyOpenAuthorization({
    payload: {
      owner,
      oracleId,
      expiry: expiry.toString(),
      strike: strike.toString(),
      isUp: body.isUp,
      stakeMicro: stakeMicro.toString(),
      quantity: quantity.toString(),
      issuedAtMs: body.issuedAtMs,
    },
    signature: body.authSignature,
    client,
  });

  assertReadyForOpen(owner, stakeMicro);
  // before createManager, before the mint, before a cent moves
  await assertEnclaveReady();

  const { digest: entryDigest, managerId } = await createAccount();
  const tx = await buildFundAndMintTx({
    managerId,
    stakeMicro,
    oracleId,
    expiry,
    strike,
    isUp: body.isUp,
    quantity,
  });
  const mint = await signAndExecute(tx, 100_000_000);
  const orderId = orderIdFromMint(mint);
  if (!orderId) {
    // Loud, not silent. The bet is open and the money is spent; what is missing is the handle
    // needed to cash it out automatically later, and finding that out at redeem time would be
    // far worse than finding it out now.
    console.error('[private-bet] no OrderMinted order id in', mint.digest, '- this ticket will need manual redemption');
  }

  // The enclave issues the only claim that counts. It runs its own guard, so a tampered host
  // cannot raise the cap or backdate an expiry here; it can only be refused.
  const issuedAtMs = Date.now();
  const issued = await issueTicket(
    {
      owner,
      sessionManager: managerId,
      oracleId,
      expiry: Number(expiry),
      strike: Number(strike),
      isUp: body.isUp,
      stakeMicro: Number(stakeMicro),
      quantity: Number(quantity),
      nonce: Number(BigInt(`0x${mint.digest.replace(/^0x/, '').slice(0, 12)}`) % 1_000_000_007n),
      issuedAtMs,
    },
    { command: cfg.enclaveCmd },
  );

  // What lands on disk deliberately does NOT include the owner. This file is the thing an
  // operator (or anyone who takes the box) can read, so the mapping we are hiding must not be
  // in it. All that is kept is enough to stop the same position being redeemed twice.
  await recordTicket({
    digest: mint.digest,
    sessionManager: managerId,
    status: 'open',
    entryDigest,
    openedAt: issuedAtMs,
    orderId,
    mode: 'attested-session-manager',
  });

  return {
    ok: true,
    digest: mint.digest,
    costDusdc: Number(stakeMicro) / 1e6,
    sessionAddress,
    sessionManager: managerId,
    entryDigest,
    mode: 'attested-session-manager',
    // The user's claim. Keep it: without it the position cannot be cashed out, and by design
    // this desk cannot reconstruct it for you.
    ticketHex: issued.ticketHex,
    signatureHex: issued.signatureHex,
    enclavePublicKey: issued.publicKeyHex,
    attestationDocHex: issued.attestationDocHex,
  };
}

async function cashoutPrivateBet(body) {
  assertObjectId(body.vortexPool, 'vortexPool');

  // The claim is the enclave's signature, not the caller's word. `owner` is read OUT of the
  // signed bytes and never off the request, so asking to cash out someone else's position
  // requires forging an ed25519 signature from a key that only exists inside the enclave.
  const ticketHex = String(body.ticketHex ?? '');
  const signatureHex = String(body.signatureHex ?? '');
  if (!ticketHex || !signatureHex) throw new Error('ticketHex and signatureHex required');
  if (!cfg.enclavePubkey) throw new Error('executor has no pinned enclave key; refusing to cash out');
  if (!verifyTicketSignature({ ticketHex, signatureHex, publicKeyHex: cfg.enclavePubkey })) {
    throw new Error('ticket signature is not from the attested enclave');
  }

  const claim = decodeTicket(ticketHex);
  const owner = assertAddress(claim.owner, 'ticket.owner');
  const managerId = assertObjectId(claim.sessionManager, 'ticket.sessionManager');

  // The on-disk record carries no owner; it exists only so a position cannot be redeemed twice.
  const tickets = await loadTickets();
  const digest = Object.keys(tickets).find((d) => tickets[d].sessionManager === managerId);
  if (!digest) throw new Error('position not known to this desk');
  const stored = tickets[digest];
  if (stored.status !== 'open') throw new Error(`position is ${stored.status}`);
  const redeem = await signAndExecute(
    redeemTx({
      managerId,
      // every parameter comes from the signed claim, so the redeem cannot be steered by the
      // caller or by anything an operator edited on disk
      oracleId: claim.oracleId,
      quantity: claim.quantity,
      // NOT from the claim: the enclave ticket predates 7-29 and has no field for it, and the
      // order id is not a permission, it is an address. The claim still decides WHETHER this
      // redeem may happen; this only says which position it lands on.
      orderId: tickets[digest]?.orderId ?? null,
    }),
    140_000_000,
  );

  const balance = await managerDusdcBalance(managerId);
  const settledAt = Date.now();

  // Return the proceeds STRAIGHT to the user's Trading Balance (no separate "Private
  // Balance" + withdraw step). credit_available_for is permissionless and built for this.
  let creditDigest = null;
  if (balance > 0n) {
    const tx = new Transaction();
    const auth = tx.moveCall({ target: `${cfg.accountPackage}::account::generate_auth`, arguments: [] });
    const coin = tx.moveCall({
      target: `${cfg.accountPackage}::account::withdraw_funds`,
      typeArguments: [cfg.dusdcType],
      arguments: [
        tx.object(managerId), auth, tx.pure.u64(balance),
        tx.object(TESTNET.accumulatorRoot), tx.object(TESTNET.clock),
      ],
    });
    tx.moveCall({
      target: `${cfg.tradingVaultPkg}::trading_vault::credit_available_for`,
      typeArguments: [cfg.dusdcType],
      arguments: [tx.object(cfg.tradingVault), tx.pure.address(owner), coin],
    });
    const credit = await signAndExecute(tx, 120_000_000);
    creditDigest = credit.digest;
  }

  await updateTicket(digest, {
    status: 'settled',
    redeemDigest: redeem.digest,
    creditDigest,
    payoutMicro: balance.toString(),
    settledAt,
    cashedOutAt: settledAt,
  });

  return {
    ok: true,
    digest: creditDigest ?? redeem.digest,
    settledToTradingBalance: true,
    payoutDusdc: Number(balance) / 1e6,
    settledAt,
  };
}

async function withdrawPrivateBalance(body) {
  assertObjectId(body.vortexPool, 'vortexPool');
  const mode = body.mode === 'private' ? 'private' : 'fast';

  // Same rule as cashout: the owner is read out of enclave-signed claims, never off the
  // request. Previously this took `owner` and a list of digests from the caller, so anyone who
  // could guess a digest could drain someone else's credited balance to their own address.
  const claims = Array.isArray(body.claims) ? body.claims : [];
  if (!claims.length) throw new Error('claims required');
  if (!cfg.enclavePubkey) throw new Error('executor has no pinned enclave key; refusing to withdraw');
  if (!signer) throw new Error('EXECUTOR_PRIVATE_KEY is not configured');

  const decoded = claims.map((c, i) => {
    const ticketHex = String(c?.ticketHex ?? '');
    const signatureHex = String(c?.signatureHex ?? '');
    if (!ticketHex || !signatureHex) throw new Error(`claims[${i}] needs ticketHex and signatureHex`);
    if (!verifyTicketSignature({ ticketHex, signatureHex, publicKeyHex: cfg.enclavePubkey })) {
      throw new Error(`claims[${i}] was not signed by the attested enclave`);
    }
    return decodeTicket(ticketHex);
  });

  // One withdrawal pays one address, so a batch mixing owners has to be refused rather than
  // silently paying whoever happens to be first.
  const owner = assertAddress(decoded[0].owner, 'claim.owner');
  if (decoded.some((d) => d.owner.toLowerCase() !== owner.toLowerCase())) {
    throw new Error('every claim in a withdrawal must belong to the same owner');
  }

  const tickets = await loadTickets();
  const selected = [];
  for (const claim of decoded) {
    const managerId = assertObjectId(claim.sessionManager, 'claim.sessionManager');
    const digest = Object.keys(tickets).find((d) => tickets[d].sessionManager === managerId);
    if (!digest) throw new Error('position not known to this desk');
    if (tickets[digest].status !== 'credited') throw new Error(`position is ${tickets[digest].status}`);
    const balance = await managerDusdcBalance(managerId);
    if (balance > 0n) selected.push({ digest, managerId, amount: balance });
  }

  if (!selected.length) throw new Error('private balance is empty');

  const total = selected.reduce((sum, item) => sum + item.amount, 0n);
  const withdrawal = await signAndExecute(withdrawManyTx(selected, owner), 120_000_000);
  const withdrewAt = Date.now();

  for (const item of selected) {
    await updateTicket(item.digest, {
      status: 'withdrawn',
      returnDigest: withdrawal.digest,
      withdrawDigest: withdrawal.digest,
      withdrawMode: mode,
      withdrawnMicro: item.amount.toString(),
      withdrewAt,
    });
  }

  return {
    ok: true,
    digest: withdrawal.digest,
    returnDigest: withdrawal.digest,
    payoutDusdc: Number(total) / 1e6,
    ticketDigests: selected.map((item) => item.digest),
    mode,
  };
}

function health() {
  const ready = Boolean(signer && cfg.sponsoredBeta);
  const reasons = [];
  if (!signer) reasons.push('EXECUTOR_PRIVATE_KEY missing');
  if (!cfg.sponsoredBeta) reasons.push('PRIVATE_BET_SPONSORED_BETA must be 1 for this testnet executor mode');
  return {
    ok: true,
    ready,
    reasons,
    mode: 'sponsored-session-manager',
    sessionAddress,
    vortexPool: cfg.vortexPool,
    maxStakeDusdc: Number(cfg.maxStakeMicro) / 1e6,
    onaraGas: Boolean(cfg.useOnara && cfg.onaraUrl),
    onaraUrl: cfg.onaraUrl ? cfg.onaraUrl.replace(/^https?:\/\//, '') : '',
    privateBalanceEnabled: true,
    withdrawModes: ['fast', 'private'],
    ticketStore: cfg.ticketStore,
    // Everything needed to check a ticket without trusting this box: the key it claims to sign
    // with, and the on-chain desk that independently attests to the same key.
    enclavePubkey: cfg.enclavePubkey ? `0x${cfg.enclavePubkey}` : '',
    ticketSealPkg: cfg.ticketSealPkg,
    privateDeskId: cfg.privateDeskId,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json(res, 200, health());
    }

    if (req.method === 'POST' && url.pathname === '/open') {
      requireAuth(req);
      return json(res, 200, await openPrivateBet(await readJson(req)));
    }

    if (req.method === 'POST' && url.pathname === '/cashout') {
      requireAuth(req);
      return json(res, 200, await cashoutPrivateBet(await readJson(req)));
    }

    if (req.method === 'POST' && url.pathname === '/withdraw') {
      requireAuth(req);
      return json(res, 200, await withdrawPrivateBalance(await readJson(req)));
    }

    return json(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    return json(res, error.status ?? 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`private-bet executor listening on http://${cfg.host}:${cfg.port}`);
  console.log(JSON.stringify(health(), null, 2));
});
