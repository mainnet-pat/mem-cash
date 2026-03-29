import type { Indexer } from "./indexer.js";
import type { Schema } from "./schema.js";

/**
 * Minimal Transport-compatible interface.
 *
 * This mirrors the rpckit Transport shape so that a Indexer instance
 * can be used as a drop-in replacement for a WebSocket/TCP transport
 * in consumers like ElectrumNetworkProvider.
 */
export interface IndexerTransport<S extends Schema> {
	readonly url: string;
	connect(): Promise<void>;
	close(): Promise<void>;
	request: Indexer<S>["request"];
	subscribe: Indexer<S>["subscribe"];
}

/**
 * Wrap a Indexer instance as a Transport-compatible object.
 *
 * The returned object has the same `request` / `subscribe` methods
 * plus no-op `connect()` / `close()` and a synthetic `url`.
 */
export function asTransport<S extends Schema>(mc: Indexer<S>): IndexerTransport<S> {
	return {
		url: "mem-cash://local",
		async connect() {},
		async close() {},
		request: mc.request,
		subscribe: mc.subscribe,
	};
}
