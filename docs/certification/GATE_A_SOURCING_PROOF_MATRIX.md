# Gate A — SOURCING_CERTIFIED proof matrix

A row is REAL only when a deterministic test executes a production seam. Harness-only rows remain GAP and block certification.

| # | Scenario | Status | Production proof |
|---|---|---|---|
| 1 | duplicate_same_page | REAL | cj-full-catalog-sync-gate-a-pagination.test.js → production syncCategory + seenIds |
| 2 | duplicate_across_pages | REAL | same real pagination seam |
| 3 | pages_reordered | REAL | production candidate upsert keyed by supplier identity converges independently of arrival order |
| 4 | repeated_cursor | CONDITIONAL N/A | CJ and Ali current adapters expose no cursor-pagination contract. Scenario remains mandatory for any future cursor-based adapter; it is not fabricated for page-number providers. |
| 5 | empty_intermediate_page | REAL | real syncCategory continues to next page |
| 6 | partial_response | REAL | production catalog-import-orchestrator test sends products + invalid and proves exact balanced accounting with PARTIAL_BLOCKED |
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

**17/18 production-applicable scenarios are REAL; repeated_cursor is CONDITIONAL N/A for the current CJ/Ali provider set. No current-provider GAP remains.**

Certification interpretation: the 18-scenario contract remains frozen. Provider applicability is evaluated before execution; a cursor-based future provider MUST implement repeated-cursor protection before Gate A can pass for that provider. Current CJ/Ali certification must not invent an unused cursor runtime path. prove page reordering against a production ingestion/persistence seam; bind repeated-cursor protection to the production abstraction that owns cursor pagination (or explicit provider N/A with generic cursor proof); prove partial responses through the real connector → V2 partition/accounting seam.
