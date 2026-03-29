import { makeOutpointKey } from "@mem-cash/types";
import {
	type HandlerResult,
	invalidParams,
	ok,
	type ProtocolContext,
	validateTxid,
} from "./types.js";

/** blockchain.utxo.get_info */
export function getInfo(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txHash = validateTxid(params[0]);
	if (txHash === null) return invalidParams("Invalid tx hash");

	const outN = params[1];
	if (typeof outN !== "number" || !Number.isInteger(outN) || outN < 0) {
		return invalidParams("Invalid output index");
	}

	const key = makeOutpointKey(txHash, outN);

	// Check confirmed UTXOs first, then mempool
	const utxo = ctx.node.getUtxoByOutpoint(key) ?? ctx.node.getMempoolUtxo(key);
	if (!utxo) return ok(null);

	const result: {
		scripthash: string;
		value: number;
		confirmed_height?: number;
		token_data?: {
			category: string;
			amount: string;
			nft?: { capability: string; commitment: string };
		};
	} = {
		scripthash: utxo.scriptHash,
		value: Number(utxo.satoshis),
	};

	if (utxo.height > 0) {
		result.confirmed_height = utxo.height;
	}

	if (utxo.tokenData) {
		const td: NonNullable<(typeof result)["token_data"]> = {
			category: utxo.tokenData.category,
			amount: utxo.tokenData.amount.toString(),
		};
		if (utxo.tokenData.nft) {
			td.nft = {
				capability: utxo.tokenData.nft.capability,
				commitment: utxo.tokenData.nft.commitment,
			};
		}
		result.token_data = td;
	}

	return ok(result);
}
