/**
 * BCHN P2P reject codes (consensus/validation.h).
 * Used to classify validation failures by severity and category.
 */

/** Malformed data structure. */
export const REJECT_MALFORMED = 0x01;

/** Network rule violation (consensus failure). */
export const REJECT_INVALID = 0x10;

/** Obsolete version. */
export const REJECT_OBSOLETE = 0x11;

/** Already known (duplicate tx/block). */
export const REJECT_DUPLICATE = 0x12;

/** Standard policy violation. */
export const REJECT_NONSTANDARD = 0x40;

/** Fee too low for relay. */
export const REJECT_INSUFFICIENTFEE = 0x42;

/** Conflicts with checkpoint. */
export const REJECT_CHECKPOINT = 0x43;

/** Absurdly high fee (internal-only, not sent over P2P). */
export const REJECT_HIGHFEE = 0x100;
