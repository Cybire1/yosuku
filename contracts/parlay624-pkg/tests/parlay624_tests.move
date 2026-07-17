#[test_only]
module parlay624::parlay624_tests;

use sui::{
    clock::{Self, Clock},
    coin::{Self, Coin},
    sui::SUI,
    test_scenario::{Self as ts, Scenario},
};
use propbook::{pyth_feed::{Self, PythFeed}, registry::{Self, OracleRegistry}};
use parlay624::parlay624::{Self, ParlayReserve, Parlay, SupplyPosition};

const ADMIN: address = @0xAD;
const PLAYER: address = @0xB0B;
const KEEPER: address = @0xFEED;
const PYTH_SOURCE: u32 = 1;

// Stamps + bands (normalized 1e9 scaling; expo=9 → normalized == magnitude).
const T0: u64 = 1_000_000; // "now" at open
const EXP1: u64 = 1_060_000; // leg 1 expiry (1m later)
const EXP2: u64 = 1_120_000; // leg 2 expiry (2m later)
const STRIKE: u64 = 64_000_000_000_000; // $64k in 1e9
const BAND_LO: u64 = 63_000_000_000_000;
const BAND_HI: u64 = 66_000_000_000_000;

// ─── scaffolding ───

fun setup_feed(s: &mut Scenario): ID {
    registry::init_for_testing(s.ctx());
    s.next_tx(ADMIN);
    let mut reg = s.take_shared<OracleRegistry>();
    let feed_id = registry::create_and_share_pyth_feed(&mut reg, PYTH_SOURCE, s.ctx());
    ts::return_shared(reg);
    feed_id
}

fun setup_reserve(s: &mut Scenario) {
    s.next_tx(ADMIN);
    let feed = s.take_shared<PythFeed>();
    parlay624::create<SUI>(
        &feed,
        KEEPER,
        1_200, // margin 12%
        6_000, // exposure 60%
        50_000_000_000, // payout cap
        50_000_000_000, // per-expiry cap
        3, // max legs
        100, // min combined prob 1%
        4_000, // λ 0.40
        3_600_000, // grace 1h
        s.ctx(),
    );
    ts::return_shared(feed);
    // seed the reserve so it can lock house capital
    s.next_tx(ADMIN);
    let mut r = s.take_shared<ParlayReserve<SUI>>();
    let pos = parlay624::supply(&mut r, coin::mint_for_testing<SUI>(10_000_000_000, s.ctx()), s.ctx());
    transfer::public_transfer(pos, ADMIN);
    ts::return_shared(r);
}

/// Record the settlement print for `stamp_ms` — expo 9 ⇒ normalized == magnitude.
fun record_print(s: &mut Scenario, price_1e9: u64, stamp_ms: u64) {
    s.next_tx(ADMIN);
    let mut feed = s.take_shared<PythFeed>();
    pyth_feed::record_raw_for_testing(
        &mut feed,
        price_1e9, // price magnitude
        false, // not negative
        9, // exponent magnitude
        true, // exponent negative (1e-9 → ×1e9 normalization = identity)
        stamp_ms * 1_000, // source timestamp µs
        stamp_ms, // update timestamp ms
        true, // insert_at (exact-stamp history insert)
    );
    ts::return_shared(feed);
}

fun new_clock(s: &mut Scenario, ms: u64): Clock {
    let mut c = clock::create_for_testing(s.ctx());
    c.set_for_testing(ms);
    c
}

/// Open the standard 2-leg ticket: leg0 = UP over STRIKE @ EXP1 (prob 45%),
/// leg1 = RANGE (BAND_LO, BAND_HI] @ EXP2 (prob 60%). combined = 27%; with 12%
/// margin a 1.0 payout needs stake ≥ 0.3024 → stake 0.35, payout 1.0.
fun open_standard(s: &mut Scenario): (u64, u64) {
    let stake_v: u64 = 350_000_000;
    let payout: u64 = 1_000_000_000;
    s.next_tx(PLAYER);
    let mut r = s.take_shared<ParlayReserve<SUI>>();
    let clk = new_clock(s, T0);
    parlay624::open_parlay(
        &mut r,
        coin::mint_for_testing<SUI>(stake_v, s.ctx()),
        vector[EXP1, EXP2],
        vector[STRIKE, BAND_LO],
        vector[parlay624::u64_max(), BAND_HI],
        vector[4_500, 6_000],
        payout,
        &clk,
        s.ctx(),
    );
    clk.destroy_for_testing();
    ts::return_shared(r);
    (stake_v, payout)
}

