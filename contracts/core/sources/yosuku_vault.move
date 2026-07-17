/// yosuku_vault — a non-custodial, attested strategy vault on DeepBook Predict.
///
/// The "agent-EOA-owns-the-manager, vault-custodies-the-value" model (see
/// YOSUKU_NAUTILUS_PORT.md). The vault is a shared object holding the DUSDC float
/// and minting fungible `Coin<BELL_SHARE>`. The attested Bellkeeper agent can
/// open Predict legs ONLY through `begin_predict_action`, which:
///   1. verifies the enclave's ed25519 signature (a VerifiedAction hot-potato),
///   2. re-checks the agent identity + per-strategy caps ON-CHAIN (never trusts
///      the enclave verdict), with replay + oracle-allowlist guards,
///   3. re-derives the signed digest from the on-chain params (binds the
///      signature to this exact oracle/strike/side/qty), and
///   4. funds the EXACT mint_cost just-in-time from the float, so a stolen agent
///      key can mis-spend at most one in-flight trade — never the reserve.
/// The actual `predict::mint` happens in the same EOA-signed PTB (the vault is
/// never the caller). Settlement is async: legs close hours later via book_payout.
module suioverflow::yosuku_vault;

use std::hash;
use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin, TreasuryCap},
    clock::Clock,
    event,
    table::{Self, Table},
};
use suioverflow::{
    attestation_verifier::{Self, VerifiedAction},
    audit_log::{Self, AuditLog},
    bell_share::BELL_SHARE,
};

// === Constants ===
const BPS_DENOM: u128 = 10_000;
const DAY_MS: u64 = 86_400_000;
const KIND_PREDICT: u8 = 3;

// === Errors ===
const ENotAdmin: u64 = 1;
const EAgentMismatch: u64 = 2;
const EDigestMismatch: u64 = 3;
const EDigestBind: u64 = 4;
const EReplay: u64 = 5;
const EOracleNotAllowed: u64 = 6;
const EPaused: u64 = 7;
const EExceedsMoveCap: u64 = 8;
const EExceedsProtocolCap: u64 = 9;
const EInsufficientIdle: u64 = 10;
const EVaultMismatch: u64 = 11;
const EUnknownLeg: u64 = 12;
const EBadConfig: u64 = 13;
const EZero: u64 = 14;

// === Types ===

/// Owner-set safety limits. The agent can never widen these.
public struct VaultConfig has store {
    per_protocol_cap_bps: u64,
    max_single_move: u64,
    daily_loss_limit: u64,
}

public struct RiskState has store {
    day_start_ms: u64,
    realized_loss_today: u64,
    high_watermark: u64,
}

/// Ledger key for an open Predict leg (our own; not the Predict MarketKey type).
public struct LegKey has copy, drop, store {
    oracle_id: ID,
    expiry: u64,
    strike: u64,
    side: u8, // 0=UP, 1=DOWN
}

public struct Leg has store {
    qty: u64,
    cost_basis: u64,
    opened_at_ms: u64,
}

public struct Vault<phantom T> has key {
    id: UID,
    /// Vault owner — sets config, pauses, and is the always-available backstop.
    admin: address,
    /// The attested Bellkeeper agent identity (must match a registered agent).
    agent_addr: address,
    /// The float — only vault entry functions move it.
    idle: Balance<T>,
    /// Mints/burns the fungible vault share.
    shares: TreasuryCap<BELL_SHARE>,
    /// Σ cost_basis of all open legs (conservative MTM proxy for NAV v1).
    total_open_cost: u64,
    liabilities: Table<LegKey, Leg>,
    /// Signed-nonce replay guard (verify only checks freshness, not used-nonces).
    consumed_nonces: Table<u64, bool>,
    /// Which oracles the agent is allowed to trade (defense in depth).
    oracle_allowlist: Table<ID, bool>,
    config: VaultConfig,
    risk: RiskState,
    audit: AuditLog,
    paused: bool,
}

/// Hot-potato. No abilities → the open PTB must fund-and-confirm in-place.
public struct PredictTicket {
    vault_id: ID,
    leg: LegKey,
    qty: u64,
    cost: u64,
    action_digest: vector<u8>,
}

