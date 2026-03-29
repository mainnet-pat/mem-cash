import * as addressHandlers from "./address.js";
import * as headersHandlers from "./headers.js";
import * as mempoolHandlers from "./mempool.js";
import * as scripthashHandlers from "./scripthash.js";
import * as serverHandlers from "./server.js";
import * as stubHandlers from "./stubs.js";
import * as transactionHandlers from "./transaction.js";
import type { Handler, HandlerResult, ProtocolContext } from "./types.js";
import { ERR_METHOD_NOT_FOUND, err } from "./types.js";
import * as utxoHandlers from "./utxo.js";

/** Registry of Electrum Cash protocol method handlers. */
const methodHandlers: ReadonlyMap<string, Handler> = new Map<string, Handler>([
	// blockchain.address.* (Fulcrum extension — delegates to scripthash handlers)
	["blockchain.address.get_balance", addressHandlers.addressGetBalance],
	["blockchain.address.get_first_use", addressHandlers.addressGetFirstUse],
	["blockchain.address.get_history", addressHandlers.addressGetHistory],
	["blockchain.address.get_mempool", addressHandlers.addressGetMempool],
	["blockchain.address.get_scripthash", addressHandlers.addressGetScripthash],
	["blockchain.address.get_status", addressHandlers.addressGetStatus],
	["blockchain.address.listunspent", addressHandlers.addressListUnspent],
	["blockchain.address.subscribe", addressHandlers.addressSubscribe],
	["blockchain.address.unsubscribe", addressHandlers.addressUnsubscribe],

	// blockchain.scripthash.*
	["blockchain.scripthash.get_balance", scripthashHandlers.getBalance],
	["blockchain.scripthash.get_first_use", scripthashHandlers.getFirstUse],
	["blockchain.scripthash.get_history", scripthashHandlers.getHistory],
	["blockchain.scripthash.get_mempool", scripthashHandlers.getMempool],
	["blockchain.scripthash.listunspent", scripthashHandlers.listUnspent],
	["blockchain.scripthash.subscribe", scripthashHandlers.subscribe],
	["blockchain.scripthash.unsubscribe", scripthashHandlers.unsubscribe],
	["blockchain.scripthash.get_status", scripthashHandlers.getStatus],

	// blockchain.headers.*
	["blockchain.header.get", headersHandlers.headerGet],
	["blockchain.headers.get_tip", headersHandlers.headersGetTip],
	["blockchain.headers.subscribe", headersHandlers.headersSubscribe],
	["blockchain.headers.unsubscribe", headersHandlers.headersUnsubscribe],

	// blockchain.block.*
	["blockchain.block.header", headersHandlers.blockHeader],
	["blockchain.block.headers", headersHandlers.blockHeaders],

	// blockchain.transaction.*
	["blockchain.transaction.broadcast", transactionHandlers.broadcast],
	["blockchain.transaction.broadcast_package", transactionHandlers.broadcastPackage],
	["blockchain.transaction.get", transactionHandlers.get],
	["blockchain.transaction.get_confirmed_blockhash", transactionHandlers.getConfirmedBlockhash],
	["blockchain.transaction.get_height", transactionHandlers.getHeight],
	["blockchain.transaction.get_merkle", transactionHandlers.getMerkle],
	["blockchain.transaction.id_from_pos", transactionHandlers.idFromPos],
	["blockchain.transaction.subscribe", transactionHandlers.txSubscribe],
	["blockchain.transaction.unsubscribe", transactionHandlers.txUnsubscribe],
	["blockchain.transaction.dsproof.get", transactionHandlers.dsproofGet],
	["blockchain.transaction.dsproof.list", transactionHandlers.dsproofList],
	["blockchain.transaction.dsproof.subscribe", transactionHandlers.dsproofSubscribe],
	["blockchain.transaction.dsproof.unsubscribe", transactionHandlers.dsproofUnsubscribe],

	// blockchain.utxo.*
	["blockchain.utxo.get_info", utxoHandlers.getInfo],

	// mempool.*
	["mempool.get_fee_histogram", mempoolHandlers.getFeeHistogram],
	["mempool.get_info", mempoolHandlers.getInfo],

	// server.*
	["server.add_peer", serverHandlers.addPeer],
	["server.banner", serverHandlers.banner],
	["server.donation_address", serverHandlers.donationAddress],
	["server.features", serverHandlers.features],
	["server.peers.subscribe", serverHandlers.peersSubscribe],
	["server.ping", serverHandlers.ping],
	["server.version", serverHandlers.version],

	// fee estimation
	["blockchain.estimatefee", serverHandlers.estimateFee],
	["blockchain.relayfee", serverHandlers.relayFee],

	// stubs (not supported in Phase 1)
	["blockchain.rpa.get_history", stubHandlers.rpaGetHistory],
	["blockchain.rpa.get_mempool", stubHandlers.rpaGetMempool],
	["blockchain.reusable.get_history", stubHandlers.reusableGetHistory],
	["blockchain.reusable.get_mempool", stubHandlers.reusableGetMempool],
	["daemon.passthrough", stubHandlers.daemonPassthrough],
]);

/**
 * Dispatch a JSON-RPC method call to the appropriate handler.
 *
 * @param ctx - Protocol context with storage, server info, and hooks
 * @param method - The JSON-RPC method name
 * @param params - The method parameters
 * @returns The handler result (success or error)
 */
export async function dispatch(
	ctx: ProtocolContext,
	method: string,
	params: unknown[],
): Promise<HandlerResult> {
	const handler = methodHandlers.get(method);
	if (!handler) {
		return err(ERR_METHOD_NOT_FOUND, `Unknown method: ${method}`);
	}
	return handler(ctx, params);
}

/** Get the list of all supported method names. */
export function getSupportedMethods(): string[] {
	return [...methodHandlers.keys()];
}

/**
 * Create a dispatch function with optional extra handlers merged on top of
 * the built-in protocol handlers.
 */
export function createDispatch(
	extraHandlers?: ReadonlyMap<string, Handler>,
): (ctx: ProtocolContext, method: string, params: unknown[]) => Promise<HandlerResult> {
	const handlers = extraHandlers ? new Map([...methodHandlers, ...extraHandlers]) : methodHandlers;
	return async (ctx, method, params) => {
		const handler = handlers.get(method);
		if (!handler) return err(ERR_METHOD_NOT_FOUND, `Unknown method: ${method}`);
		return handler(ctx, params);
	};
}
