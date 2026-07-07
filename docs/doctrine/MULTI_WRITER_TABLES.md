# Dette architecturale — Tables multi-écrivains

> Régénéré automatiquement le 2026-07-07 par `scripts/generate-multi-writer-report.js` — source de vérité : `features/*.feature.js` (db.tables) croisé avec `docs/komerce-arch-header-graph.json` (headers @db-write / @db-write-via réels).
> 40 tables ont 2+ features déclarées en écriture directe (W/RW dans manifest).
> Ce fichier remplace une version figée à la main (2026-07-07, 37 tables) devenue
> stale après les corrections du §3 de `VERIFICATION_AUDIT_2026-07-07.md` (3 tables nouvellement multi-écrivains : `order_item_real_cost_allocations`, `sms_log`, `transaction_documents`).

## Méthode et verdict de vérification empirique

Pour chaque `(feature, table)` déclaré `W`/`RW`, on vérifie si un fichier
réellement possédé par la feature porte un `@db-write` direct sur cette
table (pas seulement une délégation `@db-write-via`).

- **176** couples (feature, table) en écriture au total
- **175** confirmés par du vrai `@db-write` direct — ce ne sont PAS des erreurs de manifest, la multipropriété est réelle au niveau du code, vérifiée jusqu'au SQL brut (échantillon `orders` : 4 `UPDATE orders SET ...` retrouvés dans 4 features indépendantes).
- **0** délégation pure (déclaré W/RW mais seule preuve = `@db-write-via`) → candidats à correction de manifest.
- **1** orphelin (W/RW déclaré, aucune preuve directe ni déléguée) → à examiner.

**Conséquence pour le chantier CRUD** : contrairement à `§3` (dette de
*documentation*, corrigée par simple édition de manifest) et aux `@unknown`
`@depends`/`@used-by` (idem), la multipropriété d'écriture ici est une dette
*architecturale réelle* — la corriger veut dire migrer du code (des `UPDATE`
directs vers un service unique), pas éditer un header. Aucune correction de
manifest automatique n'a été appliquée dans cette passe : il n'y a rien à
corriger côté déclaration, la dette est dans le code lui-même.

### Orphelins (W/RW déclaré sans preuve directe ni déléguée)

- `infrastructure` / `schema_migrations` (RW) — connu : écrit par `scripts/run-migrations.js`, hors `SCAN_ROOTS` du générateur de graphe (angle mort outillage documenté depuis `VERIFICATION_AUDIT_2026-07-07.md`), pas une fausse déclaration.

---

## Inventaire complet, par nombre d'écrivains directs

### Tier 1 — 5+ écrivains directs (critique)

| Table | Écrivains | Preuve |
|---|---|---|
| `orders` (9) | customs, dashboard, inventory, logistics, orders, payments, platform-ops, shared-cart, wallet-loyalty | ✅ tous confirmés directs |
| `alerts` (6) | catalog, logistics, notifications, orders, payments, shared-cart | ✅ tous confirmés directs |
| `incidents` (5) | dashboard, logistics, notifications, payments, platform-ops | ✅ tous confirmés directs |
| `order_status_history` (5) | dashboard, logistics, orders, payments, shared-cart | ✅ tous confirmés directs |
| `parcels` (5) | customs, dashboard, logistics, payments, platform-ops | ✅ tous confirmés directs |
| `products` (5) | catalog, dashboard, economic-engine, logistics, orders | ✅ tous confirmés directs |
| `users` (5) | auth, auth-identity, dashboard, infrastructure, wallet-loyalty | ✅ tous confirmés directs |

### Tier 2 — 3-4 écrivains directs

| Table | Écrivains | Preuve |
|---|---|---|
| `order_items` (4) | dashboard, logistics, orders, shared-cart | ✅ tous confirmés directs |
| `parcel_items` (4) | dashboard, inventory, logistics, platform-ops | ✅ tous confirmés directs |
| `scans` (4) | dashboard, logistics, orders, platform-ops | ✅ tous confirmés directs |
| `transaction_documents` (4) | customs, documents, shared-cart, wallet-loyalty | ✅ tous confirmés directs |
| `product_variants` (3) | catalog, economic-engine, orders | ✅ tous confirmés directs |
| `recipients` (3) | dashboard, orders, shared-cart | ✅ tous confirmés directs |
| `refunds` (3) | payments, refunds, shared-cart | ✅ tous confirmés directs |

