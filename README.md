# mem-cash

Modern, tree-shakeable TypeScript implementation of the in-memory Bitcoin Cash VM and Electrum Cash protocol.

## Overview

mem-cash provides two complementary layers:

1. **In-memory Bitcoin Cash VM** (`types`, `storage`, `validation`, `core`) -- a complete UTXO set, transaction validator using [libauth](https://github.com/bitauth/libauth) for script evaluation and consensus/policy rules from [BCHN 29.0.0](https://bitcoincashnode.org/), mempool with parent/child tracking, subscription manager, and block processing engine. All state lives in memory with a pluggable storage interface for future persistence (LevelDB, RocksDB, SQLite).

2. **Electrum Cash protocol** (`electrum`) -- all 53 [Fulcrum](https://github.com/cculianu/Fulcrum)-compatible JSON-RPC methods, wired to the in-memory VM. Error strings, history sort order, status hash computation, and protocol behavior match Fulcrum's C++ implementation. Some of Fulcrum-specific methods are error-yielding stubs, however.

The VM layer works standalone -- you can validate transactions, manage UTXOs, and process blocks without the Electrum protocol layer. The Electrum layer adds the RPC interface on top.

## Packages

| Package | Description |
|---|---|
| [`@mem-cash/types`](packages/types) | Primitives, data types, storage interfaces, merkle utilities, BCHN reject codes |
| [`@mem-cash/storage`](packages/storage) | In-memory storage: UTXO set, history, headers, mempool state |
| [`@mem-cash/validation`](packages/validation) | Transaction evaluator: BCHN-ordered consensus checks, policy checks, libauth VM |
| [`@mem-cash/core`](packages/core) | Node engine: mempool acceptance, subscription manager, block processing |
| [`@mem-cash/electrum`](packages/electrum) | Electrum Cash RPC: 53 Fulcrum-compatible handlers, dispatch, Indexer facade |

### Dependency graph

```
types  <--  storage  <--  core  <--  electrum
  ^                                      ^
  +-------- validation -----------------+  (peer dep, optional)
```

The VM layer (`types` + `storage` + `validation` + `core`) has no dependency on `electrum`. Consumers that only need transaction validation or UTXO management can import the lower packages directly.

## Quick Start

### Using the Electrum protocol layer

```typescript
import { createIndexer } from "@mem-cash/electrum";

const indexer = createIndexer();
indexer.setChainTip(200, 1700000000);

// Add a UTXO
const { txid } = await indexer.request("test.add_utxo", [
  "bitcoincash:qz46h2at4w46h2at4vetysdy5q",
  { satoshis: 10000 },
]);

// Query via Electrum protocol
const balance = await indexer.request("blockchain.scripthash.get_balance", [scriptHash]);
const history = await indexer.request("blockchain.scripthash.get_history", [scriptHash]);
const utxos = await indexer.request("blockchain.scripthash.listunspent", [scriptHash]);
```

### Using the VM layer directly

```typescript
import { createNode } from "@mem-cash/core";
import { createTxVerifier } from "@mem-cash/validation";

const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
const node = createNode({ verifier });
node.setChainTip(200, 1700000000);

// Add UTXOs, submit transactions, mine blocks
node.addUtxo({ txid, vout: 0, satoshis: 10_000n, scriptHash, height: 100, lockingBytecode });
const result = node.submitTransaction(rawHex);
const debug = node.debugTransaction(rawHex); // per-input VM traces without mempool acceptance
const { height } = node.mine();
```

## Commands

```sh
yarn build        # compile TypeScript (tsc -b)
yarn typecheck    # type-check without emitting
yarn test         # run all tests
yarn biome        # Biome check (lint + format, auto-fix)
yarn bump 0.1.0   # bump all package versions
```

## Design Principles

- **No classes.** Plain functions, interfaces, and factory functions returning frozen objects.
- **Tree-shakeable.** ESM throughout, `sideEffects: false`, selective barrel exports.
- **Result types over exceptions.** Validation failures return discriminated unions with BCHN-compatible reject codes (`bad-txns-prevout-null`, `mandatory-script-verify-flag-failed`, etc.).
- **Fulcrum-compatible.** Error strings, sort orders, and protocol behavior match the [Fulcrum](https://github.com/cculianu/Fulcrum) C++ reference implementation.
- **BCHN-compatible.** Transaction validation pipeline mirrors BCHN's `AcceptToMemoryPool` order, with matching error codes and two-pass script verification.
- **Hardened.** Storage returns defensive copies (cloned `Uint8Array` buffers), merkle functions validate inputs, RPC handlers enforce resource limits, subscriber callbacks are isolated, and `test.*` handlers can be disabled via `disableTestHandlers: true`.

## License

MIT
