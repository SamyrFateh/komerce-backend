# Allegro Sandbox — Provider API Analysis

## Purpose

Short qualification record for the Allegro Sandbox provider contract as actually exercised by Komerce.

This file summarizes sourcing/API capabilities and limits. Detailed operational setup remains in `docs/allegro-sandbox.md`. Provider proof methodology remains in `docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md`.

Analysis date: **2026-09-18**

---

## 1. Provider identity

| Field | Value |
|---|---|
| Provider | Allegro |
| Environment analysed | Sandbox |
| Account role analysed | Seller API + separate human buyer account for Golden purchase |
| Official API | Allegro REST / OpenAPI |
| Authentication | OAuth refresh token |
| Sandbox available | YES |
| Evidence level | **P4 GOLDEN E2E PASS** |

Important boundary: the connected API is a **seller-side Allegro integration**. It does not give Komerce a proven buyer `placeOrder()` capability.

---

## 2. Sourcing / catalogue capabilities

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Search catalogue | **PARTIAL** | Komerce can list/filter offers owned by the authorized Sandbox seller. This is not arbitrary public marketplace search. |
| Read exact product / offer | **YES** | Exact offer can be read by offer ID. |
| Read variants / exact units | **PARTIAL** | Current normalized Golden scope is one exact BUY_NOW offer, quantity 1. Complex option combinations are not guessed. |
| Stable supplier unit reference | **YES** | Native unit ref = Allegro offer ID. |
| Read native price | **YES** | Live offer price observed. |
| Read native currency | **YES** | PLN preserved as PLN. |
| Read stock / availability | **YES** | Live stock observed and validated. |
| Read publication / sellability state | **YES** | Offer publication state is read; Golden requires ACTIVE. |
| Read shipping capability / quote | **PARTIAL** | Seller shipping prerequisites/capabilities are readable; no generic claim is made about every downstream supplier leg. |
| Pagination / bounded reads | **YES** | Listing is deliberately bounded. |
| Public catalogue vs account-owned catalogue | **ACCOUNT-OWNED** | Seller-owned Sandbox offers only in the proven connector path. |
| Rate limits / quotas known | **NOT QUALIFIED HERE** | Not required to close the Golden contract. |

---

## 3. Canonical output Komerce can safely build

| Canonical fact | Status | Notes |
|---|---|---|
| Canonical Product candidate | **PASS** | Imported through normal Komerce sourcing/refinery path. |
| Offer | **PASS** | Exact Allegro offer retained as source offer. |
| Exact Unit | **PASS** | Exact supplier unit resolved from offer ID. |
| Supplier Order Identity | **PASS** | `{provider:"allegro", version:1, payload:{environment:"sandbox", offer_id}}` |
| Native supplier money | **PASS** | Golden price: **29.90 PLN**. No fake AED. |
| Live stock fact | **PASS** | Golden observed stock: **10**. |
| Live price fact | **PASS** | Golden observed unit price: **29.90 PLN**. |
| Fulfillment / procurement readiness | **PASS — manual path** | Exact identity + live stock + live price proven. |

Golden exact supplier identifiers:

```text
offer_id / supplier_unit_ref = 7782182471
supplier_sku = allegro-sandbox:7782182471
price = 29.90 PLN
```

---

## 4. Procurement capabilities

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Manual procurement possible | **YES — PROVEN** | Human buyer completed exact Sandbox purchase. |
| Buyer order creation API | **NO PROVEN CAPABILITY** | No supported buyer `placeOrder()` endpoint has been proven for this integration. |
| Automatic order placement | **NO** | `auto_order_ready=false`. |
| Payment API usable by Komerce | **NO** | Komerce preflight does not invoke payment. |
| Supplier order external reference | **YES** | Allegro seller `checkoutForm.id`. |
| Supplier order read-back | **YES** | Seller-side checkout form can be read via API. |
| Order discovery after manual purchase | **YES — PROVEN** | Komerce can list seller orders and find the unique exact match. |
| Reconciliation possible | **YES — PROVEN** | Offer + quantity + native money + provider status are verified before PO confirmation. |
| Cancellation | **NOT PROVEN** | Do not claim supported. |
| Invoice | **NOT PROVEN** | Do not claim supported. |
| Tracking | **NOT PROVEN** | Do not claim supported. |

