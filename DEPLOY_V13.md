# DART v13 Deployment Checklist

## 1. Deploy `dart_mirror_v13.aleo`

```bash
cd /Users/cyber/Downloads/Aleo/dart_mirror_v13
leo build
leo deploy --private-key "$PRIVATE_KEY" --network testnet --endpoint https://api.explorer.provable.com/v1 --yes
```

Record:
- deployed program id: `dart_mirror_v13.aleo`
- deployed program address / vault: `aleo1k0lr7req80vpmr2te8qetzg4j6kr08p7n6y7p58wm3dw9axwhcgslkzt8y`
- deployment tx: `at128sg8ddc692qewmctx5lq82rpvshznfezylmwf2g8lu2krwv6qpq3ekkke`
- init_admin tx: `at1u47tzlk38wk9adscwej74l9lw7ck2tlhk8jvp3z9e8smgtw8s5rsuxm9vj`

## 2. Initialize admin + vault

Use the deployed program owner address as the public vault.

```bash
leo execute init_admin aleo1k0lr7req80vpmr2te8qetzg4j6kr08p7n6y7p58wm3dw9axwhcgslkzt8y --broadcast --yes
```

## 3. Backend env

Set these on Railway:

```env
MIRROR_ENABLED=true
MIRROR_PROJECT_DIR=/app/dart_mirror_v13
MIRROR_PROGRAM=dart_mirror_v13.aleo
MIRROR_PROGRAM_ADDRESS=aleo1k0lr7req80vpmr2te8qetzg4j6kr08p7n6y7p58wm3dw9axwhcgslkzt8y
MIRROR_VAULT_ADDRESS=aleo1k0lr7req80vpmr2te8qetzg4j6kr08p7n6y7p58wm3dw9axwhcgslkzt8y
MIRROR_CREATE_ON_CHAIN=true
MIRROR_RESOLVE_ON_CHAIN=true
MIRROR_QUERY=
MIRROR_LIMIT=18
MIRROR_MIN_VOLUME=50
MIRROR_CLOSE_BUFFER_BLOCKS=5
```

Keep existing resolver envs for the legacy BTC path only if you still need it for comparison.

## 4. Frontend env

Set on Vercel:

```env
NEXT_PUBLIC_MIRROR_PROGRAM=dart_mirror_v13.aleo
NEXT_PUBLIC_BACKEND_URL=<YOUR_BACKEND_URL>
```

## 5. Smoke test

Run this exact path:

1. Open `/markets`
2. Confirm the `DART v13` mirror section appears first
3. Pick a mirrored market that says `Live on Aleo`
4. Place one private trade
5. Confirm the position appears in portfolio
6. Resolve the market through the backend mirror engine or admin path
7. Claim if winner, refund if cancelled, forfeit if loser
8. Confirm settlement goes to a private USDCx record in the wallet

## 6. Demo path

Use this pitch:

`DART mirrors high-signal public markets into Aleo-native private rooms, where bet direction stays hidden during active betting and winnings settle to shielded USDCx records.`

## 7. What to avoid saying

Do not say:
- fully trustless oracle resolution
- hidden bet size
- dark-pool amount privacy

Do say:
- hidden bet direction during active betting
- private rooms
- shielded payouts
- autonomous mirrored market creation and resolution
