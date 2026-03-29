import type { ProcessedBlock } from "./block.js";
import type {
	Balance,
	BlockHeader,
	HistoryEntry,
	MempoolTx,
	TransactionRecord,
	UtxoEntry,
} from "./data.js";
import type { OutpointKey, ScriptHash, Txid } from "./primitives.js";

/** Read-only view into the chain + mempool state. */
export interface StorageReader {
	/** Get the block header at a given height. */
	getHeader(height: number): BlockHeader | undefined;

	/** Get the block header by block hash. */
	getHeaderByHash(hash: string): BlockHeader | undefined;

	/** Get the current chain tip (highest header), or undefined if empty. */
	getTip(): BlockHeader | undefined;

	/** Get confirmed transaction history for a scripthash. */
	getHistory(scriptHash: ScriptHash, fromHeight?: number, toHeight?: number): HistoryEntry[];

	/** Get mempool history entries for a scripthash. */
	getMempoolHistory(scriptHash: ScriptHash): HistoryEntry[];

	/** Get confirmed + unconfirmed balance for a scripthash. */
	getBalance(scriptHash: ScriptHash): Balance;

	/** Get unspent outputs for a scripthash (confirmed minus mempool-spent, plus mempool outputs). */
	getUtxos(scriptHash: ScriptHash): UtxoEntry[];

	/** Get a transaction record by txid. */
	getTx(txid: Txid): TransactionRecord | undefined;

	/** Get raw transaction hex by txid. */
	getRawTx(txid: Txid): string | undefined;

	/** Compute the Electrum status hash for a scripthash. Null if no history. */
	getScriptHashStatus(scriptHash: ScriptHash): string | null;

	/** Get a mempool transaction entry. */
	getMempoolTx(txid: Txid): MempoolTx | undefined;

	/** Get the ordered list of txids in a block at the given height. */
	getTxidsAtHeight(height: number): Txid[] | undefined;

	/** Get a single UTXO by outpoint key (confirmed or mempool, undefined if spent in mempool). */
	getUtxoByOutpoint(key: OutpointKey): UtxoEntry | undefined;

	/** Get all mempool transaction IDs. */
	getMempoolTxids(): Txid[];

	/** Get a mempool UTXO by outpoint key. */
	getMempoolUtxo(key: OutpointKey): UtxoEntry | undefined;
}

/** Mutating operations on the chain + mempool state. */
export interface StorageWriter {
	/** Apply a processed block to the confirmed state. Returns affected scripthashes. */
	applyBlock(block: ProcessedBlock): Set<ScriptHash>;

	/** Undo (revert) the block at the given height. Returns affected scripthashes. */
	undoBlock(height: number): Set<ScriptHash>;

	/** Add a transaction to the mempool. Returns affected scripthashes. */
	addMempoolTx(tx: MempoolTx): Set<ScriptHash>;

	/** Remove a mempool transaction (cascading to descendants). Returns affected scripthashes. */
	removeMempoolTx(txid: Txid): Set<ScriptHash>;

	/** Clear all mempool state. Returns all scripthashes that had mempool activity. */
	clearMempool(): Set<ScriptHash>;

	/** Pre-register a mempool UTXO before calling addMempoolTx. */
	addMempoolUtxo(key: OutpointKey, utxo: UtxoEntry): void;

	/** Store raw transaction hex so getRawTx works for mempool txs. */
	storeRawTx(txid: Txid, rawHex: string): void;
}

/** Combined read + write storage. */
export type Storage = StorageReader & StorageWriter;
