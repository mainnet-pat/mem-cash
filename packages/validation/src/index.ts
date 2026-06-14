export type { CheckResult } from "./checks.js";
export {
	checkAbsurdFee,
	checkCoinbaseMaturity,
	checkDustOutputs,
	checkInputValueRanges,
	checkLocktimeFinality,
	checkMinRelayFee,
	checkNullPrevout,
	checkSequenceLocks,
	checkUnspendableInputs,
	getDustThreshold,
} from "./checks.js";
export {
	COINBASE_MATURITY,
	DEFAULT_MAX_FEE,
	DEFAULT_MIN_RELAY_FEE_PER_KB,
	DUST_RELAY_FEE_PER_KB,
	LOCKTIME_THRESHOLD,
	MAX_MONEY,
	MAX_SCRIPT_SIZE,
	MTP_BLOCK_COUNT,
	OP_RETURN,
	SEQUENCE_FINAL,
	SEQUENCE_LOCKTIME_DISABLE_FLAG,
	SEQUENCE_LOCKTIME_GRANULARITY,
	SEQUENCE_LOCKTIME_MASK,
	SEQUENCE_LOCKTIME_TYPE_FLAG,
} from "./constants.js";
export type {
	ChainState,
	DebugFailure,
	DebugInputResult,
	DebugResult,
	DebugSuccess,
	SourceOutput,
	Transaction,
	TxVerifier,
	TxVerifierConfig,
	ValidatedTransaction,
	VerifyFailure,
	VerifyResult,
	VerifySuccess,
	VmVersion,
} from "./types.js";
export type { VmFacade } from "./verifier.js";
export { createTxVerifier, createVmFacade } from "./verifier.js";
