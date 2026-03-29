# @mem-cash/types

Shared primitives, data types, and interfaces for the mem-cash monorepo.

## Contents

- **Primitives** -- `ScriptHash`, `Txid`, `BlockHash`, `OutpointKey` type aliases; `parseOutpointKey` validates vout as an integer in `[0, 0xFFFFFFFF]`
- **Data types** -- `BlockHeader`, `UtxoEntry`, `HistoryEntry`, `MempoolTx`, `TransactionRecord`, `Balance`, `TokenData`
- **Storage interfaces** -- `StorageReader`, `StorageWriter`, `Storage` for pluggable backends
- **Merkle utilities** -- `computeTxMerkleBranch`, `computeHeaderMerkleBranch` for SPV proofs; input validation rejects empty hash lists, out-of-bounds indices, and non-32-byte hashes
- **MTP** -- `computeMedianTimePast` (BIP113)
- **Reject codes** -- BCHN-compatible `REJECT_INVALID`, `REJECT_NONSTANDARD`, etc.
