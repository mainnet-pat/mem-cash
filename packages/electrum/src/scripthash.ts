import type { TokenData } from "@mem-cash/types";
import {
	ERR_BAD_REQUEST,
	err,
	type HandlerResult,
	invalidParams,
	ok,
	type ProtocolContext,
	validateNonNegativeInt,
	validateScriptHash,
} from "./types.js";

/** blockchain.scripthash.get_balance */
export function getBalance(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const scriptHash = validateScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid scripthash");

	const balance = ctx.node.getBalance(scriptHash);
	return ok({
		confirmed: Number(balance.confirmed),
		unconfirmed: Number(balance.unconfirmed),
	});
}

/** blockchain.scripthash.get_history */
export function getHistory(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const scriptHash = validateScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid scripthash");

	let fromHeight: number | undefined;
	if (params[1] !== undefined && params[1] !== null) {
		const h = validateNonNegativeInt(params[1]);
		if (h === null) return invalidParams("Invalid from_height");
		fromHeight = h;
	}

	let toHeight: number | undefined;
	if (params[2] !== undefined && params[2] !== null) {
		if (typeof params[2] !== "number") return invalidParams("Invalid to_height");
		// Negative values (e.g. -1) mean "no upper bound"
		if (params[2] >= 0) toHeight = params[2];
	}

	const confirmed = ctx.node.getHistory(scriptHash, fromHeight, toHeight);
	// Include mempool only when no upper height bound is specified
	const mempool = toHeight === undefined ? ctx.node.getMempoolHistory(scriptHash) : [];

	const result = [];
	for (const entry of confirmed) {
		result.push({ tx_hash: entry.txHash, height: entry.height });
	}
	for (const entry of mempool) {
		const item: { tx_hash: string; height: number; fee?: number } = {
			tx_hash: entry.txHash,
			height: entry.height,
		};
		if (entry.fee !== undefined) {
			item.fee = Number(entry.fee);
		}
		result.push(item);
	}

	return ok(result);
}

/** blockchain.scripthash.get_mempool */
export function getMempool(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const scriptHash = validateScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid scripthash");

	const mempool = ctx.node.getMempoolHistory(scriptHash);

	const result = [];
	for (const entry of mempool) {
		const item: { tx_hash: string; height: number; fee?: number } = {
			tx_hash: entry.txHash,
			height: entry.height,
		};
		if (entry.fee !== undefined) {
			item.fee = Number(entry.fee);
		}
		result.push(item);
	}

	return ok(result);
}

/** Format token data for the protocol response. */
function formatTokenData(td: TokenData): {
	category: string;
	amount: string;
	nft?: { capability: string; commitment: string };
} {
	const result: {
		category: string;
		amount: string;
		nft?: { capability: string; commitment: string };
	} = {
		category: td.category,
		amount: td.amount.toString(),
	};
	if (td.nft) {
		result.nft = {
			capability: td.nft.capability,
			commitment: td.nft.commitment,
		};
	}
	return result;
}

/** blockchain.scripthash.listunspent */
export function listUnspent(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const scriptHash = validateScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid scripthash");

	const utxos = ctx.node.getUtxos(scriptHash);

	const result = [];
	for (const utxo of utxos) {
		const item: {
			tx_hash: string;
			tx_pos: number;
			height: number;
			value: number;
			token_data?: {
				category: string;
				amount: string;
				nft?: { capability: string; commitment: string };
			};
		} = {
			tx_hash: utxo.outpoint.txid,
			tx_pos: utxo.outpoint.vout,
			height: utxo.height,
			value: Number(utxo.satoshis),
		};
		if (utxo.tokenData) {
			item.token_data = formatTokenData(utxo.tokenData);
		}
		result.push(item);
	}

	return ok(result);
}

/** blockchain.scripthash.subscribe */
export function subscribe(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const scriptHash = validateScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid scripthash");

	const status = ctx.node.getScriptHashStatus(scriptHash);

	if (ctx.subscribeScriptHash) {
		ctx.subscribeScriptHash(scriptHash);
	}

	return ok(status);
}

/** blockchain.scripthash.unsubscribe */
export function unsubscribe(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const scriptHash = validateScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid scripthash");

	if (!ctx.unsubscribeScriptHash) {
		return err(ERR_BAD_REQUEST, "Subscriptions not supported");
	}

	const wasSubscribed = ctx.unsubscribeScriptHash(scriptHash);
	return ok(wasSubscribed);
}

/** blockchain.scripthash.get_first_use — first confirmed or mempool tx for this scripthash. */
export function getFirstUse(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const scriptHash = validateScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid scripthash");

	// Confirmed history is sorted by height ascending — first entry is first use
	const confirmed = ctx.node.getHistory(scriptHash);
	const firstConfirmed = confirmed[0];
	if (firstConfirmed) {
		const header = ctx.node.getHeader(firstConfirmed.height);
		return ok({
			block_hash: header?.hash ?? "0".repeat(64),
			height: firstConfirmed.height,
			tx_hash: firstConfirmed.txHash,
		});
	}

	// Fall back to mempool
	const mempool = ctx.node.getMempoolHistory(scriptHash);
	const firstMempool = mempool[0];
	if (firstMempool) {
		return ok({
			block_hash: "0".repeat(64),
			height: 0,
			tx_hash: firstMempool.txHash,
		});
	}

	return ok(null);
}

/** blockchain.scripthash.get_status (Fulcrum extension — like subscribe without registering) */
export function getStatus(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const scriptHash = validateScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid scripthash");

	const status = ctx.node.getScriptHashStatus(scriptHash);
	return ok(status);
}
