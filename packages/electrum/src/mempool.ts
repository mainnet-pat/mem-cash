import { type HandlerResult, ok, type ProtocolContext } from "./types.js";

/** mempool.get_fee_histogram */
export function getFeeHistogram(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	const txids = ctx.node.getMempoolTxids();

	// Collect fee rates (sat/byte) for each mempool tx
	const entries: { feeRate: number; size: number }[] = [];
	for (const txid of txids) {
		const tx = ctx.node.getMempoolTx(txid);
		if (!tx || tx.size === 0) continue;
		entries.push({
			feeRate: Number(tx.fee) / tx.size,
			size: tx.size,
		});
	}

	// Sort by fee rate descending
	entries.sort((a, b) => b.feeRate - a.feeRate);

	// Build histogram buckets: [fee_rate, cumulative_vsize]
	// Use logarithmic boundaries matching ElectrumX/Fulcrum convention
	const bucketBoundaries = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.01, 0];

	const histogram: [number, number][] = [];
	let idx = 0;
	for (const boundary of bucketBoundaries) {
		let cumulativeSize = 0;
		let entry = entries[idx];
		while (entry && entry.feeRate >= boundary) {
			cumulativeSize += entry.size;
			idx++;
			entry = entries[idx];
		}
		if (cumulativeSize > 0) {
			histogram.push([boundary, cumulativeSize]);
		}
	}

	return ok(histogram);
}

/** mempool.get_info */
export function getInfo(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	// Default BCH relay fee: 1000 sat/kB = 0.00001 BCH/kB
	const relayFee = ctx.getRelayFee ? ctx.getRelayFee() : 0.00001;

	return ok({
		mempoolminfee: relayFee,
		minrelaytxfee: relayFee,
	});
}
