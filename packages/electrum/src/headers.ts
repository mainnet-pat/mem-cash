import { computeHeaderMerkleBranch } from "@mem-cash/types";
import {
	ERR_BAD_REQUEST,
	err,
	formatHeaderResponse,
	type HandlerResult,
	invalidParams,
	ok,
	type ProtocolContext,
	validateNonNegativeInt,
} from "./types.js";

/** Maximum number of headers returned in a single `blockchain.block.headers` request. */
const MAX_HEADERS_PER_REQUEST = 2016;

/** Maximum cp_height for merkle proof computation (prevents DoS via huge allocations). */
const MAX_CHECKPOINT_HEIGHT = 1_000_000;

/**
 * Collect block hashes for heights 0..cpHeight (inclusive) from storage.
 * Returns null if any header in the range is missing.
 */
function collectHeaderHashes(ctx: ProtocolContext, cpHeight: number): string[] | null {
	const hashes: string[] = [];
	for (let h = 0; h <= cpHeight; h++) {
		const header = ctx.node.getHeader(h);
		if (!header) return null;
		hashes.push(header.hash);
	}
	return hashes;
}

/** blockchain.block.header */
export function blockHeader(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const height = validateNonNegativeInt(params[0]);
	if (height === null) return invalidParams("Invalid height");

	const header = ctx.node.getHeader(height);
	if (!header) {
		return err(ERR_BAD_REQUEST, "Invalid height");
	}

	// Without checkpoint: return raw header hex
	if (params[1] === undefined || params[1] === null) {
		return ok(header.hex);
	}

	// With checkpoint height: return header + merkle proof
	const cpHeight = validateNonNegativeInt(params[1]);
	if (cpHeight === null) return invalidParams("Invalid cp_height");

	if (height > cpHeight) {
		return invalidParams("height must be <= cp_height");
	}

	if (cpHeight > MAX_CHECKPOINT_HEIGHT) {
		return invalidParams("cp_height exceeds maximum allowed value");
	}

	const tip = ctx.node.getTip();
	if (!tip || cpHeight > tip.height) {
		return invalidParams("cp_height exceeds chain tip");
	}

	const hashes = collectHeaderHashes(ctx, cpHeight);
	if (!hashes) {
		return err(ERR_BAD_REQUEST, "Missing headers in checkpoint range");
	}

	const { branch, root } = computeHeaderMerkleBranch(hashes, height);

	return ok({
		header: header.hex,
		branch,
		root,
	});
}

/** blockchain.block.headers (plural — returns a range of consecutive headers) */
export function blockHeaders(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const startHeight = validateNonNegativeInt(params[0]);
	if (startHeight === null) return invalidParams("Invalid start_height");

	let count = validateNonNegativeInt(params[1]);
	if (count === null) return invalidParams("Invalid count");

	// Clamp count to maximum
	count = Math.min(count, MAX_HEADERS_PER_REQUEST);

	// Clamp to available headers
	const tip = ctx.node.getTip();
	if (tip) {
		count = Math.min(count, tip.height - startHeight + 1);
	}
	count = Math.max(count, 0);

	// Collect headers
	let hex = "";
	let actual = 0;
	for (let h = startHeight; h < startHeight + count; h++) {
		const header = ctx.node.getHeader(h);
		if (!header) break;
		hex += header.hex;
		actual++;
	}

	const result: {
		count: number;
		hex: string;
		max: number;
		branch?: string[];
		root?: string;
	} = {
		count: actual,
		hex,
		max: MAX_HEADERS_PER_REQUEST,
	};

	// Optional checkpoint proof
	if (params[2] !== undefined && params[2] !== null) {
		const cpHeight = validateNonNegativeInt(params[2]);
		if (cpHeight === null) return invalidParams("Invalid cp_height");

		if (actual > 0 && cpHeight >= startHeight + actual - 1 && cpHeight <= MAX_CHECKPOINT_HEIGHT) {
			if (tip && cpHeight <= tip.height) {
				const hashes = collectHeaderHashes(ctx, cpHeight);
				if (hashes) {
					// Prove the last header in the returned range
					const lastHeight = startHeight + actual - 1;
					const proof = computeHeaderMerkleBranch(hashes, lastHeight);
					result.branch = proof.branch;
					result.root = proof.root;
				}
			}
		}
	}

	return ok(result);
}

/** blockchain.header.get — retrieve a single header by height or hash. */
export function headerGet(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const param = params[0];
	let header: ReturnType<typeof ctx.node.getHeader>;
	if (typeof param === "number") {
		const height = validateNonNegativeInt(param);
		if (height === null) return invalidParams("Invalid height");
		header = ctx.node.getHeader(height);
	} else if (typeof param === "string" && param.length === 64) {
		header = ctx.node.getHeaderByHash(param);
	} else {
		return invalidParams("Expected block height (number) or hash (64-char hex)");
	}
	if (!header) return err(ERR_BAD_REQUEST, "Invalid height");
	return ok(formatHeaderResponse(header));
}

/** blockchain.headers.get_tip — return the current chain tip. */
export function headersGetTip(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	const tip = ctx.node.getTip();
	if (!tip) return err(ERR_BAD_REQUEST, "No blocks available");
	return ok(formatHeaderResponse(tip));
}

/** blockchain.headers.subscribe */
export function headersSubscribe(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	const tip = ctx.node.getTip();
	if (!tip) {
		return err(ERR_BAD_REQUEST, "No blocks available");
	}

	if (ctx.subscribeHeaders) {
		ctx.subscribeHeaders();
	}

	return ok(formatHeaderResponse(tip));
}

/** blockchain.headers.unsubscribe */
export function headersUnsubscribe(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	if (!ctx.unsubscribeHeaders) {
		return err(ERR_BAD_REQUEST, "Subscriptions not supported");
	}

	const wasSubscribed = ctx.unsubscribeHeaders();
	return ok(wasSubscribed);
}
