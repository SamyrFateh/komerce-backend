# eBay — External Provider Contract Characterization

> Family: supplier / marketplace
>
> Doctrine: `docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md`
>
> Status: **CONVERSATION CHARACTERIZED — P0 BLOCKED**
>
> No provider registration, adapter, DB migration, or runtime behavior is authorized by this document.

Analysis date: **2026-09-18**

## 1. Why eBay is a useful N+1 provider

eBay materially differs from Allegro in one important way:

- public buying discovery is explicitly exposed through the **Buy Browse API**;
- a buyer checkout contract also exists through the **Buy Order API**;
- however the checkout resources are **Limited Release** and require eBay approval, including before they become usable in Sandbox;
- seller-side Inventory APIs can be used to create deterministic Sandbox fixtures independently from the buyer path.

This makes eBay a strong abstraction test for Komerce:

```text
seller fixture plane
  Sell Inventory API

buyer discovery plane
  Buy Browse API

buyer execution plane
  Buy Order API
```

The planes must not be collapsed into one generic "eBay API" capability.

## 2. Initial proof status

| Stage | Status | Reason |
|---|---|---|
| Conversation — sourcing | **PASS (documented)** | official Browse contract exposes search + exact item read |
| Conversation — procurement | **PASS (documented)** | official member checkout flow exposes initiate → review → placeOrder → purchaseOrder read-back |
| P0 Business readiness | **BLOCKED** | Komerce eBay account/keyset, Sandbox users, seller policies/location and member-checkout entitlement are not yet evidenced |
| P1 Raw API | **NOT STARTED** | no eBay credentials or bounded live probe exists in the repo |
| P2 Adapter | **NOT STARTED** | no eBay adapter exists |
| P3 Pipeline | **NOT STARTED** | provider not registered |
| P4 Golden E2E | **FORBIDDEN** | upstream proof incomplete |

A documented endpoint is not a proved Komerce capability.

## 3. Provider surfaces

### 3.1 Buy Browse API — sourcing

Purpose:

```text
search marketplace
→ identify exact purchasable item
→ re-read exact item
→ expose price / currency / availability / seller / shipping context
```

Authentication:

- Application access token;
- client-credentials grant;
- no buyer account is required merely to call Browse.

Key operations:

```text
GET /buy/browse/v1/item_summary/search
GET /buy/browse/v1/item/{item_id}
GET /buy/browse/v1/item/get_item_by_legacy_id
GET /buy/browse/v1/item/get_items_by_item_group
```

The RESTful item identity has the form:

```text
v1|{listing_id}|{variation_id}
```

For a non-variation listing, `variation_id = 0`.

This is materially useful for Komerce because the Browse identity already resolves a specific variation, not merely the parent listing.

### 3.2 Sell Inventory API — deterministic Sandbox fixture

Purpose:

```text
controlled seller SKU
→ Inventory Item
→ Offer
→ publish
→ active eBay listing
```

Primary flow:

```text
createOrReplaceInventoryItem
→ createOffer
→ publishOffer
→ listingId
```

Publishing requires seller business readiness, including:

- seller opted in to eBay business policies;
- payment policy;
- fulfillment policy;
- return policy;
- inventory location / merchantLocationKey.

This seller path is not the Komerce procurement contract. It is useful as deterministic Golden setup.

### 3.3 Buy Order API — procurement

For **member checkout**, the documented flow is:

```text
initiateCheckoutSession
→ optional quantity / shipping changes
→ getCheckoutSession
→ placeOrder
→ purchaseOrderId + payment status
→ getPurchaseOrder
```

The member Order API is Limited Release.

Komerce must therefore represent two distinct truths:

```text
API exists and is documented
        !=
Komerce account is entitled to call it
```

Guest checkout is a separate flow using the Checkout with eBay client-side widget. It does not provide the same server-side `placeOrder()` shape and must not be silently treated as an automatic supplier-procurement substitute.

## 4. Sourcing conversation

### EXPECTS

Komerce needs enough information to construct a deterministic candidate and exact Unit:

- marketplace;
- exact eBay item / variation identity;
- seller/commercial principal evidence;
- product title / identifiers / aspects;
- native purchase price + currency;
- actual or bounded availability;
- listing state / end date;
- shipping options or explicit UNKNOWN;
- item location;
- quantity constraints when exposed.

### REQUIRES

Provider-side requirements currently known from the official contract:

- valid eBay application credentials;
- Application access token;
- marketplace/context headers as required by the operation;
- contextual buyer location when shipping estimates depend on destination.

### SENDS

Minimal bounded sourcing calls should send only:

