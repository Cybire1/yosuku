#[test_only]
module suioverflow::strategy_market_tests;

use std::{
    string,
    unit_test::{assert_eq, destroy},
};
use sui::{
    clock,
    coin::{Self, Coin},
    sui::SUI,
    test_scenario as ts,
};
use suioverflow::strategy_market::{Self, Market, MarketAdminCap, Listing};

const STRATEGIST: address = @0xA1;
const BUYER: address = @0xB2;
const STRANGER: address = @0xC3;

const PRICE: u64 = 50_000_000; // 50 DUSDC-style units
const HOUR_MS: u64 = 3_600_000;

fun setup(ts: &mut ts::Scenario): clock::Clock {
    ts.next_tx(STRATEGIST);
    strategy_market::init_for_testing(ts.ctx());
    let mut c = clock::create_for_testing(ts.ctx());
    c.set_for_testing(1_000_000);
    c
}

fun list_default(ts: &mut ts::Scenario, c: &clock::Clock, access_ms: u64): ID {
    ts.next_tx(STRATEGIST);
    let mut market = ts.take_shared<Market>();
    let id = strategy_market::list<SUI>(
        &mut market,
        c,
        string::utf8(b"bellkeeper playbook"),
        111u256, // playbook blob (Seal-encrypted)
        222u256, // manifest blob (plaintext provenance)
        PRICE,
        access_ms,
        ts.ctx(),
    );
    ts::return_shared(market);
    id
}

fun buy(ts: &mut ts::Scenario, c: &clock::Clock, who: address) {
    ts.next_tx(who);
    let mut market = ts.take_shared<Market>();
    let mut listing = ts.take_shared<Listing<SUI>>();
    let payment = coin::mint_for_testing<SUI>(PRICE, ts.ctx());
    strategy_market::purchase(&mut market, &mut listing, payment, c, ts.ctx());
    ts::return_shared(market);
    ts::return_shared(listing);
}

#[test]
fun purchase_grants_seal_access() {
    let mut ts = ts::begin(STRATEGIST);
    let c = setup(&mut ts);
    list_default(&mut ts, &c, 0); // perpetual
    buy(&mut ts, &c, BUYER);

    ts.next_tx(BUYER);
    let listing = ts.take_shared<Listing<SUI>>();
    // buyer passes the gate
    strategy_market::seal_approve(&listing, &c, strategy_market::seal_identity(&listing), ts.ctx());
    assert!(strategy_market::has_access(&listing, &c, BUYER));
    assert_eq!(strategy_market::total_sales(&listing), 1);
    ts::return_shared(listing);

    // strategist always passes
    ts.next_tx(STRATEGIST);
    let listing = ts.take_shared<Listing<SUI>>();
    strategy_market::seal_approve(&listing, &c, strategy_market::seal_identity(&listing), ts.ctx());
    ts::return_shared(listing);

    destroy(c);
    ts.end();
}

#[test, expected_failure(abort_code = strategy_market::ENoAccess)]
fun stranger_cannot_decrypt() {
    let mut ts = ts::begin(STRATEGIST);
    let c = setup(&mut ts);
    list_default(&mut ts, &c, 0);
    buy(&mut ts, &c, BUYER);

    ts.next_tx(STRANGER);
    let listing = ts.take_shared<Listing<SUI>>();
    strategy_market::seal_approve(&listing, &c, strategy_market::seal_identity(&listing), ts.ctx());
    abort 0
}

#[test, expected_failure(abort_code = strategy_market::EBadIdentity)]
fun wrong_identity_rejected() {
    let mut ts = ts::begin(STRATEGIST);
    let c = setup(&mut ts);
    list_default(&mut ts, &c, 0);
    buy(&mut ts, &c, BUYER);

    ts.next_tx(BUYER);
    let listing = ts.take_shared<Listing<SUI>>();
    strategy_market::seal_approve(&listing, &c, b"not-the-identity", ts.ctx());
    abort 0
}

