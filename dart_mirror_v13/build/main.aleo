import merkle_tree.aleo;
import test_usdcx_multisig_core.aleo;
import test_usdcx_freezelist.aleo;
import test_usdcx_stablecoin.aleo;
program dart_mirror_v13.aleo;

record BetReceipt:
    owner as address.private;
    mid as u64.private;
    side as boolean.private;
    amt as u128.private;
    payout as u128.private;

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

mapping mc:
    key as u64.public;
    value as u32.public;

mapping mo:
    key as u64.public;
    value as u8.public;

mapping ym:
    key as u64.public;
    value as u64.public;

mapping nm:
    key as u64.public;
    value as u64.public;

mapping wu:
    key as u64.public;
    value as u32.public;

mapping su:
    key as u64.public;
    value as u32.public;

mapping rb:
    key as u64.public;
    value as u128.public;

mapping ol:
    key as u64.public;
    value as u128.public;

mapping tp:
    key as u64.public;
    value as u128.public;

mapping pp:
    key as u64.public;
    value as u128.public;

mapping wp:
    key as u64.public;
    value as u128.public;

mapping bc:
    key as u64.public;
    value as u64.public;

mapping sc:
    key as u64.public;
    value as u64.public;

mapping sh:
    key as u64.public;
    value as field.public;

mapping ch:
    key as u64.public;
    value as field.public;

mapping rh:
    key as u64.public;
    value as field.public;

mapping sm:
    key as field.public;
    value as u64.public;

function init_admin:
    input r0 as address.public;
    async init_admin self.caller r0 into r1;
    output r1 as dart_mirror_v13.aleo/init_admin.future;

finalize init_admin:
    input r0 as address.public;
    input r1 as address.public;
    contains aa[0u8] into r2;
    not r2 into r3;
    assert.eq r3 true;
    set r0 into aa[0u8];
    set r1 into aa[1u8];

function create_market:
    input r0 as u64.public;
    input r1 as u32.public;
    input r2 as u64.public;
    input r3 as u64.public;
    input r4 as field.public;
    input r5 as field.public;
    async create_market self.caller r0 r1 r2 r3 r4 r5 into r6;
    output r6 as dart_mirror_v13.aleo/create_market.future;

finalize create_market:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u32.public;
    input r3 as u64.public;
    input r4 as u64.public;
    input r5 as field.public;
    input r6 as field.public;
    get aa[0u8] into r7;
    assert.eq r0 r7;
    gt r2 block.height into r8;
    assert.eq r8 true;
    gt r3 10000u64 into r9;
    assert.eq r9 true;
    gt r4 10000u64 into r10;
    assert.eq r10 true;
    contains mc[r1] into r11;
    not r11 into r12;
    assert.eq r12 true;
    contains sm[r5] into r13;
    not r13 into r14;
    assert.eq r14 true;
    set r2 into mc[r1];
    set 0u8 into mo[r1];
    set r3 into ym[r1];
    set r4 into nm[r1];
    set r2 into wu[r1];
    set 0u128 into rb[r1];
    set 0u128 into ol[r1];
    set 0u128 into tp[r1];
    set r5 into sh[r1];
    set r6 into ch[r1];
    set 0field into rh[r1];
    set r1 into sm[r5];

function fund_market:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u128.public;
    call test_usdcx_stablecoin.aleo/transfer_public_as_signer r0 r2 into r3;
    async fund_market r3 self.caller r0 r1 r2 into r4;
    output r4 as dart_mirror_v13.aleo/fund_market.future;

finalize fund_market:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_as_signer.future;
    input r1 as address.public;
    input r2 as address.public;
    input r3 as u64.public;
    input r4 as u128.public;
    await r0;
    get aa[0u8] into r5;
    assert.eq r1 r5;
    contains mc[r3] into r6;
    assert.eq r6 true;
    get aa[1u8] into r7;
    assert.eq r2 r7;
    get.or_use rb[r3] 0u128 into r8;
    add r8 r4 into r9;
    set r9 into rb[r3];

function bet:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as u128.public;
    input r3 as u64.public;
    input r4 as u64.public;
    input r5 as boolean.private;
    gt r2 0u128 into r6;
    assert.eq r6 true;
    ternary r5 r3 r4 into r7;
    cast r7 into r8 as u128;
    mul r2 r8 into r9;
    div r9 10000u128 into r10;
    gt r10 0u128 into r11;
    assert.eq r11 true;
    call test_usdcx_stablecoin.aleo/transfer_public_as_signer r0 r2 into r12;
    cast self.signer r1 r5 r2 r10 into r13 as BetReceipt.record;
    async bet r12 r0 r1 r2 r3 r4 into r14;
    output r13 as BetReceipt.record;
    output r14 as dart_mirror_v13.aleo/bet.future;

