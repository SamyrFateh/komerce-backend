# Allegro Sandbox connection

## Scope and truth

The connector reads **offers owned by the authorized sandbox seller**, not an
arbitrary supplier's public catalog. API origins are fixed to Allegro Sandbox;
HTTP redirects and non-allowlisted paths are refused.

Allegro REST exposes seller-side order management (`GET /order/checkout-forms/{id}`)
but does **not** expose a buyer checkout-creation endpoint that Komerce can use as
`placeOrder()`. Komerce therefore keeps two capabilities separate:

- **manual procurement**: exact offer + live stock/price + a human buyer checkout,
  followed by seller-side API reconciliation;
- **auto-order**: closed for Allegro because no supported buyer order-creation API
  has been proven.

Official contracts: [OpenAPI](https://developer.allegro.pl/swagger.yaml),
[API documentation](https://developer.allegro.pl/documentation).
Resources used by Komerce are deliberately bounded:

- `GET /sale/offers`;
- `GET /sale/product-offers/{offerId}`;
- guarded staging seed: product search + seller draft creation;
- purchase reconciliation: `GET /order/checkout-forms/{checkoutFormId}`;
- OAuth `POST /auth/oauth/token` with `grant_type=refresh_token`.

Komerce never calls a buyer payment endpoint and never fabricates a supplier
order ID.

## Runtime configuration

Keep credentials in the server environment, never GitHub CI or a browser:

- `ALLEGRO_SANDBOX_CLIENT_ID`
- `ALLEGRO_SANDBOX_CLIENT_SECRET`
- `ALLEGRO_SANDBOX_REFRESH_TOKEN` (first bootstrap only)
- `ALLEGRO_SANDBOX_USER_AGENT` (registered application identifier)
- `ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY` (independent random 32-byte hex key)
- `KOMERCE_ALLOW_ALLEGRO_SANDBOX=1` (off by default)
- `KOMERCE_ALLOW_ALLEGRO_SANDBOX_SEED=1` only when seller seed is intentionally enabled in staging

Migration 218 must exist. OAuth refresh is serialized across replicas using a
transaction-scoped PostgreSQL advisory lock. The latest encrypted refresh token
in `supplier_oauth_connections` (`supplier_key=allegro_sandbox`) supersedes the
bootstrap environment token. AES-256-GCM uses supplier-specific authenticated
data. Access tokens stay in memory; legacy required access columns contain empty
sentinels and an epoch expiry for this supplier. A failed commit never releases
the new bearer. A crash between provider rotation and DB commit may require
reauthorization; this is not an atomic transaction with Allegro. Do not replace
the encryption key without a deliberate reconnect/migration procedure.

Required OAuth scopes depend on the operation:

- catalog read / preflight: `allegro:api:sale:offers:read`;
- guarded seller seed / offer creation: `allegro:api:sale:offers:write`;
- verified purchase reconciliation: `allegro:api:orders:read`.

A 401 invalidates the local bearer cache; calls are not automatically retried and
errors never include provider response bodies or credentials.

## Catalog and price

Use the existing sourcing import endpoint with `source_type=api`,
`supplier_id=allegro`, `supplier_name=Allegro Sandbox`, and `product_ids` containing
**offer IDs**, not Product UUIDs. A bounded `page`/`size` lists the seller's active
offers (default 30, maximum 100); `keyword` filters their titles.
Never request a full-snapshot archive for a bounded page.

Only single-product, quantity-one, BUY_NOW offers in PLN are currently normalized.
Bundles, missing stock, unknown publication states and malformed prices are
explicit rejections. No option combinations, shipping price, weight or supplier
SKU are guessed. The namespaced reconciliation SKU is `allegro-sandbox:<offerId>`;
the native unit ref is the offer ID. SOI is `{provider: "allegro", version: 1,
payload: {environment: "sandbox", offer_id: "..."}}`.

Native prices remain PLN in V2. Migration 235 adds nullable
`finance_config.taux_pln_kmf`; set a deliberate sourcing rate through the existing
Finance configuration API/UI. Without a positive rate, valuation/import is
blocked (`PLN_FX_RATE_REQUIRED`). This is not a payment or market currency change.

## Reproducible catalog check

In the configured backend runtime:

```sh
node scripts/allegro-sandbox-check.js OFFER_ID
node scripts/allegro-sandbox-check.js --import OFFER_ID
```

The first command performs authenticated reads (and durable OAuth refresh when
needed). The second also imports through the existing refinery, without full
snapshot archival or automatic customer publication.

The guarded `--seed=1..3` mode creates seller **draft** offers only. Draft seed is
not proof of a customer-purchasable offer; activation/publication remains an
explicit seller-side action before the purchase Golden E2E.

## Purchasing readiness

The Allegro fulfillment adapter rechecks the exact SOI, active state, stock and
price against the seller sandbox offer.

A healthy active offer now returns canonical `FULFILLMENT_READY` with explicit
evidence:

```text
execution_mode = manual
manual_procurement_ready = true
auto_order_ready = false
buyer_checkout_api_supported = false
place_order_invoked = false
payment_invoked = false
```

This does **not** open auto-order. The Canonical Unit purchasing gate can build an
exact manual purchase payload (offer ID, URL, quantity, expected PLN price) and
still ends at `HARD_STOP`; no external order or payment is executed by preflight.

## Golden E2E — verified manual purchase

The first real Allegro purchase proof is deliberately one product, one offer,
quantity 1.

1. Import/promote an active Allegro Sandbox offer through the normal refinery and catalogue path.
2. Buy that SKU through Komerce staging and complete the Komerce payment flow until the customer order becomes `ordered`.
3. Verify that Purchasing creates a PO containing the sold `product_sku_id`, `supplier_unit_ref`, exact SOI and quantity.
4. From a **separate Allegro Sandbox buyer account**, buy the exact seller offer and complete the Allegro checkout/payment flow.
5. Obtain the Allegro `checkoutForm.id` for that purchase.
6. Run:

```sh
node scripts/allegro-sandbox-purchase-proof.js PURCHASE_ORDER_ID CHECKOUT_FORM_ID
```

The runner reads `GET /order/checkout-forms/{id}` from the authorized seller
account and confirms the Komerce PO **only if all facts match**:

- Allegro status is exactly `READY_FOR_PROCESSING` (payment completed, ready for seller processing);
- returned checkout form ID is the supplied ID;
- exactly one line item exists for this Golden scenario;
- line item offer ID equals the PO/SOI offer ID;
- quantity equals the PO quantity;
- line price is a positive PLN amount.

On success Komerce persists the Allegro checkout form ID as
`purchase_orders.supplier_order_id` and moves the PO to `confirmed` through the
existing Purchasing confirmation service. Replaying the proof is idempotent when
the same supplier order is already attached; rebinding a confirmed PO to a
different Allegro order is refused.

No buyer email, login, address, payment instrument or other buyer payload is
persisted or emitted by the reconciliation proof.

## What this proves — and what it does not

A successful Golden E2E proves:

```text
Allegro seller offer
→ Komerce Source / Refinery / Catalog / SKU / SOI
→ Komerce customer checkout + payment
→ ordered customer order
→ exact Purchase Order
→ live Allegro stock/price preflight
→ exact manual buyer purchase in Allegro Sandbox
→ seller-side API reconciliation
→ persisted supplier_order_id
→ confirmed Komerce Purchase Order
```

It proves **MANUAL_PROCUREMENT_READY / Fulfillment Ready** for this controlled
path. It does not claim `AUTO_ORDER_READY`; there is still no supported Allegro
buyer `placeOrder()` API in this integration.

Notification, invoice, Hub receipt, Market leg and final customer delivery remain
separate downstream E2E assertions and must only be marked verified when their
real side effects have been observed.

## Validation

Run the Allegro unit suites and existing sourcing/identity/Purchasing suites, then
`feature:registry`, `gate:schema`, `gate:touched-files`, `gate:docs-lint` and the
normal PR governance checks.

Mocked contract tests certify fail-closed behavior and data boundaries. The
Golden purchase itself is certified only by a live sandbox seller order returned
by Allegro and reconciled to the exact Komerce Purchase Order.
