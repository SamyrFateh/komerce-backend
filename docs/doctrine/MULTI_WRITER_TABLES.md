# Dette architecturale — Tables multi-écrivains

> Généré 2026-07-07 — suite de l'audit FEATURE_MONOREPO_2026-07-07 §4.
> 37 tables ont 2+ features déclarées en écriture directe (W/RW dans manifest).
> But final : 1 table = 1 écrivain direct, les autres en délégation W-via:<service>.

---

## Principe de classification

| Notation manifest | Signification |
|---|---|
| `table: W` ou `table: RW` | Écriture SQL directe dans les fichiers de la feature |
| `table: R` + commentaire `// W-via:service` | Lecture directe, écriture déléguée via un service d'une autre feature |
| `@db-write-via:service` (header fichier) | Annotation transitive dans le fichier source |

---

## Tier 1 — Tables critiques (5+ écrivains directs)

Chaque modification doit être testée contre toutes les features co-écrivantes.
**Cible : consolidation en service unique avant tout chantier CRUD.**

### `orders` — 9 écrivains
customs, dashboard, inventory, logistics, orders, payments, platform-ops, shared-cart, wallet-loyalty

Chemin : `order-status-machine.js` et `order-service.js` (feature orders) existent déjà.
Les 8 autres features doivent migrer leurs mutations orders vers ces services.

### `order_status_history` — 5 écrivains
dashboard, logistics, orders, payments, shared-cart

Toute insertion doit passer par `transitionOrderStatus()` (orders/order-status-machine.js).
`parcel-operations.js` (logistics) insère encore directement — à migrer en Sprint A.

### `alerts` — 5 écrivains
catalog, logistics, orders, payments, shared-cart

Pattern acceptable si chaque feature produit ses propres alertes sans lecture croisée.

### `products` — 5 écrivains
catalog, dashboard, economic-engine, logistics, orders

`catalog` est l'écrivain canonique. Chemin Sprint C : exposer `catalog.updateStock()`.

### `parcels` — 5 écrivains
customs, dashboard, logistics, payments, platform-ops

`logistics` est l'écrivain canonique. Chemin Sprint D : exposer `logistics.transitionParcelStatus()`.

### `incidents` — 5 écrivains
dashboard, logistics, notifications, payments, platform-ops

Pattern acceptable si chaque feature crée ses propres incidents par domaine.

---

## Tier 2 — Tables à 3-4 écrivains (CRUD sous surveillance)

| Table | Écrivains | Owner canonique | Note |
|---|---|---|---|
| `order_items` | dashboard, logistics, orders, shared-cart | orders | dashboard = purge admin |
| `parcel_items` | dashboard, inventory, logistics, platform-ops | logistics | |
| `scans` | dashboard, logistics, orders, platform-ops | logistics | |
| `product_variants` | catalog, economic-engine, orders | catalog | orders écrit via order-status-machine (stock à la commande) |
| `recipients` | dashboard, orders, shared-cart | orders | dashboard = DELETE cascade purge admin ✅ |
| `refunds` | payments, refunds, shared-cart | refunds | payments et shared-cart → migrer vers refund-service.js (Sprint B) |
| `users` | auth-identity, auth, dashboard, infrastructure, wallet-loyalty | auth | dashboard = purge admin ; infrastructure = DDL uniquement ✅ |

---

## Tier 3 — Tables à 2 écrivains (monitoring passif)

Patterns légitimes ou ownership clair — ne bloquent pas le CRUD feature-first.

| Table | Écrivains | Verdict |
|---|---|---|
| `basket_items`, `baskets` | dashboard, shared-cart | shared-cart = owner ; dashboard = DELETE cascade ✅ |
| `cart_shares` | orders, shared-cart | shared-cart = owner ; orders crée le share initial ✅ |
| `charges`, `economic_snapshots`, `finance_config` | economic-engine, infrastructure | infrastructure = DDL + seed ; economic-engine = owner runtime ✅ |
| `invoices` | dashboard, orders | orders = owner ; dashboard = régénération admin |
| `loyalty_rewards` | dashboard, wallet-loyalty | wallet-loyalty = owner ; dashboard = actions manuelles admin ✅ |
| `notification_log` | notifications, platform-ops | notifications = owner |
| `order_comments` | dashboard, orders | orders = owner |
| `pickup_print_tokens`, `pickup_reveal_codes` | infrastructure, logistics | logistics = owner runtime ; infrastructure = seed ✅ |
| `price_history` | catalog, economic-engine | catalog = owner |
| `purchase_orders`, `suppliers`, `product_suppliers` | dashboard, orders | orders = owner |
| `relais` | dashboard, logistics | logistics = owner ; dashboard = purge admin |
| `revoked_tokens` | auth-identity, infrastructure | auth-identity = owner runtime ; infrastructure = purge cron ✅ |
| `scan_events` | dashboard, logistics | logistics = owner |
| `sourcing_candidates`, `sourcing_candidate_events` | catalog, logistics | catalog = owner |
| `stripe_events_processed` | payments, shared-cart | payments = owner |
| `wallet_transactions`, `wallets` | dashboard, wallet-loyalty | wallet-loyalty = owner ; dashboard = DELETE cascade ✅ |

---

## Roadmap de consolidation

| Sprint | Cible | Action | Impact multi-writers |
|---|---|---|---|
| **A** | `order_status_history` | Migrer `parcel-operations.js` vers `transitionOrderStatus()` | 5 → 4 |
| **B** | `refunds` | Supprimer INSERT directs payments/shared-cart, tout via `refund-service.js` | 3 → 1 |
| **C** | `products` stock | Exposer `catalog.updateStock()`; logistics et orders migrent | 5 → 3 |
| **D** | `parcels` statut | Exposer `logistics.transitionParcelStatus()`; customs et payments migrent | 5 → 3 |
| **E** | `orders` | Tous via `order-service.js` / `transitionOrderStatus()` | 9 → 1 (objectif) |

Tier 3 : se résout naturellement quand les purges admin passent par des API feature.
