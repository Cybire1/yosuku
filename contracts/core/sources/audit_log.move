module suioverflow::audit_log;

use sui::{
    clock::Clock,
    event,
};

const EAgentMismatch: u64 = 1;

/// Per-agent audit ring. New entries are emitted as events (indexed off-chain)
/// and the latest sequence number / Walrus blob id is also kept on-chain
/// so consumers can dry-run a read without hitting the indexer.
public struct AuditLog has key, store {
    id: UID,
    agent_addr: address,
    latest_seq: u64,
    latest_blob_id: u256,
    latest_action_digest: vector<u8>,
    latest_ts_ms: u64,
}

public struct AuditEntryRecorded has copy, drop {
    log_id: ID,
    agent_addr: address,
    seq: u64,
    action_digest: vector<u8>,
    walrus_blob_id: u256,
    ts_ms: u64,
}

public fun new(agent_addr: address, ctx: &mut TxContext): AuditLog {
    AuditLog {
        id: object::new(ctx),
        agent_addr,
        latest_seq: 0,
        latest_blob_id: 0,
        latest_action_digest: vector[],
        latest_ts_ms: 0,
    }
}

public fun append(
    log: &mut AuditLog,
    expected_agent: address,
    action_digest: vector<u8>,
    walrus_blob_id: u256,
    clock: &Clock,
) {
    assert!(log.agent_addr == expected_agent, EAgentMismatch);
    log.latest_seq = log.latest_seq + 1;
    log.latest_blob_id = walrus_blob_id;
    log.latest_action_digest = action_digest;
    log.latest_ts_ms = clock.timestamp_ms();

    event::emit(AuditEntryRecorded {
        log_id: object::id(log),
        agent_addr: log.agent_addr,
        seq: log.latest_seq,
        action_digest,
        walrus_blob_id,
        ts_ms: log.latest_ts_ms,
    });
}

public fun latest_seq(log: &AuditLog): u64 { log.latest_seq }
public fun latest_blob_id(log: &AuditLog): u256 { log.latest_blob_id }
