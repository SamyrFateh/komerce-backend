# Allegro Sandbox connection

## Scope and truth

The connector reads **offers owned by the authorized sandbox seller**, not an
arbitrary supplier's public catalog. API origins are fixed to Allegro Sandbox;
HTTP redirects and non-allowlisted paths are refused. No order/payment endpoint
is called. Seller checkout forms are not a buyer order-creation API.

Official contracts: [OpenAPI](https://developer.allegro.pl/swagger.yaml),
[API documentation](https://developer.allegro.pl/documentation).
Resources used: `GET /sale/offers`, `GET /sale/product-offers/{offerId}` and
OAuth `POST /auth/oauth/token` with `grant_type=refresh_token`.

## Runtime configuration

Keep credentials in the server environment, never GitHub CI or a browser:

- `ALLEGRO_SANDBOX_CLIENT_ID`
- `ALLEGRO_SANDBOX_CLIENT_SECRET`
- `ALLEGRO_SANDBOX_REFRESH_TOKEN` (first bootstrap only)
- `ALLEGRO_SANDBOX_USER_AGENT` (registered application identifier)
- `ALLEGRO_SANDBOX_TOKEN_ENCRYPTION_KEY` (independent random 32-byte hex key)
- `KOMERCE_ALLOW_ALLEGRO_SANDBOX=1` (off by default)

Migration 218 must exist. OAuth refresh is serialized across replicas using a
transaction-scoped PostgreSQL advisory lock. The latest encrypted refresh token
in `supplier_oauth_connections` (`supplier_key=allegro_sandbox`) supersedes the
bootstrap environment token. AES-256-GCM uses supplier-specific authenticated
data. Access tokens stay in memory; legacy required access columns contain empty
sentinels and an epoch expiry for this supplier. A failed commit never releases
the new bearer. A crash between provider rotation and DB commit may require
reauthorization; this is not an atomic transaction with Allegro. Do not replace
the encryption key without a deliberate reconnect/migration procedure.

The account needs `allegro:api:sale:offers:read`. A 401 invalidates the local
bearer cache; calls are not automatically retried and errors never include
provider response bodies or credentials.

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

## Reproducible live check

In the configured backend runtime:

```sh
node scripts/allegro-sandbox-check.js OFFER_ID
node scripts/allegro-sandbox-check.js --import OFFER_ID
```

The first command performs authenticated reads (and durable OAuth refresh when
needed). The second also imports through the existing refinery, without full
snapshot archival or publication. Keep sandbox products unexposed to customers.

The Purchasing adapter can be injected as `adapters: {allegro: adapter}` into
either existing readiness gate. It rechecks exact identity, active status, stock
and price. It **never returns FULFILLMENT_READY**: even a healthy offer returns
`PREFLIGHT_FAILED / ALLEGRO_BUYER_CHECKOUT_UNSUPPORTED`, with live evidence.
No buyer checkout, freight quote, supplier confirmation, notification or invoice
is fabricated. The CLI reports these E2E steps as unverified. Completing the
purchase scenario requires a supported buyer checkout (for a sandbox manual
checkout, a separate buyer account), then an explicit reconciliation contract.

## Validation

Run the Allegro unit suites and existing sourcing/identity suites, then
`feature:registry`, `gate:schema`, `gate:touched-files`, `gate:docs-lint`.
Validation locale : 62 tests Allegro et 105 tests de régression réussis ; couverture
100 % lignes/branches/fonctions des trois nouveaux modules de service. Cartes,
registre, ownership, docs, qualité et Security 360 passent. Le registre conserve
13 avertissements existants. Le gate SQL headers reste bloqué sur les deux
sous-déclarations existantes de catalog-public-view et incident-write-service ;
le dump de schéma existant manque 20 objets/colonnes des migrations 227–233.
La migration 235 est reconnue comme intention post-snapshot et reste à appliquer.

Mocked contract tests do not certify a live OAuth connection or a purchase.