finalize bet:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_as_signer.future;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u128.public;
    input r4 as u64.public;
    input r5 as u64.public;
    await r0;
    get aa[1u8] into r6;
    assert.eq r1 r6;
    contains mc[r2] into r7;
    assert.eq r7 true;
    get mo[r2] into r8;
    assert.eq r8 0u8;
    get mc[r2] into r9;
    lt block.height r9 into r10;
    assert.eq r10 true;
    get ym[r2] into r11;
    get nm[r2] into r12;
    assert.eq r4 r11;
    assert.eq r5 r12;
    gte r11 r12 into r13;
    ternary r13 r11 r12 into r14;
    cast r14 into r15 as u128;
    mul r3 r15 into r16;
    div r16 10000u128 into r17;
    get rb[r2] into r18;
    get.or_use tp[r2] 0u128 into r19;
    get.or_use pp[r2] 0u128 into r20;
    get.or_use ol[r2] 0u128 into r21;
    get.or_use bc[r2] 0u64 into r22;
    add r18 r19 into r23;
    gte r23 r20 into r24;
    assert.eq r24 true;
    sub r23 r20 into r25;
    add r25 r3 into r26;
    add r21 r17 into r27;
    gte r26 r27 into r28;
    assert.eq r28 true;
    add r19 r3 into r29;
    set r29 into tp[r2];
    set r27 into ol[r2];
    add r22 1u64 into r30;
    set r30 into bc[r2];

function resolve:
    input r0 as u64.public;
    input r1 as boolean.public;
    input r2 as field.public;
    async resolve self.caller r0 r1 r2 into r3;
    output r3 as dart_mirror_v13.aleo/resolve.future;

finalize resolve:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as boolean.public;
    input r3 as field.public;
    get aa[0u8] into r4;
    assert.eq r0 r4;
    get mc[r1] into r5;
    gte block.height r5 into r6;
    assert.eq r6 true;
    get mo[r1] into r7;
    assert.eq r7 0u8;
    ternary r2 1u8 2u8 into r8;
    add block.height 50u32 into r9;
    add r9 200u32 into r10;
    set r8 into mo[r1];
    set r3 into rh[r1];
    set r9 into wu[r1];
    set r10 into su[r1];

function cancel_market:
    input r0 as u64.public;
    input r1 as field.public;
    async cancel_market self.caller r0 r1 into r2;
    output r2 as dart_mirror_v13.aleo/cancel_market.future;

finalize cancel_market:
    input r0 as address.public;
    input r1 as u64.public;
    input r2 as field.public;
    get aa[0u8] into r3;
    assert.eq r0 r3;
    get mo[r1] into r4;
    assert.eq r4 0u8;
    add block.height 50u32 into r5;
    add r5 200u32 into r6;
    set 3u8 into mo[r1];
    set r2 into rh[r1];
    set r5 into wu[r1];
    set r6 into su[r1];

function claim:
    input r0 as BetReceipt.record;
    call test_usdcx_stablecoin.aleo/transfer_public_to_private r0.owner r0.payout into r1 r2 r3;
    async claim r3 r0.mid r0.side r0.amt r0.payout into r4;
    output r1 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r2 as test_usdcx_stablecoin.aleo/Token.record;
    output r4 as dart_mirror_v13.aleo/claim.future;

finalize claim:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;
    input r1 as u64.public;
    input r2 as boolean.public;
    input r3 as u128.public;
    input r4 as u128.public;
    await r0;
    get mo[r1] into r5;
    gt r5 0u8 into r6;
    assert.eq r6 true;
    assert.neq r5 3u8;
    is.eq r5 1u8 into r7;
    assert.eq r2 r7;
    get ym[r1] into r8;
    get nm[r1] into r9;
    ternary r2 r8 r9 into r10;
    cast r10 into r11 as u128;
    mul r3 r11 into r12;
    div r12 10000u128 into r13;
    assert.eq r4 r13;
    gte r8 r9 into r14;
    ternary r14 r8 r9 into r15;
    cast r15 into r16 as u128;
    mul r3 r16 into r17;
    div r17 10000u128 into r18;
    get.or_use ol[r1] 0u128 into r19;
    get.or_use sc[r1] 0u64 into r20;
    get.or_use pp[r1] 0u128 into r21;
    gte r19 r18 into r22;
    assert.eq r22 true;
    sub r19 r18 into r23;
    set r23 into ol[r1];
    add r21 r4 into r24;
    set r24 into pp[r1];
    add r20 1u64 into r25;
    set r25 into sc[r1];

function forfeit:
    input r0 as BetReceipt.record;
    async forfeit r0.mid r0.side r0.amt r0.payout into r1;
    output r1 as dart_mirror_v13.aleo/forfeit.future;

