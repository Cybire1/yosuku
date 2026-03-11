import merkle_tree.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import test_usdcx_stablecoin.aleo;
program btc_pred_v8.aleo;

record BetReceipt:
    owner as address.private;
    rid as u64.private;
    commit as field.private;

struct BetCommit:
    side as boolean;
    amt as u128;
    salt as field;

struct MerkleProof:
    siblings as [field; 16u32];
    leaf_index as u32;

struct WalletEcdsaSigner:
    wallet_id as address;
    ecdsa_signer as [u8; 20u32];

struct AdminOp:
    op as u8;
    threshold as u8;
    aleo_signer as address;
    ecdsa_signer as [u8; 20u32];

mapping aa:
    key as u8.public;
    value as address.public;

mapping rt:
    key as u64.public;
    value as u64.public;

mapping rd:
    key as u64.public;
    value as u32.public;

mapping ro:
    key as u64.public;
    value as u8.public;

mapping rp:
    key as u64.public;
    value as u128.public;

mapping ry:
    key as u64.public;
    value as u128.public;

mapping rn:
    key as u64.public;
    value as u128.public;

mapping cl:
    key as field.public;
    value as boolean.public;

mapping fe:
    key as u8.public;
    value as u128.public;

mapping bc:
    key as field.public;
    value as field.public;

mapping ba:
    key as field.public;
    value as u128.public;

function init_admin:
    async init_admin self.caller into r0;
    output r0 as btc_pred_v8.aleo/init_admin.future;

finalize init_admin:
    input r0 as address.public;
    contains aa[0u8] into r1;
    not r1 into r2;
    assert.eq r2 true;
    set r0 into aa[0u8];

function create_round:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as u32.public;
    input r3 as u128.public;
    async create_round self.caller r0 r1 r2 r3 into r4;
    output r4 as btc_pred_v8.aleo/create_round.future;

finalize create_round:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as u32.public;
    input r4 as u128.public;
    get aa[0u8] into r5;
    assert.eq r0 r5;
    gt r3 block.height into r6;
    assert.eq r6 true;
    set r2 into rt[r1];
    set r3 into rd[r1];
    set 0u8 into ro[r1];
    mul r4 2u128 into r7;
    set r7 into rp[r1];

function bet:
    input r0 as u64.public;
    input r1 as u128.private;
    input r2 as boolean.private;
    input r3 as field.private;
    gt r1 0u128 into r4;
    assert.eq r4 true;
    cast r2 r1 r3 into r5 as BetCommit;
    hash.bhp256 r5 into r6 as field;
    hash.bhp256 self.caller into r7 as field;
    hash.bhp256 r0 into r8 as field;
    add r7 r8 into r9;
    cast self.caller r0 r6 into r10 as BetReceipt.record;
    async bet self.caller r0 r1 r9 r6 into r11;
    output r10 as BetReceipt.record;
    output r11 as btc_pred_v8.aleo/bet.future;

finalize bet:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u128.public;
    input r3 as field.public;
    input r4 as field.public;
    get ro[r1] into r5;
    assert.eq r5 0u8;
    get rd[r1] into r6;
    lt block.height r6 into r7;
    assert.eq r7 true;
    contains bc[r3] into r8;
    not r8 into r9;
    assert.eq r9 true;
    get.or_use rp[r1] 0u128 into r10;
    add r10 r2 into r11;
    set r11 into rp[r1];
    set r4 into bc[r3];
    set r2 into ba[r3];

function resolve:
    input r0 as u64.public;
    input r1 as u64.public;
    input r2 as u128.public;
    input r3 as u128.public;
    async resolve self.caller r0 r1 r2 r3 into r4;
    output r4 as btc_pred_v8.aleo/resolve.future;

