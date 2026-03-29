// --- Generic schema type system (adapted from rpckit) ---

export type SchemaEntry = {
	method: string;
	params: unknown[] | Record<string, unknown>;
	return: unknown;
};

export type Schema = { requests: SchemaEntry[]; subscriptions: SchemaEntry[] };

/** Default schema for untyped usage — accepts any method string. */
export type AnySchema = {
	requests: [{ method: string; params: unknown[] | Record<string, unknown>; return: unknown }];
	subscriptions: [{ method: string; params: unknown[] | Record<string, unknown>; return: unknown }];
};

type AllEntries<S extends Schema> = [...S["requests"], ...S["subscriptions"]];

export type ExtractMethod<S extends Schema> = AllEntries<S>[number]["method"];

export type ExtractRequestMethod<S extends Schema> = S["requests"][number]["method"];

export type ExtractSubscriptionMethod<S extends Schema> = S["subscriptions"][number]["method"];

export type ExtractEntry<S extends Schema, M extends string> = Extract<
	AllEntries<S>[number],
	{ method: M }
>;

export type ExtractReturn<S extends Schema, M extends string> =
	ExtractEntry<S, M> extends never ? unknown : ExtractEntry<S, M>["return"];

export type ExtractParams<S extends Schema, M extends string> =
	ExtractEntry<S, M> extends never
		? unknown[] | Record<string, unknown>
		: ExtractEntry<S, M>["params"];

// --- Schema composition utilities ---

/** Filter out entries with a specific method from a tuple. */
type FilterMethod<T extends readonly unknown[], M extends string> = T extends readonly [
	infer Head,
	...infer Tail,
]
	? Head extends { method: M }
		? FilterMethod<Tail, M>
		: [Head, ...FilterMethod<Tail, M>]
	: [];

/** Filter out multiple methods from a tuple. */
type FilterMethods<
	T extends readonly unknown[],
	Entries extends readonly { method: string }[],
> = Entries extends readonly [
	infer E extends { method: string },
	...infer Rest extends { method: string }[],
]
	? FilterMethods<FilterMethod<T, E["method"]>, Rest>
	: T;

/** Override request methods in a schema. */
export type OverrideRequests<
	S extends { requests: readonly unknown[]; subscriptions: readonly unknown[] },
	NewEntries extends readonly {
		method: string;
		params: unknown[] | Record<string, unknown>;
		return: unknown;
	}[],
> = {
	requests: [...FilterMethods<S["requests"], NewEntries>, ...NewEntries];
	subscriptions: S["subscriptions"];
};

// --- Electrum Cash protocol schema ---

type TokenFilter = "include_tokens" | "exclude_tokens" | "tokens_only";

type TokenData = {
	amount: string;
	category: string;
	nft?: {
		capability: "none" | "minting" | "mutable";
		commitment: string;
	};
};

type UnspentEntry = {
	height: number;
	tx_hash: string;
	tx_pos: number;
	value: number;
	token_data?: TokenData;
};