finalize forfeit:
    input r0 as u64.public;
    input r1 as boolean.public;
    input r2 as u128.public;
    input r3 as u128.public;
    get mo[r0] into r4;
    gt r4 0u8 into r5;
    assert.eq r5 true;
    assert.neq r4 3u8;
    is.eq r4 1u8 into r6;
    assert.neq r1 r6;
    get ym[r0] into r7;
    get nm[r0] into r8;
    ternary r1 r7 r8 into r9;
    cast r9 into r10 as u128;
    mul r2 r10 into r11;
    div r11 10000u128 into r12;
    assert.eq r3 r12;
    gte r7 r8 into r13;
    ternary r13 r7 r8 into r14;
    cast r14 into r15 as u128;
    mul r2 r15 into r16;
    div r16 10000u128 into r17;
    get.or_use ol[r0] 0u128 into r18;
    get.or_use sc[r0] 0u64 into r19;
    gte r18 r17 into r20;
    assert.eq r20 true;
    sub r18 r17 into r21;
    set r21 into ol[r0];
    add r19 1u64 into r22;
    set r22 into sc[r0];

function refund:
    input r0 as BetReceipt.record;
    call test_usdcx_stablecoin.aleo/transfer_public_to_private r0.owner r0.amt into r1 r2 r3;
    async refund r3 r0.mid r0.amt into r4;
    output r1 as test_usdcx_stablecoin.aleo/ComplianceRecord.record;
    output r2 as test_usdcx_stablecoin.aleo/Token.record;
    output r4 as dart_mirror_v13.aleo/refund.future;

finalize refund:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public_to_private.future;
    input r1 as u64.public;
    input r2 as u128.public;
    await r0;
    get mo[r1] into r3;
    assert.eq r3 3u8;
    get ym[r1] into r4;
    get nm[r1] into r5;
    gte r4 r5 into r6;
    ternary r6 r4 r5 into r7;
    cast r7 into r8 as u128;
    mul r2 r8 into r9;
    div r9 10000u128 into r10;
    get.or_use ol[r1] 0u128 into r11;
    get.or_use sc[r1] 0u64 into r12;
    get.or_use pp[r1] 0u128 into r13;
    gte r11 r10 into r14;
    assert.eq r14 true;
    sub r11 r10 into r15;
    set r15 into ol[r1];
    add r13 r2 into r16;
    set r16 into pp[r1];
    add r12 1u64 into r17;
    set r17 into sc[r1];

function sweep_unsettled:
    input r0 as u64.public;
    input r1 as u128.public;
    call test_usdcx_stablecoin.aleo/transfer_public self.caller r1 into r2;
    async sweep_unsettled r2 self.caller r0 r1 into r3;
    output r3 as dart_mirror_v13.aleo/sweep_unsettled.future;

finalize sweep_unsettled:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u128.public;
    await r0;
    get aa[0u8] into r4;
    assert.eq r1 r4;
    get mo[r2] into r5;
    gt r5 0u8 into r6;
    assert.eq r6 true;
    get su[r2] into r7;
    gte block.height r7 into r8;
    assert.eq r8 true;
    get.or_use ol[r2] 0u128 into r9;
    lte r3 r9 into r10;
    assert.eq r10 true;
    sub r9 r3 into r11;
    set r11 into ol[r2];

function withdraw_profit:
    input r0 as u64.public;
    input r1 as u128.public;
    call test_usdcx_stablecoin.aleo/transfer_public self.caller r1 into r2;
    async withdraw_profit r2 self.caller r0 r1 into r3;
    output r3 as dart_mirror_v13.aleo/withdraw_profit.future;

finalize withdraw_profit:
    input r0 as test_usdcx_stablecoin.aleo/transfer_public.future;
    input r1 as address.public;
    input r2 as u64.public;
    input r3 as u128.public;
    await r0;
    get aa[0u8] into r4;
    assert.eq r1 r4;
    get mo[r2] into r5;
    gt r5 0u8 into r6;
    assert.eq r6 true;
    get wu[r2] into r7;
    gte block.height r7 into r8;
    assert.eq r8 true;
    get rb[r2] into r9;
    get tp[r2] into r10;
    get.or_use pp[r2] 0u128 into r11;
    get.or_use ol[r2] 0u128 into r12;
    get.or_use wp[r2] 0u128 into r13;
    add r9 r10 into r14;
    add r11 r12 into r15;
    gte r14 r15 into r16;
    assert.eq r16 true;
    sub r14 r15 into r17;
    gte r17 r13 into r18;
    assert.eq r18 true;
    sub r17 r13 into r19;
    lte r3 r19 into r20;
    assert.eq r20 true;
    add r13 r3 into r21;
    set r21 into wp[r2];

constructor:
    assert.eq edition 0u16;
