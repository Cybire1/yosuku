// Copyright (c) Yosuku
// SPDX-License-Identifier: Apache-2.0

/// Production multi-user delegated-agent vault on the predict-testnet-6-24
/// `account` + `predict` packages — the shared successor of the old
/// social_vault, generalizing `spike_vault` to many users.
///
/// One shared `Vault624` owns ONE object-owned canonical account
/// (`account_registry::new_self_owned` keyed to the vault's UID). The vault's
/// UID is the only source of `Auth` for that account
/// (`account::generate_auth_as_object`), so custody policy is exactly this
/// module's API surface:
/// - per-user DUSDC accounting lives in `ledger` (6dp micro units);
/// - a user `subscribe`s ONE agent with hard per-trade caps (margin +
///   leverage); `cancel` deactivates the subscription;
/// - the subscribed agent can `agent_mint_for` the user, debited at the EXACT
///   account-balance-delta cost, capped by the user's subscription — and has
///   NO funds-out path;
/// - `crank_settle` is permissionless: settled payouts force-land back in the
///   position owner's ledger entry;
/// - `withdraw` pays `ctx.sender()` only, gated by their own ledger balance.
module yosuku_spike::vault624;

use account::{account::{Self, AccountWrapper}, account_registry::AccountRegistry};
use deepbook_predict::{
    expiry_market::ExpiryMarket,
    pricing::Pricer,
    protocol_config::ProtocolConfig
};
use dusdc::dusdc::DUSDC;
use propbook::{pyth_feed::PythFeed, registry::OracleRegistry};
use sui::{
    accumulator::AccumulatorRoot,
    clock::Clock,
    coin::Coin,
    event,
    table::{Self, Table}
};

// === Errors ===
const ENoSub: u64 = 0;
const ENotAgent: u64 = 1;
const EOverLeverageCap: u64 = 2;
const EOverMarginCap: u64 = 3;
const EInsufficientBalance: u64 = 4;
const ECostExceeded: u64 = 5;
const EUnknownPosition: u64 = 6;

// === Structs ===
/// Shared vault: the object owner of its canonical account. All user funds
/// pool in that one account; `ledger` is the per-user claim on it.
public struct Vault624 has key {
    id: UID,
    /// Per-user DUSDC balance (6dp micro units) inside the vault account.
    ledger: Table<address, u64>,
    /// Per-user agent subscription, keyed by the USER address.
    subs: Table<address, Sub>,
    /// Open agent-minted positions, keyed by packed Predict order id.
    positions: Table<u256, Pos>,
}

/// One user's delegation terms. `max_margin` caps the all-in DUSDC cost of a
/// single trade; `max_leverage_bps_1e9` caps leverage, 1e9-scaled (1e9 = 1x).
public struct Sub has drop, store {
    agent: address,
    max_margin: u64,
    max_leverage_bps_1e9: u64,
    active: bool,
}

/// Open position bookkeeping: who owns the payout and the full-close quantity.
public struct Pos has drop, store {
    user: address,
    qty: u64,
}

// === Events ===
public struct Deposited has copy, drop {
    user: address,
    amount: u64,
}

public struct Withdrawn has copy, drop {
    user: address,
    amount: u64,
}

public struct Subscribed has copy, drop {
    user: address,
    agent: address,
    max_margin: u64,
    max_leverage: u64,
}

public struct Unsubscribed has copy, drop {
    user: address,
}

public struct AgentTraded has copy, drop {
    user: address,
    agent: address,
    order_id: u256,
    cost: u64,
    quantity: u64,
    leverage: u64,
    market: ID,
}

public struct Settled has copy, drop {
    user: address,
    order_id: u256,
    payout: u64,
}

// === Public Functions ===
/// Create the vault and its object-owned canonical account, then share both.
/// The account's owner is the vault UID's address, so only auth generated from
/// `&mut vault.id` (i.e. this module) can open it mutably.
public fun new(registry: &mut AccountRegistry, ctx: &mut TxContext) {
    let mut vault = Vault624 {
        id: object::new(ctx),
        ledger: table::new(ctx),
        subs: table::new(ctx),
        positions: table::new(ctx),
    };
    let wrapper = registry.new_self_owned(&mut vault.id, ctx);
    wrapper.share();
    transfer::share_object(vault);
}

/// Return `user`'s DUSDC ledger balance (0 if the user never deposited).
public fun ledger_of(vault: &Vault624, user: address): u64 {
    if (vault.ledger.contains(user)) vault.ledger[user] else 0
}

