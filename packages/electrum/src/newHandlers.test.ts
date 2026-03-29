import type { Node } from "@mem-cash/core";
import { createNode } from "@mem-cash/core";
import { beforeEach, describe, expect, it } from "vitest";
import { addressGetFirstUse, addressGetStatus } from "./address.js";
import * as mempoolHandlers from "./mempool.js";
import { getFirstUse } from "./scripthash.js";
import { addPeer, banner, donationAddress, peersSubscribe } from "./server.js";
import * as stubHandlers from "./stubs.js";
import { dsproofGet, dsproofList, getConfirmedBlockhash, getHeight } from "./transaction.js";
import type { DsproofData, ProtocolContext } from "./types.js";
import { getInfo as utxoGetInfo } from "./utxo.js";

const tid = (c: string) => c.repeat(32).slice(0, 64);
const sh = (c: string) => c.repeat(32).slice(0, 64);

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

describe("server.banner / server.donation_address", () => {
	it("returns empty string by default", () => {
		const ctx = makeCtx(createNode());
		expect(banner(ctx, [])).toEqual({ result: "" });
		expect(donationAddress(ctx, [])).toEqual({ result: "" });
	});

	it("returns configured values", () => {
		const ctx = makeCtx(createNode(), {
			banner: "Welcome to test server",
			donationAddress: "bitcoincash:qtest",
		});
		expect(banner(ctx, [])).toEqual({ result: "Welcome to test server" });
		expect(donationAddress(ctx, [])).toEqual({ result: "bitcoincash:qtest" });
	});
});

describe("server.add_peer / server.peers.subscribe stubs", () => {
	it("add_peer returns false", () => {
		expect(addPeer(makeCtx(createNode()), [{}])).toEqual({ result: false });
	});

	it("peers.subscribe returns empty array", () => {
		expect(peersSubscribe(makeCtx(createNode()), [])).toEqual({ result: [] });
	});
});

describe("blockchain.scripthash.get_first_use", () => {
	let node: Node;
	let ctx: ProtocolContext;

	beforeEach(() => {
		node = createNode();
		ctx = makeCtx(node);
	});

	it("returns null for unknown scripthash", () => {
		expect(getFirstUse(ctx, [sh("ab")])).toEqual({ result: null });
	});

	it("returns first confirmed history entry", () => {
		const scriptHash = sh("ab");
		node.storage._test.history.add({
			scriptHash,
			entries: [
				{ txHash: tid("bb"), height: 5 },
				{ txHash: tid("aa"), height: 3 },
			],
		});
		node.storage._test.header.add({ hash: tid("cc"), height: 3, timestamp: 1000 });

		const r = getFirstUse(ctx, [scriptHash]) as { result: Record<string, unknown> };
		expect(r.result.height).toBe(3);
		expect(r.result.tx_hash).toBe(tid("aa"));
		expect(r.result.block_hash).toBe(tid("cc"));
	});

	it("returns mempool entry when no confirmed history", () => {
		const scriptHash = sh("ab");
		// Add a mempool tx via the test helper — need inputs/outputs
		node.storage._test.utxo.add({
			txid: tid("cc"),
			vout: 0,
			satoshis: 5000n,
			scriptHash,
			height: 1,
		});
		node.storage._test.mempool.add({
			txid: tid("dd"),
			fee: 100n,
			size: 200,
			inputs: [{ txid: tid("cc"), vout: 0 }],
			outputs: [{ satoshis: 4900n, scriptHash }],
		});

		const r = getFirstUse(ctx, [scriptHash]) as { result: Record<string, unknown> };
		expect(r.result.height).toBe(0);
		expect(r.result.tx_hash).toBe(tid("dd"));
		expect(r.result.block_hash).toBe("0".repeat(64));
	});

	it("rejects invalid scripthash", () => {
		expect(getFirstUse(ctx, ["not-a-hash"])).toHaveProperty("error");
	});
});

