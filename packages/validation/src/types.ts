import type { decodeTransactionBch, Output } from "@bitauth/libauth";

/** Supported BCH virtual machine versions (matches libauth identifiers). */
export type VmVersion = "BCH_2023_05" | "BCH_2025_05" | "BCH_2026_05" | "BCH_SPEC";

/** Configuration for the transaction verifier. */
export interface TxVerifierConfig {
	/** VM version to use (default: "BCH_2025_05"). */
	vmVersion?: VmVersion;
	/** Whether to enforce standard transaction rules (default: true). */
	standard?: boolean;
	/** Minimum relay fee in satoshis per kilobyte (default: 1000). */
	minRelayFeePerKb?: bigint;
	/** Maximum acceptable fee in satoshis (default: 10_000_000 = 0.1 BCH). */
	maxFee?: bigint;
}

/**
 * Chain state required for consensus checks.
 * The caller derives these from their storage/headers.
 */
export interface ChainState {
	/** Current chain tip height. */
	readonly height: number;
	/** BIP113 Median Time Past at the current tip. */
	readonly medianTimePast: number;
}

/**
 * Source output with consensus-relevant metadata.
 * Extends libauth's Output with confirmation height and coinbase flag.
 */
export interface SourceOutput extends Output {
	/** Confirmation height. 0 = mempool/unconfirmed. Defaults to 1 if omitted. */
	readonly height?: number;
	/** Whether this output was created by a coinbase transaction. */
	readonly isCoinbase?: boolean;
	/** BIP113 MTP at height-1. Required for BIP68 time-based sequence locks. */
	readonly medianTimePast?: number;
}

/** Decoded BCH transaction (non-error result from decodeTransactionBch). */
export type Transaction = Exclude<ReturnType<typeof decodeTransactionBch>, string>;

/** Validated transaction data returned by verify/debug. */
export interface ValidatedTransaction {
	readonly txid: string;
	readonly rawHex: string;
	readonly fee: bigint;
	readonly size: number;
	/** The decoded libauth transaction. */
	readonly transaction: Transaction;
	/** The source outputs as provided by the caller. */
	readonly sourceOutputs: readonly SourceOutput[];
}

/** Successful transaction verification result. */
export interface VerifySuccess {
	readonly success: true;
	readonly txid: string;
	readonly fee: bigint;
	readonly size: number;
	readonly validatedTx: ValidatedTransaction;
}

/** Failed transaction verification result. */
export interface VerifyFailure {
	readonly success: false;
	/** BCHN reject code (e.g. REJECT_INVALID, REJECT_NONSTANDARD). */
	readonly code: number;
	/** BCHN strRejectReason (e.g. "bad-txns-prevout-null"). */
	readonly error: string;
	/** BCHN strDebugMessage — optional extra context. */
	readonly debugMessage?: string;
}

/** Result of verifying a transaction. */
export type VerifyResult = VerifySuccess | VerifyFailure;

/** Per-input debug trace. */
export interface DebugInputResult {
	readonly inputIndex: number;
	readonly success: boolean;
	readonly error?: string;
}

/** Successful debug result with per-input traces. */
export interface DebugSuccess {
	readonly success: true;
	readonly txid: string;
	readonly fee: bigint;
	readonly size: number;
	readonly validatedTx: ValidatedTransaction;
	readonly inputResults: readonly DebugInputResult[];
}

/** Failed debug result with optional partial traces. */
export interface DebugFailure {
	readonly success: false;
	/** BCHN reject code. */
	readonly code: number;
	/** BCHN strRejectReason. */
	readonly error: string;
	/** BCHN strDebugMessage — optional extra context. */
	readonly debugMessage?: string;
	readonly inputResults?: readonly DebugInputResult[];
}

/** Result of debugging a transaction. */
export type DebugResult = DebugSuccess | DebugFailure;

/** Transaction verifier interface. */
export interface TxVerifier {
	/** Verify a raw transaction hex. Returns ValidatedTransaction on success. */
	verify(
		rawHex: string,
		sourceOutputs: readonly SourceOutput[],
		chainState: ChainState,
	): VerifyResult;
	/** Debug a raw transaction hex with per-input traces. Returns ValidatedTransaction on success. */
	debug(
		rawHex: string,
		sourceOutputs: readonly SourceOutput[],
		chainState: ChainState,
	): DebugResult;
}