```text
search:
  marketplace/context
  q / GTIN / category / product identifier
  bounded limit

exact read:
  item_id
  compact field group where sufficient
  buyer location only when shipping estimate is under test
```

### RECEIVES

The contract can expose:

- `itemId`;
- `itemGroupId` where applicable;
- title/product/aspects;
- price + currency;
- seller;
- item location;
- estimated availability including remaining quantity where available;
- item end date / availability status;
- shipping options;
- return/legal information.

### CONFIRMS

A search hit is not canonical truth.

Confirmation requires exact read-back:

```text
search result
→ exact itemId
→ GET item/{itemId}
→ price / availability / identity re-read
```

A stale search result must never be promoted directly to a purchasable Unit.

### EXPOSES

Initial canonical shape to prove at P1/P2:

```text
source_type = ebay
source_instance = exact eBay environment + keyset/account context
commercial_principal = seller identity from provider evidence

supplier_unit_ref = exact REST itemId

candidate supplier_sku:
  ebay-sandbox:<itemId>
  or
  ebay:<itemId>

candidate SOI v1:
{
  provider: "ebay",
  version: 1,
  payload: {
    environment: "sandbox|production",
    marketplace_id: "...",
    item_id: "v1|listing|variation"
  }
}
```

The exact namespacing is a **candidate**, not authority, until P1 proves the provider identifiers and P2 proves the mapping.

Native supplier money must remain native. No AED/EUR conversion belongs in the source identity contract.

## 5. Procurement conversation — member checkout

### EXPECTS

Before Komerce can call eBay purchase execution it needs:

- exact sold Unit / SOI;
- quantity;
- current provider price and availability;
- buyer account authorized for Order API;
- delivery address;
- shipping option;
- payment capability that eBay accepts for the buyer account;
- idempotent Komerce purchase intent.

### REQUIRES

Known provider requirements:

- eBay Buy API eligibility;
- explicit approval for member checkout;
- authorized eBay member;
- user OAuth authorization/scopes required by Order;
- supported marketplace/use case;
- production business eligibility before live use.

eBay documentation currently states that partners seeking member-checkout access should align the business model with eBay and, for the targeted marketplace, have a domestic company and warehouse as part of the eligibility model. This is a **P0 business constraint**, not an adapter detail.

### SENDS

Documented flow begins with:

```text
itemId
quantity
buyer contact
shipping address
payment context
```

then uses the returned checkout session for review and eventual order placement.

### RECEIVES

Important provider identities:

```text
checkoutSessionId
purchaseOrderId
purchaseOrderPaymentStatus
line item / legacy references
```

### CONFIRMS

The first safe post-execution confirmation candidate is:

```text
placeOrder accepted
→ purchaseOrderId
→ getPurchaseOrder(purchaseOrderId)
→ item identity + quantity + money + provider payment/order status
→ canonical reconciliation
```

No Komerce Purchase Order may become confirmed merely because the HTTP mutation returned 2xx.

### EXPOSES

Only after P1/P2 proof should procurement expose a canonical result such as:

```text
provider_order_ref
provider_payment_status
exact purchased item identity
quantity
native order money
read_back_confirmed
```

The mapping from eBay status vocabulary to Komerce execution evidence remains UNKNOWN until raw Sandbox evidence is observed.

## 6. Sandbox Golden design

eBay's Sandbox is self-contained and uses fictional money.

A deterministic Golden should use at least:

```text
TESTUSER seller
TESTUSER buyer
```

because the seller cannot purchase its own listing.

Target Golden:

```text
seller test user
→ create required business policies
→ create inventory location
→ create exact inventory item
→ create exact offer
→ publish
→ listingId

Browse app token
→ search / exact getItem
→ Source
→ Observation
→ Resolution
→ Canonical Product
→ Offer
→ Unit
→ exact SOI
→ Purchasing readiness

buyer test user
→ initiate checkout
→ get checkout
→ placeOrder
→ purchaseOrderId
→ getPurchaseOrder
→ exact reconciliation
→ Komerce Purchase Order confirmed
```

The buyer half remains forbidden until member-checkout entitlement is explicitly proved.

## 7. P0 blockers to resolve before code

Current repository evidence contains no eBay integration or eBay configuration.

P0 therefore starts BLOCKED on these facts:

