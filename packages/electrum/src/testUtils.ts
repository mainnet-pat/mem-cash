import { bigIntToVmNumber, binToHex, NonFungibleTokenCapability, sha256 } from "@bitauth/libauth";

/** Token data for a UTXO. */
export interface TokenDetails {
	amount: bigint;
	category: string;
	nft?: {
		capability: "none" | "mutable" | "minting";
		commitment: string;
	};
}

/** A UTXO with identifying outpoint, value, and optional token data. */
export interface Utxo {
	txid: string;
	vout: number;
	satoshis: bigint;
	token?: TokenDetails;
}

const randomInt = (): bigint => BigInt(Math.floor(Math.random() * 10000));

export const randomUtxo = (defaults?: Partial<Utxo>): Utxo => ({
	...{
		txid: binToHex(sha256.hash(bigIntToVmNumber(randomInt()))),
		vout: Math.floor(Math.random() * 10),
		satoshis: 100_000n + randomInt(),
	},
	...defaults,
});

export const randomToken = (defaults?: Partial<TokenDetails>): TokenDetails => ({
	...{
		category: binToHex(sha256.hash(bigIntToVmNumber(randomInt()))),
		amount: 100_000n + randomInt(),
	},
	...defaults,
});

export const randomNFT = (defaults?: Partial<TokenDetails>): TokenDetails => ({
	...{
		category: binToHex(sha256.hash(bigIntToVmNumber(randomInt()))),
		amount: 0n,
		nft: {
			commitment: binToHex(sha256.hash(bigIntToVmNumber(randomInt()))).slice(0, 8),
			capability: NonFungibleTokenCapability.none,
		},
	},
	...defaults,
});
