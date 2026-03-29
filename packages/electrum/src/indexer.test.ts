import {
	binToHex,
	encodeTransactionBch,
	hashTransactionUiOrder,
	hexToBin,
	sha256,
} from "@bitauth/libauth";
import type { SubmitSuccess } from "@mem-cash/core";
import { createTxVerifier } from "@mem-cash/validation";
import { describe, expect, it } from "vitest";
import type { Indexer } from "./indexer.js";
import { createIndexer } from "./indexer.js";

/** OP_1 — always succeeds. */
const OP_TRUE = Uint8Array.of(0x51);
const OP_TRUE_SCRIPT_HASH = binToHex(sha256.hash(OP_TRUE));

/** Build a raw tx hex spending one input with two OP_TRUE outputs (≥65 bytes). */
function buildRawTx(
	parentTxid: string,
	vout: number,
	inputSatoshis: bigint,
): { rawHex: string; expectedTxid: string } {
	const fee = 100n;
	const outputAmount = (inputSatoshis - fee) / 2n;
	const remainder = inputSatoshis - fee - outputAmount;
	const tx = {
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
	};
	const encoded = encodeTransactionBch(tx);
	return {
		rawHex: binToHex(encoded),
		expectedTxid: binToHex(hashTransactionUiOrder(encoded)),
	};
}

function addSeedUtxo(node: Indexer, parentTxid = "aa".repeat(32), satoshis = 10000n) {
	node.addUtxo({
		txid: parentTxid,
		vout: 0,
		satoshis,
		scriptHash: OP_TRUE_SCRIPT_HASH,
		height: 100,
		lockingBytecode: OP_TRUE,
	});
}

