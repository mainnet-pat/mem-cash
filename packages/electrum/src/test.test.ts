import { binToHex, encodeTransactionBch, hexToBin, sha256 } from "@bitauth/libauth";
import type { Node } from "@mem-cash/core";
import { createNode } from "@mem-cash/core";
import { computeMedianTimePast, makeOutpointKey } from "@mem-cash/types";
import { createTxVerifier } from "@mem-cash/validation";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestHandlers } from "./test.js";
import type { Handler, HandlerResult, ProtocolContext } from "./types.js";

function makeCtx(node: Node): ProtocolContext {
	return {
		node,
		serverVersion: "test/0.0",
		protocolMin: "1.6",
		protocolMax: "1.6",
		genesisHash: "0".repeat(64),
		hashFunction: "sha256",
	};
}

/** Valid BCH mainnet P2PKH address for testing. */
const TEST_ADDRESS = "bitcoincash:qz46h2at4w46h2at4w46h2at4w46h2at4vetysdy5q";

describe("test protocol handlers", () => {
	let node: Node;
	let ctx: ProtocolContext;
	let handlers: ReadonlyMap<string, Handler>;

	beforeEach(() => {
		node = createNode();
		handlers = createTestHandlers(node.storage);
		ctx = makeCtx(node);
	});

	function call(method: string, params: unknown[]): HandlerResult | Promise<HandlerResult> {
		const handler = handlers.get(method);
		if (!handler) throw new Error(`Handler not found: ${method}`);
		return handler(ctx, params);
	}

	describe("test.set_chain_tip", () => {
		it("sets tip and MTP correctly", () => {
			const result = call("test.set_chain_tip", [100, 1700000000]);
			expect(result).toEqual({ result: true });

			const tip = node.storage.getTip();
			expect(tip).toBeDefined();
			expect(tip?.height).toBe(100);
			expect(tip?.timestamp).toBe(1700000000);

			// MTP should equal the timestamp since all 11 headers have the same timestamp
			const mtp = computeMedianTimePast(node.storage, 100);
			expect(mtp).toBe(1700000000);
		});

		it("creates headers from max(0, h-10) to h", () => {
			call("test.set_chain_tip", [5, 1700000000]);

			// Should have headers at 0..5 (6 headers)
			for (let h = 0; h <= 5; h++) {
				expect(node.storage.getHeader(h)).toBeDefined();
			}
			expect(node.storage.getHeader(6)).toBeUndefined();
		});

		it("rejects invalid params", () => {
			const r1 = call("test.set_chain_tip", []);
			expect(r1).toHaveProperty("error");

			const r2 = call("test.set_chain_tip", [-1, 100]);
			expect(r2).toHaveProperty("error");

			const r3 = call("test.set_chain_tip", [100, "notanumber"]);
			expect(r3).toHaveProperty("error");
		});
	});

	describe("test.add_utxo", () => {
		it("creates retrievable UTXO with all fields", () => {
			const result = call("test.add_utxo", [TEST_ADDRESS, { satoshis: 5000, height: 10 }]) as {
				result: { txid: string };
			};

			expect(result.result).toBeDefined();
			const txid = result.result.txid;
			expect(txid).toHaveLength(64);

			const key = makeOutpointKey(txid, 0);
			const utxo = node.storage.getUtxoByOutpoint(key);
			expect(utxo).toBeDefined();
			expect(utxo?.satoshis).toBe(5000n);
			expect(utxo?.height).toBe(10);
			expect(utxo?.lockingBytecode.length).toBeGreaterThan(0);
		});

		it("creates UTXO at custom vout", () => {
			const result = call("test.add_utxo", [
				TEST_ADDRESS,
				{ vout: 2, satoshis: 3000, height: 5 },
			]) as { result: { txid: string } };

			const txid = result.result.txid;
			const key = makeOutpointKey(txid, 2);
			const utxo = node.storage.getUtxoByOutpoint(key);
			expect(utxo).toBeDefined();
			expect(utxo?.satoshis).toBe(3000n);
		});

		it("rejects invalid params", () => {
			const r = call("test.add_utxo", []);
			expect(r).toHaveProperty("error");

			const r2 = call("test.add_utxo", ["not-an-address", { satoshis: 100 }]);
			expect(r2).toHaveProperty("error");
		});
	});

	describe("test.remove_utxo", () => {
		it("removes an existing UTXO", () => {
			const result = call("test.add_utxo", [TEST_ADDRESS, { satoshis: 5000, height: 10 }]) as {
				result: { txid: string };
			};

			const txid = result.result.txid;
			const key = makeOutpointKey(txid, 0);
			expect(node.storage.getUtxoByOutpoint(key)).toBeDefined();

			call("test.remove_utxo", [txid, 0]);
			expect(node.storage.getUtxoByOutpoint(key)).toBeUndefined();
		});
	});

	describe("test.add_header", () => {
		it("adds a single header", () => {
			const hash = "cc".repeat(32);
			call("test.add_header", [hash, 42, 1700000000]);

			const header = node.storage.getHeader(42);
			expect(header).toBeDefined();
			expect(header?.hash).toBe(hash);
			expect(header?.timestamp).toBe(1700000000);
		});
	});

	describe("test.debugTransaction", () => {
		it("returns debug result with per-input traces for valid tx", async () => {
			const verifier = await createTxVerifier({ standard: false });
			node = createNode({ verifier });
			handlers = createTestHandlers(node.storage);
			ctx = makeCtx(node);

			node.setChainTip(200, 1700000000);

			const OP_TRUE = Uint8Array.of(0x51);
			const scriptHash = binToHex(sha256.hash(OP_TRUE));
			const parentTxid = "aa".repeat(32);
			node.addUtxo({
				txid: parentTxid,
				vout: 0,
				satoshis: 10_000n,
				scriptHash,
				height: 100,
				lockingBytecode: OP_TRUE,
			});

			const fee = 100n;
			const outputAmount = (10_000n - fee) / 2n;
			const remainder = 10_000n - fee - outputAmount;
			const rawHex = binToHex(
				encodeTransactionBch({
					version: 2,
					inputs: [
						{
							outpointTransactionHash: hexToBin(parentTxid),
							outpointIndex: 0,
							unlockingBytecode: new Uint8Array(0),
							sequenceNumber: 0xffffffff,
						},
					],
					outputs: [
						{ lockingBytecode: OP_TRUE, valueSatoshis: outputAmount },
						{ lockingBytecode: OP_TRUE, valueSatoshis: remainder },
					],
					locktime: 0,
				}),
			);

			const r = call("test.debugTransaction", [rawHex]) as {
				result: { success: boolean; inputResults?: unknown[] };
			};
			expect(r.result.success).toBe(true);
			expect(r.result.inputResults).toHaveLength(1);
		});

		it("returns failure with error for invalid tx", async () => {
			const verifier = await createTxVerifier({ standard: false });
			node = createNode({ verifier });
			handlers = createTestHandlers(node.storage);
			ctx = makeCtx(node);

			node.setChainTip(200, 1700000000);

			const r = call("test.debugTransaction", ["deadbeef"]) as {
				result: { success: boolean; error?: string };
			};
			expect(r.result.success).toBe(false);
			expect(r.result.error).toBeDefined();
		});

		it("rejects missing params", () => {
			const r = call("test.debugTransaction", []);
			expect(r).toHaveProperty("error");
		});
	});

	describe("test.reset", () => {
		it("clears all state", () => {
			call("test.set_chain_tip", [10, 1700000000]);
			const result = call("test.add_utxo", [TEST_ADDRESS, { satoshis: 5000, height: 1 }]) as {
				result: { txid: string };
			};
			const txid = result.result.txid;

			call("test.reset", []);

			expect(node.storage.getTip()).toBeUndefined();
			expect(node.storage.getUtxoByOutpoint(makeOutpointKey(txid, 0))).toBeUndefined();
		});
	});
});
