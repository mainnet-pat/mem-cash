/** 64-char lowercase hex scripthash (SHA256 of output script). */
export type ScriptHash = string;

/** 64-char lowercase hex transaction id. */
export type Txid = string;

/** 64-char lowercase hex block hash. */
export type BlockHash = string;

/** Block height (non-negative integer). */
export type BlockHeight = number;

/** Canonical outpoint key: `"${txid}:${vout}"`. */
export type OutpointKey = `${string}:${number}`;

/** Build a canonical outpoint key from txid and output index. */
export function makeOutpointKey(txid: Txid, vout: number): OutpointKey {
	return `${txid}:${vout}`;
}

/** Parse a canonical outpoint key back into txid and vout. */
export function parseOutpointKey(key: OutpointKey): { txid: Txid; vout: number } {
	const lastColon = key.lastIndexOf(":");
	const voutStr = key.slice(lastColon + 1);
	const vout = Number(voutStr);
	if (!Number.isInteger(vout) || vout < 0 || vout > 0xffffffff) {
		throw new Error(`Invalid vout in outpoint key: ${voutStr}`);
	}
	return {
		txid: key.slice(0, lastColon),
		vout,
	};
}