finalize resolve:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u64.public;
    input r3 as u128.public;
    input r4 as u128.public;
    get aa[0u8] into r5;
    assert.eq r0 r5;
    get rd[r1] into r6;
    gte block.height r6 into r7;
    assert.eq r7 true;
    get rp[r1] into r8;
    add r3 r4 into r9;
    assert.eq r9 r8;
    set r3 into ry[r1];
    set r4 into rn[r1];
    get rt[r1] into r10;
    gte r2 r10 into r11;
    ternary r11 1u8 2u8 into r12;
    set r12 into ro[r1];

function claim:
    input r0 as u64.public;
    input r1 as boolean.private;
    input r2 as u128.private;
    input r3 as field.private;
    input r4 as u128.public;
    gt r4 0u128 into r5;
    assert.eq r5 true;
    cast r1 r2 r3 into r6 as BetCommit;
    hash.bhp256 r6 into r7 as field;
    hash.bhp256 self.caller into r8 as field;
    hash.bhp256 r0 into r9 as field;
    add r8 r9 into r10;
    call test_usdcx_stablecoin.aleo/transfer_public self.caller r4 into r11;
    async claim r11 r10 r0 r1 r2 r7 r4 into r12;
    output r12 as btc_pred_v8.aleo/claim.future;

finalize claim:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    input r1 as field.public;
    input r2 as u64.public;
    input r3 as boolean.public;
    input r4 as u128.public;
    input r5 as field.public;
    input r6 as u128.public;
    await r0;
    get bc[r1] into r7;
    assert.eq r5 r7;
    get ba[r1] into r8;
    assert.eq r4 r8;
    get ro[r2] into r9;
    gt r9 0u8 into r10;
    assert.eq r10 true;
    is.eq r9 1u8 into r11;
    assert.eq r3 r11;
    get.or_use cl[r1] false into r12;
    not r12 into r13;
    assert.eq r13 true;
    set true into cl[r1];
    get ry[r2] into r14;
    get rn[r2] into r15;
    add r14 r15 into r16;
    ternary r3 r14 r15 into r17;
    mul r4 r16 into r18;
    div r18 r17 into r19;
    mul r19 9u128 into r20;
    div r20 10u128 into r21;
    lte r6 r21 into r22;
    assert.eq r22 true;
    sub r19 r21 into r23;
    get.or_use fe[0u8] 0u128 into r24;
    add r24 r23 into r25;
    set r25 into fe[0u8];

function forfeit:
    input r0 as u64.public;
    input r1 as boolean.private;
    input r2 as u128.private;
    input r3 as field.private;
    cast r1 r2 r3 into r4 as BetCommit;
    hash.bhp256 r4 into r5 as field;
    hash.bhp256 self.caller into r6 as field;
    hash.bhp256 r0 into r7 as field;
    add r6 r7 into r8;
    async forfeit r8 r0 r1 r5 into r9;
    output r9 as btc_pred_v8.aleo/forfeit.future;

finalize forfeit:
    input r0 as field.public;
    input r1 as u64.public;
    input r2 as boolean.public;
    input r3 as field.public;
    get bc[r0] into r4;
    assert.eq r3 r4;
    get ro[r1] into r5;
    gt r5 0u8 into r6;
    assert.eq r6 true;
    is.eq r5 1u8 into r7;
    assert.neq r2 r7;
    get.or_use cl[r0] false into r8;
    not r8 into r9;
    assert.eq r9 true;
    set true into cl[r0];

function withdraw_fees:
    input r0 as u128.public;
    call test_usdcx_stablecoin.aleo/transfer_public self.caller r0 into r1;
    async withdraw_fees r1 self.caller r0 into r2;
    output r2 as btc_pred_v8.aleo/withdraw_fees.future;

finalize withdraw_fees:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    input r1 as address.public;
    input r2 as u128.public;
    await r0;
    get aa[0u8] into r3;
    assert.eq r1 r3;
    get.or_use fe[0u8] 0u128 into r4;
    lte r2 r4 into r5;
    assert.eq r5 true;
    sub r4 r2 into r6;
    set r6 into fe[0u8];

constructor:
    assert.eq edition 0u16;
