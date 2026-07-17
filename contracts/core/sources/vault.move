module suioverflow::vault;

use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin},
    clock::Clock,
    event,
    table::{Self, Table},
};
use suioverflow::{
    attestation_verifier::{Self, VerifiedAction},
    audit_log::{Self, AuditLog},
};

// === Constants ===

const BPS_DENOM: u128 = 10_000;
const DAY_MS: u64 = 86_400_000;

// === Errors ===

const ENotOwner: u64 = 1;
const EAgentMismatch: u64 = 2;
const EDigestMismatch: u64 = 3;
const EVaultMismatch: u64 = 4;
const EPaused: u64 = 5;
const EInsufficientIdle: u64 = 6;
const EExceedsMoveCap: u64 = 7;
const EExceedsProtocolCap: u64 = 8;
const EUnknownAllocation: u64 = 9;
const EBadConfig: u64 = 10;

// === Core types ===

/// Owner-controlled safety limits. The agent can never widen these — only the
/// owner can, via `set_config`.
public struct VaultConfig has store {
    /// Max share of total assets (idle + deployed) that may sit in any single
    /// protocol, in basis points (e.g. 4000 = 40%). Enforced on-chain.
    per_protocol_cap_bps: u64,
    /// Max amount the agent may move in a single allocation action.
    max_single_move: u64,
    /// If realized losses within a rolling 24h window exceed this, the agent
    /// is frozen (circuit breaker). Owner-only `unpause` clears it.
    daily_loss_limit: u64,
}

/// Rolling-window risk accounting, re-evaluated on-chain on every action.
public struct RiskState has store {
    day_start_ms: u64,
    realized_loss_today: u64,
    high_watermark: u64,
}

/// Cost-basis bookkeeping for funds deployed into one protocol "building".
public struct Allocation has store {
    principal: u64,
    last_update_ms: u64,
}

/// A user's non-custodial portfolio vault. The user owns this object; we never
/// hold keys. The agent may only move funds via an attested + risk-approved
/// action, and only within `config`. The owner can withdraw idle funds and
/// trip the emergency pause at any time, regardless of the agent.
public struct Vault<phantom T> has key {
    id: UID,
    owner: address,
    agent_addr: address,
    /// Uncommitted funds, available for the owner to withdraw immediately.
    idle: Balance<T>,
    /// Sum of `principal` across all allocations (accounting mirror of funds
    /// currently working inside protocol buildings).
    total_deployed: u64,
    /// protocol_id (utf8 bytes, e.g. b"navi") -> Allocation
    allocations: Table<vector<u8>, Allocation>,
    config: VaultConfig,
    risk: RiskState,
    audit: AuditLog,
    paused: bool,
}

// === Hot potatoes (force the protocol interaction to complete in-PTB) ===

/// Minted by `begin_allocation` after attestation + on-chain cap re-check.
/// No abilities → the same PTB must withdraw, deposit into the protocol, and
/// confirm.
public struct AllocationTicket {
    vault_id: ID,
    protocol_id: vector<u8>,
    amount: u64,
    action_digest: vector<u8>,
}

/// Minted by `begin_collection` to exit a protocol position. The PTB must
/// redeem the position and hand the proceeds to `confirm_collection`.
public struct CollectionTicket {
    vault_id: ID,
    protocol_id: vector<u8>,
    principal: u64,
    action_digest: vector<u8>,
}

/// Minted by `begin_trade` for a budget-capped DeepBook round-trip. The PTB
/// routes the withdrawn coin through DeepBook (T -> X -> T) and hands the
/// proceeds back to `settle_trade`.
public struct TradeTicket {
    vault_id: ID,
    amount_in: u64,
    action_digest: vector<u8>,
}

// === Events ===

public struct VaultOpened has copy, drop {
    vault_id: ID,
    owner: address,
    agent_addr: address,
}

public struct Allocated has copy, drop {
    vault_id: ID,
    protocol_id: vector<u8>,
    amount: u64,
    new_principal: u64,
}

public struct Collected has copy, drop {
    vault_id: ID,
    protocol_id: vector<u8>,
    principal: u64,
    proceeds: u64,
    realized_pnl: u64,
    is_loss: bool,
}

public struct Traded has copy, drop {
    vault_id: ID,
    amount_in: u64,
    proceeds: u64,
    realized_pnl: u64,
    is_loss: bool,
}

public struct CircuitBreakerTripped has copy, drop {
    vault_id: ID,
    realized_loss_today: u64,
    daily_loss_limit: u64,
}

