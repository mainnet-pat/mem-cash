import {
	REJECT_HIGHFEE,
	REJECT_INSUFFICIENTFEE,
	REJECT_INVALID,
	REJECT_NONSTANDARD,
} from "@mem-cash/types";
import {
	COINBASE_MATURITY,
	LOCKTIME_THRESHOLD,
	MAX_MONEY,
	MAX_SCRIPT_SIZE,
	OP_RETURN,
	SEQUENCE_FINAL,
	SEQUENCE_LOCKTIME_DISABLE_FLAG,
	SEQUENCE_LOCKTIME_GRANULARITY,
	SEQUENCE_LOCKTIME_MASK,
	SEQUENCE_LOCKTIME_TYPE_FLAG,
} from "./constants.js";

/**
 * Result of a consensus/policy check.
 * On failure, `code` is the BCHN reject code, `error` is the BCHN
 * strRejectReason, and `debugMessage` is optional extra context
 * (matching BCHN's strDebugMessage).
 */
export type CheckResult =
	| { ok: true }
	| { ok: false; code: number; error: string; debugMessage?: string };

const CHECK_OK: CheckResult = { ok: true };

/** Input descriptor for null prevout check. */
interface PrevoutInput {
	readonly txid: string;
	readonly vout: number;
}

/**
 * Reject inputs referencing the null outpoint (all-zero txid + vout 0xFFFFFFFF).
 * BCHN: CheckRegularTransaction → "bad-txns-prevout-null" (REJECT_INVALID, DoS 10).
 */
export function checkNullPrevout(inputs: readonly PrevoutInput[]): CheckResult {
	for (const input of inputs) {
		if (input.txid === "00".repeat(32) && input.vout === 0xffffffff) {
			return { ok: false, code: REJECT_INVALID, error: "bad-txns-prevout-null" };
		}
	}
	return CHECK_OK;
}

/**
 * Validate each input value is within range and cumulative sum does not exceed MAX_MONEY.
 * BCHN: CheckTxInputs → "bad-txns-inputvalues-outofrange" (REJECT_INVALID, DoS 100).
 */
export function checkInputValueRanges(inputValues: readonly bigint[]): CheckResult {
	let sum = 0n;
	for (const value of inputValues) {
		if (value > MAX_MONEY) {
			return { ok: false, code: REJECT_INVALID, error: "bad-txns-inputvalues-outofrange" };
		}
		sum += value;
		if (sum > MAX_MONEY) {
			return { ok: false, code: REJECT_INVALID, error: "bad-txns-inputvalues-outofrange" };
		}
	}
	return CHECK_OK;
}

/** Input descriptor for coinbase maturity check. */
interface MaturityInput {
	readonly isCoinbase?: boolean | undefined;
	readonly height: number;
}

/**
 * Check that coinbase outputs have sufficient maturity (>= 100 blocks deep).
 * BCHN: CheckTxInputs → "bad-txns-premature-spend-of-coinbase" (REJECT_INVALID).
 */
export function checkCoinbaseMaturity(
	inputs: readonly MaturityInput[],
	spendHeight: number,
): CheckResult {
	for (const input of inputs) {
		if (input.isCoinbase) {
			const depth = spendHeight - input.height;
			if (depth < COINBASE_MATURITY) {
				return {
					ok: false,
					code: REJECT_INVALID,
					error: "bad-txns-premature-spend-of-coinbase",
					debugMessage: `tried to spend coinbase at depth ${depth}`,
				};
			}
		}
	}
	return CHECK_OK;
}

/** Input descriptor for unspendable check. */
interface ScriptInput {
	readonly lockingBytecode: Uint8Array;
}

/**
 * Reject inputs whose locking script starts with OP_RETURN or exceeds MAX_SCRIPT_SIZE.
 * BCHN: CheckTxInputs → "bad-txns-input-scriptpubkey-unspendable" (REJECT_INVALID, DoS 100).
 */
export function checkUnspendableInputs(inputs: readonly ScriptInput[]): CheckResult {
	for (const entry of inputs) {
		const script = entry.lockingBytecode;
		if (script.length > 0 && script[0] === OP_RETURN) {
			return {
				ok: false,
				code: REJECT_INVALID,
				error: "bad-txns-input-scriptpubkey-unspendable",
				debugMessage: "input scriptPubKey is unspendable",
			};
		}
		if (script.length > MAX_SCRIPT_SIZE) {
			return {
				ok: false,
				code: REJECT_INVALID,
				error: "bad-txns-input-scriptpubkey-unspendable",
				debugMessage: "input scriptPubKey is unspendable",
			};
		}
	}
	return CHECK_OK;
}

/** Input descriptor for locktime finality check. */
interface SequenceInput {
	readonly sequenceNumber: number;
}

/**
 * Check IsFinalTx logic from BCHN.
 * BCHN: ContextualCheckTransaction → "bad-txns-nonfinal" (REJECT_INVALID, DoS 10).
 */
