module suioverflow::risk_guardian;

use sui::{
    clock::Clock,
    event,
    table::{Self, Table},
};
use suioverflow::attestation_verifier::{Self, VerifiedAction};

const ENotGuardian: u64 = 1;
const ENotOwner: u64 = 2;
const EBadScore: u64 = 3;
const ENotHighRisk: u64 = 4;

const MAX_SCORE: u8 = 100;
/// Scores at/above this are "high risk": consumer vaults refuse to allocate into
/// the protocol, and subscribed protocols may be paused.
const HIGH_RISK_THRESHOLD: u8 = 70;
/// Scores older than this are ignored (fail-open) so a dead guardian can never
/// permanently freeze funds or a protocol.
const MAX_SCORE_AGE_MS: u64 = 600_000;

/// Shared registry of per-protocol risk scores. Written ONLY by the attested
/// guardian agent (proven via a Nautilus VerifiedAction). Read by consumer
/// vaults and by subscribed protocols. This is the shared "nervous system" that
/// connects the B2C agent wallets and the B2B risk-guardian-as-a-service.
public struct RiskRegistry has key {
    id: UID,
    guardian: address,
    scores: Table<vector<u8>, RiskScore>,
}

public struct RiskScore has store, copy, drop {
    score: u8,
    reason: vector<u8>,
    updated_at_ms: u64,
}

/// A protocol's subscription to the service: grants the guardian authority to
/// pause it on a risk spike, with a DAO override.
public struct ProtocolGuard has key {
    id: UID,
    protocol_id: vector<u8>,
    owner: address,
    paused: bool,
}

public struct RiskUpdated has copy, drop {
    protocol_id: vector<u8>,
    score: u8,
    reason: vector<u8>,
}

public struct ProtocolPauseChanged has copy, drop {
    protocol_id: vector<u8>,
    by_guardian: bool,
    paused: bool,
}

fun init(ctx: &mut TxContext) {
    transfer::share_object(RiskRegistry {
        id: object::new(ctx),
        guardian: ctx.sender(),
        scores: table::new(ctx),
    });
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

#[test_only]
public fun new_registry_for_testing(guardian: address, ctx: &mut TxContext): RiskRegistry {
    RiskRegistry { id: object::new(ctx), guardian, scores: table::new(ctx) }
}

/// Attested risk update — only the registered guardian agent may write. The
/// VerifiedAction proves the score came from the unmodified guardian running in
/// the TEE; the on-chain registry re-checks the agent identity.
public fun update_score(
    reg: &mut RiskRegistry,
    verified: VerifiedAction,
    protocol_id: vector<u8>,
    score: u8,
    reason: vector<u8>,
    clock: &Clock,
) {
    let (agent_addr, _digest, _nonce) = attestation_verifier::consume(verified);
    assert!(agent_addr == reg.guardian, ENotGuardian);
    assert!(score <= MAX_SCORE, EBadScore);
    let s = RiskScore { score, reason, updated_at_ms: clock.timestamp_ms() };
    if (reg.scores.contains(protocol_id)) {
        *reg.scores.borrow_mut(protocol_id) = s;
    } else {
        reg.scores.add(protocol_id, s);
    };
    event::emit(RiskUpdated { protocol_id, score, reason });
}

public fun score_of(reg: &RiskRegistry, protocol_id: vector<u8>): u8 {
    if (reg.scores.contains(protocol_id)) reg.scores.borrow(protocol_id).score else 0
}

/// True iff there is a FRESH score at/above the high-risk threshold. Stale or
/// missing scores return false (fail-open) — safety must never become a trap
/// that locks funds when the guardian is offline.
public fun is_high_risk(reg: &RiskRegistry, protocol_id: vector<u8>, clock: &Clock): bool {
    if (!reg.scores.contains(protocol_id)) return false;
    let s = reg.scores.borrow(protocol_id);
    if (clock.timestamp_ms() > s.updated_at_ms + MAX_SCORE_AGE_MS) return false;
    s.score >= HIGH_RISK_THRESHOLD
}

public fun guardian(reg: &RiskRegistry): address { reg.guardian }

// === B2B: protocol subscription (the "as a service" surface) ===

public fun subscribe(protocol_id: vector<u8>, ctx: &mut TxContext): ProtocolGuard {
    ProtocolGuard { id: object::new(ctx), protocol_id, owner: ctx.sender(), paused: false }
}

public fun share_guard(g: ProtocolGuard) { transfer::share_object(g) }

/// Permissionless: ANYONE may pause a subscribed protocol once the guardian has
/// flagged it high-risk — removing the human bottleneck in a fast crisis. The
/// authority is bounded: it only works while a fresh high-risk score exists.
public fun guardian_pause(g: &mut ProtocolGuard, reg: &RiskRegistry, clock: &Clock) {
    assert!(is_high_risk(reg, g.protocol_id, clock), ENotHighRisk);
    g.paused = true;
    event::emit(ProtocolPauseChanged { protocol_id: g.protocol_id, by_guardian: true, paused: true });
}

/// DAO override — the protocol owner can always unpause (and thereby opt out).
public fun dao_unpause(g: &mut ProtocolGuard, ctx: &TxContext) {
    assert!(ctx.sender() == g.owner, ENotOwner);
    g.paused = false;
    event::emit(ProtocolPauseChanged {
        protocol_id: g.protocol_id,
        by_guardian: false,
        paused: false,
    });
}

public fun is_paused(g: &ProtocolGuard): bool { g.paused }
public fun guard_protocol(g: &ProtocolGuard): vector<u8> { g.protocol_id }
