import type { ProcessedBlock, ProcessedBlockTx } from "@mem-cash/types";
import { makeOutpointKey } from "@mem-cash/types";
import { beforeEach, describe, expect, it } from "vitest";
import type { TestableStorage } from "./memoryStorage.js";
import { createMemoryStorage } from "./memoryStorage.js";

// --- Helpers ---
const sh = (c: string) => c.repeat(32).slice(0, 64);
const txid = (c: string) => c.repeat(32).slice(0, 64);
const bhash = (c: string) => c.repeat(32).slice(0, 64);

function makeBlock(h: number, hash: string, txs: ProcessedBlockTx[]): ProcessedBlock {
	return {
		height: h,
		hash: bhash(hash),
		header: {
			hash: bhash(hash),
			height: h,
			version: 1,
			prevHash: bhash("00"),
			merkleRoot: "00".repeat(32),
			timestamp: 1000000 + h,
			bits: 0x1d00ffff,
			nonce: 0,
			hex: "00".repeat(80),
		},
		transactions: txs,
	};
}

describe("memoryStorage", () => {
	let storage: TestableStorage;

	beforeEach(() => {
		storage = createMemoryStorage();
	});

	// --- Empty state ---

	describe("empty state", () => {
		it("returns undefined for headers", () => {
			expect(storage.getHeader(0)).toBeUndefined();
			expect(storage.getHeaderByHash("aa".repeat(32))).toBeUndefined();
			expect(storage.getTip()).toBeUndefined();
		});

		it("returns empty arrays for history", () => {
			expect(storage.getHistory(sh("aa"))).toEqual([]);
			expect(storage.getMempoolHistory(sh("aa"))).toEqual([]);
		});

		it("returns zero balance", () => {
			const bal = storage.getBalance(sh("aa"));
			expect(bal.confirmed).toBe(0n);
			expect(bal.unconfirmed).toBe(0n);
		});

		it("returns empty utxos", () => {
			expect(storage.getUtxos(sh("aa"))).toEqual([]);
		});

		it("returns null status", () => {
			expect(storage.getScriptHashStatus(sh("aa"))).toBeNull();
		});

		it("returns undefined for tx lookups", () => {
			expect(storage.getTx(txid("aa"))).toBeUndefined();
			expect(storage.getRawTx(txid("aa"))).toBeUndefined();
			expect(storage.getMempoolTx(txid("aa"))).toBeUndefined();
			expect(storage.getTxidsAtHeight(0)).toBeUndefined();
		});
	});

	// --- Test helpers ---

	describe("test helpers", () => {
		it("utxo.add creates a retrievable UTXO", () => {
			storage._test.utxo.add({
				txid: txid("aa"),
				vout: 0,
				satoshis: 50000n,
				scriptHash: sh("bb"),
				height: 1,
			});

			const utxos = storage.getUtxos(sh("bb"));
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.satoshis).toBe(50000n);
		});

		it("utxo.remove deletes a UTXO", () => {
			storage._test.utxo.add({
				txid: txid("aa"),
				vout: 0,
				satoshis: 50000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			storage._test.utxo.remove({ txid: txid("aa"), vout: 0 });
			expect(storage.getUtxos(sh("bb"))).toHaveLength(0);
		});

		it("header.add creates a retrievable header", () => {
			storage._test.header.add({ hash: bhash("aa"), height: 0 });
			expect(storage.getHeader(0)).toBeDefined();
			expect(storage.getHeader(0)?.hash).toBe(bhash("aa"));
			expect(storage.getHeaderByHash(bhash("aa"))).toBeDefined();
			expect(storage.getTip()?.height).toBe(0);
		});

		it("tx.add creates a retrievable transaction", () => {
			storage._test.tx.add({
				txid: txid("aa"),
				height: 1,
				rawHex: "deadbeef",
				fee: 200n,
			});
			expect(storage.getTx(txid("aa"))).toBeDefined();
			expect(storage.getTx(txid("aa"))?.height).toBe(1);
			expect(storage.getRawTx(txid("aa"))).toBe("deadbeef");
		});

		it("history.add creates retrievable history", () => {
			storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: txid("aa"), height: 1 }],
			});
			const hist = storage.getHistory(sh("bb"));
			expect(hist).toHaveLength(1);
			expect(hist[0]?.txHash).toBe(txid("aa"));
		});

		it("history.add maintains sort order", () => {
			storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [
					{ txHash: txid("cc"), height: 3 },
					{ txHash: txid("aa"), height: 1 },
					{ txHash: txid("bb"), height: 2 },
				],
			});
			const hist = storage.getHistory(sh("bb"));
			expect(hist.map((e) => e.height)).toEqual([1, 2, 3]);
		});

		it("reset clears all state", () => {
			storage._test.utxo.add({
				txid: txid("aa"),
				vout: 0,
				satoshis: 1000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			storage._test.header.add({ hash: bhash("aa"), height: 0 });
			storage._test.reset();

			expect(storage.getUtxos(sh("bb"))).toHaveLength(0);
			expect(storage.getTip()).toBeUndefined();
		});
	});

	// --- Balance ---

	describe("getBalance", () => {
		it("sums confirmed UTXOs", () => {
			storage._test.utxo.add({
				txid: txid("aa"),
				vout: 0,
				satoshis: 30000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			storage._test.utxo.add({
				txid: txid("aa"),
				vout: 1,
				satoshis: 20000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			const bal = storage.getBalance(sh("bb"));
			expect(bal.confirmed).toBe(50000n);
			expect(bal.unconfirmed).toBe(0n);
		});

		it("includes mempool outputs as positive unconfirmed", () => {
			storage._test.mempool.add({
				txid: txid("cc"),
				fee: 100n,
				size: 200,
				inputs: [],
				outputs: [{ satoshis: 5000n, scriptHash: sh("bb") }],
			});
			const bal = storage.getBalance(sh("bb"));
			expect(bal.confirmed).toBe(0n);
			expect(bal.unconfirmed).toBe(5000n);
		});

		it("subtracts confirmed UTXOs spent in mempool", () => {
			storage._test.utxo.add({
				txid: txid("aa"),
				vout: 0,
				satoshis: 30000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			storage._test.mempool.add({
				txid: txid("cc"),
				fee: 100n,
				size: 200,
				inputs: [{ txid: txid("aa"), vout: 0 }],
				outputs: [{ satoshis: 29900n, scriptHash: sh("dd") }],
			});
			const bal = storage.getBalance(sh("bb"));
			expect(bal.confirmed).toBe(30000n);
			expect(bal.unconfirmed).toBe(-30000n);
		});
	});

	// --- UTXOs ---

	describe("getUtxos", () => {
		it("excludes confirmed UTXOs spent in mempool", () => {
			storage._test.utxo.add({
				txid: txid("aa"),
				vout: 0,
				satoshis: 50000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			storage._test.mempool.add({
				txid: txid("cc"),
				fee: 100n,
				size: 200,
				inputs: [{ txid: txid("aa"), vout: 0 }],
				outputs: [],
			});
			expect(storage.getUtxos(sh("bb"))).toHaveLength(0);
		});

		it("includes mempool UTXOs", () => {
			storage._test.mempool.add({
				txid: txid("cc"),
				fee: 100n,
				size: 200,
				inputs: [],
				outputs: [{ satoshis: 1000n, scriptHash: sh("bb") }],
			});
			const utxos = storage.getUtxos(sh("bb"));
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.satoshis).toBe(1000n);
			expect(utxos[0]?.height).toBe(0);
		});
	});

	// --- History ---

	describe("getHistory", () => {
		it("filters by height range", () => {
			storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [
					{ txHash: txid("aa"), height: 1 },
					{ txHash: txid("bb"), height: 5 },
					{ txHash: txid("cc"), height: 10 },
				],
			});
			const hist = storage.getHistory(sh("bb"), 3, 7);
			expect(hist).toHaveLength(1);
			expect(hist[0]?.height).toBe(5);
		});
	});

	// --- Status hash ---

	describe("getScriptHashStatus", () => {
		it("returns null for empty history", () => {
			expect(storage.getScriptHashStatus(sh("aa"))).toBeNull();
		});

		it("returns hex hash for non-empty history", () => {
			storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: txid("aa"), height: 1 }],
			});
			const status = storage.getScriptHashStatus(sh("bb"));
			expect(status).not.toBeNull();
			expect(status).toHaveLength(64);
			expect(status).toMatch(/^[0-9a-f]{64}$/);
		});

		it("changes when history changes", () => {
			storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: txid("aa"), height: 1 }],
			});
			const s1 = storage.getScriptHashStatus(sh("bb"));

			storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: txid("cc"), height: 2 }],
			});
			const s2 = storage.getScriptHashStatus(sh("bb"));

			expect(s1).not.toBe(s2);
		});

		it("includes mempool history in status", () => {
			storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: txid("aa"), height: 1 }],
			});
			const s1 = storage.getScriptHashStatus(sh("bb"));

			storage._test.utxo.add({
				txid: txid("aa"),
				vout: 0,
				satoshis: 1000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			storage._test.mempool.add({
				txid: txid("cc"),
				fee: 100n,
				size: 200,
				inputs: [{ txid: txid("aa"), vout: 0 }],
				outputs: [],
			});
			const s2 = storage.getScriptHashStatus(sh("bb"));

			expect(s2).not.toBe(s1);
		});
	});

	// --- applyBlock ---

	describe("applyBlock", () => {
		it("adds UTXOs from block outputs", () => {
			const block = makeBlock(1, "aa", [
				{
					txid: txid("t1"),
					inputs: [],
					outputs: [
						{
							outpointKey: makeOutpointKey(txid("t1"), 0),
							utxo: {
								outpoint: { txid: txid("t1"), vout: 0 },
								satoshis: 50000n,
								scriptHash: sh("bb"),
								height: 1,
								lockingBytecode: new Uint8Array(0),
							},
						},
					],
				},
			]);

			const affected = storage.applyBlock(block);
			expect(affected.has(sh("bb"))).toBe(true);

			const utxos = storage.getUtxos(sh("bb"));
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.satoshis).toBe(50000n);
		});

		it("spends UTXOs from block inputs", () => {
			// First add a UTXO
			storage._test.utxo.add({
				txid: txid("t0"),
				vout: 0,
				satoshis: 50000n,
				scriptHash: sh("bb"),
				height: 0,
			});

			// Then spend it in a block
			const block = makeBlock(1, "aa", [
				{
					txid: txid("t1"),
					inputs: [{ prevOutpoint: { txid: txid("t0"), vout: 0 } }],
					outputs: [
						{
							outpointKey: makeOutpointKey(txid("t1"), 0),
							utxo: {
								outpoint: { txid: txid("t1"), vout: 0 },
								satoshis: 49000n,
								scriptHash: sh("cc"),
								height: 1,
								lockingBytecode: new Uint8Array(0),
							},
						},
					],
				},
			]);

			storage.applyBlock(block);
			expect(storage.getUtxos(sh("bb"))).toHaveLength(0);
			expect(storage.getUtxos(sh("cc"))).toHaveLength(1);
		});

		it("stores header and txids", () => {
			const block = makeBlock(5, "aa", [
				{ txid: txid("t1"), inputs: [], outputs: [] },
				{ txid: txid("t2"), inputs: [], outputs: [] },
			]);
			storage.applyBlock(block);

			expect(storage.getHeader(5)).toBeDefined();
			expect(storage.getHeader(5)?.hash).toBe(bhash("aa"));
			expect(storage.getTip()?.height).toBe(5);

			const txids = storage.getTxidsAtHeight(5);
			expect(txids).toEqual([txid("t1"), txid("t2")]);
		});

		it("stores transaction records", () => {
			const block = makeBlock(1, "aa", [
				{
					txid: txid("t1"),
					inputs: [],
					outputs: [],
					rawHex: "01000000",
					fee: 200n,
				},
			]);
			storage.applyBlock(block);

			const tx = storage.getTx(txid("t1"));
			expect(tx).toBeDefined();
			expect(tx?.height).toBe(1);
			expect(storage.getRawTx(txid("t1"))).toBe("01000000");
		});

		it("removes mempool tx when confirmed", () => {
			storage._test.utxo.add({
				txid: txid("t0"),
				vout: 0,
				satoshis: 50000n,
				scriptHash: sh("bb"),
				height: 0,
			});
			storage._test.mempool.add({
				txid: txid("t1"),
				fee: 100n,
				size: 200,
				inputs: [{ txid: txid("t0"), vout: 0 }],
				outputs: [{ satoshis: 49900n, scriptHash: sh("cc") }],
			});

			expect(storage.getMempoolTx(txid("t1"))).toBeDefined();

			const block = makeBlock(1, "aa", [
				{
					txid: txid("t1"),
					inputs: [{ prevOutpoint: { txid: txid("t0"), vout: 0 } }],
					outputs: [
						{
							outpointKey: makeOutpointKey(txid("t1"), 0),
							utxo: {
								outpoint: { txid: txid("t1"), vout: 0 },
								satoshis: 49900n,
								scriptHash: sh("cc"),
								height: 1,
								lockingBytecode: new Uint8Array(0),
							},
						},
					],
				},
			]);
			storage.applyBlock(block);

			expect(storage.getMempoolTx(txid("t1"))).toBeUndefined();
		});

		it("updates history for affected scripthashes", () => {
			const block = makeBlock(1, "aa", [
				{
					txid: txid("t1"),
					inputs: [],
					outputs: [
						{
							outpointKey: makeOutpointKey(txid("t1"), 0),
							utxo: {
								outpoint: { txid: txid("t1"), vout: 0 },
								satoshis: 50000n,
								scriptHash: sh("bb"),
								height: 1,
								lockingBytecode: new Uint8Array(0),
							},
						},
					],
				},
			]);
			storage.applyBlock(block);

			const hist = storage.getHistory(sh("bb"));
			expect(hist).toHaveLength(1);
			expect(hist[0]?.txHash).toBe(txid("t1"));
			expect(hist[0]?.height).toBe(1);
		});
	});

	// --- undoBlock ---

	describe("undoBlock", () => {
		it("restores spent UTXOs and removes created UTXOs", () => {
			storage._test.utxo.add({
				txid: txid("t0"),
				vout: 0,
				satoshis: 50000n,
				scriptHash: sh("bb"),
				height: 0,
			});

			const block = makeBlock(1, "aa", [
				{
					txid: txid("t1"),
					inputs: [{ prevOutpoint: { txid: txid("t0"), vout: 0 } }],
					outputs: [
						{
							outpointKey: makeOutpointKey(txid("t1"), 0),
							utxo: {
								outpoint: { txid: txid("t1"), vout: 0 },
								satoshis: 49000n,
								scriptHash: sh("cc"),
								height: 1,
								lockingBytecode: new Uint8Array(0),
							},
						},
					],
				},
			]);
			storage.applyBlock(block);

			// Undo
			storage.undoBlock(1);

			// Original UTXO restored
			const bbUtxos = storage.getUtxos(sh("bb"));
			expect(bbUtxos).toHaveLength(1);
			expect(bbUtxos[0]?.satoshis).toBe(50000n);

			// New UTXO removed
			expect(storage.getUtxos(sh("cc"))).toHaveLength(0);
		});

		it("removes header and history entries", () => {
			const block = makeBlock(1, "aa", [
				{
					txid: txid("t1"),
					inputs: [],
					outputs: [
						{
							outpointKey: makeOutpointKey(txid("t1"), 0),
							utxo: {
								outpoint: { txid: txid("t1"), vout: 0 },
								satoshis: 50000n,
								scriptHash: sh("bb"),
								height: 1,
								lockingBytecode: new Uint8Array(0),
							},
						},
					],
				},
			]);
			storage.applyBlock(block);
			storage.undoBlock(1);

			expect(storage.getHeader(1)).toBeUndefined();
			expect(storage.getTip()).toBeUndefined();
			expect(storage.getHistory(sh("bb"))).toHaveLength(0);
			expect(storage.getTxidsAtHeight(1)).toBeUndefined();
		});

		it("returns empty set for non-existent block", () => {
			const affected = storage.undoBlock(999);
			expect(affected.size).toBe(0);
		});
	});

	// --- Mempool ---

	describe("mempool", () => {
		it("addMempoolTx tracks the transaction", () => {
			storage._test.mempool.add({
				txid: txid("m1"),
				fee: 100n,
				size: 200,
				inputs: [],
				outputs: [{ satoshis: 1000n, scriptHash: sh("bb") }],
			});

			const mptx = storage.getMempoolTx(txid("m1"));
			expect(mptx).toBeDefined();
			expect(mptx?.fee).toBe(100n);

			const memHist = storage.getMempoolHistory(sh("bb"));
			expect(memHist).toHaveLength(1);
			expect(memHist[0]?.txHash).toBe(txid("m1"));
		});

		it("removeMempoolTx cascades to children", () => {
			// Parent
			storage._test.mempool.add({
				txid: txid("m1"),
				fee: 100n,
				size: 200,
				inputs: [],
				outputs: [{ satoshis: 1000n, scriptHash: sh("bb") }],
			});
			// Child spends parent's output
			storage._test.mempool.add({
				txid: txid("m2"),
				fee: 50n,
				size: 100,
				inputs: [{ txid: txid("m1"), vout: 0 }],
				outputs: [{ satoshis: 950n, scriptHash: sh("cc") }],
			});

			// Remove parent — child should also be removed
			storage._test.mempool.remove(txid("m1"));

			expect(storage.getMempoolTx(txid("m1"))).toBeUndefined();
			expect(storage.getMempoolTx(txid("m2"))).toBeUndefined();
			expect(storage.getMempoolHistory(sh("bb"))).toHaveLength(0);
			expect(storage.getMempoolHistory(sh("cc"))).toHaveLength(0);
		});

		it("clearMempool removes everything", () => {
			storage._test.mempool.add({
				txid: txid("m1"),
				fee: 100n,
				size: 200,
				inputs: [],
				outputs: [{ satoshis: 1000n, scriptHash: sh("bb") }],
			});
			const affected = storage._test.mempool.clear();
			expect(affected.has(sh("bb"))).toBe(true);
			expect(storage.getMempoolTx(txid("m1"))).toBeUndefined();
		});

		it("mempool tx with unconfirmed parent gets height -1 in history", () => {
			storage._test.mempool.add({
				txid: txid("m1"),
				fee: 100n,
				size: 200,
				inputs: [],
				outputs: [{ satoshis: 1000n, scriptHash: sh("bb") }],
			});
			storage._test.mempool.add({
				txid: txid("m2"),
				fee: 50n,
				size: 100,
				inputs: [{ txid: txid("m1"), vout: 0 }],
				outputs: [{ satoshis: 950n, scriptHash: sh("cc") }],
			});

			const hist = storage.getMempoolHistory(sh("cc"));
			expect(hist).toHaveLength(1);
			expect(hist[0]?.height).toBe(-1);
		});
	});
});