fun resolve(s: &mut Scenario, leg_idx: u64, at_ms: u64) {
    s.next_tx(KEEPER);
    let mut r = s.take_shared<ParlayReserve<SUI>>();
    let mut p = s.take_shared<Parlay<SUI>>();
    let feed = s.take_shared<PythFeed>();
    let clk = new_clock(s, at_ms);
    parlay624::resolve_leg(&mut r, &mut p, &feed, leg_idx, &clk, s.ctx());
    clk.destroy_for_testing();
    ts::return_shared(feed);
    ts::return_shared(p);
    ts::return_shared(r);
}

// ─── tests ───

#[test]
fun full_win_lifecycle_pays_owner_exact_payout() {
    let mut s = ts::begin(ADMIN);
    setup_feed(&mut s);
    setup_reserve(&mut s);
    let (_stake, payout) = open_standard(&mut s);

    // leg0 settles ABOVE the strike → UP wins (sp > lower).
    record_print(&mut s, STRIKE + 1_000_000_000, EXP1);
    resolve(&mut s, 0, EXP1 + 1_000);
    // leg1 settles inside the band → RANGE wins.
    record_print(&mut s, 64_500_000_000_000, EXP2);
    resolve(&mut s, 1, EXP2 + 1_000);

    // ST_WON → claim force-pays the OWNER the full escrow (== max_payout).
    s.next_tx(KEEPER);
    let mut r = s.take_shared<ParlayReserve<SUI>>();
    let p = s.take_shared<Parlay<SUI>>();
    assert!(parlay624::parlay_status(&p) == parlay624::st_won(), 0);
    parlay624::claim(&mut r, p, s.ctx());
    assert!(parlay624::locked(&r) == 0, 1);
    ts::return_shared(r);

    s.next_tx(PLAYER);
    let won: Coin<SUI> = s.take_from_address<Coin<SUI>>(PLAYER);
    assert!(won.value() == payout, 2);
    ts::return_to_address(PLAYER, won);
    s.end();
}

#[test]
fun losing_leg_kills_instantly_and_sweeps_escrow() {
    let mut s = ts::begin(ADMIN);
    setup_feed(&mut s);
    setup_reserve(&mut s);
    let (stake_v, _payout) = open_standard(&mut s);

    // Reserve after open: 10.0 seeded − 0.65 house_locked = 9.35 liquid, 0.65 locked.
    // leg0 settles BELOW the strike → UP loses → instant kill; leg1 never consulted.
    record_print(&mut s, STRIKE - 1_000_000_000, EXP1);
    resolve(&mut s, 0, EXP1 + 1_000);

    s.next_tx(ADMIN);
    let r = s.take_shared<ParlayReserve<SUI>>();
    let p = s.take_shared<Parlay<SUI>>();
    assert!(parlay624::parlay_status(&p) == parlay624::st_lost(), 0);
    assert!(parlay624::leg_status(&p, 1) == parlay624::leg_pending(), 1); // untouched
    assert!(parlay624::parlay_escrow_value(&p) == 0, 2); // swept
    assert!(parlay624::locked(&r) == 0, 3); // liability released
    // reserve keeps the stake: liquid = 10.0 + stake
    assert!(parlay624::available_liquidity(&r) == 10_000_000_000 + stake_v, 4);
    ts::return_shared(p);
    ts::return_shared(r);
    s.end();
}