| Fact | State |
|---|---|
| eBay Developer account exists for Komerce | **UNKNOWN** |
| Sandbox application keyset exists | **UNKNOWN** |
| Production keyset exists | **UNKNOWN** |
| Sandbox seller test user exists | **UNKNOWN** |
| Sandbox buyer test user exists | **UNKNOWN** |
| Seller business policies are configured | **UNKNOWN** |
| Seller inventory location exists | **UNKNOWN** |
| Browse API application-token call succeeds | **UNKNOWN** |
| Member Order API Sandbox entitlement granted | **UNKNOWN / likely gated** |
| Target eBay marketplace selected | **UNKNOWN** |
| Target ship-to country accepted for intended use case | **UNKNOWN** |
| Production eligibility for that marketplace | **UNKNOWN** |

None of these unknowns may be converted to false or guessed.

## 8. Executable read-only Browse proof

The first executable characterization is deliberately limited to the non-mutating
Buy Browse boundary:

```bash
EBAY_SANDBOX_CLIENT_ID=...
EBAY_SANDBOX_CLIENT_SECRET=...
EBAY_SANDBOX_MARKETPLACE_ID=EBAY_US
EBAY_SANDBOX_ITEM_ID='v1|listing|variation'
node scripts/ebay-sandbox-browse-proof.js --through=P1
```

Alternatively, before a deterministic fixture exists, use a bounded query:

```bash
EBAY_SANDBOX_SEARCH_QUERY='komerce sandbox'
EBAY_SANDBOX_SEARCH_LIMIT=5
node scripts/ebay-sandbox-browse-proof.js --through=P1
```

The script performs only:

```text
client credentials OAuth
→ bounded Browse search when needed
→ exact getItem read-back
→ native money observation
→ sanitized P0/P1 proof
```

It never persists the OAuth token and never includes configured credentials or
provider free-text error bodies in proof output.

## 12. Minimal P1 probes

Once credentials exist, execute the following independently of the Komerce pipeline.

### Probe B1 — OAuth application token

Prove:

```text
client credentials
→ application access token
→ sanitized expiry/scope evidence
```

No token material persisted in proof output.

### Probe B2 — Browse bounded search

```text
GET /buy/browse/v1/item_summary/search
limit <= small fixed bound
```

Prove:

- HTTP/API contract;
- marketplace;
- at least one item identity or a legitimate empty result;
- pagination remains bounded.

### Probe B3 — exact item read

For one explicit item:

```text
GET /buy/browse/v1/item/{itemId}
```

Prove:

- exact REST item identity;
- variation identity;
- native price/currency;
- seller;
- availability;
- listing end/sellability;
- shipping data or explicit UNKNOWN.

### Probe S1 — seller prerequisite read

Before creating any fixture:

```text
account/business policies
inventory locations
```

If incomplete, stop. Do not create unusable test offers.

### Probe S2 — deterministic seller fixture

Sandbox only, idempotent setup:

```text
inventory item
→ offer
→ publish
→ read-back
```

### Probe O1 — member checkout entitlement

Attempt the smallest harmless/readiness operation allowed by the approved contract.

Expected proof must distinguish:

```text
credentials invalid
vs
scope missing
vs
Buy API access denied
vs
member checkout entitlement absent
vs
operation accepted
```

### Probe O2 — checkout session

Only after O1 PASS and against the controlled Sandbox item.

### Probe O3 — placeOrder + read-back

Only after all earlier stages PASS.

## 9. What Komerce must not claim yet

```text
eBay is a supported provider
eBay is auto-order capable
eBay Sandbox checkout works for our account
eBay production checkout is approved
eBay shipping to our Hub is valid
eBay payment is integrated
eBay cancellation/refund/returns are reconciled
eBay tracking is normalized
```

## 10. Initial architectural conclusion

eBay is a promising provider because it challenges the abstraction in a useful way without requiring a provider branch in the core:

```text
Browse item identity
→ exact Canonical Unit candidate

Order checkout identity
→ execution evidence candidate

seller Inventory API
→ controlled fixture only
```

The important difference from Allegro is not that eBay is already "better" or "supported". It is that eBay documents a buyer-side `placeOrder` contract, while access to that contract is gated by business approval.

That distinction is exactly what the Komerce proof model is designed to preserve:

```text
documented capability
→ Conversation KNOWN

account entitlement
→ P0

raw successful call
→ P1

adapter correctness
→ P2

Komerce composition
→ P3

real controlled transaction
→ P4
```

No provider authority or runtime code should change before P0/P1 evidence exists.

## 11. Official references used for this characterization

- eBay Buy APIs Overview / Buying Integration Guide
- Browse API
- Inventory Discovery and Refresh Guide
- Buy APIs Requirements
- Order API v1 (member checkout)
- eBay Sandbox documentation and test-user guidance
- Sell Inventory API overview
- From inventory item to marketplace offer
