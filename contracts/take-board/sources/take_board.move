/// take_board — the discovery layer for "post a take".
///
/// A take's CONTENT (the caption + rendered card) lives on Walrus; its PROOF
/// lives on the 6-24 venue (the real position). This module is the thin,
/// decentralized index that ties them together: `post_take` emits a `TakePosted`
/// event carrying the Walrus blob id plus a pointer to the market/position, and
/// the feed reads those events to discover takes — no central server, and every
/// take is verifiable on-chain.
///
/// Gas-light by design: one event, no created objects. Anyone can post; the moat
/// is the OPTIONAL backing `order_id`, which the feed surfaces as a verifiable
/// position ("this caller has skin in the game"). Enforcing the position at post
/// time (so a take REQUIRES a real bet) is a later addition that reuses the same
/// position-proof the comment gate needs.
module yosuku_takes::take_board {
    use std::string::String;
    use sui::clock::Clock;
    use sui::event;

    /// `side` must be 0 (up), 1 (down) or 2 (range).
    const E_BAD_SIDE: u64 = 0;
    /// A take must point at a real Walrus blob.
    const E_EMPTY_BLOB: u64 = 1;

    /// Emitted once per posted take. Indexed by the feed; the full content is the
    /// Walrus blob at `blob_id`.
    public struct TakePosted has copy, drop {
        /// wallet that posted the take
        author: address,
        /// Walrus blob id of the take JSON (the content layer)
        blob_id: String,
        /// the 6-24 market the call is on
        market_id: address,
        /// the backing position (0 = a call with no bet linked yet)
        order_id: u256,
        /// 0 = up (over strike) · 1 = down (under strike) · 2 = range (band)
        side: u8,
        /// whole-dollar strike, or band center for a range; 0 for none
        strike_usd: u64,
        /// canonical post time from the on-chain clock (ms)
        ts_ms: u64,
    }

    /// Post a take. One event, no objects — cheap enough to sponsor gas-free like
    /// the rest of the app.
    public fun post_take(
        blob_id: String,
        market_id: address,
        order_id: u256,
        side: u8,
        strike_usd: u64,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert!(side <= 2, E_BAD_SIDE);
        assert!(blob_id.length() > 0, E_EMPTY_BLOB);
        event::emit(TakePosted {
            author: ctx.sender(),
            blob_id,
            market_id,
            order_id,
            side,
            strike_usd,
            ts_ms: clock.timestamp_ms(),
        });
    }
}