export function checkLocktimeFinality(
	locktime: number,
	inputs: readonly SequenceInput[],
	blockHeight: number,
	mtp: number,
): CheckResult {
	if (locktime === 0) return CHECK_OK;

	const threshold = locktime < LOCKTIME_THRESHOLD ? blockHeight : mtp;
	if (locktime < threshold) return CHECK_OK;

	// Locktime not satisfied by height/time — check if all inputs are final
	for (const input of inputs) {
		if (input.sequenceNumber !== SEQUENCE_FINAL) {
			return {
				ok: false,
				code: REJECT_INVALID,
				error: "bad-txns-nonfinal",
				debugMessage: "non-final transaction",
			};
		}
	}
	return CHECK_OK;
}

/** Input descriptor for BIP68 sequence lock check. */
interface SequenceLockInput {
	readonly sequenceNumber: number;
	readonly height: number;
	/** MTP at height-1. Required for time-based locks. */
	readonly medianTimePast?: number;
}

/**
 * Check BIP68 relative sequence locks.
 * Only applies when txVersion >= 2.
 * BCHN: AcceptToMemoryPoolWorker → "non-BIP68-final" (REJECT_NONSTANDARD, DoS 0).
 */
export function checkSequenceLocks(
	txVersion: number,
	inputs: readonly SequenceLockInput[],
	spendHeight: number,
	spendMtp: number,
): CheckResult {
	if (txVersion < 2) return CHECK_OK;

	for (const input of inputs) {
		const seq = input.sequenceNumber;

		// Bit 31 set → relative lock disabled for this input
		if (seq & SEQUENCE_LOCKTIME_DISABLE_FLAG) continue;

		const maskedSeq = seq & SEQUENCE_LOCKTIME_MASK;

		if (seq & SEQUENCE_LOCKTIME_TYPE_FLAG) {
			// Time-based lock: compare MTP difference
			const prevMtp = input.medianTimePast ?? 0;
			const requiredTime = maskedSeq * SEQUENCE_LOCKTIME_GRANULARITY;
			if (spendMtp - prevMtp < requiredTime) {
				return { ok: false, code: REJECT_NONSTANDARD, error: "non-BIP68-final" };
			}
		} else {
			// Height-based lock
			const requiredDepth = maskedSeq;
			if (spendHeight - input.height < requiredDepth) {
				return { ok: false, code: REJECT_NONSTANDARD, error: "non-BIP68-final" };
			}
		}
	}
	return CHECK_OK;
}

/**
 * Check that fee meets the minimum relay fee rate.
 * BCHN: AcceptToMemoryPoolWorker → "min relay fee not met" (REJECT_INSUFFICIENTFEE, DoS 0).
 */
export function checkMinRelayFee(fee: bigint, txSize: number, minFeePerKb: bigint): CheckResult {
	const minFee = (minFeePerKb * BigInt(txSize) + 999n) / 1000n;
	if (fee < minFee) {
		return { ok: false, code: REJECT_INSUFFICIENTFEE, error: "min relay fee not met" };
	}
	return CHECK_OK;
}

/**
 * Guard against absurdly high fees.
 * BCHN: AcceptToMemoryPoolWorker → "absurdly-high-fee" (REJECT_HIGHFEE).
 */
export function checkAbsurdFee(fee: bigint, maxFee: bigint): CheckResult {
	if (fee > maxFee) {
		return {
			ok: false,
			code: REJECT_HIGHFEE,
			error: "absurdly-high-fee",
			debugMessage: `${fee} > ${maxFee}`,
		};
	}
	return CHECK_OK;
}

/**
 * Check that no non-OP_RETURN output is dust.
 * BCHN: IsStandardTx → "dust" (REJECT_NONSTANDARD, DoS 0).
 */
export function checkDustOutputs(
	outputs: readonly { readonly lockingBytecode: Uint8Array; readonly valueSatoshis: bigint }[],
	dustRelayFeePerKb: bigint,
): CheckResult {
	for (const output of outputs) {
		// OP_RETURN outputs are exempt from dust checks
		if (output.lockingBytecode.length > 0 && output.lockingBytecode[0] === OP_RETURN) {
			continue;
		}
		// Empty scripts are unspendable — also exempt
		if (output.lockingBytecode.length === 0) {
			continue;
		}

		// Serialize size of a CTxOut: 8 (value) + compactSize(scriptLen) + scriptLen
		// For scripts < 253 bytes, compactSize is 1 byte
		const scriptLen = output.lockingBytecode.length;
		const outputSize = 8 + (scriptLen < 253 ? 1 : 3) + scriptLen;
		// 148 = estimated input size to spend (32 prevhash + 4 previndex + 1 scriptLen + 107 sigScript + 4 sequence)
		const spendSize = outputSize + 148;
		const dustThreshold = (3n * dustRelayFeePerKb * BigInt(spendSize)) / 1000n;

		if (output.valueSatoshis < dustThreshold) {
			return { ok: false, code: REJECT_NONSTANDARD, error: "dust" };
		}
	}
	return CHECK_OK;
}
