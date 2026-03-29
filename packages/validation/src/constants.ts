/** Maximum total supply of BCH in satoshis (21 million × 10^8). */
export const MAX_MONEY = 2_100_000_000_000_000n;

/** Number of blocks before a coinbase output can be spent. */
export const COINBASE_MATURITY = 100;

/** Locktime values below this are interpreted as block heights; above as Unix timestamps. */
export const LOCKTIME_THRESHOLD = 500_000_000;

/** Sequence number indicating no relative lock-time or finality. */
export const SEQUENCE_FINAL = 0xffffffff;

/** BIP68: if bit 31 is set, sequence lock is disabled for this input. */
export const SEQUENCE_LOCKTIME_DISABLE_FLAG = 1 << 31;

/** BIP68: if bit 22 is set, lock is time-based; otherwise height-based. */
export const SEQUENCE_LOCKTIME_TYPE_FLAG = 1 << 22;

/** BIP68: mask for the 16-bit relative lock value. */
export const SEQUENCE_LOCKTIME_MASK = 0x0000ffff;

/** BIP68: time-based granularity in seconds (2^9 = 512). */
export const SEQUENCE_LOCKTIME_GRANULARITY = 512;

/** Coinbase transaction prevout txid (all zeros). */
export const NULL_TXID = "00".repeat(32);

/** Coinbase transaction prevout vout. */
export const NULL_VOUT = 0xffffffff;

/** OP_RETURN opcode — marks an output as provably unspendable. */
export const OP_RETURN = 0x6a;

/** Maximum locking script size in bytes. */
export const MAX_SCRIPT_SIZE = 10_000;

/** BIP113: number of previous blocks used to compute Median Time Past. */
export const MTP_BLOCK_COUNT = 11;

/** Default minimum relay fee in satoshis per kilobyte. */
export const DEFAULT_MIN_RELAY_FEE_PER_KB = 1000n;

/** Default maximum acceptable fee in satoshis (0.1 BCH). */
export const DEFAULT_MAX_FEE = 10_000_000n;
