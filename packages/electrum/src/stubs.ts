import { ERR_BAD_REQUEST, err, type HandlerResult, type ProtocolContext } from "./types.js";

/** Stub handler for methods that are not supported in Phase 1. */
function notSupported(
	method: string,
): (_ctx: ProtocolContext, _params: unknown[]) => HandlerResult {
	return () => err(ERR_BAD_REQUEST, `${method} is not supported`);
}

/** blockchain.rpa.get_history — not supported (Reusable Payment Address protocol). */
export const rpaGetHistory = notSupported("blockchain.rpa.get_history");

/** blockchain.rpa.get_mempool — not supported. */
export const rpaGetMempool = notSupported("blockchain.rpa.get_mempool");

/** blockchain.reusable.get_history — not supported (legacy RPA alias). */
export const reusableGetHistory = notSupported("blockchain.reusable.get_history");

/** blockchain.reusable.get_mempool — not supported (legacy RPA alias). */
export const reusableGetMempool = notSupported("blockchain.reusable.get_mempool");

/** daemon.passthrough — not supported (requires bitcoind connection). */
export const daemonPassthrough = notSupported("daemon.passthrough");
