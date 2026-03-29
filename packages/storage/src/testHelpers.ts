import type {
	BlockHash,
	BlockHeader,
	BlockHeight,
	HistoryEntry,
	MempoolTx,
	MempoolTxScriptHashEntry,
	OutpointKey,
	ScriptHash,
	TokenData,
	TransactionRecord,
	Txid,
	UtxoEntry,
} from "@mem-cash/types";
import { makeOutpointKey } from "@mem-cash/types";
import type { StorageInternals } from "./memoryStorage.js";

/** Parameters for adding a test UTXO. */
export interface AddUtxoParams {
	txid: Txid;
	vout: number;
	satoshis: bigint;
	scriptHash: ScriptHash;
	height: BlockHeight;
	lockingBytecode?: Uint8Array;
	isCoinbase?: boolean;
	tokenData?: TokenData;
}

/** Parameters for removing a test UTXO. */
export interface RemoveUtxoParams {
	txid: Txid;
	vout: number;
}

/** Parameters for adding a test header. */
export interface AddHeaderParams {
	hash: BlockHash;
	height: BlockHeight;
	version?: number;
	prevHash?: BlockHash;
	merkleRoot?: string;
	timestamp?: number;
	bits?: number;
	nonce?: number;
	hex?: string;
}

/** Simplified mempool input for test helpers. */
export interface TestMempoolInput {
	txid: Txid;
	vout: number;
}

/** Simplified mempool output for test helpers. */
export interface TestMempoolOutput {
	satoshis: bigint;
	scriptHash: ScriptHash;
	lockingBytecode?: Uint8Array;
	tokenData?: TokenData;
}

/** Parameters for adding a test mempool transaction. */
export interface AddMempoolTxParams {
	txid: Txid;
	fee: bigint;
	size: number;
	inputs: TestMempoolInput[];
	outputs: TestMempoolOutput[];
}

/** Parameters for adding a transaction record. */
export interface AddTxParams {
	txid: Txid;
	height: BlockHeight;
	rawHex?: string;
	fee?: bigint;
}

/** Parameters for adding history entries. */
export interface AddHistoryParams {
	scriptHash: ScriptHash;
	entries: HistoryEntry[];
}

/** Storage write ops needed by test helpers. */
export interface StorageWriteOps {
	removeMempoolTx(txid: Txid): Set<ScriptHash>;
	clearMempool(): Set<ScriptHash>;
}

