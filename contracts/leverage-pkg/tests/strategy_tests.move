#[test_only]
module yolev::strategy_tests;

use std::unit_test::{assert_eq, destroy};
use sui::{
    clock,
    coin::{Self, Coin},
    object,
    test_scenario::{Self as ts},
};
use yolev::{
    lending_pool::{Self, LendingPool},
    margin::{Self, MarginDesk, OpenOrder, MarginPosition},
    social_vault::{Self, Vault, Subscription},
    strategy::{Self, Strategy, StrategyCap},
};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const LP: address = @0xB;
const SUB: address = @0xC;       // a subscriber (copies the strategy)
const STRANGER: address = @0xD;
const KEEPER: address = @0xE;    // Yosuku desk keeper (fills orders)
const CREATOR: address = @0xF;   // strategy creator + its executing agent (≠ desk keeper)

const ORACLE: address = @0x2;
const MANAGER: address = @0x99;

// pool (0% interest) + desk (3x cap, 120% maint, 5% penalty, keeper=KEEPER) + a vault.
fun setup(sc: &mut ts::Scenario, clk: &sui::clock::Clock) {
    lending_pool::create<TUSD>(0, 0, clk, ts::ctx(sc));
    ts::next_tx(sc, ADMIN);
    let pool = ts::take_shared<LendingPool<TUSD>>(sc);
    margin::create_desk<TUSD>(&pool, object::id_from_address(MANAGER), KEEPER, 30_000, 12_000, 500, ts::ctx(sc));
    ts::return_shared(pool);
    ts::next_tx(sc, ADMIN);
    social_vault::create_vault<TUSD>(KEEPER, 150_000, ts::ctx(sc));
}

// CREATOR lists a strategy: agent=CREATOR, 3x cap, 200k per-trade, 10k sub fee.
fun list(sc: &mut ts::Scenario) {
    ts::next_tx(sc, CREATOR);
    let cap = strategy::list_strategy<TUSD>(CREATOR, 0, @0x0, 30_000, 200_000, 10_000, ts::ctx(sc));
    transfer::public_transfer(cap, CREATOR);
}

