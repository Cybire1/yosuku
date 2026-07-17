/// Memory Market — an agent's MemWal memory as a priced, tradable, on-chain asset.
///
/// This realizes Walrus's "memory becomes a composable, tradable construct" thesis on top of
/// Yosuku's strategy agents: the agent's *memory itself* — not just copy-trading access — becomes
/// the priced asset. A buyer pays to mint a `MemoryPass` (a transferable on-chain object); the
/// creator earns the price; the pass gates access to the playbook (Seal).
///
/// TRUST MODEL: listing is ADMIN-GATED. Only the `AdminCap` holder (the platform) can create a
/// listing, on behalf of a strategy's verified `creator`. This is the on-chain allowlist that
/// prevents a random user from listing a fake market on an agent they don't own and siphoning
/// buyers' funds. (A fully permissionless version would require proving Strategy ownership via the
/// strategy package's `StrategyCap` — deferred because that package carries a DeepBook dep that
/// blocks publishes.) Standalone package: sui-framework only.
module memory_market::memory_market;

use sui::coin::{Self, Coin};
use sui::event;

const EUnderpaid: u64 = 1;
const ENotCreator: u64 = 2;
const ENoAccess: u64 = 3;

/// Platform admin — only the holder may create listings (curation; prevents fake listings).
/// Created once at publish and transferred to the publisher.
public struct AdminCap has key, store { id: UID }

/// A memory listed for sale for a given strategy. Shared.
public struct MemoryListing<phantom T> has key {
    id: UID,
    /// the on-chain Strategy object whose memory this is.
    strategy: ID,
    /// the strategy's verified creator — earns the price.
    creator: address,
    /// the MemWal memory account (for verify / reference).
    memory_account: address,
    /// price of one MemoryPass, in `T`.
    price: u64,
    passes_sold: u64,
}

/// Creator's control handle for a listing (price updates).
public struct MemoryListingCap has key, store { id: UID, listing: ID }

/// A purchased license to an agent's memory — a transferable on-chain asset.
public struct MemoryPass has key, store {
    id: UID,
    listing: ID,
    strategy: ID,
    buyer: address,
    paid: u64,
}

public struct MemoryListed has copy, drop { listing: ID, strategy: ID, creator: address, memory_account: address, price: u64 }
public struct MemoryPriceSet has copy, drop { listing: ID, price: u64 }
public struct MemoryPassSold has copy, drop { listing: ID, strategy: ID, buyer: address, paid: u64, passes_sold: u64 }

/// One-time: mint the AdminCap to the publisher.
fun init(ctx: &mut TxContext) {
    transfer::public_transfer(AdminCap { id: object::new(ctx) }, ctx.sender());
}

/// Admin: list a strategy's memory for sale on behalf of its verified `creator` (who earns).
/// Admin-gated so a random caller can't list a fake market on an agent they don't own.
public fun list_memory<T>(
    _admin: &AdminCap,
    strategy: ID,
    creator: address,
    memory_account: address,
    price: u64,
    ctx: &mut TxContext,
): MemoryListingCap {
    let listing = MemoryListing<T> {
        id: object::new(ctx),
        strategy,
        creator,
        memory_account,
        price,
        passes_sold: 0,
    };
    let lid = object::id(&listing);
    event::emit(MemoryListed { listing: lid, strategy, creator, memory_account, price });
    transfer::share_object(listing);
    MemoryListingCap { id: object::new(ctx), listing: lid }
}

/// Creator: update the price (cap-gated).
public fun set_price<T>(listing: &mut MemoryListing<T>, cap: &MemoryListingCap, price: u64) {
    assert!(cap.listing == object::id(listing), ENotCreator);
    listing.price = price;
    event::emit(MemoryPriceSet { listing: object::id(listing), price });
}

/// Buyer: pay AT LEAST the price. The creator is charged EXACTLY `price`; any excess is refunded
/// to the buyer (so a price drop between fetch and buy never overcharges).
public fun buy_pass<T>(listing: &mut MemoryListing<T>, mut payment: Coin<T>, ctx: &mut TxContext): MemoryPass {
    assert!(coin::value(&payment) >= listing.price, EUnderpaid);
    let exact = coin::split(&mut payment, listing.price, ctx);
    transfer::public_transfer(exact, listing.creator);
    // refund any excess to the buyer
    if (coin::value(&payment) > 0) {
        transfer::public_transfer(payment, ctx.sender());
    } else {
        coin::destroy_zero(payment);
    };
    listing.passes_sold = listing.passes_sold + 1;
    let pass = MemoryPass {
        id: object::new(ctx),
        listing: object::id(listing),
        strategy: listing.strategy,
        buyer: ctx.sender(),
        paid: listing.price,
    };
    event::emit(MemoryPassSold { listing: object::id(listing), strategy: listing.strategy, buyer: ctx.sender(), paid: listing.price, passes_sold: listing.passes_sold });
    pass
}

/// Seal access policy: decryption is allowed only to holders of a pass for this listing.
entry fun seal_approve(id: vector<u8>, pass: &MemoryPass) {
    assert!(id == object::id_to_bytes(&pass.listing), ENoAccess);
}

// ── views ──
public fun price<T>(l: &MemoryListing<T>): u64 { l.price }
public fun passes_sold<T>(l: &MemoryListing<T>): u64 { l.passes_sold }
public fun strategy<T>(l: &MemoryListing<T>): ID { l.strategy }
public fun creator<T>(l: &MemoryListing<T>): address { l.creator }
public fun memory_account<T>(l: &MemoryListing<T>): address { l.memory_account }
public fun pass_listing(p: &MemoryPass): ID { p.listing }
public fun pass_strategy(p: &MemoryPass): ID { p.strategy }
public fun pass_buyer(p: &MemoryPass): address { p.buyer }

#[test_only]
public fun new_admin_for_testing(ctx: &mut TxContext): AdminCap { AdminCap { id: object::new(ctx) } }