/** Direct manipulation helpers for testing. */
export interface TestHelpers {
	readonly utxo: {
		add(params: AddUtxoParams): void;
		remove(params: RemoveUtxoParams): void;
	};
	readonly header: {
		add(params: AddHeaderParams): void;
	};
	readonly mempool: {
		add(params: AddMempoolTxParams): void;
		remove(txid: Txid): Set<ScriptHash>;
		clear(): Set<ScriptHash>;
	};
	readonly tx: {
		add(params: AddTxParams): void;
	};
	readonly history: {
		add(params: AddHistoryParams): void;
	};
	reset(): void;
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

/** Insert a history entry maintaining sort by (height, txHash). */
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

/** Create test helpers that manipulate storage internals directly. */
export function createTestHelpers(s: StorageInternals, ops: StorageWriteOps): TestHelpers {
	return {
		utxo: {
			add(params: AddUtxoParams): void {
				const key = makeOutpointKey(params.txid, params.vout);
				const utxo: UtxoEntry = Object.assign(
					{
						outpoint: { txid: params.txid, vout: params.vout },
						satoshis: params.satoshis,
						scriptHash: params.scriptHash,
						height: params.height,
						lockingBytecode: params.lockingBytecode ?? new Uint8Array(0),
					},
					params.isCoinbase ? { isCoinbase: true } : {},
					params.tokenData !== undefined ? { tokenData: params.tokenData } : {},
				);
				s.utxos.set(key, utxo);
				getOrCreateSet(s.utxosByScriptHash, params.scriptHash).add(key);
			},
			remove(params: RemoveUtxoParams): void {
				const key = makeOutpointKey(params.txid, params.vout);
				const utxo = s.utxos.get(key);
				if (utxo) {
					s.utxos.delete(key);
					const shSet = s.utxosByScriptHash.get(utxo.scriptHash);
					if (shSet) {
						shSet.delete(key);
						if (shSet.size === 0) s.utxosByScriptHash.delete(utxo.scriptHash);
					}
				}
			},
		},
		header: {
			add(params: AddHeaderParams): void {
				const header: BlockHeader = {
					hash: params.hash,
					height: params.height,
					version: params.version ?? 1,
					prevHash: params.prevHash ?? "0".repeat(64),
					merkleRoot: params.merkleRoot ?? "0".repeat(64),
					timestamp: params.timestamp ?? Math.floor(Date.now() / 1000),
					bits: params.bits ?? 0x1d00ffff,
					nonce: params.nonce ?? 0,
					hex: params.hex ?? "0".repeat(160),
				};
				s.headers[params.height] = header;
				s.headersByHash.set(params.hash, header);
			},
		},
		mempool: {
			add(params: AddMempoolTxParams): void {
				const entriesMap = new Map<ScriptHash, MempoolTxScriptHashEntry>();
				const parents = new Set<Txid>();

				// Process inputs
				for (const input of params.inputs) {
					const key = makeOutpointKey(input.txid, input.vout);

					// Check if this is spending a confirmed UTXO
					const confirmedUtxo = s.utxos.get(key);
					if (confirmedUtxo) {
						const entry = getOrCreateEntry(entriesMap, confirmedUtxo.scriptHash);
						(entry.confirmedSpends as OutpointKey[]).push(key);
						s.mempoolSpends.set(key, params.txid);
						continue;
					}

					// Check if spending a mempool UTXO
					const mempoolUtxo = s.mempoolUtxos.get(key);
					if (mempoolUtxo) {
						const entry = getOrCreateEntry(entriesMap, mempoolUtxo.scriptHash);
						(entry.unconfirmedSpends as OutpointKey[]).push(key);
						s.mempoolSpends.set(key, params.txid);
						parents.add(input.txid);
					}
				}

				// Process outputs
				for (let vout = 0; vout < params.outputs.length; vout++) {
					const output = params.outputs[vout];
					if (!output) continue;
					const key = makeOutpointKey(params.txid, vout);
					const utxo: UtxoEntry = Object.assign(
						{
							outpoint: { txid: params.txid, vout },
							satoshis: output.satoshis,
							scriptHash: output.scriptHash,
							height: 0,
							lockingBytecode: output.lockingBytecode ?? new Uint8Array(0),
						},
						output.tokenData !== undefined ? { tokenData: output.tokenData } : {},
					);
					s.mempoolUtxos.set(key, utxo);
					getOrCreateSet(s.mempoolUtxosByScriptHash, output.scriptHash).add(key);

					const entry = getOrCreateEntry(entriesMap, output.scriptHash);
					(entry.outputs as OutpointKey[]).push(key);
				}

				// Build mempool history
				const hasUnconfirmedParent = parents.size > 0;
				for (const scriptHash of entriesMap.keys()) {
					const historyEntry: HistoryEntry = {
						txHash: params.txid,
						height: hasUnconfirmedParent ? -1 : 0,
						fee: params.fee,
					};
					const mempoolEntries = getOrCreateArray(s.mempoolHistory, scriptHash);
					mempoolEntries.push(historyEntry);
				}

				const mempoolTx: MempoolTx = {
					txid: params.txid,
					fee: params.fee,
					size: params.size,
					entries: entriesMap,
					parents,
					children: new Set(),
				};

				s.mempoolTxs.set(params.txid, mempoolTx);

				// Update parent→child links
				for (const parentTxid of parents) {
					const parentTx = s.mempoolTxs.get(parentTxid);
					if (parentTx) {
						(parentTx.children as Set<Txid>).add(params.txid);
					}
				}
			},
			remove(txid: Txid): Set<ScriptHash> {
				return ops.removeMempoolTx(txid);
			},
			clear(): Set<ScriptHash> {
				return ops.clearMempool();
			},
		},
		tx: {
			add(params: AddTxParams): void {
				const record: TransactionRecord = Object.assign(
					{ txid: params.txid, height: params.height },
					params.rawHex !== undefined ? { rawHex: params.rawHex } : {},
					params.fee !== undefined ? { fee: params.fee } : {},
				);
				s.txIndex.set(params.txid, record);
				if (params.rawHex) {
					s.rawTxs.set(params.txid, params.rawHex);
				}
			},
		},
		history: {
			add(params: AddHistoryParams): void {
				let entries = s.history.get(params.scriptHash);
				if (!entries) {
					entries = [];
					s.history.set(params.scriptHash, entries);
				}
				for (const entry of params.entries) {
					insertHistorySorted(entries, entry);
				}
			},
		},
		reset(): void {
			s.headers.length = 0;
			s.headersByHash.clear();
			s.utxos.clear();
			s.utxosByScriptHash.clear();
			s.history.clear();
			s.txIndex.clear();
			s.rawTxs.clear();
			s.undoInfos.clear();
			s.blockTxids.clear();
			s.mempoolTxs.clear();
			s.mempoolUtxos.clear();
			s.mempoolUtxosByScriptHash.clear();
			s.mempoolSpends.clear();
			s.mempoolHistory.clear();
		},
	};
}

/** Get or create a MempoolTxScriptHashEntry in the map. */
function getOrCreateEntry(
	map: Map<ScriptHash, MempoolTxScriptHashEntry>,
	scriptHash: ScriptHash,
): MempoolTxScriptHashEntry {
	let entry = map.get(scriptHash);
	if (!entry) {
		entry = { confirmedSpends: [], unconfirmedSpends: [], outputs: [] };
		map.set(scriptHash, entry);
	}
	return entry;
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
