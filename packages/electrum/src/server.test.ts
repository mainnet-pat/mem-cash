import { createNode } from "@mem-cash/core";
import { describe, expect, it } from "vitest";
import { estimateFee, features, ping, relayFee, version } from "./server.js";
import type { ProtocolContext } from "./types.js";

function makeCtx(hooks?: Partial<ProtocolContext>): ProtocolContext {
	return {
		node: createNode(),
		serverVersion: "mem-cash 0.1",
		protocolMin: "1.6",
		protocolMax: "1.6",
		genesisHash: "aa".repeat(32),
		hashFunction: "sha256",
		...hooks,
	};
}

describe("server handlers", () => {
	describe("ping", () => {
		it("returns null", () => {
			expect(ping(makeCtx(), [])).toEqual({ result: null });
		});
	});

	describe("version", () => {
		it("negotiates with single version string", () => {
			const r = version(makeCtx(), ["TestClient/1.0", "1.6"]) as {
				result: [string, string];
			};
			expect(r.result[0]).toBe("mem-cash 0.1");
			expect(r.result[1]).toBe("1.6");
		});

		it("negotiates with version range containing 1.6", () => {
			const r = version(makeCtx(), ["TestClient", ["1.5", "1.7"]]) as {
				result: [string, string];
			};
			expect(r.result[1]).toBe("1.6");
		});

		it("picks min of client max and server max", () => {
			const r = version(makeCtx(), ["TestClient", ["1.6", "1.9"]]) as {
				result: [string, string];
			};
			// Server max is 1.6, client max is 1.9 → negotiated = 1.6
			expect(r.result[1]).toBe("1.6");
		});

		it("errors when client too old", () => {
			const r = version(makeCtx(), ["TestClient", "1.4"]);
			expect(r).toHaveProperty("error");
		});

		it("errors when client too new", () => {
			const r = version(makeCtx(), ["TestClient", ["1.7", "1.9"]]);
			expect(r).toHaveProperty("error");
		});

		it("errors with missing params", () => {
			expect(version(makeCtx(), [])).toHaveProperty("error");
			expect(version(makeCtx(), ["client"])).toHaveProperty("error");
		});
	});

	describe("features", () => {
		it("returns server features object", () => {
			const r = features(makeCtx(), []) as { result: Record<string, unknown> };
			expect(r.result.server_version).toBe("mem-cash 0.1");
			expect(r.result.protocol_min).toBe("1.6");
			expect(r.result.protocol_max).toBe("1.6");
			expect(r.result.genesis_hash).toBe("aa".repeat(32));
			expect(r.result.hash_function).toBe("sha256");
			expect(r.result.pruning).toBeNull();
		});
	});

	describe("estimateFee", () => {
		it("returns -1 without hook", async () => {
			const r = await estimateFee(makeCtx(), [6]);
			expect(r).toEqual({ result: -1 });
		});

		it("returns fee from hook", async () => {
			const ctx = makeCtx({ estimateFee: async () => 0.0001 });
			const r = await estimateFee(ctx, [6]);
			expect(r).toEqual({ result: 0.0001 });
		});

		it("returns -1 on hook error", async () => {
			const ctx = makeCtx({
				estimateFee: async () => {
					throw new Error("fail");
				},
			});
			const r = await estimateFee(ctx, [6]);
			expect(r).toEqual({ result: -1 });
		});

		it("rejects invalid blocks param", async () => {
			expect(await estimateFee(makeCtx(), [0])).toHaveProperty("error");
			expect(await estimateFee(makeCtx(), [-1])).toHaveProperty("error");
			expect(await estimateFee(makeCtx(), ["six"])).toHaveProperty("error");
		});
	});

	describe("relayFee", () => {
		it("returns default without hook", () => {
			expect(relayFee(makeCtx(), [])).toEqual({ result: 0.00001 });
		});

		it("returns value from hook", () => {
			const ctx = makeCtx({ getRelayFee: () => 0.00005 });
			expect(relayFee(ctx, [])).toEqual({ result: 0.00005 });
		});
	});
});
