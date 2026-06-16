# Komerce Architecture Headers

`@komerce-arch` is a short, standardized, parseable metadata layer for Komerce files.

It does not replace product doctrine. It tells humans and AI where doctrine lives in code, what a file expects, what it produces, what it depends on, which database surfaces it touches, and what can break if it changes.

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

- Keep headers short: 10 to 17 lines when DB fields are needed.
- Describe contracts, role, doctrine and impact, not implementation details.
- `@depends` lists verified technical or business dependencies.
- `@used-by` lists significant consumers. Use `@unknown` if not verified.
- `@doctrine` lists invariants that must not be broken.
- `@impact-areas` lists flows to verify before editing.
- `@criticality` is one of `low`, `medium`, `high`, `critical`.
- Trivial helpers, simple tests, config files and migrations do not need full headers.

## Mandatory AI Workflow

Before modifying Komerce code:

1. Read `docs/KOMERCE_ARCHITECTURE_MAP.md` or the machine-readable map.
2. Identify target files.
3. List related files through `depends`, `used-by` and `impact-areas`.
4. List relevant DB reads, DB writes and transaction constraints.
5. List relevant doctrines.
6. Announce the intervention map.
7. Edit only after that.

## Initial Domains

`bootstrap`, `shared-cart`, `checkout`, `payment`, `auth`, `notification`, `economic-engine`, `catalog`, `boutique`, `order`, `inventory`, `dashboard`, `pricing`, `sourcing`, `wallet`, `tracking`, `recommendations`.

## Initial Layers

`entrypoint`, `route`, `service`, `machine`, `policy`, `cron`, `data-service`, `external-adapter`, `api-client`, `ui-page`, `ui-component`, `ui-state`, `ui-layout`, `view-model`, `schema`, `catalog-data`, `ux-policy`, `script`.
