import type { BlockHeader, Outpoint, UtxoEntry } from "./data.js";
import type { BlockHash, BlockHeight, OutpointKey, ScriptHash, Txid } from "./primitives.js";

/** A single input in a processed block transaction. */
export interface ProcessedBlockInput {
	readonly prevOutpoint: Outpoint;
}

/** A single output in a processed block transaction. */
export interface ProcessedBlockOutput {
	readonly outpointKey: OutpointKey;
	readonly utxo: UtxoEntry;
}

/** A transaction within a processed block. */
export interface ProcessedBlockTx {
	readonly txid: Txid;
	readonly inputs: readonly ProcessedBlockInput[];
	readonly outputs: readonly ProcessedBlockOutput[];
	readonly rawHex?: string;
	readonly fee?: bigint;
}

/** A fully processed block ready to be applied to storage. */
export interface ProcessedBlock {
	readonly height: BlockHeight;
	readonly hash: BlockHash;
	readonly header: BlockHeader;
	readonly transactions: readonly ProcessedBlockTx[];
}

/** Info needed to undo (revert) a block. */
export interface UndoInfo {
	readonly height: BlockHeight;
	readonly hash: BlockHash;
	/** UTXOs that were created by this block (to remove on undo). */
	readonly addedUtxos: readonly OutpointKey[];
	/** UTXOs that were spent by this block (to restore on undo). */
	readonly removedUtxos: readonly UtxoEntry[];
	/** All scripthashes affected by this block. */
	readonly affectedScriptHashes: ReadonlySet<ScriptHash>;
}
