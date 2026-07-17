/// strategy_market — verifiable trading knowledge as an on-chain asset.
///
/// A strategist lists a PLAYBOOK: a Seal-encrypted bundle of trading lessons
/// (distilled from their agent's memory) stored on Walrus. Alongside it sits a
/// PLAINTEXT manifest blob — tx digests + realized PnL — so anyone can verify
/// the playbook's provenance on-chain BEFORE buying, without seeing its content.
///
/// Buyers pay in the quote coin (DUSDC on testnet). Purchase records the buyer
/// in the listing's on-chain access table; Seal key servers then release
/// decryption shares iff `seal_approve` passes — i.e. the caller is the
/// strategist or a buyer whose access hasn't expired. No relayer, no custodian:
/// the paywall IS the Move predicate.
///
/// Access can be perpetual (access_ms = 0) or time-boxed (subscription-style);
/// repeat purchases extend an existing subscription.
module suioverflow::strategy_market;

use std::string::String;
use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin},
    event,
    table::{Self, Table},
};

const ENotStrategist: u64 = 1;
const EWrongPayment: u64 = 2;
const ENotActive: u64 = 3;
const ENoAccess: u64 = 4;
const EBadIdentity: u64 = 5;
const EFeeTooHigh: u64 = 7;

const MAX_U64: u64 = 18446744073709551615;
const BPS_DENOM: u64 = 10_000;
/// Protocol fee is capped so a misconfigured market can never confiscate sales.
const MAX_FEE_BPS: u64 = 1_000; // 10%

/// Shared registry + protocol fee policy.
public struct Market has key {
    id: UID,
    fee_bps: u64,
    listings: u64,
    total_volume: u64,
}

/// Admin handle for fee config + fee withdrawal.
public struct MarketAdminCap has key, store { id: UID }

/// One sellable strategy playbook.
public struct Listing<phantom Q> has key {
    id: UID,
    strategist: address,
    title: String,
    /// Walrus blob: Seal-encrypted playbook (the product).
    playbook_blob_id: u256,
    /// Seal identity bytes the ciphertext is bound to.
    seal_identity: vector<u8>,
    /// Walrus blob: PLAINTEXT provenance manifest (tx digests, realized PnL).
    manifest_blob_id: u256,
    /// Price per purchase, in Q base units.
    price: u64,
    /// 0 = perpetual access; otherwise access duration in ms per purchase.
    access_ms: u64,
    /// buyer -> access expiry (ms epoch; MAX_U64 = perpetual).
    buyers: Table<address, u64>,
    proceeds: Balance<Q>,
    fees: Balance<Q>,
    total_sales: u64,
    active: bool,
    version: u64,
    created_at_ms: u64,
}

public struct MarketCreated has copy, drop { market_id: ID }

public struct Listed has copy, drop {
    listing_id: ID,
    strategist: address,
    price: u64,
    access_ms: u64,
    manifest_blob_id: u256,
}

public struct Purchased has copy, drop {
    listing_id: ID,
    buyer: address,
    price: u64,
    expiry_ms: u64,
}

public struct PlaybookUpdated has copy, drop {
    listing_id: ID,
    new_blob: u256,
    new_version: u64,
}

public struct ProceedsClaimed has copy, drop {
    listing_id: ID,
    strategist: address,
    amount: u64,
}

fun init(ctx: &mut TxContext) { publish_market(ctx) }

/// Build a market and admin cap without forcing transfer side effects, so PTBs
/// can decide how to share/custody them.
public fun create_market(ctx: &mut TxContext): (Market, MarketAdminCap) {
    let market = Market { id: object::new(ctx), fee_bps: 250, listings: 0, total_volume: 0 };
    let market_id = object::id(&market);
    event::emit(MarketCreated { market_id });
    (market, MarketAdminCap { id: object::new(ctx) })
}

/// Bootstrap a market in one call (shares it; caller receives the admin cap).
/// Public entry wrapper because `init` does not run for modules added in a
/// package UPGRADE — the canonical market for the app is the one referenced in
/// its config.
entry fun create_market_entry(ctx: &mut TxContext) {
    publish_market(ctx)
}

fun publish_market(ctx: &mut TxContext) {
    let (market, cap) = create_market(ctx);
    transfer::share_object(market);
    transfer::transfer(cap, ctx.sender());
}

/// List a playbook. The seal identity defaults to the listing's own object id
/// bytes — encrypt the playbook to `object::id(&listing).to_bytes()`.
public fun list<Q>(
    market: &mut Market,
    clock: &sui::clock::Clock,
    title: String,
    playbook_blob_id: u256,
    manifest_blob_id: u256,
    price: u64,
    access_ms: u64,
    ctx: &mut TxContext,
): ID {
    let id = object::new(ctx);
    let listing_id = id.to_inner();
    let listing = Listing<Q> {
        id,
        strategist: ctx.sender(),
        title,
        playbook_blob_id,
        seal_identity: object::id_to_bytes(&listing_id),
        manifest_blob_id,
        price,
        access_ms,
        buyers: table::new(ctx),
        proceeds: balance::zero<Q>(),
        fees: balance::zero<Q>(),
        total_sales: 0,
        active: true,
        version: 1,
        created_at_ms: clock.timestamp_ms(),
    };
    market.listings = market.listings + 1;
    event::emit(Listed {
        listing_id,
        strategist: listing.strategist,
        price,
        access_ms,
        manifest_blob_id,
    });
    transfer::share_object(listing);
    listing_id
}

