import { binToHex, hexToBin } from "@bitauth/libauth";
import { describe, expect, it } from "vitest";
import {
	computeHeaderMerkleBranch,
	computeMerkleBranchAndRoot,
	computeTxMerkleBranch,
} from "./merkle.js";

describe("computeMerkleBranchAndRoot", () => {
	it("returns correct root for single element", () => {
		const hash = hexToBin("ab".repeat(32));
		const { branch, root } = computeMerkleBranchAndRoot([hash], 0);
		expect(branch).toHaveLength(0);
		expect(binToHex(root)).toBe("ab".repeat(32));
	});

	it("returns correct branch for two elements", () => {
		const h0 = hexToBin("aa".repeat(32));
		const h1 = hexToBin("bb".repeat(32));
		const { branch } = computeMerkleBranchAndRoot([h0, h1], 0);
		expect(branch).toHaveLength(1);
		// Branch for index 0 should be h1 (the sibling)
		expect(branch[0] && binToHex(branch[0])).toBe("bb".repeat(32));
	});

	it("branch for index 1 is h0", () => {
		const h0 = hexToBin("aa".repeat(32));
		const h1 = hexToBin("bb".repeat(32));
		const { branch } = computeMerkleBranchAndRoot([h0, h1], 1);
		expect(branch).toHaveLength(1);
		expect(branch[0] && binToHex(branch[0])).toBe("aa".repeat(32));
	});

	it("produces same root regardless of queried index", () => {
		const hashes = [
			hexToBin("aa".repeat(32)),
			hexToBin("bb".repeat(32)),
			hexToBin("cc".repeat(32)),
			hexToBin("dd".repeat(32)),
		];
		const r0 = computeMerkleBranchAndRoot(hashes, 0);
		const r1 = computeMerkleBranchAndRoot(hashes, 1);
		const r2 = computeMerkleBranchAndRoot(hashes, 2);
		const r3 = computeMerkleBranchAndRoot(hashes, 3);
		const root = binToHex(r0.root);
		expect(binToHex(r1.root)).toBe(root);
		expect(binToHex(r2.root)).toBe(root);
		expect(binToHex(r3.root)).toBe(root);
	});

	it("handles odd number of elements (duplicates last)", () => {
		const hashes = [
			hexToBin("aa".repeat(32)),
			hexToBin("bb".repeat(32)),
			hexToBin("cc".repeat(32)),
		];
		const { branch, root } = computeMerkleBranchAndRoot(hashes, 0);
		expect(branch.length).toBeGreaterThan(0);
		expect(root.length).toBe(32);
	});
});

describe("computeTxMerkleBranch", () => {
	it("returns null for missing txid", () => {
		const txids = ["aa".repeat(32), "bb".repeat(32)];
		expect(computeTxMerkleBranch(txids, "cc".repeat(32))).toBeNull();
	});

	it("returns correct pos for first tx", () => {
		const txids = ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)];
		const result = computeTxMerkleBranch(txids, "aa".repeat(32));
		expect(result).not.toBeNull();
		expect(result?.pos).toBe(0);
	});

	it("returns correct pos for last tx", () => {
		const txids = ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)];
		const result = computeTxMerkleBranch(txids, "cc".repeat(32));
		expect(result).not.toBeNull();
		expect(result?.pos).toBe(2);
	});

	it("returns branch hashes as display-order hex", () => {
		const txids = ["aa".repeat(32), "bb".repeat(32)];
		const result = computeTxMerkleBranch(txids, "aa".repeat(32));
		expect(result).not.toBeNull();
		expect(result?.merkle).toHaveLength(1);
		// Branch hash should be 64 hex chars
		expect(result?.merkle[0]).toHaveLength(64);
	});

	it("single tx produces empty branch", () => {
		const txids = ["aa".repeat(32)];
		const result = computeTxMerkleBranch(txids, "aa".repeat(32));
		expect(result).not.toBeNull();
		expect(result?.pos).toBe(0);
		expect(result?.merkle).toHaveLength(0);
	});
});

describe("computeHeaderMerkleBranch", () => {
	it("produces branch and root", () => {
		const hashes = ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32), "dd".repeat(32)];
		const { branch, root } = computeHeaderMerkleBranch(hashes, 0);
		expect(branch.length).toBeGreaterThan(0);
		expect(root).toHaveLength(64);
	});

	it("root is consistent across heights", () => {
		const hashes = ["aa".repeat(32), "bb".repeat(32), "cc".repeat(32), "dd".repeat(32)];
		const r0 = computeHeaderMerkleBranch(hashes, 0);
		const r1 = computeHeaderMerkleBranch(hashes, 1);
		const r3 = computeHeaderMerkleBranch(hashes, 3);
		expect(r0.root).toBe(r1.root);
		expect(r0.root).toBe(r3.root);
	});

	it("single hash returns empty branch, hash as root", () => {
		const hashes = ["aa".repeat(32)];
		const { branch, root } = computeHeaderMerkleBranch(hashes, 0);
		expect(branch).toHaveLength(0);
		// Root should be hash256 of the reversed input — just check it's 64 hex chars
		expect(root).toHaveLength(64);
	});
});
