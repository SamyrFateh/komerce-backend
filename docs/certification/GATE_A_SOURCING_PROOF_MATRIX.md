# Gate A — SOURCING_CERTIFIED proof matrix

A row is REAL only when a deterministic test executes a production seam. Harness-only rows remain GAP and block certification.

| # | Scenario | Status | Production proof |
|---|---|---|---|
| 1 | duplicate_same_page | REAL | cj-full-catalog-sync-gate-a-pagination.test.js → production syncCategory + seenIds |
| 2 | duplicate_across_pages | REAL | same real pagination seam |
| 3 | pages_reordered | GAP | harness only; no production-seam proof yet |
| 4 | repeated_cursor | GAP | page-number CJ worker has no cursor invariant; harness only |
| 5 | empty_intermediate_page | REAL | real syncCategory continues to next page |
| 6 | partial_response | GAP | harness only; connector/batch partial-shape proof must be bound explicitly |
| 7 | timeout | REAL | AliExpress production invokeTop AbortController test |
| 8 | http_429 | REAL | CJ/Ali production connector failure injection + CJ quota pause |
| 9 | http_5xx | REAL | CJ/Ali production connector failure injection |
| 10 | invalid_auth | REAL | CJ/Ali production connector failure injection, secret hygiene |
| 11 | field_type_drift | REAL | canonical V2 production validator torture |
| 12 | supplier_sku_attribute_change | REAL | canonical V2 snapshot/identity torture |
| 13 | disappears_full_snapshot | REAL | production archiveMissingCandidatesFromCatalogImport |
| 14 | disappears_partial_snapshot | REAL | partial import path deliberately never invokes archive seam |
| 15 | archived_product_returns | REAL | production candidate upsert reactivates archived identity |
| 16 | crash_after_checkpoint | REAL | production checkpoint tests prove success advances and error does not |
| 17 | concurrent_imports | REAL | production unique upsert seam ON CONFLICT (supplier_name, supplier_product_id) |
| 18 | unknown_extra_source_fields | REAL | V2 rejects leakage; raw provenance remains preserved |

## Current verdict

**15/18 REAL, 3/18 GAP. SOURCING_CERTIFIED MUST NOT be claimed yet.**

Remaining work: prove page reordering against a production ingestion/persistence seam; bind repeated-cursor protection to the production abstraction that owns cursor pagination (or explicit provider N/A with generic cursor proof); prove partial responses through the real connector → V2 partition/accounting seam.
