# Stripe — External Provider Contract Analysis

Analysis date: **2026-09-18**  
Family: **payment**  
Consumer: **payments**  
Current highest proof: **CONVERSATION PASS**  
Current gate: **P0 BLOCKED — current Stripe account/business readiness not yet re-proved under this framework**

Existing code is evidence to inspect, not an automatic external PASS.

## 1. Official contract understood

Relevant official Stripe surfaces:

- PaymentIntent creation/retrieval: https://docs.stripe.com/api/payment_intents
- PaymentIntent integration: https://docs.stripe.com/payments/payment-intents
- Webhook/signature handling: https://docs.stripe.com/webhooks
- Payment events: https://docs.stripe.com/webhooks/handling-payment-events
- Refund creation: https://docs.stripe.com/api/refunds/create
- Idempotent requests: https://docs.stripe.com/api/idempotent_requests

Provider facts relevant to Komerce:

- one PaymentIntent can represent one order/session and can be retrieved later;
- payment state can be confirmed server-side from PaymentIntent state and/or signed Stripe events;
- payment_intent.succeeded and payment_intent.payment_failed are official asynchronous events;
- webhook signature verification requires the raw request body, Stripe-Signature and endpoint secret;
- refunds can target a PaymentIntent and may be partial;
- mutating Stripe requests support idempotency keys.

These facts complete the conversation vocabulary. They do not prove that the current Komerce Stripe account is ready or that a real provider call has been re-proved.

## 2. Current Komerce boundary

### Payment creation

POST /api/payments/stripe/intent currently:

- resolves the exact Komerce order;
- checks ownership/role and payment mode;
- rejects an already-paid order;
- reuses an existing reusable PaymentIntent when possible;
- otherwise creates one in EUR cents;
- binds order_id and order_reference in metadata;
- uses a stable idempotency key;
- persists the returned PaymentIntent ID.

Implementation: routes/payments.js, services/payment-stripe.js, services/create-stripe-order-intent.js.

### Payment confirmation

POST /api/payments/stripe/webhook currently:

- preserves the raw body;
- verifies the Stripe signature with STRIPE_WEBHOOK_SECRET;
- rejects invalid signatures;
- deduplicates by Stripe Event ID;
- handles payment_intent.succeeded and payment_intent.payment_failed;
- resolves the Komerce order from PaymentIntent metadata;
- guards against double confirmation;
- confirms through the canonical Komerce payment cycle.

Implementation: server.js, routes/payments.js, services/payment-stripe.js.

### Refund

For Stripe-paid orders, services/refund-service.js:

- creates an internal pending refund record before the provider call;
- calls Stripe refunds.create with the PaymentIntent reference and exact EUR cents;
- supplies a stable idempotency key;
- persists the returned Stripe Refund ID;
- marks the internal refund completed after the provider return.

### Existing read-only connectivity seed

routes/health.js already contains a read-only stripe.balance.retrieve() call.

This is a useful seed for P1, but it is **not P1 PASS** until a bounded real provider result is captured by the External Provider Contract proof flow.

## 3. Conversation contract

### EXPECTS

one exact Komerce order → one Stripe payment intent → externally confirmed payment state → one canonical Komerce payment confirmation.

Required downstream facts:

- stable external payment reference;
- amount and currency;
- exact Komerce order binding;
- provider payment verdict;
- replay-safe provider event reference when webhook-confirmed.

### REQUIRES

P0 must prove:

- valid Stripe account;
- credentials valid for the intended environment;
- account allowed to process the intended EUR payment flow;
- required webhook endpoint configured;
- required event types enabled;
- webhook secret corresponds to that endpoint/environment;
- effective Stripe API version known.

Environment variables STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are configuration evidence, not provider-readiness proof.

### SENDS

PaymentIntent creation sends amount, EUR currency, order metadata and an idempotency key.

Refund creation sends PaymentIntent reference, exact refund amount, reason, metadata and an idempotency key.

Webhook receive boundary expects raw body + Stripe-Signature + Stripe Event.

### RECEIVES

- PaymentIntent ID and state;
- Stripe Event ID/type and PaymentIntent payload;
- Refund ID and refund object/status.

### CONFIRMS

Officially valid confirmation mechanisms relevant to Komerce are:

1. server-side PaymentIntent read-back;
2. signed Stripe webhook evidence.

A browser/client return is not treated as payment confirmation.

### EXPOSES

Canonical facts safe for the Payments feature:

- provider = stripe;
- external_payment_ref = PaymentIntent ID;
- payment_verdict = succeeded | failed | pending/unconfirmed;
- amount;
- currency;
- provider_event_ref = Event ID when webhook-confirmed.

## 4. Capability profile

| Capability | Official contract | Komerce implementation | External proof state |
|---|---|---|---|
| Create PaymentIntent | YES | YES | P1 NOT RE-PROVED |
| Retrieve PaymentIntent | YES | YES | P1 NOT RE-PROVED |
| Stable payment reference | YES | YES | contract known; real proof pending |
| Success webhook | YES | YES | real delivery not re-proved |
| Failure webhook | YES | YES | real delivery not re-proved |
| Signature verification | YES | YES | internal tests only in this framework |
| Event replay protection | Event ID available | YES | internal proof present |
| Request idempotency | YES | YES for PI/refund | internal mapping proof present |
| Partial refund | YES | YES by amount | real provider refund not re-proved |
| Refund reference | YES | YES | real proof pending |
| Live account readiness | provider exposes account/payment state | not standardized as proof | UNKNOWN / P0 BLOCKED |
| Disputes/chargebacks | supported by Stripe | not qualified here | UNKNOWN |

