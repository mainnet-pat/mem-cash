import type { StorageReader } from "./storageInterface.js";

/** BIP113: number of previous blocks used to compute Median Time Past. */
const MTP_BLOCK_COUNT = 11;

/**
 * Compute BIP113 Median Time Past for a given height.
 * Returns the median of up to 11 block timestamps ending at `height`.
 * Returns 0 if no headers are available.
 */
export function computeMedianTimePast(storage: StorageReader, height: number): number {
	const timestamps: number[] = [];
	for (let i = 0; i < MTP_BLOCK_COUNT && height - i >= 0; i++) {
		const header = storage.getHeader(height - i);
		if (header) {
			timestamps.push(header.timestamp);
		}
	}
	if (timestamps.length === 0) return 0;
	timestamps.sort((a, b) => a - b);
	return timestamps[Math.floor(timestamps.length / 2)] ?? 0;
}
