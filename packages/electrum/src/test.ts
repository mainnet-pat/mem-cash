import {
	binToHex,
	cashAddressToLockingBytecode,
	encodeTransactionBch,
	hexToBin,
	sha256,
	utf8ToBin,
} from "@bitauth/libauth";
import type { TestableStorage } from "@mem-cash/storage";
import type { TokenData } from "@mem-cash/types";
import type { Handler, HandlerResult } from "./types.js";
import { invalidParams, ok } from "./types.js";

/**
 * Create test.* protocol handlers for development and testing.
 * These handlers provide direct manipulation of chain state via RPC.
 */
export function createTestHandlers(storage: TestableStorage): ReadonlyMap<string, Handler> {
	const handlers = new Map<string, Handler>();

	// Counter for synthetic coinbase transactions (ensures unique txids).
	let syntheticCounter = 0;

	// test.set_chain_tip [height, timestamp]
	// Adds 11 headers with the given timestamp to set both tip and MTP.
	handlers.set("test.set_chain_tip", (_ctx, params): HandlerResult => {
		if (params.length < 2) return invalidParams("Expected [height, timestamp]");
		const height = params[0];
		const timestamp = params[1];
		if (typeof height !== "number" || !Number.isInteger(height) || height < 0) {
			return invalidParams("height must be a non-negative integer");
		}
		if (typeof timestamp !== "number" || !Number.isInteger(timestamp) || timestamp < 0) {
			return invalidParams("timestamp must be a non-negative integer");
		}

		const startHeight = Math.max(0, height - 10);
		for (let h = startHeight; h <= height; h++) {
			const hash = h.toString(16).padStart(64, "0");
			storage._test.header.add({
				hash,
				height: h,
				timestamp,
			});
		}
		return ok(true);
	});

	// test.add_utxo [address, utxo]
	// Builds a synthetic transaction, derives the real txid, and stores the
	// UTXO together with its history entry and raw transaction record.
	// Returns { txid } — the derived txid backed by the synthetic raw tx.
	handlers.set("test.add_utxo", (ctx, params): HandlerResult => {
		if (params.length < 2) {
			return invalidParams("Expected [address, utxo]");
		}
		const address = params[0];
		const utxoParam = params[1];

		if (typeof address !== "string") {
			return invalidParams("address must be a string");
		}
		if (typeof utxoParam !== "object" || utxoParam === null) {
			return invalidParams("utxo must be an object");
		}

		const utxo = utxoParam as {
			vout?: number;
			satoshis: number | bigint | string;
			height?: number;
			token?: {
				category: string;
				amount: number | bigint | string;
				nft?: { commitment: string; capability: string };
			};
		};

		const vout = utxo.vout ?? 0;
		const satoshis = BigInt(utxo.satoshis);
		const height = utxo.height ?? 100;

		// Decode address → locking bytecode + scripthash
		const decoded = cashAddressToLockingBytecode(address);
		if (typeof decoded === "string") {
			return invalidParams(`Invalid address: ${decoded}`);
		}
		const { bytecode } = decoded;
		const scriptHash = binToHex(sha256.hash(bytecode));

		// Parse token data
		let tokenData: TokenData | undefined;
		let libTokenData: LibToken | undefined;
		if (utxo.token) {
			const result: { category: string; amount: bigint; nft?: TokenData["nft"] } = {
				category: utxo.token.category,
				amount: BigInt(utxo.token.amount),
			};
			if (utxo.token.nft) {
				result.nft = {
					commitment: utxo.token.nft.commitment,
					capability: utxo.token.nft.capability as "none" | "mutable" | "minting",
				};
			}
			tokenData = result as TokenData;
			libTokenData = {
				category: hexToBin(utxo.token.category),
				amount: BigInt(utxo.token.amount),
			};
			if (utxo.token.nft) {
				libTokenData.nft = {
					capability: utxo.token.nft.capability as "none" | "minting" | "mutable",
					commitment: hexToBin(utxo.token.nft.commitment),
				};
			}
		}

		// Build synthetic transaction and derive txid
		const rawHex = buildSyntheticUtxoTx(bytecode, satoshis, vout, syntheticCounter++, libTokenData);
		const txid = deriveTxid(rawHex);

		// Store UTXO
		storage._test.utxo.add(
			Object.assign(
				{ txid, vout, satoshis, scriptHash, height, lockingBytecode: bytecode },
				tokenData !== undefined ? { tokenData } : {},
			),
		);

		// Add history entry and transaction record
		storage._test.history.add({ scriptHash, entries: [{ txHash: txid, height }] });
		storage._test.tx.add({ txid, height, rawHex });

		// Notify subscribers
		ctx.node.subscriptions.notifyChanges(new Set([scriptHash]));

		return ok({ txid });
	});

	// test.remove_utxo [txid, vout]
	handlers.set("test.remove_utxo", (_ctx, params): HandlerResult => {
		if (params.length < 2) return invalidParams("Expected [txid, vout]");
		const txid = params[0];
		const vout = params[1];
		if (typeof txid !== "string" || txid.length !== 64) {
			return invalidParams("txid must be 64-char hex");
		}
		if (typeof vout !== "number" || !Number.isInteger(vout) || vout < 0) {
			return invalidParams("vout must be a non-negative integer");
		}
		storage._test.utxo.remove({ txid, vout });
		return ok(true);
	});

	// test.add_header [hash, height, timestamp, version?, prevHash?, merkleRoot?, bits?, nonce?]
	handlers.set("test.add_header", (_ctx, params): HandlerResult => {
		if (params.length < 3) {
			return invalidParams("Expected [hash, height, timestamp, ...]");
		}
		const hash = params[0];
		const height = params[1];
		const timestamp = params[2];
		if (typeof hash !== "string" || hash.length !== 64) {
			return invalidParams("hash must be 64-char hex");
		}
		if (typeof height !== "number" || !Number.isInteger(height) || height < 0) {
			return invalidParams("height must be a non-negative integer");
		}
		if (typeof timestamp !== "number" || !Number.isInteger(timestamp) || timestamp < 0) {
			return invalidParams("timestamp must be a non-negative integer");
		}
		storage._test.header.add({
			hash,
			height,
			timestamp,
		});
		return ok(true);
	});

	// test.mine [address, blocks?]
	// Mines block(s) with a coinbase reward locked to the given address.
	// Returns { height, coinbaseTxids }.
	handlers.set("test.mine", (ctx, params): HandlerResult => {
		if (params.length < 1) return invalidParams("Expected [address, blocks?]");
		const address = params[0];
		const blocks = params[1] ?? 1;
		if (typeof address !== "string") {
			return invalidParams("address must be a string");
		}
		if (typeof blocks !== "number" || !Number.isInteger(blocks) || blocks < 1) {
			return invalidParams("blocks must be a positive integer");
		}
		if (blocks > 1000) {
			return invalidParams("blocks must not exceed 1000");
		}

		const decoded = cashAddressToLockingBytecode(address);
		if (typeof decoded === "string") {
			return invalidParams(`Invalid address: ${decoded}`);
		}
		const { bytecode } = decoded;
		const scriptHash = binToHex(sha256.hash(bytecode));

		const COINBASE_REWARD = 5_000_000_000n; // 50 BCH
		const coinbaseTxids: string[] = [];
		let height = 0;

		for (let i = 0; i < blocks; i++) {
			const result = ctx.node.mine();
			height = result.height;

			// Build a synthetic coinbase transaction
			const rawHex = buildSyntheticUtxoTx(bytecode, COINBASE_REWARD, 0, syntheticCounter++);
			const txid = deriveTxid(rawHex);
			coinbaseTxids.push(txid);

			// Store UTXO, history, and transaction record
			storage._test.utxo.add({
				txid,
				vout: 0,
				satoshis: COINBASE_REWARD,
				scriptHash,
				height,
				lockingBytecode: bytecode,
				isCoinbase: true,
			});
			storage._test.history.add({
				scriptHash,
				entries: [{ txHash: txid, height }],
			});
			storage._test.tx.add({ txid, height, rawHex });

			// Notify subscribers
			ctx.node.subscriptions.notifyChanges(new Set([scriptHash]));
		}

		return ok({ height, coinbaseTxids });
	});

	// test.debugTransaction [rawHex]
	// Runs full validation with per-input debug traces, without accepting to mempool.
	// Returns the DebugResult (success with inputResults, or failure with error + partial traces).
	handlers.set("test.debugTransaction", (ctx, params): HandlerResult => {
		if (params.length < 1 || typeof params[0] !== "string") {
			return invalidParams("Expected [rawHex]");
		}
		const rawHex = params[0];
		const result = ctx.node.debugTransaction(rawHex);
		return ok(result);
	});

	// test.reset []
	handlers.set("test.reset", (_ctx, _params): HandlerResult => {
		storage._test.reset();
		return ok(true);
	});

	return handlers;
}

