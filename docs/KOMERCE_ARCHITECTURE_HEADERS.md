# Komerce Architecture Headers

`@komerce-arch` is a short, standardized, parseable metadata layer for Komerce files.

It does not replace product doctrine. It tells humans and AI where doctrine lives in code, what a file expects, what it produces, what it depends on, which database surfaces it touches, and what can break if it changes.

## Core Rule

Every source file must be represented in the architecture map.

A file can be represented in one of three ways:

1. Full node: the file has a complete `@komerce-arch` header.
2. Aggregated node: the file is explicitly attached to a parent/header owner.
3. Orphan/debt: the file is not yet understood and must be resolved before structural edits.

No structurally relevant file should remain silent.
If a file has no utility, it should be removed or merged. If it has utility, it should be mapped.

## Official Header

```js
/**
 * @komerce-arch
 * @role          shared-cart-state-machine
 * @domain        shared-cart
 * @layer         service
 * @criticality   critical
 * @inputs        cart_id, current_status, payment_event, timer_event
 * @outputs       next_status, events_to_emit, notifications
 * @depends       bootstrap/crons.js, routes/shared-cart.js, services/order-payment-confirmation.js
 * @used-by       bootstrap/crons.js, routes/shared-cart.js
 * @db-read       shared_carts, shared_cart_contributions, orders
 * @db-write      shared_carts, shared_cart_events, orders
 * @db-txn        required_for_status_transition, idempotent_payment_events
 * @doctrine      paiement_seul_acte_engageant, panier_ouvert_ferme, fenetre_paiement_48h, choix_createur_72h
 * @impact-areas  checkout, participant-flow, creator-dashboard, notifications, economic-engine
 * @version       2026-06
 */
```

## Lightweight Aggregation Header

Use this for tiny files, pure constants, simple render helpers, narrow adapters, tests that only support a mapped owner, or files that should not become first-class architecture nodes.

```js
/**
 * @komerce-arch-lite
 * @role          product-card-render-helper
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       renders product card HTML for catalog surfaces
 * @impact-areas  product-grid, modal-entry
 * @version       2026-06
 */
```

Rules:

- Use `@komerce-arch` for structural nodes.
- Use `@komerce-arch-lite` for files whose impact is fully owned by another node.
- `@owner` is mandatory for lite headers.
- If no clear owner exists, the file is not lite; give it a full header or mark it as architecture debt.

## Database Fields

Database fields are optional, but mandatory for high/critical backend files that touch persistent state.

- `@db-read` lists the main tables read by the file.
- `@db-write` lists the main tables inserted, updated or deleted by the file.
- `@db-txn` lists transaction, lock, idempotency or consistency constraints.

Rules:

- Keep DB fields at table/contract level, not query level.
- Do not list every incidental lookup if it creates noise.
- Always list financial, order, stock, wallet, OTP and shared-cart writes.
- Use `none` for high/critical files that deliberately avoid database access.
- If unknown, use `@db-read @unknown` or `@db-write @unknown` and resolve before behavior changes.

## Rules

- Full headers stay short: 10 to 17 lines when DB fields are needed.
- Lite headers stay very short: 6 to 8 lines.
- Describe contracts, role, doctrine and impact, not implementation details.
- `@depends` lists verified technical or business dependencies.
- `@used-by` lists significant consumers. Use `@unknown` if not verified.
- `@doctrine` lists invariants that must not be broken.
- `@impact-areas` lists flows to verify before editing.
- `@criticality` is one of `low`, `medium`, `high`, `critical`.
- Tests, config files and migrations can be aggregated, but should not be invisible when they encode architecture or doctrine.

## Mandatory AI Workflow

Before modifying Komerce code:

1. Read `docs/komerce-arch-header-graph.json`.
2. Identify target files.
3. Locate the target in `interventionIndex` or through its lite `@owner`.
4. List related files through `depends`, `used-by`, `owner`, `db-read`, `db-write` and `impact-areas`.
5. List relevant DB reads, DB writes and transaction constraints.
6. List relevant doctrines.
7. Announce the intervention map.
8. Edit only after that.

## Initial Domains

`bootstrap`, `shared-cart`, `checkout`, `payment`, `auth`, `notification`, `economic-engine`, `catalog`, `boutique`, `order`, `inventory`, `dashboard`, `pricing`, `sourcing`, `wallet`, `tracking`, `recommendations`, `test`, `config`, `migration`.

## Initial Layers

`entrypoint`, `route`, `service`, `machine`, `policy`, `cron`, `data-service`, `external-adapter`, `api-client`, `ui-page`, `ui-component`, `ui-state`, `ui-layout`, `ui-renderer`, `view-model`, `schema`, `catalog-data`, `ux-policy`, `script`, `test`, `config`, `migration`.
