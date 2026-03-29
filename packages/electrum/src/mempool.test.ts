import type { Node } from "@mem-cash/core";
import { createNode } from "@mem-cash/core";
import { beforeEach, describe, expect, it } from "vitest";
import { getFeeHistogram, getInfo } from "./mempool.js";
import type { ProtocolContext } from "./types.js";

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

describe("mempool.get_fee_histogram", () => {
	let node: Node;
	let ctx: ProtocolContext;

	beforeEach(() => {
		node = createNode();
		ctx = makeCtx(node);
	});

	it("returns empty array for empty mempool", () => {
		expect(getFeeHistogram(ctx, [])).toEqual({ result: [] });
	});

	it("returns one histogram bucket for a single tx", () => {
		// fee=500, size=250 → feeRate = 2 sat/byte → lands in the 2 bucket
		node.storage._test.mempool.add({
			txid: tid("aa"),
			fee: 500n,
			size: 250,
			inputs: [],
			outputs: [],
		});

		const r = getFeeHistogram(ctx, []) as { result: [number, number][] };
		expect(r.result.length).toBe(1);
		expect(r.result[0][0]).toBe(2);
		expect(r.result[0][1]).toBe(250);
	});

	it("sorts multiple txs into correct buckets by fee rate", () => {
		// tx1: fee=1000, size=100 → feeRate=10 → bucket 10
		node.storage._test.mempool.add({
			txid: tid("aa"),
			fee: 1000n,
			size: 100,
			inputs: [],
			outputs: [],
		});

		// tx2: fee=100, size=100 → feeRate=1 → bucket 1
		node.storage._test.mempool.add({
			txid: tid("bb"),
			fee: 100n,
			size: 100,
			inputs: [],
			outputs: [],
		});

		// tx3: fee=5000, size=100 → feeRate=50 → bucket 50
		node.storage._test.mempool.add({
			txid: tid("cc"),
			fee: 5000n,
			size: 100,
			inputs: [],
			outputs: [],
		});

		const r = getFeeHistogram(ctx, []) as { result: [number, number][] };
		// Should have 3 buckets: 50, 10, 1 (descending order)
		expect(r.result.length).toBe(3);

		const bucketRates = r.result.map(([rate]) => rate);
		expect(bucketRates).toEqual([50, 10, 1]);

		// Each bucket should have cumulative size of 100
		for (const [, size] of r.result) {
			expect(size).toBe(100);
		}
	});

	it("skips txs with size 0", () => {
		// tx with size 0 should be skipped
		node.storage._test.mempool.add({
			txid: tid("aa"),
			fee: 1000n,
			size: 0,
			inputs: [],
			outputs: [],
		});

		// tx with valid size should be included
		node.storage._test.mempool.add({
			txid: tid("bb"),
			fee: 500n,
			size: 250,
			inputs: [],
			outputs: [],
		});

		const r = getFeeHistogram(ctx, []) as { result: [number, number][] };
		expect(r.result.length).toBe(1);
		// Only the valid tx (feeRate=2) should appear
		expect(r.result[0][0]).toBe(2);
		expect(r.result[0][1]).toBe(250);
	});
});

describe("mempool.get_info", () => {
	it("returns default relay fee (0.00001) when no getRelayFee hook", () => {
		const ctx = makeCtx(createNode());
		const r = getInfo(ctx, []) as { result: Record<string, number> };
		expect(r.result.mempoolminfee).toBe(0.00001);
		expect(r.result.minrelaytxfee).toBe(0.00001);
	});

	it("returns custom relay fee when getRelayFee hook is provided", () => {
		const ctx = makeCtx(createNode(), { getRelayFee: () => 0.001 });
		const r = getInfo(ctx, []) as { result: Record<string, number> };
		expect(r.result.mempoolminfee).toBe(0.001);
		expect(r.result.minrelaytxfee).toBe(0.001);
	});

	it("sets both mempoolminfee and minrelaytxfee", () => {
		const ctx = makeCtx(createNode(), { getRelayFee: () => 0.005 });
		const r = getInfo(ctx, []) as { result: Record<string, number> };
		expect(r.result).toHaveProperty("mempoolminfee");
		expect(r.result).toHaveProperty("minrelaytxfee");
		expect(r.result.mempoolminfee).toBe(r.result.minrelaytxfee);
	});
});
