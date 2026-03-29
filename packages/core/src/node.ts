import {
	binToHex,
	decodeTransactionBch,
	hashTransactionUiOrder,
	hexToBin,
	sha256,
	utf8ToBin,
} from "@bitauth/libauth";
import type { TestableStorage } from "@mem-cash/storage";
import { createMemoryStorage } from "@mem-cash/storage";
import type {
	BlockHeader,
	ProcessedBlock,
	ProcessedBlockInput,
	ProcessedBlockOutput,
	ProcessedBlockTx,
	ScriptHash,
	StorageReader,
	UtxoEntry,
} from "@mem-cash/types";
import {
	computeMedianTimePast,
	makeOutpointKey,
	REJECT_INVALID,
	REJECT_MALFORMED,
} from "@mem-cash/types";
import type {
	ChainState,
	DebugResult,
	SourceOutput,
	TxVerifier,
	ValidatedTransaction,
} from "@mem-cash/validation";
import { acceptToMempool } from "./accept.js";
import type { SubscriptionManager } from "./subscriptionManager.js";
import { createSubscriptionManager } from "./subscriptionManager.js";

/** Configuration for the Node. All fields optional. */
export interface NodeConfig {
	/** Transaction verifier. When provided, submitTransaction runs full validation. */
	readonly verifier?: TxVerifier;
}

/** Parameters for adding a UTXO. */
export interface AddUtxoParams {
	readonly txid: string;
	readonly vout: number;
	readonly satoshis: bigint;
	readonly scriptHash: string;
	readonly height: number;
	readonly lockingBytecode?: Uint8Array;
	readonly isCoinbase?: boolean;
}

/** Successful transaction submission. */
export interface SubmitSuccess {
	readonly success: true;
	readonly txid: string;
	readonly fee: bigint;
	readonly size: number;
	readonly affectedScriptHashes: ReadonlySet<ScriptHash>;
}

/** Failed transaction submission. */
export interface SubmitFailure {
	readonly success: false;
	/** BCHN reject code (e.g. REJECT_INVALID, REJECT_NONSTANDARD). */
	readonly code: number;
	/** BCHN strRejectReason. */
	readonly error: string;
	/** BCHN strDebugMessage — optional extra context. */
	readonly debugMessage?: string;
}

/** Result of submitting a transaction. */
export type SubmitResult = SubmitSuccess | SubmitFailure;

/** Result of mining blocks. */
export interface MineResult {
	/** New chain tip height after mining. */
	readonly height: number;
	/** All scripthashes affected by confirming mempool transactions. */
	readonly affectedScriptHashes: ReadonlySet<ScriptHash>;
}

/** The core node engine with in-memory storage. */
export interface Node extends StorageReader {
	/** Submit a raw transaction hex. */
	readonly submitTransaction: (rawHex: string) => SubmitResult;

	/** Debug a raw transaction: run full validation with per-input traces, without accepting to mempool. */
	readonly debugTransaction: (rawHex: string) => DebugResult | SubmitFailure;

	/** Mine a block: confirms all mempool transactions, advances chain tip. */
	readonly mine: (timestamp?: number) => MineResult;

	/** Set chain tip with 11 headers at the given timestamp (sets both height and MTP). */
	readonly setChainTip: (height: number, timestamp: number) => void;

	/** Add a UTXO to the confirmed set. */
	readonly addUtxo: (params: AddUtxoParams) => void;

	/** The underlying storage with test helpers for direct manipulation. */
	readonly storage: TestableStorage;

	/** The subscription manager. */
	readonly subscriptions: SubscriptionManager;
}

/**
 * Create a core node with in-memory storage.
 *
 * Wires together storage, optional transaction verifier, and subscription manager.
 *
 * When `config.verifier` is provided, `submitTransaction` runs full consensus
 * and policy checks. Without a verifier, transactions are decoded and accepted
 * directly (useful for testing or trusted-input scenarios).
 */
