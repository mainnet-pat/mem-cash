import { describe, expect, it } from "vitest";
import { makeOutpointKey, parseOutpointKey } from "./primitives.js";

describe("makeOutpointKey", () => {
	it("produces txid:vout format", () => {
		const txid = "aa".repeat(32);
		expect(makeOutpointKey(txid, 0)).toBe(`${"aa".repeat(32)}:0`);
		expect(makeOutpointKey(txid, 42)).toBe(`${"aa".repeat(32)}:42`);
	});
});

describe("parseOutpointKey", () => {
	it("round-trips through makeOutpointKey", () => {
		const txid = "bb".repeat(32);
		const key = makeOutpointKey(txid, 7);
		const parsed = parseOutpointKey(key);
		expect(parsed.txid).toBe(txid);
		expect(parsed.vout).toBe(7);
	});

	it("handles vout 0", () => {
		const txid = "cc".repeat(32);
		const key = makeOutpointKey(txid, 0);
		const parsed = parseOutpointKey(key);
		expect(parsed.txid).toBe(txid);
		expect(parsed.vout).toBe(0);
	});

	it("handles large vout", () => {
		const txid = "dd".repeat(32);
		const key = makeOutpointKey(txid, 99999);
		const parsed = parseOutpointKey(key);
		expect(parsed.txid).toBe(txid);
		expect(parsed.vout).toBe(99999);
	});
});
