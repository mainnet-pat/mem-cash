import type { BlockHeader, ScriptHash, StorageReader } from "@mem-cash/types";

/** Opaque consumer identifier. */
export type ConsumerId = number;

// --- Notification types ---

/** Notification sent when a scripthash status changes. */
export interface ScriptHashNotification {
	readonly type: "scripthash";
	readonly scriptHash: ScriptHash;
	readonly status: string | null;
}

/** Notification sent when a new block header arrives. */
export interface HeaderNotification {
	readonly type: "header";
	readonly header: BlockHeader;
}

/** Union of all notification types. */
export type Notification = ScriptHashNotification | HeaderNotification;

/** Callback invoked when a subscribed event fires. */
export type NotificationCallback = (notification: Notification) => void;

// --- Consumer hooks ---

/** Subscription hooks bound to a single consumer. */
export interface ConsumerHooks {
	readonly subscribeScriptHash: (scriptHash: ScriptHash) => void;
	readonly unsubscribeScriptHash: (scriptHash: ScriptHash) => boolean;
	readonly subscribeHeaders: () => void;
	readonly unsubscribeHeaders: () => boolean;
}

// --- Configuration ---

/** Optional configuration for the subscription manager. */
export interface SubscriptionManagerConfig {
	/** Maximum scripthash subscriptions per consumer. 0 = unlimited. */
	readonly maxSubscriptionsPerConsumer?: number;
}

// --- Manager interface ---

/** Manages scripthash and header subscriptions across multiple consumers. */
export interface SubscriptionManager {
	/**
	 * Register a new consumer with the given notification callback.
	 * Returns the consumer's unique ID.
	 */
	addConsumer(callback: NotificationCallback): ConsumerId;

	/** Remove a consumer and all its subscriptions. */
	removeConsumer(id: ConsumerId): void;

	/**
	 * Subscribe a consumer to a scripthash.
	 * Records the current status as baseline so notifications only fire on changes.
	 */
	subscribeScriptHash(consumerId: ConsumerId, scriptHash: ScriptHash): void;

	/** Unsubscribe a consumer from a scripthash. Returns true if was subscribed. */
	unsubscribeScriptHash(consumerId: ConsumerId, scriptHash: ScriptHash): boolean;

	/** Subscribe a consumer to header notifications. */
	subscribeHeaders(consumerId: ConsumerId): void;

	/** Unsubscribe a consumer from headers. Returns true if was subscribed. */
	unsubscribeHeaders(consumerId: ConsumerId): boolean;

	/**
	 * Process a set of affected scripthashes (e.g. after a block or mempool change).
	 * Recomputes status for each affected scripthash, compares with last-notified
	 * status per subscriber, and dispatches notifications for changes.
	 * Returns the number of notifications dispatched.
	 */
	notifyChanges(affectedScriptHashes: ReadonlySet<ScriptHash>): number;

	/**
	 * Notify all header subscribers of a new chain tip.
	 * Returns the number of notifications dispatched.
	 */
	notifyNewTip(header: BlockHeader): number;

	/** Generate subscription hooks bound to a specific consumer. */
	hooksForConsumer(consumerId: ConsumerId): ConsumerHooks;

	// --- Stats ---

	/** Number of consumers subscribed to a specific scripthash. */
	getScriptHashSubscriberCount(scriptHash: ScriptHash): number;

	/** Number of consumers subscribed to header notifications. */
	getHeaderSubscriberCount(): number;

	/** Number of scripthash subscriptions for a consumer. */
	getConsumerSubscriptionCount(consumerId: ConsumerId): number;

	/** Total number of registered consumers. */
	getConsumerCount(): number;

	/** Total number of unique scripthash subscriptions across all consumers. */
	getTotalSubscriptionCount(): number;
}

// --- Internal consumer state ---

interface ConsumerState {
	callback: NotificationCallback;
	scriptHashes: Set<ScriptHash>;
	headerSubscribed: boolean;
	/** Last status hash notified (or sent at subscribe time) per scripthash. */
	lastStatuses: Map<ScriptHash, string | null>;
}

// --- Factory ---

/**
 * Create a new subscription manager.
 *
 * @param storage - Read-only storage for status hash computation
 * @param config - Optional configuration
 */