export type ElectrumCashSchema_1_5_3 = {
	requests: [
		// blockchain.address.*
		{
			method: "blockchain.address.get_balance";
			params: [address: string, token_filter?: TokenFilter];
			return: { confirmed: number; unconfirmed: number };
		},
		{
			method: "blockchain.address.get_first_use";
			params: [address: string];
			return:
				| { block_hash: string; height: number; tx_hash: string }
				| {
						block_hash: "0000000000000000000000000000000000000000000000000000000000000000";
						height: 0;
						tx_hash: string;
				  };
		},
		{
			method: "blockchain.address.get_history";
			params: [address: string, from_height?: number, to_height?: number];
			return: Array<{ height: number; tx_hash: string }>;
		},
		{
			method: "blockchain.address.get_mempool";
			params: [address: string];
			return: Array<{ height: number; tx_hash: string; fee: number }>;
		},
		{
			method: "blockchain.address.get_scripthash";
			params: [address: string];
			return: string;
		},
		{
			method: "blockchain.address.listunspent";
			params: [address: string, token_filter?: TokenFilter];
			return: Array<UnspentEntry>;
		},
		{
			method: "blockchain.address.unsubscribe";
			params: [address: string];
			return: boolean;
		},
		// blockchain.block.*
		{
			method: "blockchain.block.header";
			params: [height: number, cp_height?: number];
			return: string | { header: string; root: string; branch: string[] };
		},
		{
			method: "blockchain.block.headers";
			params: [start_height: number, count: number, cp_height?: number];
			return:
				| { count: number; hex: string; max: number }
				| { count: number; hex: string; max: number; root: string; branch: string[] };
		},
		// blockchain.estimatefee / relayfee
		{
			method: "blockchain.estimatefee";
			params: [number: number];
			return: -1 | number;
		},
		// blockchain.header.*
		{
			method: "blockchain.header.get";
			params: [block_hash_or_height: string | number];
			return: { height: number; hex: string };
		},
		{
			method: "blockchain.headers.get_tip";
			params: [];
			return: { height: number; hex: string };
		},
		{ method: "blockchain.headers.unsubscribe"; params: []; return: boolean },
		{ method: "blockchain.relayfee"; params: []; return: number },
		// blockchain.rpa.*
		{
			method: "blockchain.rpa.get_history";
			params: [rpa_prefix: string, from_height: number, to_height?: number];
			return: Array<{ height: number; tx_hash: string }>;
		},
		{
			method: "blockchain.rpa.get_mempool";
			params: [rpa_prefix: string];
			return: Array<{ tx_hash: string; height: number; fee: number }>;
		},
		// blockchain.scripthash.*
		{
			method: "blockchain.scripthash.get_balance";
			params: [scripthash: string, token_filter?: TokenFilter];
			return: { confirmed: number; unconfirmed: number };
		},
		{
			method: "blockchain.scripthash.get_first_use";
			params: [scripthash: string];
			return: { block_hash: string; height: number; tx_hash: string } | null;
		},
		{
			method: "blockchain.scripthash.get_history";
			params: [scripthash: string, from_height?: number, to_height?: number];
			return: Array<{ fee?: number; height: number; tx_hash: string }>;
		},
		{
			method: "blockchain.scripthash.get_mempool";
			params: [scripthash: string];
			return: Array<{ height: number; tx_hash: string; fee: number }>;
		},
		{
			method: "blockchain.scripthash.get_status";
			params: [scripthash: string];
			return: string | null;
		},
		{
			method: "blockchain.scripthash.listunspent";
			params: [scripthash: string, token_filter?: TokenFilter];
			return: Array<UnspentEntry>;
		},
		{
			method: "blockchain.scripthash.unsubscribe";
			params: [scripthash: string];
			return: boolean;
		},
		// blockchain.transaction.*
		{
			method: "blockchain.transaction.broadcast";
			params: [raw_tx: string];
			return: string;
		},
		{
			method: "blockchain.transaction.broadcast_package";
			params: [raw_txs: string[]];
			return: string[];
		},
		{
			method: "blockchain.transaction.dsproof.get";
			params: [hash: string];
			return: {
				dspid: string;
				txid: string;
				hex: string;
				outpoint: { txid: string; vout: number };
				descendants: string[];
			} | null;
		},
		{
			method: "blockchain.transaction.dsproof.list";
			params: [];
			return: string[];
		},
		{
			method: "blockchain.transaction.get";
			params: [tx_hash: string, verbose?: boolean];
			return:
				| null
				| string
				| {
						blockhash: string;
						blocktime: number;
						confirmations: number;
						hash: string;
						hex: string;
						locktime: number;
						size: number;
						time: number;
						txid: string;
						version: number;
						vin: Array<{
							scriptSig: { asm: string; hex: string };
							sequence: number;
							txid: string;
							vout: number;
						}>;
						vout: Array<{
							n: number;
							scriptPubKey: {
								addresses: string[];
								asm: string;
								hex: string;
								reqSigs: number;
								type: string;
							};
							tokenData?: TokenData;
							value: number;
						}>;
				  };
		},
		{
			method: "blockchain.transaction.get_confirmed_blockhash";
			params: [tx_hash: string, include_header?: boolean];
			return:
				| { block_hash: string; block_height: number }
				| { block_hash: string; block_header: string; block_height: number };
		},
		{
			method: "blockchain.transaction.get_height";
			params: [tx_hash: string];
			return: -1 | 0 | number | null;
		},
		{
			method: "blockchain.transaction.get_merkle";
			params: [tx_hash: string, height?: number];
			return: { block_height: number; merkle: string[]; pos: number };
		},
		{
			method: "blockchain.transaction.id_from_pos";
			params: [height: number, tx_pos: number, merkle?: boolean];
			return: string | { tx_hash: string; merkle: string[] };
		},
		{
			method: "blockchain.transaction.unsubscribe";
			params: [tx_hash: string];
			return: boolean;
		},
		{
			method: "blockchain.transaction.dsproof.unsubscribe";
			params: [tx_hash: string];
			return: boolean;
		},
		// blockchain.utxo.*
		{
			method: "blockchain.utxo.get_info";
			params: [tx_hash: string, out_n: number];
			return: {
				confirmed_height?: number;
				scripthash: string;
				value: number;
				token_data?: TokenData;
			} | null;
		},
		// daemon.*
		{
			method: "daemon.passthrough";
			params: { method: string; params?: unknown[] | Record<string, unknown> };
			return: unknown;
		},
		// mempool.*
		{
			method: "mempool.get_fee_histogram";
			params: [];
			return: Array<[number, number]>;
		},
		// server.*
		{
			method: "server.add_peer";
			params: [features: Record<string, unknown>];
			return: boolean;
		},
		{ method: "server.banner"; params: []; return: string },
		{ method: "server.donation_address"; params: []; return: string },
		{
			method: "server.features";
			params: [];
			return: {
				genesis_hash: string;
				hash_function: string;
				server_version: string;
				hosts: Record<
					string,
					{
						ssl_port?: number;
						tcp_port: number;
						ws_port: number;
						wss_port: number;
					}
				>;
				protocol_max: string;
				protocol_min: string;
				pruning?: number;
				dsproof?: boolean;
				cashtokens?: boolean;
				rpa?: {
					history_block_limit: number;
					max_history: number;
					prefix_bits: number;
					prefix_bits_min: number;
					starting_height: number;
				};
			};
		},
		{
			method: "server.peers.subscribe";
			params: [];
			return: Array<[ip_address: string, hostname: string, features: string[]]>;
		},
		{ method: "server.ping"; params: []; return: null },
		{
			method: "server.version";
			params: [client_name?: string, protocol_version?: string];
			return: [server_software_version: string, protocol_version: string];
		},
	];
	subscriptions: [
		{
			method: "blockchain.address.subscribe";
			params: [address: string];
			return: [address: string, status: string | null];
		},
		{
			method: "blockchain.headers.subscribe";
			params: [];
			return: [header: { height: number; hex: string }];
		},
		{
			method: "blockchain.scripthash.subscribe";
			params: [scripthash: string];
			return: [scripthash: string, status: string | null];
		},
		{
			method: "blockchain.transaction.subscribe";
			params: [tx_hash: string];
			return: [tx_hash: string, confirmations: number | null];
		},
		{
			method: "blockchain.transaction.dsproof.subscribe";
			params: [tx_hash: string];
			return: [
				tx_hash: string,
				dsproof: {
					dspid: string;
					txid: string;
					hex: string;
					outpoint: { txid: string; vout: number };
					descendants: string[];
				} | null,
			];
		},
	];
};

