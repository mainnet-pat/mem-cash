import { binToHex, encodeTransactionBch, hashTransactionUiOrder, hexToBin } from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import { OP_RETURN } from "./constants.js";
import type { ChainState, SourceOutput, VerifyFailure, VerifySuccess } from "./types.js";
import { createTxVerifier } from "./verifier.js";

/** OP_1 locking script — always succeeds. */
const OP_TRUE = Uint8Array.of(0x51);
/** OP_0 locking script — always fails. */
const OP_FALSE = Uint8Array.of(0x00);

const DEFAULT_CHAIN_STATE: ChainState = {
	height: 200,
	medianTimePast: 1700000000,
};

/**
 * Build a raw transaction hex that spends the given inputs and creates
 * the given outputs. Returns { rawHex, expectedTxid }.
 */
function buildRawTx(
	inputs: {
		parentTxid: string;
		vout: number;
		unlockingBytecode?: Uint8Array;
		sequenceNumber?: number;
	}[],
	outputs: { lockingBytecode: Uint8Array; satoshis: bigint }[],
	options?: { locktime?: number; version?: number },
): { rawHex: string; expectedTxid: string } {
	const tx = {
		version: options?.version ?? 2,
		inputs: inputs.map((inp) => ({
			outpointTransactionHash: hexToBin(inp.parentTxid),
			outpointIndex: inp.vout,
			unlockingBytecode: inp.unlockingBytecode ?? new Uint8Array(0),
			sequenceNumber: inp.sequenceNumber ?? 0xffffffff,
		})),
		outputs: outputs.map((out) => ({
			lockingBytecode: out.lockingBytecode,
			valueSatoshis: out.satoshis,
		})),
		locktime: options?.locktime ?? 0,
	};
	const encoded = encodeTransactionBch(tx);
	const rawHex = binToHex(encoded);
	const expectedTxid = binToHex(hashTransactionUiOrder(encoded));
	return { rawHex, expectedTxid };
}

/**
 * Build a tx that is at least 65 bytes (BCH minimum).
 * Uses 2 outputs to pad size.
 */
function buildValidTx(
	parentTxid: string,
	vout: number,
	inputSatoshis: bigint,
): { rawHex: string; expectedTxid: string } {
	const fee = 100n;
	const outputAmount = (inputSatoshis - fee) / 2n;
	const remainder = inputSatoshis - fee - outputAmount;
	return buildRawTx(
		[{ parentTxid, vout }],
		[
			{ lockingBytecode: OP_TRUE, satoshis: outputAmount },
			{ lockingBytecode: OP_TRUE, satoshis: remainder },
		],
	);
}

function makeSourceOutput(overrides: Partial<SourceOutput> = {}): SourceOutput {
	return {
		lockingBytecode: OP_TRUE,
		valueSatoshis: 10000n,
		height: 1,
		...overrides,
	};
}

describe("TxVerifier", () => {
	describe("verify", () => {
		it("accepts valid tx with OP_1 locking script", async () => {
			const parentTxid = "aa".repeat(32);
			const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
			const { rawHex, expectedTxid } = buildValidTx(parentTxid, 0, 10000n);
			const sourceOutputs = [makeSourceOutput()];

			const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

			expect(result.success).toBe(true);
			const success = result as VerifySuccess;
			expect(success.txid).toBe(expectedTxid);
			expect(success.fee).toBe(100n);
			expect(success.size).toBeGreaterThanOrEqual(65);
			expect(success.validatedTx).toBeDefined();
			expect(success.validatedTx.transaction).toBeDefined();
			expect(success.validatedTx.sourceOutputs).toEqual(sourceOutputs);
		});

		it("rejects VM failure (OP_0 locking script)", async () => {
			const parentTxid = "aa".repeat(32);
			const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
			const { rawHex } = buildValidTx(parentTxid, 0, 10000n);
			const sourceOutputs = [makeSourceOutput({ lockingBytecode: OP_FALSE })];

			const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);
			expect(result.success).toBe(false);
		});

		it("rejects when outputs exceed inputs", async () => {
			const parentTxid = "aa".repeat(32);
			const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
			const { rawHex } = buildRawTx(
				[{ parentTxid, vout: 0 }],
				[
					{ lockingBytecode: OP_TRUE, satoshis: 600n },
					{ lockingBytecode: OP_TRUE, satoshis: 600n },
				],
			);
			const sourceOutputs = [makeSourceOutput({ valueSatoshis: 1000n })];

			const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);
			expect(result.success).toBe(false);
			expect((result as VerifyFailure).error).toBe("bad-txns-in-belowout");
		});

		it("rejects invalid hex", async () => {
			const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
			const result = verifier.verify("zzzz", [], DEFAULT_CHAIN_STATE);
			expect(result.success).toBe(false);
			expect((result as VerifyFailure).error).toBe("TX decode failed");
		});

		it("rejects mismatched sourceOutputs length", async () => {
			const parentTxid = "aa".repeat(32);
			const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
			const { rawHex } = buildValidTx(parentTxid, 0, 10000n);

			// Tx has 1 input but we provide 0 source outputs
			const result = verifier.verify(rawHex, [], DEFAULT_CHAIN_STATE);
			expect(result.success).toBe(false);
			expect((result as VerifyFailure).error).toBe("bad-txns-inputs-missingorspent");
		});

		it("works with different VM versions", async () => {
			const parentTxid = "aa".repeat(32);
			for (const vmVersion of ["BCH_2023_05", "BCH_2025_05", "BCH_2026_05", "BCH_SPEC"] as const) {
				const verifier = await createTxVerifier({ vmVersion, standard: false });
				const { rawHex } = buildValidTx(parentTxid, 0, 10000n);
				const sourceOutputs = [makeSourceOutput()];
				const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);
				expect(result.success).toBe(true);
			}
		});
	});

	describe("debug", () => {
		it("returns input results on success", async () => {
			const parentTxid = "aa".repeat(32);
			const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
			const { rawHex } = buildValidTx(parentTxid, 0, 10000n);
			const sourceOutputs = [makeSourceOutput()];

			const result = verifier.debug(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.inputResults).toHaveLength(1);
				expect(result.inputResults[0]?.inputIndex).toBe(0);
				expect(result.inputResults[0]?.success).toBe(true);
				expect(result.fee).toBe(100n);
				expect(result.validatedTx).toBeDefined();
			}
		});

		it("returns partial traces on failure", async () => {
			const parentTxid = "aa".repeat(32);
			const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
			const { rawHex } = buildValidTx(parentTxid, 0, 10000n);
			const sourceOutputs = [makeSourceOutput({ lockingBytecode: OP_FALSE })];

			const result = verifier.debug(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.inputResults).toBeDefined();
				expect(result.inputResults?.length).toBeGreaterThan(0);
				expect(result.inputResults?.[0]?.success).toBe(false);
			}
		});
	});
});

