import type { TestableStorage } from "@mem-cash/storage";
import { createMemoryStorage } from "@mem-cash/storage";
import { beforeEach, describe, expect, it } from "vitest";
import type { Notification, SubscriptionManager } from "./subscriptionManager.js";
import { createSubscriptionManager } from "./subscriptionManager.js";

const sh = (c: string) => c.repeat(32).slice(0, 64);
const tid = (c: string) => c.repeat(32).slice(0, 64);
const bhash = (c: string) => c.repeat(32).slice(0, 64);

describe("subscriptionManager", () => {
	let storage: TestableStorage;
	let subs: SubscriptionManager;
	let notifications: (Notification & { consumer: number })[];
	let consumerCounter: number;

	function addConsumer() {
		const num = ++consumerCounter;
		return subs.addConsumer((n) => notifications.push({ consumer: num, ...n }));
	}

	beforeEach(() => {
		storage = createMemoryStorage();
		subs = createSubscriptionManager(storage);
		notifications = [];
		consumerCounter = 0;
	});

	// --- Consumer lifecycle ---

	describe("consumer lifecycle", () => {
		it("addConsumer returns unique IDs", () => {
			const c1 = addConsumer();
			const c2 = addConsumer();
			expect(c1).not.toBe(c2);
			expect(subs.getConsumerCount()).toBe(2);
		});

		it("removeConsumer decrements count", () => {
			const c1 = addConsumer();
			subs.removeConsumer(c1);
			expect(subs.getConsumerCount()).toBe(0);
		});

		it("removeConsumer cleans up scripthash subscriptions", () => {
			const c1 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));
			expect(subs.getScriptHashSubscriberCount(sh("aa"))).toBe(1);

			subs.removeConsumer(c1);
			expect(subs.getScriptHashSubscriberCount(sh("aa"))).toBe(0);
		});

		it("removeConsumer cleans up header subscriptions", () => {
			const c1 = addConsumer();
			subs.subscribeHeaders(c1);
			expect(subs.getHeaderSubscriberCount()).toBe(1);

			subs.removeConsumer(c1);
			expect(subs.getHeaderSubscriberCount()).toBe(0);
		});

		it("removeConsumer is idempotent", () => {
			const c1 = addConsumer();
			subs.removeConsumer(c1);
			subs.removeConsumer(c1); // should not throw
			expect(subs.getConsumerCount()).toBe(0);
		});
	});

	// --- ScriptHash subscriptions ---

	describe("scripthash subscriptions", () => {
		it("subscribe is idempotent", () => {
			const c1 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));
			subs.subscribeScriptHash(c1, sh("aa"));
			expect(subs.getConsumerSubscriptionCount(c1)).toBe(1);
			expect(subs.getScriptHashSubscriberCount(sh("aa"))).toBe(1);
		});

		it("multiple consumers can subscribe to same scripthash", () => {
			const c1 = addConsumer();
			const c2 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));
			subs.subscribeScriptHash(c2, sh("aa"));
			expect(subs.getScriptHashSubscriberCount(sh("aa"))).toBe(2);
		});

		it("unsubscribe returns true if was subscribed", () => {
			const c1 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));
			expect(subs.unsubscribeScriptHash(c1, sh("aa"))).toBe(true);
			expect(subs.getConsumerSubscriptionCount(c1)).toBe(0);
		});

		it("unsubscribe returns false if not subscribed", () => {
			const c1 = addConsumer();
			expect(subs.unsubscribeScriptHash(c1, sh("aa"))).toBe(false);
		});

		it("getTotalSubscriptionCount works", () => {
			const c1 = addConsumer();
			const c2 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));
			subs.subscribeScriptHash(c1, sh("bb"));
			subs.subscribeScriptHash(c2, sh("aa"));
			expect(subs.getTotalSubscriptionCount()).toBe(3);
		});
	});

	// --- Header subscriptions ---

	describe("header subscriptions", () => {
		it("subscribe/unsubscribe headers", () => {
			const c1 = addConsumer();
			subs.subscribeHeaders(c1);
			expect(subs.getHeaderSubscriberCount()).toBe(1);

			expect(subs.unsubscribeHeaders(c1)).toBe(true);
			expect(subs.getHeaderSubscriberCount()).toBe(0);
		});

		it("unsubscribe returns false if not subscribed", () => {
			const c1 = addConsumer();
			expect(subs.unsubscribeHeaders(c1)).toBe(false);
		});
	});

	// --- notifyChanges ---

	describe("notifyChanges", () => {
		it("dispatches when status changes from null", () => {
			const c1 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));

			// Add history so status changes
			storage._test.history.add({
				scriptHash: sh("aa"),
				entries: [{ txHash: tid("t1"), height: 1 }],
			});

			const count = subs.notifyChanges(new Set([sh("aa")]));
			expect(count).toBe(1);
			expect(notifications).toHaveLength(1);
			expect(notifications[0]?.type).toBe("scripthash");
			const n = notifications[0] as { scriptHash: string; status: string | null };
			expect(n.scriptHash).toBe(sh("aa"));
			expect(n.status).toMatch(/^[0-9a-f]{64}$/);
		});

		it("does not dispatch when status unchanged", () => {
			const c1 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));
			// Status is null, no history added → still null
			const count = subs.notifyChanges(new Set([sh("aa")]));
			expect(count).toBe(0);
		});

		it("dispatches to multiple consumers", () => {
			const c1 = addConsumer();
			const c2 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));
			subs.subscribeScriptHash(c2, sh("aa"));

			storage._test.history.add({
				scriptHash: sh("aa"),
				entries: [{ txHash: tid("t1"), height: 1 }],
			});

			const count = subs.notifyChanges(new Set([sh("aa")]));
			expect(count).toBe(2);
			expect(notifications).toHaveLength(2);
			expect(notifications[0]?.consumer).toBe(1);
			expect(notifications[1]?.consumer).toBe(2);
		});

		it("skips scripthashes with no subscribers", () => {
			addConsumer();
			// No one subscribed to sh("aa")
			const count = subs.notifyChanges(new Set([sh("aa")]));
			expect(count).toBe(0);
		});

		it("updates baseline so second notify is no-op", () => {
			const c1 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));

			storage._test.history.add({
				scriptHash: sh("aa"),
				entries: [{ txHash: tid("t1"), height: 1 }],
			});

			subs.notifyChanges(new Set([sh("aa")]));
			notifications.length = 0;

			// Notify again — no change
			const count = subs.notifyChanges(new Set([sh("aa")]));
			expect(count).toBe(0);
			expect(notifications).toHaveLength(0);
		});

		it("dispatches again when status changes further", () => {
			const c1 = addConsumer();
			subs.subscribeScriptHash(c1, sh("aa"));

			storage._test.history.add({
				scriptHash: sh("aa"),
				entries: [{ txHash: tid("t1"), height: 1 }],
			});
			subs.notifyChanges(new Set([sh("aa")]));
			const firstStatus = (notifications[0] as { status: string | null }).status;
			notifications.length = 0;

			// Add more history
			storage._test.history.add({
				scriptHash: sh("aa"),
				entries: [{ txHash: tid("t2"), height: 2 }],
			});
			const count = subs.notifyChanges(new Set([sh("aa")]));
			expect(count).toBe(1);
			expect((notifications[0] as { status: string | null }).status).not.toBe(firstStatus);
		});
	});

	// --- notifyNewTip ---

	describe("notifyNewTip", () => {
		it("dispatches to header subscribers", () => {
			const c1 = addConsumer();
			subs.subscribeHeaders(c1);

			storage._test.header.add({ hash: bhash("aa"), height: 0 });
			const tip = storage.getTip();
			expect(tip).toBeDefined();
			if (!tip) return;

			const count = subs.notifyNewTip(tip);
			expect(count).toBe(1);
			expect(notifications).toHaveLength(1);
			expect(notifications[0]?.type).toBe("header");
			const n = notifications[0] as { header: { height: number } };
			expect(n.header.height).toBe(0);
		});

		it("does not dispatch to non-subscribers", () => {
			addConsumer(); // not subscribed to headers
			storage._test.header.add({ hash: bhash("aa"), height: 0 });
			const tip = storage.getTip();
			expect(tip).toBeDefined();
			if (!tip) return;

			const count = subs.notifyNewTip(tip);
			expect(count).toBe(0);
		});

		it("dispatches to multiple header subscribers", () => {
			const c1 = addConsumer();
			const c2 = addConsumer();
			subs.subscribeHeaders(c1);
			subs.subscribeHeaders(c2);

			storage._test.header.add({ hash: bhash("aa"), height: 0 });
			const tip = storage.getTip();
			expect(tip).toBeDefined();
			if (!tip) return;

			const count = subs.notifyNewTip(tip);
			expect(count).toBe(2);
		});
	});

	// --- hooksForConsumer ---

	describe("hooksForConsumer", () => {
		it("generates working subscribe/unsubscribe hooks", () => {
			const c1 = addConsumer();
			const hooks = subs.hooksForConsumer(c1);

			hooks.subscribeScriptHash(sh("aa"));
			expect(subs.getConsumerSubscriptionCount(c1)).toBe(1);

			expect(hooks.unsubscribeScriptHash(sh("aa"))).toBe(true);
			expect(subs.getConsumerSubscriptionCount(c1)).toBe(0);
		});

		it("generates working header hooks", () => {
			const c1 = addConsumer();
			const hooks = subs.hooksForConsumer(c1);

			hooks.subscribeHeaders();
			expect(subs.getHeaderSubscriberCount()).toBe(1);

			expect(hooks.unsubscribeHeaders()).toBe(true);
			expect(subs.getHeaderSubscriberCount()).toBe(0);
		});
	});

	// --- Subscription limit ---

	describe("subscription limits", () => {
		it("enforces maxSubscriptionsPerConsumer", () => {
			const limited = createSubscriptionManager(storage, {
				maxSubscriptionsPerConsumer: 2,
			});
			const c1 = limited.addConsumer(() => {});
			limited.subscribeScriptHash(c1, sh("aa"));
			limited.subscribeScriptHash(c1, sh("bb"));
			limited.subscribeScriptHash(c1, sh("cc")); // should be dropped
			expect(limited.getConsumerSubscriptionCount(c1)).toBe(2);
		});

		it("allows unlimited when maxSubscriptions is 0", () => {
			const unlimited = createSubscriptionManager(storage, {
				maxSubscriptionsPerConsumer: 0,
			});
			const c1 = unlimited.addConsumer(() => {});
			for (let i = 0; i < 100; i++) {
				const s = i.toString(16).padStart(64, "0");
				unlimited.subscribeScriptHash(c1, s);
			}
			expect(unlimited.getConsumerSubscriptionCount(c1)).toBe(100);
		});
	});
});