export function createNode(config?: NodeConfig): Node {
	const storage = createMemoryStorage();

	const verifier = config?.verifier;
	const subscriptions = createSubscriptionManager(storage);

	function deriveChainState(): ChainState | null {
		const tip = storage.getTip();
		if (!tip) return null;
		return {
			height: tip.height,
			medianTimePast: computeMedianTimePast(storage, tip.height),
		};
	}

	/** Resolve failure with BCHN reject code. */
	interface ResolveFailure {
		ok: false;
		code: number;
		error: string;
		debugMessage?: string;
	}

	function resolveSourceOutputs(
		rawHex: string,
	): { ok: true; outputs: SourceOutput[] } | ResolveFailure {
		const rawBytes = hexToBin(rawHex);
		const decoded = decodeTransactionBch(rawBytes);
		if (typeof decoded === "string")
			return {
				ok: false,
				code: REJECT_MALFORMED,
				error: "TX decode failed",
				debugMessage: decoded,
			};

		const sourceOutputs: SourceOutput[] = [];
		for (const input of decoded.inputs) {
			const parentTxid = binToHex(input.outpointTransactionHash);
			const key = makeOutpointKey(parentTxid, input.outpointIndex);
			const utxo = storage.getUtxoByOutpoint(key);
			if (!utxo) {
				return { ok: false, code: REJECT_INVALID, error: "bad-txns-inputs-missingorspent" };
			}
			sourceOutputs.push(utxoToSourceOutput(utxo));
		}
		return { ok: true, outputs: sourceOutputs };
	}

	/** Convert a reject failure to a SubmitFailure, avoiding undefined in optional fields. */
	function toSubmitFailure(f: {
		code: number;
		error: string;
		debugMessage?: string;
	}): SubmitFailure {
		const result: SubmitFailure = { success: false, code: f.code, error: f.error };
		if (f.debugMessage != null) (result as { debugMessage: string }).debugMessage = f.debugMessage;
		return result;
	}

	function submitTransaction(rawHex: string): SubmitResult {
		const resolved = resolveSourceOutputs(rawHex);
		if (!resolved.ok) return toSubmitFailure(resolved);
		const sourceOutputs = resolved.outputs;

		let validatedTx: ValidatedTransaction;

		if (verifier) {
			const chainState = deriveChainState();
			if (!chainState) {
				return { success: false, code: REJECT_INVALID, error: "No chain tip set" };
			}
			const result = verifier.verify(rawHex, sourceOutputs, chainState);
			if (!result.success) return toSubmitFailure(result);
			validatedTx = result.validatedTx;
		} else {
			const rawBytes = hexToBin(rawHex);
			const decoded = decodeTransactionBch(rawBytes);
			if (typeof decoded === "string") {
				return {
					success: false,
					code: REJECT_MALFORMED,
					error: "TX decode failed",
					debugMessage: decoded,
				};
			}
			const txid = binToHex(hashTransactionUiOrder(rawBytes));
			const inputSum = sourceOutputs.reduce((sum, so) => sum + so.valueSatoshis, 0n);
			const outputSum = decoded.outputs.reduce((sum, o) => sum + o.valueSatoshis, 0n);
			validatedTx = {
				txid,
				rawHex,
				fee: inputSum - outputSum,
				size: rawBytes.length,
				transaction: decoded,
				sourceOutputs,
			};
		}

		const { affectedScriptHashes } = acceptToMempool(storage, validatedTx);
		subscriptions.notifyChanges(affectedScriptHashes);

		return {
			success: true,
			txid: validatedTx.txid,
			fee: validatedTx.fee,
			size: validatedTx.size,
			affectedScriptHashes,
		};
	}

	function debugTransaction(rawHex: string): DebugResult | SubmitFailure {
		if (!verifier) {
			return { success: false, code: REJECT_INVALID, error: "No verifier configured" };
		}
		const resolved = resolveSourceOutputs(rawHex);
		if (!resolved.ok) return toSubmitFailure(resolved);

		const chainState = deriveChainState();
		if (!chainState) {
			return { success: false, code: REJECT_INVALID, error: "No chain tip set" };
		}

		return verifier.debug(rawHex, resolved.outputs, chainState);
	}

	function setChainTip(height: number, timestamp: number): void {
		const startHeight = Math.max(0, height - 10);
		for (let h = startHeight; h <= height; h++) {
			storage._test.header.add({
				hash: h.toString(16).padStart(64, "0"),
				height: h,
				timestamp,
			});
		}
	}

	function addUtxo(params: AddUtxoParams): void {
		storage._test.utxo.add(
			Object.assign(
				{
					txid: params.txid,
					vout: params.vout,
					satoshis: params.satoshis,
					scriptHash: params.scriptHash,
					height: params.height,
					lockingBytecode: params.lockingBytecode ?? new Uint8Array(0),
				},
				params.isCoinbase ? { isCoinbase: true } : {},
			),
		);
	}

	function mine(timestamp?: number): MineResult {
		const tip = storage.getTip();
		const newHeight = (tip?.height ?? 0) + 1;
		const ts = timestamp ?? 1700000000 + newHeight;

		const txids = storage.getMempoolTxids();
		const processedTxs: ProcessedBlockTx[] = [];

		for (const txid of txids) {
			const mempoolTx = storage.getMempoolTx(txid);
			if (!mempoolTx) continue;
			const rawHex = storage.getRawTx(txid);

			const inputs: ProcessedBlockInput[] = [];
			const outputs: ProcessedBlockOutput[] = [];

			for (const [, entry] of mempoolTx.entries) {
				for (const key of entry.confirmedSpends) {
					const [prevTxid, prevVout] = key.split(":") as [string, string];
					inputs.push({ prevOutpoint: { txid: prevTxid, vout: Number(prevVout) } });
				}
				for (const key of entry.unconfirmedSpends) {
					const [prevTxid, prevVout] = key.split(":") as [string, string];
					inputs.push({ prevOutpoint: { txid: prevTxid, vout: Number(prevVout) } });
				}
				for (const key of entry.outputs) {
					const utxo = storage.getMempoolUtxo(key);
					if (utxo) {
						outputs.push({ outpointKey: key, utxo: { ...utxo, height: newHeight } });
					}
				}
			}

			const ptx: ProcessedBlockTx = { txid, inputs, outputs, fee: mempoolTx.fee };
			if (rawHex) (ptx as { rawHex: string }).rawHex = rawHex;
			processedTxs.push(ptx);
		}

		storage.clearMempool();

		const blockHash = binToHex(sha256.hash(utf8ToBin(`block-${newHeight}`)));
		const header: BlockHeader = {
			hash: blockHash,
			height: newHeight,
			version: 1,
			prevHash: tip?.hash ?? "0".repeat(64),
			merkleRoot: "0".repeat(64),
			timestamp: ts,
			bits: 0x1d00ffff,
			nonce: 0,
			hex: "0".repeat(160),
		};

		const block: ProcessedBlock = {
			height: newHeight,
			hash: blockHash,
			header,
			transactions: processedTxs,
		};
		const affectedScriptHashes = storage.applyBlock(block);

		setChainTip(newHeight, ts);
		subscriptions.notifyChanges(affectedScriptHashes);
		subscriptions.notifyNewTip(header);

		return { height: newHeight, affectedScriptHashes };
	}

	return {
		// StorageReader delegation
		getHeader: storage.getHeader,
		getHeaderByHash: storage.getHeaderByHash,
		getTip: storage.getTip,
		getHistory: storage.getHistory,
		getMempoolHistory: storage.getMempoolHistory,
		getBalance: storage.getBalance,
		getUtxos: storage.getUtxos,
		getTx: storage.getTx,
		getRawTx: storage.getRawTx,
		getScriptHashStatus: storage.getScriptHashStatus,
		getMempoolTx: storage.getMempoolTx,
		getTxidsAtHeight: storage.getTxidsAtHeight,
		getUtxoByOutpoint: storage.getUtxoByOutpoint,
		getMempoolTxids: storage.getMempoolTxids,
		getMempoolUtxo: storage.getMempoolUtxo,
		// Node operations
		submitTransaction,
		debugTransaction,
		mine,
		setChainTip,
		addUtxo,
		storage,
		subscriptions,
	};
}

/** Map a storage UtxoEntry to a validation SourceOutput. */
function utxoToSourceOutput(utxo: UtxoEntry): SourceOutput {
	const so: SourceOutput = {
		lockingBytecode: utxo.lockingBytecode,
		valueSatoshis: utxo.satoshis,
	};
	if (utxo.height > 0) {
		(so as { height: number }).height = utxo.height;
	}
	if (utxo.isCoinbase) {
		(so as { isCoinbase: boolean }).isCoinbase = true;
	}
	if (utxo.tokenData) {
		(so as { token: unknown }).token = {
			category: hexToBin(utxo.tokenData.category),
			amount: utxo.tokenData.amount,
			nft: utxo.tokenData.nft
				? {
						commitment: hexToBin(utxo.tokenData.nft.commitment),
						capability: utxo.tokenData.nft.capability,
					}
				: undefined,
		};
	}
	return so;
}
