// POST /api/room/ensure { marketId } -> { ruleId, groupId }
//
// Rooms are created SERVER-SIDE by the app's own funded key, so users never pay
// gas to open a room (they only join, which is Onara-sponsored). This is the
// proven keypair flow (createAndShareGroup + MarketRoomRule + grant admin), run
// once per market. Idempotent: if the room already exists, we just return its ids.
//
// NOTE (testnet): the room-admin key is deterministic here for simplicity — it
// only creates rooms and holds a little testnet SUI. For mainnet, load it from a
// secret env var (ROOM_ADMIN_SECRET) instead.

import { NextResponse } from 'next/server';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { SealClient } from '@mysten/seal';
import { createSuiStackMessagingClient, TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG } from '@mysten/sui-stack-messaging';
import { TESTNET_SUI_GROUPS_PACKAGE_CONFIG } from '@mysten/sui-groups';
import { grpc, gql } from '@/lib/sui/modernClients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? 'https://relayer.yosuku.xyz';
const SEAL_SERVERS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];
const ROOMS_PKG = '0x7d22915a2bc60c2dcdb7055f69debe9d41e759b3f4e212330c17380e6795a658';
const BET_REGISTRY = '0xea58c10b34bbb90f226208c5895b8f159870a9f60d33bc5a11e1972763503dc6';
const GROUPS_PKG = '0xba8a26d42bc8b5e5caf4dac2a0f7544128d5dd9b4614af88eec1311ade11de79';
const EXT_ADMIN = `${GROUPS_PKG}::permissioned_group::ExtensionPermissionsAdmin`;

/** testnet room-admin — creates rooms + pays their (tiny) gas. */
function roomAdmin() {
  const secret = process.env.ROOM_ADMIN_SECRET;
  if (secret) return Ed25519Keypair.fromSecretKey(secret);
  return Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(42));
}

const RULES_BY_TYPE_Q = `query Rooms($type: String!, $first: Int!, $after: String) {
  objects(first: $first, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes { address asMoveObject { contents { json } } }
  }
}`;

async function findMarketRoom(marketId: string): Promise<{ ruleId: string; groupId: string } | null> {
  const type = `${ROOMS_PKG}::market_room_rule::MarketRoomRule`;
  const want = normalizeSuiAddress(marketId);
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const variables: { type: string; first: number; after: string | null } = { type, first: 50, after };
    const result = await gql.query<{ objects: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ address: string; asMoveObject?: { contents?: { json?: { market_id?: string; group_id?: string } } } }> } }>({ query: RULES_BY_TYPE_Q, variables });
    if (result.errors?.length) throw new Error(result.errors[0].message);
    const objs = result.data?.objects;
    for (const n of objs?.nodes ?? []) {
      const json = n.asMoveObject?.contents?.json;
      if (json?.market_id && normalizeSuiAddress(json.market_id) === want) {
        return { ruleId: n.address, groupId: String(json.group_id) };
      }
    }
    if (!objs?.pageInfo?.hasNextPage) return null;
    after = objs.pageInfo.endCursor;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const { marketId } = (await req.json()) as { marketId?: string };
    if (!marketId) return NextResponse.json({ error: 'marketId required' }, { status: 400 });

    const existing = await findMarketRoom(marketId);
    if (existing) return NextResponse.json(existing);

    const admin = roomAdmin();
    const seal = new SealClient({ suiClient: grpc, serverConfigs: SEAL_SERVERS.map((objectId) => ({ objectId, weight: 1 })), verifyKeyServers: false });
    const client = createSuiStackMessagingClient(grpc, {
      seal,
      encryption: { sessionKey: { signer: admin } },
      relayer: { relayerUrl: RELAYER_URL },
      packageConfig: { messaging: TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG, permissionedGroups: TESTNET_SUI_GROUPS_PACKAGE_CONFIG },
    });

    // 1. create the messaging group (+ Seal DEK), deterministic id from the market.
    await client.messaging.createAndShareGroup({ signer: admin, uuid: marketId, name: 'Yosuku market room' });
    const groupId = String(client.messaging.derive.groupId({ uuid: marketId }));

    // 2. create + share our gated MarketRoomRule; read the created id from objectTypes.
    const tx = new Transaction();
    const rule = tx.moveCall({ target: `${ROOMS_PKG}::market_room_rule::new`, arguments: [tx.pure.id(groupId), tx.pure.id(marketId)] });
    tx.moveCall({ target: `${ROOMS_PKG}::market_room_rule::share`, arguments: [rule] });
    tx.setSenderIfNotSet(admin.toSuiAddress());
    const bytes = await tx.build({ client: grpc });
    const { signature } = await admin.signTransaction(bytes);
    const res = (await grpc.executeTransaction({ transaction: bytes, signatures: [signature], include: { effects: true, objectTypes: true } })) as {
      Transaction?: { status?: { success?: boolean; error?: unknown }; objectTypes?: Record<string, string> };
      FailedTransaction?: { status?: { error?: unknown } };
    };
    const t = res.Transaction ?? res.FailedTransaction;
    if (!(t as { status?: { success?: boolean } })?.status?.success) {
      throw new Error(`rule creation failed: ${JSON.stringify((t as { status?: { error?: unknown } })?.status?.error)}`);
    }
    const ruleId = Object.entries(res.Transaction?.objectTypes ?? {}).find(([, ty]) => String(ty).includes('MarketRoomRule'))?.[0];
    if (!ruleId) throw new Error('rule id not found among created objects');

    // 3. grant the rule ExtensionPermissionsAdmin so gated join() can add members.
    await client.groups.grantPermissions({ signer: admin, groupId, member: ruleId, permissionTypes: [EXT_ADMIN] });

    return NextResponse.json({ ruleId, groupId });
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