export function createSubscriptionManager(
	storage: StorageReader,
	config?: SubscriptionManagerConfig,
): SubscriptionManager {
	let nextId = 1;
	const consumers = new Map<ConsumerId, ConsumerState>();
	const scriptHashSubs = new Map<ScriptHash, Set<ConsumerId>>();
	const headerSubs = new Set<ConsumerId>();
	const maxSubs = config?.maxSubscriptionsPerConsumer ?? 0;

	function addConsumer(callback: NotificationCallback): ConsumerId {
		const id = nextId++;
		consumers.set(id, {
			callback,
			scriptHashes: new Set(),
			headerSubscribed: false,
			lastStatuses: new Map(),
		});
		return id;
	}

	function removeConsumer(id: ConsumerId): void {
		const state = consumers.get(id);
		if (!state) return;

		// Remove from all scripthash subscriber sets
		for (const sh of state.scriptHashes) {
			const subs = scriptHashSubs.get(sh);
			if (subs) {
				subs.delete(id);
				if (subs.size === 0) scriptHashSubs.delete(sh);
			}
		}

		// Remove from header subscribers
		headerSubs.delete(id);

		consumers.delete(id);
	}

	function subscribeScriptHash(consumerId: ConsumerId, scriptHash: ScriptHash): void {
		const state = consumers.get(consumerId);
		if (!state) return;

		// Already subscribed — idempotent
		if (state.scriptHashes.has(scriptHash)) return;

		// Check subscription limit
		if (maxSubs > 0 && state.scriptHashes.size >= maxSubs) return;

		// Register
		state.scriptHashes.add(scriptHash);

		let subs = scriptHashSubs.get(scriptHash);
		if (!subs) {
			subs = new Set();
			scriptHashSubs.set(scriptHash, subs);
		}
		subs.add(consumerId);

		// Record baseline status so first notification only fires on actual change
		const currentStatus = storage.getScriptHashStatus(scriptHash);
		state.lastStatuses.set(scriptHash, currentStatus);
	}

	function unsubscribeScriptHash(consumerId: ConsumerId, scriptHash: ScriptHash): boolean {
		const state = consumers.get(consumerId);
		if (!state) return false;

		if (!state.scriptHashes.has(scriptHash)) return false;

		state.scriptHashes.delete(scriptHash);
		state.lastStatuses.delete(scriptHash);

		const subs = scriptHashSubs.get(scriptHash);
		if (subs) {
			subs.delete(consumerId);
			if (subs.size === 0) scriptHashSubs.delete(scriptHash);
		}

		return true;
	}

	function subscribeHeaders(consumerId: ConsumerId): void {
		const state = consumers.get(consumerId);
		if (!state) return;

		state.headerSubscribed = true;
		headerSubs.add(consumerId);
	}

	function unsubscribeHeaders(consumerId: ConsumerId): boolean {
		const state = consumers.get(consumerId);
		if (!state) return false;

		if (!state.headerSubscribed) return false;

		state.headerSubscribed = false;
		headerSubs.delete(consumerId);
		return true;
	}

	function notifyChanges(affectedScriptHashes: ReadonlySet<ScriptHash>): number {
		let count = 0;

		for (const scriptHash of affectedScriptHashes) {
			const subs = scriptHashSubs.get(scriptHash);
			if (!subs || subs.size === 0) continue;

			// Compute status once per scripthash
			const newStatus = storage.getScriptHashStatus(scriptHash);

			for (const consumerId of subs) {
				const state = consumers.get(consumerId);
				if (!state) continue;

				const lastStatus = state.lastStatuses.get(scriptHash);
				// Only notify if status actually changed
				// undefined means never subscribed (shouldn't happen), treat as changed
				if (lastStatus !== undefined && lastStatus === newStatus) continue;

				state.lastStatuses.set(scriptHash, newStatus);
				try {
					state.callback({
						type: "scripthash",
						scriptHash,
						status: newStatus,
					});
				} catch (e: unknown) {
					console.error("Subscriber callback threw during scripthash notification:", e);
				}
				count++;
			}
		}

		return count;
	}

	function notifyNewTip(header: BlockHeader): number {
		let count = 0;

		const notification: HeaderNotification = {
			type: "header",
			header,
		};

		for (const consumerId of headerSubs) {
			const state = consumers.get(consumerId);
			if (!state) continue;

			try {
				state.callback(notification);
			} catch (e: unknown) {
				console.error("Subscriber callback threw during header notification:", e);
			}
			count++;
		}

		return count;
	}

	function hooksForConsumer(consumerId: ConsumerId): ConsumerHooks {
		return {
			subscribeScriptHash: (scriptHash: ScriptHash) => subscribeScriptHash(consumerId, scriptHash),
			unsubscribeScriptHash: (scriptHash: ScriptHash) =>
				unsubscribeScriptHash(consumerId, scriptHash),
			subscribeHeaders: () => subscribeHeaders(consumerId),
			unsubscribeHeaders: () => unsubscribeHeaders(consumerId),
		};
	}

	function getScriptHashSubscriberCount(scriptHash: ScriptHash): number {
		return scriptHashSubs.get(scriptHash)?.size ?? 0;
	}

	function getHeaderSubscriberCount(): number {
		return headerSubs.size;
	}

	function getConsumerSubscriptionCount(consumerId: ConsumerId): number {
		return consumers.get(consumerId)?.scriptHashes.size ?? 0;
	}

	function getConsumerCount(): number {
		return consumers.size;
	}

	function getTotalSubscriptionCount(): number {
		let total = 0;
		for (const subs of scriptHashSubs.values()) {
			total += subs.size;
		}
		return total;
	}

	return {
		addConsumer,
		removeConsumer,
		subscribeScriptHash,
		unsubscribeScriptHash,
		subscribeHeaders,
		unsubscribeHeaders,
		notifyChanges,
		notifyNewTip,
		hooksForConsumer,
		getScriptHashSubscriberCount,
		getHeaderSubscriberCount,
		getConsumerSubscriptionCount,
		getConsumerCount,
		getTotalSubscriptionCount,
	};
}
