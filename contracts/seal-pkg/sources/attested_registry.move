/// Trustless claim authority — the hardened `set_owner`.
///
/// Same role as `handle_registry`, but the binding (handle → wallet) is authorized ONLY by an
/// ed25519 signature from a pinned `binder` key — the **attested Nitro enclave's** key — over
/// `(account_key ++ owner_address)`. There is NO admin path: no human (not the relay, not us) can
/// rebind an account, because nobody can forge the enclave's signature. The enclave produces it
/// only after verifying handle ownership inside Nitro. That makes "only you — not even us" literally true.
///
/// (Wiring the enclave to verify-then-sign is the remaining EIF work; this is the on-chain gate it plugs into.)
module yosuku_seal::attested_registry;

use sui::{ed25519, address, event, table::{Self, Table}};

const ENoOwner: u64 = 2;
const ENotOwner: u64 = 3;
const EBadNamespace: u64 = 4;
const EBadSig: u64 = 5;

/// account key (seal-id suffix) → the wallet allowed to unseal. `binder` = the enclave pubkey
/// that is the ONLY authority able to write a binding. Shared.
public struct AttestedRegistry has key {
    id: UID,
    binder: vector<u8>,
    owners: Table<vector<u8>, address>,
}

public struct RegistryCreated has copy, drop { registry: ID, binder: vector<u8> }
public struct OwnerBound has copy, drop { registry: ID, key: vector<u8>, owner: address }

/// Create the shared registry, pinning the enclave's ed25519 pubkey as the sole binding authority.
public fun create_registry(binder: vector<u8>, ctx: &mut TxContext) {
    let reg = AttestedRegistry { id: object::new(ctx), binder, owners: table::new(ctx) };
    event::emit(RegistryCreated { registry: object::id(&reg), binder });
    transfer::share_object(reg);
}

/// Bind `key → owner`, but ONLY if the enclave signed `(key ++ owner)`. No admin override exists —
/// the relay can submit this tx (and pay gas), but it cannot forge `sig`, so it cannot rebind to itself.
public fun set_owner_attested(reg: &mut AttestedRegistry, key: vector<u8>, owner: address, sig: vector<u8>) {
    let mut msg = key;
    vector::append(&mut msg, address::to_bytes(owner));
    assert!(ed25519::ed25519_verify(&sig, &reg.binder, &msg), EBadSig);
    if (table::contains(&reg.owners, key)) {
        *table::borrow_mut(&mut reg.owners, key) = owner;
    } else {
        table::add(&mut reg.owners, key, owner);
    };
    event::emit(OwnerBound { registry: object::id(reg), key, owner });
}

public fun has_owner(reg: &AttestedRegistry, key: vector<u8>): bool { table::contains(&reg.owners, key) }
public fun owner_of(reg: &AttestedRegistry, key: vector<u8>): address { *table::borrow(&reg.owners, key) }
public fun binder(reg: &AttestedRegistry): vector<u8> { reg.binder }

/// Seal approval — unchanged: decryption is gated to the bound owner. `id` = registry-id ++ key.
entry fun seal_approve(id: vector<u8>, reg: &AttestedRegistry, ctx: &TxContext) {
    let ns = object::id(reg).to_bytes();
    assert!(starts_with(&id, &ns), EBadNamespace);
    let key = suffix(&id, ns.length());
    assert!(table::contains(&reg.owners, key), ENoOwner);
    assert!(ctx.sender() == *table::borrow(&reg.owners, key), ENotOwner);
}

fun starts_with(haystack: &vector<u8>, needle: &vector<u8>): bool {
    if (needle.length() > haystack.length()) { return false };
    let mut i = 0;
    while (i < needle.length()) { if (haystack[i] != needle[i]) { return false }; i = i + 1; };
    true
}
fun suffix(v: &vector<u8>, from: u64): vector<u8> {
    let mut out = vector[]; let n = v.length(); let mut i = from;
    while (i < n) { out.push_back(v[i]); i = i + 1; };
    out
}

// ─── tests (vector signed off-chain by a stand-in binder key) ───
#[test_only] use sui::test_scenario as ts;
#[test_only] const BINDER: vector<u8> = x"dcbfd65e01f3840b6551467d36c4e02a354921ede08d1eb28329da95166af12a";
#[test_only] const SIG: vector<u8> = x"1b3c6d8028b26be167ea8acb74c6086af469fc02287d0a70cb17aa9f56d2d8945e08ae70d1a58316c1f1f4e71cb4477821b0cb93596c98c12ce8f9239c807f05";
#[test_only] const OWNER: address = @0xabababababababababababababababababababababababababababababababab;

#[test]
fun attested_binding_with_enclave_sig() {
    let mut sc = ts::begin(@0xA);
    create_registry(BINDER, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, @0xA);
    let mut reg = ts::take_shared<AttestedRegistry>(&sc);
    set_owner_attested(&mut reg, b"2002090717779460096", OWNER, SIG);   // valid enclave sig → binds
    assert!(owner_of(&reg, b"2002090717779460096") == OWNER, 0);
    ts::return_shared(reg);
    ts::end(sc);
}

#[test]
#[expected_failure(abort_code = EBadSig)]
fun forged_sig_rejected() {
    let mut sc = ts::begin(@0xA);
    create_registry(BINDER, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, @0xA);
    let mut reg = ts::take_shared<AttestedRegistry>(&sc);
    // a bogus signature (not from the binder) → ed25519_verify fails → abort
    set_owner_attested(&mut reg, b"2002090717779460096", OWNER, x"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000");
    ts::return_shared(reg);
    ts::end(sc);
}

#[test]
#[expected_failure(abort_code = EBadSig)]
fun wrong_owner_rejected() {
    let mut sc = ts::begin(@0xA);
    create_registry(BINDER, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, @0xA);
    let mut reg = ts::take_shared<AttestedRegistry>(&sc);
    // valid sig but for a DIFFERENT owner → the signed message no longer matches → abort
    set_owner_attested(&mut reg, b"2002090717779460096", @0xdead, SIG);
    ts::return_shared(reg);
    ts::end(sc);
}