#[test, expected_failure(abort_code = strategy_market::ENoAccess)]
fun subscription_expires() {
    let mut ts = ts::begin(STRATEGIST);
    let mut c = setup(&mut ts);
    list_default(&mut ts, &c, HOUR_MS); // 1-hour access
    buy(&mut ts, &c, BUYER);

    // inside the window: passes
    ts.next_tx(BUYER);
    let listing = ts.take_shared<Listing<SUI>>();
    strategy_market::seal_approve(&listing, &c, strategy_market::seal_identity(&listing), ts.ctx());
    ts::return_shared(listing);

    // after expiry: rejected
    c.set_for_testing(1_000_000 + HOUR_MS + 1);
    ts.next_tx(BUYER);
    let listing = ts.take_shared<Listing<SUI>>();
    strategy_market::seal_approve(&listing, &c, strategy_market::seal_identity(&listing), ts.ctx());
    abort 0
}

#[test]
fun repeat_purchase_extends_subscription() {
    let mut ts = ts::begin(STRATEGIST);
    let mut c = setup(&mut ts);
    list_default(&mut ts, &c, HOUR_MS);
    buy(&mut ts, &c, BUYER);
    buy(&mut ts, &c, BUYER); // stack a second hour

    // after 1.5 hours the doubled subscription is still live
    c.set_for_testing(1_000_000 + HOUR_MS + HOUR_MS / 2);
    ts.next_tx(BUYER);
    let listing = ts.take_shared<Listing<SUI>>();
    assert!(strategy_market::has_access(&listing, &c, BUYER));
    assert_eq!(strategy_market::total_sales(&listing), 2);
    ts::return_shared(listing);
    destroy(c);
    ts.end();
}

#[test, expected_failure(abort_code = strategy_market::EWrongPayment)]
fun underpayment_rejected() {
    let mut ts = ts::begin(STRATEGIST);
    let c = setup(&mut ts);
    list_default(&mut ts, &c, 0);

    ts.next_tx(BUYER);
    let mut market = ts.take_shared<Market>();
    let mut listing = ts.take_shared<Listing<SUI>>();
    let payment = coin::mint_for_testing<SUI>(PRICE - 1, ts.ctx());
    strategy_market::purchase(&mut market, &mut listing, payment, &c, ts.ctx());
    abort 0
}

#[test]
fun fee_split_and_withdrawals() {
    let mut ts = ts::begin(STRATEGIST);
    let c = setup(&mut ts);
    list_default(&mut ts, &c, 0);
    buy(&mut ts, &c, BUYER);

    // default fee 250 bps → 2.5% of 50_000_000 = 1_250_000
    ts.next_tx(STRATEGIST);
    let mut listing = ts.take_shared<Listing<SUI>>();
    assert_eq!(strategy_market::proceeds_value(&listing), PRICE - 1_250_000);
    let proceeds: Coin<SUI> = strategy_market::withdraw_proceeds(&mut listing, ts.ctx());
    assert_eq!(proceeds.value(), PRICE - 1_250_000);
    transfer::public_transfer(proceeds, STRATEGIST);
    ts::return_shared(listing);

    // admin pulls the fee with the cap
    ts.next_tx(STRATEGIST);
    let mut listing = ts.take_shared<Listing<SUI>>();
    let cap = ts.take_from_sender<MarketAdminCap>();
    let fees: Coin<SUI> = strategy_market::withdraw_fees(&mut listing, &cap, ts.ctx());
    assert_eq!(fees.value(), 1_250_000);
    transfer::public_transfer(fees, STRATEGIST);
    ts.return_to_sender(cap);
    ts::return_shared(listing);
    destroy(c);
    ts.end();
}

#[test, expected_failure(abort_code = strategy_market::ENotActive)]
fun delisted_cannot_be_purchased() {
    let mut ts = ts::begin(STRATEGIST);
    let c = setup(&mut ts);
    list_default(&mut ts, &c, 0);

    ts.next_tx(STRATEGIST);
    let mut listing = ts.take_shared<Listing<SUI>>();
    strategy_market::set_active(&mut listing, false, ts.ctx());
    ts::return_shared(listing);

    buy(&mut ts, &c, BUYER);
    abort 0
}
