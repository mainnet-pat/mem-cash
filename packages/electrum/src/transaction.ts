import {
	binToHex,
	decodeTransactionBch,
	hexToBin,
	isHex,
	lockingBytecodeToCashAddress,
} from "@bitauth/libauth";
import { computeTxMerkleBranch } from "@mem-cash/types";
import {
	ERR_BAD_REQUEST,
	ERR_DAEMON_ERROR,
	ERR_INTERNAL,
	err,
	type HandlerResult,
	invalidParams,
	ok,
	type ProtocolContext,
	validateNonNegativeInt,
	validateOptionalBool,
	validateTxid,
} from "./types.js";

/** blockchain.transaction.get */
export function get(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");

	const verbose = validateOptionalBool(params[1]);
	if (verbose === null) return invalidParams("Invalid verbose parameter");

	const rawHex = ctx.node.getRawTx(txid);
	if (rawHex === undefined) {
		return err(
			ERR_BAD_REQUEST,
			"No such mempool or blockchain transaction. Use gettransaction for wallet transactions.",
		);
	}

	if (!verbose) return ok(rawHex);

	// Verbose mode: decode and build full response
	const decoded = decodeTransactionBch(hexToBin(rawHex));
	if (typeof decoded === "string") {
		return err(ERR_INTERNAL, "Failed to decode transaction");
	}

	const record = ctx.node.getTx(txid);
	const tip = ctx.node.getTip();
	const txHeight = record?.height ?? 0;
	const confirmations = txHeight > 0 && tip ? tip.height - txHeight + 1 : 0;
	const blockHeader = txHeight > 0 ? ctx.node.getHeader(txHeight) : undefined;

	const vin = decoded.inputs.map((input) => ({
		txid: binToHex(input.outpointTransactionHash),
		vout: input.outpointIndex,
		scriptSig: {
			asm: "",
			hex: binToHex(input.unlockingBytecode),
		},
		sequence: input.sequenceNumber,
	}));

	const vout = decoded.outputs.map((output, n) => {
		const scriptHex = binToHex(output.lockingBytecode);
		const bc = output.lockingBytecode;

		let type = "nonstandard";
		let asm = "";
		const addresses: string[] = [];

		if (bc.length === 0) {
			type = "nulldata";
		} else if (bc[0] === 0x6a) {
			type = "nulldata";
			asm = `OP_RETURN${bc.length > 1 ? ` ${binToHex(bc.slice(1))}` : ""}`;
		} else if (
			bc.length === 25 &&
			bc[0] === 0x76 &&
			bc[1] === 0xa9 &&
			bc[2] === 0x14 &&
			bc[23] === 0x88 &&
			bc[24] === 0xac
		) {
			type = "pubkeyhash";
			const addrOpts = ctx.addressPrefix
				? { bytecode: bc, prefix: ctx.addressPrefix as "bitcoincash" }
				: { bytecode: bc };
			const result = lockingBytecodeToCashAddress(addrOpts);
			if (typeof result !== "string") addresses.push(result.address);
		} else if (bc.length === 23 && bc[0] === 0xa9 && bc[1] === 0x14 && bc[22] === 0x87) {
			type = "scripthash";
			const addrOpts = ctx.addressPrefix
				? { bytecode: bc, prefix: ctx.addressPrefix as "bitcoincash" }
				: { bytecode: bc };
			const result = lockingBytecodeToCashAddress(addrOpts);
			if (typeof result !== "string") addresses.push(result.address);
		}

		const item: {
			n: number;
			value: number;
			scriptPubKey: {
				asm: string;
				hex: string;
				reqSigs: number;
				type: string;
				addresses: string[];
			};
			tokenData?: {
				category: string;
				amount: string;
				nft?: { capability: string; commitment: string };
			};
		} = {
			n,
			value: Number(output.valueSatoshis) / 1e8,
			scriptPubKey: {
				asm,
				hex: scriptHex,
				reqSigs: type === "nulldata" ? 0 : 1,
				type,
				addresses,
			},
		};

		if (output.token) {
			const td: NonNullable<(typeof item)["tokenData"]> = {
				category: binToHex(output.token.category),
				amount: String(output.token.amount),
			};
			if (output.token.nft) {
				td.nft = {
					capability: output.token.nft.capability,
					commitment: binToHex(output.token.nft.commitment),
				};
			}
			item.tokenData = td;
		}

		return item;
	});

	return ok({
		txid,
		hash: txid,
		hex: rawHex,
		size: hexToBin(rawHex).length,
		version: decoded.version,
		locktime: decoded.locktime,
		vin,
		vout,
		blockhash: blockHeader?.hash ?? "",
		blocktime: blockHeader?.timestamp ?? 0,
		time: blockHeader?.timestamp ?? 0,
		confirmations,
	});
}

/** blockchain.transaction.get_merkle */
export function getMerkle(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");

	// Height can be provided explicitly or looked up from the tx record
	let height: number;
	if (params[1] !== undefined && params[1] !== null) {
		const h = validateNonNegativeInt(params[1]);
		if (h === null) return invalidParams("Invalid height");
		height = h;
	} else {
		const txRecord = ctx.node.getTx(txid);
		if (!txRecord) {
			return err(
				ERR_BAD_REQUEST,
				"No such mempool or blockchain transaction. Use gettransaction for wallet transactions.",
			);
		}
		if (txRecord.height <= 0) {
			return err(ERR_BAD_REQUEST, "Transaction is not confirmed");
		}
		height = txRecord.height;
	}

	const txids = ctx.node.getTxidsAtHeight(height);
	if (!txids) {
		return err(ERR_BAD_REQUEST, "Block not found at the requested height");
	}

	const result = computeTxMerkleBranch(txids, txid);
	if (!result) {
		return err(ERR_BAD_REQUEST, "Transaction not found in the specified block");
	}

	return ok({
		block_height: height,
		pos: result.pos,
		merkle: result.merkle,
	});
}

