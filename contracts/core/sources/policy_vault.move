module suioverflow::policy_vault;

use sui::event;
use suioverflow::agent_registry::{Self, Registry, AgentCap};

const ENotOwner: u64 = 1;
const EAgentMismatch: u64 = 2;

/// A Seal-encrypted policy blob stored on Walrus.
/// The ciphertext lives on Walrus under `walrus_blob_id`; on-chain we only
/// keep the metadata and the access policy. Seal key servers gate decryption
/// via the `seal_approve` entry below.
public struct Policy has key {
    id: UID,
    owner: address,
    agent_addr: address,
    walrus_blob_id: u256,
    seal_identity: vector<u8>,
    version: u64,
    updated_at_ms: u64,
}

public struct PolicyCreated has copy, drop {
    policy_id: ID,
    owner: address,
    agent_addr: address,
}

public struct PolicyUpdated has copy, drop {
    policy_id: ID,
    new_blob: u256,
    new_version: u64,
}

public fun create(
    cap: &AgentCap,
    clock: &sui::clock::Clock,
    walrus_blob_id: u256,
    seal_identity: vector<u8>,
    ctx: &mut TxContext,
): Policy {
    let policy = Policy {
        id: object::new(ctx),
        owner: ctx.sender(),
        agent_addr: agent_registry::cap_agent(cap),
        walrus_blob_id,
        seal_identity,
        version: 1,
        updated_at_ms: clock.timestamp_ms(),
    };
    event::emit(PolicyCreated {
        policy_id: object::id(&policy),
        owner: policy.owner,
        agent_addr: policy.agent_addr,
    });
    policy
}

public fun update(
    policy: &mut Policy,
    clock: &sui::clock::Clock,
    new_blob: u256,
    new_identity: vector<u8>,
    ctx: &TxContext,
) {
    assert!(policy.owner == ctx.sender(), ENotOwner);
    policy.walrus_blob_id = new_blob;
    policy.seal_identity = new_identity;
    policy.version = policy.version + 1;
    policy.updated_at_ms = clock.timestamp_ms();
    event::emit(PolicyUpdated {
        policy_id: object::id(policy),
        new_blob,
        new_version: policy.version,
    });
}

/// Seal `seal_approve` entry. Returns successfully iff the caller is the
/// active registered agent for this policy. Seal key servers MUST dry-run
/// this function before issuing decryption shares.
///
/// NOTE: real Seal integration requires this to match the SealClient's
/// expected signature exactly — TODO once the package is published, verify
/// against seal-docs.wal.app.
public fun seal_approve(
    policy: &Policy,
    reg: &Registry,
    id: vector<u8>,
    ctx: &TxContext,
) {
    assert!(id == policy.seal_identity, EAgentMismatch);
    agent_registry::assert_active(reg, policy.agent_addr);
    assert!(ctx.sender() == policy.agent_addr, EAgentMismatch);
}

public fun blob_id(p: &Policy): u256 { p.walrus_blob_id }
public fun agent_addr(p: &Policy): address { p.agent_addr }
public fun owner(p: &Policy): address { p.owner }
