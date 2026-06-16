# Komerce Architecture Headers

`@komerce-arch` is a short, standardized, parseable metadata layer for Komerce files.

It does not replace product doctrine. It tells humans and AI where doctrine lives in code, what a file expects, what it produces, what it depends on, and what can break if it changes.

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
 * @doctrine      paiement_seul_acte_engageant, panier_ouvert_ferme, fenetre_paiement_48h, choix_createur_72h
 * @impact-areas  checkout, participant-flow, creator-dashboard, notifications, economic-engine
 * @version       2026-06
 */
```

## Rules

- Keep headers short: 10 to 14 lines.
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
4. List relevant doctrines.
5. Announce the intervention map.
6. Edit only after that.

## Initial Domains

`bootstrap`, `shared-cart`, `checkout`, `payment`, `auth`, `notification`, `economic-engine`, `catalog`, `boutique`, `order`, `inventory`, `dashboard`, `pricing`, `sourcing`.

## Initial Layers

`entrypoint`, `route`, `service`, `machine`, `cron`, `ui-page`, `ui-component`, `ui-state`, `ui-layout`, `catalog-data`, `ux-policy`, `script`.
