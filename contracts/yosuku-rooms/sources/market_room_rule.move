/// market_room_rule — a position-gated comment room, forked from Mysten's
/// example_app::paid_join_rule. Same actor pattern (a shared rule granted
/// ExtensionPermissionsAdmin adds members via `object_grant_permission`), but the
/// gate is "you bet on this market" (bet_registry) instead of "you paid a fee".
///
/// A room is bound to ONE market. Any take on that market opens the same room, so
/// people with skin in the game on that market can read AND post. Joiners get both
/// MessagingReader (read/decrypt) and MessagingSender (post).
module yosuku_rooms::market_room_rule {
    use sui_groups::permissioned_group::{PermissionedGroup, ExtensionPermissionsAdmin};
    use sui_stack_messaging::messaging::{Self, Messaging, MessagingReader, MessagingSender, MessagingNamespace};
    use sui_stack_messaging::group_manager::GroupManager;
    use sui_stack_messaging::version::Version;
    use yosuku_rooms::bet_registry::{Self, BetRegistry};
    use sui::vec_set;
    use std::string::String;

    /// Group passed to join() doesn't match the rule's group.
    const EGroupMismatch: u64 = 0;
    /// Caller has no bet on this room's market — no skin in the game.
    const ENoPosition: u64 = 1;

    /// Actor object for a per-market comment room. Must be granted
    /// `ExtensionPermissionsAdmin` on its group so `join()` can add members.
    public struct MarketRoomRule has key {
        id: UID,
        /// the group this rule controls
        group_id: ID,
        /// the market a caller must have bet on to join
        market_id: ID,
    }

    public fun new(group_id: ID, market_id: ID, ctx: &mut TxContext): MarketRoomRule {
        MarketRoomRule { id: object::new(ctx), group_id, market_id }
    }

    public fun share(rule: MarketRoomRule) { transfer::share_object(rule); }

    /// Create a market's comment room + its position gate in one transaction:
    /// makes the messaging group, creates the rule, grants the rule admin so it
    /// can add members, and shares everything.
    #[allow(lint(share_owned))]
    entry fun create_market_room(
        version: &Version,
        namespace: &mut MessagingNamespace,
        group_manager: &GroupManager,
        name: String,
        uuid: String,
        initial_encrypted_dek: vector<u8>,
        market_id: ID,
        ctx: &mut TxContext,
    ) {
        let (mut group, encryption_history) = messaging::create_group(
            version,
            namespace,
            group_manager,
            name,
            uuid,
            initial_encrypted_dek,
            vec_set::empty(),
            ctx,
        );
        let rule = new(object::id(&group), market_id, ctx);
        let rule_address = object::id(&rule).to_address();
        group.grant_permission<Messaging, ExtensionPermissionsAdmin>(rule_address, ctx);
        transfer::public_share_object(group);
        transfer::public_share_object(encryption_history);
        share(rule);
    }

    /// Self-serve join: allowed only if the caller bet on the room's market.
    /// Grants MessagingReader + MessagingSender (read + post).
    ///
    /// Aborts: EGroupMismatch (wrong group), ENoPosition (no bet on this market).
    public fun join(
        rule: &mut MarketRoomRule,
        group: &mut PermissionedGroup<Messaging>,
        registry: &BetRegistry,
        ctx: &TxContext,
    ) {
        assert!(object::id(group) == rule.group_id, EGroupMismatch);
        assert!(bet_registry::has_bet(registry, ctx.sender(), rule.market_id), ENoPosition);
        group.object_grant_permission<Messaging, MessagingReader>(&rule.id, ctx.sender());
        group.object_grant_permission<Messaging, MessagingSender>(&rule.id, ctx.sender());
    }

    /// Entry version for CLI/PTB use.
    entry fun join_entry(
        rule: &mut MarketRoomRule,
        group: &mut PermissionedGroup<Messaging>,
        registry: &BetRegistry,
        ctx: &TxContext,
    ) {
        join(rule, group, registry, ctx);
    }

    // === getters ===
    public fun group_id(rule: &MarketRoomRule): ID { rule.group_id }
    public fun market_id(rule: &MarketRoomRule): ID { rule.market_id }
}