describe("Indexer", () => {
	describe("without verifier", () => {
		function setup(): Indexer {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);
			return node;
		}

		it("accepts transactions without validation", () => {
			const node = setup();
			addSeedUtxo(node);

			const { rawHex, expectedTxid } = buildRawTx("aa".repeat(32), 0, 10000n);
			const result = node.submitTransaction(rawHex);

			expect(result.success).toBe(true);
			const success = result as SubmitSuccess;
			expect(success.txid).toBe(expectedTxid);
			expect(success.fee).toBe(100n);
			expect(success.affectedScriptHashes.size).toBeGreaterThan(0);
		});

		it("fails for missing inputs", () => {
			const node = setup();
			const { rawHex } = buildRawTx("bb".repeat(32), 0, 10000n);
			const result = node.submitTransaction(rawHex);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe("bad-txns-inputs-missingorspent");
			}
		});

		it("chains unconfirmed transactions", () => {
			const node = setup();
			addSeedUtxo(node);

			const tx1 = buildRawTx("aa".repeat(32), 0, 10000n);
			expect(node.submitTransaction(tx1.rawHex).success).toBe(true);

			const tx2 = buildRawTx(tx1.expectedTxid, 0, 4950n);
			expect(node.submitTransaction(tx2.rawHex).success).toBe(true);
		});
	});

	describe("with verifier", () => {
		async function setup(): Promise<Indexer> {
			const verifier = await createTxVerifier({ standard: false });
			const node = createIndexer({ verifier });
			node.setChainTip(200, 1700000000);
			return node;
		}

		it("verifies, accepts, and returns txid", async () => {
			const node = await setup();
			addSeedUtxo(node);

			const { rawHex, expectedTxid } = buildRawTx("aa".repeat(32), 0, 10000n);
			const result = node.submitTransaction(rawHex);

			expect(result.success).toBe(true);
			const success = result as SubmitSuccess;
			expect(success.txid).toBe(expectedTxid);
			expect(success.fee).toBe(100n);
			expect(success.affectedScriptHashes.size).toBeGreaterThan(0);
		});

		it("fails without chain tip", async () => {
			const verifier = await createTxVerifier({ standard: false });
			const node = createIndexer({ verifier });
			const parentTxid = "aa".repeat(32);
			addSeedUtxo(node);

			const { rawHex } = buildRawTx(parentTxid, 0, 10000n);
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

		it("makes outputs available for subsequent transactions", async () => {
			const node = await setup();
			addSeedUtxo(node);

			const tx1 = buildRawTx("aa".repeat(32), 0, 10000n);
			expect(node.submitTransaction(tx1.rawHex).success).toBe(true);

			const tx2 = buildRawTx(tx1.expectedTxid, 0, 4950n);
			expect(node.submitTransaction(tx2.rawHex).success).toBe(true);
		});
	});

	describe("setChainTip", () => {
		it("sets tip height and MTP", () => {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);
			const tip = node.storage.getTip();
			expect(tip).toBeDefined();
			expect(tip?.height).toBe(200);
		});
	});

	describe("addUtxo", () => {
		it("adds a retrievable UTXO", () => {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);
			addSeedUtxo(node);

			const utxos = node.storage.getUtxos(OP_TRUE_SCRIPT_HASH);
			expect(utxos).toHaveLength(1);
			expect(utxos[0]?.satoshis).toBe(10000n);
		});
	});

	describe("request", () => {
		it("dispatches Electrum protocol methods", async () => {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);
			node.addUtxo({
				txid: "aa".repeat(32),
				vout: 0,
				satoshis: 50000n,
				scriptHash: OP_TRUE_SCRIPT_HASH,
				height: 100,
				lockingBytecode: OP_TRUE,
			});

			const result = await node.request("blockchain.scripthash.get_balance", [OP_TRUE_SCRIPT_HASH]);
			expect(result.confirmed).toBe(50000);
		});

		it("supports test.* methods", async () => {
			const node = createIndexer();
			await node.request("test.set_chain_tip", [100, 1700000000]);
			expect(node.storage.getTip()?.height).toBe(100);
		});

		it("supports server.ping", async () => {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);
			const result = await node.request("server.ping");
			expect(result).toBeNull();
		});
	});

	describe("subscriptions", () => {
		it("subscribe delivers initial result and tracks via subscriptions manager", async () => {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);

			const received: [string, string | null][] = [];
			const unsub = await node.subscribe(
				"blockchain.scripthash.subscribe",
				[OP_TRUE_SCRIPT_HASH],
				(data) => received.push(data),
			);

			expect(received).toHaveLength(1);
			expect(received[0]).toEqual([OP_TRUE_SCRIPT_HASH, null]);
			expect(node.subscriptions.getScriptHashSubscriberCount(OP_TRUE_SCRIPT_HASH)).toBe(1);

			await unsub();
			expect(node.subscriptions.getScriptHashSubscriberCount(OP_TRUE_SCRIPT_HASH)).toBe(0);
		});

		it("subscribe delivers notifications on state change", async () => {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);
			addSeedUtxo(node);

			const received: [string, string | null][] = [];
			await node.subscribe("blockchain.scripthash.subscribe", [OP_TRUE_SCRIPT_HASH], (data) =>
				received.push(data),
			);

			// Submit a tx — triggers status change notification
			const { rawHex } = buildRawTx("aa".repeat(32), 0, 10000n);
			node.submitTransaction(rawHex);

			expect(received.length).toBeGreaterThan(1);
			const notification = received[1];
			expect(notification?.[0]).toBe(OP_TRUE_SCRIPT_HASH);
			expect(typeof notification?.[1]).toBe("string");
		});

		it("unsubscribe via request", async () => {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);

			await node.subscribe("blockchain.scripthash.subscribe", [OP_TRUE_SCRIPT_HASH], () => {});
			expect(node.subscriptions.getScriptHashSubscriberCount(OP_TRUE_SCRIPT_HASH)).toBe(1);

			const result = await node.request("blockchain.scripthash.unsubscribe", [OP_TRUE_SCRIPT_HASH]);
			expect(result).toBe(true);
		});
	});

	describe("broadcast via request", () => {
		it("broadcasts via the protocol handler", async () => {
			const node = createIndexer();
			node.setChainTip(200, 1700000000);
			addSeedUtxo(node);

			const { rawHex, expectedTxid } = buildRawTx("aa".repeat(32), 0, 10000n);
			const result = await node.request("blockchain.transaction.broadcast", [rawHex]);
			expect(result).toBe(expectedTxid);
		});
	});
});
