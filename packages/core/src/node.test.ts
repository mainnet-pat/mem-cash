import {
	binToHex,
	cashAddressToLockingBytecode,
	encodeTransactionBch,
	hashTransactionUiOrder,
	hexToBin,
	sha256,
} from "@bitauth/libauth";
import { createTxVerifier } from "@mem-cash/validation";
import { beforeEach, describe, expect, it } from "vitest";
import type { Node, SubmitSuccess } from "./node.js";
import { createNode } from "./node.js";
import type { Notification } from "./subscriptionManager.js";

/** OP_1 -- always succeeds. */
const OP_TRUE = Uint8Array.of(0x51);
const OP_TRUE_SH = binToHex(sha256.hash(OP_TRUE));

/** Build a raw tx hex spending one input with two OP_TRUE outputs (>=65 bytes). */
function buildRawTx(
	parentTxid: string,
	vout: number,
	inputSatoshis: bigint,
): { rawHex: string; txid: string } {
	const fee = 100n;
	const outputAmount = (inputSatoshis - fee) / 2n;
	const remainder = inputSatoshis - fee - outputAmount;
	const encoded = encodeTransactionBch({
		version: 2,
		inputs: [
			{
				outpointTransactionHash: hexToBin(parentTxid),
				outpointIndex: vout,
				unlockingBytecode: new Uint8Array(0),
				sequenceNumber: 0xffffffff,
			},
		],
		outputs: [
			{ lockingBytecode: OP_TRUE, valueSatoshis: outputAmount },
			{ lockingBytecode: OP_TRUE, valueSatoshis: remainder },
		],
		locktime: 0,
	});
	return {
		rawHex: binToHex(encoded),
		txid: binToHex(hashTransactionUiOrder(encoded)),
	};
}

function addSeedUtxo(node: Node, parentTxid = "aa".repeat(32), satoshis = 10000n) {
	node.addUtxo({
		txid: parentTxid,
		vout: 0,
		satoshis,
		scriptHash: OP_TRUE_SH,
		height: 100,
		lockingBytecode: OP_TRUE,
	});
}