public struct PausedChanged has copy, drop {
    vault_id: ID,
    paused: bool,
}

// === Owner lifecycle ===

public fun open<T>(
    agent_addr: address,
    per_protocol_cap_bps: u64,
    max_single_move: u64,
    daily_loss_limit: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Vault<T> {
    assert!(per_protocol_cap_bps > 0 && (per_protocol_cap_bps as u128) <= BPS_DENOM, EBadConfig);
    let vault = Vault<T> {
        id: object::new(ctx),
        owner: ctx.sender(),
        agent_addr,
        idle: balance::zero<T>(),
        total_deployed: 0,
        allocations: table::new(ctx),
        config: VaultConfig { per_protocol_cap_bps, max_single_move, daily_loss_limit },
        risk: RiskState {
            day_start_ms: clock.timestamp_ms(),
            realized_loss_today: 0,
            high_watermark: 0,
        },
        audit: audit_log::new(agent_addr, ctx),
        paused: false,
    };
    event::emit(VaultOpened {
        vault_id: object::id(&vault),
        owner: vault.owner,
        agent_addr,
    });
    vault
}

public fun share<T>(vault: Vault<T>) { transfer::share_object(vault) }

/// Anyone funding their own vault. Funds land in `idle`.
public fun deposit<T>(vault: &mut Vault<T>, coin: Coin<T>, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    coin::put(&mut vault.idle, coin);
}

/// Owner pulls idle funds out at any time — independent of the agent, and even
/// while paused. Deployed funds must first be collected back to idle.
public fun owner_withdraw<T>(vault: &mut Vault<T>, amount: u64, ctx: &mut TxContext): Coin<T> {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    assert!(balance::value(&vault.idle) >= amount, EInsufficientIdle);
    coin::take(&mut vault.idle, amount, ctx)
}

/// Owner-only emergency freeze. Blocks all new agent allocations immediately.
/// Collections (exiting positions) remain allowed so funds can always come home.
public fun emergency_pause<T>(vault: &mut Vault<T>, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    vault.paused = true;
    event::emit(PausedChanged { vault_id: object::id(vault), paused: true });
}

public fun unpause<T>(vault: &mut Vault<T>, ctx: &TxContext) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    vault.paused = false;
    event::emit(PausedChanged { vault_id: object::id(vault), paused: false });
}

public fun set_config<T>(
    vault: &mut Vault<T>,
    per_protocol_cap_bps: u64,
    max_single_move: u64,
    daily_loss_limit: u64,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    assert!(per_protocol_cap_bps > 0 && (per_protocol_cap_bps as u128) <= BPS_DENOM, EBadConfig);
    vault.config.per_protocol_cap_bps = per_protocol_cap_bps;
    vault.config.max_single_move = max_single_move;
    vault.config.daily_loss_limit = daily_loss_limit;
}

// === Agent flow: allocate idle funds into a protocol building ===

/// Step 1. Consume the attestation, re-check the risk limits on-chain (defense
/// in depth — we do NOT trust the enclave's verdict alone for hard caps), and
/// mint a ticket the PTB must redeem.
public fun begin_allocation<T>(
    vault: &mut Vault<T>,
    verified: VerifiedAction,
    protocol_id: vector<u8>,
    amount: u64,
    expected_digest: vector<u8>,
    clock: &Clock,
): AllocationTicket {
    assert!(!vault.paused, EPaused);
    let (agent_addr, action_digest, _nonce) = attestation_verifier::consume(verified);
    assert!(vault.agent_addr == agent_addr, EAgentMismatch);
    assert!(action_digest == expected_digest, EDigestMismatch);

    roll_day(&mut vault.risk, clock.timestamp_ms());

    assert!(amount <= vault.config.max_single_move, EExceedsMoveCap);
    assert!(balance::value(&vault.idle) >= amount, EInsufficientIdle);

    let total_assets = balance::value(&vault.idle) + vault.total_deployed;
    let cap = ((total_assets as u128) * (vault.config.per_protocol_cap_bps as u128) / BPS_DENOM) as u64;
    let current = if (vault.allocations.contains(protocol_id)) {
        vault.allocations.borrow(protocol_id).principal
    } else { 0 };
    assert!(current + amount <= cap, EExceedsProtocolCap);

    AllocationTicket {
        vault_id: object::id(vault),
        protocol_id,
        amount,
        action_digest,
    }
}

