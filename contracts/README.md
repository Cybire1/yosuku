# Yosuku Move contracts

The on-chain layer behind the app. Each folder is a self-contained Sui Move package
(`Move.toml` + `sources/` + `tests/`), deployed on Sui testnet. Vendored dependencies
(Mysten DeepBook, framework) are intentionally not included here; these are Yosuku's own
modules.

| Package | What it does |
| --- | --- |
| `core/` | Core spine: strategy market, policy vault, risk guardian, audit log, vault. |
| `predict624-vault/` | Non-custodial account wrapper for the DeepBook Predict 6-24 venue. |
| `parlay624-pkg/` | Multi-leg parlay tickets, settled on the venue's own propbook print. |
| `leverage-pkg/` | Leveraged positions and margin liquidation. |
| `take-board/` | On-chain board of "takes" for social discovery. |
| `memory_market/` | Memory as a priced, tradeable on-chain asset. |
| `seal-pkg/` | Seal-gated encrypted content (comments / memory). |
| `attreg-pkg/` | Attestation registry for the Nautilus enclave (agent PCRs). |
| `yosuku-rooms/` | On-chain messaging rooms. |
| `waitlist-pkg/` | Waitlist. |

Build a package with the Sui CLI:

```bash
cd contracts/<package>
sui move build
```
