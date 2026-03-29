import {
	binToHex,
	decodeTransactionBch,
	encodeTransactionBch,
	hashTransactionUiOrder,
	hexToBin,
	sha256,
} from "@bitauth/libauth";
import type { TestableStorage } from "@mem-cash/storage";
import { createMemoryStorage } from "@mem-cash/storage";
import { makeOutpointKey } from "@mem-cash/types";
import type { ValidatedTransaction } from "@mem-cash/validation";
import { beforeEach, describe, expect, it } from "vitest";
import { acceptToMempool } from "./accept.js";

// --- Constants ---

const OP_TRUE = Uint8Array.of(0x51);
const OP_TRUE_SH = binToHex(sha256.hash(OP_TRUE));

const OP_DUP = Uint8Array.of(0x76);
const OP_DUP_SH = binToHex(sha256.hash(OP_DUP));

/** Fake parent txid (64-char hex). */
const PARENT_TXID = "aa".repeat(32);

// --- Helpers ---

function buildValidatedTx(
	parentTxid: string,
	vout: number,
	inputSatoshis: bigint,
	lockingBytecode = OP_TRUE,
	opts?: { sourceHeight?: number },
): ValidatedTransaction {
	const fee = 100n;
	const outputAmount = inputSatoshis - fee;
	const txObj = {
		version: 2,
		inputs: [
			{
				outpointTransactionHash: hexToBin(parentTxid),
				outpointIndex: vout,
				unlockingBytecode: new Uint8Array(0),
				sequenceNumber: 0xffffffff,
			},
		],
		outputs: [{ lockingBytecode, valueSatoshis: outputAmount }],
		locktime: 0,
	};
	const encoded = encodeTransactionBch(txObj);
	const rawHex = binToHex(encoded);
	const txid = binToHex(hashTransactionUiOrder(encoded));
	const decoded = decodeTransactionBch(encoded);
	if (typeof decoded === "string") throw new Error(decoded);
	return {
		txid,
		rawHex,
		fee,
		size: encoded.length,
		transaction: decoded,
		sourceOutputs: [
			{
				lockingBytecode,
				valueSatoshis: inputSatoshis,
				height: opts?.sourceHeight ?? 100,
			},
		],
	};
}

function buildMultiInputOutputTx(
	inputs: {
		parentTxid: string;
		vout: number;
		satoshis: bigint;
		lockingBytecode: Uint8Array;
		sourceHeight?: number;
	}[],
	outputs: { lockingBytecode: Uint8Array; satoshis: bigint }[],
): ValidatedTransaction {
	const totalIn = inputs.reduce((s, i) => s + i.satoshis, 0n);
	const totalOut = outputs.reduce((s, o) => s + o.satoshis, 0n);
	const fee = totalIn - totalOut;

	const txObj = {
		version: 2,
		inputs: inputs.map((inp) => ({
			outpointTransactionHash: hexToBin(inp.parentTxid),
			outpointIndex: inp.vout,
			unlockingBytecode: new Uint8Array(0),
			sequenceNumber: 0xffffffff,
		})),
		outputs: outputs.map((out) => ({
			lockingBytecode: out.lockingBytecode,
			valueSatoshis: out.satoshis,
		})),
		locktime: 0,
	};

	const encoded = encodeTransactionBch(txObj);
	const rawHex = binToHex(encoded);
	const txid = binToHex(hashTransactionUiOrder(encoded));
	const decoded = decodeTransactionBch(encoded);
	if (typeof decoded === "string") throw new Error(decoded);

	return {
		txid,
		rawHex,
		fee,
		size: encoded.length,
		transaction: decoded,
		sourceOutputs: inputs.map((inp) => ({
			lockingBytecode: inp.lockingBytecode,
			valueSatoshis: inp.satoshis,
			height: inp.sourceHeight ?? 100,
		})),
	};
}

// --- Tests ---

