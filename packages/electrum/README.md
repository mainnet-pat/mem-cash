# @mem-cash/electrum

Electrum Cash protocol handlers, dispatch, and the `Indexer` facade. Modelled after
[Fulcrum](https://github.com/cculianu/Fulcrum), the production C++ Electrum Cash indexer -- error messages, history sort order, status hash computation, and
protocol behavior are aligned with Fulcrum's implementation.

## Protocol Coverage

All 53 Fulcrum client RPC methods are implemented:

| Category | Methods |
|---|---|
| `blockchain.scripthash.*` | get_balance, get_history, get_mempool, listunspent, subscribe, unsubscribe, get_status, get_first_use |
| `blockchain.address.*` | get_balance, get_history, get_mempool, listunspent, subscribe, unsubscribe, get_scripthash, get_status, get_first_use |
| `blockchain.transaction.*` | get, get_merkle, id_from_pos, broadcast, broadcast_package, get_height, get_confirmed_blockhash, subscribe, unsubscribe |
| `blockchain.transaction.dsproof.*` | get, list, subscribe, unsubscribe |
| `blockchain.block.*` / `blockchain.headers.*` | header, headers, header.get, headers.get_tip, headers.subscribe, headers.unsubscribe |
| `blockchain.utxo.*` | get_info |
| `mempool.*` | get_fee_histogram, get_info |
| `server.*` | version, ping, features, banner, donation_address, add_peer, peers.subscribe |
| `blockchain.estimatefee` / `blockchain.relayfee` | fee estimation |
| `blockchain.rpa.*` / `blockchain.reusable.*` / `daemon.passthrough` | stubs (not supported) |

## Quick Start

`createIndexer()` wires together storage, validation, subscriptions, and protocol
dispatch into a single instance. All interaction goes through `request()`.

```typescript
import { createIndexer } from "@mem-cash/electrum";
import { binToHex, sha256 } from "@bitauth/libauth";

const indexer = createIndexer({ standard: false });
indexer.setChainTip(200, 1700000000);

// OP_1 (always-true script) for simplicity
const lockingBytecode = Uint8Array.of(0x51);
const scriptHash = binToHex(sha256.hash(lockingBytecode));

indexer.addUtxo({
    txid: "aa".repeat(32),
    vout: 0,
    satoshis: 10_000n,
    scriptHash,
    height: 100,
    lockingBytecode,
});

// Query balance
const balance = await indexer.request("blockchain.scripthash.get_balance", [scriptHash]);

// Query unspent outputs
const utxos = await indexer.request("blockchain.scripthash.listunspent", [scriptHash]);

// Submit a transaction (verify + accept to mempool in one call)
const result = indexer.submitTransaction(rawHex);

// Or broadcast via the Electrum protocol method
const txid = await indexer.request("blockchain.transaction.broadcast", [rawHex]);
```

## Subscriptions

```typescript
// Subscribe to scripthash status changes
const unsub = await indexer.subscribe(
    "blockchain.scripthash.subscribe",
    [scriptHash],
    ([sh, status]) => console.log("status changed:", sh, status),
);

// Subscribe to new block headers
await indexer.subscribe(
    "blockchain.headers.subscribe",
    [],
    ([header]) => console.log("new tip:", header.height),
);

// Unsubscribe
await unsub();
```

## Test Helpers

`test.*` RPC methods are available by default for setting up chain state.
To disable them (e.g. in production), pass `disableTestHandlers: true`:

```typescript
const indexer = createIndexer({ disableTestHandlers: true });
```

When enabled:

```typescript
await indexer.request("test.set_chain_tip", [200, 1700000000]);
await indexer.request("test.add_utxo", [address, { satoshis: 10000, height: 100 }]);
await indexer.request("test.mine", [address, 1]); // max 1000 blocks per call

// Debug a transaction (per-input VM traces, without accepting to mempool)
const debug = await indexer.request("test.debugTransaction", [rawHex]);
// → { success: true, txid, fee, size, inputResults: [{ inputIndex: 0, success: true }, ...] }
// → { success: false, code, error, inputResults: [{ inputIndex: 0, success: false, error: "..." }] }

await indexer.request("test.reset", []);
```

## Resource Limits

- **`blockchain.block.header` / `blockchain.block.headers`** -- `cp_height` capped at 1,000,000 to prevent DoS via huge merkle tree allocations
- **`blockchain.transaction.broadcast_package`** -- max 1,000 transactions per call
- **`test.mine`** -- max 1,000 blocks per call
- Internal decoder errors are not exposed in RPC responses

## Fulcrum Compatibility

- **Error strings** match BCHN's `strRejectReason` (e.g. `bad-txns-prevout-null`, `min relay fee not met`)
- **Reject codes** use BCHN values (`REJECT_INVALID`, `REJECT_NONSTANDARD`, etc.)
- **Broadcast errors** use Fulcrum's format: `"the transaction was rejected by network rules.\n\n<reason> (code <code>)\n"`
- **Mempool history sort** matches Fulcrum: height 0 (confirmed parents) before height -1 (unconfirmed parents), within each group sorted by txHash
- **Status hash** computation uses the same `txHash:height:` concatenation and single SHA-256
- **Two-pass script verification** distinguishes `mandatory-script-verify-flag-failed` from `non-mandatory-script-verify-flag`

## Architecture

```
+-----------------------------------------+
|            Protocol Layer               |
|  dispatch() -> handler -> storage query |
|  subscriptions -> notifyChanges()       |
|  acceptToMempool() -> storage mutations |
+-----------------------------------------+
|           Validation Layer              |
|  createTxVerifier() -> verify()/debug() |
|  consensus checks -> policy -> VM       |
+-----------------------------------------+
|            Storage Layer                |
|  createMemoryStorage() -> Storage       |
|  UTXO set, history, headers, mempool   |
+-----------------------------------------+
|              Core Layer                 |
|  types, primitives, storage interfaces |
+-----------------------------------------+
```