/// Buy access. Payment must be exactly `listing.price` (split exact in the PTB).
/// A repeat purchase on a time-boxed listing EXTENDS the subscription.
public fun purchase<Q>(
    market: &mut Market,
    listing: &mut Listing<Q>,
    payment: Coin<Q>,
    clock: &sui::clock::Clock,
    ctx: &mut TxContext,
) {
    assert!(listing.active, ENotActive);
    assert!(payment.value() == listing.price, EWrongPayment);

    let mut paid = payment.into_balance();
    let fee_amt = listing.price * market.fee_bps / BPS_DENOM;
    listing.fees.join(paid.split(fee_amt));
    listing.proceeds.join(paid);

    let now = clock.timestamp_ms();
    let buyer = ctx.sender();
    let expiry = if (listing.access_ms == 0) {
        MAX_U64
    } else {
        // extend from current expiry if still live, else from now
        let base = if (listing.buyers.contains(buyer)) {
            let cur = *listing.buyers.borrow(buyer);
            if (cur > now) cur else now
        } else now;
        // saturating add — a long subscription never overflows into a lockout
        if (base > MAX_U64 - listing.access_ms) MAX_U64 else base + listing.access_ms
    };
    if (listing.buyers.contains(buyer)) {
        *listing.buyers.borrow_mut(buyer) = expiry;
    } else {
        listing.buyers.add(buyer, expiry);
    };

    listing.total_sales = listing.total_sales + 1;
    market.total_volume = market.total_volume + listing.price;
    event::emit(Purchased { listing_id: object::id(listing), buyer, price: listing.price, expiry_ms: expiry });
}

/// Seal gate. Key servers dry-run this before issuing decryption shares:
/// succeeds iff `id` matches the listing's seal identity AND the caller is the
/// strategist or a buyer with unexpired access.
public fun seal_approve<Q>(
    listing: &Listing<Q>,
    clock: &sui::clock::Clock,
    id: vector<u8>,
    ctx: &TxContext,
) {
    assert!(id == listing.seal_identity, EBadIdentity);
    let caller = ctx.sender();
    if (caller == listing.strategist) return;
    assert!(listing.buyers.contains(caller), ENoAccess);
    assert!(*listing.buyers.borrow(caller) > clock.timestamp_ms(), ENoAccess);
}

/// Strategist ships a new playbook version (same listing, same buyers).
public fun update_playbook<Q>(
    listing: &mut Listing<Q>,
    new_playbook_blob: u256,
    new_manifest_blob: u256,
    ctx: &TxContext,
) {
    assert!(ctx.sender() == listing.strategist, ENotStrategist);
    listing.playbook_blob_id = new_playbook_blob;
    listing.manifest_blob_id = new_manifest_blob;
    listing.version = listing.version + 1;
    event::emit(PlaybookUpdated {
        listing_id: object::id(listing),
        new_blob: new_playbook_blob,
        new_version: listing.version,
    });
}

public fun set_active<Q>(listing: &mut Listing<Q>, active: bool, ctx: &TxContext) {
    assert!(ctx.sender() == listing.strategist, ENotStrategist);
    listing.active = active;
}

public fun set_fee_bps(market: &mut Market, _cap: &MarketAdminCap, fee_bps: u64) {
    assert!(fee_bps <= MAX_FEE_BPS, EFeeTooHigh);
    market.fee_bps = fee_bps;
}

public fun withdraw_proceeds<Q>(listing: &mut Listing<Q>, ctx: &mut TxContext): Coin<Q> {
    assert!(ctx.sender() == listing.strategist, ENotStrategist);
    let amount = listing.proceeds.value();
    event::emit(ProceedsClaimed {
        listing_id: object::id(listing),
        strategist: listing.strategist,
        amount,
    });
    listing.proceeds.split(amount).into_coin(ctx)
}

public fun withdraw_fees<Q>(listing: &mut Listing<Q>, _cap: &MarketAdminCap, ctx: &mut TxContext): Coin<Q> {
    let amount = listing.fees.value();
    listing.fees.split(amount).into_coin(ctx)
}

// === views ===

public fun has_access<Q>(listing: &Listing<Q>, clock: &sui::clock::Clock, who: address): bool {
    if (who == listing.strategist) return true;
    if (!listing.buyers.contains(who)) return false;
    *listing.buyers.borrow(who) > clock.timestamp_ms()
}

public fun price<Q>(l: &Listing<Q>): u64 { l.price }
public fun strategist<Q>(l: &Listing<Q>): address { l.strategist }
public fun playbook_blob<Q>(l: &Listing<Q>): u256 { l.playbook_blob_id }
public fun manifest_blob<Q>(l: &Listing<Q>): u256 { l.manifest_blob_id }
public fun seal_identity<Q>(l: &Listing<Q>): vector<u8> { l.seal_identity }
public fun total_sales<Q>(l: &Listing<Q>): u64 { l.total_sales }
public fun proceeds_value<Q>(l: &Listing<Q>): u64 { l.proceeds.value() }
public fun fee_bps(m: &Market): u64 { m.fee_bps }
public fun total_volume(m: &Market): u64 { m.total_volume }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
