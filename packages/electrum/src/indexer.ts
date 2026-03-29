import { binToHex, cashAddressToLockingBytecode, sha256 } from "@bitauth/libauth";
import type { Node, NodeConfig, Notification } from "@mem-cash/core";
import { createNode } from "@mem-cash/core";
import type { ScriptHash } from "@mem-cash/types";
import { createDispatch } from "./dispatch.js";
import type {
	ElectrumCashTestSchema,
	ExtractParams,
	ExtractRequestMethod,
	ExtractReturn,
	ExtractSubscriptionMethod,
	Schema,
} from "./schema.js";
import { createTestHandlers } from "./test.js";
import type { DsproofData, Handler, ProtocolContext } from "./types.js";
import { formatHeaderResponse } from "./types.js";

/** BCH mainnet genesis hash. */
const BCH_GENESIS_HASH = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";

/** Function that tears down a subscription. */
export type Unsubscribe = () => Promise<void>;

/** Configuration for the Indexer Electrum instance. */
export interface IndexerConfig extends NodeConfig {
	/** Server version string (default: "mem-cash/0.1"). */
	readonly serverVersion?: string;
	/** Genesis hash (default: BCH mainnet). */
	readonly genesisHash?: string;
	/** CashAddress prefix for address encoding (default: "bitcoincash"). */
	readonly addressPrefix?: string;
	/** Server banner text. */
	readonly banner?: string;
	/** Server donation address. */
	readonly donationAddress?: string;
	/** Disable test.* RPC handlers. Set to true to exclude them (e.g. in production). */
	readonly disableTestHandlers?: boolean;
}

/** A core Node wrapped with Electrum RPC dispatch. */
export interface Indexer<S extends Schema = ElectrumCashTestSchema> extends Node {
	/**
	 * Dispatch an Electrum RPC method.
	 * Params can be a positional array or a named-parameter object.
	 * Returns the unwrapped result; throws on RPC error.
	 */
	readonly request: <M extends ExtractRequestMethod<S>>(
		method: M,
		params?: ExtractParams<S, M>,
	) => Promise<ExtractReturn<S, M>>;

	/**
	 * Subscribe to an Electrum method. The callback receives the initial
	 * result immediately and subsequent notifications as they occur.
	 * Returns an unsubscribe function.
	 */
	readonly subscribe: <M extends ExtractSubscriptionMethod<S>>(
		method: M,
		params: ExtractParams<S, M>,
		callback: (data: ExtractReturn<S, M>) => void,
	) => Promise<Unsubscribe>;
}

/**
 * Create a Indexer instance: a core Node with Electrum RPC dispatch.
 *
 * All `test.*` RPC methods are available via `request()`.
 * Core node methods (`submitTransaction`, `mine`, etc.) are available directly.
 */
