# Allegro Sandbox — External Provider Contract Analysis

> Family: supplier / marketplace
>
> Detailed operational setup: `docs/allegro-sandbox.md`
>
> Proof doctrine: `docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md`

Analysis date: **2026-09-18**

## 1. Identity and scope

| Field | Value |
|---|---|
| Provider | Allegro |
| Family | supplier / marketplace |
| Consumers | sourcing, catalog, purchasing |
| Environment | Sandbox |
| Account role | authorized seller API + separate human buyer account for Golden |
| Authentication | OAuth refresh token |
| Highest proof | **P4 GOLDEN E2E PASS** |

The connected API is seller-side. No supported buyer `placeOrder()` capability has been proved.

## 2. Sourcing capability profile

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Search catalogue | **PARTIAL** | bounded listing/filter of offers owned by the authorized Sandbox seller; not arbitrary public marketplace search |
| Read exact offer | **YES** | exact offer by offer ID |
| Exact unit | **YES** | native unit ref = offer ID |
| Variants | **PARTIAL** | current Golden normalization deliberately proves one exact BUY_NOW unit |
| Native price/currency | **YES** | 29.90 PLN preserved as PLN |
| Live stock | **YES** | Golden observed stock 10 |
| Publication / sellability | **YES** | Golden requires re-read as ACTIVE |
| Shipping capability | **PARTIAL** | seller prerequisites/rates can be inspected; no generic claim for every downstream leg |
| Bounded reads | **YES** | pagination and discovery are explicitly bounded |

Canonical identity:

```text
offer_id / supplier_unit_ref = 7782182471
supplier_sku = allegro-sandbox:7782182471
SOI = { provider:"allegro", version:1, payload:{ environment:"sandbox", offer_id:"7782182471" } }
native price = 29.90 PLN
```

## 3. Procurement capability profile

| Criterion | Status | Evidence / limitation |
|---|---|---|
| Manual procurement | **YES — PROVEN** | separate human Sandbox buyer completed the purchase |
| Buyer order creation API | **NOT PROVEN** | no supported buyer `placeOrder()` contract established |
| Automatic order placement | **NO / CLOSED** | auto-order remains closed |
| Provider payment invoked by Komerce | **NO** | preflight never pays |
| External order reference | **YES** | seller `checkoutForm.id` |
| Seller order read-back | **YES** | seller API |
| Discovery after manual purchase | **YES — PROVEN** | bounded list + unique exact match |
| Reconciliation | **YES — PROVEN** | offer identity + qty + native money + provider status verified |
| Cancellation | **NOT PROVEN** | |
| Invoice | **NOT PROVEN** | |
| Tracking | **NOT PROVEN** | |

## 4. Confirmation / evidence contract

The provider-native status `READY_FOR_PROCESSING` is evidence read from Allegro seller state. Komerce confirms its Purchase Order only after the exact supplier purchase has been matched.

Golden supplier order:

```text
checkoutForm.id = 1f6c5c90-b2eb-11f1-885c-878453105864
offer_id = 7782182471
quantity = 1
unit_price = 29.90 PLN
provider_status = READY_FOR_PROCESSING
bought_at = 2026-09-17T22:59:26.466Z
```

Komerce proof:

```text
order_ref = K4C61VO
purchase_order_id = b70e301c-cdc1-40eb-805b-172e98a77c18
purchase_confirmed = true
discovered_checkout_form = true
```

Replay:

```text
purchase_confirmed = true
already_confirmed = true
```

This proves exact reconciliation and idempotent replay.

## 5. What Komerce can safely do

```text
seller offer
→ bounded sourcing read
→ canonical product / offer / exact unit
→ exact Supplier Order Identity
→ native PLN money
→ live stock + price readiness
→ exact Purchase Order
→ human buyer execution
→ seller order discovery
→ exact provider evidence reconciliation
→ Purchase Order confirmed
```

## 6. What Komerce must NOT claim

```text
automatic buyer order placement
automatic provider payment
general public Allegro catalogue access
invoice support
tracking support
production behavior proved by Sandbox
```

## 7. Proof stages

| Stage | Status | Evidence |
|---|---|---|
| Conversation | **PASS** | controlled seller/buyer exchange understood |
| P0 Business readiness | **PASS** | seller prerequisites + controlled offer setup |
| P1 Raw API | **PASS** | offer, stock, price, seller order facts read |
| P2 Adapter | **PASS** | mapped to canonical identity/money/readiness |
| P3 Pipeline | **PASS** | Source → refinery → SKU/SOI → PO |
| P4 Golden E2E | **PASS** | paid human Sandbox purchase → seller discovery → reconciliation → confirmed PO |

## 8. Summary

```text
PROVIDER:                 Allegro
FAMILY:                   supplier / marketplace
CONSUMERS:                sourcing, catalog, purchasing
ENVIRONMENT:              Sandbox only
CATALOGUE:                PARTIAL — authorized seller offers
EXACT UNIT:               PASS
LIVE PRICE:               PASS
LIVE STOCK:               PASS
MANUAL PROCUREMENT:       PASS
AUTO ORDER:               NOT PROVEN / CLOSED
ORDER EVIDENCE:           PASS
RECONCILIATION:           PASS
HIGHEST PROOF:            P4
MAIN LIMITATION:          no proven buyer placeOrder API
```

### Komerce conclusion

Allegro Sandbox is a safe Komerce sourcing + manual-procurement provider for the controlled path proved so far. Komerce can identify the exact unit, preserve native supplier money, verify live stock/price, create an exact PO, observe the real manual supplier purchase and reconcile it to that PO. Auto-order remains forbidden until an independently proved buyer order-creation contract exists.