describe("blockchain.address.get_status / get_first_use", () => {
	it("get_status rejects invalid address", () => {
		expect(addressGetStatus(makeCtx(createNode()), ["bad"])).toHaveProperty("error");
	});

	it("get_first_use rejects invalid address", () => {
		expect(addressGetFirstUse(makeCtx(createNode()), ["bad"])).toHaveProperty("error");
	});
});

describe("blockchain.transaction.get_height", () => {
	let node: Node;
	let ctx: ProtocolContext;

	beforeEach(() => {
		node = createNode();
		ctx = makeCtx(node);
	});

	it("returns height for confirmed tx", () => {
		node.storage._test.tx.add({ txid: tid("aa"), height: 42 });
		expect(getHeight(ctx, [tid("aa")])).toEqual({ result: 42 });
	});

	it("returns 0 for mempool tx", () => {
		// Add a confirmed UTXO to spend
		node.storage._test.utxo.add({
			txid: tid("cc"),
			vout: 0,
			satoshis: 5000n,
			scriptHash: sh("dd"),
			height: 1,
		});
		node.storage._test.mempool.add({
			txid: tid("bb"),
			fee: 100n,
			size: 200,
			inputs: [{ txid: tid("cc"), vout: 0 }],
			outputs: [{ satoshis: 4900n, scriptHash: sh("dd") }],
		});
		expect(getHeight(ctx, [tid("bb")])).toEqual({ result: 0 });
	});

	it("returns null for unknown tx", () => {
		expect(getHeight(ctx, [tid("ff")])).toEqual({ result: null });
	});

	it("rejects invalid txid", () => {
		expect(getHeight(ctx, ["bad"])).toHaveProperty("error");
	});
});

describe("blockchain.transaction.get_confirmed_blockhash", () => {
	let node: Node;
	let ctx: ProtocolContext;

	beforeEach(() => {
		node = createNode();
		ctx = makeCtx(node);
	});

	it("returns block hash for confirmed tx", () => {
		node.storage._test.tx.add({ txid: tid("aa"), height: 10 });
		node.storage._test.header.add({ hash: tid("bb"), height: 10, timestamp: 1000 });

		const r = getConfirmedBlockhash(ctx, [tid("aa")]) as { result: Record<string, unknown> };
		expect(r.result.block_hash).toBe(tid("bb"));
		expect(r.result.block_height).toBe(10);
	});

	it("includes header when requested", () => {
		node.storage._test.tx.add({ txid: tid("aa"), height: 10 });
		node.storage._test.header.add({
			hash: tid("bb"),
			height: 10,
			timestamp: 1000,
			hex: "deadbeef",
		});

		const r = getConfirmedBlockhash(ctx, [tid("aa"), true]) as {
			result: Record<string, unknown>;
		};
		expect(r.result.block_header).toBe("deadbeef");
	});

	it("errors for unconfirmed tx", () => {
		node.storage._test.tx.add({ txid: tid("aa"), height: 0 });
		expect(getConfirmedBlockhash(ctx, [tid("aa")])).toHaveProperty("error");
	});

	it("errors for unknown tx", () => {
		expect(getConfirmedBlockhash(ctx, [tid("ff")])).toHaveProperty("error");
	});
});

describe("blockchain.transaction.dsproof.get / dsproof.list", () => {
	const dsp: DsproofData = {
		dspid: tid("dd"),
		txid: tid("aa"),
		hex: "cafe",
		outpoint: { txid: tid("bb"), vout: 0 },
		descendants: [tid("cc")],
	};

	it("get returns dsproof when present", () => {
		const ctx = makeCtx(createNode(), { getDsproof: (txid) => (txid === tid("aa") ? dsp : null) });
		expect(dsproofGet(ctx, [tid("aa")])).toEqual({ result: dsp });
	});

	it("get returns null when absent", () => {
		const ctx = makeCtx(createNode(), { getDsproof: () => null });
		expect(dsproofGet(ctx, [tid("ff")])).toEqual({ result: null });
	});

	it("get returns null without hook", () => {
		expect(dsproofGet(makeCtx(createNode()), [tid("aa")])).toEqual({ result: null });
	});

	it("list returns txids", () => {
		const ctx = makeCtx(createNode(), { listDsproofs: () => [tid("aa"), tid("bb")] });
		expect(dsproofList(ctx, [])).toEqual({ result: [tid("aa"), tid("bb")] });
	});

	it("list returns empty without hook", () => {
		expect(dsproofList(makeCtx(createNode()), [])).toEqual({ result: [] });
	});
});