/// Step 2. Pull the funds for the protocol deposit. Ticket held by reference so
/// the PTB must still confirm.
public fun withdraw_for_allocation<T>(
    vault: &mut Vault<T>,
    ticket: &AllocationTicket,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(object::id(vault) == ticket.vault_id, EVaultMismatch);
    coin::take(&mut vault.idle, ticket.amount, ctx)
}

/// Step 3. Record the deployed principal and append the audit entry. The
/// protocol position itself (LP/receipt token) is custodied by the adapter
/// layer; here we keep the cost-basis ledger and the on-chain provenance.
public fun confirm_allocation<T>(
    vault: &mut Vault<T>,
    ticket: AllocationTicket,
    walrus_blob_id: u256,
    clock: &Clock,
) {
    let AllocationTicket { vault_id, protocol_id, amount, action_digest } = ticket;
    assert!(object::id(vault) == vault_id, EVaultMismatch);

    let now = clock.timestamp_ms();
    let new_principal = if (vault.allocations.contains(protocol_id)) {
        let alloc = vault.allocations.borrow_mut(protocol_id);
        alloc.principal = alloc.principal + amount;
        alloc.last_update_ms = now;
        alloc.principal
    } else {
        vault.allocations.add(protocol_id, Allocation { principal: amount, last_update_ms: now });
        amount
    };
    vault.total_deployed = vault.total_deployed + amount;

    audit_log::append(&mut vault.audit, vault.agent_addr, action_digest, walrus_blob_id, clock);
    event::emit(Allocated {
        vault_id,
        protocol_id,
        amount,
        new_principal,
    });
}

// === Agent flow: collect (exit) a protocol position back to idle ===

/// Step 1. Begin a full exit of one protocol position. Allowed even while
/// paused so funds can always come home. Records the principal being unwound.
public fun begin_collection<T>(
    vault: &mut Vault<T>,
    verified: VerifiedAction,
    protocol_id: vector<u8>,
    expected_digest: vector<u8>,
): CollectionTicket {
    let (agent_addr, action_digest, _nonce) = attestation_verifier::consume(verified);
    assert!(vault.agent_addr == agent_addr, EAgentMismatch);
    assert!(action_digest == expected_digest, EDigestMismatch);
    assert!(vault.allocations.contains(protocol_id), EUnknownAllocation);

    let principal = vault.allocations.borrow(protocol_id).principal;
    CollectionTicket {
        vault_id: object::id(vault),
        protocol_id,
        principal,
        action_digest,
    }
}

/// Step 2. Deposit the redeemed proceeds, settle realized PnL, update the
/// circuit breaker, and append the audit entry. If realized losses breach the
/// daily limit the vault auto-pauses (the agent is frozen until the owner
/// unpauses) — but the collection itself always completes.
public fun confirm_collection<T>(
    vault: &mut Vault<T>,
    ticket: CollectionTicket,
    proceeds: Coin<T>,
    walrus_blob_id: u256,
    clock: &Clock,
) {
    let CollectionTicket { vault_id, protocol_id, principal, action_digest } = ticket;
    assert!(object::id(vault) == vault_id, EVaultMismatch);

    let proceeds_val = proceeds.value();
    coin::put(&mut vault.idle, proceeds);

    // Unwind the ledger.
    let Allocation { .. } = vault.allocations.remove(protocol_id);
    vault.total_deployed = vault.total_deployed - principal;

    let now = clock.timestamp_ms();
    roll_day(&mut vault.risk, now);

    let is_loss = proceeds_val < principal;
    let realized_pnl = if (is_loss) { principal - proceeds_val } else { proceeds_val - principal };
    if (is_loss) {
        vault.risk.realized_loss_today = vault.risk.realized_loss_today + realized_pnl;
        if (vault.risk.realized_loss_today > vault.config.daily_loss_limit && !vault.paused) {
            vault.paused = true;
            event::emit(CircuitBreakerTripped {
                vault_id,
                realized_loss_today: vault.risk.realized_loss_today,
                daily_loss_limit: vault.config.daily_loss_limit,
            });
            event::emit(PausedChanged { vault_id, paused: true });
        }
    };

    let total_assets = balance::value(&vault.idle) + vault.total_deployed;
    if (total_assets > vault.risk.high_watermark) {
        vault.risk.high_watermark = total_assets;
    };

    audit_log::append(&mut vault.audit, vault.agent_addr, action_digest, walrus_blob_id, clock);
    event::emit(Collected {
        vault_id,
        protocol_id,
        principal,
        proceeds: proceeds_val,
        realized_pnl,
        is_loss,
    });
}

