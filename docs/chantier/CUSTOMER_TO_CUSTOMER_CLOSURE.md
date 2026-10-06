# Customer-to-Customer Closure — execution plan

## Goal

Prove one complete Komerce business loop:

`CLIENT PAID → PO → SUPPLIER ORDER → SUPPLIER PAYMENT → SUPPLIER FULFILLMENT → HUB RECEIPT → MARKET LEG → CLIENT HANDOFF → FINANCIAL CLOSE`

The proof must remain capability-scoped. A green upstream step never promotes the next step automatically.

## Lot 1 — Supplier fulfillment fact foundation

Owner: purchasing

Deliver:
- canonical persisted provider-side fulfillment fact;
- FULFILLMENT reconciler using the existing supplier reconciliation contract;
- strict separation from parcels/shipments/customer delivery.

Exit:
- deterministic unit and PostgreSQL tests;
- no provider mutation.

## Lot 2 — Provider fulfillment readers

Owner: supplier-connectivity adapters, consumed by purchasing.

Priority:
1. CJ
2. AliExpress
3. Allegro where contract allows it

Each reader must return bounded native facts only:
- exact supplier order identity;
- provider shipment/fulfillment status;
- quantity when provider exposes it;
- carrier/tracking when exposed;
- stable evidence reference.

Exit:
- capability ledger updated per provider;
- no ORDER/PAYMENT proof reused as FULFILLMENT proof.

## Lot 3 — Supplier payment closure

Owner: purchasing.

Close only providers with real monetary proof.

CJ:
- execute the already bounded real-debit path only under explicit operator authorization;
- persist billingHistory evidence;
- promote PAYMENT only on exact positive amount/currency match.

Other providers remain independently scoped.

Exit:
- SUPPLIER_PAYMENT_MATCHED is evidence-backed, never inferred from order state.

## Lot 4 — Hub inbound reconciliation

Owner: logistics.

Build a canonical confrontation:

`expected supplier fulfillment → parcel physically received → contents/quantity verified`

Existing assets to reuse:
- parcels / parcel_items / parcel_events;
- scan-engine;
- qty_received;
- missing_item / unexpected_item / damaged_item / weight_mismatch incidents.

Exit:
- explicit `INBOUND_MATCHED | MISMATCH | PENDING`;
- supplier tracking alone never equals Hub receipt.

## Lot 5 — Market leg and customer handoff

Owner: logistics + orders at lifecycle boundary.

Prove:

`HUB_RECEIVED → MARKET_LEG → RELAY/LAST_MILE → CUSTOMER_COLLECTED/DELIVERED`

Reuse:
- relay/pickup authorization;
- parcel scans;
- notifications;
- order status machine.

Exit:
- customer handoff backed by physical/authorized event;
- orders remains sole owner of customer order lifecycle.

## Lot 6 — Exception and financial closure

Owners: incident-management, refunds, economic-engine/payments/settlement as applicable.

Prove normal and abnormal endings.

Normal:
`CUSTOMER_HANDOFF_MATCHED + financial facts reconciled → ORDER CLOSED`

Abnormal:
`missing/damaged/wrong/lost → incident → replacement/refund → financial reconciliation → CLOSED`

Exit:
- no order closes merely because a provider says delivered;
- no refund/replacement leaves unresolved financial divergence.

## Final Golden

Run one bounded end-to-end scenario through the real application boundaries:

`customer payment
→ purchasing trigger
→ supplier order
→ supplier payment evidence
→ supplier fulfillment evidence
→ Hub receipt
→ downstream logistics
→ customer handoff
→ financial close`

Every boundary emits its own canonical verdict and preserved evidence.

The final Golden is green only when all required capability verdicts are green independently.

## Implemented Golden

Canonical PostgreSQL proof:
- `tests/e2e-api/customer-to-customer.golden.e2e.test.js`

The scenario uses one customer order and preserves the independence of every boundary:
- provider fulfillment + tracking remains Hub `PENDING` until a physical `RECEIVE` exists;
- a parcel at the relay remains handoff `PENDING` until an authorized collection scan exists;
- financial close remains `PENDING` until handoff is proven;
- the terminal verdict is `FINANCIAL_CLOSE_MATCHED` only after all canonical facts agree.

External network calls are intentionally outside this Golden. Provider/API capabilities remain certified independently and the Golden consumes only their canonical persisted facts.