describe("blockchain.utxo.get_info", () => {
	let node: Node;
	let ctx: ProtocolContext;

	beforeEach(() => {
		node = createNode();
		ctx = makeCtx(node);
	});

	it("returns confirmed UTXO info", () => {
		node.storage._test.utxo.add({
			txid: tid("aa"),
			vout: 0,
			satoshis: 5000n,
			scriptHash: sh("bb"),
			height: 10,
		});

		const r = utxoGetInfo(ctx, [tid("aa"), 0]) as { result: Record<string, unknown> };
		expect(r.result.scripthash).toBe(sh("bb"));
		expect(r.result.value).toBe(5000);
		expect(r.result.confirmed_height).toBe(10);
	});

	it("returns null for missing UTXO", () => {
		expect(utxoGetInfo(ctx, [tid("ff"), 0])).toEqual({ result: null });
	});

	it("rejects invalid params", () => {
		expect(utxoGetInfo(ctx, ["bad", 0])).toHaveProperty("error");
		expect(utxoGetInfo(ctx, [tid("aa"), -1])).toHaveProperty("error");
		expect(utxoGetInfo(ctx, [tid("aa"), "zero"])).toHaveProperty("error");
	});
});

describe("mempool.get_fee_histogram", () => {
	it("returns empty for empty mempool", () => {
		const ctx = makeCtx(createNode());
		expect(mempoolHandlers.getFeeHistogram(ctx, [])).toEqual({ result: [] });
	});

	it("returns histogram buckets", () => {
		const node = createNode();
		node.storage._test.utxo.add({
			txid: tid("cc"),
			vout: 0,
			satoshis: 10000n,
			scriptHash: sh("bb"),
			height: 1,
		});
		node.storage._test.mempool.add({
			txid: tid("aa"),
			fee: 200n,
			size: 200,
			inputs: [{ txid: tid("cc"), vout: 0 }],
			outputs: [{ satoshis: 9800n, scriptHash: sh("bb") }],
		});

		const r = mempoolHandlers.getFeeHistogram(makeCtx(node), []) as {
			result: [number, number][];
		};
		expect(r.result.length).toBeGreaterThan(0);
		// 200 sat / 200 bytes = 1 sat/byte → should land in the 1.0 bucket
		expect(r.result.some(([rate]) => rate <= 1)).toBe(true);
	});
});

describe("mempool.get_info", () => {
	it("returns relay fee defaults", () => {
		const r = mempoolHandlers.getInfo(makeCtx(createNode()), []) as {
			result: Record<string, number>;
		};
		expect(r.result.mempoolminfee).toBe(0.00001);
		expect(r.result.minrelaytxfee).toBe(0.00001);
	});

	it("uses custom relay fee", () => {
		const ctx = makeCtx(createNode(), { getRelayFee: () => 0.001 });
		const r = mempoolHandlers.getInfo(ctx, []) as { result: Record<string, number> };
		expect(r.result.mempoolminfee).toBe(0.001);
	});
});

describe("stub methods", () => {
	const ctx = makeCtx(createNode());

	it("rpa.get_history returns not supported error", () => {
		expect(stubHandlers.rpaGetHistory(ctx, [])).toHaveProperty("error");
	});

	it("rpa.get_mempool returns not supported error", () => {
		expect(stubHandlers.rpaGetMempool(ctx, [])).toHaveProperty("error");
	});

	it("reusable.get_history returns not supported error", () => {
		expect(stubHandlers.reusableGetHistory(ctx, [])).toHaveProperty("error");
	});

	it("daemon.passthrough returns not supported error", () => {
		expect(stubHandlers.daemonPassthrough(ctx, [])).toHaveProperty("error");
	});
});
