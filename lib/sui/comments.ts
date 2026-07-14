// Comments client — the browser side of position-gated rooms.
//
// This file has two halves:
//  1. VERIFIED, wallet-independent: the live constants, the on-chain gate check
//     (has_bet, gRPC-simulated — proven), and the tx builders for our Move calls
//     (bet_registry::record, market_room_rule::join).
//  2. TODO (needs a connected browser wallet to build+verify): the Sui Stack
//     Messaging client ($extend chain with suiGroups + seal + suiStackMessaging),
//     per-market room creation (messaging group + Seal DEK + our rule), and the
//     encrypted send/read wrappers. These sign a personal message via the wallet
//     and decrypt via Seal in-browser, so they can't be validated headlessly —
//     wired in the component layer with a dapp-kit wallet→Signer adapter.

import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import type { Signer } from '@mysten/sui/cryptography';
import { SealClient } from '@mysten/seal';
import { createSuiStackMessagingClient, TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG } from '@mysten/sui-stack-messaging';
import { TESTNET_SUI_GROUPS_PACKAGE_CONFIG } from '@mysten/sui-groups';
import type { RoomComment } from '@/components/CommentRoom';
import { grpc, gql } from './modernClients';

// ─── live constants ───

/** The publicly-exposed relayer (Cloudflare tunnel → box, zero open ports). */
export const RELAYER_URL = process.env.NEXT_PUBLIC_RELAYER_URL ?? 'https://relayer.yosuku.xyz';

/** Sui Stack Messaging (testnet, Mysten-deployed). */
export const MESSAGING = {
  packageId: '0x047696be0e98f1b47a99727fecf2955cadb23c56f67c6b872b74e3ad59d51b46',
  namespaceId: '0x9442bdc5c0aef62b2c9ac797db3f74db9c99400547992d8fb49cc7b0ef709cf2',
  versionId: '0x491ab1b3041a0d4ece9dd3b72b73a414b34109edb7a74206838161f195f6f20e',
  witnessType: '0x047696be0e98f1b47a99727fecf2955cadb23c56f67c6b872b74e3ad59d51b46::messaging::Messaging',
} as const;

/** Sui Groups (testnet). */
export const GROUPS_PACKAGE_ID = '0xba8a26d42bc8b5e5caf4dac2a0f7544128d5dd9b4614af88eec1311ade11de79';

/** Seal key servers (testnet) — threshold 2. */
export const SEAL_KEY_SERVERS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];

/** Our position gate (yosuku_rooms), deployed + proven on testnet. */
export const ROOMS = {
  packageId: '0x7d22915a2bc60c2dcdb7055f69debe9d41e759b3f4e212330c17380e6795a658',
  betRegistry: '0xea58c10b34bbb90f226208c5895b8f159870a9f60d33bc5a11e1972763503dc6',
} as const;


// ─── the gate check (VERIFIED — same gRPC-simulate proven on-chain) ───

/**
 * Does `user` hold a bet on `marketId`? This is exactly what
 * market_room_rule::join asserts before granting read+post, so the UI gate and
 * the on-chain gate agree. Read-only (no gas): a dev-inspect of has_bet.
 */
export async function checkHasBet(user: string, marketId: string): Promise<boolean> {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${ROOMS.packageId}::bet_registry::has_bet`,
      arguments: [tx.object(ROOMS.betRegistry), tx.pure.address(user), tx.pure.id(marketId)],
    });
    tx.setSenderIfNotSet(user);
    const res = await grpc.simulateTransaction({ transaction: tx, include: { commandResults: true } });
    const bcs = res.commandResults?.[0]?.returnValues?.[0]?.bcs;
    return bcs?.[0] === 1;
  } catch {
    return false;
  }
}

// ─── tx builders for our Move calls (VERIFIED via tsc; dry-runnable) ───

/** Fold into the bet PTB: mark the sender as a bettor on `marketId` (unlocks the
 *  room). Idempotent per (user, market). Gas-free once added to the Onara policy. */
export function addRecordBet(tx: Transaction, marketId: string): Transaction {
  tx.moveCall({
    target: `${ROOMS.packageId}::bet_registry::record`,
    arguments: [tx.object(ROOMS.betRegistry), tx.pure.id(marketId)],
  });
  return tx;
}

/** Join a market's room (gated: aborts if the sender hasn't bet the market).
 *  Grants MessagingReader + MessagingSender. `ruleId`/`groupId` are the room's
 *  shared objects created by market_room_rule::create_market_room. */
export function buildJoinRoomTx(ruleId: string, groupId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${ROOMS.packageId}::market_room_rule::join`,
    arguments: [tx.object(ruleId), tx.object(groupId), tx.object(ROOMS.betRegistry)],
  });
  return tx;
}

// ─── the messaging client (send/read PROVEN end-to-end via our relayer) ───
//
// Construction validated by a live round-trip: SuiGrpcClient base →
// createSuiStackMessagingClient with a real SealClient + our relayer. `signer`
// is a @mysten/sui Signer; in the browser it's a dapp-kit wallet adapted to the
// Signer interface (signTransaction + signPersonalMessage for the Seal
// SessionKey) — the one remaining browser-only piece, wired in the component.

/** A stable per-market room id → the SDK group uuid (all clients agree). */
export function roomUuid(marketId: string): string {
  // The market id is already globally-unique; use it directly as the group uuid.
  return marketId;
}

/** The messaging client type — build ONCE per session and reuse (its Seal
 *  SessionKey is created on first encrypted op = one wallet prompt per session). */
export type MessagingClient = ReturnType<typeof getMessagingClient>;