/// Return `user`'s subscription as `(agent, max_margin, max_leverage, active)`.
/// Aborts with `ENoSub` if the user never subscribed.
public fun sub_of(vault: &Vault624, user: address): (address, u64, u64, bool) {
    assert!(vault.subs.contains(user), ENoSub);
    let sub = &vault.subs[user];
    (sub.agent, sub.max_margin, sub.max_leverage_bps_1e9, sub.active)
}

/// Return the user who owns open position `order_id`. Aborts with
/// `EUnknownPosition` if the vault does not track that order.
public fun position_user(vault: &Vault624, order_id: u256): address {
    assert!(vault.positions.contains(order_id), EUnknownPosition);
    vault.positions[order_id].user
}

/// Deposit DUSDC into the vault account, credited to the sender's ledger
/// entry. Passing a wrapper that does not belong to this vault aborts in
/// `account` with `EInvalidOwner`.
public fun deposit(
    vault: &mut Vault624,
    wrapper: &mut AccountWrapper,
    coin: Coin<DUSDC>,
    root: &AccumulatorRoot,
    clock: &Clock,
    ctx: &TxContext,
) {
    let user = ctx.sender();
    let amount = coin.value();
    let auth = account::generate_auth_as_object(&mut vault.id);
    wrapper.deposit_funds(auth, coin, root, clock);
    vault.credit(user, amount);
    event::emit(Deposited { user, amount });
}

/// Withdraw `amount` DUSDC from the sender's ledger entry; the coin is
/// transferred to the sender unconditionally. The ledger itself is the owner
/// gate: nobody can pull more than their own entry, and the agent has no entry
/// to pull.
public fun withdraw(
    vault: &mut Vault624,
    wrapper: &mut AccountWrapper,
    amount: u64,
    root: &AccumulatorRoot,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let user = ctx.sender();
    vault.debit(user, amount);
    let auth = account::generate_auth_as_object(&mut vault.id);
    let coin = wrapper.withdraw_funds<DUSDC>(auth, amount, root, clock, ctx);
    transfer::public_transfer(coin, user);
    event::emit(Withdrawn { user, amount });
}

/// Subscribe the sender to `agent` with per-trade caps: `max_margin` bounds a
/// single trade's all-in DUSDC cost, `max_leverage` is 1e9-scaled (1e9 = 1x).
/// Upserts: re-subscribing replaces the previous terms and reactivates.
public fun subscribe(
    vault: &mut Vault624,
    agent: address,
    max_margin: u64,
    max_leverage: u64,
    ctx: &TxContext,
) {
    let user = ctx.sender();
    let sub = Sub {
        agent,
        max_margin,
        max_leverage_bps_1e9: max_leverage,
        active: true,
    };
    if (vault.subs.contains(user)) {
        *(&mut vault.subs[user]) = sub;
    } else {
        vault.subs.add(user, sub);
    };
    event::emit(Subscribed { user, agent, max_margin, max_leverage });
}

/// Deactivate the sender's subscription (terms are kept for a later
/// re-subscribe). Aborts with `ENoSub` if the sender never subscribed.
public fun cancel(vault: &mut Vault624, ctx: &TxContext) {
    let user = ctx.sender();
    assert!(vault.subs.contains(user), ENoSub);
    (&mut vault.subs[user]).active = false;
    event::emit(Unsubscribed { user });
}

/// Agent-only, cap-bound Predict mint on behalf of `user`. The sender must be
/// `user`'s active subscribed agent, `leverage`/`max_cost` must sit inside the
/// subscription caps, and the user's ledger must cover `max_cost`. The user is
/// debited the EXACT all-in cost, measured as the vault account's DUSDC
/// balance delta around `mint_exact_quantity` (which also enforces
/// `cost <= max_cost` internally; the post-assert here is defense in depth).
/// Returns the packed order id, which this vault tracks until `crank_settle`.
public fun agent_mint_for(
    vault: &mut Vault624,
    wrapper: &mut AccountWrapper,
    user: address,
    market: &mut ExpiryMarket,
    config: &ProtocolConfig,
    pricer: &Pricer,
    lower_tick: u64,
    higher_tick: u64,
    quantity: u64,
    leverage: u64,
    max_cost: u64,
    max_probability: u64,
    root: &AccumulatorRoot,
    clock: &Clock,
    ctx: &mut TxContext,
): u256 {
    let agent = ctx.sender();
    vault.assert_agent_trade(user, agent, leverage, max_cost);

    let balance_before = wrapper.load_account().balance<DUSDC>(root, clock);
    let auth = account::generate_auth_as_object(&mut vault.id);
    let order_id = market.mint_exact_quantity(
        wrapper,
        auth,
        config,
        pricer,
        lower_tick,
        higher_tick,
        quantity,
        leverage,
        max_cost,
        max_probability,
        root,
        clock,
        ctx,
    );
    let cost = balance_before - wrapper.load_account().balance<DUSDC>(root, clock);
    assert!(cost <= max_cost, ECostExceeded);
    vault.debit(user, cost);
    vault.positions.add(order_id, Pos { user, qty: quantity });
    event::emit(AgentTraded {
        user,
        agent,
        order_id,
        cost,
        quantity,
        leverage,
        market: market.id(),
    });
    order_id
}

