# CJ purchasing P4 — Golden triggerPurchasing Sandbox proof

Date: 2026-10-04
Provider: CJdropshipping
Capability: purchasing.auto_order
Environment: CJ SANDBOX + ephemeral PostgreSQL

## Preserved execution

Issue-triggered isolated Golden completed successfully on protected main.

Observed Golden path:

B2C paid
→ exact CJ SKU/SOI
→ real triggerPurchasing()
→ purchase_line
→ purchase_order persisted before provider mutation
→ CJ Sandbox createOrderV2
→ exact provider read-back
→ supplier_order_id persisted
→ PO confirmed/auto_ordered
→ triggerPurchasing replay
→ same PO / zero duplicate PO

Sanitized execution facts:

- proof = CJ_GOLDEN_TRIGGER_PURCHASING
- sandbox = true
- payment_invoked = false
- confirmation_invoked = false
- first_status = auto_ordered
- replay_status = already_exists
- purchase_order_count = 1

The exact run also produced a real CJ Sandbox supplier_order_id and exact supplier_unit_ref, but those values are intentionally not required as canonical configuration.

## P-level interpretation

P1: real Sandbox create/read-back contract.
P2: CJ adapter maps the exact native order contract and duplicate recovery.
P3: the canonical Purchasing pipeline persists PO/execution facts through the real orchestrator.
P4: the bounded Golden traverses the complete capability path from a paid B2C order to provider order creation, read-back, persistence and idempotent replay.

This P4 is strictly for purchasing.auto_order in CJ Sandbox. It does not certify supplier payment, real debit, fulfillment or production activation.
