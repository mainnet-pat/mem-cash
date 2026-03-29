# @mem-cash/validation

Stateless transaction evaluator for Bitcoin Cash. Validates raw transaction hex against consensus rules, policy checks, and libauth VM script verification.

## Usage

```typescript
import { createTxVerifier } from "@mem-cash/validation";

const verifier = await createTxVerifier({
  vmVersion: "BCH_2025_05",
  standard: true,
});

const result = verifier.verify(rawHex, sourceOutputs, chainState);
if (result.success) {
  console.log(result.txid, result.fee, result.validatedTx);
} else {
  console.log(result.code, result.error); // BCHN reject code + reason
}
```

## Verification Pipeline

Matches BCHN's `AcceptToMemoryPool` order:

1. Decode transaction hex
2. Null prevout check (`bad-txns-prevout-null`)
3. Validate sourceOutputs count matches inputs (`bad-txns-inputs-missingorspent`)
4. Locktime finality (`bad-txns-nonfinal`)
5. Coinbase maturity (`bad-txns-premature-spend-of-coinbase`)
6. Unspendable inputs (`bad-txns-input-scriptpubkey-unspendable`)
7. Input value ranges (`bad-txns-inputvalues-outofrange`)
8. Output value ranges and fee computation (`bad-txns-outputvalues-outofrange`, `bad-txns-in-belowout`) -- per-output and cumulative sum checked against `MAX_MONEY`
9. BIP68 sequence locks (`non-BIP68-final`)
10. Min relay fee (`min relay fee not met`)
11. Absurd fee guard (`absurdly-high-fee`)
12. Dust check (`dust`)
13. VM script verification (`mandatory-script-verify-flag-failed` / `non-mandatory-script-verify-flag`)

All error strings and reject codes match BCHN exactly. The verifier implements BCHN's two-pass script verification to distinguish mandatory from non-mandatory failures.

## Config Validation

`createTxVerifier` rejects non-positive `minRelayFeePerKb` and `maxFee` values at construction time to prevent bypassing fee policy checks.
