# CJ sourcing P3 — real isolated staging proof

Date: 2026-09-24
Provider: CJdropshipping
Capability: sourcing.catalog_pipeline
Environment: LIVE provider reads + isolated ephemeral PostgreSQL staging pipeline

## Preserved execution

GitHub Actions run 36058899975, attempt 3 completed successfully after the bounded CJ pilot fixes.

Observed result:

- actual_source_reads = 4 (1 bounded list + 3 exact product reads)
- imported_candidates = 3
- accepted = 3
- rejected = 0
- pipeline_status = CANONICAL_RESOLVED
- canonical_resolved = true
- shadow_status = recorded
- published_products = 0
- no Railway database write
- no order, reservation or provider mutation

Exact CJ product identities used:

- 166757A7-7890-4603-B39A-1FB23936757F
- 2407180832421610200
- 7C59DE5B-A511-4920-88A8-C808B21476EE

## P-level interpretation

P1: real CJ reads observed.
P2: CJ connector/normalization maps provider data into the Komerce source contract.
P3: the real provider data traversed the isolated canonical sourcing pipeline through candidate import and canonical resolution/shadow recording.

This proof does not certify publication, sellability, purchasing, payment or fulfillment.

## Stock follow-up

A later bounded run queried /product/stock/getInventoryByPid for 11 exact VIDs and preserved warehouse breakdowns. Ten variants had no CJ-managed quantity in the consulted warehouse while one exact VID had CJ-managed stock. This is evidence for the separate sourcing.catalog_stock capability and must not be interpreted as general sellability.