type LibToken = {
	category: Uint8Array;
	amount: bigint;
	nft?: { capability: "none" | "minting" | "mutable"; commitment: Uint8Array };
};
type TxOutput = { lockingBytecode: Uint8Array; valueSatoshis: bigint; token?: LibToken };

/** Build a synthetic coinbase-style transaction with padding outputs up to vout. */
function buildSyntheticUtxoTx(
	lockingBytecode: Uint8Array,
	satoshis: bigint,
	vout: number,
	counter: number,
	tokenData?: LibToken,
): string {
	const outputs: TxOutput[] = [];
	for (let i = 0; i < vout; i++) {
		outputs.push({ lockingBytecode: new Uint8Array(0), valueSatoshis: 0n });
	}
	const output: TxOutput = { lockingBytecode, valueSatoshis: satoshis };
	if (tokenData) {
		output.token = tokenData;
	}
	outputs.push(output);

	const coinbaseScript = utf8ToBin(`mock-${counter}`);
	return binToHex(
		encodeTransactionBch({
			version: 2,
			inputs: [
				{
					outpointTransactionHash: new Uint8Array(32),
					outpointIndex: 0xffffffff,
					unlockingBytecode: coinbaseScript,
					sequenceNumber: 0xffffffff,
				},
			],
			outputs,
			locktime: 0,
		}),
	);
}

/** Derive a txid from raw transaction hex (double SHA-256, reversed). */
function deriveTxid(rawHex: string): string {
	return binToHex(sha256.hash(sha256.hash(hexToBin(rawHex))).reverse());
}
