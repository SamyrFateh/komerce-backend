# eBay — External Provider Contract Characterization

> Family: supplier / marketplace
>
> Doctrine: `docs/doctrine/DOCTRINE_EXTERNAL_PROVIDER_CONTRACT_PROOFS.md`
>
> Status: **P3 PASS — SOURCING PIPELINE PROVED, P4 BLOCKED**
>
> eBay is registered only on the provider-neutral sourcing/Browse path. Purchasing execution, buyer checkout, payment, seller mutation and global provider authority remain unproved and are not authorized by this proof.

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
| P0 Business readiness | **PASS (Browse sourcing scope)** | real Komerce Sandbox keyset present; environment + marketplace structurally valid |
| P1 Raw API | **PASS** | real client-credentials OAuth + bounded search + exact getItem + native money/availability/purchasability proved |
| P2 Adapter | **PASS** | real repo connector maps exact Browse truth to NormalizedSupplierProduct V2 + opaque eBay SOI; generic resolveSupplierUnit accepts it fail-closed |
| P3 Pipeline | **PASS (sourcing)** | generic sourcing dispatch → catalog import → Source/Capture/Product+Offer+Unit Observations → shadow Resolution proved against real eBay Sandbox on isolated PostgreSQL |
| P4 Golden E2E | **BLOCKED** | deterministic seller fixture + buyer Order/member-checkout entitlement + controlled transaction remain unproved |

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
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_ENV=sandbox
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_ITEM_ID='v1|listing|variation'
node scripts/ebay-sandbox-browse-proof.js --through=P1
```

Alternatively, before a deterministic fixture exists, use a bounded query:

```bash
EBAY_SEARCH_QUERY='komerce sandbox'
EBAY_SEARCH_LIMIT=5
node scripts/ebay-sandbox-browse-proof.js --through=P1
```

Railway already exposes the canonical eBay variable names above on the Komerce backend service. `EBAY_DEV_ID` also exists but is not required for the REST client-credentials Browse proof.

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

## 9. Real Railway P0/P1 evidence — 2026-09-18

The read-only proof was executed against the eBay variables already present on the
Komerce Railway backend, copied into an isolated probe service by Railway
reference variables. No credential value or OAuth token was emitted.

Observed proof chain:

```text
P0
  keyset present
  EBAY_ENV = sandbox
  explicit valid marketplace
  → PASS
  Railway deployment: 02f06423-a198-4f18-9403-92dd5fcb1439

P1a
  client_credentials OAuth
  token accepted by api.sandbox.ebay.com
  → PASS
  Railway deployment: 92b36e47-82e1-458d-9dc9-f43bab701015

P1b
  bounded Browse search
  q=iphone
  limit=3
  at least one exact REST itemId
  → PASS
  Railway deployment: 7b52c592-5d73-47c9-b10f-a14008437f93

P1c / P1d
  exact getItem(itemId)
  exact itemId read-back
  native price + currency observed
  → PASS
  Railway deployment: 5728b88f-5370-4e14-8dec-5e579fa160e2
```

Result:

```text
Conversation    PASS
P0              PASS
P1              PASS
P2              PASS
P3              PASS (sourcing)
P4              BLOCKED
```

P2 evidence:

```text
repo head
  186c76f808e8ccb2e6693b06aa09f38b09e07305

unit contract
  tests/unit/ebay-connector.test.js
  10/10 PASS

live adapter proof
  isolated Railway service: ebay-p2-live-proof
  deployment: 0e082eda-ffc5-4d7b-a4a5-834e44dcd012
  healthcheck: /health
  deployment status: SUCCESS

proof path
  real eBay Sandbox OAuth
  -> bounded Browse search
  -> exact getItem
  -> ebay-connector normalizeBrowseItem
  -> NormalizedSupplierProduct V2
  -> exact supplier_unit_ref
  -> opaque SOI { provider: ebay, version: 1, ... }
  -> generic resolveSupplierUnit
  -> native money + real remaining quantity
  -> active fixed-price / non-expired unit
```

The live proof service only exposes `/health` after all adapter + SOI + money +
stock assertions pass; a failed assertion exits before the server starts, so
Railway cannot mark the healthchecked deployment successful on a false positive.

This proves the real Komerce Sandbox keyset can authenticate, read exact eBay
Browse item truth, normalize it through the real repository connector, and pass
the provider-neutral supplier-unit resolver without any eBay branch in the core.
It does **not** prove seller fixture mutation, Order API entitlement, checkout,
payment, or purchase execution.

### P3 real sourcing-pipeline evidence

P3 was then exercised through the real generic Komerce sourcing composition on
an isolated PostgreSQL database. The proof does not use the production database
and does not invoke any provider mutation:

```text
repo proof
  scripts/ebay-p3-pipeline-proof.js
  tests/unit/ebay-p3-pipeline-proof.test.js

runtime registration
  services/sourcing-import-dispatch.js
  CONNECTORS.api.ebay
  automation = null
  no provider branch in the orchestrator

isolated PostgreSQL
  service: ebay-p3-isolated-proof
  deployment: 1617fdf8-034a-418d-a618-bcbeff584e98
  status: SUCCESS

P3 runner
  service: ebay-p3-runner
  deployment: 80a9ad68-ab01-4002-aac0-0213d904f408
  healthcheck: /health
  status: SUCCESS
```

The P3 health server is created only after the following real path succeeds:

```text
real eBay Sandbox OAuth
→ bounded Browse search
→ exact getItem
→ ebay-connector
→ generic sourcing-import-dispatch
→ catalog-import-orchestrator
→ supplier_catalog_imports
→ sourcing_candidates with V2 normalized_source_contract
→ sourcing_sources: api:ebay
→ complete sourcing_capture
→ immutable Product / Offer / Unit observations
→ exact eBay SOI only at Unit grain
→ shadow Resolution
→ active canonical bindings for all observations
→ P3 PASS
```

The proof explicitly asserts:

- Product does not receive Supplier Order Identity;
- Unit `source_ref` remains the exact eBay REST item identity;
- Unit SOI remains opaque (`provider=ebay`, version 1);
- every observation reaches a canonical binding;
- resolution does not require manual review or leave a deferred parent;
- `placeOrder` is never invoked;
- no eBay mutation is invoked.

Therefore eBay is now a proved **sourcing provider through P3**. This does not
promote eBay into Purchasing provider authority and does not claim checkout,
payment, order placement, cancellation, refund, tracking, or seller-fixture
mutation. Those remain separate P4/business-readiness work.

## 13. Minimal P1 probes

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

## 10. What Komerce must not claim yet

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

## 11. Initial architectural conclusion

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

## 12. Official references used for this characterization

- eBay Buy APIs Overview / Buying Integration Guide
- Browse API
- Inventory Discovery and Refresh Guide
- Buy APIs Requirements
- Order API v1 (member checkout)
- eBay Sandbox documentation and test-user guidance
- Sell Inventory API overview
- From inventory item to marketplace offer
