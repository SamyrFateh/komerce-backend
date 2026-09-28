# Gate B — CATALOG_CERTIFIED real-proof matrix

A scenario is REAL only when a deterministic test executes a production refinery/catalog seam. The certification is network-free and paid-AI-free.

| # | Scenario | Verdict | Production proof |
|---|---|---|---|
| 1 | missing_or_invalid_price | REAL | `catalog-certification.test.js`, `gate-b-publication-torture.test.js` |
| 2 | unknown_currency | REAL | supplier scanner/pricing regression tests; production currency whitelist/conversion seam |
| 3 | duplicate_sku | REAL | `gate-b-semantic-torture.test.js` → canonical V2 validator |
| 4 | missing_primary_media | REAL | `catalog-certification.test.js`, `gate-b-publication-torture.test.js` |
| 5 | malformed_media_url | REAL | `gate-b-semantic-torture.test.js` → canonical V2 URI validation |
| 6 | absurd_dimensions_or_weight | REAL | `gate-b-physical-bounds.test.js` → canonical V2 physical bounds |
| 7 | missing_category | REAL | `catalog-certification.test.js`, `gate-b-publication-torture.test.js` |
| 8 | ambiguous_category | REAL | `gate-b-semantic-torture.test.js` → dynamic classifier returns unresolved/default low-confidence |
| 9 | taxonomy_change | REAL | `gate-b-semantic-torture.test.js` + catalog certification active-taxonomy guard |
| 10 | contradictory_attributes | REAL | `gate-b-semantic-torture.test.js` → canonical V2 option/value consistency |
| 11 | zero_variants | REAL | `catalog-promotion.test.js` → explicit empty `sellable_units` rejected before writes; catalog certification also requires active supplier SKU |
| 12 | duplicate_variants | REAL | normalized V2 contract tests reject duplicate combinations/SKUs |
| 13 | product_update_after_acceptance | REAL | `catalog-promotion.test.js` → re-promotion updates same SKU identity; disappeared SKU deactivated, never deleted |
| 14 | eligibility_exclusion | REAL | catalog-import orchestrator exclusion tests |
| 15 | malformed_description_or_specs | REAL | `gate-b-publication-torture.test.js` description fail-closed + normalized V2 schema/contract validation for structured specifications |
| 16 | interrupted_refinery_batch | REAL | `gate-b-interrupted-json-batch.test.js` → production JSON transaction seam rolls back, never commits, durable FAILED evidence |

## Final verdict

**16/16 Gate B scenarios are bound to deterministic production seams.**

Gate B is therefore **CATALOG_CERTIFIED** for the current canonical catalog/refinery contract.

This verdict does not permit bypassing WATCH/quarantine. Human corrections remain audited overrides and must re-enter the normal scan/certification path.

No supplier network and no paid AI are required to reproduce this certification.
