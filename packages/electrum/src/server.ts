import {
	ERR_BAD_REQUEST,
	err,
	type HandlerResult,
	invalidParams,
	ok,
	type ProtocolContext,
} from "./types.js";

/**
 * Parse a version string like "1.4" into [major, minor].
 * Returns null if invalid.
 */
function parseVersion(v: string): [number, number] | null {
	const parts = v.split(".");
	if (parts.length !== 2) return null;
	const major = Number(parts[0]);
	const minor = Number(parts[1]);
	if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
	return [major, minor];
}

/** Compare two version tuples. Returns -1, 0, or 1. */
function compareVersions(a: [number, number], b: [number, number]): number {
	if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
	if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
	return 0;
}

/** server.version */
export function version(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	if (params.length < 2) return invalidParams("Expected [client_name, protocol_version]");

	// params[0] is client name (informational)
	// params[1] is either a version string or [min, max] array
	const clientVersionParam = params[1];

	let clientMin: string;
	let clientMax: string;

	if (typeof clientVersionParam === "string") {
		clientMin = clientVersionParam;
		clientMax = clientVersionParam;
	} else if (
		Array.isArray(clientVersionParam) &&
		clientVersionParam.length === 2 &&
		typeof clientVersionParam[0] === "string" &&
		typeof clientVersionParam[1] === "string"
	) {
		clientMin = clientVersionParam[0];
		clientMax = clientVersionParam[1];
	} else {
		return invalidParams("Invalid protocol version parameter");
	}

	const serverMin = parseVersion(ctx.protocolMin);
	const serverMax = parseVersion(ctx.protocolMax);
	const cMin = parseVersion(clientMin);
	const cMax = parseVersion(clientMax);

	if (!serverMin || !serverMax || !cMin || !cMax) {
		return err(ERR_BAD_REQUEST, "Version negotiation failed");
	}

	// Negotiate: find the highest version supported by both sides
	// Overlap exists if cMax >= serverMin && serverMax >= cMin
	if (compareVersions(cMax, serverMin) < 0 || compareVersions(serverMax, cMin) < 0) {
		return err(ERR_BAD_REQUEST, "Version negotiation failed — no compatible protocol version");
	}

	// Negotiated version = min(cMax, serverMax)
	const negotiated = compareVersions(cMax, serverMax) <= 0 ? cMax : serverMax;
	const negotiatedStr = `${negotiated[0]}.${negotiated[1]}`;

	return ok([ctx.serverVersion, negotiatedStr]);
}

/** server.ping */
export function ping(_ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	return ok(null);
}

/** server.features */
export function features(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	return ok({
		genesis_hash: ctx.genesisHash,
		server_version: ctx.serverVersion,
		protocol_min: ctx.protocolMin,
		protocol_max: ctx.protocolMax,
		hash_function: ctx.hashFunction,
		pruning: null,
	});
}

/** blockchain.estimatefee */
export async function estimateFee(ctx: ProtocolContext, params: unknown[]): Promise<HandlerResult> {
	const blocks = params[0];
	if (typeof blocks !== "number" || !Number.isInteger(blocks) || blocks < 1) {
		return invalidParams("Invalid number of blocks");
	}

	if (!ctx.estimateFee) {
		return ok(-1);
	}

	try {
		const fee = await ctx.estimateFee(blocks);
		return ok(fee);
	} catch {
		return ok(-1);
	}
}

/** server.banner */
export function banner(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	return ok(ctx.banner ?? "");
}

/** server.donation_address */
export function donationAddress(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	return ok(ctx.donationAddress ?? "");
}

/** server.add_peer — stub (P2P not implemented). */
export function addPeer(_ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	return ok(false);
}

/** server.peers.subscribe — stub (P2P not implemented). */
export function peersSubscribe(_ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	return ok([]);
}

/** blockchain.relayfee */
export function relayFee(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	if (!ctx.getRelayFee) {
		// Default BCH relay fee: 1000 sat/kB = 0.00001 BCH/kB
		return ok(0.00001);
	}

	return ok(ctx.getRelayFee());
}
