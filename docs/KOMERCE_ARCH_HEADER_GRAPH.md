# Komerce Architecture Header Graph

Version: 2026-06

This file is the human-readable graph entrypoint for the `@komerce-arch` layer.

Source of truth: file headers.
Generated target: `docs/komerce-arch-header-graph.json`.
Generator: `node scripts/generate-komerce-arch-graph.js`.

> Maintenance rule: do not hand-edit this file for durable changes. Update file headers first, then regenerate the graph.

## Current Status

The graph generator is present and dependency-free. It scans:

- `server.js`
- `bootstrap/**`
- `routes/**`
- `services/**`
- `middleware/**`
- `utils/**`
- `public/boutique/js/**`

It creates:

- file nodes
- DB table nodes
- doctrine nodes
- impact-area nodes
- dependency edges
- usage edges
- DB read/write edges
- doctrine edges
- impact edges
- unresolved-code-edge diagnostics
- per-file `interventionIndex`

## Intervention Rule

Before modifying a structural file, an IA must open:

```txt
docs/komerce-arch-header-graph.json
```

Then read:

```txt
interventionIndex["<file-path>"]
```

The IA must list before editing:

- direct dependencies
- direct consumers
- DB tables read or written
- doctrines to preserve
- impact areas
- `mustCheck` targets

## Critical Seed Nodes

These nodes are already known as first-class intervention roots:

- `server.js` — API/runtime entrypoint
- `bootstrap/api-routes.js` — API route manifest
- `bootstrap/crons.js` — operational cron launcher
- `services/shared-cart-engine.js` — shared cart state machine
- `routes/shared-cart.js` — shared cart HTTP facade
- `services/order-payment-confirmation.js` — payment-to-stock single entry
- `services/payment-stripe.js` — Stripe adapter/webhook bridge
- `services/payment-cash-confirm.js` — cash confirmation adapter
- `services/order-status-machine.js` — order lifecycle machine
- `routes/orders.js` — order HTTP facade
- `routes/otp.js` — OTP/auth facade
- `routes/economic-engine.js` — economic engine API facade
- `services/economic-engine-queries.js` — economic engine DB/calculation layer
- `services/whatsapp-meta.js` — Meta WhatsApp notification adapter
- `services/notification-service.js` — notification orchestration
- `routes/products.js` — product/catalog API facade
- `routes/admin-boutique-categories.js` — catalog taxonomy admin API
- `routes/wallet.js` — wallet ledger API
- `public/boutique/js/boutique.js` — boutique orchestrator
- `public/boutique/js/b-cart.js` — cart and side-cart
- `public/boutique/js/b-checkout.js` — checkout orchestrator
- `public/boutique/js/b-group-view.js` — shared cart participant/creator view
- `public/boutique/js/b-modal-core.js` — product modal shell
- `public/boutique/js/b-catalog.js` — product discovery/catalog rendering
- `public/boutique/js/b-subcat.js` — subcategory navigation
- `public/boutique/js/b-share-cart.js` — share-cart UX flow
- `public/boutique/js/b-nav.js` — boutique navigation/view switcher

## High-Value Intervention Examples

### Touching `public/boutique/js/b-cart.js`

Must check:

- `public/boutique/js/b-cart-core.js`
- `public/boutique/js/b-checkout.js`
- `public/boutique/js/b-modal-core.js`
- `public/boutique/js/b-share-cart.js`
- `routes/shared-cart.js`
- `impact:side-cart`
- `impact:checkout-entry`
- `impact:participant-flow`
- `doctrine:panier_ouvert_ferme`
- `doctrine:participant_lecture_seule`

### Touching `services/order-payment-confirmation.js`

Must check:

- `services/payment-stripe.js`
- `services/payment-cash-confirm.js`
- `services/shared-cart-engine.js`
- `services/order-status-machine.js`
- `db:orders`
- `db:order_items`
- `db:stock_movements`
- `db:wallet_transactions`
- `doctrine:transaction_existante_obligatoire`
- `doctrine:confirmPaymentCycle_unique`
- `doctrine:stock_for_update`

### Touching `services/shared-cart-engine.js`

Must check:

- `bootstrap/crons.js`
- `routes/shared-cart.js`
- `services/order-payment-confirmation.js`
- `services/whatsapp-meta.js`
- `db:shared_carts`
- `db:shared_cart_contributions`
- `db:orders`
- `impact:participant-flow`
- `impact:creator-flow`
- `impact:notifications`
- `doctrine:paiement_seul_acte_engageant`
- `doctrine:fenetre_paiement_48h`
- `doctrine:choix_createur_72h`

## Next Regeneration

Run:

```bash
node scripts/generate-komerce-arch-graph.js
```

The generated JSON is the machine-readable contract used by IA agents.
