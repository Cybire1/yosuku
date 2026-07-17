module suioverflow::agent_registry;

use sui::{
    event,
    nitro_attestation::{Self, NitroAttestationDocument},
    table::{Self, Table},
};

const ENotOwner: u64 = 1;
const EAlreadyRegistered: u64 = 2;
const EUnknownAgent: u64 = 3;
const ERevoked: u64 = 4;
const ENoPublicKey: u64 = 5;

public struct Registry has key {
    id: UID,
    agents: Table<address, AgentInfo>,
}

public struct AgentInfo has store, drop, copy {
    owner: address,
    enclave_pcr0: vector<u8>,
    enclave_pcr1: vector<u8>,
    enclave_pcr2: vector<u8>,
    /// The enclave's attested ed25519 public key (from the Nitro attestation's
    /// `public_key` field). Every agent action must carry a signature that
    /// verifies against this key — see attestation_verifier.
    enclave_pk: vector<u8>,
    revoked: bool,
    registered_at_ms: u64,
}

public struct AdminCap has key, store { id: UID }

public struct AgentCap has key, store {
    id: UID,
    agent_addr: address,
}

public struct AgentRegistered has copy, drop {
    agent_addr: address,
    owner: address,
}

public struct AgentRevoked has copy, drop {
    agent_addr: address,
}

fun init(ctx: &mut TxContext) {
    let registry = Registry { id: object::new(ctx), agents: table::new(ctx) };
    transfer::share_object(registry);
    transfer::transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

/// Low-level registration with explicit PCRs + attested public key. Used by
/// `register_attested` (real path) and directly in tests.
public fun register(
    reg: &mut Registry,
    clock: &sui::clock::Clock,
    agent_addr: address,
    pcr0: vector<u8>,
    pcr1: vector<u8>,
    pcr2: vector<u8>,
    enclave_pk: vector<u8>,
    ctx: &mut TxContext,
): AgentCap {
    assert!(!reg.agents.contains(agent_addr), EAlreadyRegistered);
    let info = AgentInfo {
        owner: ctx.sender(),
        enclave_pcr0: pcr0,
        enclave_pcr1: pcr1,
        enclave_pcr2: pcr2,
        enclave_pk,
        revoked: false,
        registered_at_ms: clock.timestamp_ms(),
    };
    reg.agents.add(agent_addr, info);
    event::emit(AgentRegistered { agent_addr, owner: ctx.sender() });
    AgentCap { id: object::new(ctx), agent_addr }
}

/// Real registration: pass a verified Nitro attestation document (produced by
/// `sui::nitro_attestation::load_nitro_attestation` earlier in the same PTB,
/// which checks the AWS Nitro root cert chain + COSE signature). We pin the
/// document's PCRs and bind its attested public key to the agent.
public fun register_attested(
    reg: &mut Registry,
    document: NitroAttestationDocument,
    clock: &sui::clock::Clock,
    agent_addr: address,
    ctx: &mut TxContext,
): AgentCap {
    let pk_opt = nitro_attestation::public_key(&document);
    assert!(pk_opt.is_some(), ENoPublicKey);
    let pk = *pk_opt.borrow();
    let p0 = pcr_at(&document, 0);
    let p1 = pcr_at(&document, 1);
    let p2 = pcr_at(&document, 2);
    register(reg, clock, agent_addr, p0, p1, p2, pk, ctx)
}

/// Pull the PCR with the given index out of the attestation document.
fun pcr_at(document: &NitroAttestationDocument, idx: u8): vector<u8> {
    let entries = nitro_attestation::pcrs(document);
    let n = entries.length();
    'pcr: {
        n.do!(|i| {
            let e = entries.borrow(i);
            if (nitro_attestation::index(e) == idx) return 'pcr *nitro_attestation::value(e);
        });
        vector[]
    }
}

public fun revoke(reg: &mut Registry, agent_addr: address, ctx: &mut TxContext) {
    assert!(reg.agents.contains(agent_addr), EUnknownAgent);
    let info = reg.agents.borrow_mut(agent_addr);
    assert!(info.owner == ctx.sender(), ENotOwner);
    info.revoked = true;
    event::emit(AgentRevoked { agent_addr });
}

public fun assert_active(reg: &Registry, agent_addr: address) {
    assert!(reg.agents.contains(agent_addr), EUnknownAgent);
    let info = reg.agents.borrow(agent_addr);
    assert!(!info.revoked, ERevoked);
}

public fun expected_pcrs(reg: &Registry, agent_addr: address): (vector<u8>, vector<u8>, vector<u8>) {
    let info = reg.agents.borrow(agent_addr);
    (info.enclave_pcr0, info.enclave_pcr1, info.enclave_pcr2)
}

/// The attested ed25519 public key bound to this agent.
public fun enclave_pk(reg: &Registry, agent_addr: address): vector<u8> {
    reg.agents.borrow(agent_addr).enclave_pk
}

public fun cap_agent(cap: &AgentCap): address { cap.agent_addr }
