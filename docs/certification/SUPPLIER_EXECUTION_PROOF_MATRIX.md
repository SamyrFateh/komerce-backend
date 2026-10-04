# Supplier Execution Certification — Proof Matrix

Contract: `komerce-supplier-execution-certification-v1`  
Gate: `SUPPLIER_EXECUTION_CERTIFIED`  
Scope: supplier execution only. **Supplier payment and financial reconciliation are explicitly out of scope and remain UNPROVEN.**

| Scenario | Proof | Status |
|---|---|---|
| `single_create_persisted` | `tests/unit/supplier-execution-persistence.test.js` — new provider order is persisted with canonical identity | REAL |
| `single_duplicate_replay` | `tests/unit/supplier-execution-persistence.test.js` + `tests/unit/cj-fulfillment-adapter.test.js` — duplicate provider create is recovered and persistence reuses the same native identity | REAL |
| `provider_timeout_after_create` | `tests/unit/purchasing-trigger-service.test.js` — ambiguous provider execution remains pending for replay with the same PO execution key | REAL |
| `crash_after_provider_response` | `tests/unit/purchasing-trigger-service.test.js` — provider mutation occurs only after PO commit; unexpected post-provider failure leaves PO replayable | REAL |
| `crash_after_execution_persist` | `tests/unit/purchasing-trigger-service.test.js` — supplier execution persistence occurs before local PO confirmation in one transaction | REAL |
| `same_order_resume` | `tests/unit/supplier-execution-persistence.test.js` — same provider + supplier_order_id reloads the existing execution order | REAL |
| `cross_po_rebind_refused` | `tests/unit/supplier-execution-persistence.test.js` + migration 279 DB unique/guard semantics | REAL |
| `exact_purchase_line_membership` | `tests/integration/supplier-execution-persistence-postgres.test.js` — execution order is linked to exact purchase_line with quantity | REAL |
| `grouped_two_children_parent` | `tests/integration/supplier-execution-persistence-postgres.test.js` + `tests/unit/cj-p2-grouped-parent-sandbox-proof.test.js` | REAL |
| `grouped_parent_member_mismatch` | `tests/integration/supplier-execution-persistence-postgres.test.js` — DB guard rejects parent/member from different PO | REAL |
| `grouped_parent_materialized_resume` | `tests/integration/supplier-execution-persistence-postgres.test.js` — persisted parent + members can be re-read as the resume state | REAL |
| `provider_native_field_isolation` | migration 279 + `services/supplier-execution-persistence.js` — no CJ-native column exists in canonical persistence | REAL |
| `alternate_provider_semantic_mapping` | `tests/unit/supplier-execution-persistence.test.js` — arbitrary provider namespace uses the same canonical fields | REAL |
| `unknown_provider_fact_fail_closed` | `tests/unit/supplier-execution-certification.test.js` — unknown scenarios/facts cannot silently widen certification | REAL |

## Explicitly not certified

The following capabilities are deliberately excluded from this gate:

- supplier production payment;
- payment reconciliation;
- expected amount vs debited amount reconciliation;
- replay after an ambiguous real debit / double-debit prevention;
- B2B accounting reconciliation.

A green `SUPPLIER_EXECUTION_CERTIFIED` verdict must never be interpreted as a financial certification.