// === Agent flow: budget-capped DeepBook round-trip trade ===

/// Step 1. Consume the attestation, enforce the on-chain budget ceiling, and
/// withdraw the input coin. Returns it alongside a ticket the PTB must settle.
/// The PTB routes `amount_in` of T through DeepBook (T -> X -> T) and hands the
/// proceeds to `settle_trade`. The agent can never spend more than
/// `max_single_move` in one trade — enforced here regardless of the enclave.
public fun begin_trade<T>(
    vault: &mut Vault<T>,
    verified: VerifiedAction,
    amount_in: u64,
    expected_digest: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): (TradeTicket, Coin<T>) {
    assert!(!vault.paused, EPaused);
    let (agent_addr, action_digest, _nonce) = attestation_verifier::consume(verified);
    assert!(vault.agent_addr == agent_addr, EAgentMismatch);
    assert!(action_digest == expected_digest, EDigestMismatch);

    roll_day(&mut vault.risk, clock.timestamp_ms());
    assert!(amount_in <= vault.config.max_single_move, EExceedsMoveCap);
    assert!(balance::value(&vault.idle) >= amount_in, EInsufficientIdle);

    let coin = coin::take(&mut vault.idle, amount_in, ctx);
    let ticket = TradeTicket {
        vault_id: object::id(vault),
        amount_in,
        action_digest,
    };
    (ticket, coin)
}

/// Step 2. Deposit the round-trip proceeds, settle realized PnL through the same
/// daily-loss circuit breaker as collections, and append the audit entry.
public fun settle_trade<T>(
    vault: &mut Vault<T>,
    ticket: TradeTicket,
    proceeds: Coin<T>,
    walrus_blob_id: u256,
    clock: &Clock,
) {
    let TradeTicket { vault_id, amount_in, action_digest } = ticket;
    assert!(object::id(vault) == vault_id, EVaultMismatch);

    let proceeds_val = proceeds.value();
    coin::put(&mut vault.idle, proceeds);

    let now = clock.timestamp_ms();
    roll_day(&mut vault.risk, now);

    let is_loss = proceeds_val < amount_in;
    let realized_pnl = if (is_loss) { amount_in - proceeds_val } else { proceeds_val - amount_in };
    if (is_loss) {
        vault.risk.realized_loss_today = vault.risk.realized_loss_today + realized_pnl;
        if (vault.risk.realized_loss_today > vault.config.daily_loss_limit && !vault.paused) {
            vault.paused = true;
            event::emit(CircuitBreakerTripped {
                vault_id,
                realized_loss_today: vault.risk.realized_loss_today,
                daily_loss_limit: vault.config.daily_loss_limit,
            });
            event::emit(PausedChanged { vault_id, paused: true });
        }
    };

    let total_assets = balance::value(&vault.idle) + vault.total_deployed;
    if (total_assets > vault.risk.high_watermark) {
        vault.risk.high_watermark = total_assets;
    };

    audit_log::append(&mut vault.audit, vault.agent_addr, action_digest, walrus_blob_id, clock);
    event::emit(Traded { vault_id, amount_in, proceeds: proceeds_val, realized_pnl, is_loss });
}

// === Internal ===

fun roll_day(risk: &mut RiskState, now: u64) {
    if (now >= risk.day_start_ms + DAY_MS) {
        risk.day_start_ms = now;
        risk.realized_loss_today = 0;
    }
}

// === Views ===

public fun owner<T>(v: &Vault<T>): address { v.owner }
public fun agent_addr<T>(v: &Vault<T>): address { v.agent_addr }
public fun idle_value<T>(v: &Vault<T>): u64 { balance::value(&v.idle) }
public fun total_deployed<T>(v: &Vault<T>): u64 { v.total_deployed }
public fun total_assets<T>(v: &Vault<T>): u64 { balance::value(&v.idle) + v.total_deployed }
public fun is_paused<T>(v: &Vault<T>): bool { v.paused }
public fun realized_loss_today<T>(v: &Vault<T>): u64 { v.risk.realized_loss_today }

public fun allocation_principal<T>(v: &Vault<T>, protocol_id: vector<u8>): u64 {
    if (v.allocations.contains(protocol_id)) {
        v.allocations.borrow(protocol_id).principal
    } else { 0 }
}
