import type { Node } from "@mem-cash/core";
import { createNode } from "@mem-cash/core";
import { beforeEach, describe, expect, it } from "vitest";
import { blockHeader, blockHeaders, headersSubscribe, headersUnsubscribe } from "./headers.js";
import type { ProtocolContext } from "./types.js";

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

function addHeaders(node: Node, count: number) {
	for (let i = 0; i < count; i++) {
		const hashChar = (i + 10).toString(16).padStart(2, "0");
		node.storage._test.header.add({
			hash: bhash(hashChar),
			height: i,
			hex: hashChar.repeat(80),
		});
	}
}

describe("header handlers", () => {
	let node: Node;
	let ctx: ProtocolContext;

	beforeEach(() => {
		node = createNode();
		ctx = makeCtx(node);
	});

	describe("blockHeader", () => {
		it("returns hex for valid height", () => {
			addHeaders(node, 3);
			const r = blockHeader(ctx, [0]);
			expect(r).toEqual({ result: "0a".repeat(80) });
		});

		it("errors for missing height", () => {
			expect(blockHeader(ctx, [0])).toHaveProperty("error");
		});

		it("errors for invalid params", () => {
			expect(blockHeader(ctx, [-1])).toHaveProperty("error");
			expect(blockHeader(ctx, ["abc"])).toHaveProperty("error");
		});

		it("returns header + merkle proof with cp_height", () => {
			addHeaders(node, 4);
			const r = blockHeader(ctx, [1, 3]) as {
				result: { header: string; branch: string[]; root: string };
			};
			expect(r.result.header).toBe("0b".repeat(80));
			expect(r.result.branch.length).toBeGreaterThan(0);
			expect(r.result.root).toHaveLength(64);
		});

		it("errors if height > cp_height", () => {
			addHeaders(node, 4);
			expect(blockHeader(ctx, [3, 1])).toHaveProperty("error");
		});

		it("errors if cp_height > tip", () => {
			addHeaders(node, 2);
			expect(blockHeader(ctx, [0, 99])).toHaveProperty("error");
		});
	});

	describe("blockHeaders", () => {
		it("returns concatenated headers", () => {
			addHeaders(node, 5);
			const r = blockHeaders(ctx, [0, 3]) as {
				result: { count: number; hex: string; max: number };
			};
			expect(r.result.count).toBe(3);
			expect(r.result.hex).toHaveLength(3 * 160); // 80 bytes = 160 hex chars each
			expect(r.result.max).toBe(2016);
		});

		it("clamps to available headers", () => {
			addHeaders(node, 3);
			const r = blockHeaders(ctx, [0, 100]) as { result: { count: number } };
			expect(r.result.count).toBe(3);
		});

		it("returns 0 count for out-of-range start", () => {
			addHeaders(node, 3);
			const r = blockHeaders(ctx, [99, 5]) as { result: { count: number; hex: string } };
			expect(r.result.count).toBe(0);
			expect(r.result.hex).toBe("");
		});

		it("includes checkpoint proof when cp_height provided", () => {
			addHeaders(node, 4);
			const r = blockHeaders(ctx, [0, 2, 3]) as {
				result: { count: number; branch?: string[]; root?: string };
			};
			expect(r.result.count).toBe(2);
			expect(r.result.branch).toBeDefined();
			expect(r.result.root).toBeDefined();
		});
	});

	describe("headersSubscribe", () => {
		it("returns tip header", () => {
			addHeaders(node, 3);
			const r = headersSubscribe(ctx, []) as {
				result: { height: number; hex: string };
			};
			expect(r.result.height).toBe(2);
			expect(r.result.hex).toBe("0c".repeat(80));
		});

		it("errors when no blocks", () => {
			expect(headersSubscribe(ctx, [])).toHaveProperty("error");
		});

		it("calls subscribe hook", () => {
			addHeaders(node, 1);
			let called = false;
			const hooked = makeCtx(node, {
				subscribeHeaders: () => {
					called = true;
				},
			});
			headersSubscribe(hooked, []);
			expect(called).toBe(true);
		});
	});

	describe("headersUnsubscribe", () => {
		it("calls hook and returns result", () => {
			const hooked = makeCtx(node, {
				unsubscribeHeaders: () => true,
			});
			expect(headersUnsubscribe(hooked, [])).toEqual({ result: true });
		});

		it("errors without hook", () => {
			expect(headersUnsubscribe(ctx, [])).toHaveProperty("error");
		});
	});
});