/** blockchain.transaction.id_from_pos */
export function idFromPos(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const height = validateNonNegativeInt(params[0]);
	if (height === null) return invalidParams("Invalid height");

	const txPos = validateNonNegativeInt(params[1]);
	if (txPos === null) return invalidParams("Invalid tx_pos");

	const merkle = validateOptionalBool(params[2]);
	if (merkle === null) return invalidParams("Invalid merkle parameter");

	const txids = ctx.node.getTxidsAtHeight(height);
	if (!txids) {
		return err(ERR_BAD_REQUEST, "Block not found at the requested height");
	}

	if (txPos >= txids.length) {
		return err(ERR_BAD_REQUEST, "tx_pos out of range");
	}

	const txid = txids[txPos];
	if (txid === undefined) {
		return err(ERR_BAD_REQUEST, "tx_pos out of range");
	}

	if (!merkle) {
		return ok(txid);
	}

	const branch = computeTxMerkleBranch(txids, txid);
	if (!branch) {
		return err(ERR_BAD_REQUEST, "Failed to compute merkle branch");
	}

	return ok({
		tx_hash: txid,
		merkle: branch.merkle,
	});
}

/** blockchain.transaction.broadcast */
export function broadcast(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const rawTx = params[0];
	if (typeof rawTx !== "string" || rawTx.length === 0 || !isHex(rawTx)) {
		return invalidParams("Invalid raw transaction hex");
	}

	const result = ctx.node.submitTransaction(rawTx);
	if (!result.success) {
		// Match Fulcrum error format: "the transaction was rejected by network rules.\n\n<reason> (code <code>)\n"
		const msg = `the transaction was rejected by network rules.\n\n${result.error} (code ${result.code})\n`;
		return err(ERR_DAEMON_ERROR, msg);
	}
	return ok(result.txid);
}

/** blockchain.transaction.get_height */
export function getHeight(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");

	const record = ctx.node.getTx(txid);
	if (!record) {
		// Check mempool
		const memTx = ctx.node.getMempoolTx(txid);
		if (memTx) return ok(0);
		return ok(null);
	}

	return ok(record.height > 0 ? record.height : 0);
}

/** blockchain.transaction.get_confirmed_blockhash */
export function getConfirmedBlockhash(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");

	const includeHeader = validateOptionalBool(params[1]);
	if (includeHeader === null) return invalidParams("Invalid include_header parameter");

	const record = ctx.node.getTx(txid);
	if (!record || record.height <= 0) {
		return err(ERR_BAD_REQUEST, "Transaction not confirmed");
	}

	const header = ctx.node.getHeader(record.height);
	if (!header) {
		return err(ERR_BAD_REQUEST, "Block not found at the requested height");
	}

	if (includeHeader) {
		return ok({
			block_hash: header.hash,
			block_height: record.height,
			block_header: header.hex,
		});
	}

	return ok({
		block_hash: header.hash,
		block_height: record.height,
	});
}

/** blockchain.transaction.dsproof.get */
export function dsproofGet(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");
	return ok(ctx.getDsproof ? ctx.getDsproof(txid) : null);
}

/** blockchain.transaction.dsproof.list */
export function dsproofList(ctx: ProtocolContext, _params: unknown[]): HandlerResult {
	return ok(ctx.listDsproofs ? ctx.listDsproofs() : []);
}

/** Maximum transactions in a single broadcast_package call. */
const MAX_PACKAGE_SIZE = 1000;

/** blockchain.transaction.broadcast_package */
export function broadcastPackage(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const rawTxs = params[0];
	if (!Array.isArray(rawTxs) || rawTxs.length === 0) {
		return invalidParams("Expected non-empty array of raw transaction hexes");
	}
	if (rawTxs.length > MAX_PACKAGE_SIZE) {
		return invalidParams(`Package exceeds maximum size of ${MAX_PACKAGE_SIZE}`);
	}

	const txids: string[] = [];
	for (const rawTx of rawTxs) {
		if (typeof rawTx !== "string" || rawTx.length === 0 || !isHex(rawTx)) {
			return invalidParams("Invalid raw transaction hex in package");
		}
		const result = ctx.node.submitTransaction(rawTx);
		if (!result.success) {
			const msg = `the transaction was rejected by network rules.\n\n${result.error} (code ${result.code})\n`;
			return err(ERR_DAEMON_ERROR, msg);
		}
		txids.push(result.txid);
	}

	return ok(txids);
}

/** blockchain.transaction.subscribe — returns current confirmation status. */
export function txSubscribe(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");

	const record = ctx.node.getTx(txid);
	const memTx = ctx.node.getMempoolTx(txid);
	const tip = ctx.node.getTip();

	let confirmations: number | null = null;
	if (record && record.height > 0 && tip) {
		confirmations = tip.height - record.height + 1;
	} else if (record || memTx) {
		confirmations = 0;
	}

	return ok([txid, confirmations]);
}

/** blockchain.transaction.unsubscribe */
export function txUnsubscribe(_ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");
	return ok(true);
}

/** blockchain.transaction.dsproof.subscribe — returns current dsproof status. */
export function dsproofSubscribe(ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");
	// Initial status: look up from context hook, default to no dsproof
	const dsproof = ctx.getDsproof ? ctx.getDsproof(txid) : null;
	return ok([txid, dsproof]);
}

/** blockchain.transaction.dsproof.unsubscribe */
export function dsproofUnsubscribe(_ctx: ProtocolContext, params: unknown[]): HandlerResult {
	const txid = validateTxid(params[0]);
	if (txid === null) return invalidParams("Invalid tx hash");
	return ok(true);
}
