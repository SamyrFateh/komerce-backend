# External Provider Capability Audit V2

Date: 2026-10-06  
Scope: all external-provider domains  
Rule: DOMAIN → PROVIDER → CAPABILITY → PROOF LEVEL → STATUS

## Reading rule

A provider is never certified globally. A P-level applies only to the capability and environment explicitly named.

Statuses used here:

- PROVEN — evidence supports the declared capability and level.
- REPORTED — evidence exists but provenance/recheck is weaker than a current independent probe.
- GAP — implementation or historical evidence exists but has not been reconciled capability-by-capability.
- CLOSED — capability is known not to be available/proved for the provider.
- UNQUALIFIED — no acceptable capability proof assigned yet.

## 1. Catalog / Sourcing

| Provider | Capability | Current proof | Audit verdict | Next action |
|---|---|---:|---|---|
| Allegro | sourcing.exact_unit | P4 Sandbox | PROVEN | none |
| eBay | sourcing.catalog_pipeline | P3 Sandbox | PROVEN | buyer purchasing remains separate |
| AliExpress | catalog/sourcing live read + canonicalization | historical/live evidence exists | GAP | split catalog browse, exact unit, stock and canonicalization proofs into ledger entries |
| CJ | sourcing.catalog_stock | UNQUALIFIED | GAP | reconcile authoritative stock/catalog evidence capability-by-capability |
| Noon | connector/normalization | UNQUALIFIED | GAP | obtain real raw provider proof before P1 |
| Anthropic/OpenAI | enrichment tooling | UNQUALIFIED | GAP/TOOLING | certify only if runtime/tooling dependency remains business-relevant |
| Wikimedia/DummyJSON/EscuelaJS | external content tooling | UNQUALIFIED | TOOLING | keep separate from production source truth |

## 2. Purchasing / Supplier execution

| Provider | Capability | Current proof | Audit verdict | Next action |
|---|---|---:|---|---|
| Allegro | purchasing.readiness | P4 Sandbox | PROVEN | none |
| Allegro | purchasing.manual_procurement | P4 Sandbox | PROVEN | none |
| Allegro | purchasing.reconcile_order | legacy reconcile=P4 | RECLASSIFY | rename old generic reconcile to ORDER scope |
| Allegro | purchasing.auto_order | UNQUALIFIED | CLOSED | no buyer placeOrder API proved |
| AliExpress | purchasing.readiness | P4 live staging | PROVEN | none |
| AliExpress | purchasing.auto_order | P4 guarded live staging | PROVEN | ambiguous retry remains closed |
| AliExpress | purchasing.reconcile_order | evidence exists in Golden read-back | GAP | project explicit ORDER reconciliation capability |
| AliExpress | purchasing.reconcile_payment | UNQUALIFIED | GAP | requires payment + independent monetary proof |
| CJ | purchasing.order_create_readback | P1 Sandbox | PROVEN | exact VID/qty/orderNumber + duplicate recovery proved |
| CJ | purchasing.readiness | P1 guarded | PROVEN AT P1 | reconcile adapter/pipeline evidence before promotion |
| CJ | purchasing.payment_sandbox | P2 Sandbox | PROVEN | confirmOrder + simulatePay + paid read-back; no real debit |
| CJ | purchasing.grouped_parent_payment_sandbox | P2 Sandbox | PROVEN | parent identity + amount consistency + sandbox payment; real_debit_verified=false |
| CJ | purchasing.reconcile_payment | P2 code/read-only | GAP | live positive billingHistory debit proof still missing |
| CJ | purchasing.reconcile_fulfillment | UNQUALIFIED | GAP | do not infer from order/payment state |

## 3. Payments