describe("consensus checks via verifier", () => {
	it("rejects immature coinbase spend", async () => {
		const parentTxid = "aa".repeat(32);
		const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
		const { rawHex } = buildValidTx(parentTxid, 0, 10000n);

		// height 150, spendHeight 201 → depth = 51 < 100
		const sourceOutputs = [makeSourceOutput({ height: 150, isCoinbase: true })];
		const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("bad-txns-premature-spend-of-coinbase");
		}
	});

	it("accepts mature coinbase spend", async () => {
		const parentTxid = "aa".repeat(32);
		const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
		const { rawHex } = buildValidTx(parentTxid, 0, 10000n);

		// height 100, spendHeight 201 → depth = 101 ≥ 100
		const sourceOutputs = [makeSourceOutput({ height: 100, isCoinbase: true })];
		const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

		expect(result.success).toBe(true);
	});

	it("rejects spending OP_RETURN output", async () => {
		const parentTxid = "aa".repeat(32);
		const opReturnScript = Uint8Array.of(OP_RETURN, 0x04, 0x01, 0x02, 0x03, 0x04);
		const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
		const { rawHex } = buildValidTx(parentTxid, 0, 10000n);
		const sourceOutputs = [makeSourceOutput({ lockingBytecode: opReturnScript })];

		const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("bad-txns-input-scriptpubkey-unspendable");
		}
	});

	it("rejects non-final locktime", async () => {
		const parentTxid = "aa".repeat(32);
		const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
		const fee = 100n;
		const outputAmount = (10000n - fee) / 2n;
		const remainder = 10000n - fee - outputAmount;
		const { rawHex } = buildRawTx(
			[{ parentTxid, vout: 0, sequenceNumber: 0 }],
			[
				{ lockingBytecode: OP_TRUE, satoshis: outputAmount },
				{ lockingBytecode: OP_TRUE, satoshis: remainder },
			],
			{ locktime: 999999 },
		);
		const sourceOutputs = [makeSourceOutput()];

		const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("bad-txns-nonfinal");
		}
	});

	it("rejects null prevout", async () => {
		const verifier = await createTxVerifier({ vmVersion: "BCH_2025_05", standard: false });
		const { rawHex } = buildRawTx(
			[{ parentTxid: "00".repeat(32), vout: 0xffffffff }],
			[
				{ lockingBytecode: OP_TRUE, satoshis: 4000n },
				{ lockingBytecode: OP_TRUE, satoshis: 5000n },
			],
		);
		const sourceOutputs = [makeSourceOutput()];

		const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("bad-txns-prevout-null");
		}
	});
});

describe("policy checks via verifier", () => {
	it("rejects below minimum relay fee", async () => {
		const parentTxid = "aa".repeat(32);
		const verifier = await createTxVerifier({
			vmVersion: "BCH_2025_05",
			standard: false,
			minRelayFeePerKb: 100_000n,
		});
		const { rawHex } = buildValidTx(parentTxid, 0, 10000n);
		const sourceOutputs = [makeSourceOutput()];

		const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("min relay fee not met");
		}
	});

	it("rejects absurd fee", async () => {
		const parentTxid = "aa".repeat(32);
		const verifier = await createTxVerifier({
			vmVersion: "BCH_2025_05",
			standard: false,
			maxFee: 10n,
		});
		const { rawHex } = buildValidTx(parentTxid, 0, 10000n);
		const sourceOutputs = [makeSourceOutput()];

		const result = verifier.verify(rawHex, sourceOutputs, DEFAULT_CHAIN_STATE);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe("absurdly-high-fee");
		}
	});
});
