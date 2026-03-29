import type { BlockHash, BlockHeight, OutpointKey, ScriptHash, Txid } from "./primitives.js";

/** A specific transaction output (txid + index). */
export interface Outpoint {
	readonly txid: Txid;
	readonly vout: number;
}

/** CashToken data attached to a UTXO. */
export interface TokenData {
	/** Token category (32-byte hex token id). */
	readonly category: string;
	/** Fungible token amount. */
	readonly amount: bigint;
	/** Non-fungible token data, if present. */
	readonly nft?: {
		readonly commitment: string;
		readonly capability: "none" | "mutable" | "minting";
	};
}

/** A confirmed or unconfirmed UTXO. */
export interface UtxoEntry {
	readonly outpoint: Outpoint;
	readonly satoshis: bigint;
	readonly scriptHash: ScriptHash;
	/** Block height where this UTXO was created. 0 = mempool/unconfirmed. */
	readonly height: BlockHeight;
	/** The full locking script (scriptPubKey) for VM evaluation. */
	readonly lockingBytecode: Uint8Array;
	/** Whether this UTXO was created by a coinbase transaction. */
	readonly isCoinbase?: boolean;
	readonly tokenData?: TokenData;
}

/** An entry in a scripthash's transaction history. */
export interface HistoryEntry {
	/** Transaction hash (hex). */
	readonly txHash: Txid;
	/** Block height. 0 = mempool, -1 = mempool with unconfirmed parents. */
	readonly height: number;
	/** Fee in satoshis (only present for mempool entries). */
	readonly fee?: bigint;
}

/** Confirmed + unconfirmed balance for a scripthash. */
export interface Balance {
	readonly confirmed: bigint;
	readonly unconfirmed: bigint;
}

/** Stored transaction record. */
export interface TransactionRecord {
	readonly txid: Txid;
	/** Block height. 0 = unconfirmed. */
	readonly height: BlockHeight;
	readonly rawHex?: string;
	readonly fee?: bigint;
}

/** A block header with all standard fields. */
export interface BlockHeader {
	readonly hash: BlockHash;
	readonly height: BlockHeight;
	readonly version: number;
	readonly prevHash: BlockHash;
	readonly merkleRoot: string;
	readonly timestamp: number;
	readonly bits: number;
	readonly nonce: number;
	/** Raw 80-byte header as hex. */
	readonly hex: string;
}

/** Per-scripthash bookkeeping within a mempool transaction. */
export interface MempoolTxScriptHashEntry {
	/** Outpoints spent from confirmed UTXOs. */
	readonly confirmedSpends: readonly OutpointKey[];
	/** Outpoints spent from other mempool UTXOs. */
	readonly unconfirmedSpends: readonly OutpointKey[];
	/** Outpoint keys for new outputs to this scripthash. */
	readonly outputs: readonly OutpointKey[];
}

/** A transaction currently in the mempool. */
export interface MempoolTx {
	readonly txid: Txid;
	readonly fee: bigint;
	readonly size: number;
	/** Scripthash → spend/output info for this tx. */
	readonly entries: ReadonlyMap<ScriptHash, MempoolTxScriptHashEntry>;
	/** Txids of mempool parents (unconfirmed inputs). */
	readonly parents: ReadonlySet<Txid>;
	/** Txids of mempool children (txs that spend our outputs). */
	readonly children: ReadonlySet<Txid>;
}
