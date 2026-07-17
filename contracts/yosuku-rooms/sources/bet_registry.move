/// bet_registry — the on-chain "skin in the game" proof for comment access.
///
/// When a user places a bet through Yosuku, a `record` call is folded into the
/// bet PTB, permanently noting "this address bet on this market". The comment
/// gate (market_room_rule) reads it to decide who may join a market's room.
///
/// The record is PERMANENT (survives the market's fast expiry) so eligibility to
/// discuss a call outlasts the 1m/5m/1h window it was made in. Idempotent per
/// (user, market): betting twice on the same market is a no-op here.
module yosuku_rooms::bet_registry {
    use sui::table::{Self, Table};
    use sui::vec_set::{Self, VecSet};

    /// Shared registry: address → set of market ids that address has bet on.
    public struct BetRegistry has key {
        id: UID,
        bets: Table<address, VecSet<ID>>,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(BetRegistry { id: object::new(ctx), bets: table::new(ctx) });
    }

    /// Mark the caller as a bettor on `market_id`. Folded into the bet PTB.
    public fun record(reg: &mut BetRegistry, market_id: ID, ctx: &TxContext) {
        let user = ctx.sender();
        if (!reg.bets.contains(user)) {
            reg.bets.add(user, vec_set::empty());
        };
        let set = reg.bets.borrow_mut(user);
        if (!set.contains(&market_id)) {
            set.insert(market_id);
        };
    }

    /// Has `user` bet on `market_id`? (the gate check)
    public fun has_bet(reg: &BetRegistry, user: address, market_id: ID): bool {
        reg.bets.contains(user) && reg.bets.borrow(user).contains(&market_id)
    }

    /// How many distinct markets `user` has bet on.
    public fun bet_count(reg: &BetRegistry, user: address): u64 {
        if (!reg.bets.contains(user)) 0 else reg.bets.borrow(user).length()
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) { init(ctx); }
}
