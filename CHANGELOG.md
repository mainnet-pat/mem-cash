# Changelog

## 0.0.6

- Export `getDustThreshold` - reusable token-aware dust calculator.
- Add `TxVerifierConfig.skipFeePolicy` - skips min-relay/absurd-fee; keeps consensus/scripts/dust.
- Add fixed `DUST_RELAY_FEE_PER_KB` constant + `TxVerifierConfig.dustRelayFeePerKb`; dust no longer scales with `minRelayFeePerKb`.
- Export the now-sync `createVmFacade` (and `VmFacade` type).
- Add public `reset()` to the Node/Indexer (clears all storage).
- `Node.addUtxo` accepts `tokenData` for token UTXOs.

## 0.0.5

Rework createVmFacade to be sync.

## 0.0.4

Fix fee policy checks to match BCHN behavior:
- `checkMinRelayFee` now uses floor division with min-1-sat guard (matching `CFeeRate::GetFee`).
- `checkDustOutputs` now computes `3 * GetFee(nSize)` matching BCHN's `GetDustThreshold` order of operations.

## 0.0.3

Node's `setVerifier` allows setting the transaction verifier after creation.

## 0.0.2

VM node's 'addUtxo' accepts addresses.

## 0.0.1

Initial release. In-memory Bitcoin Cash VM and Electrum Cash protocol in TypeScript.

- **VM layer** -- UTXO set, transaction validation (libauth VM + BCHN 29.0.0 consensus/policy rules), mempool with parent/child tracking, block processing, subscription manager
- **Electrum protocol** -- all 53 Fulcrum-compatible JSON-RPC methods with matching error strings, sort orders, and status hash computation
- **Validation pipeline** -- BCHN-ordered checks with two-pass script verification, reject codes, and debug traces
- **5 packages** -- `types`, `storage`, `validation`, `core`, `electrum` with tree-shakeable ESM, no classes, pluggable storage interface