/// PERMISSIONLESS settle crank: full-close a settled vault position via
/// `redeem_settled` (needs no vault `Auth` — predict app-auths itself) and
/// credit the payout, measured as the vault account's DUSDC balance delta,
/// back to the position owner's ledger entry. Anyone can crank; the payout
/// can only land on the recorded owner.
public fun crank_settle(
    vault: &mut Vault624,
    wrapper: &mut AccountWrapper,
    account_registry: &AccountRegistry,
    market: &mut ExpiryMarket,
    config: &ProtocolConfig,
    oracle_registry: &OracleRegistry,
    pyth: &PythFeed,
    order_id: u256,
    root: &AccumulatorRoot,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(vault.positions.contains(order_id), EUnknownPosition);
    let Pos { user, qty } = vault.positions.remove(order_id);

    let balance_before = wrapper.load_account().balance<DUSDC>(root, clock);
    let (_closed, _replacement) = market.redeem_settled(
        account_registry,
        wrapper,
        config,
        oracle_registry,
        pyth,
        order_id,
        qty,
        root,
        clock,
        ctx,
    );
    let payout = wrapper.load_account().balance<DUSDC>(root, clock) - balance_before;
    vault.credit(user, payout);
    event::emit(Settled { user, order_id, payout });
}

// === Private Functions ===
/// The agent-trade policy gate: subscription exists and is active, the caller
/// is the subscribed agent, both caps hold, and the user's ledger covers the
/// trade's cost bound.
fun assert_agent_trade(
    vault: &Vault624,
    user: address,
    agent: address,
    leverage: u64,
    max_cost: u64,
) {
    assert!(vault.subs.contains(user), ENoSub);
    let sub = &vault.subs[user];
    assert!(sub.active, ENoSub);
    assert!(agent == sub.agent, ENotAgent);
    assert!(leverage <= sub.max_leverage_bps_1e9, EOverLeverageCap);
    assert!(max_cost <= sub.max_margin, EOverMarginCap);
    assert!(vault.ledger_of(user) >= max_cost, EInsufficientBalance);
}

fun credit(vault: &mut Vault624, user: address, amount: u64) {
    if (vault.ledger.contains(user)) {
        let balance = &mut vault.ledger[user];
        *balance = *balance + amount;
    } else {
        vault.ledger.add(user, amount);
    }
}

fun debit(vault: &mut Vault624, user: address, amount: u64) {
    assert!(
        vault.ledger.contains(user) && vault.ledger[user] >= amount,
        EInsufficientBalance,
    );
    let balance = &mut vault.ledger[user];
    *balance = *balance - amount;
}

// === Test-only Functions ===
#[test_only]
public fun new_for_testing(ctx: &mut TxContext): Vault624 {
    Vault624 {
        id: object::new(ctx),
        ledger: table::new(ctx),
        subs: table::new(ctx),
        positions: table::new(ctx),
    }
}

#[test_only]
public fun assert_agent_trade_for_testing(
    vault: &Vault624,
    user: address,
    agent: address,
    leverage: u64,
    max_cost: u64,
) {
    vault.assert_agent_trade(user, agent, leverage, max_cost)
}

#[test_only]
public fun credit_for_testing(vault: &mut Vault624, user: address, amount: u64) {
    vault.credit(user, amount)
}

#[test_only]
public fun debit_for_testing(vault: &mut Vault624, user: address, amount: u64) {
    vault.debit(user, amount)
}

#[test_only]
public fun record_position_for_testing(
    vault: &mut Vault624,
    order_id: u256,
    user: address,
    qty: u64,
) {
    vault.positions.add(order_id, Pos { user, qty });
}
