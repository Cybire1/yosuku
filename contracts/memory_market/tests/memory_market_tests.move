#[test_only]
module memory_market::memory_market_tests;

use sui::test_scenario as ts;
use sui::coin;
use sui::sui::SUI;
use memory_market::memory_market::{Self, MemoryListing};

const ADMIN: address = @0xAD;
const CREATOR: address = @0xC0FFEE;
const BUYER: address = @0xB0B;

#[test]
fun list_buy_exact_and_refund() {
    let strategy = object::id_from_address(@0x57A7);
    let mem = @0x111;
    let mut sc = ts::begin(ADMIN);

    // admin lists the memory on behalf of CREATOR, for 1000
    let admin = memory_market::new_admin_for_testing(ts::ctx(&mut sc));
    let cap = memory_market::list_memory<SUI>(&admin, strategy, CREATOR, mem, 1000, ts::ctx(&mut sc));
    transfer::public_transfer(cap, CREATOR);
    transfer::public_transfer(admin, ADMIN);

    // buyer OVERPAYS (1500) → creator charged exactly 1000, buyer refunded 500
    ts::next_tx(&mut sc, BUYER);
    {
        let mut listing = ts::take_shared<MemoryListing<SUI>>(&sc);
        let pay = coin::mint_for_testing<SUI>(1500, ts::ctx(&mut sc));
        let pass = memory_market::buy_pass<SUI>(&mut listing, pay, ts::ctx(&mut sc));
        assert!(memory_market::passes_sold<SUI>(&listing) == 1, 0);
        assert!(memory_market::pass_buyer(&pass) == BUYER, 1);
        assert!(memory_market::pass_strategy(&pass) == strategy, 2);
        transfer::public_transfer(pass, BUYER);
        ts::return_shared(listing);
    };

    // creator received EXACTLY 1000 (not the 1500 sent)
    ts::next_tx(&mut sc, CREATOR);
    {
        let c = ts::take_from_sender<coin::Coin<SUI>>(&sc);
        assert!(coin::value(&c) == 1000, 3);
        ts::return_to_sender(&sc, c);
    };
    // buyer got the 500 excess refunded
    ts::next_tx(&mut sc, BUYER);
    {
        let r = ts::take_from_sender<coin::Coin<SUI>>(&sc);
        assert!(coin::value(&r) == 500, 4);
        ts::return_to_sender(&sc, r);
    };
    ts::end(sc);
}

// underpay is guarded by `assert!(value >= price, EUnderpaid)` in buy_pass.
#[test]
#[expected_failure]
fun underpay_aborts() {
    let strategy = object::id_from_address(@0x57A7);
    let mut sc = ts::begin(ADMIN);
    let admin = memory_market::new_admin_for_testing(ts::ctx(&mut sc));
    let cap = memory_market::list_memory<SUI>(&admin, strategy, CREATOR, @0x111, 1000, ts::ctx(&mut sc));
    transfer::public_transfer(cap, CREATOR);
    transfer::public_transfer(admin, ADMIN);
    ts::next_tx(&mut sc, BUYER);
    let mut listing = ts::take_shared<MemoryListing<SUI>>(&sc);
    let pay = coin::mint_for_testing<SUI>(500, ts::ctx(&mut sc)); // below price → aborts
    let pass = memory_market::buy_pass<SUI>(&mut listing, pay, ts::ctx(&mut sc));
    transfer::public_transfer(pass, BUYER);
    ts::return_shared(listing);
    ts::end(sc);
}
