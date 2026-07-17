// Copyright (c) Yosuku
// SPDX-License-Identifier: Apache-2.0

/// Minimal spike proving Yosuku's "no-divert delegated agent" pattern on the
/// predict-testnet-6-24 `account` + `predict` packages.
///
/// A shared `SpikeVault` owns an object-owned canonical account
/// (`account_registry::new_self_owned` keyed to the vault's UID). The vault's
/// UID is the only source of `Auth` for that account
/// (`account::generate_auth_as_object`), so custody policy is exactly this
/// module's API surface:
/// - anyone can `deposit`;
/// - the designated `agent` can mint Predict positions, hard-capped by
///   `max_margin` per trade — but has NO withdraw path;
/// - only `owner` can `user_withdraw`, and funds go to `owner` only.
module yosuku_spike::spike_vault;

use account::{account::{Self, AccountWrapper}, account_registry::AccountRegistry};
use deepbook_predict::{
    expiry_market::ExpiryMarket,
    pricing::Pricer,
    protocol_config::ProtocolConfig
};
use dusdc::dusdc::DUSDC;
use sui::{accumulator::AccumulatorRoot, clock::Clock, coin::Coin};

// === Errors ===
const ENotAgent: u64 = 0;
const ENotOwner: u64 = 1;
const EOverCap: u64 = 2;

/// Shared vault: the object owner of its canonical account. `owner` is the
/// user (sole withdraw recipient); `agent` is a different keypair allowed to
/// trade; `max_margin` is the per-trade all-in cost cap in DUSDC (6dp).
public struct SpikeVault has key {
    id: UID,
    owner: address,
    agent: address,
    max_margin: u64,
}

/// Create the vault and its object-owned canonical account, then share both.
/// The account's owner is the vault UID's address, so only auth generated from
/// `&mut vault.id` (i.e. this module) can open it mutably.
public fun new(
    registry: &mut AccountRegistry,
    agent: address,
    max_margin: u64,
    ctx: &mut TxContext,
) {
    let mut vault = SpikeVault {
        id: object::new(ctx),
        owner: ctx.sender(),
        agent,
        max_margin,
    };
    let wrapper = registry.new_self_owned(&mut vault.id, ctx);
    wrapper.share();
    transfer::share_object(vault);
}

/// Permissionless deposit into the vault's account. Passing a wrapper that
/// does not belong to this vault aborts in `account` with `EInvalidOwner`.
public fun deposit(
    vault: &mut SpikeVault,
    wrapper: &mut AccountWrapper,
    coin: Coin<DUSDC>,
    root: &AccumulatorRoot,
    clock: &Clock,
) {
    let auth = account::generate_auth_as_object(&mut vault.id);
    wrapper.deposit_funds(auth, coin, root, clock);
}

/// Agent-only, cap-bound Predict mint. `max_cost` bounds the all-in account
/// withdrawal inside `mint_exact_quantity`, so `max_cost <= max_margin` makes
/// the cap a hard per-trade custody limit. Returns the packed order id.
public fun agent_mint(
    vault: &mut SpikeVault,
    wrapper: &mut AccountWrapper,
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
    assert!(ctx.sender() == vault.agent, ENotAgent);
    assert!(max_cost <= vault.max_margin, EOverCap);
    let auth = account::generate_auth_as_object(&mut vault.id);
    market.mint_exact_quantity(
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
    )
}

/// Owner-only withdraw; the coin is transferred to `owner` unconditionally.
/// This is the ONLY funds-out path — the agent cannot divert.
public fun user_withdraw(
    vault: &mut SpikeVault,
    wrapper: &mut AccountWrapper,
    amount: u64,
    root: &AccumulatorRoot,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == vault.owner, ENotOwner);
    let auth = account::generate_auth_as_object(&mut vault.id);
    let coin = wrapper.withdraw_funds<DUSDC>(auth, amount, root, clock, ctx);
    transfer::public_transfer(coin, vault.owner);
}