/** Build the Sui Stack Messaging client (Seal + our relayer). PROVEN pattern. */
export function getMessagingClient(signer: Signer) {
  const seal = new SealClient({
    suiClient: grpc,
    serverConfigs: SEAL_KEY_SERVERS.map((objectId) => ({ objectId, weight: 1 })),
    verifyKeyServers: false,
  });
  return createSuiStackMessagingClient(grpc, {
    seal,
    encryption: { sessionKey: { signer } },
    relayer: { relayerUrl: RELAYER_URL },
    packageConfig: {
      messaging: TESTNET_SUI_STACK_MESSAGING_PACKAGE_CONFIG,
      permissionedGroups: TESTNET_SUI_GROUPS_PACKAGE_CONFIG,
    },
  });
}

/** Post an E2E-encrypted comment to a market's room (delivered via our relayer). */
export async function postComment(client: MessagingClient, signer: Signer, marketId: string, text: string): Promise<void> {
  await client.messaging.sendMessage({ signer, groupRef: { uuid: roomUuid(marketId) }, text });
}

/** Read + decrypt a market room's comments, newest last. */
export async function fetchComments(client: MessagingClient, signer: Signer, marketId: string, me?: string): Promise<RoomComment[]> {
  const res = await client.messaging.getMessages({ signer, groupRef: { uuid: roomUuid(marketId) } });
  // shape finalized during browser wiring; map defensively.
  const rows = (res as { messages?: unknown[] }).messages ?? [];
  return rows.map((r, i) => {
    const m = r as Record<string, unknown>;
    const author = String(m.sender ?? m.senderAddress ?? '');
    return {
      id: String(m.messageId ?? m.id ?? i),
      author,
      text: String(m.text ?? m.content ?? ''),
      tsMs: Number(m.createdAtMs ?? m.createdAt ?? m.sentAtMs ?? 0),
      mine: !!me && author === me,
      verified: !!m.senderVerified,
    } satisfies RoomComment;
  });
}

// ─── room discovery + creation (the create-or-find spine) ───
//
// A room is 1:1 with a market. The group id is deterministic from the market id,
// but the MarketRoomRule (which gates join) is a random shared object, so a second
// visitor has to *find* it. We query all MarketRoomRule objects by type and match
// on the on-chain `market_id` field — no extra index, no redeploy. (Discovery is a
// read; creation is done once by the first visitor with a position.)

const ROOMS_BY_TYPE_Q = `query Rooms($type: String!, $first: Int!, $after: String) {
  objects(first: $first, after: $after, filter: { type: $type }) {
    pageInfo { hasNextPage endCursor }
    nodes { address asMoveObject { contents { json } } }
  }
}`;

type RoomRefs = { ruleId: string; groupId: string };
type RoomsQ = {
  objects: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ address: string; asMoveObject?: { contents?: { json?: { market_id?: string; group_id?: string } } } }>;
  };
};

/** Find an existing market room's rule + group ids, or null if none exists yet. */
export async function findMarketRoom(marketId: string): Promise<RoomRefs | null> {
  const type = `${ROOMS.packageId}::market_room_rule::MarketRoomRule`;
  const want = normalizeSuiAddress(marketId);
  let after: string | null = null;
  // cap the scan so a pathological result set can't spin forever (log if we hit it).
  for (let page = 0; page < 40; page++) {
    const variables: { type: string; first: number; after: string | null } = { type, first: 50, after };
    const result: { data?: RoomsQ; errors?: Array<{ message: string }> } = await gql.query<RoomsQ>({ query: ROOMS_BY_TYPE_Q, variables });
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
  console.warn('[comments] findMarketRoom scan capped at 2000 rooms — room may exist beyond the cap');
  return null;
}

/**
 * Get the room for `marketId`, creating it once if it doesn't exist. Creation is
 * done SERVER-SIDE (/api/room/ensure) by the app's own funded key, so users never
 * pay gas to open a room — they only join (Onara-sponsored) and post (off-chain).
 * Idempotent: the route returns the existing room if one already exists.
 */
export async function ensureMarketRoom(marketId: string): Promise<RoomRefs> {
  const res = await fetch('/api/room/ensure', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ marketId }),
  });
  const data = (await res.json().catch(() => ({}))) as RoomRefs & { error?: string };
  if (!res.ok || !data.ruleId) throw new Error(data.error ?? `room ensure failed (${res.status})`);
  return { ruleId: data.ruleId, groupId: data.groupId };
}

/** useSmartSubmit's submit: gas-free via the Onara sponsor, wallet fallback. */
type SubmitFn = (factory: () => Transaction | Promise<Transaction>) => Promise<{ digest: string; sponsored: boolean }>;

/** Join a market's room (gated on-chain). Gas-free via the Onara sponsor (wallet
 *  fallback). The one on-chain step of The Room — posting comments is off-chain
 *  (relayer/Walrus delivery), so it costs no gas at all.
 *
 *  Retries on stale-gas-coin errors: the sponsored path pins one random coin from
 *  the sponsor pool, and its version can go stale under concurrency ("Transaction
 *  needs to be rebuilt because object … changed"). Each retry rebuilds fresh and
 *  repins a different coin, so a transient version race resolves itself. */
export async function joinRoom(opts: { submit: SubmitFn; ruleId: string; groupId: string }): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { digest } = await opts.submit(() => buildJoinRoomTx(opts.ruleId, opts.groupId));
      return digest;
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? e);
      const retriable = /rebuilt|rejected as invalid|not available|version|equivocat|reserved|conflict/i.test(msg);
      if (!retriable || attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); // let chain state settle, then repin
    }
  }
  throw lastErr;
}
