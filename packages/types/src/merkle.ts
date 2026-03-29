import { binToHex, hexToBin, sha256 } from "@bitauth/libauth";

/** Reverse a Uint8Array (returns new array). */
function reverseBytes(bytes: Uint8Array): Uint8Array {
	const reversed = new Uint8Array(bytes.length);
	reversed.set(bytes);
	reversed.reverse();
	return reversed;
}

/** Double-SHA256 of a Uint8Array. */
function hash256(data: Uint8Array): Uint8Array {
	return sha256.hash(sha256.hash(data));
}

/** Hash a pair of 32-byte values for the merkle tree (double-SHA256 of concatenation). */
function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
	const combined = new Uint8Array(64);
	combined.set(a, 0);
	combined.set(b, 32);
	return hash256(combined);
}

/**
 * Compute the merkle branch and root for a given index in a list of hashes.
 *
 * Hashes should be in internal byte order (little-endian, as used in Bitcoin's
 * merkle tree computation). The returned branch and root are also in internal order.
 *
 * @param hashes - Array of 32-byte hashes in internal byte order
 * @param index - Position of the target hash
 * @returns branch (sibling hashes) and root
 */
export function computeMerkleBranchAndRoot(
	hashes: Uint8Array[],
	index: number,
): { branch: Uint8Array[]; root: Uint8Array } {
	if (hashes.length === 0) {
		throw new Error("Cannot compute merkle root for empty hash list");
	}
	if (index < 0 || index >= hashes.length) {
		throw new Error(`Merkle index ${index} out of bounds for ${hashes.length} hashes`);
	}
	for (const hash of hashes) {
		if (hash.length !== 32) {
			throw new Error(`Invalid hash length: ${hash.length}, expected 32`);
		}
	}

	const branch: Uint8Array[] = [];

	let level = [...hashes];
	let idx = index;

	while (level.length > 1) {
		// If odd number of elements, duplicate the last one
		if (level.length % 2 !== 0) {
			const last = level[level.length - 1];
			if (last) level.push(last);
		}

		// Record the sibling of the target
		const siblingIdx = idx ^ 1;
		const sibling = level[siblingIdx];
		if (sibling && siblingIdx < level.length) {
			branch.push(sibling);
		}

		// Build next level
		const nextLevel: Uint8Array[] = [];
		for (let i = 0; i < level.length; i += 2) {
			const left = level[i];
			const right = level[i + 1];
			if (left && right) {
				nextLevel.push(hashPair(left, right));
			}
		}

		idx = Math.floor(idx / 2);
		level = nextLevel;
	}

	return { branch, root: level[0] ?? new Uint8Array(32) };
}

/**
 * Compute the merkle branch for a transaction in a block.
 *
 * Takes txid hex strings in display order (big-endian, as shown in block explorers),
 * converts to internal byte order for tree computation, then converts the branch
 * back to display order hex strings for the protocol response.
 *
 * @param txids - Ordered txid hex strings (display order)
 * @param targetTxid - The txid to compute the branch for
 * @returns branch hashes in display-order hex and the position, or null if txid not found
 */
export function computeTxMerkleBranch(
	txids: string[],
	targetTxid: string,
): { merkle: string[]; pos: number } | null {
	const index = txids.indexOf(targetTxid);
	if (index === -1) return null;

	// Convert display-order txids to internal byte order
	const internalHashes = txids.map((txid) => reverseBytes(hexToBin(txid)));

	const { branch } = computeMerkleBranchAndRoot(internalHashes, index);

	// Convert branch back to display order hex
	const merkle = branch.map((h) => binToHex(reverseBytes(h)));

	return { merkle, pos: index };
}

/**
 * Compute a merkle branch for a block header within a checkpoint range.
 *
 * Used by `blockchain.block.header` with cp_height parameter.
 * Computes a merkle tree over block hashes from height 0 to cp_height (inclusive),
 * then returns the branch proving the header at `height` is included.
 *
 * @param headerHashes - Block hashes (display-order hex) for heights 0..cp_height
 * @param height - The height of the header to prove
 * @returns branch hashes in display-order hex and the merkle root
 */
export function computeHeaderMerkleBranch(
	headerHashes: string[],
	height: number,
): { branch: string[]; root: string } {
	// Convert display-order hashes to internal byte order
	const internalHashes = headerHashes.map((h) => reverseBytes(hexToBin(h)));

	const { branch, root } = computeMerkleBranchAndRoot(internalHashes, height);

	return {
		branch: branch.map((h) => binToHex(reverseBytes(h))),
		root: binToHex(reverseBytes(root)),
	};
}
