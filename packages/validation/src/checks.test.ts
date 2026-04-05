import { describe, expect, it } from "vitest";
import {
	checkAbsurdFee,
	checkCoinbaseMaturity,
	checkInputValueRanges,
	checkLocktimeFinality,
	checkMinRelayFee,
	checkNullPrevout,
	checkSequenceLocks,
	checkUnspendableInputs,
} from "./checks.js";
import {
	MAX_MONEY,
	OP_RETURN,
	SEQUENCE_FINAL,
	SEQUENCE_LOCKTIME_DISABLE_FLAG,
	SEQUENCE_LOCKTIME_TYPE_FLAG,
} from "./constants.js";

describe("checkNullPrevout", () => {
	const NULL_TXID = "00".repeat(32);
	const NULL_VOUT = 0xffffffff;

	it("passes with normal inputs", () => {
		const result = checkNullPrevout([
			{ txid: "aa".repeat(32), vout: 0 },
			{ txid: "bb".repeat(32), vout: 1 },
		]);
		expect(result.ok).toBe(true);
	});

	it("fails with null outpoint (zero txid + 0xFFFFFFFF vout)", () => {
		const result = checkNullPrevout([
			{ txid: "aa".repeat(32), vout: 0 },
			{ txid: NULL_TXID, vout: NULL_VOUT },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("bad-txns-prevout-null");
	});

	it("passes with null txid but normal vout", () => {
		const result = checkNullPrevout([{ txid: NULL_TXID, vout: 0 }]);
		expect(result.ok).toBe(true);
	});

	it("passes with normal txid but null vout", () => {
		const result = checkNullPrevout([{ txid: "aa".repeat(32), vout: NULL_VOUT }]);
		expect(result.ok).toBe(true);
	});

	it("passes with empty inputs", () => {
		const result = checkNullPrevout([]);
		expect(result.ok).toBe(true);
	});
});

describe("checkInputValueRanges", () => {
	it("passes with values within range", () => {
		const result = checkInputValueRanges([1000n, 2000n, 3000n]);
		expect(result.ok).toBe(true);
	});

	it("passes with value equal to MAX_MONEY", () => {
		const result = checkInputValueRanges([MAX_MONEY]);
		expect(result.ok).toBe(true);
	});

	it("fails when single value exceeds MAX_MONEY", () => {
		const result = checkInputValueRanges([MAX_MONEY + 1n]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("bad-txns-inputvalues-outofrange");
	});

	it("fails when cumulative sum exceeds MAX_MONEY", () => {
		const halfPlus = MAX_MONEY / 2n + 1n;
		const result = checkInputValueRanges([halfPlus, halfPlus]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("bad-txns-inputvalues-outofrange");
	});

	it("passes with empty values", () => {
		const result = checkInputValueRanges([]);
		expect(result.ok).toBe(true);
	});
});

describe("checkCoinbaseMaturity", () => {
	it("passes for non-coinbase inputs", () => {
		const result = checkCoinbaseMaturity([{ height: 50 }], 51);
		expect(result.ok).toBe(true);
	});

	it("passes for coinbase at depth >= 100", () => {
		const result = checkCoinbaseMaturity([{ isCoinbase: true, height: 1 }], 101);
		expect(result.ok).toBe(true);
	});

	it("fails for coinbase at depth < 100", () => {
		const result = checkCoinbaseMaturity([{ isCoinbase: true, height: 1 }], 100);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("bad-txns-premature-spend-of-coinbase");
			expect(result.debugMessage).toContain("tried to spend coinbase at depth");
		}
	});

	it("passes for coinbase at exactly depth 100", () => {
		const result = checkCoinbaseMaturity([{ isCoinbase: true, height: 10 }], 110);
		expect(result.ok).toBe(true);
	});

	it("handles mixed inputs (coinbase and non-coinbase)", () => {
		const result = checkCoinbaseMaturity([{ height: 50 }, { isCoinbase: true, height: 1 }], 101);
		expect(result.ok).toBe(true);
	});

	it("treats undefined isCoinbase as false", () => {
		const result = checkCoinbaseMaturity([{ isCoinbase: undefined, height: 50 }], 51);
		expect(result.ok).toBe(true);
	});
});

describe("checkUnspendableInputs", () => {
	it("passes with normal scripts", () => {
		const result = checkUnspendableInputs([
			{ lockingBytecode: Uint8Array.of(0x51) }, // OP_1
			{ lockingBytecode: Uint8Array.of(0x76, 0xa9) }, // OP_DUP OP_HASH160
		]);
		expect(result.ok).toBe(true);
	});

	it("fails when first byte is OP_RETURN", () => {
		const result = checkUnspendableInputs([
			{ lockingBytecode: Uint8Array.of(OP_RETURN, 0x04, 0x01, 0x02, 0x03, 0x04) },
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("bad-txns-input-scriptpubkey-unspendable");
	});

	it("fails when script exceeds 10,000 bytes", () => {
		const result = checkUnspendableInputs([{ lockingBytecode: new Uint8Array(10_001) }]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("bad-txns-input-scriptpubkey-unspendable");
	});

	it("passes with script exactly at 10,000 bytes", () => {
		const result = checkUnspendableInputs([{ lockingBytecode: new Uint8Array(10_000) }]);
		expect(result.ok).toBe(true);
	});

	it("passes with empty script", () => {
		const result = checkUnspendableInputs([{ lockingBytecode: new Uint8Array(0) }]);
		expect(result.ok).toBe(true);
	});
});

describe("checkLocktimeFinality", () => {
	it("passes when locktime is 0", () => {
		const result = checkLocktimeFinality(0, [{ sequenceNumber: 0 }], 100, 1000);
		expect(result.ok).toBe(true);
	});

	it("passes when height-based locktime is below block height", () => {
		const result = checkLocktimeFinality(99, [{ sequenceNumber: 0 }], 100, 1000);
		expect(result.ok).toBe(true);
	});

	it("passes when time-based locktime is below MTP", () => {
		const result = checkLocktimeFinality(500_000_000, [{ sequenceNumber: 0 }], 100, 500_000_001);
		expect(result.ok).toBe(true);
	});

	it("passes when all inputs are final (sequence 0xFFFFFFFF) with future locktime", () => {
		const result = checkLocktimeFinality(
			200,
			[{ sequenceNumber: SEQUENCE_FINAL }, { sequenceNumber: SEQUENCE_FINAL }],
			100,
			1000,
		);
		expect(result.ok).toBe(true);
	});

	it("fails with non-final input and future height locktime", () => {
		const result = checkLocktimeFinality(200, [{ sequenceNumber: 0 }], 100, 1000);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("bad-txns-nonfinal");
			expect(result.debugMessage).toBe("non-final transaction");
		}
	});

	it("fails with non-final input and future time locktime", () => {
		const result = checkLocktimeFinality(600_000_000, [{ sequenceNumber: 0 }], 100, 500_000_000);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("bad-txns-nonfinal");
	});

	it("fails when one of many inputs is not final", () => {
		const result = checkLocktimeFinality(
			200,
			[{ sequenceNumber: SEQUENCE_FINAL }, { sequenceNumber: 0 }],
			100,
			1000,
		);
		expect(result.ok).toBe(false);
	});
});

describe("checkSequenceLocks", () => {
	it("skips for tx version < 2", () => {
		const result = checkSequenceLocks(1, [{ sequenceNumber: 5, height: 100 }], 101, 0);
		expect(result.ok).toBe(true);
	});

	it("skips inputs with disable flag set", () => {
		const result = checkSequenceLocks(
			2,
			[{ sequenceNumber: SEQUENCE_LOCKTIME_DISABLE_FLAG | 1000, height: 100 }],
			100,
			0,
		);
		expect(result.ok).toBe(true);
	});

	it("passes satisfied height-based lock", () => {
		// Requires 10 blocks depth: spendHeight(110) - inputHeight(100) = 10 >= 10
		const result = checkSequenceLocks(2, [{ sequenceNumber: 10, height: 100 }], 110, 0);
		expect(result.ok).toBe(true);
	});

	it("fails unsatisfied height-based lock", () => {
		// Requires 10 blocks depth: spendHeight(109) - inputHeight(100) = 9 < 10
		const result = checkSequenceLocks(2, [{ sequenceNumber: 10, height: 100 }], 109, 0);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("non-BIP68-final");
	});

	it("passes satisfied time-based lock", () => {
		// Time-based: flag bit 22 set, requires 2 * 512 = 1024 seconds
		const seq = SEQUENCE_LOCKTIME_TYPE_FLAG | 2;
		// spendMtp(6100) - prevMtp(5000) = 1100 >= 1024
		const result = checkSequenceLocks(
			2,
			[{ sequenceNumber: seq, height: 100, medianTimePast: 5000 }],
			110,
			6100,
		);
		expect(result.ok).toBe(true);
	});

	it("fails unsatisfied time-based lock", () => {
		const seq = SEQUENCE_LOCKTIME_TYPE_FLAG | 2;
		// spendMtp(5500) - prevMtp(5000) = 500 < 1024
		const result = checkSequenceLocks(
			2,
			[{ sequenceNumber: seq, height: 100, medianTimePast: 5000 }],
			110,
			5500,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("non-BIP68-final");
	});
});

describe("checkMinRelayFee", () => {
	it("passes when fee meets minimum", () => {
		// 1000 sat/KB * 200 bytes / 1000 = 200 sats minimum
		const result = checkMinRelayFee(200n, 200, 1000n);
		expect(result.ok).toBe(true);
	});

	it("fails when fee is below minimum", () => {
		const result = checkMinRelayFee(199n, 200, 1000n);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("min relay fee not met");
	});

	it("uses floor division matching BCHN CFeeRate::GetFee", () => {
		// 1000 * 1 / 1000 = 1
		const result = checkMinRelayFee(1n, 1, 1000n);
		expect(result.ok).toBe(true);

		// 1000 * 999 / 1000 = 999
		const result2 = checkMinRelayFee(999n, 999, 1000n);
		expect(result2.ok).toBe(true);

		// 1000 * 1001 / 1000 = 1001 exactly, so fee 1001 passes
		const result3 = checkMinRelayFee(1001n, 1001, 1000n);
		expect(result3.ok).toBe(true);

		// But fee 1000 for 1001 bytes fails (need 1001)
		const result4 = checkMinRelayFee(1000n, 1001, 1000n);
		expect(result4.ok).toBe(false);
	});

	it("floors to min 1 sat for non-zero size and positive rate (BCHN special case)", () => {
		// 3 sat/KB * 500 bytes = 1500 / 1000 = 1 (floor), so fee 1 passes
		const result = checkMinRelayFee(1n, 500, 3n);
		expect(result.ok).toBe(true);

		// fee 0 fails (min 1 sat when rate > 0 and size > 0)
		const result2 = checkMinRelayFee(0n, 500, 3n);
		expect(result2.ok).toBe(false);

		// 1 sat/KB * 999 bytes = 999 / 1000 = 0 (floor) → bumped to 1 sat
		const result3 = checkMinRelayFee(1n, 999, 1n);
		expect(result3.ok).toBe(true);
		const result4 = checkMinRelayFee(0n, 999, 1n);
		expect(result4.ok).toBe(false);
	});

	it("passes with zero fee rate", () => {
		const result = checkMinRelayFee(0n, 200, 0n);
		expect(result.ok).toBe(true);
	});
});

describe("checkAbsurdFee", () => {
	it("passes when fee is at the max", () => {
		const result = checkAbsurdFee(10_000_000n, 10_000_000n);
		expect(result.ok).toBe(true);
	});

	it("passes when fee is below max", () => {
		const result = checkAbsurdFee(5_000_000n, 10_000_000n);
		expect(result.ok).toBe(true);
	});

	it("fails when fee exceeds max", () => {
		const result = checkAbsurdFee(10_000_001n, 10_000_000n);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe("absurdly-high-fee");
	});
});
