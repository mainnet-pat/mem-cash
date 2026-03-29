import { binToHex, sha256, utf8ToBin } from "@bitauth/libauth";
import type {
	Balance,
	BlockHeader,
	HistoryEntry,
	MempoolTx,
	OutpointKey,
	ProcessedBlock,
	ScriptHash,
	Storage,
	TransactionRecord,
	Txid,
	UndoInfo,
	UtxoEntry,
} from "@mem-cash/types";
import { makeOutpointKey } from "@mem-cash/types";
import { createTestHelpers, type TestHelpers } from "./testHelpers.js";

/** Storage extended with direct test manipulation. */
export type TestableStorage = Storage & { readonly _test: TestHelpers };

/** Internal state shared between storage and test helpers. */
export interface StorageInternals {
	// Confirmed chain state
	headers: (BlockHeader | undefined)[];
	headersByHash: Map<string, BlockHeader>;
	utxos: Map<OutpointKey, UtxoEntry>;
	utxosByScriptHash: Map<ScriptHash, Set<OutpointKey>>;
	history: Map<ScriptHash, HistoryEntry[]>;
	txIndex: Map<Txid, TransactionRecord>;
	rawTxs: Map<Txid, string>;
	undoInfos: Map<number, UndoInfo>;

	// Per-block txid ordering (for merkle proofs)
	blockTxids: Map<number, Txid[]>;

	// Mempool state
	mempoolTxs: Map<Txid, MempoolTx>;
	mempoolUtxos: Map<OutpointKey, UtxoEntry>;
	mempoolUtxosByScriptHash: Map<ScriptHash, Set<OutpointKey>>;
	mempoolSpends: Map<OutpointKey, Txid>;
	mempoolHistory: Map<ScriptHash, HistoryEntry[]>;
}

/** Clone a UtxoEntry, copying the mutable lockingBytecode. */
function cloneUtxo(utxo: UtxoEntry): UtxoEntry {
	return { ...utxo, lockingBytecode: utxo.lockingBytecode.slice() };
}

/** Create empty internals. */
function createInternals(): StorageInternals {
	return {
		headers: [],
		headersByHash: new Map(),
		utxos: new Map(),
		utxosByScriptHash: new Map(),
		history: new Map(),
		txIndex: new Map(),
		rawTxs: new Map(),
		undoInfos: new Map(),
		blockTxids: new Map(),
		mempoolTxs: new Map(),
		mempoolUtxos: new Map(),
		mempoolUtxosByScriptHash: new Map(),
		mempoolSpends: new Map(),
		mempoolHistory: new Map(),
	};
}

/** Compute Electrum-style status hash: SHA256 of concatenated `"txHash:height:"` strings. */
function computeStatusHash(entries: HistoryEntry[]): string | null {
	if (entries.length === 0) return null;

	let concatenated = "";
	for (const entry of entries) {
		concatenated += `${entry.txHash}:${entry.height}:`;
	}

	return binToHex(sha256.hash(utf8ToBin(concatenated)));
}

/** Get or create a set in a map. */
function getOrCreateSet<K, V>(map: Map<K, Set<V>>, key: K): Set<V> {
	let set = map.get(key);
	if (!set) {
		set = new Set();
		map.set(key, set);
	}
	return set;
}

/** Insert a confirmed history entry maintaining sort by (height ascending, txHash ascending). */
function insertHistorySorted(entries: HistoryEntry[], entry: HistoryEntry): void {
	let i = entries.length;
	while (i > 0) {
		const prev = entries[i - 1];
		if (!prev || prev.height < entry.height) break;
		if (prev.height === entry.height && prev.txHash <= entry.txHash) break;
		i--;
	}
	entries.splice(i, 0, entry);
}

/**
 * Insert a mempool history entry maintaining Fulcrum's mempool sort order:
 * height 0 (confirmed parents) before height -1 (unconfirmed parents),
 * within same height sorted by txHash ascending.
 * This is equivalent to (height descending, txHash ascending).
 */
function insertMempoolHistorySorted(entries: HistoryEntry[], entry: HistoryEntry): void {
	let i = entries.length;
	while (i > 0) {
		const prev = entries[i - 1];
		if (!prev || prev.height > entry.height) break;
		if (prev.height === entry.height && prev.txHash <= entry.txHash) break;
		i--;
	}
	entries.splice(i, 0, entry);
}