---

## 5. Provider limitations that affect Komerce

- The proven connector is seller-side; it is not a general buyer checkout API.
- Catalogue access in the connector is bounded to authorized seller offers, not arbitrary public Allegro catalogue discovery.
- Current normalized Golden scope is deliberately narrow: one exact offer, one unit, BUY_NOW.
- Automatic supplier ordering is closed for Allegro until a real buyer order-creation contract is proven.
- Manual procurement therefore requires a human buyer step.
- Supplier confirmation must come from seller-side API evidence; Komerce never invents the supplier order reference.
- Sandbox and production must remain isolated; this report proves Sandbox only.
- Missing/ambiguous evidence blocks rather than guessing.

---

## 6. Komerce execution classification

### What Komerce can do now

```text
Sourcing:
  read exact seller offer
  → import/canonicalize
  → preserve exact supplier unit identity
  → preserve native PLN money

Purchasing readiness:
  exact identity
  + live stock
  + live price
  → ready for MANUAL procurement

Execution:
  human buyer purchase in Allegro Sandbox

Evidence / reconciliation:
  seller order discovery
  → unique exact match
  → checkoutForm.id
  → verification
  → PO confirmed
```

### What Komerce must NOT claim

```text
automatic buyer order placement
automatic provider payment
general public Allegro catalogue access
invoice support
tracking support
production behaviour proven by Sandbox
```

---

## 7. Proof stages

| Stage | Status | Evidence |
|---|---|---|
| Conversation | **PASS** | Required seller/buyer information exchange understood for controlled Golden. |
| P0 Business readiness | **PASS** | Sandbox seller prerequisites and controlled offer setup satisfied. |
| P1 Raw API | **PASS** | Offer, stock, price and seller order facts read from Allegro API. |
| P2 Adapter | **PASS** | Allegro facts mapped to Komerce canonical identity/money/readiness. |
| P3 Pipeline | **PASS** | Source → refinery → SKU/SOI → Purchasing PO proven. |
| P4 Golden E2E | **PASS** | Human Sandbox purchase → seller discovery → exact reconciliation → confirmed PO. |

Golden customer / PO proof:

```text
Komerce order ref = K4C61VO
order_id = 0f384555-27b0-4561-8607-343d9daeaa3c
purchase_order_id = b70e301c-cdc1-40eb-805b-172e98a77c18
```

Discovered real Sandbox supplier order:

```text
checkoutForm.id = 1f6c5c90-b2eb-11f1-885c-878453105864
offer_id = 7782182471
quantity = 1
unit_price = 29.90 PLN
provider_status = READY_FOR_PROCESSING
bought_at = 2026-09-17T22:59:26.466Z
```

Result:

```text
purchase_confirmed = true
discovered_checkout_form = true
```

Replay result:

```text
purchase_confirmed = true
already_confirmed = true
```

This proves exact reconciliation and idempotent replay.

---

## 8. Final provider summary

```text
CATALOGUE:              PARTIAL — authorized seller offers, not arbitrary public catalogue
EXACT UNIT:             PASS
LIVE PRICE:             PASS
LIVE STOCK:             PASS
MANUAL PROCUREMENT:     PASS
AUTO ORDER:             NOT SUPPORTED / NOT PROVEN
ORDER EVIDENCE:         PASS
RECONCILIATION:         PASS
ENVIRONMENT:            SANDBOX ONLY
MAIN LIMITATION:        no proven buyer placeOrder API
```

### Komerce conclusion

Allegro Sandbox is a **safe Komerce sourcing + manual procurement provider** for the controlled path already proven. Komerce can identify the exact unit, preserve native supplier money, verify live stock/price, create an exact PO, observe the real manual supplier purchase and reconcile it back to that PO. Komerce must not treat Allegro as auto-order capable until a real buyer order-creation contract is independently proven.

---

## 9. Re-analysis triggers

Re-run this provider analysis if:

- Allegro exposes a buyer order-creation API usable by Komerce;
- the connector is extended to public marketplace discovery;
- variants/bundles become supported;
- production is introduced;
- shipping, cancellation, invoice or tracking become part of the required Komerce contract;
- a second provider forces a change to the canonical capability model.