// THE HEADLINE: a strategy creator's agent copy-trades a SUBSCRIBER's own funds, the
// position is owned by the subscriber, and the close force-pays the subscriber — the
// creator earns only the up-front fee, never a cent of the subscriber's capital.
#[test]
fun copy_trade_is_no_divert() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);
    list(&mut sc);

    // LP funds the pool
    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));
    ts::return_shared(pool);

    // SUB deposits 300k into their own vault account
    ts::next_tx(&mut sc, SUB);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(300_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    // SUB subscribes: pays the 10k fee to CREATOR + authorizes CREATOR's agent on their vault
    ts::next_tx(&mut sc, SUB);
    let mut strat = ts::take_shared<Strategy<TUSD>>(&sc);
    let v = ts::take_shared<Vault<TUSD>>(&sc);
    coin::burn_for_testing(strategy::subscribe(&mut strat, &v, coin::mint_for_testing<TUSD>(10_000, ts::ctx(&mut sc)), ts::ctx(&mut sc)));
    ts::return_shared(strat); ts::return_shared(v);

    // CREATOR (the strategy agent, NOT the desk keeper) copy-trades 100k of SUB's funds at 3x
    ts::next_tx(&mut sc, CREATOR);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let sub = ts::take_shared<Subscription>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    social_vault::authorized_trade(&mut v, &sub, &desk, object::id_from_address(ORACLE), 100_000, 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));
    assert_eq!(social_vault::balance_of(&v, SUB), 200_000); // 100k moved into the trade
    ts::return_shared(v); ts::return_shared(sub);

    // KEEPER fills the SUB-owned order; mint 300k notional into custody
    ts::next_tx(&mut sc, KEEPER);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    coin::burn_for_testing(margin::fill(&desk, &mut pool, order, 300_000, &clk, ts::ctx(&mut sc)));

    // winner settles 330k → repay 200k → 130k force-paid to SUB (not CREATOR, not KEEPER)
    ts::next_tx(&mut sc, KEEPER);
    let pos = ts::take_shared<MarginPosition<TUSD>>(&sc);
    assert_eq!(margin::position_owner(&pos), SUB);
    margin::close(&desk, &mut pool, pos, coin::mint_for_testing<TUSD>(330_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));

    // SUB got the amplified PnL; the CREATOR and KEEPER got NONE of the trade
    ts::next_tx(&mut sc, SUB);
    let won = ts::take_from_address<Coin<TUSD>>(&sc, SUB);
    assert_eq!(won.value(), 130_000);
    coin::burn_for_testing(won);
    assert!(!ts::has_most_recent_for_address<Coin<TUSD>>(KEEPER)); // keeper paid zero

    // CREATOR holds exactly the 10k subscription fee — and nothing from SUB's trade
    ts::next_tx(&mut sc, CREATOR);
    let fee = ts::take_from_address<Coin<TUSD>>(&sc, CREATOR);
    assert_eq!(fee.value(), 10_000);
    coin::burn_for_testing(fee);
    assert!(!ts::has_most_recent_for_address<Coin<TUSD>>(CREATOR)); // no second coin = no divert

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// only the subscription's authorized agent can copy-trade that subscriber's funds.
#[test, expected_failure(abort_code = yolev::social_vault::ENotAuthorized)]
fun only_authorized_agent_can_copy_trade() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);
    list(&mut sc);

    ts::next_tx(&mut sc, SUB);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(300_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    ts::next_tx(&mut sc, SUB);
    let mut strat = ts::take_shared<Strategy<TUSD>>(&sc);
    let v = ts::take_shared<Vault<TUSD>>(&sc);
    coin::burn_for_testing(strategy::subscribe(&mut strat, &v, coin::mint_for_testing<TUSD>(10_000, ts::ctx(&mut sc)), ts::ctx(&mut sc)));
    ts::return_shared(strat); ts::return_shared(v);

    // STRANGER (not the subscription's agent) tries to copy-trade SUB's funds → abort
    ts::next_tx(&mut sc, STRANGER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let sub = ts::take_shared<Subscription>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    social_vault::authorized_trade(&mut v, &sub, &desk, object::id_from_address(ORACLE), 100_000, 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::return_shared(v); ts::return_shared(sub); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// the subscriber-granted per-trade cap bounds the creator agent.
#[test, expected_failure(abort_code = yolev::social_vault::EOverTradeCap)]
fun copy_trade_respects_caps() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);
    list(&mut sc);

    ts::next_tx(&mut sc, SUB);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(500_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    ts::next_tx(&mut sc, SUB);
    let mut strat = ts::take_shared<Strategy<TUSD>>(&sc);
    let v = ts::take_shared<Vault<TUSD>>(&sc);
    coin::burn_for_testing(strategy::subscribe(&mut strat, &v, coin::mint_for_testing<TUSD>(10_000, ts::ctx(&mut sc)), ts::ctx(&mut sc)));
    ts::return_shared(strat); ts::return_shared(v);

    // 250k > 200k strategy max_margin → abort even though balance covers it
    ts::next_tx(&mut sc, CREATOR);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let sub = ts::take_shared<Subscription>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    social_vault::authorized_trade(&mut v, &sub, &desk, object::id_from_address(ORACLE), 250_000, 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::return_shared(v); ts::return_shared(sub); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// a subscriber can revoke; a revoked subscription can no longer be traded.
#[test, expected_failure(abort_code = yolev::social_vault::ERevoked)]
fun cancel_subscription_blocks_copy_trade() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);
    list(&mut sc);

    ts::next_tx(&mut sc, SUB);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(300_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    ts::next_tx(&mut sc, SUB);
    let mut strat = ts::take_shared<Strategy<TUSD>>(&sc);
    let v = ts::take_shared<Vault<TUSD>>(&sc);
    coin::burn_for_testing(strategy::subscribe(&mut strat, &v, coin::mint_for_testing<TUSD>(10_000, ts::ctx(&mut sc)), ts::ctx(&mut sc)));
    ts::return_shared(strat); ts::return_shared(v);

    // SUB revokes
    ts::next_tx(&mut sc, SUB);
    let mut sub = ts::take_shared<Subscription>(&sc);
    social_vault::cancel_subscription(&mut sub, ts::ctx(&mut sc));
    ts::return_shared(sub);

    // CREATOR tries to trade the revoked subscription → abort
    ts::next_tx(&mut sc, CREATOR);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let sub = ts::take_shared<Subscription>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    social_vault::authorized_trade(&mut v, &sub, &desk, object::id_from_address(ORACLE), 100_000, 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::return_shared(v); ts::return_shared(sub); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// subscribe routes the fee to the creator and increments the count.
#[test]
fun subscribe_pays_creator() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);
    list(&mut sc);

    ts::next_tx(&mut sc, SUB);
    let mut strat = ts::take_shared<Strategy<TUSD>>(&sc);
    let v = ts::take_shared<Vault<TUSD>>(&sc);
    // pay 15k for a 10k fee → 10k to creator, 5k refunded to SUB
    let refund = strategy::subscribe(&mut strat, &v, coin::mint_for_testing<TUSD>(15_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    assert_eq!(refund.value(), 5_000);
    coin::burn_for_testing(refund);
    assert_eq!(strategy::subscribers(&strat), 1);
    ts::return_shared(strat); ts::return_shared(v);

    ts::next_tx(&mut sc, CREATOR);
    let fee = ts::take_from_address<Coin<TUSD>>(&sc, CREATOR);
    assert_eq!(fee.value(), 10_000);
    coin::burn_for_testing(fee);

    destroy(clk); ts::end(sc);
}