/** Create a new in-memory storage instance with test helpers. */
export function createMemoryStorage(): TestableStorage {
	const s = createInternals();

	// --- StorageReader ---

	function getHeader(height: number): BlockHeader | undefined {
		return s.headers[height];
	}

	function getHeaderByHash(hash: string): BlockHeader | undefined {
		return s.headersByHash.get(hash);
	}

	function getTip(): BlockHeader | undefined {
		for (let i = s.headers.length - 1; i >= 0; i--) {
			const h = s.headers[i];
			if (h) return h;
		}
		return undefined;
	}

	function getHistory(
		scriptHash: ScriptHash,
		fromHeight?: number,
		toHeight?: number,
	): HistoryEntry[] {
		const all = s.history.get(scriptHash);
		if (!all) return [];

		if (fromHeight === undefined && toHeight === undefined) return [...all];

		return all.filter((e) => {
			if (fromHeight !== undefined && e.height < fromHeight) return false;
			if (toHeight !== undefined && e.height > toHeight) return false;
			return true;
		});
	}

	function getMempoolHistory(scriptHash: ScriptHash): HistoryEntry[] {
		return [...(s.mempoolHistory.get(scriptHash) ?? [])];
	}

	function getBalance(scriptHash: ScriptHash): Balance {
		// Confirmed balance: sum of confirmed UTXOs
		let confirmed = 0n;
		const confirmedKeys = s.utxosByScriptHash.get(scriptHash);
		if (confirmedKeys) {
			for (const key of confirmedKeys) {
				const utxo = s.utxos.get(key);
				if (utxo) confirmed += utxo.satoshis;
			}
		}

		// Unconfirmed delta:
		//   + mempool outputs to this scripthash
		//   - confirmed UTXOs spent in mempool (confirmedSpends only, not unconfirmedSpends)
		let unconfirmed = 0n;

		// Add mempool UTXO values
		const mempoolKeys = s.mempoolUtxosByScriptHash.get(scriptHash);
		if (mempoolKeys) {
			for (const key of mempoolKeys) {
				const utxo = s.mempoolUtxos.get(key);
				if (utxo) unconfirmed += utxo.satoshis;
			}
		}

		// Subtract confirmed UTXOs spent in mempool
		for (const mempoolTx of s.mempoolTxs.values()) {
			const entry = mempoolTx.entries.get(scriptHash);
			if (!entry) continue;
			for (const spentKey of entry.confirmedSpends) {
				const utxo = s.utxos.get(spentKey);
				if (utxo) unconfirmed -= utxo.satoshis;
			}
		}

		return { confirmed, unconfirmed };
	}

	function getUtxos(scriptHash: ScriptHash): UtxoEntry[] {
		const result: UtxoEntry[] = [];

		// Confirmed UTXOs not spent in mempool
		const confirmedKeys = s.utxosByScriptHash.get(scriptHash);
		if (confirmedKeys) {
			for (const key of confirmedKeys) {
				if (s.mempoolSpends.has(key)) continue;
				const utxo = s.utxos.get(key);
				if (utxo) result.push(cloneUtxo(utxo));
			}
		}

		// Mempool UTXOs (unconfirmed outputs)
		const mempoolKeys = s.mempoolUtxosByScriptHash.get(scriptHash);
		if (mempoolKeys) {
			for (const key of mempoolKeys) {
				if (s.mempoolSpends.has(key)) continue;
				const utxo = s.mempoolUtxos.get(key);
				if (utxo) result.push(cloneUtxo(utxo));
			}
		}

		return result;
	}

	function getTx(txid: Txid): TransactionRecord | undefined {
		return s.txIndex.get(txid);
	}

	function getRawTx(txid: Txid): string | undefined {
		return s.rawTxs.get(txid);
	}

	function getScriptHashStatus(scriptHash: ScriptHash): string | null {
		const confirmed = s.history.get(scriptHash) ?? [];
		const mempool = s.mempoolHistory.get(scriptHash) ?? [];
		return computeStatusHash([...confirmed, ...mempool]);
	}

	function getMempoolTx(txid: Txid): MempoolTx | undefined {
		return s.mempoolTxs.get(txid);
	}

	function getTxidsAtHeight(height: number): Txid[] | undefined {
		const txids = s.blockTxids.get(height);
		return txids ? [...txids] : undefined;
	}

	function getUtxoByOutpoint(key: OutpointKey): UtxoEntry | undefined {
		if (s.mempoolSpends.has(key)) return undefined;
		const utxo = s.utxos.get(key) ?? s.mempoolUtxos.get(key);
		return utxo ? cloneUtxo(utxo) : undefined;
	}

	function getMempoolTxids(): Txid[] {
		return [...s.mempoolTxs.keys()];
	}

	function getMempoolUtxo(key: OutpointKey): UtxoEntry | undefined {
		const utxo = s.mempoolUtxos.get(key);
		return utxo ? cloneUtxo(utxo) : undefined;
	}

	// --- StorageWriter ---

	function applyBlock(block: ProcessedBlock): Set<ScriptHash> {
		const affected = new Set<ScriptHash>();
		const addedUtxoKeys: OutpointKey[] = [];
		const removedUtxos: UtxoEntry[] = [];

		for (const tx of block.transactions) {
			// Process inputs (spend UTXOs)
			for (const input of tx.inputs) {
				const key = makeOutpointKey(input.prevOutpoint.txid, input.prevOutpoint.vout);
				const existing = s.utxos.get(key);
				if (existing) {
					removedUtxos.push(cloneUtxo(existing));
					affected.add(existing.scriptHash);
					s.utxos.delete(key);
					const shSet = s.utxosByScriptHash.get(existing.scriptHash);
					if (shSet) {
						shSet.delete(key);
						if (shSet.size === 0) s.utxosByScriptHash.delete(existing.scriptHash);
					}
				}
			}

			// Process outputs (create UTXOs)
			for (const output of tx.outputs) {
				s.utxos.set(output.outpointKey, output.utxo);
				getOrCreateSet(s.utxosByScriptHash, output.utxo.scriptHash).add(output.outpointKey);
				addedUtxoKeys.push(output.outpointKey);
				affected.add(output.utxo.scriptHash);
			}

			// Store transaction record
			const txRecord: TransactionRecord = {
				txid: tx.txid,
				height: block.height,
			};
			if (tx.rawHex !== undefined) {
				(txRecord as { rawHex: string }).rawHex = tx.rawHex;
			}
			if (tx.fee !== undefined) {
				(txRecord as { fee: bigint }).fee = tx.fee;
			}
			s.txIndex.set(tx.txid, txRecord);
			if (tx.rawHex) {
				s.rawTxs.set(tx.txid, tx.rawHex);
			}

			// Remove from mempool if present
			if (s.mempoolTxs.has(tx.txid)) {
				removeMempoolTxInternal(tx.txid, affected);
			}
		}

		// Update history for all affected scripthashes
		for (const tx of block.transactions) {
			const txScriptHashes = new Set<ScriptHash>();
			for (const input of tx.inputs) {
				const key = makeOutpointKey(input.prevOutpoint.txid, input.prevOutpoint.vout);
				const removed = removedUtxos.find(
					(u) => makeOutpointKey(u.outpoint.txid, u.outpoint.vout) === key,
				);
				if (removed) txScriptHashes.add(removed.scriptHash);
			}
			for (const output of tx.outputs) {
				txScriptHashes.add(output.utxo.scriptHash);
			}

			for (const sh of txScriptHashes) {
				const entries = getOrCreateArray(s.history, sh);
				insertHistorySorted(entries, { txHash: tx.txid, height: block.height });
			}
		}

		// Store block txid ordering (for merkle proofs)
		s.blockTxids.set(
			block.height,
			block.transactions.map((tx) => tx.txid),
		);

		// Store header
		s.headers[block.height] = block.header;
		s.headersByHash.set(block.hash, block.header);

		// Store undo info
		s.undoInfos.set(block.height, {
			height: block.height,
			hash: block.hash,
			addedUtxos: addedUtxoKeys,
			removedUtxos,
			affectedScriptHashes: affected,
		});

		return affected;
	}

	function undoBlock(height: number): Set<ScriptHash> {
		const undo = s.undoInfos.get(height);
		if (!undo) return new Set();

		const affected = new Set(undo.affectedScriptHashes);

		// Remove UTXOs added by this block
		for (const key of undo.addedUtxos) {
			const utxo = s.utxos.get(key);
			if (utxo) {
				s.utxos.delete(key);
				const shSet = s.utxosByScriptHash.get(utxo.scriptHash);
				if (shSet) {
					shSet.delete(key);
					if (shSet.size === 0) s.utxosByScriptHash.delete(utxo.scriptHash);
				}
			}
		}

		// Restore UTXOs spent by this block
		for (const utxo of undo.removedUtxos) {
			const key = makeOutpointKey(utxo.outpoint.txid, utxo.outpoint.vout);
			s.utxos.set(key, utxo);
			getOrCreateSet(s.utxosByScriptHash, utxo.scriptHash).add(key);
		}

		// Remove history entries at this height
		for (const sh of affected) {
			const entries = s.history.get(sh);
			if (entries) {
				const filtered = entries.filter((e) => e.height !== height);
				if (filtered.length === 0) {
					s.history.delete(sh);
				} else {
					s.history.set(sh, filtered);
				}
			}
		}

		// Remove tx records for transactions in this block
		const undoBlockData = s.undoInfos.get(height);
		if (undoBlockData) {
			// Remove txids that were added at this height
			for (const [txid, record] of s.txIndex) {
				if (record.height === height) {
					s.txIndex.delete(txid);
					s.rawTxs.delete(txid);
				}
			}
		}

		// Remove block txids
		s.blockTxids.delete(height);

		// Remove header
		const header = s.headers[height];
		if (header) {
			s.headersByHash.delete(header.hash);
			s.headers[height] = undefined;
		}
		// Trim trailing undefineds
		while (s.headers.length > 0 && s.headers[s.headers.length - 1] === undefined) {
			s.headers.pop();
		}

		// Clear mempool (after reorg, mempool is invalidated)
		clearMempoolInternal(affected);

		s.undoInfos.delete(height);

		return affected;
	}

	function addMempoolTx(tx: MempoolTx): Set<ScriptHash> {
		const affected = new Set<ScriptHash>();

		s.mempoolTxs.set(tx.txid, tx);

		for (const [scriptHash, entry] of tx.entries) {
			affected.add(scriptHash);

			// Track confirmed spends
			for (const key of entry.confirmedSpends) {
				s.mempoolSpends.set(key, tx.txid);
			}

			// Track unconfirmed spends
			for (const key of entry.unconfirmedSpends) {
				s.mempoolSpends.set(key, tx.txid);
			}

			// Add mempool UTXOs
			for (const key of entry.outputs) {
				const utxo = s.mempoolUtxos.get(key);
				// The UTXO must be provided via mempoolUtxos already, or we create a placeholder
				// In practice, the caller builds the full MempoolTx with UTXOs set up via test helpers
				if (!utxo) continue;
				getOrCreateSet(s.mempoolUtxosByScriptHash, scriptHash).add(key);
			}

			// Add mempool history (sorted: height 0 before -1, then by txHash)
			const hasUnconfirmedParent = tx.parents.size > 0;
			const historyEntry: HistoryEntry = {
				txHash: tx.txid,
				height: hasUnconfirmedParent ? -1 : 0,
				fee: tx.fee,
			};
			const mempoolEntries = getOrCreateArray(s.mempoolHistory, scriptHash);
			insertMempoolHistorySorted(mempoolEntries, historyEntry);
		}

		// Update parent→child linkage
		for (const parentTxid of tx.parents) {
			const parentTx = s.mempoolTxs.get(parentTxid);
			if (parentTx) {
				(parentTx.children as Set<Txid>).add(tx.txid);
			}
		}

		return affected;
	}

	function removeMempoolTx(txid: Txid): Set<ScriptHash> {
		const affected = new Set<ScriptHash>();
		removeMempoolTxInternal(txid, affected);
		return affected;
	}

	function removeMempoolTxInternal(txid: Txid, affected: Set<ScriptHash>): void {
		// Iterative traversal to avoid stack overflow on deep chains
		const stack: Txid[] = [txid];
		const toRemove: Txid[] = [];
		const visited = new Set<Txid>();

		// Collect all descendants depth-first (children before parents)
		while (stack.length > 0) {
			const current = stack.pop() as Txid;
			if (visited.has(current)) continue;
			visited.add(current);
			toRemove.push(current);

			const tx = s.mempoolTxs.get(current);
			if (tx) {
				for (const childTxid of tx.children) {
					if (!visited.has(childTxid)) stack.push(childTxid);
				}
			}
		}

		// Remove in reverse order (children first)
		for (let i = toRemove.length - 1; i >= 0; i--) {
			const removeTxid = toRemove[i] as Txid;
			const tx = s.mempoolTxs.get(removeTxid);
			if (!tx) continue;

			for (const [scriptHash, entry] of tx.entries) {
				affected.add(scriptHash);

				// Remove spend tracking
				for (const key of entry.confirmedSpends) {
					s.mempoolSpends.delete(key);
				}
				for (const key of entry.unconfirmedSpends) {
					s.mempoolSpends.delete(key);
				}

				// Remove mempool UTXOs
				for (const key of entry.outputs) {
					s.mempoolUtxos.delete(key);
					const shSet = s.mempoolUtxosByScriptHash.get(scriptHash);
					if (shSet) {
						shSet.delete(key);
						if (shSet.size === 0) s.mempoolUtxosByScriptHash.delete(scriptHash);
					}
				}

				// Remove mempool history
				const mempoolEntries = s.mempoolHistory.get(scriptHash);
				if (mempoolEntries) {
					const filtered = mempoolEntries.filter((e) => e.txHash !== removeTxid);
					if (filtered.length === 0) {
						s.mempoolHistory.delete(scriptHash);
					} else {
						s.mempoolHistory.set(scriptHash, filtered);
					}
				}
			}

			// Remove parent→child reference
			for (const parentTxid of tx.parents) {
				const parentTx = s.mempoolTxs.get(parentTxid);
				if (parentTx) {
					(parentTx.children as Set<Txid>).delete(removeTxid);
				}
			}

			s.mempoolTxs.delete(removeTxid);
		}
	}

	function clearMempool(): Set<ScriptHash> {
		const affected = new Set<ScriptHash>();
		clearMempoolInternal(affected);
		return affected;
	}

	function clearMempoolInternal(affected: Set<ScriptHash>): void {
		for (const scriptHash of s.mempoolHistory.keys()) {
			affected.add(scriptHash);
		}
		for (const [, tx] of s.mempoolTxs) {
			for (const scriptHash of tx.entries.keys()) {
				affected.add(scriptHash);
			}
		}
		s.mempoolTxs.clear();
		s.mempoolUtxos.clear();
		s.mempoolUtxosByScriptHash.clear();
		s.mempoolSpends.clear();
		s.mempoolHistory.clear();
	}

	function addMempoolUtxo(key: OutpointKey, utxo: UtxoEntry): void {
		s.mempoolUtxos.set(key, utxo);
	}

	function storeRawTx(txid: Txid, rawHex: string): void {
		s.rawTxs.set(txid, rawHex);
	}

	// --- Build test helpers ---
	const testHelpers = createTestHelpers(s, { removeMempoolTx, clearMempool });

	return {
		// StorageReader
		getHeader,
		getHeaderByHash,
		getTip,
		getHistory,
		getMempoolHistory,
		getBalance,
		getUtxos,
		getTx,
		getRawTx,
		getScriptHashStatus,
		getMempoolTx,
		getTxidsAtHeight,
		getUtxoByOutpoint,
		getMempoolTxids,
		getMempoolUtxo,
		// StorageWriter
		applyBlock,
		undoBlock,
		addMempoolTx,
		removeMempoolTx,
		clearMempool,
		addMempoolUtxo,
		storeRawTx,
		// Test
		_test: testHelpers,
	};
}

/** Get or create an array in a map. */
function getOrCreateArray<K, V>(map: Map<K, V[]>, key: K): V[] {
	let arr = map.get(key);
	if (!arr) {
		arr = [];
		map.set(key, arr);
	}
	return arr;
}