| Provider | Capability | Current proof | Audit verdict | Next action |
|---|---|---:|---|---|
| Stripe | payments.intent_webhook_confirmation | P4 TEST | PROVEN | split refund into separate capability |
| Stripe | payments.refund | not capability-certified here | GAP | certify independently |
| PayPal | payments.order_create_readback | P1 Sandbox reported | REPORTED | independently re-run before stronger promotion |
| PayPal | payments.capture | UNQUALIFIED | GAP | payer approval + capture + exact read-back required |
| PayPal | payments.webhook | implementation exists | GAP | real signed delivery/canonical consumption proof required |
| MTN MoMo CG | oauth/status adapter | UNQUALIFIED | GAP | split auth, request payment, status reconciliation |
| Orange Money CM | oauth/payment/status adapter | UNQUALIFIED | GAP | merchant readiness first, then P1 |
| KartaPay KM | request/webhook/status recheck | UNQUALIFIED | GAP | prove real staging conversation capability-by-capability |

## 4. Notifications / Messaging / Identity

| Provider | Capability | Current proof | Audit verdict | Next action |
|---|---|---:|---|---|
| Meta WhatsApp | outbound send | UNQUALIFIED in common ledger | GAP | reconcile existing production evidence into P0..P4 |
| Meta WhatsApp | inbound webhook | UNQUALIFIED | GAP | signature + canonical event proof |
| Meta WhatsApp | OTP delivery | UNQUALIFIED | GAP | separate auth-identity capability from generic messaging |
| AuthKey | outbound WhatsApp | UNQUALIFIED | GAP | prove real send/readback/delivery semantics |
| AuthKey | webhook verification | implementation exists | GAP | qualify independently |
| Brevo | transactional email client | UNQUALIFIED | GAP | active runtime caller + delivery proof missing |
| Twilio | none active | UNQUALIFIED | CLOSED/CONFIG-ONLY | remove or keep explicitly dormant |
| Africa's Talking | none active | UNQUALIFIED | CLOSED/CONFIG-ONLY | remove or keep explicitly dormant |

## 5. Logistics / Documents / Media

| Provider | Capability | Current proof | Audit verdict | Next action |
|---|---|---:|---|---|
| QRServer | QR rendering dependency | UNQUALIFIED | GAP | decide whether runtime dependence is acceptable; prove bounded read/failure behavior |
| ImageKit | upload tooling | UNQUALIFIED | TOOLING/GAP | certify only current canonical media path |
| Cloudinary | legacy/override upload | UNQUALIFIED | VERIFY NEED | retire if no longer authoritative |
| Sentry | error forwarding | UNQUALIFIED | GAP/OPTIONAL | qualify optional observability contract if operationally required |

## 6. Cross-domain findings

1. The global provider registry is inventory, not capability truth.
2. `highest_proof` at provider level is only a maximum observed level and must never imply every capability has that level.
3. The capability ledger is now the intended decision surface.
4. Generic `purchasing.reconcile` is obsolete vocabulary after the canonical reconciliation contract. Existing entries must migrate to:
   - `purchasing.reconcile_order`
   - `purchasing.reconcile_payment`
   - `purchasing.reconcile_fulfillment`
5. Payment status, supplier order status and fulfillment status are independent proof surfaces.
6. Runtime activation must remain guarded by capability proof, not by adapter existence alone.

## 7. Priority queue

### Priority A — money
Stripe refund, PayPal capture/webhook, MTN, Orange Money, KartaPay.

### Priority B — supplier commitments
CJ capability requalification, AliExpress explicit reconcile_order/reconcile_payment, Allegro reconcile rename.

### Priority C — customer identity/communications
Meta WhatsApp send/inbound/OTP, AuthKey, Brevo.

### Priority D — source truth
AliExpress sourcing decomposition, CJ catalog_stock, Noon P1.

### Priority E — optional/tooling
QRServer, Sentry, ImageKit, Cloudinary, public content sources.

## 8. Definition of done

The audit is complete when every active external runtime boundary has:

```text
domain
provider
capability
environment
availability
P0..P4 or UNQUALIFIED
evidence
limitations
runtime guard/authority
reconciliation scope when applicable
```

and no business feature infers safety from a provider-global label.
