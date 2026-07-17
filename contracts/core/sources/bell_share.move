/// BELL_SHARE — the fungible vault share for a yosuku_vault (ERC-4626-style).
/// A standard `Coin<BELL_SHARE>` so a Predict vault position composes with the
/// rest of Sui DeFi instead of being a siloed receipt.
module suioverflow::bell_share;

use sui::coin::{Self, TreasuryCap};

public struct BELL_SHARE has drop {}

// create_currency is the stable path today; coin_registry migration is a fast-follow.
#[allow(deprecated_usage)]
fun init(witness: BELL_SHARE, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        6,
        b"BELL",
        b"Bell Share",
        b"yosuku vault share — a fungible claim on a DeepBook Predict strategy vault",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    // The deployer hands this TreasuryCap to yosuku_vault::open.
    transfer::public_transfer(treasury, ctx.sender());
}

#[test_only]
#[allow(deprecated_usage)]
public fun new_treasury_for_testing(ctx: &mut TxContext): TreasuryCap<BELL_SHARE> {
    let (treasury, metadata) = coin::create_currency(
        BELL_SHARE {},
        6,
        b"BELL",
        b"Bell Share",
        b"test",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    treasury
}
