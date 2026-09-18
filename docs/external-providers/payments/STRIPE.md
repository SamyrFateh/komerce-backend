# Stripe — External Provider Contract Analysis

Analysis date: **2026-09-18**  
Family: **payment**  
Consumer: **payments**  
Current highest proof: **P2 PASS candidate (pending PR gates)**  
Current gate: **P3 — prove the real Komerce DB/API payment pipeline against the qualified Stripe mapping**

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

Implementation authority: `routes/payments.js` → `services/payment-stripe.js`. The former orphan duplicate `services/create-stripe-order-intent.js` is removed by the P2 convergence.

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

This read-only seed has now been exercised against the real Stripe TEST account as part of the P0/P1 evidence below.

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
| Create PaymentIntent | YES | YES | **P1 PASS — TEST create observed** |
| Retrieve PaymentIntent | YES | YES | **P1 PASS — exact read-back observed** |
| Stable payment reference | YES | YES | **P1 PASS** |
| Success webhook | YES | YES | **P1 PASS — Stripe-originated TEST delivery HTTP 200** |
| Failure webhook | YES | YES | configured/listened; destructive failure path not separately triggered |
| Signature verification | YES | YES | **P1 PASS — real Stripe-signed TEST events accepted** |
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
| P0 Business readiness | **PASS (TEST)** | TEST credentials accepted; one enabled webhook observed; livemode=false; required payment events configured; API version 2026-03-25.dahlia |
| P1 Raw API | **PASS (TEST)** | balance/read APIs accepted; PaymentIntent create → exact retrieve → canceled cleanup; real Stripe-signed webhook delivery returned HTTP 200 |
| P2 Adapter | **PASS candidate** | canonical `createStripeIntent` maps exact amount/currency/order metadata/idempotency; existing intents are read back and must match exactly; drift/read failure/non-reusable state hard-stop |
| P3 Pipeline | **NEXT** | existing Komerce DB/API pipeline evidence to re-run against the now-qualified P2 boundary |
| P4 Golden E2E | **BLOCKED** | controlled Komerce order → Stripe test payment → real webhook confirmation still to prove |

Registry classification: highest_proof = P1.


## 6bis. Real Stripe TEST evidence — 2026-09-18

The following bounded facts were observed against the real **Komerce sandbox** Stripe environment.

### P0

- secret key present and classified TEST;
- webhook signing secret configured in the Komerce Railway environment;
- Stripe API authentication accepted;
- exactly one Stripe webhook destination observed for the Komerce payment endpoint;
- destination status enabled;
- destination livemode=false;
- Stripe API version observed: `2026-03-25.dahlia`;
- `payment_intent.succeeded` and `payment_intent.payment_failed` are enabled on the destination;
- unsigned manual POST to the endpoint returned HTTP 400 `Webhook signature invalid`, proving fail-closed signature enforcement before business handling.

### P1 — provider reads

Read-only provider calls succeeded:

- `balance.retrieve()`;
- `paymentIntents.list({ limit: 1 })`;
- `webhookEndpoints.list({ limit: 100 })`.

No balance amount, customer data or provider secret is retained as proof.

### P1 — real provider webhook

Stripe TEST generated provider events and delivered them to the configured Railway endpoint:

- `payment_intent.created` → HTTP 200 with `{"received":true}`;
- `payment_intent.succeeded` → HTTP 200 with `{"received":true,"ignored":true}` because the Stripe CLI fixture had no Komerce `metadata.order_id`.

The latter is the expected safe behavior: the provider signature is accepted, but an event not bound to a Komerce order cannot confirm an arbitrary order.

### P1 — PaymentIntent create/read-back

A controlled Stripe TEST PaymentIntent was created with:

- amount = 1234 minor units;
- currency = EUR;
- bounded Komerce proof metadata;
- stable idempotency key.

The same PaymentIntent was then retrieved and proved:

- same external reference;
- exact amount;
- exact currency;
- exact metadata;
- livemode=false.

The fixture ended in `requires_payment_method` and was canceled successfully as cleanup. No payment method was attached and no charge was made.



## 6ter. P2 — Komerce ↔ Stripe mapping

P2 converges the implementation on one runtime authority:

```text
routes/payments.js
  → services/payment-stripe.js
  → Stripe SDK
```

The orphan duplicate `services/create-stripe-order-intent.js` and its dedicated test are removed.

The active adapter/service mapping is now proved to send:

- amount = exact `orders.total_eur` converted to integer EUR minor units;
- currency = `eur`;
- metadata.order_id = exact Komerce order ID;
- metadata.order_reference = exact Komerce order reference;
- metadata.komerce = `true`;
- description bound to the Komerce order reference;
- stable idempotency key = `order_pi_<order.id>`.

Existing PaymentIntent reuse is now fail-closed:

1. retrieve the exact stored `stripe_payment_id`;
2. require exact amount;
3. require exact EUR currency;
4. require exact order ID/reference/marker metadata;
5. require a reusable Stripe status;
6. only then expose the existing client secret.

If read-back fails, provider data drifts, or the PaymentIntent is not reusable, Komerce blocks instead of silently creating/reusing another intent.

A newly created PaymentIntent is also checked against the same contract before its external reference is persisted on the order.

P2 evidence is in `tests/unit/payment-stripe.test.js` and the G2 invariant in `tests/integration/isweep-invariants.test.js`.


## 7. Findings

### A. Implementation maturity is not proof maturity

The path already has the right reliability shape:

stable Komerce order → stable PaymentIntent → signed provider evidence → replay guard → canonical payment confirmation.

That is good architecture, but it does not replace P0/P1.

### B. P1 is now proven in Stripe TEST

The existing read-only probe seed has been exercised against the real provider, then extended by a controlled PaymentIntent create/read-back/cleanup and real Stripe-signed webhook deliveries. The next trust boundary is now P2: Komerce mapping, not provider discovery.

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
- the external Stripe contract is proved through **P1 in TEST**.

## 9. What Komerce must NOT claim yet

- Stripe **production** readiness proven;
- Stripe **production** raw API proven;
- real Stripe refund Golden proven;
- P4 Stripe Golden complete;
- disputes/chargebacks qualified;
- production/test environment contract formally proved.

## 10. Read-only proof runner

The first executable proof is now:

node scripts/stripe-provider-contract-proof.js --through=P1

It performs only read operations:

- balance.retrieve();
- paymentIntents.list({ limit: 1 });
- webhookEndpoints.list({ limit: 100 });

It never creates a PaymentIntent, refund, customer or payment method. Output is sanitized: no API key, webhook secret, balance amount, PaymentIntent ID, endpoint ID or customer data is emitted.

The runner fails closed on missing/ambiguous webhook configuration, environment mismatch, missing required events, unreadable provider state or unknown effective API version.
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
P0: PASS (TEST)  
P1: PASS (TEST)  
P2: PASS candidate (pending PR gates)  
P3: NEXT  
P4: BLOCKED  
HIGHEST PROOF: P2 candidate  
MAIN NEXT ACTION: prove the real Komerce DB/API payment pipeline (P3).

## Komerce conclusion

Stripe's external contract is proved through **P1 in the real Stripe TEST environment**, and the Komerce mapping is now converged and fail-closed for **P2**. Once the P2 PR gates pass, the next boundary is P3: the real Komerce DB/API payment pipeline, followed by a controlled P4 Golden.