## 5. Internal evidence already present

Unit/invariant evidence includes:

- tests/unit/payment-stripe.test.js
- tests/unit/payments-route.test.js
- tests/unit/payments-webhook.test.js
- tests/invariants/payments.webhook-idempotency.test.js
- tests/invariants/payments.no-double-confirm.test.js

Pipeline-style DB/API evidence includes:

- tests/e2e-api/orders.checkout-payment-cycle.e2e.test.js
- tests/e2e-api/inventory.stock-never-negative.e2e.test.js
- tests/e2e-api/refunds.no-double-application.e2e.test.js

These are strong internal composition proofs, but their Stripe events are generated/signed locally with test secrets. They therefore do not prove that Stripe itself accepted the originating PaymentIntent, emitted the webhook, or can read the provider object back.

Under the doctrine, downstream stages cannot PASS while P0/P1 are blocked.

## 6. Proof stage status

| Stage | Status | Evidence / blocker |
|---|---|---|
| Conversation | **PASS** | official Stripe contract + Komerce boundary fully describable |
| P0 Business readiness | **BLOCKED** | current account/environment/payment capability + webhook registration not yet captured |
| P1 Raw API | **BLOCKED** | no current bounded direct Stripe proof recorded |
| P2 Adapter | **BLOCKED BY P0/P1** | internal service tests exist |
| P3 Pipeline | **BLOCKED BY P0/P1** | real Komerce pipeline tests exist with locally generated Stripe-shaped events |
| P4 Golden E2E | **BLOCKED** | no current real Stripe test-mode side-effect + provider confirmation proof |

Registry classification: highest_proof = CONVERSATION.

## 7. Findings

### A. Implementation maturity is not proof maturity

The path already has the right reliability shape:

stable Komerce order → stable PaymentIntent → signed provider evidence → replay guard → canonical payment confirmation.

That is good architecture, but it does not replace P0/P1.

### B. P1 is close

The existing read-only balance.retrieve() health probe proves that Komerce already has the seed of a raw connectivity probe. The missing part is bounded/sanitized evidence plus explicit assertions through the shared provider-contract proof engine.

### C. Refund deserves a distinct confirmation decision

Today a successful refunds.create() return completes the internal refund row.

Before refund P4, Komerce must explicitly decide and prove whether canonical refund confirmation is:

- successful Refund object return; or
- mutation success plus subsequent Refund read-back / refund webhook.

Nothing is promoted by assumption.

### D. Effective Stripe API version is not explicitly pinned in client construction

Current Stripe clients are initialized with the secret key without an explicit apiVersion option.

This is not automatically a defect, but the effective provider API version is part of the external contract and must be recorded during P0/P1.

## 8. What Komerce may safely claim today

- Stripe is implemented as a payment provider.
- PaymentIntent creation/reuse exists.
- exact Komerce order binding exists.
- signed webhook verification exists.
- succeeded/failed payment handling exists.
- event replay protection exists.
- no-double-confirm guards exist.
- refund request idempotency exists.
- the external Stripe contract is understood at Conversation level.

## 9. What Komerce must NOT claim yet

- current Stripe account P0 readiness proven;
- current raw Stripe API P1 proven;
- real Stripe webhook delivery proven by this framework;
- real Stripe refund Golden proven;
- P4 Stripe Golden complete;
- disputes/chargebacks qualified;
- production/test environment contract formally proved.

## 10. Exact next proof

### P0 — read-only

Prove only bounded account facts:

- credentials accepted;
- intended environment identified;
- account/payment capability sufficient for the intended EUR flow;
- required webhook endpoint and event types configured;
- webhook secret/environment pairing known;
- effective Stripe API version recorded.

No customer payment is created at P0.

### P1A — raw read-only connectivity

Use the smallest direct provider call, starting from the existing balance.retrieve() idea.

Persist no balance values. Record only bounded facts such as provider reachable, auth accepted, environment/context and provider request/status identifiers when available.

### P1B — PaymentIntent contract, test mode only

create one minimal PaymentIntent → retrieve the same PaymentIntent → prove exact id/amount/currency/metadata → cancel/clean up if appropriate.

Use one stable idempotency key. No real payment method or charge is needed merely to prove create/read-back.

### P1C — webhook contract

Stripe-originated test event → Komerce endpoint → valid signature → Event ID observed → same event replay remains idempotent.

### P2/P3/P4

Only after P0/P1 pass:

- P2 proves canonical request/response mapping;
- P3 proves the Komerce payment pipeline consumes only canonical provider facts;
- P4 runs a controlled Stripe test-mode Golden through real provider-side payment success and real signed webhook delivery.

Refund P4 remains a separate mutation proof unless intentionally included.

## 11. Summary

PROVIDER: Stripe  
FAMILY: payment  
CONSUMER: payments  
CONVERSATION: PASS  
P0: BLOCKED  
P1: BLOCKED  
P2: BLOCKED BY UPSTREAM  
P3: BLOCKED BY UPSTREAM  
P4: BLOCKED  
HIGHEST PROOF: CONVERSATION  
MAIN NEXT ACTION: read-only P0/P1 proof against Stripe, then controlled test-mode PaymentIntent Golden.

## Komerce conclusion

Stripe's contract is understood and the internal implementation is already mature, but implementation tests are not provider proof. Stripe stays at **Conversation PASS** until Komerce captures current account readiness and a bounded direct Stripe API proof. Only then can the existing adapter/pipeline evidence be promoted through P2/P3 and a real test-mode Golden be executed.
