import { binToHex, cashAddressToLockingBytecode, sha256 } from "@bitauth/libauth";
import * as scripthashHandlers from "./scripthash.js";
import type { HandlerResult, ProtocolContext } from "./types.js";
import { invalidParams } from "./types.js";

/** Decode a cash address to its scripthash. Returns null on failure. */
function addressToScriptHash(address: string): string | null {
	const result = cashAddressToLockingBytecode(address);
	if (typeof result === "string") return null;
	return binToHex(sha256.hash(result.bytecode));
}

/**
 * Rewrite params[0] from address to scripthash, then delegate to a
 * scripthash handler. The response is identical — Fulcrum's address.*
 * methods return the same shapes as scripthash.* methods.
 */
function withScriptHash(
	handler: (ctx: ProtocolContext, params: unknown[]) => HandlerResult,
): (ctx: ProtocolContext, params: unknown[]) => HandlerResult {
	return (ctx, params) => {
		if (typeof params[0] !== "string") return invalidParams("Invalid address");
		const scriptHash = addressToScriptHash(params[0]);
		if (scriptHash === null) return invalidParams("Invalid address");
		return handler(ctx, [scriptHash, ...params.slice(1)]);
	};
}

/** blockchain.address.get_balance */
export const addressGetBalance = withScriptHash(scripthashHandlers.getBalance);

/** blockchain.address.get_history */
export const addressGetHistory = withScriptHash(scripthashHandlers.getHistory);

/** blockchain.address.get_mempool */
export const addressGetMempool = withScriptHash(scripthashHandlers.getMempool);

/** blockchain.address.listunspent */
export const addressListUnspent = withScriptHash(scripthashHandlers.listUnspent);

/** blockchain.address.subscribe — delegates to scripthash.subscribe. */
export const addressSubscribe = withScriptHash(scripthashHandlers.subscribe);

/** blockchain.address.unsubscribe */
export const addressUnsubscribe = withScriptHash(scripthashHandlers.unsubscribe);

/** blockchain.address.get_status */
export const addressGetStatus = withScriptHash(scripthashHandlers.getStatus);

/** blockchain.address.get_first_use */
export const addressGetFirstUse = withScriptHash(scripthashHandlers.getFirstUse);

/** blockchain.address.get_scripthash */
export function addressGetScripthash(_ctx: ProtocolContext, params: unknown[]): HandlerResult {
	if (typeof params[0] !== "string") return invalidParams("Invalid address");
	const scriptHash = addressToScriptHash(params[0]);
	if (scriptHash === null) return invalidParams("Invalid address");
	return { result: scriptHash };
}
