import { isHex } from "@bitauth/libauth";
import type { Node } from "@mem-cash/core";
import type { BlockHeader, ScriptHash, Txid } from "@mem-cash/types";

/** JSON-RPC error object. */
export interface ProtocolError {
	readonly code: number;
	readonly message: string;
}

/** Result of a protocol handler: either a success value or an error. */
export type HandlerResult = { readonly result: unknown } | { readonly error: ProtocolError };

/** A protocol method handler function. */
export type Handler = (
	ctx: ProtocolContext,
	params: unknown[],
) => HandlerResult | Promise<HandlerResult>;

/** Context provided to all protocol handlers. */
export interface ProtocolContext {
	readonly node: Node;

	// Server identity
	readonly serverVersion: string;
	readonly protocolMin: string;
	readonly protocolMax: string;
	readonly genesisHash: string;
	readonly hashFunction: string;

	// Optional hooks for side-effect methods.
	// Handlers that need these will return an error if the hook is not provided.

	/** Register a scripthash subscription. */
	readonly subscribeScriptHash?: (scriptHash: ScriptHash) => void;
	/** Unregister a scripthash subscription. Returns true if was subscribed. */
	readonly unsubscribeScriptHash?: (scriptHash: ScriptHash) => boolean;
	/** Register a headers subscription. */
	readonly subscribeHeaders?: () => void;
	/** Unregister a headers subscription. Returns true if was subscribed. */
	readonly unsubscribeHeaders?: () => boolean;
	/** Estimate fee in BCH/kB for target confirmation blocks. Returns -1 if unavailable. */
	readonly estimateFee?: (blocks: number) => Promise<number>;
	/** Get minimum relay fee in BCH/kB. */
	readonly getRelayFee?: () => number;
	/** Look up a stored dsproof for a txid. Returns null if none exists. */
	readonly getDsproof?: (txid: string) => DsproofData | null;
	/** List all txids that have dsproofs. */
	readonly listDsproofs?: () => string[];
	/** Server banner text. */
	readonly banner?: string;
	/** Server donation address. */
	readonly donationAddress?: string;
	/** CashAddress prefix for address encoding (default: "bitcoincash"). */
	readonly addressPrefix?: string;
}

/** Double-spend proof data. */
export interface DsproofData {
	readonly dspid: string;
	readonly txid: string;
	readonly hex: string;
	readonly outpoint: { readonly txid: string; readonly vout: number };
	readonly descendants: readonly string[];
}

// --- Standard JSON-RPC error codes ---

export const ERR_INVALID_REQUEST = -32600;
export const ERR_METHOD_NOT_FOUND = -32601;
export const ERR_INVALID_PARAMS = -32602;
export const ERR_INTERNAL = -32603;

// --- Application error codes (matching Fulcrum) ---

export const ERR_BAD_REQUEST = 1;
export const ERR_DAEMON_ERROR = 2;

// --- Result helpers ---

/** Create a success result. */
export function ok(value: unknown): HandlerResult {
	return { result: value };
}

/** Create an error result. */
export function err(code: number, message: string): HandlerResult {
	return { error: { code, message } };
}

/** Create an invalid-params error. */
export function invalidParams(message: string): HandlerResult {
	return err(ERR_INVALID_PARAMS, message);
}

/** Create an internal error. */
export function internalError(message: string): HandlerResult {
	return err(ERR_INTERNAL, message);
}

// --- Validation helpers ---

/** Validate a scripthash parameter (64 hex chars). Returns null on failure. */
export function validateScriptHash(param: unknown): ScriptHash | null {
	if (typeof param !== "string" || param.length !== 64 || !isHex(param)) return null;
	return param;
}

/** Validate a txid parameter (64 hex chars). Returns null on failure. */
export function validateTxid(param: unknown): Txid | null {
	if (typeof param !== "string" || param.length !== 64 || !isHex(param)) return null;
	return param;
}

/** Validate a non-negative integer parameter. Returns null on failure. */
export function validateNonNegativeInt(param: unknown): number | null {
	if (typeof param !== "number" || !Number.isInteger(param) || param < 0) return null;
	return param;
}

/** Validate a boolean parameter (or absent). Returns undefined if not provided, null on bad type. */
export function validateOptionalBool(param: unknown): boolean | undefined | null {
	if (param === undefined || param === null) return undefined;
	if (typeof param !== "boolean") return null;
	return param;
}

/** Format a block header for the Electrum protocol response. */
export function formatHeaderResponse(header: BlockHeader): { height: number; hex: string } {
	return { height: header.height, hex: header.hex };
}