### Tier 3 — 2 écrivains directs

| Table | Écrivains | Preuve |
|---|---|---|
| `basket_items` (2) | dashboard, shared-cart | ✅ tous confirmés directs |
| `baskets` (2) | dashboard, shared-cart | ✅ tous confirmés directs |
| `cart_shares` (2) | orders, shared-cart | ✅ tous confirmés directs |
| `charges` (2) | economic-engine, infrastructure | ✅ tous confirmés directs |
| `economic_snapshots` (2) | economic-engine, infrastructure | ✅ tous confirmés directs |
| `finance_config` (2) | economic-engine, infrastructure | ✅ tous confirmés directs |
| `invoices` (2) | dashboard, orders | ✅ tous confirmés directs |
| `loyalty_rewards` (2) | dashboard, wallet-loyalty | ✅ tous confirmés directs |
| `notification_log` (2) | notifications, platform-ops | ✅ tous confirmés directs |
| `order_comments` (2) | dashboard, orders | ✅ tous confirmés directs |
| `order_item_real_cost_allocations` (2) | customs, economic-engine | ✅ tous confirmés directs |
| `pickup_print_tokens` (2) | infrastructure, logistics | ✅ tous confirmés directs |
| `pickup_reveal_codes` (2) | infrastructure, logistics | ✅ tous confirmés directs |
| `price_history` (2) | catalog, economic-engine | ✅ tous confirmés directs |
| `product_suppliers` (2) | dashboard, orders | ✅ tous confirmés directs |
| `purchase_orders` (2) | dashboard, orders | ✅ tous confirmés directs |
| `relais` (2) | dashboard, logistics | ✅ tous confirmés directs |
| `revoked_tokens` (2) | auth-identity, infrastructure | ✅ tous confirmés directs |
| `scan_events` (2) | dashboard, logistics | ✅ tous confirmés directs |
| `sms_log` (2) | dashboard, orders | ✅ tous confirmés directs |
| `sourcing_candidate_events` (2) | catalog, logistics | ✅ tous confirmés directs |
| `sourcing_candidates` (2) | catalog, logistics | ✅ tous confirmés directs |
| `stripe_events_processed` (2) | payments, shared-cart | ✅ tous confirmés directs |
| `suppliers` (2) | dashboard, orders | ✅ tous confirmés directs |
| `wallet_transactions` (2) | dashboard, wallet-loyalty | ✅ tous confirmés directs |
| `wallets` (2) | dashboard, wallet-loyalty | ✅ tous confirmés directs |

---

## Jugements architecturaux hérités (non re-vérifiés dans cette passe)

La version précédente de ce document assignait un "owner canonique" et une
roadmap de sprints (A→E) par table. Ce sont des jugements d'architecture, pas
des faits vérifiables par grep — ils ne sont donc **pas régénérés
automatiquement** ici. Reproduits tels quels pour ne rien perdre, à
re-valider avec l'équipe avant d'être pris pour argent comptant (le reste de
cet audit a montré plusieurs fois que des affirmations non vérifiées
empiriquement s'avéraient fausses) :

| Table | Owner canonique proposé (hérité) | Action proposée (héritée) |
|---|---|---|
| `orders` | orders (`order-service.js`, `order-status-machine.js`) | 8 autres features migrent leurs écritures directes |
| `order_status_history` | orders (`transitionOrderStatus()`) | `parcel-operations.js` (logistics) insère encore en direct — à re-vérifier |
| `products` | catalog | exposer `catalog.updateStock()` |
| `parcels` | logistics | exposer `logistics.transitionParcelStatus()` |
| `refunds` | refunds (`refund-service.js`) | payments/shared-cart migrent |
| `users` | auth | dashboard = purge admin ; infrastructure = DDL |

Sprints proposés dans la version précédente (non ré-audités) :
A) `order_status_history` — migrer `parcel-operations.js` ; B) `refunds` — supprimer INSERT directs payments/shared-cart ; C) `products` stock — exposer `catalog.updateStock()` ; D) `parcels` statut — exposer `logistics.transitionParcelStatus()` ; E) `orders` — tout via `order-service.js`.

**Avant de lancer un de ces sprints** : re-vérifier chaque affirmation au
niveau du SQL réel (comme fait ici pour `orders`), pas seulement au niveau du
manifest — c'est la méthode qui a évité plusieurs fausses pistes dans le
reste de cet audit.
