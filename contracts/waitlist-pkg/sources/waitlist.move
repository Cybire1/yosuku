/// On-chain mainnet waitlist — demand as an un-fakeable, verifiable signal.
///
/// "Joining" is a signed transaction by a real wallet, recorded on-chain with a position
/// and an optional referrer. Unlike a Google-Form signup (which anyone can spam), every
/// entry here is a distinct wallet that put an action on-chain — exactly the kind of
/// qualified demand a mainnet-gated prize rewards. The `Joined` event feeds the public
/// traction page; the `joined` table dedups so one wallet counts once.
module waitlist::waitlist;

use sui::{
    clock::Clock,
    event,
    table::{Self, Table},
};

const EAlreadyJoined: u64 = 1;

/// The shared waitlist. Auto-created + shared at publish (`init`).
public struct Waitlist has key {
    id: UID,
    count: u64,
    /// joiner address → 1-indexed position (dedups; one wallet, one slot).
    joined: Table<address, u64>,
}

public struct Joined has copy, drop { who: address, referrer: address, position: u64, joined_ms: u64 }

fun init(ctx: &mut TxContext) {
    transfer::share_object(Waitlist { id: object::new(ctx), count: 0, joined: table::new(ctx) });
}

/// Join the waitlist. The caller's address is recorded with the next position. Pass the
/// zero address for `referrer` if none. Aborts if this wallet has already joined.
public fun join(w: &mut Waitlist, referrer: address, clock: &Clock, ctx: &mut TxContext) {
    let who = ctx.sender();
    assert!(!table::contains(&w.joined, who), EAlreadyJoined);
    w.count = w.count + 1;
    table::add(&mut w.joined, who, w.count);
    event::emit(Joined { who, referrer, position: w.count, joined_ms: clock.timestamp_ms() });
}

// ── views ──
public fun count(w: &Waitlist): u64 { w.count }
public fun has_joined(w: &Waitlist, who: address): bool { table::contains(&w.joined, who) }
public fun position_of(w: &Waitlist, who: address): u64 { *table::borrow(&w.joined, who) }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