export function createIndexer(config?: IndexerConfig): Indexer {
	const node = createNode(config);

	const enableTest = config?.disableTestHandlers !== true;
	const testHandlers = enableTest
		? new Map(createTestHandlers(node.storage))
		: new Map<string, Handler>();

	const serverVersion = config?.serverVersion ?? "mem-cash/0.1";
	const genesisHash = config?.genesisHash ?? BCH_GENESIS_HASH;

	// Notification routing: per-scripthash, header, transaction, and dsproof callback sets
	const scriptHashCallbacks = new Map<ScriptHash, Set<(data: unknown) => void>>();
	const headerCallbacks = new Set<(data: unknown) => void>();
	const txCallbacks = new Map<string, Set<(data: unknown) => void>>();
	const dsproofCallbacks = new Map<string, Set<(data: unknown) => void>>();

	// In-memory dsproof store (populated by test.add_dsproof)
	const dsproofs = new Map<string, DsproofData>();

	function getDsproof(txid: string): DsproofData | null {
		return dsproofs.get(txid) ?? null;
	}

	function notifyTxSubscriptions(): void {
		if (txCallbacks.size === 0) return;
		const tip = node.getTip();
		for (const [txHash, cbs] of txCallbacks) {
			const record = node.getTx(txHash);
			const memTx = node.getMempoolTx(txHash);
			let confirmations: number | null = null;
			if (record && record.height > 0 && tip) {
				confirmations = tip.height - record.height + 1;
			} else if (record || memTx) {
				confirmations = 0;
			}
			if (confirmations !== null) {
				for (const cb of cbs) cb([txHash, confirmations]);
			}
		}
	}

	function onNotification(notification: Notification): void {
		if (notification.type === "scripthash") {
			const cbs = scriptHashCallbacks.get(notification.scriptHash);
			if (cbs) {
				for (const cb of cbs) {
					cb([notification.scriptHash, notification.status]);
				}
			}
		} else {
			for (const cb of headerCallbacks) {
				cb([formatHeaderResponse(notification.header)]);
			}
		}
		notifyTxSubscriptions();
	}

	const consumerId = node.subscriptions.addConsumer(onNotification);
	const hooks = node.subscriptions.hooksForConsumer(consumerId);

	// Register test.add_dsproof handler — stores a dsproof and notifies subscribers
	if (enableTest) {
		testHandlers.set("test.add_dsproof", (_ctx, params) => {
			if (params.length < 2) {
				return { error: { code: -32602, message: "Expected [txid, dsproof]" } };
			}
			const txid = params[0] as string;
			const dsproof = params[1] as DsproofData;
			dsproofs.set(txid, dsproof);

			const cbs = dsproofCallbacks.get(txid);
			if (cbs) {
				for (const cb of cbs) cb([txid, dsproof]);
			}
			return { result: true };
		});
	}

	// Build dispatch with test handlers only if enabled
	const fullDispatch = createDispatch(enableTest ? testHandlers : undefined);

	const ctx: ProtocolContext = {
		node,
		serverVersion,
		protocolMin: "1.6",
		protocolMax: "1.6",
		genesisHash,
		hashFunction: "sha256",
		getDsproof,
		listDsproofs: () => [...dsproofs.keys()],
		...hooks,
		...(config?.addressPrefix ? { addressPrefix: config.addressPrefix } : {}),
		...(config?.banner ? { banner: config.banner } : {}),
		...(config?.donationAddress ? { donationAddress: config.donationAddress } : {}),
	};

	function toArray(params?: unknown[] | Record<string, unknown>): unknown[] {
		if (params === undefined) return [];
		if (Array.isArray(params)) return params;
		return Object.values(params);
	}

	async function request(method: string, params?: unknown[] | Record<string, unknown>) {
		const handlerResult = await fullDispatch(ctx, method, toArray(params));
		if ("error" in handlerResult) {
			const e = new Error(handlerResult.error.message);
			(e as unknown as { code: number }).code = handlerResult.error.code;
			throw e;
		}
		return handlerResult.result;
	}

	async function subscribe(
		method: string,
		params: unknown[] | Record<string, unknown>,
		callback: (data: unknown) => void,
	): Promise<Unsubscribe> {
		const paramsArray = toArray(params);
		const handlerResult = await fullDispatch(ctx, method, paramsArray);

		if ("error" in handlerResult) {
			throw new Error(handlerResult.error.message);
		}

		if (method === "blockchain.scripthash.subscribe") {
			const scriptHash = paramsArray[0] as ScriptHash;
			let cbs = scriptHashCallbacks.get(scriptHash);
			if (!cbs) {
				cbs = new Set();
				scriptHashCallbacks.set(scriptHash, cbs);
			}
			cbs.add(callback);
			callback([scriptHash, handlerResult.result]);

			return async () => {
				cbs.delete(callback);
				if (cbs.size === 0) scriptHashCallbacks.delete(scriptHash);
				await fullDispatch(ctx, "blockchain.scripthash.unsubscribe", [scriptHash]);
			};
		}

		if (method === "blockchain.address.subscribe") {
			const address = paramsArray[0] as string;
			// The address handler delegates to scripthash.subscribe internally,
			// so the subscription manager already tracks the scripthash.
			// We register a callback that maps scripthash notifications to [address, status].
			const decoded = cashAddressToLockingBytecode(address);
			if (typeof decoded === "string") throw new Error(`Invalid address: ${decoded}`);
			const scriptHash = binToHex(sha256.hash(decoded.bytecode)) as ScriptHash;

			const wrappedCb = (data: unknown) => {
				const [, status] = data as [string, string | null];
				callback([address, status]);
			};
			let cbs = scriptHashCallbacks.get(scriptHash);
			if (!cbs) {
				cbs = new Set();
				scriptHashCallbacks.set(scriptHash, cbs);
			}
			cbs.add(wrappedCb);
			// Deliver initial [address, status]
			callback([address, handlerResult.result]);

			return async () => {
				cbs.delete(wrappedCb);
				if (cbs.size === 0) scriptHashCallbacks.delete(scriptHash);
				await fullDispatch(ctx, "blockchain.address.unsubscribe", [address]);
			};
		}

		if (method === "blockchain.headers.subscribe") {
			headerCallbacks.add(callback);
			callback([handlerResult.result]);

			return async () => {
				headerCallbacks.delete(callback);
				// Only unsubscribe from the protocol when no callbacks remain,
				// so that other active header watchers keep receiving notifications.
				if (headerCallbacks.size === 0) {
					await fullDispatch(ctx, "blockchain.headers.unsubscribe", []);
				}
			};
		}

		if (method === "blockchain.transaction.subscribe") {
			const txHash = paramsArray[0] as string;
			let cbs = txCallbacks.get(txHash);
			if (!cbs) {
				cbs = new Set();
				txCallbacks.set(txHash, cbs);
			}
			cbs.add(callback);
			callback(handlerResult.result);

			return async () => {
				cbs.delete(callback);
				if (cbs.size === 0) txCallbacks.delete(txHash);
			};
		}

		if (method === "blockchain.transaction.dsproof.subscribe") {
			const txHash = paramsArray[0] as string;
			let cbs = dsproofCallbacks.get(txHash);
			if (!cbs) {
				cbs = new Set();
				dsproofCallbacks.set(txHash, cbs);
			}
			cbs.add(callback);
			// Deliver initial status from handler result
			callback(handlerResult.result);

			return async () => {
				cbs.delete(callback);
				if (cbs.size === 0) dsproofCallbacks.delete(txHash);
			};
		}

		throw new Error(`Method ${method} does not support subscriptions`);
	}

	return { ...node, request, subscribe } as Indexer;
}
