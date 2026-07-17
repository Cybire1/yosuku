/// The Agent Strategy Exchange — prediction-market agents as investable, verifiable strategies.
///
/// A creator publishes a `Strategy`: a Seal-encrypted playbook capsule on Walrus, a pointer to
/// the agent's MemWal memory (the portable alpha — *why* it traded), the hard risk caps its
/// executing agent is bound to, and a subscription fee. Subscribers pay the fee and authorize
/// the strategy's agent to **copy-trade their own vault funds** (via `social_vault`), under those
/// caps — and the no-divert guarantee means the creator's agent can never divert a subscriber's
/// money: every position it opens is owned by the subscriber and force-pays them on exit.
///
/// Performance is computed off-chain from the on-chain trade history (verified PnL, drawdown,
/// liquidations, time-live) — not screenshots. Rank by risk-adjusted return, never win-rate alone.
///
/// Invariant: memory *influences* what the agent proposes; this contract *enforces* what it may do
/// (caps + no-divert + owner-gated withdrawals). Memory never touches fund authority.
module yolev::strategy;

use sui::{
    coin::{Self, Coin},
    event,
};
use yolev::social_vault::{Self, Vault};

const EUnderpaid: u64 = 1;
const EBadCaps: u64 = 2;
const ENotCreator: u64 = 3;

/// A published, investable strategy for quote asset `T`. Shared.
public struct Strategy<phantom T> has key {
    id: UID,
    creator: address,
    /// the creator's executing agent — opens positions for subscribers, bounded by the caps below.
    agent: address,
    /// Seal-encrypted playbook blob id on Walrus (0 = none yet).
    capsule_blob: u256,
    /// the creator's MemWal memory account address (Seal-gated read; @0x0 = none).
    memory_account: address,
    /// hard risk caps every subscriber inherits — the agent cannot exceed these on a subscriber's funds.
    max_leverage_bps: u64,
    max_margin: u64,
    /// flat subscription fee (in `T`) paid to the creator on subscribe.
    sub_fee: u64,
    subscribers: u64,
    /// off-chain-updatable display title hash / version marker (free-form).
    revision: u64,
}

/// Creator's control handle for their strategy.
public struct StrategyCap has key, store { id: UID, strategy: ID }

public struct StrategyListed has copy, drop { strategy: ID, creator: address, agent: address, sub_fee: u64, max_leverage_bps: u64, max_margin: u64, capsule_blob: u256 }
public struct StrategyUpdated has copy, drop { strategy: ID, capsule_blob: u256, sub_fee: u64, revision: u64 }
public struct StrategySubscribed has copy, drop { strategy: ID, subscriber: address, fee_paid: u64, subscribers: u64 }

/// Publish a strategy. Returns the creator's `StrategyCap`. Caps must be sane (leverage ≥ 1x,
/// positive max margin) so a subscriber always knows the worst case before subscribing.
public fun list_strategy<T>(
    agent: address,
    capsule_blob: u256,
    memory_account: address,
    max_leverage_bps: u64,
    max_margin: u64,
    sub_fee: u64,
    ctx: &mut TxContext,
): StrategyCap {
    assert!(max_leverage_bps >= 10_000 && max_margin > 0, EBadCaps);
    let s = Strategy<T> {
        id: object::new(ctx),
        creator: ctx.sender(),
        agent,
        capsule_blob,
        memory_account,
        max_leverage_bps,
        max_margin,
        sub_fee,
        subscribers: 0,
        revision: 0,
    };
    let sid = object::id(&s);
    event::emit(StrategyListed { strategy: sid, creator: ctx.sender(), agent, sub_fee, max_leverage_bps, max_margin, capsule_blob });
    transfer::share_object(s);
    StrategyCap { id: object::new(ctx), strategy: sid }
}

/// Creator: update the capsule blob / fee (e.g. ship a new playbook revision). Cap-gated.
public fun update_strategy<T>(s: &mut Strategy<T>, cap: &StrategyCap, capsule_blob: u256, sub_fee: u64, _ctx: &mut TxContext) {
    assert!(cap.strategy == object::id(s), ENotCreator);
    s.capsule_blob = capsule_blob;
    s.sub_fee = sub_fee;
    s.revision = s.revision + 1;
    event::emit(StrategyUpdated { strategy: object::id(s), capsule_blob, sub_fee, revision: s.revision });
}

/// Subscriber: pay the creator's fee and authorize the strategy's agent to copy-trade your vault
/// within the strategy's caps. `ctx.sender()` (the subscriber) signs, so the resulting
/// `social_vault::Subscription` records THEM as subscriber (consent). The creator earns the fee;
/// the agent can still only open subscriber-owned positions — copy-trading without custody risk.
///
/// ⚠️ VERSION SKEW: this revision RETURNS the refund `Coin<T>` (validated by `strategy_tests`).
/// The CURRENTLY DEPLOYED package `0x47d3c108…` is an OLDER build whose `subscribe` returns NOTHING.
/// So the live sui-predict client (`lib/sui/strategyClient.ts` → `buildFundAndSubscribeTx`) splits
/// exactly the fee and does NOT capture a return. To converge: redeploy from this source, then
/// restore the client's `transferObjects([refund], owner)`. Until then, deployed = no-return is law.
public fun subscribe<T>(s: &mut Strategy<T>, v: &Vault<T>, mut payment: Coin<T>, ctx: &mut TxContext): Coin<T> {
    assert!(payment.value() >= s.sub_fee, EUnderpaid);
    // pay the creator exactly the fee; refund any remainder to the subscriber.
    let fee = payment.split(s.sub_fee, ctx);
    transfer::public_transfer(fee, s.creator);
    // authorize the strategy's agent on the subscriber's own vault, under the strategy's caps.
    social_vault::create_subscription(v, object::id(s), s.agent, s.max_leverage_bps, s.max_margin, ctx);
    s.subscribers = s.subscribers + 1;
    event::emit(StrategySubscribed { strategy: object::id(s), subscriber: ctx.sender(), fee_paid: s.sub_fee, subscribers: s.subscribers });
    payment
}

// ─── views ───
public fun creator<T>(s: &Strategy<T>): address { s.creator }
public fun agent<T>(s: &Strategy<T>): address { s.agent }
public fun capsule_blob<T>(s: &Strategy<T>): u256 { s.capsule_blob }
public fun memory_account<T>(s: &Strategy<T>): address { s.memory_account }
public fun max_leverage_bps<T>(s: &Strategy<T>): u64 { s.max_leverage_bps }
public fun max_margin<T>(s: &Strategy<T>): u64 { s.max_margin }
public fun sub_fee<T>(s: &Strategy<T>): u64 { s.sub_fee }
public fun subscribers<T>(s: &Strategy<T>): u64 { s.subscribers }