export type ElectrumCashSchema_1_6_0 = OverrideRequests<
	ElectrumCashSchema_1_5_3,
	[
		{
			method: "blockchain.block.headers";
			params: [start_height: number, count: number, cp_height?: number];
			return:
				| { count: number; headers: string[]; max: number }
				| { count: number; headers: string[]; max: number; root: string; branch: string[] };
		},
		{
			method: "mempool.get_info";
			params: [];
			return:
				| { mempoolminfee: number; minrelaytxfee: number }
				| {
						mempoolminfee: number;
						minrelaytxfee: number;
						incrementalrelayfee: number;
						unbroadcastcount: number;
						fullrbf: boolean;
				  };
		},
		{
			method: "server.features";
			params: [];
			return: {
				genesis_hash: string;
				hash_function: string;
				server_version: string;
				hosts: Record<
					string,
					{
						ssl_port?: number;
						tcp_port: number;
						ws_port: number;
						wss_port: number;
					}
				>;
				protocol_max: string;
				protocol_min: string;
				pruning?: number;
				dsproof?: boolean;
				cashtokens?: boolean;
				rpa?: {
					history_block_limit: number;
					max_history: number;
					prefix_bits: number;
					prefix_bits_min: number;
					starting_height: number;
				};
				broadcast_package?: boolean;
			};
		},
	]
>;

export type ElectrumCashSchema = ElectrumCashSchema_1_6_0;

// --- Test extension ---

/** ElectrumCash schema extended with test.* development/testing methods. */
export type ElectrumCashTestSchema = OverrideRequests<
	ElectrumCashSchema,
	[
		{
			method: "test.set_chain_tip";
			params: [height: number, timestamp: number];
			return: true;
		},
		{
			method: "test.add_utxo";
			params: [
				address: string,
				utxo: {
					vout?: number;
					satoshis: number | bigint;
					height?: number;
					token?: {
						category: string;
						amount: number | bigint | string;
						nft?: { commitment: string; capability: string };
					};
				},
			];
			return: { txid: string };
		},
		{
			method: "test.remove_utxo";
			params: [txid: string, vout: number];
			return: true;
		},
		{
			method: "test.add_header";
			params: [hash: string, height: number, timestamp: number];
			return: true;
		},
		{
			method: "test.mine";
			params: [address: string, blocks?: number];
			return: { height: number; coinbaseTxids: string[] };
		},
		{
			method: "test.add_dsproof";
			params: [
				txid: string,
				dsproof: {
					dspid: string;
					txid: string;
					hex: string;
					outpoint: { txid: string; vout: number };
					descendants: string[];
				},
			];
			return: true;
		},
		{
			method: "test.debugTransaction";
			params: [rawHex: string];
			return: {
				success: boolean;
				txid?: string;
				fee?: bigint;
				size?: number;
				code?: number;
				error?: string;
				debugMessage?: string;
				inputResults?: Array<{
					inputIndex: number;
					success: boolean;
					error?: string;
				}>;
			};
		},
		{
			method: "test.reset";
			params: [];
			return: true;
		},
	]
>;
