import type { Node } from "@mem-cash/core";
import { createNode } from "@mem-cash/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
	getBalance,
	getHistory,
	getMempool,
	getStatus,
	listUnspent,
	subscribe,
	unsubscribe,
} from "./scripthash.js";
import type { ProtocolContext } from "./types.js";

const sh = (c: string) => c.repeat(32).slice(0, 64);
const tid = (c: string) => c.repeat(32).slice(0, 64);

function makeCtx(node: Node, hooks?: Partial<ProtocolContext>): ProtocolContext {
	return {
		node,
		serverVersion: "test",
		protocolMin: "1.6",
		protocolMax: "1.6",
		genesisHash: "00".repeat(32),
		hashFunction: "sha256",
		...hooks,
	};
}

describe("scripthash handlers", () => {
	let node: Node;
	let ctx: ProtocolContext;

	beforeEach(() => {
		node = createNode();
		ctx = makeCtx(node);
	});

	describe("getBalance", () => {
		it("returns zero for unknown scripthash", () => {
			const r = getBalance(ctx, [sh("aa")]);
			expect(r).toEqual({ result: { confirmed: 0, unconfirmed: 0 } });
		});

		it("returns confirmed balance", () => {
			node.storage._test.utxo.add({
				txid: tid("aa"),
				vout: 0,
				satoshis: 75000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			const r = getBalance(ctx, [sh("bb")]);
			expect(r).toEqual({ result: { confirmed: 75000, unconfirmed: 0 } });
		});

		it("rejects invalid scripthash", () => {
			const r = getBalance(ctx, ["tooshort"]);
			expect(r).toHaveProperty("error");
		});

		it("rejects missing params", () => {
			const r = getBalance(ctx, []);
			expect(r).toHaveProperty("error");
		});
	});

	describe("getHistory", () => {
		it("returns empty array for no history", () => {
			const r = getHistory(ctx, [sh("aa")]);
			expect(r).toEqual({ result: [] });
		});

		it("returns confirmed + mempool history", () => {
			node.storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: tid("t1"), height: 1 }],
			});
			node.storage._test.utxo.add({
				txid: tid("t1"),
				vout: 0,
				satoshis: 1000n,
				scriptHash: sh("bb"),
				height: 1,
			});
			node.storage._test.mempool.add({
				txid: tid("m1"),
				fee: 100n,
				size: 200,
				inputs: [{ txid: tid("t1"), vout: 0 }],
				outputs: [],
			});

			const r = getHistory(ctx, [sh("bb")]) as { result: unknown[] };
			expect(r.result).toHaveLength(2);

			const confirmed = r.result[0] as { tx_hash: string; height: number };
			expect(confirmed.tx_hash).toBe(tid("t1"));
			expect(confirmed.height).toBe(1);

			const mempool = r.result[1] as { tx_hash: string; height: number; fee: number };
			expect(mempool.tx_hash).toBe(tid("m1"));
			expect(mempool.height).toBe(0);
			expect(mempool.fee).toBe(100);
		});

		it("returns height -1 for mempool tx spending unconfirmed tx", () => {
			// m1 is an unconfirmed tx with an output to sh("bb")
			node.storage._test.mempool.add({
				txid: tid("m1"),
				fee: 100n,
				size: 200,
				inputs: [],
				outputs: [{ satoshis: 1000n, scriptHash: sh("bb") }],
			});
			// m2 spends m1's unconfirmed output
			node.storage._test.mempool.add({
				txid: tid("m2"),
				fee: 50n,
				size: 150,
				inputs: [{ txid: tid("m1"), vout: 0 }],
				outputs: [{ satoshis: 950n, scriptHash: sh("cc") }],
			});

			// sh("bb") sees m1 (height 0) and m2 (height -1, spends unconfirmed)
			const rBB = getHistory(ctx, [sh("bb")]) as { result: unknown[] };
			expect(rBB.result).toHaveLength(2);

			const m1Entry = rBB.result[0] as { tx_hash: string; height: number };
			expect(m1Entry.tx_hash).toBe(tid("m1"));
			expect(m1Entry.height).toBe(0);

			const m2Entry = rBB.result[1] as { tx_hash: string; height: number };
			expect(m2Entry.tx_hash).toBe(tid("m2"));
			expect(m2Entry.height).toBe(-1);

			// sh("cc") sees only m2 (height -1)
			const rCC = getHistory(ctx, [sh("cc")]) as { result: unknown[] };
			expect(rCC.result).toHaveLength(1);

			const m2ForCC = rCC.result[0] as { tx_hash: string; height: number };
			expect(m2ForCC.tx_hash).toBe(tid("m2"));
			expect(m2ForCC.height).toBe(-1);
		});
	});

	describe("getMempool", () => {
		it("returns only mempool entries", () => {
			node.storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: tid("t1"), height: 1 }],
			});
			node.storage._test.mempool.add({
				txid: tid("m1"),
				fee: 50n,
				size: 100,
				inputs: [],
				outputs: [{ satoshis: 500n, scriptHash: sh("bb") }],
			});

			const r = getMempool(ctx, [sh("bb")]) as { result: unknown[] };
			expect(r.result).toHaveLength(1);
			expect((r.result[0] as { tx_hash: string }).tx_hash).toBe(tid("m1"));
		});

		it("returns height -1 for tx spending unconfirmed output", () => {
			node.storage._test.mempool.add({
				txid: tid("m1"),
				fee: 100n,
				size: 200,
				inputs: [],
				outputs: [{ satoshis: 1000n, scriptHash: sh("bb") }],
			});
			node.storage._test.mempool.add({
				txid: tid("m2"),
				fee: 50n,
				size: 150,
				inputs: [{ txid: tid("m1"), vout: 0 }],
				outputs: [{ satoshis: 950n, scriptHash: sh("cc") }],
			});

			const r = getMempool(ctx, [sh("cc")]) as { result: unknown[] };
			expect(r.result).toHaveLength(1);
			const entry = r.result[0] as { tx_hash: string; height: number; fee: number };
			expect(entry.tx_hash).toBe(tid("m2"));
			expect(entry.height).toBe(-1);
			expect(entry.fee).toBe(50);
		});
	});

	describe("listUnspent", () => {
		it("returns formatted UTXOs", () => {
			node.storage._test.utxo.add({
				txid: tid("aa"),
				vout: 2,
				satoshis: 30000n,
				scriptHash: sh("bb"),
				height: 5,
			});

			const r = listUnspent(ctx, [sh("bb")]) as { result: unknown[] };
			expect(r.result).toHaveLength(1);

			const utxo = r.result[0] as {
				tx_hash: string;
				tx_pos: number;
				height: number;
				value: number;
			};
			expect(utxo.tx_hash).toBe(tid("aa"));
			expect(utxo.tx_pos).toBe(2);
			expect(utxo.height).toBe(5);
			expect(utxo.value).toBe(30000);
		});

		it("includes token_data when present", () => {
			node.storage._test.utxo.add({
				txid: tid("aa"),
				vout: 0,
				satoshis: 1000n,
				scriptHash: sh("bb"),
				height: 1,
				tokenData: {
					category: "dd".repeat(32),
					amount: 100n,
					nft: { commitment: "cafe", capability: "mutable" },
				},
			});

			const r = listUnspent(ctx, [sh("bb")]) as { result: unknown[] };
			const utxo = r.result[0] as {
				token_data: { category: string; amount: string; nft: { capability: string } };
			};
			expect(utxo.token_data.category).toBe("dd".repeat(32));
			expect(utxo.token_data.amount).toBe("100");
			expect(utxo.token_data.nft.capability).toBe("mutable");
		});
	});

	describe("subscribe / unsubscribe / getStatus", () => {
		it("subscribe returns null for no history", () => {
			const r = subscribe(ctx, [sh("aa")]);
			expect(r).toEqual({ result: null });
		});

		it("subscribe returns status hash when history exists", () => {
			node.storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: tid("t1"), height: 1 }],
			});
			const r = subscribe(ctx, [sh("bb")]) as { result: string };
			expect(r.result).toMatch(/^[0-9a-f]{64}$/);
		});

		it("subscribe calls hook", () => {
			let called: ScriptHash | null = null;
			const hooked = makeCtx(node, {
				subscribeScriptHash: (s: ScriptHash) => {
					called = s;
				},
			});
			subscribe(hooked, [sh("bb")]);
			expect(called).toBe(sh("bb"));
		});

		it("unsubscribe calls hook and returns result", () => {
			const hooked = makeCtx(node, {
				unsubscribeScriptHash: () => true,
			});
			const r = unsubscribe(hooked, [sh("bb")]);
			expect(r).toEqual({ result: true });
		});

		it("unsubscribe errors without hook", () => {
			const r = unsubscribe(ctx, [sh("bb")]);
			expect(r).toHaveProperty("error");
		});

		it("getStatus returns same as subscribe but without side effect", () => {
			node.storage._test.history.add({
				scriptHash: sh("bb"),
				entries: [{ txHash: tid("t1"), height: 1 }],
			});
			const sub = subscribe(ctx, [sh("bb")]) as { result: string };
			const stat = getStatus(ctx, [sh("bb")]) as { result: string };
			expect(sub.result).toBe(stat.result);
		});
	});
});