#[test]
fun exact_atm_print_settles_down_like_the_venue() {
    let mut s = ts::begin(ADMIN);
    setup_feed(&mut s);
    setup_reserve(&mut s);

    // leg0 = UP over STRIKE @ EXP1, leg1 = DOWN under STRIKE @ EXP2 (encoded (0, STRIKE]).
    s.next_tx(PLAYER);
    let mut r = s.take_shared<ParlayReserve<SUI>>();
    let clk = new_clock(&mut s, T0);
    parlay624::open_parlay(
        &mut r,
        coin::mint_for_testing<SUI>(350_000_000, s.ctx()),
        vector[EXP1, EXP2],
        vector[STRIKE, 0],
        vector[parlay624::u64_max(), STRIKE],
        vector[4_500, 6_000],
        1_000_000_000,
        &clk,
        s.ctx(),
    );
    clk.destroy_for_testing();
    ts::return_shared(r);

    // Print EXACTLY the strike at EXP1: venue rule `sp > lower` fails ⇒ UP loses.
    record_print(&mut s, STRIKE, EXP1);
    resolve(&mut s, 0, EXP1 + 1_000);

    s.next_tx(ADMIN);
    let r = s.take_shared<ParlayReserve<SUI>>();
    let p = s.take_shared<Parlay<SUI>>();
    assert!(parlay624::parlay_status(&p) == parlay624::st_lost(), 0);
    assert!(parlay624::leg_settlement(&p, 0) == STRIKE, 1);
    ts::return_shared(p);
    ts::return_shared(r);
    s.end();
}

#[test]
#[expected_failure(abort_code = 10)] // EStampNotRecorded
fun resolve_before_stamp_recorded_aborts() {
    let mut s = ts::begin(ADMIN);
    setup_feed(&mut s);
    setup_reserve(&mut s);
    open_standard(&mut s);
    // Past expiry on the clock, but no print recorded for EXP1 → abort, crank retries.
    resolve(&mut s, 0, EXP1 + 1_000);
    abort 99
}

#[test]
#[expected_failure(abort_code = 8)] // EUnderpriced
fun underpriced_stake_rejected() {
    let mut s = ts::begin(ADMIN);
    setup_feed(&mut s);
    setup_reserve(&mut s);
    s.next_tx(PLAYER);
    let mut r = s.take_shared<ParlayReserve<SUI>>();
    let clk = new_clock(&mut s, T0);
    // fair floor ≈ 0.3024 for these probs; 0.10 stake must be rejected.
    parlay624::open_parlay(
        &mut r,
        coin::mint_for_testing<SUI>(100_000_000, s.ctx()),
        vector[EXP1, EXP2],
        vector[STRIKE, BAND_LO],
        vector[parlay624::u64_max(), BAND_HI],
        vector[4_500, 6_000],
        1_000_000_000,
        &clk,
        s.ctx(),
    );
    abort 99
}

#[test]
fun same_expiry_surcharge_raises_the_floor() {
    let mut s = ts::begin(ADMIN);
    setup_feed(&mut s);
    setup_reserve(&mut s);
    // Two legs on the SAME expiry: Π = 27.00% but the λ floor = 0.40·45% = 18%…
    // Π already exceeds the floor here, so use tighter probs where the floor bites:
    // probs 20% & 20% → Π = 4%, floor = 0.40·20% = 8% ⇒ combined' = 8%.
    // fair = 1.0·8% = 0.08; +12% margin → 0.0896 floor. A 0.0850 stake must fail.
    s.next_tx(PLAYER);
    let mut r = s.take_shared<ParlayReserve<SUI>>();
    let clk = new_clock(&mut s, T0);
    parlay624::open_parlay(
        &mut r,
        coin::mint_for_testing<SUI>(90_000_000, s.ctx()), // 0.090 clears 0.0896
        vector[EXP1, EXP1],
        vector[STRIKE, BAND_LO],
        vector[parlay624::u64_max(), BAND_HI],
        vector[2_000, 2_000],
        1_000_000_000,
        &clk,
        s.ctx(),
    );
    clk.destroy_for_testing();
    s.next_tx(PLAYER);
    let p = s.take_shared<Parlay<SUI>>();
    assert!(parlay624::parlay_combined_prob_bps(&p) == 800, 0); // the λ floor, not Π=400
    ts::return_shared(p);
    ts::return_shared(r);
    s.end();
}