// === Events ===
public struct VaultOpened has copy, drop { vault_id: ID, admin: address, agent_addr: address }
public struct Deposited has copy, drop { vault_id: ID, amount: u64, shares: u64 }
public struct Redeemed has copy, drop { vault_id: ID, shares: u64, amount: u64 }
public struct LegOpened has copy, drop { vault_id: ID, oracle_id: ID, strike: u64, side: u8, qty: u64, cost: u64 }
public struct LegSettled has copy, drop { vault_id: ID, oracle_id: ID, strike: u64, side: u8, proceeds: u64, cost_basis: u64, is_loss: bool }
public struct PausedChanged has copy, drop { vault_id: ID, paused: bool }
public struct CircuitBreakerTripped has copy, drop { vault_id: ID, realized_loss_today: u64, daily_loss_limit: u64 }

// === Owner lifecycle ===

public fun open<T>(
    shares: TreasuryCap<BELL_SHARE>,
    agent_addr: address,
    per_protocol_cap_bps: u64,
    max_single_move: u64,
    daily_loss_limit: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Vault<T> {
    assert!(per_protocol_cap_bps > 0 && (per_protocol_cap_bps as u128) <= BPS_DENOM, EBadConfig);
    let v = Vault<T> {
        id: object::new(ctx),
        admin: ctx.sender(),
        agent_addr,
        idle: balance::zero<T>(),
        shares,
        total_open_cost: 0,
        liabilities: table::new(ctx),
        consumed_nonces: table::new(ctx),
        oracle_allowlist: table::new(ctx),
        config: VaultConfig { per_protocol_cap_bps, max_single_move, daily_loss_limit },
        risk: RiskState { day_start_ms: clock.timestamp_ms(), realized_loss_today: 0, high_watermark: 0 },
        audit: audit_log::new(agent_addr, ctx),
        paused: false,
    };
    event::emit(VaultOpened { vault_id: object::id(&v), admin: v.admin, agent_addr });
    v
}

public fun share<T>(v: Vault<T>) { transfer::share_object(v) }

/// Conservative NAV = idle float + Σ open-leg cost basis (v1; real MTM via the
/// off-chain engine / get_trade_amounts is the enhancement, see R6).
public fun nav<T>(v: &Vault<T>): u64 {
    balance::value(&v.idle) + v.total_open_cost
}

/// Deposit DUSDC, receive NAV-priced BELL_SHARE. Rounding favors the vault (R9).
public fun deposit<T>(v: &mut Vault<T>, coin: Coin<T>, ctx: &mut TxContext): Coin<BELL_SHARE> {
    let amount = coin.value();
    assert!(amount > 0, EZero);
    let supply = coin::total_supply(&v.shares);
    let nav_before = nav(v);
    let to_mint = if (supply == 0 || nav_before == 0) {
        amount
    } else {
        mul_div(amount, supply, nav_before)
    };
    coin::put(&mut v.idle, coin);
    event::emit(Deposited { vault_id: object::id(v), amount, shares: to_mint });
    coin::mint(&mut v.shares, to_mint, ctx)
}

/// Burn BELL_SHARE for a pro-rata slice of NAV, paid from idle (open legs locked
/// until they settle). Withdrawable always — independent of the agent.
public fun redeem<T>(v: &mut Vault<T>, shares: Coin<BELL_SHARE>, ctx: &mut TxContext): Coin<T> {
    let s = shares.value();
    assert!(s > 0, EZero);
    let supply = coin::total_supply(&v.shares);
    let payout = mul_div(s, nav(v), supply);
    assert!(balance::value(&v.idle) >= payout, EInsufficientIdle);
    coin::burn(&mut v.shares, shares);
    event::emit(Redeemed { vault_id: object::id(v), shares: s, amount: payout });
    coin::take(&mut v.idle, payout, ctx)
}

// === Agent flow: open a Predict leg (async) ===

/// Step 1. Attestation gate + on-chain re-checks + just-in-time exact funding.
/// Returns a ticket the PTB must confirm and the EXACT-cost coin to deposit into
/// the agent-owned PredictManager before calling predict::mint. The value binding
/// (exact cost) + the digest binding (re-derived below) pin the trade.
public fun begin_predict_action<T>(
    v: &mut Vault<T>,
    verified: VerifiedAction,
    oracle_id: ID,
    expiry: u64,
    strike: u64,
    side: u8,
    qty: u64,
    cost: u64,
    expected_digest: vector<u8>,
    issued_at_ms: u64,
    inputs_hash: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): (PredictTicket, Coin<T>) {
    assert!(!v.paused, EPaused);

    let (a_addr, a_digest, a_nonce) = attestation_verifier::consume(verified);
    assert!(v.agent_addr == a_addr, EAgentMismatch);
    assert!(a_digest == expected_digest, EDigestMismatch);

    // Replay guard — verify only checks freshness, not used-nonces.
    assert!(!v.consumed_nonces.contains(a_nonce), EReplay);
    v.consumed_nonces.add(a_nonce, true);

    // Oracle allowlist (defense in depth).
    assert!(v.oracle_allowlist.contains(oracle_id) && *v.oracle_allowlist.borrow(oracle_id), EOracleNotAllowed);

    // Bind the signature to THESE exact params (approved=1), using the verified nonce.
    let derived = predict_action_digest(
        object::id(v), oracle_id, strike, expiry, qty, side, 1, a_nonce, issued_at_ms, inputs_hash,
    );
    assert!(derived == a_digest, EDigestBind);

    roll_day(&mut v.risk, clock.timestamp_ms());

    // Caps re-checked on-chain regardless of the enclave verdict.
    assert!(cost <= v.config.max_single_move, EExceedsMoveCap);
    let cap = ((nav(v) as u128) * (v.config.per_protocol_cap_bps as u128) / BPS_DENOM) as u64;
    assert!(cost <= cap, EExceedsProtocolCap);
    assert!(balance::value(&v.idle) >= cost, EInsufficientIdle);

    let coin = coin::take(&mut v.idle, cost, ctx);
    let leg = LegKey { oracle_id, expiry, strike, side };
    (PredictTicket { vault_id: object::id(v), leg, qty, cost, action_digest: a_digest }, coin)
}

/// Step 2. Record the open liability + audit entry. No Coin<T> demanded back —
/// the structural fix vs a synchronous settle (Predict mint returns nothing and
/// settles hours later).
public fun confirm_predict_action<T>(
    v: &mut Vault<T>,
    ticket: PredictTicket,
    walrus_blob_id: u256,
    clock: &Clock,
) {
    let PredictTicket { vault_id, leg, qty, cost, action_digest } = ticket;
    assert!(object::id(v) == vault_id, EVaultMismatch);

    if (v.liabilities.contains(leg)) {
        let l = v.liabilities.borrow_mut(leg);
        l.qty = l.qty + qty;
        l.cost_basis = l.cost_basis + cost;
    } else {
        v.liabilities.add(leg, Leg { qty, cost_basis: cost, opened_at_ms: clock.timestamp_ms() });
    };
    v.total_open_cost = v.total_open_cost + cost;

    audit_log::append(&mut v.audit, v.agent_addr, action_digest, walrus_blob_id, clock);
    event::emit(LegOpened {
        vault_id,
        oracle_id: leg.oracle_id,
        strike: leg.strike,
        side: leg.side,
        qty,
        cost,
    });
}

/// Close a settled leg: deposit the redeemed proceeds back into the float, book
/// realized PnL, and run the daily-loss circuit breaker. Full-close (whole leg).
/// Proceeds come from `predict_manager::withdraw` (after redeem_permissionless).
public fun book_payout<T>(
    v: &mut Vault<T>,
    proceeds: Coin<T>,
    clock: &Clock,
    oracle_id: ID,
    expiry: u64,
    strike: u64,
    side: u8,
    walrus_blob_id: u256,
) {
    let leg = LegKey { oracle_id, expiry, strike, side };
    assert!(v.liabilities.contains(leg), EUnknownLeg);
    let Leg { cost_basis, .. } = v.liabilities.remove(leg);
    v.total_open_cost = v.total_open_cost - cost_basis;

    let proceeds_val = proceeds.value();
    coin::put(&mut v.idle, proceeds);

    roll_day(&mut v.risk, clock.timestamp_ms());
    let is_loss = proceeds_val < cost_basis;
    if (is_loss) {
        let loss = cost_basis - proceeds_val;
        v.risk.realized_loss_today = v.risk.realized_loss_today + loss;
        if (v.risk.realized_loss_today > v.config.daily_loss_limit && !v.paused) {
            v.paused = true;
            event::emit(CircuitBreakerTripped {
                vault_id: object::id(v),
                realized_loss_today: v.risk.realized_loss_today,
                daily_loss_limit: v.config.daily_loss_limit,
            });
            event::emit(PausedChanged { vault_id: object::id(v), paused: true });
        }
    };
    let total = nav(v);
    if (total > v.risk.high_watermark) v.risk.high_watermark = total;

    audit_log::append(&mut v.audit, v.agent_addr, b"settle", walrus_blob_id, clock);
    event::emit(LegSettled { vault_id: object::id(v), oracle_id, strike, side, proceeds: proceeds_val, cost_basis, is_loss });
}

// === Admin ===

public fun set_oracle_allowed<T>(v: &mut Vault<T>, oracle_id: ID, allowed: bool, ctx: &TxContext) {
    assert_admin(v, ctx);
    if (v.oracle_allowlist.contains(oracle_id)) {
        *v.oracle_allowlist.borrow_mut(oracle_id) = allowed;
    } else {
        v.oracle_allowlist.add(oracle_id, allowed);
    };
}

public fun set_config<T>(v: &mut Vault<T>, cap_bps: u64, max_move: u64, daily_loss: u64, ctx: &TxContext) {
    assert_admin(v, ctx);
    assert!(cap_bps > 0 && (cap_bps as u128) <= BPS_DENOM, EBadConfig);
    v.config.per_protocol_cap_bps = cap_bps;
    v.config.max_single_move = max_move;
    v.config.daily_loss_limit = daily_loss;
}

public fun emergency_pause<T>(v: &mut Vault<T>, ctx: &TxContext) {
    assert_admin(v, ctx);
    v.paused = true;
    event::emit(PausedChanged { vault_id: object::id(v), paused: true });
}

public fun unpause<T>(v: &mut Vault<T>, ctx: &TxContext) {
    assert_admin(v, ctx);
    v.paused = false;
    event::emit(PausedChanged { vault_id: object::id(v), paused: false });
}

// === Internal ===

fun assert_admin<T>(v: &Vault<T>, ctx: &TxContext) {
    assert!(ctx.sender() == v.admin, ENotAdmin);
}

fun roll_day(risk: &mut RiskState, now: u64) {
    if (now >= risk.day_start_ms + DAY_MS) {
        risk.day_start_ms = now;
        risk.realized_loss_today = 0;
    }
}

fun mul_div(a: u64, b: u64, c: u64): u64 {
    (((a as u128) * (b as u128)) / (c as u128)) as u64
}

/// Re-derive the canonical Predict digest from on-chain params. MUST be
/// byte-identical to enclave/src/main.rs::action_digest (kind=3) + digest.ts.
fun predict_action_digest(
    vault_id: ID,
    oracle_id: ID,
    strike: u64,
    expiry: u64,
    qty: u64,
    side: u8,
    approved: u8,
    nonce: u64,
    issued_at_ms: u64,
    inputs_hash: vector<u8>,
): vector<u8> {
    let mut pre = b"suioverflow:decision:v1";
    vector::append(&mut pre, object::id_to_bytes(&vault_id));
    pre.push_back(KIND_PREDICT);
    vector::append(&mut pre, object::id_to_bytes(&oracle_id));
    vector::append(&mut pre, u64_be_bytes(strike));
    vector::append(&mut pre, u64_be_bytes(expiry));
    vector::append(&mut pre, u64_be_bytes(qty));
    pre.push_back(side);
    pre.push_back(approved);
    vector::append(&mut pre, u64_be_bytes(nonce));
    vector::append(&mut pre, u64_be_bytes(issued_at_ms));
    vector::append(&mut pre, inputs_hash);
    hash::sha2_256(pre)
}

/// MSB-first u64 — `bcs::to_bytes` emits LITTLE-endian; do NOT use it here.
fun u64_be_bytes(x: u64): vector<u8> {
    let mut out = vector[];
    let mut i = 8u64;
    while (i > 0) {
        i = i - 1;
        out.push_back((((x >> (8 * (i as u8))) & 0xff) as u8));
    };
    out
}

// === Views ===
public fun idle_value<T>(v: &Vault<T>): u64 { balance::value(&v.idle) }
public fun total_open_cost<T>(v: &Vault<T>): u64 { v.total_open_cost }
public fun is_paused<T>(v: &Vault<T>): bool { v.paused }
public fun realized_loss_today<T>(v: &Vault<T>): u64 { v.risk.realized_loss_today }
public fun share_supply<T>(v: &Vault<T>): u64 { coin::total_supply(&v.shares) }
public fun leg_qty<T>(v: &Vault<T>, oracle_id: ID, expiry: u64, strike: u64, side: u8): u64 {
    let k = LegKey { oracle_id, expiry, strike, side };
    if (v.liabilities.contains(k)) v.liabilities.borrow(k).qty else 0
}

#[test_only]
public fun predict_digest_for_testing(
    vault_id: ID, oracle_id: ID, strike: u64, expiry: u64, qty: u64, side: u8,
    approved: u8, nonce: u64, issued_at_ms: u64, inputs_hash: vector<u8>,
): vector<u8> {
    predict_action_digest(vault_id, oracle_id, strike, expiry, qty, side, approved, nonce, issued_at_ms, inputs_hash)
}
