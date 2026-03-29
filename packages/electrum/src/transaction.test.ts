import type { Node } from "@mem-cash/core";
import { createNode } from "@mem-cash/core";
import { makeOutpointKey } from "@mem-cash/types";
import { beforeEach, describe, expect, it } from "vitest";
import { broadcast, get, getMerkle, idFromPos } from "./transaction.js";
import type { ProtocolContext } from "./types.js";

const tid = (c: string) => c.repeat(32).slice(0, 64);
const sh = (c: string) => c.repeat(32).slice(0, 64);
const bhash = (c: string) => c.repeat(32).slice(0, 64);

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

describe("transaction handlers", () => {
	let node: Node;
	let ctx: ProtocolContext;

	beforeEach(() => {
		node = createNode();
		ctx = makeCtx(node);
	});

	describe("get", () => {
		it("returns raw hex", () => {
			node.storage._test.tx.add({ txid: tid("aa"), height: 1, rawHex: "01000000aabb" });
			const r = get(ctx, [tid("aa")]);
			expect(r).toEqual({ result: "01000000aabb" });
		});

		it("errors for missing tx", () => {
			const r = get(ctx, [tid("aa")]);
			expect(r).toHaveProperty("error");
		});

		it("errors for verbose mode", () => {
			node.storage._test.tx.add({ txid: tid("aa"), height: 1, rawHex: "aabb" });
			const r = get(ctx, [tid("aa"), true]);
			expect(r).toHaveProperty("error");
		});

		it("rejects invalid txid", () => {
			expect(get(ctx, ["bad"])).toHaveProperty("error");
			expect(get(ctx, [])).toHaveProperty("error");
		});
	});

	describe("getMerkle", () => {
		function setupBlock() {
			const block = {
				height: 1,
				hash: bhash("aa"),
				header: {
					hash: bhash("aa"),
					height: 1,
					version: 1,
					prevHash: bhash("00"),
					merkleRoot: "00".repeat(32),
					timestamp: 1000001,
					bits: 0x1d00ffff,
					nonce: 0,
					hex: "00".repeat(80),
				},
				transactions: [
					{
						txid: tid("a1"),
						inputs: [],
						outputs: [
							{
								outpointKey: makeOutpointKey(tid("a1"), 0),
								utxo: {
									outpoint: { txid: tid("a1"), vout: 0 },
									satoshis: 5000n,
									scriptHash: sh("bb"),
									height: 1,
									lockingBytecode: new Uint8Array(0),
								},
							},
						],
					},
					{ txid: tid("a2"), inputs: [], outputs: [] },
					{ txid: tid("a3"), inputs: [], outputs: [] },
				],
			};
			node.storage.applyBlock(block);
		}

		it("returns merkle branch and position", () => {
			setupBlock();
			const r = getMerkle(ctx, [tid("a2"), 1]) as {
				result: { block_height: number; pos: number; merkle: string[] };
			};
			expect(r.result.block_height).toBe(1);
			expect(r.result.pos).toBe(1);
			expect(r.result.merkle.length).toBeGreaterThan(0);
		});

		it("auto-resolves height from tx record", () => {
			setupBlock();
			const r = getMerkle(ctx, [tid("a1")]) as { result: { block_height: number; pos: number } };
			expect(r.result.block_height).toBe(1);
			expect(r.result.pos).toBe(0);
		});

		it("errors for tx not in block", () => {
			setupBlock();
			const r = getMerkle(ctx, [tid("ff"), 1]);
			expect(r).toHaveProperty("error");
		});

		it("errors for missing block", () => {
			node.storage._test.tx.add({ txid: tid("ab"), height: 99 });
			const r = getMerkle(ctx, [tid("ab"), 99]);
			expect(r).toHaveProperty("error");
		});
	});

	describe("idFromPos", () => {
		function setupBlock() {
			const block = {
				height: 2,
				hash: bhash("bb"),
				header: {
					hash: bhash("bb"),
					height: 2,
					version: 1,
					prevHash: bhash("00"),
					merkleRoot: "00".repeat(32),
					timestamp: 1000002,
					bits: 0x1d00ffff,
					nonce: 0,
					hex: "00".repeat(80),
				},
				transactions: [
					{ txid: tid("t1"), inputs: [], outputs: [] },
					{ txid: tid("t2"), inputs: [], outputs: [] },
				],
			};
			node.storage.applyBlock(block);
		}

		it("returns txid for position", () => {
			setupBlock();
			const r = idFromPos(ctx, [2, 0]);
			expect(r).toEqual({ result: tid("t1") });
		});

		it("returns txid for second position", () => {
			setupBlock();
			const r = idFromPos(ctx, [2, 1]);
			expect(r).toEqual({ result: tid("t2") });
		});

		it("returns txid + merkle when requested", () => {
			setupBlock();
			const r = idFromPos(ctx, [2, 0, true]) as { result: { tx_hash: string; merkle: string[] } };
			expect(r.result.tx_hash).toBe(tid("t1"));
			expect(r.result.merkle).toHaveLength(1);
		});

		it("errors for out-of-range position", () => {
			setupBlock();
			expect(idFromPos(ctx, [2, 5])).toHaveProperty("error");
		});

		it("errors for missing block", () => {
			expect(idFromPos(ctx, [999, 0])).toHaveProperty("error");
		});
	});

	describe("broadcast", () => {
		it("returns error for missing inputs", () => {
			const r = broadcast(ctx, ["deadbeef"]);
			expect(r).toHaveProperty("error");
		});

		it("rejects invalid hex", () => {
			expect(broadcast(ctx, ["xyz"])).toHaveProperty("error");
			expect(broadcast(ctx, [""])).toHaveProperty("error");
			expect(broadcast(ctx, ["aab"])).toHaveProperty("error"); // odd length
		});
	});
});
