import { createNode } from "@mem-cash/core";
import { describe, expect, it } from "vitest";
import { dispatch, getSupportedMethods } from "./dispatch.js";
import type { ProtocolContext } from "./types.js";

function makeCtx(): ProtocolContext {
	return {
		node: createNode(),
		serverVersion: "test",
		protocolMin: "1.6",
		protocolMax: "1.6",
		genesisHash: "00".repeat(32),
		hashFunction: "sha256",
	};
}

describe("dispatch", () => {
	it("routes server.ping correctly", async () => {
		const r = await dispatch(makeCtx(), "server.ping", []);
		expect(r).toEqual({ result: null });
	});

	it("returns method-not-found for unknown method", async () => {
		const r = await dispatch(makeCtx(), "nonexistent.method", []);
		expect(r).toHaveProperty("error");
		expect((r as { error: { code: number } }).error.code).toBe(-32601);
	});

	it("passes params through to handler", async () => {
		const r = await dispatch(makeCtx(), "blockchain.scripthash.get_balance", ["aa".repeat(32)]);
		expect(r).toEqual({ result: { confirmed: 0, unconfirmed: 0 } });
	});
});

describe("getSupportedMethods", () => {
	it("returns all 53 methods", () => {
		const methods = getSupportedMethods();
		expect(methods.length).toBe(53);
	});

	it("includes expected methods", () => {
		const methods = getSupportedMethods();
		expect(methods).toContain("server.ping");
		expect(methods).toContain("server.version");
		expect(methods).toContain("server.features");
		expect(methods).toContain("blockchain.scripthash.get_balance");
		expect(methods).toContain("blockchain.scripthash.subscribe");
		expect(methods).toContain("blockchain.transaction.get");
		expect(methods).toContain("blockchain.transaction.broadcast");
		expect(methods).toContain("blockchain.block.header");
		expect(methods).toContain("blockchain.headers.subscribe");
		expect(methods).toContain("blockchain.estimatefee");
		expect(methods).toContain("blockchain.relayfee");
	});
});