describe("createNode", () => {
	describe("factory", () => {
		it("returns a Node with storage and subscriptions", () => {
			const node = createNode();
			expect(node.storage).toBeDefined();
			expect(node.subscriptions).toBeDefined();
		});

		it("delegates StorageReader methods to storage", () => {
			const node = createNode();
			node.setChainTip(200, 1700000000);
			addSeedUtxo(node);

			// getUtxos via Node should match storage
			const utxos = node.getUtxos(OP_TRUE_SH);
			const storageUtxos = node.storage.getUtxos(OP_TRUE_SH);
			expect(utxos).toEqual(storageUtxos);
			expect(utxos).toHaveLength(1);

			// getTip
			const tip = node.getTip();
			expect(tip).toBeDefined();
			expect(tip?.height).toBe(200);
		});
	});

	describe("submitTransaction without verifier", () => {
		let node: Node;

		beforeEach(() => {
			node = createNode();
			node.setChainTip(200, 1700000000);
		});

		it("accepts a valid transaction and returns success", () => {
			addSeedUtxo(node);
			const { rawHex, txid } = buildRawTx("aa".repeat(32), 0, 10000n);
			const result = node.submitTransaction(rawHex);

			expect(result.success).toBe(true);
			const success = result as SubmitSuccess;
			expect(success.txid).toBe(txid);
			expect(success.fee).toBe(100n);
			expect(success.size).toBeGreaterThan(0);
			expect(success.affectedScriptHashes.size).toBeGreaterThan(0);
		});

		it("fails with TX decode failed for invalid hex", () => {
			const result = node.submitTransaction("zzzz");
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("TX decode failed");
			}
		});

		it("fails with bad-txns-inputs-missingorspent for missing inputs", () => {
			const { rawHex } = buildRawTx("bb".repeat(32), 0, 10000n);
			const result = node.submitTransaction(rawHex);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("bad-txns-inputs-missingorspent");
			}
		});

		it("chains unconfirmed transactions", () => {
			addSeedUtxo(node);
			const tx1 = buildRawTx("aa".repeat(32), 0, 10000n);
			expect(node.submitTransaction(tx1.rawHex).success).toBe(true);

			const tx2 = buildRawTx(tx1.txid, 0, 4950n);
			expect(node.submitTransaction(tx2.rawHex).success).toBe(true);
		});

		it("triggers subscription notifications for affected scripthashes", () => {
			addSeedUtxo(node);

			const notifications: Notification[] = [];
			const consumerId = node.subscriptions.addConsumer((n) => notifications.push(n));
			node.subscriptions.subscribeScriptHash(consumerId, OP_TRUE_SH);

			const { rawHex } = buildRawTx("aa".repeat(32), 0, 10000n);
			node.submitTransaction(rawHex);

			const scriptHashNotifs = notifications.filter((n) => n.type === "scripthash");
			expect(scriptHashNotifs.length).toBeGreaterThan(0);
		});
	});

	describe("submitTransaction with verifier", () => {
		async function setup(): Promise<Node> {
			const verifier = await createTxVerifier({ standard: false });
			const node = createNode({ verifier });
			node.setChainTip(200, 1700000000);
			return node;
		}

		it("verifies, accepts, and returns txid", async () => {
			const node = await setup();
			addSeedUtxo(node);

			const { rawHex, txid } = buildRawTx("aa".repeat(32), 0, 10000n);
			const result = node.submitTransaction(rawHex);

			expect(result.success).toBe(true);
			const success = result as SubmitSuccess;
			expect(success.txid).toBe(txid);
			expect(success.fee).toBe(100n);
			expect(success.affectedScriptHashes.size).toBeGreaterThan(0);
		});

		it("fails with No chain tip set when no tip is configured", async () => {
			const verifier = await createTxVerifier({ standard: false });
			const node = createNode({ verifier });
			addSeedUtxo(node);

			const { rawHex } = buildRawTx("aa".repeat(32), 0, 10000n);
			const result = node.submitTransaction(rawHex);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("No chain tip set");
			}
		});

		it("fails for invalid hex", async () => {
			const node = await setup();
			const result = node.submitTransaction("zzzz");
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("TX decode failed");
			}
		});

		it("chains unconfirmed transactions through verifier", async () => {
			const node = await setup();
			addSeedUtxo(node);

			const tx1 = buildRawTx("aa".repeat(32), 0, 10000n);
			expect(node.submitTransaction(tx1.rawHex).success).toBe(true);

			const tx2 = buildRawTx(tx1.txid, 0, 4950n);
			expect(node.submitTransaction(tx2.rawHex).success).toBe(true);
		});
	});

	describe("debugTransaction", () => {
		it("returns error when no verifier configured", () => {
			const node = createNode();
			const result = node.debugTransaction("aabb");
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("No verifier configured");
			}
		});

		it("returns error when verifier present but no chain tip", async () => {
			const verifier = await createTxVerifier({ standard: false });
			const node = createNode({ verifier });
			addSeedUtxo(node);

			const { rawHex } = buildRawTx("aa".repeat(32), 0, 10000n);
			const result = node.debugTransaction(rawHex);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("No chain tip set");
			}
		});

		it("returns debug traces with verifier and chain tip", async () => {
			const verifier = await createTxVerifier({ standard: false });
			const node = createNode({ verifier });
			node.setChainTip(200, 1700000000);
			addSeedUtxo(node);

			const { rawHex } = buildRawTx("aa".repeat(32), 0, 10000n);
			const result = node.debugTransaction(rawHex);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.inputResults).toHaveLength(1);
				expect(result.inputResults[0]?.inputIndex).toBe(0);
				expect(result.inputResults[0]?.success).toBe(true);
				expect(result.fee).toBe(100n);
			}
		});

		it("does not accept to mempool", async () => {
			const verifier = await createTxVerifier({ standard: false });
			const node = createNode({ verifier });
			node.setChainTip(200, 1700000000);
			addSeedUtxo(node);

			const { rawHex, txid } = buildRawTx("aa".repeat(32), 0, 10000n);
			node.debugTransaction(rawHex);

			expect(node.storage.getMempoolTx(txid)).toBeUndefined();
			expect(node.storage.getMempoolTxids()).toHaveLength(0);
		});
	});

	describe("mine", () => {
		let node: Node;

		beforeEach(() => {
			node = createNode();
			node.setChainTip(200, 1700000000);
		});

		it("confirms mempool transactions into a new block", () => {
			addSeedUtxo(node);
			const { rawHex } = buildRawTx("aa".repeat(32), 0, 10000n);
			node.submitTransaction(rawHex);
			expect(node.storage.getMempoolTxids()).toHaveLength(1);

			const result = node.mine();

			expect(result.height).toBe(201);
			expect(result.affectedScriptHashes.size).toBeGreaterThan(0);
			// Mempool should be cleared
			expect(node.storage.getMempoolTxids()).toHaveLength(0);
			// Chain tip should advance
			const tip = node.storage.getTip();
			expect(tip?.height).toBe(201);
		});

		it("returns affected scripthashes", () => {
			addSeedUtxo(node);
			const { rawHex } = buildRawTx("aa".repeat(32), 0, 10000n);
			node.submitTransaction(rawHex);

			const result = node.mine();
			expect(result.affectedScriptHashes.has(OP_TRUE_SH)).toBe(true);
		});

		it("uses provided timestamp", () => {
			const result = node.mine(1800000000);
			expect(result.height).toBe(201);
			const tip = node.storage.getTip();
			expect(tip?.timestamp).toBe(1800000000);
		});

		it("defaults timestamp to 1700000000 + height", () => {
			const result = node.mine();
			expect(result.height).toBe(201);
			const tip = node.storage.getTip();
			expect(tip?.timestamp).toBe(1700000000 + 201);
		});

		it("advances chain tip across multiple mines", () => {
			const r1 = node.mine();
			expect(r1.height).toBe(201);
			const r2 = node.mine();
			expect(r2.height).toBe(202);
			const r3 = node.mine();
			expect(r3.height).toBe(203);
		});

		it("notifies header subscribers", () => {
			const notifications: Notification[] = [];
			const consumerId = node.subscriptions.addConsumer((n) => notifications.push(n));
			node.subscriptions.subscribeHeaders(consumerId);

			node.mine();

			const headerNotifs = notifications.filter((n) => n.type === "header");
			expect(headerNotifs.length).toBe(1);
			if (headerNotifs[0]?.type === "header") {
				expect(headerNotifs[0].header.height).toBe(201);
			}
		});

		it("notifies scripthash subscribers for affected scripthashes", () => {
			addSeedUtxo(node);
			const { rawHex } = buildRawTx("aa".repeat(32), 0, 10000n);
			node.submitTransaction(rawHex);

			const notifications: Notification[] = [];
			const consumerId = node.subscriptions.addConsumer((n) => notifications.push(n));
			node.subscriptions.subscribeScriptHash(consumerId, OP_TRUE_SH);

			node.mine();

			const scriptHashNotifs = notifications.filter((n) => n.type === "scripthash");
			expect(scriptHashNotifs.length).toBeGreaterThan(0);
		});

		it("mines with no mempool transactions (empty block)", () => {
			const result = node.mine();
			expect(result.height).toBe(201);
			expect(result.affectedScriptHashes.size).toBe(0);
			expect(node.storage.getMempoolTxids()).toHaveLength(0);
		});
	});

	describe("setChainTip", () => {
		it("creates 11 headers from height-10 through height", () => {
			const node = createNode();
			node.setChainTip(200, 1700000000);

			const tip = node.storage.getTip();
			expect(tip).toBeDefined();
			expect(tip?.height).toBe(200);

			// Headers from 190 through 200 should exist
			for (let h = 190; h <= 200; h++) {
				const header = node.storage.getHeader(h);
				expect(header).toBeDefined();
				expect(header?.height).toBe(h);
			}
		});

		it("sets MTP correctly (all headers same timestamp)", () => {
			const node = createNode();
			node.setChainTip(200, 1700000000);

			// With all 11 headers at the same timestamp, MTP should equal that timestamp
			const tip = node.storage.getTip();
			expect(tip).toBeDefined();
			expect(tip?.timestamp).toBe(1700000000);
		});

		it("handles low heights gracefully (height < 10)", () => {
			const node = createNode();
			node.setChainTip(5, 1700000000);

			const tip = node.storage.getTip();
			expect(tip).toBeDefined();
			expect(tip?.height).toBe(5);

			// Headers from 0 through 5 should exist
			for (let h = 0; h <= 5; h++) {
				const header = node.storage.getHeader(h);
				expect(header).toBeDefined();
			}
		});
	});

	describe("addUtxo", () => {
		it("adds a UTXO retrievable via storage.getUtxos", () => {
			const node = createNode();
			node.setChainTip(200, 1700000000);
			addSeedUtxo(node);

			const utxos = node.storage.getUtxos(OP_TRUE_SH);
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.satoshis).toBe(10000n);
			expect(utxos[0]?.outpoint.txid).toBe("aa".repeat(32));
			expect(utxos[0]?.outpoint.vout).toBe(0);
		});

		it("supports isCoinbase flag", () => {
			const node = createNode();
			node.addUtxo({
				txid: "cc".repeat(32),
				vout: 0,
				satoshis: 50000n,
				scriptHash: OP_TRUE_SH,
				height: 50,
				lockingBytecode: OP_TRUE,
				isCoinbase: true,
			});

			const utxos = node.storage.getUtxos(OP_TRUE_SH);
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.isCoinbase).toBe(true);
		});

		it("adds multiple UTXOs for the same scripthash", () => {
			const node = createNode();
			node.addUtxo({
				txid: "aa".repeat(32),
				vout: 0,
				satoshis: 10000n,
				scriptHash: OP_TRUE_SH,
				height: 100,
			});
			node.addUtxo({
				txid: "bb".repeat(32),
				vout: 1,
				satoshis: 20000n,
				scriptHash: OP_TRUE_SH,
				height: 101,
			});

			const utxos = node.storage.getUtxos(OP_TRUE_SH);
			expect(utxos).toHaveLength(2);
		});

		it("defaults lockingBytecode to empty when not provided", () => {
			const node = createNode();
			node.addUtxo({
				txid: "dd".repeat(32),
				vout: 0,
				satoshis: 5000n,
				scriptHash: OP_TRUE_SH,
				height: 100,
			});

			const utxos = node.storage.getUtxos(OP_TRUE_SH);
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.lockingBytecode).toEqual(new Uint8Array(0));
		});

		it("derives scriptHash and lockingBytecode from address", () => {
			const node = createNode();
			const address = "bitcoincash:qz46h2at4w46h2at4w46h2at4w46h2at4vetysdy5q";
			const decoded = cashAddressToLockingBytecode(address);
			if (typeof decoded === "string") throw new Error(decoded);
			const expectedSh = binToHex(sha256.hash(decoded.bytecode));

			node.addUtxo({
				txid: "ee".repeat(32),
				vout: 0,
				satoshis: 7000n,
				address,
				height: 100,
			});

			const utxos = node.storage.getUtxos(expectedSh);
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.satoshis).toBe(7000n);
			expect(utxos[0]?.lockingBytecode).toEqual(decoded.bytecode);
		});

		it("throws for invalid address", () => {
			const node = createNode();
			expect(() =>
				node.addUtxo({
					txid: "ff".repeat(32),
					vout: 0,
					satoshis: 1000n,
					address: "not-a-valid-address",
					height: 100,
				}),
			).toThrow("Invalid address");
		});

		it("throws when neither address nor scriptHash is provided", () => {
			const node = createNode();
			expect(() =>
				node.addUtxo({
					txid: "ff".repeat(32),
					vout: 0,
					satoshis: 1000n,
					height: 100,
				}),
			).toThrow("Either address or scriptHash must be provided");
		});

		it("prefers explicit scriptHash over address-derived one", () => {
			const node = createNode();
			const address = "bitcoincash:qz46h2at4w46h2at4w46h2at4w46h2at4vetysdy5q";

			node.addUtxo({
				txid: "ff".repeat(32),
				vout: 0,
				satoshis: 3000n,
				address,
				scriptHash: OP_TRUE_SH,
				height: 100,
			});

			const utxos = node.storage.getUtxos(OP_TRUE_SH);
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.satoshis).toBe(3000n);
		});
	});
});
