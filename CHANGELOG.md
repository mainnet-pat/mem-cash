# Changelog

## 0.0.2

VM node's 'addUtxo' accepts addresses.

## 0.0.1

Initial release. In-memory Bitcoin Cash VM and Electrum Cash protocol in TypeScript.

- **VM layer** -- UTXO set, transaction validation (libauth VM + BCHN 29.0.0 consensus/policy rules), mempool with parent/child tracking, block processing, subscription manager
- **Electrum protocol** -- all 53 Fulcrum-compatible JSON-RPC methods with matching error strings, sort orders, and status hash computation
- **Validation pipeline** -- BCHN-ordered checks with two-pass script verification, reject codes, and debug traces
- **5 packages** -- `types`, `storage`, `validation`, `core`, `electrum` with tree-shakeable ESM, no classes, pluggable storage interface