describe("acceptToMempool", () => {
	let storage: TestableStorage;

	beforeEach(() => {
		storage = createMemoryStorage();
	});

	// --- 1. Basic acceptance ---

	describe("basic acceptance", () => {
		it("returns affected scripthashes containing the output scripthash", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 10_000n);
			const result = acceptToMempool(storage, vtx);

			expect(result.affectedScriptHashes).toBeInstanceOf(Set);
			expect(result.affectedScriptHashes.has(OP_TRUE_SH)).toBe(true);
		});

		it("stores the raw transaction hex", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 10_000n);
			acceptToMempool(storage, vtx);

			expect(storage.getRawTx(vtx.txid)).toBe(vtx.rawHex);
		});

		it("creates mempool UTXOs for each output", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 10_000n);
			acceptToMempool(storage, vtx);

			const key = makeOutpointKey(vtx.txid, 0);
			const utxo = storage.getMempoolUtxo(key);
			expect(utxo).toBeDefined();
			expect(utxo?.satoshis).toBe(10_000n - 100n);
			expect(utxo?.scriptHash).toBe(OP_TRUE_SH);
			expect(utxo?.height).toBe(0);
		});

		it("registers the mempool tx in storage", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 10_000n);
			acceptToMempool(storage, vtx);

			const mempoolTx = storage.getMempoolTx(vtx.txid);
			expect(mempoolTx).toBeDefined();
			expect(mempoolTx?.txid).toBe(vtx.txid);
			expect(mempoolTx?.fee).toBe(100n);
			expect(mempoolTx?.size).toBe(vtx.size);
		});
	});

	// --- 2. Confirmed input tracking ---

	describe("confirmed input tracking", () => {
		it("places inputs spending confirmed UTXOs into confirmedSpends", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 50_000n);
			acceptToMempool(storage, vtx);

			const mempoolTx = storage.getMempoolTx(vtx.txid);
			expect(mempoolTx).toBeDefined();

			const entry = mempoolTx?.entries.get(OP_TRUE_SH);
			expect(entry).toBeDefined();

			const expectedKey = makeOutpointKey(PARENT_TXID, 0);
			expect(entry?.confirmedSpends).toContain(expectedKey);
			expect(entry?.unconfirmedSpends).toHaveLength(0);
		});

		it("does not add parent txids for confirmed inputs", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 50_000n);
			acceptToMempool(storage, vtx);

			const mempoolTx = storage.getMempoolTx(vtx.txid);
			expect(mempoolTx?.parents.size).toBe(0);
		});
	});

	// --- 3. Unconfirmed input tracking ---

	describe("unconfirmed input tracking", () => {
		it("places inputs spending mempool UTXOs (height=0) into unconfirmedSpends", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 25_000n, OP_TRUE, {
				sourceHeight: 0,
			});
			acceptToMempool(storage, vtx);

			const mempoolTx = storage.getMempoolTx(vtx.txid);
			expect(mempoolTx).toBeDefined();

			const entry = mempoolTx?.entries.get(OP_TRUE_SH);
			expect(entry).toBeDefined();

			const expectedKey = makeOutpointKey(PARENT_TXID, 0);
			expect(entry?.unconfirmedSpends).toContain(expectedKey);
			expect(entry?.confirmedSpends).toHaveLength(0);
		});

		it("adds the parent txid to parents set for unconfirmed inputs", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 25_000n, OP_TRUE, {
				sourceHeight: 0,
			});
			acceptToMempool(storage, vtx);

			const mempoolTx = storage.getMempoolTx(vtx.txid);
			expect(mempoolTx?.parents.has(PARENT_TXID)).toBe(true);
		});
	});

	// --- 4. Output registration ---

	describe("output registration", () => {
		it("creates mempool UTXOs with correct scripthash, satoshis, and height=0", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 100_000n);
			acceptToMempool(storage, vtx);

			const key = makeOutpointKey(vtx.txid, 0);
			const utxo = storage.getMempoolUtxo(key);

			expect(utxo).toBeDefined();
			expect(utxo?.outpoint.txid).toBe(vtx.txid);
			expect(utxo?.outpoint.vout).toBe(0);
			expect(utxo?.satoshis).toBe(100_000n - 100n);
			expect(utxo?.scriptHash).toBe(OP_TRUE_SH);
			expect(utxo?.height).toBe(0);
			expect(utxo?.lockingBytecode).toEqual(OP_TRUE);
		});

		it("records output outpoint keys in the mempool tx entries", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 100_000n);
			acceptToMempool(storage, vtx);

			const mempoolTx = storage.getMempoolTx(vtx.txid);
			const entry = mempoolTx?.entries.get(OP_TRUE_SH);
			expect(entry).toBeDefined();

			const expectedKey = makeOutpointKey(vtx.txid, 0);
			expect(entry?.outputs).toContain(expectedKey);
		});

		it("mempool UTXOs appear in getUtxos for the scripthash", () => {
			const vtx = buildValidatedTx(PARENT_TXID, 0, 50_000n);
			acceptToMempool(storage, vtx);

			const utxos = storage.getUtxos(OP_TRUE_SH);
			expect(utxos.length).toBe(1);
			expect(utxos[0]?.outpoint.txid).toBe(vtx.txid);
			expect(utxos[0]?.satoshis).toBe(50_000n - 100n);
		});
	});

	// --- 5. Multiple scripthashes ---

	describe("multiple scripthashes", () => {
		it("returns all affected scripthashes when tx involves different scripts", () => {
			const parentTxid2 = "bb".repeat(32);
			const vtx = buildMultiInputOutputTx(
				[
					{
						parentTxid: PARENT_TXID,
						vout: 0,
						satoshis: 60_000n,
						lockingBytecode: OP_TRUE,
						sourceHeight: 100,
					},
					{
						parentTxid: parentTxid2,
						vout: 1,
						satoshis: 40_000n,
						lockingBytecode: OP_DUP,
						sourceHeight: 50,
					},
				],
				[
					{ lockingBytecode: OP_TRUE, satoshis: 50_000n },
					{ lockingBytecode: OP_DUP, satoshis: 49_800n },
				],
			);

			const result = acceptToMempool(storage, vtx);

			expect(result.affectedScriptHashes.has(OP_TRUE_SH)).toBe(true);
			expect(result.affectedScriptHashes.has(OP_DUP_SH)).toBe(true);
		});

		it("creates entries for each scripthash in the mempool tx", () => {
			const parentTxid2 = "bb".repeat(32);
			const vtx = buildMultiInputOutputTx(
				[
					{
						parentTxid: PARENT_TXID,
						vout: 0,
						satoshis: 60_000n,
						lockingBytecode: OP_TRUE,
						sourceHeight: 100,
					},
					{
						parentTxid: parentTxid2,
						vout: 1,
						satoshis: 40_000n,
						lockingBytecode: OP_DUP,
						sourceHeight: 50,
					},
				],
				[
					{ lockingBytecode: OP_TRUE, satoshis: 50_000n },
					{ lockingBytecode: OP_DUP, satoshis: 49_800n },
				],
			);

			acceptToMempool(storage, vtx);
			const mempoolTx = storage.getMempoolTx(vtx.txid);
			expect(mempoolTx).toBeDefined();

			const entryTrue = mempoolTx?.entries.get(OP_TRUE_SH);
			expect(entryTrue).toBeDefined();
			expect(entryTrue?.confirmedSpends).toContain(makeOutpointKey(PARENT_TXID, 0));
			expect(entryTrue?.outputs).toContain(makeOutpointKey(vtx.txid, 0));

			const entryDup = mempoolTx?.entries.get(OP_DUP_SH);
			expect(entryDup).toBeDefined();
			expect(entryDup?.confirmedSpends).toContain(makeOutpointKey(parentTxid2, 1));
			expect(entryDup?.outputs).toContain(makeOutpointKey(vtx.txid, 1));
		});

		it("creates separate mempool UTXOs for each output with the correct scripthash", () => {
			const vtx = buildMultiInputOutputTx(
				[
					{
						parentTxid: PARENT_TXID,
						vout: 0,
						satoshis: 100_000n,
						lockingBytecode: OP_TRUE,
						sourceHeight: 100,
					},
				],
				[
					{ lockingBytecode: OP_TRUE, satoshis: 50_000n },
					{ lockingBytecode: OP_DUP, satoshis: 49_800n },
				],
			);

			acceptToMempool(storage, vtx);

			const utxo0 = storage.getMempoolUtxo(makeOutpointKey(vtx.txid, 0));
			expect(utxo0).toBeDefined();
			expect(utxo0?.scriptHash).toBe(OP_TRUE_SH);
			expect(utxo0?.satoshis).toBe(50_000n);

			const utxo1 = storage.getMempoolUtxo(makeOutpointKey(vtx.txid, 1));
			expect(utxo1).toBeDefined();
			expect(utxo1?.scriptHash).toBe(OP_DUP_SH);
			expect(utxo1?.satoshis).toBe(49_800n);
		});

		it("handles mixed confirmed and unconfirmed inputs across scripthashes", () => {
			const parentTxid2 = "cc".repeat(32);
			const vtx = buildMultiInputOutputTx(
				[
					{
						parentTxid: PARENT_TXID,
						vout: 0,
						satoshis: 60_000n,
						lockingBytecode: OP_TRUE,
						sourceHeight: 100,
					},
					{
						parentTxid: parentTxid2,
						vout: 0,
						satoshis: 40_000n,
						lockingBytecode: OP_DUP,
						sourceHeight: 0,
					},
				],
				[{ lockingBytecode: OP_TRUE, satoshis: 99_800n }],
			);

			acceptToMempool(storage, vtx);
			const mempoolTx = storage.getMempoolTx(vtx.txid);

			// OP_TRUE input was confirmed
			const entryTrue = mempoolTx?.entries.get(OP_TRUE_SH);
			expect(entryTrue).toBeDefined();
			expect(entryTrue?.confirmedSpends).toContain(makeOutpointKey(PARENT_TXID, 0));
			expect(entryTrue?.unconfirmedSpends).toHaveLength(0);

			// OP_DUP input was unconfirmed (height=0)
			const entryDup = mempoolTx?.entries.get(OP_DUP_SH);
			expect(entryDup).toBeDefined();
			expect(entryDup?.unconfirmedSpends).toContain(makeOutpointKey(parentTxid2, 0));
			expect(entryDup?.confirmedSpends).toHaveLength(0);

			// Parent set should include the unconfirmed parent
			expect(mempoolTx?.parents.has(parentTxid2)).toBe(true);
			expect(mempoolTx?.parents.has(PARENT_TXID)).toBe(false);
		});
	});
});
