#[test_only]
module yolev::social_vault_tests;

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
    social_vault::{Self, Vault},
};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const LP: address = @0xB;
const USER: address = @0xC;
const STRANGER: address = @0xD;
// the attested enclave identity is BOTH the vault agent and the margin keeper.
const AGENT: address = @0xE;

const ORACLE: address = @0x2;
const MANAGER: address = @0x99;

// pool (0% interest) + margin desk (3x cap, 120% maintenance, 5% penalty) + a social
// vault whose agent is the same enclave key as the desk keeper, max_trade = 150k.
fun setup(sc: &mut ts::Scenario, clk: &sui::clock::Clock) {
    lending_pool::create<TUSD>(0, 0, clk, ts::ctx(sc));
    ts::next_tx(sc, ADMIN);
    let pool = ts::take_shared<LendingPool<TUSD>>(sc);
    margin::create_desk<TUSD>(&pool, object::id_from_address(MANAGER), AGENT, 30_000, 12_000, 500, ts::ctx(sc));
    ts::return_shared(pool);
    ts::next_tx(sc, ADMIN);
    social_vault::create_vault<TUSD>(AGENT, 150_000, ts::ctx(sc));
}

// deposit credits the depositor; owner-gated withdraw returns their own funds.
#[test]
fun deposit_then_withdraw() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(300_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    assert_eq!(social_vault::balance_of(&v, USER), 300_000);
    assert_eq!(social_vault::total(&v), 300_000);

    let back = social_vault::withdraw(&mut v, 120_000, ts::ctx(&mut sc));
    assert_eq!(back.value(), 120_000);
    assert_eq!(social_vault::balance_of(&v, USER), 180_000);
    coin::burn_for_testing(back);

    ts::return_shared(v);
    destroy(clk); ts::end(sc);
}

// THE HEADLINE: agent debits a user's balance, opens a position OWNED BY THE USER, and
// the close force-pays the USER — the agent is in the middle but can never be paid.
#[test]
fun agent_trade_is_no_divert() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    // LP funds the lending pool.
    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));
    ts::return_shared(pool);

    // USER deposits 300k into the vault.
    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(300_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    // AGENT trades 100k of USER's balance at 3x → escrows an order owned by USER.
    ts::next_tx(&mut sc, AGENT);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    social_vault::agent_trade(&mut v, &desk, object::id_from_address(ORACLE), USER, 100_000, 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));
    assert_eq!(social_vault::balance_of(&v, USER), 200_000); // 100k moved into the trade
    ts::return_shared(v);

    // AGENT (keeper) fills: borrow 200k, mint 300k notional into custody.
    ts::next_tx(&mut sc, AGENT);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    coin::burn_for_testing(margin::fill(&desk, &mut pool, order, 300_000, &clk, ts::ctx(&mut sc)));

    // winner settles 330k. AGENT closes → repay 200k → 130k force-paid to USER (not AGENT).
    ts::next_tx(&mut sc, AGENT);
    let pos = ts::take_shared<MarginPosition<TUSD>>(&sc);
    assert_eq!(margin::position_owner(&pos), USER);
    margin::close(&desk, &mut pool, pos, coin::mint_for_testing<TUSD>(330_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));

    // the agent received NOTHING; the user got the amplified PnL in their wallet.
    ts::next_tx(&mut sc, USER);
    let won = ts::take_from_address<Coin<TUSD>>(&sc, USER);
    assert_eq!(won.value(), 130_000);
    coin::burn_for_testing(won);
    assert!(!ts::has_most_recent_for_address<Coin<TUSD>>(AGENT)); // agent paid zero

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// only the attested agent can trade a user's balance.
#[test, expected_failure(abort_code = yolev::social_vault::ENotAgent)]
fun only_agent_can_trade() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(300_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    // STRANGER (not the agent) tries to trade USER's funds → abort.
    ts::next_tx(&mut sc, STRANGER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    social_vault::agent_trade(&mut v, &desk, object::id_from_address(ORACLE), USER, 100_000, 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::return_shared(v); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// the per-trade cap bounds a hijacked agent's blast radius.
#[test, expected_failure(abort_code = yolev::social_vault::EOverTradeCap)]
fun agent_trade_respects_max_trade() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(500_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    // 200k > 150k max_trade → abort even though the balance covers it.
    ts::next_tx(&mut sc, AGENT);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    social_vault::agent_trade(&mut v, &desk, object::id_from_address(ORACLE), USER, 200_000, 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::return_shared(v); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// you cannot withdraw an account that isn't yours (owner-gating).
#[test, expected_failure(abort_code = yolev::social_vault::ENoAccount)]
fun withdraw_is_owner_gated() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(300_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    // STRANGER has no account → withdraw aborts (can never reach USER's balance).
    ts::next_tx(&mut sc, STRANGER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let out = social_vault::withdraw(&mut v, 100_000, ts::ctx(&mut sc));
    coin::burn_for_testing(out);
    ts::return_shared(v);
    destroy(clk); ts::end(sc);
}

// the agent cannot deploy more than the user's balance.
#[test, expected_failure(abort_code = yolev::social_vault::EInsufficient)]
fun agent_cannot_overdraw() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    social_vault::deposit(&mut v, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), ts::ctx(&mut sc));
    ts::return_shared(v);

    // margin 120k under the 150k cap, but the balance is only 100k → abort.
    ts::next_tx(&mut sc, AGENT);
    let mut v = ts::take_shared<Vault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    social_vault::agent_trade(&mut v, &desk, object::id_from_address(ORACLE), USER, 120_000, 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::return_shared(v); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}
