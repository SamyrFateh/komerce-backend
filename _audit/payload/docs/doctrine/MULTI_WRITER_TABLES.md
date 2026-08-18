# Dette architecturale — Tables multi-écrivains

> Mis à jour 2026-07-07 — état post-Sprints A/B/C.
> 38 tables ont 2+ features déclarées en écriture directe (W/RW dans manifest).
> Objectif : 1 table = 1 écrivain direct, les autres en délégation `W-via:<service>`.

---

## Convention

| Notation | Signification |
|---|---|
| `'table: W'` / `'table: RW'` dans le manifest | Écriture SQL directe dans les fichiers de la feature |
| `// table : W-via:<service>` (commentaire manifest) | Écriture déléguée via un service d'une autre feature — hors parsing |
| `@db-write-via:<service>` (header fichier) | Annotation transitive dans le fichier qui appelle le service |

Services SSOT existants :
- `order-status-machine.js` (orders) — `transitionOrderStatus()` + `appendOrderHistoryNote()`
- `refund-service.js` (refunds) — `processRefund()` + `recordExternalRefund()`
- `product-admin-service.js` (catalog) — `adjustStock()` + CRUD produits

---

## ✅ Sprints terminés

| Sprint | Table | Avant | Après | Mécanisme |
|---|---|---|---|---|
| A | `order_status_history` | 5 écrivains | 3 | `appendOrderHistoryNote()` — parcel-operations.js et payment-paypal.js migrés |
| B | `refunds` | 3 écrivains | **1** ✅ | `recordExternalRefund()` — payment-paypal, shared-cart-refund-queue, cancel-shared-cart migrés |
| C | `products` (stock) | 5 écrivains | 3 | `adjustStock()` — order-payment-confirmation, order-status-machine, parcel-operations migrés |
| C | `product_variants` | 3 écrivains | 2 | idem (variantes gérées dans adjustStock) |

---

## Tier 1 — Tables critiques (5+ écrivains directs)

### `orders` — 9 écrivains
customs, dashboard, inventory, logistics, orders, payments, platform-ops, shared-cart, wallet-loyalty

Le chantier le plus lourd (Sprint E). Chemin : toutes les mutations `orders`
passent par `order-service.js` / `transitionOrderStatus()`. À découper par
type de mutation (status, payment_status, montants, métadonnées).

### `alerts` — 6 écrivains
catalog, logistics, notifications, orders, payments, shared-cart

Pattern event-source acceptable si chaque feature ne crée que ses propres
alertes. À documenter par domaine, pas de consolidation urgente.

### `users` — 5 écrivains
auth-identity, auth, dashboard, infrastructure, wallet-loyalty

auth = owner. dashboard = purge admin (DELETE cascade). infrastructure =
startup-migrations DDL uniquement. Résolution naturelle via API de purge (Sprint E).

### `parcels` — 5 écrivains
customs, dashboard, logistics, payments, platform-ops

logistics = owner. Sprint D : exposer `logistics.transitionParcelStatus()` ;
customs (customs_cleared_at) et payments (statut post-paiement) migrent.

### `incidents` — 5 écrivains
dashboard, logistics, notifications, payments, platform-ops

Pattern event-source acceptable (chaque feature crée ses incidents par domaine).

---

## Tier 2 — Tables à 3-4 écrivains

| Table | Écrivains | Owner | Note |
|---|---|---|---|
| `order_items` | dashboard, logistics, orders, shared-cart | orders | dashboard = purge admin |
| `parcel_items` | dashboard, inventory, logistics, platform-ops | logistics | |
| `scans` | dashboard, logistics, orders, platform-ops | logistics | |
| `products` | catalog, dashboard, economic-engine | catalog | dashboard = purge/restock dev ; economic-engine = prix. Post-Sprint C |
| `order_status_history` | dashboard, orders, shared-cart | orders | shared-cart = t=0 création ; dashboard = purge. Post-Sprint A |
| `recipients` | dashboard, orders, shared-cart | orders | dashboard = DELETE cascade purge |

---

## Tier 3 — Tables à 2 écrivains (26)

Ownership clair, patterns légitimes (purge admin, seed infra, dual ownership
documenté). Ne bloquent pas le CRUD feature-first. Se résolvent naturellement
quand les purges admin passeront par des API feature (Sprint E).

---

## Roadmap restante

| Sprint | Cible | Action | Impact |
|---|---|---|---|
| **D** | `parcels` | Exposer `logistics.transitionParcelStatus()` ; customs et payments migrent | 5 → 3 |
| **E** | `orders` + purges | `order-service.js` pour toutes les mutations ; API `adminPurge()` par feature | 9 → 1 |

---

## Règle d'or pour le CRUD

Avant de toucher une table de ce document, lancer :

```bash
node scripts/impact-check.js --files=<fichiers-du-ticket>
```

Le score de risque intègre le nombre de co-écrivains. Tier 1 → tests
croisés obligatoires sur toutes les features listées.
