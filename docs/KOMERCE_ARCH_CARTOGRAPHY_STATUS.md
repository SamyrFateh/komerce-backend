# Komerce Architecture Cartography Status

Version: 2026-06

This document is the working status of the `@komerce-arch` cartography effort.
It should be read with:

- `docs/KOMERCE_ARCHITECTURE_HEADERS.md`
- `docs/KOMERCE_ARCHITECTURE_MAP.md`
- `docs/komerce-architecture-map.json`
- `docs/KOMERCE_DB_TOUCHPOINTS_MAP.md`
- `scripts/audit-komerce-arch-headers.js`
- `scripts/generate-komerce-arch-graph.js`

## Rule

Before changing a structurally relevant file, read its architecture header.
If a file has no header or aggregation owner yet, classify it before changing behavior.

The headers are the source of truth. The generated graph is the intervention schema.

## Total Cartography Rule

Every source file must be represented in the graph.

A file has three possible statuses:

1. Full node: complete `@komerce-arch` header.
2. Lite node: short `@komerce-arch-lite` header attached to an owner.
3. Orphan/debt: no header or owner yet; must be classified before structural edits.

No useful file should remain invisible.
If a file has no independent utility, it should be merged into its owner or removed.
If it has utility, it must be mapped.

## Living Graph Rule

The architecture graph is generated from headers, not written manually.

Source fields:

- `@role`
- `@domain`
- `@layer`
- `@criticality`
- `@owner`
- `@purpose`
- `@depends`
- `@used-by`
- `@db-read`
- `@db-write`
- `@db-txn`
- `@doctrine`
- `@impact-areas`

Generated outputs:

- `docs/KOMERCE_ARCH_HEADER_GRAPH.md`
- `docs/komerce-arch-header-graph.json`

Maintenance rule:

- update the file header when a file contract changes
- use `@komerce-arch-lite` for files fully owned by another mapped node
- regenerate the graph after header changes
- do not hand-edit the generated graph
- if DB reads/writes change, update `@db-read`, `@db-write`, `@db-txn` first

Workflow:

- `.github/workflows/generate-komerce-arch-graph.yml`

## Phase 1 — Critical Spine

Applied and verified.

Backend:

- `server.js`
- `bootstrap/api-routes.js`
- `bootstrap/crons.js`
- `services/shared-cart-engine.js`
- `routes/shared-cart.js`
- `routes/payments.js`
- `services/order-payment-confirmation.js`
- `routes/otp.js`
- `routes/economic-engine.js`
- `services/economic-engine-queries.js`

Boutique:

- `public/boutique/js/boutique.js`
- `public/boutique/js/b-cart.js`
- `public/boutique/js/b-checkout.js`
- `public/boutique/js/b-group-view.js`
- `public/boutique/js/b-catalog.js`
- `public/boutique/js/b-subcat.js`
- `public/boutique/js/b-share-cart.js`
- `public/boutique/js/b-nav.js`

Correction applied:

- `b-boutique.js` references normalized to the real `boutique.js` entrypoint.

## Phase 2 — Boutique Deep Graph

Applied and verified on representative files.

Covered domains:

- product modal orchestration
- desktop modal enhancements
- product modal content rendering
- mobile category pager
- desktop catalog enhancers
- modal view model
- event workspace public/manage pages
- mini cart
- shared cart creator rendering
- tracking view
- boutique API client
- checkout DOM renderer
- phone normalization
- taxonomy schema
- client identity
- home navigation controller
- floating cart pill
- shared boutique state
- modal suggestions
- hybrid modal flow
- modal image UX
- utilities
- product store
- group banner
- event payment
- scroll ownership
- home sections renderer
- favorites view
- group API
- group helpers

Representative files verified:

- `public/boutique/js/b-modal-core.js`
- `public/boutique/js/b-pager.js`
- `public/boutique/js/b-identity.js`
- `public/boutique/js/b-tracking.js`
- `public/boutique/js/b-store.js`
- `public/boutique/js/group/group-api.js`

## Phase 3 — Backend Business Graph

Applied and verified on representative files.

Covered domains:

- Stripe payment service
- cash payment confirmation
- order status state machine
- order domain helpers
- notification orchestration
- Meta WhatsApp adapter
- orders HTTP facade
- products HTTP facade
- shared cart estimation
- shared cart financial guard
- shared cart items update service
- shared cart V4.1 transition projector
- shared cart DB query service
- wallet HTTP facade
- boutique taxonomy admin API
- boutique suggestions HTTP facade

Representative files verified:

- `services/payment-stripe.js`
- `services/order-status-machine.js`
- `routes/orders.js`
- `services/shared-cart-v41-transitions.js`
- `routes/boutique-suggestions.js`
- `routes/admin-boutique-categories.js`

## Phase DB — Database Touchpoints

Applied and verified on representative files.

Covered metadata:

- `@db-read`
- `@db-write`
- `@db-txn`

Representative files verified:

- `services/shared-cart-engine.js`
- `services/payment-stripe.js`
- `services/order-payment-confirmation.js`
- `routes/otp.js`
- `routes/orders.js`
- `services/economic-engine-queries.js`

## Phase 4 — Total Coverage

Next objective: no silent source file.

Priority:

- add full headers to remaining structural `routes/*`, `services/*`, `middleware/*`, `utils/*`
- add lite headers to small helper/render/test/config files that have a clear owner
- aggregate tiny boutique modules under their owner node
- aggregate tests under the doctrine or module they protect
- aggregate migrations under schema/domain owners only when they encode architecture
- keep generated graph as the authoritative intervention index

## Tooling Added

Header application scripts:

- `scripts/apply-komerce-arch-headers.js`
- `scripts/apply-komerce-arch-headers-phase2.js`
- `scripts/apply-komerce-arch-headers-phase3.js`

DB enrichment script:

- `scripts/enrich-komerce-arch-db-fields.js`

Graph and audit scripts:

- `scripts/audit-komerce-arch-headers.js`
- `scripts/generate-komerce-arch-graph.js`

One-shot workflows:

- `.github/workflows/apply-komerce-arch-headers-once.yml`
- `.github/workflows/apply-komerce-arch-headers-phase2-once.yml`
- `.github/workflows/apply-komerce-arch-headers-phase3-once.yml`
- `.github/workflows/enrich-komerce-arch-db-fields-once.yml`
- `.github/workflows/audit-komerce-arch-headers-once.yml`
- `.github/workflows/generate-komerce-arch-graph-once.yml`

Permanent workflows:

- `.github/workflows/apply-komerce-arch-headers.yml`
- `.github/workflows/generate-komerce-arch-graph.yml`

## Current Position

The critical behavioral spine is now cartographed:

- boutique discovery and navigation
- cart and side-cart
- checkout
- OTP/client identity
- shared cart creator/participant flow
- payment and order confirmation
- order status machine
- product catalog and taxonomy
- personalization/suggestions entrypoint
- notifications and WhatsApp adapter
- economic engine facade/service
- DB reads/writes/transaction constraints for critical backend files

This gives AI agents a much stronger starting point before intervention:

- what the file does
- what it receives
- what it emits
- what it depends on
- what depends on it
- which owner owns it if it is aggregated
- which DB tables it reads/writes
- which transaction/idempotency constraints matter
- which doctrines must not be broken
- which user/business flows may be impacted
