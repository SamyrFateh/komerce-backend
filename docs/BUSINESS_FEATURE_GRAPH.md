# Business Feature Graph — Komerce (Lot O3)

> Généré par `scripts/business-graph-gen.js`. Ne pas éditer à la main.
> Source d'autorité : FEATURE_DOCTRINE > APP_FEATURE_REGISTRY > features/*.feature.js > ce document.
> Vérifié par `node scripts/business-graph-gen.js --check` (`npm run business-graph:check`).

## Feature Map

### Business features

- `auth-identity`
- `catalog`
- `customs`
- `economic-engine`
- `inventory`
- `logistics`
- `loyalty`
- `orders`
- `payments`
- `purchasing`
- `recommendations`
- `shared-cart`
- `sourcing`
- `unsold-resolution`
- `wallet`

### Business transversals

- `business-rules`
- `dashboard`
- `documents`
- `incident-management`
- `notifications`
- `refunds`

### Technical transversals

- `auth`
- `platform-ops`

### Piloting capabilities

- `decision-signals`

### Projections / UI shells

- `admin-dashboard`
- `platform`

### Deprecated

- `legacy-control-tower`
- `wallet-loyalty`

## Big Map — couverture cross-scope (Lot O4)

Synthèse de couverture par scope et identités métier cross-scope. Voir mission O4 §13.

> **Note de terminologie (Lot O4-2, point 9)** — "cross-repo" dans les livrables O4 précédents désignait en réalité un franchissement de **scope** (frontière de gouvernance : manifests/registre/autorité propres à backend, dash, boutique), pas nécessairement un franchissement d'**arbre** séparé. Le tableau ci-dessous constate la relation réelle par scope, dérivée uniquement des chemins configurés (déterministe, indépendante de la présence de `.git`). Tant qu'une ligne n'affiche pas `external-path-scope`, "cross-repo" doit se lire "cross-scope" — un franchissement de frontière de gouvernance à l'intérieur du même arbre.

### Topologie des scopes (relation de chemin constatée)

| Scope | Chemin monté | Relation constatée | Sous ROOT ? |
|---|---|---|---|
| backend | `.` | `self` | — |
| dash | `public` | `same-tree-scope` | oui |
| boutique | `public/boutique` | `same-tree-scope` | oui |

_"cross-repo" ailleurs dans ce document = cross-scope (frontière de gouvernance), sauf si relation="external-path-scope" ci-dessus pour le scope concerné._

### Par dépôt

| Dépôt | Manifests découverts | Manifests connectés | Nœuds techniques | Owned | Orphelins |
|---|---|---|---|---|---|
| backend | 25 | 25 | 290 | 290 | 0 |
| dash | 3 | 3 | N/A | N/A | N/A |
| boutique | 14 | 14 | 83 | 83 | 0 |

_dash_ : pas de Technical Architecture Graph propre au dépôt dash dans ce pipeline — non scanné par arch:gen backend, couverture non mesurable ici (SCOPE, pas un gap)

### Identités canoniques

- **Cross-repo features** (9) : `auth-identity`, `catalog`, `notifications`, `orders`, `payments`, `platform-ops`, `recommendations`, `shared-cart`, `wallet`
- **Single-repo features** (20) : `admin-dashboard`, `auth`, `business-rules`, `customs`, `dashboard`, `decision-signals`, `documents`, `economic-engine`, `incident-management`, `infrastructure`, `inventory`, `legacy-control-tower`, `logistics`, `loyalty`, `platform`, `purchasing`, `refunds`, `sourcing`, `unsold-resolution`, `wallet-loyalty`
- **Unmapped local manifests** (0) : —

### Ontology gaps

- **tracking-no-canonical-owner** (manifest boutique `tracking`)
  - constat : boutique/features/tracking.feature.js décrit un service d'analytics/tracking événementiel UI (suivi parcours, événements). Aucune feature backend ou dash canonique ne représente ce service : vérifié explicitement contre logistics (tracking colis physique — identité métier différente malgré le nom proche), infrastructure (middlewares/bootstrap transverses), notifications (émission de messages sortants, pas de collecte d'événements) et platform-ops (santé applicative). C'est un cas E pur (mission O4 §3) : véritable ONTOLOGY GAP, pas une erreur de nommage à corriger par une fusion.
  - décision actuelle : canonicalFeature reste null. sliceKind fixé à 'frontend-transversal' à titre PROVISOIRE — seule valeur du enum ALLOWED_SLICE_KINDS permettant d'éviter que ce manifeste retombe en BOUTIQUE-MANIFEST-UNGOVERNED, sans pour autant inventer une business feature. Ce n'est pas un vrai transversal multi-feature comme le manifeste `boutique` générique ou `platform` côté dash — c'est un classement de repli documenté.
  - question ouverte : Faut-il créer une feature 'analytics' dédiée côté backend/dash (si un service de collecte équivalent existe ou est prévu côté serveur), ou rattacher ce manifeste à une feature existante par proximité fonctionnelle (ex. platform-ops) ? Décision produit non tranchée par O4.

## Feature → implémentation

### admin-dashboard _(projection)_

> Tableau de bord admin SPA multi-vues.

- js: 41
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 1 — sourcing
- consumers: 0

### auth _(technical-transversal)_

> Fournir les gardes transverses d'authentification et de vérification d'identité (middlewares JWT/session/rôles) consommées par toutes les autres features.

- middleware: 6
- tests: 8
- tables owned (lifecycle): 0
- tables written: 1
- interfaces exposed: 0
- internal APIs: 3
- dependencies (consumes): 3 — notifications, platform-ops, orders
- consumers: 21 — auth-identity, business-rules, catalog, customs, dashboard, economic-engine, infrastructure, inventory, logistics, loyalty, notifications, orders, payments, platform-ops, purchasing, recommendations, shared-cart, sourcing, unsold-resolution, wallet, decision-signals

### auth-identity _(business-feature)_

> Authentifier un utilisateur et gérer son identité active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposées.

- services: 2
- routes: 3
- boutique: 3
- utils: 1
- migrations: 3
- tests: 6
- tables owned (lifecycle): 4 — `revoked_tokens`, `users`, `otp_codes`, `user_pickup_authorizations`
- tables written: 4
- interfaces exposed: 23
- internal APIs: 3
- dependencies (consumes): 4 — auth, notifications, wallet, documents
- consumers: 8 — catalog, documents, logistics, loyalty, orders, platform-ops, shared-cart, wallet

### business-rules _(business-transversal)_

> Detenir le referentiel des regles metier parametrables, versionner chaque changement, et servir a toute feature la valeur en vigueur avec un repli garanti sur la valeur codee en dur.

- utils: 1
- routes: 1
- tests: 2
- tables owned (lifecycle): 2 — `business_rules`, `business_rules_history`
- tables written: 2
- interfaces exposed: 5
- internal APIs: 4
- dependencies (consumes): 2 — auth, infrastructure
- consumers: 7 — catalog, dashboard, logistics, orders, payments, platform-ops, decision-signals

### catalog _(business-feature)_

> Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.

- ci: 3
- utils: 1
- services: 26
- schemas: 4
- migrations: 11
- config: 1
- docs: 4
- routes: 5
- boutique: 38
- dash: 4
- tests: 38
- tables owned (lifecycle): 13 — `products`, `boutique_categories`, `boutique_subcategories`, `catalog_field_overrides`, `catalog_enrichment_runs`, `catalog_media`, `product_skus`, `product_sku_media`, `product_variants`, `product_content_profile`, `product_content_sections`, `product_attributes`, `supplier_catalog_imports`
- tables written: 17
- interfaces exposed: 31
- internal APIs: 1
- dependencies (consumes): 6 — business-rules, economic-engine, logistics, shared-cart, auth, auth-identity
- consumers: 9 — economic-engine, infrastructure, inventory, logistics, orders, platform-ops, recommendations, sourcing, unsold-resolution

### customs _(business-feature)_

> Classer et declarer un colis douanierement ; la declaration est le pivot, jamais une optimisation.

- services: 3
- routes: 3
- migrations: 6
- dash: 2
- tests: 6
- tables owned (lifecycle): 3 — `customs_categories`, `customs_shipment_parcels`, `customs_shipments`
- tables written: 6
- interfaces exposed: 20
- internal APIs: 0
- dependencies (consumes): 4 — logistics, documents, auth, economic-engine
- consumers: 5 — dashboard, documents, infrastructure, logistics, orders

### dashboard _(business-transversal)_

> Exposer en lecture agrégée les données opérationnelles et financières pour le contrôle total de la plateforme via les dashboards admin (Control Tower, Pilotage, Santé, Clients, Hub, Relais).

- services: 10
- routes: 16
- migrations: 1
- dash: 83
- tests: 31
- tables owned (lifecycle): 2 — `order_incidents`, `partners`
- tables written: 22
- interfaces exposed: 65
- internal APIs: 0
- dependencies (consumes): 13 — orders, payments, logistics, inventory, economic-engine, wallet, auth, customs, documents, recommendations, purchasing, business-rules, decision-signals
- consumers: 4 — economic-engine, incident-management, infrastructure, orders

### decision-signals _(piloting-capability)_

> Detecter et qualifier des signaux operationnels (cash, colis, incidents) a partir des donnees produites par plusieurs features, pour l'aide a la decision admin.

- services: 2
- routes: 1
- tests: 3
- tables owned (lifecycle): 1 — `signals`
- tables written: 1
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 3 — auth, logistics, business-rules
- consumers: 1 — dashboard

### documents _(business-transversal)_

> Generer et conserver un PDF officiel privé (facture, remboursement, wallet, retrait, douane) après événement confirmé ; exposer au client authentifié uniquement ses factures et remboursements essentiels.

- services: 7
- routes: 3
- migrations: 6
- utils: 5
- tests: 14
- tables owned (lifecycle): 2 — `invoices`, `transaction_documents`
- tables written: 2
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 5 — orders, customs, wallet, refunds, auth-identity
- consumers: 7 — auth-identity, customs, dashboard, orders, payments, refunds, wallet

### economic-engine _(business-feature)_

> Calculer le prix, le cout et la marge d'un produit ou d'une commande selon une strategie tarifaire versionnee.

- utils: 2
- services: 25
- routes: 12
- migrations: 18
- dash: 6
- tests: 46
- tables owned (lifecycle): 18 — `price_history`, `order_item_real_cost_allocations`, `exchange_rates`, `charges`, `competitor_prices`, `cost_benchmarks`, `cost_component_events`, `cost_components`, `economic_snapshots`, `economic_variables`, `finance_config`, `pricing_category_dims`, `pricing_category_taxes`, `pricing_components`, `pricing_matrices_audit`, `pricing_strategies`, `pricing_strategy_history`, `risk_provisions`
- tables written: 20
- interfaces exposed: 73
- internal APIs: 1
- dependencies (consumes): 7 — logistics, catalog, auth, dashboard, orders, wallet, loyalty
- consumers: 8 — catalog, customs, dashboard, infrastructure, logistics, orders, platform-ops, sourcing

### incident-management _(business-transversal)_

> Détecter, qualifier et résoudre les écarts entre l'état attendu et l'état réel d'une opération, avec impact client traçable.

- services: 1
- tests: 1
- tables owned (lifecycle): 1 — `incidents`
- tables written: 1
- interfaces exposed: 0
- internal APIs: 5
- dependencies (consumes): 4 — logistics, payments, notifications, dashboard
- consumers: 0

### infrastructure _(technical-foundation)_

> Infrastructure transversale consommée par toutes les features : middleware non-auth (error-handler, rate-limit, request-id, upload, validate), utilitaires partagés (logger, phone, rates, reference, rules), barrel de validation Joi, et bootstrap applicatif (Express, routes, crons, env, sécurité, migrations startup).

- middleware: 5
- utils: 5
- validators: 1
- bootstrap: 9
- migrations: 6
- scripts: 87
- docs: 60
- ci: 23
- assets: 37
- db: 16
- routes: 1
- config: 12
- tests: 17
- tables owned (lifecycle): 1 — `schema_migrations`
- tables written: 5
- interfaces exposed: 4
- internal APIs: 11
- dependencies (consumes): 14 — auth, catalog, customs, dashboard, economic-engine, inventory, logistics, notifications, platform-ops, orders, payments, recommendations, shared-cart, wallet
- consumers: 1 — business-rules

### inventory _(business-feature)_

> Réceptionner, affecter et dispatcher les articles au hub.

- services: 1
- routes: 1
- dash: 1
- tests: 4
- tables owned (lifecycle): 1 — `inventory_items`
- tables written: 3
- interfaces exposed: 8
- internal APIs: 0
- dependencies (consumes): 2 — catalog, auth
- consumers: 2 — dashboard, infrastructure

### legacy-control-tower _(deprecated)_

> Ancien control tower — deprecated.

- js: 37
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 0
- consumers: 0

### logistics _(business-feature)_

> Faire transiter un colis du scan initial au retrait final, avec tracking client et transporteur.

- middleware: 1
- migrations: 2
- docs: 4
- utils: 3
- services: 13
- routes: 18
- boutique: 1
- dash: 2
- tests: 33
- tables owned (lifecycle): 11 — `parcels`, `relais`, `parcel_items`, `scan_events`, `scans`, `pickup_print_tokens`, `pickup_reveal_codes`, `carriers`, `parcel_events`, `pickup_verify_attempts`, `shipments`
- tables written: 15
- interfaces exposed: 70
- internal APIs: 1
- dependencies (consumes): 13 — business-rules, orders, customs, auth, auth-identity, catalog, economic-engine, notifications, payments, refunds, wallet, purchasing, loyalty
- consumers: 12 — catalog, customs, dashboard, economic-engine, incident-management, infrastructure, orders, payments, platform-ops, purchasing, recommendations, decision-signals

### loyalty _(business-feature)_

> Calculer et maintenir le statut de fidelite d'un client (palier + compteur gros panier) et ses recompenses.

- services: 1
- routes: 1
- tests: 3
- tables owned (lifecycle): 2 — `loyalty_tiers`, `loyalty_rewards`
- tables written: 3
- interfaces exposed: 7
- internal APIs: 0
- dependencies (consumes): 4 — auth, notifications, auth-identity, wallet
- consumers: 4 — economic-engine, logistics, orders, payments

### notifications _(business-transversal)_

> Projeter une information essentielle dans l application avec acquittement propriétaire ; conserver les canaux sortants historiques séparés et best-effort.

- tests: 18
- migrations: 6
- utils: 1
- services: 12
- routes: 4
- tables owned (lifecycle): 3 — `alerts`, `client_notifications`, `notification_log`
- tables written: 4
- interfaces exposed: 6
- internal APIs: 7
- dependencies (consumes): 5 — auth, orders, payments, shared-cart, refunds
- consumers: 10 — auth, auth-identity, incident-management, infrastructure, logistics, loyalty, orders, payments, purchasing, shared-cart

### orders _(business-feature)_

> Faire exister une commande, de la creation au statut final, avec un cout figure et une reference lisible.

- utils: 1
- services: 8
- routes: 12
- boutique: 3
- tests: 27
- tables owned (lifecycle): 9 — `order_items`, `orders`, `order_comments`, `order_item_cost_imputations`, `order_status_history`, `recipients`, `sms_log`, `customs_history`, `disputes`
- tables written: 13
- interfaces exposed: 27
- internal APIs: 3
- dependencies (consumes): 15 — business-rules, wallet, economic-engine, logistics, catalog, purchasing, loyalty, payments, auth, auth-identity, customs, dashboard, documents, notifications, refunds
- consumers: 13 — auth, dashboard, documents, economic-engine, infrastructure, logistics, notifications, payments, platform-ops, purchasing, refunds, shared-cart, unsold-resolution

### payments _(business-feature)_

> Encaisser un paiement (carte, PayPal, especes au retrait) et confirmer son etat de facon idempotente.

- services: 12
- routes: 4
- migrations: 1
- boutique: 2
- tests: 18
- tables owned (lifecycle): 4 — `cash_collections`, `cash_deposits`, `paypal_events_processed`, `stripe_events_processed`
- tables written: 8
- interfaces exposed: 18
- internal APIs: 2
- dependencies (consumes): 10 — platform-ops, auth, refunds, documents, notifications, business-rules, orders, logistics, loyalty, purchasing
- consumers: 7 — dashboard, incident-management, infrastructure, logistics, notifications, orders, wallet

### platform _(frontend-transversal)_

> Infrastructure transversale dashboards (auth-guard, service worker, composants colis partages, QR viewer).

- js: 4
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 0
- consumers: 0

### platform-ops _(technical-transversal)_

> Exposer la sante applicative, la configuration et les modules actifs — infrastructure d'exploitation, pas de service metier.

- compositionRoots: 3
- services: 7
- routes: 5
- boutique: 9
- tests: 19
- tables owned (lifecycle): 3 — `fabrics`, `garment_models`, `store_credits`
- tables written: 8
- interfaces exposed: 33
- internal APIs: 0
- dependencies (consumes): 8 — business-rules, auth, economic-engine, logistics, orders, auth-identity, catalog, purchasing
- consumers: 3 — auth, infrastructure, payments

### purchasing _(business-feature)_

> Transformer un besoin d'approvisionnement issu d'une commande en engagement fournisseur traçable (bon de commande), puis constater sa réception.

- services: 6
- routes: 1
- tests: 9
- tables owned (lifecycle): 3 — `product_suppliers`, `purchase_orders`, `suppliers`
- tables written: 5
- interfaces exposed: 10
- internal APIs: 2
- dependencies (consumes): 4 — orders, auth, notifications, logistics
- consumers: 5 — dashboard, logistics, orders, payments, platform-ops

### recommendations _(business-feature)_

> Classer et suggerer des produits boutique selon un moteur de ranking dedie.

- services: 1
- routes: 1
- tests: 2
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 1
- internal APIs: 0
- dependencies (consumes): 3 — catalog, auth, logistics
- consumers: 3 — dashboard, infrastructure, shared-cart

### refunds _(business-transversal)_

> Rembourser un client (wallet, cash, panier partage) de facon tracable et sans double remboursement.

- utils: 1
- services: 1
- tests: 4
- tables owned (lifecycle): 1 — `refunds`
- tables written: 1
- interfaces exposed: 0
- internal APIs: 1
- dependencies (consumes): 4 — orders, shared-cart, wallet, documents
- consumers: 5 — documents, logistics, notifications, orders, payments

### shared-cart _(business-feature)_

> Permettre à un créateur de publier une liste immuable par lien public ; chaque acheteur sélectionne une ou plusieurs lignes disponibles, passe par le récapitulatif puis le checkout canonique sans mélanger son panier personnel.

- services: 7
- routes: 4
- migrations: 19
- tests: 11
- boutique: 11
- dash: 1
- tables owned (lifecycle): 7 — `basket_items`, `baskets`, `cart_shares`, `shared_cart_events`, `shared_cart_items`, `shared_cart_saved_access`, `shared_carts`
- tables written: 7
- interfaces exposed: 16
- internal APIs: 0
- dependencies (consumes): 5 — orders, notifications, auth, auth-identity, recommendations
- consumers: 4 — catalog, infrastructure, notifications, refunds

### sourcing _(business-feature)_

> Identifier, qualifier et arbitrer des opportunités fournisseur ou produit (scan pricing, décision garder/watchlist/rejeter) avant leur entrée dans le catalogue.

- migrations: 4
- routes: 1
- tests: 1
- tables owned (lifecycle): 2 — `sourcing_candidate_events`, `sourcing_candidates`
- tables written: 7
- interfaces exposed: 11
- internal APIs: 0
- dependencies (consumes): 3 — catalog, economic-engine, auth
- consumers: 1 — admin-dashboard

### unsold-resolution _(business-feature)_

> Arbitrer et liquider la valeur immobilisée d'une commande invendue (WhatsApp, revendeur, don, destruction).

- routes: 1
- dash: 1
- tests: 1
- tables owned (lifecycle): 1 — `unsold_items`
- tables written: 1
- interfaces exposed: 7
- internal APIs: 0
- dependencies (consumes): 3 — orders, catalog, auth
- consumers: 0

### wallet _(business-feature)_

> Tenir un solde client et son historique de credit/debit, avec application exactement une fois.

- services: 2
- routes: 1
- migrations: 2
- boutique: 2
- tests: 3
- tables owned (lifecycle): 4 — `wallet_transactions`, `wallets`, `wallet_consumptions`, `wallet_credit_lots`
- tables written: 5
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 4 — auth, documents, auth-identity, payments
- consumers: 9 — auth-identity, dashboard, documents, economic-engine, infrastructure, logistics, loyalty, orders, refunds

### wallet-loyalty _(deprecated)_

> DÉPRÉCIÉ — scindé au Lot O1.2 (2026-07-12) en features/wallet.feature.js et features/loyalty.feature.js. Ne rend plus aucun service propre.

- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 0
- consumers: 0

## Table ownership

| Table | Lifecycle owner | Résolution | Writers | Readers |
|---|---|---|---|---|
| `alerts` | `notifications` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, logistics, notifications, orders, payments, purchasing | — |
| `basket_items` | `shared-cart` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, shared-cart | — |
| `baskets` | `shared-cart` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, shared-cart | — |
| `boutique_categories` | `catalog` | single-writer | catalog | — |
| `boutique_subcategories` | `catalog` | single-writer | catalog | — |
| `business_rules` | `business-rules` | single-writer | business-rules | dashboard, economic-engine, logistics |
| `business_rules_history` | `business-rules` | single-writer | business-rules | dashboard |
| `carriers` | `logistics` | single-writer | logistics | — |
| `cart_shares` | `shared-cart` | multi-writer-resolved-by-explicit-lifecycle-owner | orders, shared-cart | — |
| `cash_collections` | `payments` | single-writer | payments | — |
| `cash_deposits` | `payments` | single-writer | payments | — |
| `catalog_enrichment_runs` | `catalog` | single-writer | catalog | — |
| `catalog_exclusions` | _ambiguë_ | no-declared-writer | — | catalog |
| `catalog_field_overrides` | `catalog` | single-writer | catalog | — |
| `catalog_glossary` | _ambiguë_ | no-declared-writer | — | catalog |
| `catalog_media` | `catalog` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, sourcing | — |
| `charges` | `economic-engine` | single-writer | economic-engine | — |
| `client_notifications` | `notifications` | single-writer | notifications | — |
| `competitor_prices` | `economic-engine` | single-writer | economic-engine | — |
| `cost_benchmarks` | `economic-engine` | single-writer | economic-engine | — |
| `cost_component_events` | `economic-engine` | single-writer | economic-engine | — |
| `cost_components` | `economic-engine` | single-writer | economic-engine | — |
| `customs_categories` | `customs` | single-writer | customs | economic-engine |
| `customs_effective_rates` | _ambiguë_ | no-declared-writer | — | customs, dashboard |
| `customs_history` | `orders` | single-writer | orders | — |
| `customs_shipment_parcels` | `customs` | single-writer | customs | documents, economic-engine |
| `customs_shipments` | `customs` | single-writer | customs | dashboard, documents, economic-engine |
| `disputes` | `orders` | single-writer | orders | — |
| `economic_snapshots` | `economic-engine` | multi-writer-resolved-by-explicit-lifecycle-owner | economic-engine, infrastructure | — |
| `economic_variables` | `economic-engine` | single-writer | economic-engine | — |
| `exchange_rates` | `economic-engine` | single-writer | economic-engine | dashboard |
| `fabrics` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `finance_config` | `economic-engine` | single-writer | economic-engine | loyalty |
| `garment_models` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `incidents` | `incident-management` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, incident-management, logistics, notifications, payments | platform-ops |
| `inventory_items` | `inventory` | single-writer | inventory | — |
| `invoices` | `documents` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, documents | auth-identity, logistics, platform-ops |
| `loyalty_rewards` | `loyalty` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, loyalty | — |
| `loyalty_tiers` | `loyalty` | single-writer | loyalty | auth-identity |
| `notification_log` | `notifications` | multi-writer-resolved-by-explicit-lifecycle-owner | notifications, platform-ops | — |
| `order_comments` | `orders` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, orders | — |
| `order_incidents` | `dashboard` | single-writer | dashboard | — |
| `order_item_cost_imputations` | `orders` | single-writer | orders | dashboard, economic-engine |
| `order_item_real_cost_allocations` | `economic-engine` | multi-writer-resolved-by-explicit-lifecycle-owner | customs, economic-engine | dashboard |
| `order_items` | `orders` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, logistics, orders | auth-identity, catalog, customs, documents, economic-engine, inventory, payments, platform-ops, purchasing, recommendations, shared-cart |
| `order_status_history` | `orders` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, orders | — |
| `orders` | `orders` | multi-writer-resolved-by-explicit-lifecycle-owner | customs, dashboard, inventory, logistics, orders, payments, platform-ops, purchasing, wallet | auth-identity, catalog, documents, economic-engine, incident-management, loyalty, notifications, recommendations, refunds, shared-cart, unsold-resolution |
| `otp_codes` | `auth-identity` | single-writer | auth-identity | — |
| `parcel_events` | `logistics` | single-writer | logistics | — |
| `parcel_items` | `logistics` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, inventory, logistics, platform-ops | customs, documents, economic-engine, orders, payments |
| `parcels` | `logistics` | multi-writer-resolved-by-explicit-lifecycle-owner | customs, dashboard, logistics, payments, platform-ops | auth-identity, documents, economic-engine, incident-management, inventory, notifications, orders, recommendations |
| `partners` | `dashboard` | single-writer | dashboard | — |
| `paypal_events_processed` | `payments` | single-writer | payments | — |
| `pickup_print_tokens` | `logistics` | multi-writer-resolved-by-explicit-lifecycle-owner | infrastructure, logistics | — |
| `pickup_reveal_codes` | `logistics` | multi-writer-resolved-by-explicit-lifecycle-owner | infrastructure, logistics | — |
| `pickup_verify_attempts` | `logistics` | single-writer | logistics | — |
| `price_history` | `economic-engine` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, economic-engine | — |
| `pricing_benchmarks` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `pricing_category_dims` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_category_taxes` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_components` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_matrices_audit` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_strategies` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_strategy_history` | `economic-engine` | single-writer | economic-engine | — |
| `product_attributes` | `catalog` | single-writer | catalog | — |
| `product_content_profile` | `catalog` | single-writer | catalog | — |
| `product_content_sections` | `catalog` | single-writer | catalog | — |
| `product_sku_media` | `catalog` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, sourcing | — |
| `product_skus` | `catalog` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, sourcing | — |
| `product_suppliers` | `purchasing` | single-writer | purchasing | logistics |
| `product_variants` | `catalog` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, economic-engine, sourcing | logistics, orders |
| `products` | `catalog` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, dashboard, economic-engine, sourcing | auth-identity, customs, documents, inventory, logistics, orders, platform-ops, purchasing, recommendations, shared-cart, unsold-resolution |
| `purchase_orders` | `purchasing` | multi-writer-resolved-by-explicit-lifecycle-owner | orders, purchasing | logistics |
| `recipients` | `orders` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, orders | documents, economic-engine, logistics, notifications |
| `refunds` | `refunds` | single-writer | refunds | documents, economic-engine, orders |
| `relais` | `logistics` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, logistics | auth-identity, documents, economic-engine, notifications, orders, platform-ops, purchasing |
| `revoked_tokens` | `auth-identity` | multi-writer-resolved-by-explicit-lifecycle-owner | auth-identity, infrastructure | auth |
| `risk_provisions` | `economic-engine` | single-writer | economic-engine | — |
| `scan_events` | `logistics` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, logistics | incident-management, notifications, payments, platform-ops |
| `scans` | `logistics` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, logistics, orders, platform-ops | — |
| `schema_migrations` | `infrastructure` | single-writer | infrastructure | — |
| `shared_cart_events` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_items` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_saved_access` | `shared-cart` | single-writer | shared-cart | — |
| `shared_carts` | `shared-cart` | single-writer | shared-cart | — |
| `shipments` | `logistics` | single-writer | logistics | — |
| `signals` | `decision-signals` | single-writer | decision-signals | dashboard |
| `sms_log` | `orders` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, orders | — |
| `sourcing_candidate_events` | `sourcing` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, sourcing | — |
| `sourcing_candidates` | `sourcing` | multi-writer-resolved-by-explicit-lifecycle-owner | catalog, sourcing | — |
| `store_credits` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `stripe_events_processed` | `payments` | single-writer | payments | — |
| `supplier_catalog_imports` | `catalog` | single-writer | catalog | sourcing |
| `suppliers` | `purchasing` | single-writer | purchasing | — |
| `suppliers_stats` | _ambiguë_ | no-declared-writer | — | dashboard |
| `transaction_documents` | `documents` | single-writer | documents | — |
| `unsold_items` | `unsold-resolution` | single-writer | unsold-resolution | — |
| `user_pickup_authorizations` | `auth-identity` | single-writer | auth-identity | — |
| `users` | `auth-identity` | multi-writer-resolved-by-explicit-lifecycle-owner | auth, auth-identity, dashboard, loyalty | business-rules, documents, economic-engine, logistics, notifications, orders, payments, platform-ops, shared-cart, wallet |
| `v_loyalty_summary` | _ambiguë_ | no-declared-writer | — | loyalty |
| `v_unsold_pipeline` | _ambiguë_ | no-declared-writer | — | unsold-resolution |
| `wallet_consumptions` | `wallet` | single-writer | wallet | — |
| `wallet_credit_lots` | `wallet` | single-writer | wallet | — |
| `wallet_transactions` | `wallet` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, wallet | documents |
| `wallets` | `wallet` | multi-writer-resolved-by-explicit-lifecycle-owner | dashboard, wallet | documents, refunds |

## Interface ownership

### Routes (contract.exposes)

| Route | Feature | Résolution technique |
|---|---|---|
| `POST /api/auth/otp/request` | auth-identity | `routes/otp.js` (resolved-owned) |
| `POST /api/auth/otp/verify` | auth-identity | `routes/otp.js` (resolved-owned) |
| `POST /api/auth/otp/test-reset` | auth-identity | `routes/otp.js` (resolved-owned) |
| `POST /api/auth/admin-reset` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/auto-register` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/guest-checkout` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/auth/invoices` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `POST /api/auth/login` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/logout` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/magic-link` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/auth/magic-link/validate` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/auth/me` | auth-identity | `routes/auth.js` (resolved-owned) |
| `PUT /api/auth/me` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/auth/orders` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `POST /api/auth/orders-by-phone` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/register` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/client/invoices` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `POST /api/client/magic-link` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/client/magic-link/validate` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/client/orders` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/auth/me/pickup-authorization` | auth-identity | `routes/auth.js` (resolved-owned) |
| `PUT /api/auth/me/pickup-authorization` | auth-identity | `routes/auth.js` (resolved-owned) |
| `DELETE /api/auth/me/pickup-authorization` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/admin/rules` | business-rules | `routes/admin-rules.js` (resolved-owned) |
| `GET /api/admin/rules/{id}` | business-rules | `routes/admin-rules.js` (resolved-owned) |
| `PATCH /api/admin/rules/{id}` | business-rules | `routes/admin-rules.js` (resolved-owned) |
| `POST /api/admin/rules/{id}/reset` | business-rules | `routes/admin-rules.js` (resolved-owned) |
| `GET /api/admin/rules/audit` | business-rules | `routes/admin-rules.js` (resolved-owned) |
| `GET /api/products` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/{id}` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/{id}/detail` | catalog | `routes/catalog-product-detail.js` (resolved-owned) |
| `GET /api/admin/catalog/approval-queue` | catalog | `routes/admin/catalog-approval.js` (resolved-owned) |
| `POST /api/admin/catalog/approval-queue/{id}/approve` | catalog | `routes/admin/catalog-approval.js` (resolved-owned) |
| `POST /api/admin/catalog/approval-queue/{id}/reject` | catalog | `routes/admin/catalog-approval.js` (resolved-owned) |
| `POST /api/admin/catalog/approval-queue/{id}/override` | catalog | `routes/admin/catalog-approval.js` (resolved-owned) |
| `GET /api/admin/boutique-categories` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `POST /api/admin/boutique-categories` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `DELETE /api/admin/boutique-categories/{id}` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `GET /api/admin/boutique-categories/{id}` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `PUT /api/admin/boutique-categories/{id}` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `GET /api/admin/boutique-categories/{id}/subcategories` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `POST /api/admin/boutique-categories/{id}/subcategories` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `DELETE /api/admin/boutique-categories/{id}/subcategories/{id}` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `PUT /api/admin/boutique-categories/{id}/subcategories/{id}` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
| `GET /api/categories` | catalog | `routes/categories.js` (resolved-owned) |
| `POST /api/products` | catalog | `routes/products.js` (resolved-owned) |
| `DELETE /api/products/{id}` | catalog | `routes/products.js` (resolved-owned) |
| `PUT /api/products/{id}` | catalog | `routes/products.js` (resolved-owned) |
| `POST /api/products/{id}/image` | catalog | `routes/products.js` (resolved-owned) |
| `POST /api/products/{id}/images` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/{id}/variants` | catalog | `routes/products.js` (resolved-owned) |
| `PUT /api/products/{id}/variants` | catalog | `routes/products.js` (resolved-owned) |
| `DELETE /api/products/{id}/variants/{id}` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/{id}/skus` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/{id}/skus/readiness` | catalog | `routes/products.js` (resolved-owned) |
| `POST /api/products/{id}/skus` | catalog | `routes/products.js` (resolved-owned) |
| `DELETE /api/products/{id}/skus/{id}` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/categories` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/subcategories` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/admin/customs-shipments` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/customs` | customs | `routes/admin/customs.js` (resolved-owned) |
| `GET /api/admin/customs-categories` | customs | `routes/admin-customs-categories.js` (resolved-owned) |
| `POST /api/admin/customs-categories` | customs | `routes/admin-customs-categories.js` (resolved-owned) |
| `DELETE /api/admin/customs-categories/{id}` | customs | `routes/admin-customs-categories.js` (resolved-owned) |
| `GET /api/admin/customs-categories/{id}` | customs | `routes/admin-customs-categories.js` (resolved-owned) |
| `PUT /api/admin/customs-categories/{id}` | customs | `routes/admin-customs-categories.js` (resolved-owned) |
| `PUT /api/admin/customs-categories/{id}/toggle` | customs | `routes/admin-customs-categories.js` (resolved-owned) |
| `POST /api/admin/customs-shipments` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `DELETE /api/admin/customs-shipments/{id}` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/customs-shipments/{id}` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `PATCH /api/admin/customs-shipments/{id}` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `POST /api/admin/customs-shipments/{id}/activate` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/customs-shipments/{id}/analytics` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `POST /api/admin/customs-shipments/{id}/deactivate` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `POST /api/admin/customs-shipments/{id}/declare` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/customs-shipments/analytics` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/customs-shipments/analytics/trends` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/customs-shipments/rates/effective` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/customs-shipments/status/pending` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/dashboard` | dashboard | `routes/admin/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/clients` | dashboard | `routes/dashboard-clients.js` (resolved-owned) |
| `GET /api/dashboard/ops` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/dashboard/hub` | dashboard | `routes/dashboard-hub.js` (resolved-owned) |
| `GET /api/hub-dash/dashboard` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `GET /api/relay/dashboard` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `GET /api/admin/radar` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/loyalty/pending` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `GET /api/admin/partners` | dashboard | `routes/admin/partners.js` (resolved-owned) |
| `GET /api/admin/users` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `GET /api/admin/counts` | dashboard | `routes/admin/system.js` (resolved-owned) |
| `POST /api/admin/reset` | dashboard | `routes/admin/system.js` (resolved-owned) |
| `POST /api/admin/seed-test` | dashboard | `routes/admin/system.js` (resolved-owned) |
| `POST /api/admin/purchasing/repair-ordered-without-pos` | dashboard | `routes/admin/system.js` (resolved-owned) |
| `GET /api/admin/alerts` | dashboard | `routes/admin/dashboard.js` (resolved-owned) |
| `GET /api/admin/loyalty/history` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `POST /api/admin/loyalty/reward/{id}` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `POST /api/admin/loyalty/skip/{id}` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `GET /api/admin/loyalty/stats` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `GET /api/admin/margins` | dashboard | `routes/admin/dashboard.js` (resolved-owned) |
| `POST /api/admin/partners` | dashboard | `routes/admin/partners.js` (resolved-owned) |
| `DELETE /api/admin/partners/{id}` | dashboard | `routes/admin/partners.js` (resolved-owned) |
| `GET /api/admin/partners/{id}` | dashboard | `routes/admin/partners.js` (resolved-owned) |
| `PUT /api/admin/partners/{id}` | dashboard | `routes/admin/partners.js` (resolved-owned) |
| `GET /api/admin/partners/stats` | dashboard | `routes/admin/partners.js` (resolved-owned) |
| `GET /api/admin/radar/alerts` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `POST /api/admin/radar/cache/invalidate` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/radar/money` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/radar/orders-by-detail/{id}` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/radar/status-details` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `POST /api/admin/users` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `DELETE /api/admin/users/{id}` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `PUT /api/admin/users/{id}/password` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `PUT /api/admin/users/{id}/role` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `GET /api/dashboard/clients/detail` | dashboard | `routes/dashboard-clients.js` (resolved-owned) |
| `GET /api/dashboard/clients/list` | dashboard | `routes/dashboard-clients.js` (resolved-owned) |
| `GET /api/dashboard/forecast` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/dashboard/global` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/dashboard/history` | dashboard | `routes/dashboard-clients.js` (resolved-owned) |
| `GET /api/dashboard/hub-dubai` | dashboard | `routes/dashboard-hub.js` (resolved-owned) |
| `GET /api/dashboard/pilotage` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/dashboard/pipeline` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/dashboard/relais` | dashboard | `routes/dashboard-clients.js` (resolved-owned) |
| `GET /api/dashboard/retards` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/dashboard/stats` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/hub-dash/orders/{id}` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/orders/{id}/auto-prepare` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/orders/{id}/backorder` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/orders/{id}/comment` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/orders/{id}/create-parcel` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/orders/{id}/escalate` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/orders/{id}/incident` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/orders/{id}/start-prep` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/parcels/{id}/add-item` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/parcels/{id}/ready` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/parcels/{id}/remove-item` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `POST /api/hub-dash/parcels/{id}/ship` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `GET /api/hub-dash/queue` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `GET /api/hub-dash/validate/{id}` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `GET /api/relay/orders` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `GET /api/relay/orders/{id}` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `PATCH /api/relay/orders/{id}/client-absent` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `POST /api/relay/orders/{id}/comment` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `POST /api/relay/orders/{id}/escalate` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `POST /api/relay/orders/{id}/incident` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `GET /api/admin/documents` | documents | `routes/admin/documents.js` (resolved-owned) |
| `GET /api/admin/documents/summary` | documents | `routes/admin/documents.js` (resolved-owned) |
| `GET /api/admin/documents/{id}` | documents | `routes/admin/documents.js` (resolved-owned) |
| `GET /api/auth/me/documents` | documents | `routes/documents.js` (resolved-owned) |
| `GET /api/auth/me/documents/{id}/download` | documents | `routes/documents.js` (resolved-owned) |
| `GET /api/invoices` | documents | `routes/invoices.js` (resolved-owned) |
| `GET /api/invoices/{id}` | documents | `routes/invoices.js` (resolved-owned) |
| `GET /api/invoices/{id}/json` | documents | `routes/invoices.js` (resolved-owned) |
| `GET /api/invoices/{id}/download` | documents | `routes/invoices.js` (resolved-owned) |
| `POST /api/pricing/recommend` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `GET /api/admin/cost-components` | economic-engine | `routes/admin-cost-components.js` (resolved-owned) |
| `POST /api/admin/cost-components` | economic-engine | `routes/admin-cost-components.js` (resolved-owned) |
| `GET /api/admin/cost-components/_meta` | economic-engine | `routes/admin-cost-components.js` (resolved-owned) |
| `DELETE /api/admin/cost-components/{id}` | economic-engine | `routes/admin-cost-components.js` (resolved-owned) |
| `GET /api/admin/cost-components/{id}` | economic-engine | `routes/admin-cost-components.js` (resolved-owned) |
| `PUT /api/admin/cost-components/{id}` | economic-engine | `routes/admin-cost-components.js` (resolved-owned) |
| `POST /api/admin/cost-components/{id}/toggle` | economic-engine | `routes/admin-cost-components.js` (resolved-owned) |
| `GET /api/admin/economic/charges` | economic-engine | `routes/economic.js` (resolved-owned) |
| `POST /api/admin/economic/charges` | economic-engine | `routes/economic.js` (resolved-owned) |
| `DELETE /api/admin/economic/charges/{id}` | economic-engine | `routes/economic.js` (resolved-owned) |
| `PUT /api/admin/economic/charges/{id}` | economic-engine | `routes/economic.js` (resolved-owned) |
| `PUT /api/admin/economic/charges/{id}/toggle` | economic-engine | `routes/economic.js` (resolved-owned) |
| `GET /api/admin/economic/coherence` | economic-engine | `routes/economic.js` (resolved-owned) |
| `GET /api/admin/economic/executive` | economic-engine | `routes/economic.js` (resolved-owned) |
| `GET /api/admin/economic/history` | economic-engine | `routes/economic.js` (resolved-owned) |
| `POST /api/admin/economic/redistribute` | economic-engine | `routes/economic.js` (resolved-owned) |
| `GET /api/admin/economic/variables` | economic-engine | `routes/economic.js` (resolved-owned) |
| `PUT /api/admin/economic/variables/{id}` | economic-engine | `routes/economic.js` (resolved-owned) |
| `GET /api/admin/finance-config` | economic-engine | `routes/admin-finance-config.js` (resolved-owned) |
| `PUT /api/admin/finance-config` | economic-engine | `routes/admin-finance-config.js` (resolved-owned) |
| `GET /api/admin/finance-config/schema` | economic-engine | `routes/admin-finance-config.js` (resolved-owned) |
| `GET /api/admin/finance/export` | economic-engine | `routes/finance.js` (resolved-owned) |
| `GET /api/admin/finance/report` | economic-engine | `routes/finance.js` (resolved-owned) |
| `GET /api/admin/finance/stripe-proofs` | economic-engine | `routes/finance.js` (resolved-owned) |
| `GET /api/admin/finance/summary` | economic-engine | `routes/finance.js` (resolved-owned) |
| `GET /api/admin/pricing-components` | economic-engine | `routes/admin-pricing-components.js` (resolved-owned) |
| `POST /api/admin/pricing-components` | economic-engine | `routes/admin-pricing-components.js` (resolved-owned) |
| `DELETE /api/admin/pricing-components/{id}` | economic-engine | `routes/admin-pricing-components.js` (resolved-owned) |
| `GET /api/admin/pricing-components/{id}` | economic-engine | `routes/admin-pricing-components.js` (resolved-owned) |
| `PUT /api/admin/pricing-components/{id}` | economic-engine | `routes/admin-pricing-components.js` (resolved-owned) |
| `PUT /api/admin/pricing-components/{id}/toggle` | economic-engine | `routes/admin-pricing-components.js` (resolved-owned) |
| `GET /api/admin/pricing-matrices/dims` | economic-engine | `routes/admin-pricing-matrices.js` (resolved-owned) |
| `PUT /api/admin/pricing-matrices/dims/{id}` | economic-engine | `routes/admin-pricing-matrices.js` (resolved-owned) |
| `GET /api/admin/pricing-matrices/taxes` | economic-engine | `routes/admin-pricing-matrices.js` (resolved-owned) |
| `PUT /api/admin/pricing-matrices/taxes/{id}` | economic-engine | `routes/admin-pricing-matrices.js` (resolved-owned) |
| `GET /api/admin/sourcing/analysis` | economic-engine | `routes/sourcing.js` (resolved-owned) |
| `GET /api/admin/sourcing/analysis/{id}` | economic-engine | `routes/sourcing.js` (resolved-owned) |
| `POST /api/admin/sourcing/bulk-rail` | economic-engine | `routes/sourcing.js` (resolved-owned) |
| `GET /api/admin/sourcing/config` | economic-engine | `routes/sourcing.js` (resolved-owned) |
| `PUT /api/admin/sourcing/products/{id}` | economic-engine | `routes/sourcing.js` (resolved-owned) |
| `GET /api/admin/sourcing/products/{id}/variants` | economic-engine | `routes/sourcing.js` (resolved-owned) |
| `PUT /api/admin/sourcing/products/{id}/variants` | economic-engine | `routes/sourcing.js` (resolved-owned) |
| `GET /api/admin/sourcing/synthesis` | economic-engine | `routes/sourcing.js` (resolved-owned) |
| `GET /api/admin/risk-provisions` | economic-engine | `routes/admin-risk-provisions.js` (resolved-owned) |
| `POST /api/admin/risk-provisions` | economic-engine | `routes/admin-risk-provisions.js` (resolved-owned) |
| `DELETE /api/admin/risk-provisions/{id}` | economic-engine | `routes/admin-risk-provisions.js` (resolved-owned) |
| `GET /api/admin/risk-provisions/{id}` | economic-engine | `routes/admin-risk-provisions.js` (resolved-owned) |
| `PUT /api/admin/risk-provisions/{id}` | economic-engine | `routes/admin-risk-provisions.js` (resolved-owned) |
| `PUT /api/admin/risk-provisions/{id}/toggle` | economic-engine | `routes/admin-risk-provisions.js` (resolved-owned) |
| `GET /api/dashboard/annulations-parcels` | economic-engine | `routes/dashboard-finance.js` (resolved-owned) |
| `GET /api/dashboard/finance` | economic-engine | `routes/dashboard-finance.js` (resolved-owned) |
| `GET /api/dashboard/payments` | economic-engine | `routes/dashboard-finance.js` (resolved-owned) |
| `GET /api/dashboard/sales` | economic-engine | `routes/dashboard-finance.js` (resolved-owned) |
| `PUT /api/pricing/apply-all` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `PUT /api/pricing/apply-price/{id}` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `GET /api/pricing/benchmarks` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `PUT /api/pricing/benchmarks` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `GET /api/pricing/benchmarks-gap` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `DELETE /api/pricing/benchmarks/{id}/{id}` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `POST /api/pricing/calculate` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `POST /api/pricing/couture` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `GET /api/pricing/dashboard` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `POST /api/pricing/flow` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `GET /api/pricing/rates` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `PUT /api/pricing/rates` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `POST /api/pricing/recommend-batch` | economic-engine | `routes/pricing.js` (resolved-owned) |
| `GET /api/pricing/strategy` | economic-engine | `routes/pricing-strategy.js` (resolved-owned) |
| `POST /api/pricing/strategy/apply` | economic-engine | `routes/pricing-strategy.js` (resolved-owned) |
| `GET /api/pricing/strategy/competitors` | economic-engine | `routes/pricing-strategy.js` (resolved-owned) |
| `POST /api/pricing/strategy/competitors` | economic-engine | `routes/pricing-strategy.js` (resolved-owned) |
| `DELETE /api/pricing/strategy/competitors/{id}` | economic-engine | `routes/pricing-strategy.js` (resolved-owned) |
| `GET /api/pricing/strategy/history` | economic-engine | `routes/pricing-strategy.js` (resolved-owned) |
| `GET /api/health` | infrastructure | `server.js` (resolved-owned) |
| `GET /api/public/config` | infrastructure | `server.js` (resolved-owned) |
| `GET /webhook/authkey-whatsapp` | infrastructure | — (not-in-openapi-contract) |
| `GET /*.html` | infrastructure | — (not-in-openapi-contract) |
| `GET /api/hub/inventory/buffer` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `GET /api/hub/inventory/open-parcels` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `GET /api/hub/inventory/order/{id}/dispatch` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `GET /api/hub/inventory/proposals` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `POST /api/hub/inventory/propose-all` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `POST /api/hub/inventory/receive` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `POST /api/hub/inventory/scan-assign` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `GET /api/hub/inventory/stats` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `POST /api/v2/parcels/{id}/scan` | logistics | `routes/parcel-api-v2/scans.js` (resolved-owned) |
| `GET /api/tracking/{id}` | logistics | `routes/tracking.js` (resolved-owned) |
| `GET /api/carriers` | logistics | `routes/carriers.js` (resolved-owned) |
| `POST /api/carriers` | logistics | `routes/carriers.js` (resolved-owned) |
| `DELETE /api/carriers/{id}` | logistics | `routes/carriers.js` (resolved-owned) |
| `PATCH /api/carriers/{id}` | logistics | `routes/carriers.js` (resolved-owned) |
| `PATCH /api/carriers/customs/{id}` | logistics | `routes/carriers.js` (resolved-owned) |
| `GET /api/client/tracking` | logistics | `routes/client-tracking.js` (resolved-owned) |
| `GET /api/hub/auto-distribute` | logistics | `routes/auto-distribute-api.js` (resolved-owned) |
| `POST /api/hub/auto-distribute` | logistics | `routes/auto-distribute-api.js` (resolved-owned) |
| `POST /api/hub/auto-distribute/cleanup` | logistics | `routes/auto-distribute-api.js` (resolved-owned) |
| `POST /api/hub/batch-scan` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/pack` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/hub/pending` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/photo` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/scan` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/seal` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/hub/search` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/hub/stats/week` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/hub/today` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/volume` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/logistics/labels/{id}` | logistics | `routes/logistics.js` (resolved-owned) |
| `GET /api/logistics/manifest/{id}` | logistics | `routes/logistics.js` (resolved-owned) |
| `GET /api/logistics/shipments` | logistics | `routes/logistics.js` (resolved-owned) |
| `POST /api/logistics/shipments` | logistics | `routes/logistics.js` (resolved-owned) |
| `PATCH /api/logistics/shipments/{id}` | logistics | `routes/logistics.js` (resolved-owned) |
| `POST /api/parcels/{id}/items` | logistics | `routes/parcels.js` (resolved-owned) |
| `DELETE /api/parcels/{id}/items/{id}` | logistics | `routes/parcels.js` (resolved-owned) |
| `PATCH /api/parcels/{id}/status` | logistics | `routes/parcels.js` (resolved-owned) |
| `POST /api/parcels/{id}/verify-seal` | logistics | `routes/parcels.js` (resolved-owned) |
| `POST /api/parcels/{id}/weight` | logistics | `routes/parcels.js` (resolved-owned) |
| `GET /api/parcels/{id}` | logistics | `routes/parcels.js` (resolved-owned) |
| `GET /api/parcels/{id}/events` | logistics | `routes/parcels.js` (resolved-owned) |
| `POST /api/parcels/bootstrap/{id}` | logistics | `routes/parcels.js` (resolved-owned) |
| `POST /api/parcels/optimize` | logistics | `routes/parcels.js` (resolved-owned) |
| `POST /api/pickup/collect/{id}` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `POST /api/pickup/pay-cash/{id}` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `GET /api/pickup/receipt/{id}` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `POST /api/pickup/regenerate/{id}` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `GET /api/pickup/reveal-once/{id}` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `GET /api/pickup/status/{id}` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `POST /api/pickup/verify/{id}` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `GET /api/pickup/exceptional-pickup/{id}` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `POST /api/pickup/exceptional-pickup/{id}/collect` | logistics | `routes/pickup-secret.js` (resolved-owned) |
| `GET /api/relais` | logistics | `routes/relais.js` (resolved-owned) |
| `GET /api/relais/{id}` | logistics | `routes/relais.js` (resolved-owned) |
| `GET /api/relais/public` | logistics | `routes/relais.js` (resolved-owned) |
| `POST /api/scans` | logistics | `routes/scans.js` (resolved-owned) |
| `GET /api/scans/{id}` | logistics | `routes/scans.js` (resolved-owned) |
| `POST /api/scans/collect` | logistics | `routes/scans.js` (resolved-owned) |
| `GET /api/scans/hub/pending` | logistics | `routes/scans.js` (resolved-owned) |
| `POST /api/scans/hub/receive` | logistics | `routes/scans.js` (resolved-owned) |
| `POST /api/scans/verify-qr` | logistics | `routes/scans.js` (resolved-owned) |
| `POST /api/tracking/{id}/verify-pickup` | logistics | `routes/tracking.js` (resolved-owned) |
| `GET /api/transit` | logistics | `routes/transit-dashboard.js` (resolved-owned) |
| `GET /api/transit-dashboard` | logistics | `routes/transit-dashboard.js` (resolved-owned) |
| `POST /api/transit-dashboard/{id}/transit` | logistics | `routes/transit-dashboard.js` (resolved-owned) |
| `POST /api/transit/{id}/transit` | logistics | `routes/transit-dashboard.js` (resolved-owned) |
| `GET /api/transitaire/history` | logistics | `routes/transitaire-api.js` (resolved-owned) |
| `GET /api/transitaire/parcels` | logistics | `routes/transitaire-api.js` (resolved-owned) |
| `POST /api/transitaire/ship` | logistics | `routes/transitaire-api.js` (resolved-owned) |
| `GET /api/transitaire/stats` | logistics | `routes/transitaire-api.js` (resolved-owned) |
| `GET /api/v2/parcels` | logistics | `routes/parcel-api-v2/read.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}` | logistics | `routes/parcel-api-v2/read.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}/label` | logistics | `routes/parcel-label.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}/timeline` | logistics | `routes/parcel-api-v2/read.js` (resolved-owned) |
| `GET /api/v2/parcels/alerts` | logistics | `routes/parcel-api-v2/read.js` (resolved-owned) |
| `GET /api/v2/parcels/critical` | logistics | `routes/parcel-api-v2/read.js` (resolved-owned) |
| `GET /api/v2/parcels/kpis` | logistics | `routes/parcel-api-v2/read.js` (resolved-owned) |
| `GET /api/v2/parcels/reconciliation` | logistics | `routes/parcel-api-v2/read.js` (resolved-owned) |
| `GET /api/loyalty/tiers` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `GET /api/loyalty/me` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `GET /api/loyalty/users` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `GET /api/loyalty/stats` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `PUT /api/loyalty/tiers/{id}` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `POST /api/loyalty/recalculate/{id}` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `POST /api/loyalty/recalculate-all` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `GET /api/v2/notifications` | notifications | `routes/notification-api.js` (resolved-owned) |
| `GET /api/v2/notifications/stats` | notifications | `routes/notification-api.js` (resolved-owned) |
| `GET /api/auth/me/notifications` | notifications | `routes/client-notifications.js` (resolved-owned) |
| `POST /api/auth/me/notifications/{id}/ack` | notifications | `routes/client-notifications.js` (resolved-owned) |
| `GET /webhook/meta-whatsapp` | notifications | `routes/meta-whatsapp.js` (resolved-owned) |
| `POST /webhook/meta-whatsapp` | notifications | `routes/meta-whatsapp.js` (resolved-owned) |
| `GET /api/orders/{id}` | orders | `routes/orders/detail.js` (resolved-owned) |
| `POST /api/orders/{id}/cancel` | orders | `routes/orders/cancel.js` (resolved-owned) |
| `GET /api/admin/orders` | orders | `routes/admin/orders.js` (resolved-owned) |
| `DELETE /api/admin/orders/{id}` | orders | `routes/admin/orders.js` (resolved-owned) |
| `POST /api/admin/orders/{id}/refund` | orders | `routes/admin/orders.js` (resolved-owned) |
| `POST /api/hub/orders/mark-ordered` | orders | `routes/hub-mark-ordered.js` (resolved-owned) |
| `POST /api/orders/{id}/cancel-backorder` | orders | `routes/orders/parcels.js` (resolved-owned) |
| `PATCH /api/orders/{id}/cost` | orders | `routes/orders/status.js` (resolved-owned) |
| `GET /api/orders/{id}/history` | orders | `routes/orders/detail.js` (resolved-owned) |
| `POST /api/orders/{id}/mark-availability` | orders | `routes/orders/parcels.js` (resolved-owned) |
| `GET /api/orders/{id}/parcels` | orders | `routes/orders/parcels.js` (resolved-owned) |
| `POST /api/orders/{id}/partial-ship` | orders | `routes/orders/parcels.js` (resolved-owned) |
| `POST /api/orders/{id}/qr-token` | orders | `routes/orders/qr.js` (resolved-owned) |
| `PATCH /api/orders/{id}/status` | orders | `routes/orders/status.js` (resolved-owned) |
| `GET /api/orders/{id}/sub-orders` | orders | `routes/orders/parcels.js` (resolved-owned) |
| `GET /api/orders/credits` | orders | `routes/orders/list.js` (resolved-owned) |
| `PATCH /api/orders/parcels/{id}/status` | orders | `routes/orders/parcels.js` (resolved-owned) |
| `GET /api/orders/problems` | orders | `routes/orders/list.js` (resolved-owned) |
| `GET /api/orders/relais` | orders | `routes/orders/list.js` (resolved-owned) |
| `GET /api/orders/retrait/{id}` | orders | `routes/orders/qr.js` (resolved-owned) |
| `PATCH /api/orders/sub-orders/{id}/status` | orders | `routes/orders/parcels.js` (resolved-owned) |
| `GET /api/v2/orders` | orders | `routes/order-api-v2.js` (resolved-owned) |
| `GET /api/v2/orders/{id}` | orders | `routes/order-api-v2.js` (resolved-owned) |
| `POST /api/v2/orders/{id}/confirm-cash` | orders | `routes/order-api-v2.js` (resolved-owned) |
| `POST /api/v2/orders/{id}/create-parcel` | orders | `routes/order-api-v2.js` (resolved-owned) |
| `GET /api/v2/orders/pending-cash` | orders | `routes/order-api-v2.js` (resolved-owned) |
| `GET /api/v2/orders/ready-for-parcel` | orders | `routes/order-api-v2.js` (resolved-owned) |
| `POST /api/payments/stripe/intent` | payments | `routes/payments.js` (resolved-owned) |
| `POST /api/payments/paypal/webhook` | payments | `routes/payments-paypal.js` (resolved-owned) |
| `POST /api/payments/cash/confirm` | payments | `routes/payments.js` (resolved-owned) |
| `POST /api/cash/collect/{id}` | payments | `routes/cash.js` (resolved-owned) |
| `GET /api/cash/collections` | payments | `routes/cash.js` (resolved-owned) |
| `POST /api/cash/deposit` | payments | `routes/cash.js` (resolved-owned) |
| `GET /api/cash/deposits` | payments | `routes/cash.js` (resolved-owned) |
| `POST /api/cash/deposits/{id}/dispute` | payments | `routes/cash.js` (resolved-owned) |
| `POST /api/cash/deposits/{id}/verify` | payments | `routes/cash.js` (resolved-owned) |
| `GET /api/cash/reconciliation` | payments | `routes/cash.js` (resolved-owned) |
| `GET /api/cash/reconciliation/agents` | payments | `routes/cash.js` (resolved-owned) |
| `GET /api/cash/uncollected` | payments | `routes/cash.js` (resolved-owned) |
| `GET /api/payments/config` | payments | `routes/payments.js` (resolved-owned) |
| `POST /api/payments/paypal/capture/{id}` | payments | `routes/payments-paypal.js` (resolved-owned) |
| `POST /api/payments/paypal/create-order` | payments | `routes/payments-paypal.js` (resolved-owned) |
| `POST /api/payments/paypal/refund/{id}` | payments | `routes/payments-paypal.js` (resolved-owned) |
| `GET /api/payments/rates` | payments | `routes/payments.js` (resolved-owned) |
| `POST /api/payments/stripe/webhook` | payments | `routes/payments.js` (resolved-owned) |
| `GET /health` | platform-ops | `routes/health.js` (resolved-owned) |
| `GET /api/modules` | platform-ops | `routes/modules.js` (resolved-owned) |
| `POST /api/admin/simulator/cleanup` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `GET /api/admin/simulator/journal` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `POST /api/admin/simulator/start` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `GET /api/admin/simulator/status` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `POST /api/admin/simulator/stop` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `GET /api/modules/{id}` | platform-ops | `routes/modules.js` (resolved-owned) |
| `GET /api/modules/fabrics` | platform-ops | `routes/modules.js` (resolved-owned) |
| `POST /api/modules/fabrics` | platform-ops | `routes/modules.js` (resolved-owned) |
| `GET /api/modules/models` | platform-ops | `routes/modules.js` (resolved-owned) |
| `POST /api/modules/models` | platform-ops | `routes/modules.js` (resolved-owned) |
| `POST /api/modules/price` | platform-ops | `routes/modules.js` (resolved-owned) |
| `POST /api/simulator/cleanup` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `GET /api/simulator/journal` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `POST /api/simulator/start` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `GET /api/simulator/status` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `POST /api/simulator/stop` | platform-ops | `routes/simulator.js` (resolved-owned) |
| `GET /api/v2/alerts` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `POST /api/v2/alerts/{id}/acknowledge` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/global` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/incidents` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/invoices` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}/orders` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}/scans` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}/detail` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/reconciliation` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/reconciliation/summary` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/scan-events` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /health/detailed` | platform-ops | `routes/health.js` (resolved-owned) |
| `GET /health/metrics` | platform-ops | `routes/health.js` (resolved-owned) |
| `GET /health/ready` | platform-ops | `routes/health.js` (resolved-owned) |
| `GET /health/version` | platform-ops | `routes/health.js` (resolved-owned) |
| `GET /api/purchasing` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `GET /api/purchasing/suppliers` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `POST /api/purchasing/suppliers` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `POST /api/purchasing/suppliers/{id}/map` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `DELETE /api/purchasing/suppliers/{id}` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `GET /api/purchasing/order/{id}/completeness` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `GET /api/purchasing/{id}` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `POST /api/purchasing/{id}/confirm` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `POST /api/purchasing/{id}/receive` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `DELETE /api/purchasing/po/{id}` | purchasing | `routes/purchasing.js` (resolved-owned) |
| `GET /api/boutique/suggestions` | recommendations | `routes/boutique-suggestions.js` (resolved-owned) |
| `GET /api/shared-carts/public/{id}` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `POST /api/shared-carts/from-cart-items` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `POST /api/shared-carts/from-basket` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `GET /api/shared-carts/mine` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `GET /api/shared-carts/library` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `POST /api/shared-carts/save` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `DELETE /api/shared-carts/saved/{id}` | shared-cart | `routes/shared-cart-saved.js` (resolved-owned) |
| `POST /api/shares` | shared-cart | `routes/shares.js` (resolved-owned) |
| `GET /api/shares/{id}` | shared-cart | `routes/shares.js` (resolved-owned) |
| `GET /api/shared-carts/{id}` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/close` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/cancel` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `GET /api/admin/shared-carts` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `GET /api/admin/shared-carts/{id}` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `POST /api/admin/shared-carts/{id}/expire` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `POST /api/admin/shared-carts/{id}/note` | shared-cart | `routes/shared-cart.js` (resolved-owned) |
| `GET /api/admin/sourcing/connectors` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `POST /api/admin/sourcing/catalogs/import` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `GET /api/admin/sourcing/catalogs` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `GET /api/admin/sourcing/candidates` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `GET /api/admin/sourcing/candidates/{id}` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `PUT /api/admin/sourcing/candidates/{id}` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `POST /api/admin/sourcing/candidates/{id}/scan` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `POST /api/admin/sourcing/candidates/scan-batch` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `POST /api/admin/sourcing/candidates/{id}/import-product` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `POST /api/admin/sourcing/candidates/{id}/reject` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `POST /api/admin/sourcing/candidates/{id}/watchlist` | sourcing | `routes/sourcing-scanner.js` (resolved-owned) |
| `GET /api/unsold` | unsold-resolution | `routes/unsold.js` (resolved-owned) |
| `GET /api/unsold/{id}` | unsold-resolution | `routes/unsold.js` (resolved-owned) |
| `PATCH /api/unsold/{id}` | unsold-resolution | `routes/unsold.js` (resolved-owned) |
| `POST /api/unsold/{id}/resolve` | unsold-resolution | `routes/unsold.js` (resolved-owned) |
| `GET /api/unsold/{id}/whatsapp` | unsold-resolution | `routes/unsold.js` (resolved-owned) |
| `POST /api/unsold/scan` | unsold-resolution | `routes/unsold.js` (resolved-owned) |
| `GET /api/unsold/stats/summary` | unsold-resolution | `routes/unsold.js` (resolved-owned) |
| `GET /api/wallet` | wallet | `routes/wallet.js` (resolved-owned) |
| `GET /api/wallet/transactions` | wallet | `routes/wallet.js` (resolved-owned) |
| `POST /api/wallet/apply` | wallet | `routes/wallet.js` (resolved-owned) |
| `POST /api/wallet/remove` | wallet | `routes/wallet.js` (resolved-owned) |
| `GET /api/wallet/admin` | wallet | `routes/wallet.js` (resolved-owned) |
| `GET /api/wallet/admin/{id}` | wallet | `routes/wallet.js` (resolved-owned) |
| `POST /api/wallet/admin/credit` | wallet | `routes/wallet.js` (resolved-owned) |
| `POST /api/wallet/admin/order-credit/{id}` | wallet | `routes/wallet.js` (resolved-owned) |
| `POST /api/wallet/admin/reverse-lot` | wallet | `routes/wallet.js` (resolved-owned) |

### API internes (contract.internalApi)

| Fonction | Fichier | Feature | Statut |
|---|---|---|---|
| `requireAuth / requireVerifiedIdentity / softAuth` | `middleware/auth.js` | auth | resolved |
| `requireAuth / requireVerifiedIdentity / softAuth` | `middleware/require-verified-identity.js` | auth | resolved |
| `requireAuth / requireVerifiedIdentity / softAuth` | `middleware/soft-auth.js` | auth | resolved |
| `makeIntlPhoneInput` | `public/boutique/js/b-phone.js` | auth-identity | resolved |
| `getActiveAuthorizationForUpdate` | `services/pickup-authorization-service.js` | auth-identity | resolved |
| `hasActiveAuthorization` | `services/pickup-authorization-service.js` | auth-identity | resolved |
| `getRuleNumber` | `utils/rules.js` | business-rules | resolved |
| `getRule` | `utils/rules.js` | business-rules | resolved |
| `getAllRules` | `utils/rules.js` | business-rules | resolved |
| `setRule` | `utils/rules.js` | business-rules | resolved |
| `createDraftFromSourcingCandidate` | `services/product-admin-service.js` | catalog | resolved |
| `recommend` | `services/pricing-engine.js` | economic-engine | resolved |
| `listIncidents` | `services/incident-service.js` | incident-management | resolved |
| `getIncident` | `services/incident-service.js` | incident-management | resolved |
| `resolveIncident` | `services/incident-service.js` | incident-management | resolved |
| `escalateIncident` | `services/incident-service.js` | incident-management | resolved |
| `getIncidentDashboard` | `services/incident-service.js` | incident-management | resolved |
| `—` | `middleware/error-handler.js` | infrastructure | resolved |
| `—` | `middleware/rate-limit.js` | infrastructure | resolved |
| `—` | `middleware/request-id.js` | infrastructure | resolved |
| `—` | `middleware/upload.js` | infrastructure | resolved |
| `—` | `middleware/validate.js` | infrastructure | resolved |
| `—` | `utils/logger.js` | infrastructure | resolved |
| `—` | `utils/phone.js` | infrastructure | resolved |
| `—` | `utils/rates.js` | infrastructure | resolved |
| `—` | `utils/reference.js` | infrastructure | resolved |
| `—` | `validators/index.js` | infrastructure | resolved |
| `—` | `bootstrap/*` | infrastructure | resolved |
| `transitionParcelStatus` | `services/parcel-operations.js` | logistics | resolved |
| `setNotificationOutcomeListener` | `services/notifications/internals.js` | notifications | resolved |
| `notifyOrder*` | `services/notifications/order.js` | notifications | resolved |
| `notifyParcel*` | `services/notifications/parcel.js` | notifications | resolved |
| `sendOtpMessage / sendMagicLink` | `services/notifications/otp-auth.js` | notifications | resolved |
| `notifyLoyaltyEarned` | `services/notifications/loyalty.js` | notifications | resolved |
| `notifyText` | `services/notifications/misc.js` | notifications | resolved |
| `emitOrderMilestone / emitExceptional / resolveOrderMilestones` | `services/client-notification-service.js` | notifications | resolved |
| `transitionOrderStatus` | `services/order-status-machine.js` | orders | resolved |
| `checkoutCart` | `public/boutique/js/b-checkout.js` | orders | resolved |
| `makeInput` | `public/boutique/js/b-checkout.js` | orders | resolved |
| `markPaid` | `services/payment-service.js` | payments | resolved |
| `markRefunded` | `services/payment-service.js` | payments | resolved |
| `triggerPurchasing` | `services/purchasing-trigger-service.js` | purchasing | resolved |
| `repairOrderedWithoutPurchaseOrders` | `services/repair-ordered-without-purchase-orders.js` | purchasing | resolved |
| `processRefund(orderOrCartId, reason)` | `null` | refunds | documented-signature-no-file |

## Cross-feature dependencies

| Feature | consumes | Résolu ? |
|---|---|---|
| auth | notifications (`notifications`) | ✔ |
| auth | platform-ops (`platform-ops`) | ✔ |
| auth | orders (`orders`) | ✔ |
| auth-identity | auth (`auth (middleware/auth.js — garde authenticate/requireAdmin utilisée par routes/client-auth.js, routes/auth.js)`) | ✔ |
| auth-identity | notifications (`notifications (services/notification-service.js — envoi OTP/alertes depuis routes/client-auth.js, routes/otp.js)`) | ✔ |
| auth-identity | wallet (`wallet (projection boutique account : b-komerce.js lit uniquement le solde canonique via GET /api/wallet)`) | ✔ |
| auth-identity | documents (`documents (projection boutique account : b-komerce.js liste et télécharge les factures et remboursements privés)`) | ✔ |
| business-rules | auth (`auth (garde de route admin)`) | ✔ |
| business-rules | infrastructure (`infrastructure (journalisation, acces base)`) | ✔ |
| catalog | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: services/suppliers/catalog-import-orchestrator.js -> utils/rules.js ; services/catalog-product-detail.js -> utils/rules.js ; services/catalog-enrichment.js -> utils/rules.js)`) | ✔ |
| catalog | economic-engine (`economic-engine (prix produit et valorisation commerciale transport)`) | ✔ |
| catalog | logistics (`logistics (rails et eligibilite transport ; le catalog ne decide jamais le rail)`) | ✔ |
| catalog | shared-cart (`shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)`) | ✔ |
| catalog | auth (`auth`) | ✔ |
| catalog | auth-identity (`auth-identity`) | ✔ |
| customs | logistics (`logistics (colis a classer)`) | ✔ |
| customs | documents (`documents (facture douane generee)`) | ✔ |
| customs | auth (`auth`) | ✔ |
| customs | economic-engine (`economic-engine`) | ✔ |
| dashboard | orders (`orders (lecture commandes)`) | ✔ |
| dashboard | payments (`payments (lecture paiements)`) | ✔ |
| dashboard | logistics (`logistics (lecture colis)`) | ✔ |
| dashboard | inventory (`inventory (lecture stock)`) | ✔ |
| dashboard | economic-engine (`economic-engine (métriques financières)`) | ✔ |
| dashboard | wallet (`wallet (soldes et crédits)`) | ✔ |
| dashboard | auth (`auth`) | ✔ |
| dashboard | customs (`customs`) | ✔ |
| dashboard | documents (`documents`) | ✔ |
| dashboard | recommendations (`recommendations`) | ✔ |
| dashboard | purchasing (`purchasing (repare les commandes sans purchase order — services/repair-ordered-without-purchase-orders.js, O7.3 provider purchasing)`) | ✔ |
| dashboard | business-rules (`business-rules (utils/rules.js — routes/dashboard-shared.js lit une règle en vigueur)`) | ✔ |
| dashboard | decision-signals (`decision-signals (services/radar-queries.js — routes/admin-radar.js)`) | ✔ |
| documents | orders (`orders`) | ✔ |
| documents | customs (`customs`) | ✔ |
| documents | wallet (`wallet`) | ✔ |
| documents | refunds (`refunds`) | ✔ |
| documents | auth-identity (`auth-identity`) | ✔ |
| economic-engine | logistics (`logistics (FF-C1 2026-07-29 — lecture ou orchestration logistique ; preuve: services/transport-pricing.js -> services/transport-rails.js)`) | ✔ |
| economic-engine | catalog (`catalog (donnees produit source)`) | ✔ |
| economic-engine | auth (`auth`) | ✔ |
| economic-engine | dashboard (`dashboard`) | ✔ |
| economic-engine | orders (`orders`) | ✔ |
| economic-engine | wallet (`wallet`) | ✔ |
| economic-engine | loyalty (`loyalty (invalidation du cache de configuration finance apres modification admin — services/loyalty-service.js invalidateConfigCache, O7.3 provider loyalty)`) | ✔ |
| incident-management | logistics (`logistics (scan-engine écrit incidents — SQL inline)`) | ✔ |
| incident-management | payments (`payments (reconciliation-service écrit incidents — SQL inline)`) | ✔ |
| incident-management | notifications (`notifications (alert-engine écrit incidents — SQL inline)`) | ✔ |
| incident-management | dashboard (`dashboard`) | ✔ |
| infrastructure | auth (`auth — bootstrap/api-routes.js monte les routes auth`) | ✔ |
| infrastructure | catalog (`catalog — bootstrap/api-routes.js monte les routes catalog`) | ✔ |
| infrastructure | customs (`customs — bootstrap/api-routes.js monte les routes customs`) | ✔ |
| infrastructure | dashboard (`dashboard — bootstrap/api-routes.js monte les routes dashboard`) | ✔ |
| infrastructure | economic-engine (`economic-engine — bootstrap/api-routes.js monte les routes economic-engine`) | ✔ |
| infrastructure | inventory (`inventory — bootstrap/api-routes.js monte les routes inventory`) | ✔ |
| infrastructure | logistics (`logistics — bootstrap/api-routes.js monte les routes logistics`) | ✔ |
| infrastructure | notifications (`notifications`) | ✔ |
| infrastructure | platform-ops (`platform-ops`) | ✔ |
| infrastructure | orders (`orders — bootstrap/api-routes.js monte les routes orders`) | ✔ |
| infrastructure | payments (`payments`) | ✔ |
| infrastructure | recommendations (`recommendations — bootstrap/api-routes.js monte les routes recommendations`) | ✔ |
| infrastructure | shared-cart (`shared-cart — bootstrap/api-routes.js monte les routes shared-cart`) | ✔ |
| infrastructure | wallet (`wallet — bootstrap/api-routes.js monte les routes wallet`) | ✔ |
| inventory | catalog (`catalog (produit concerne)`) | ✔ |
| inventory | auth (`auth`) | ✔ |
| logistics | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: utils/parcels.js -> utils/rules.js ; services/parcel-operations.js -> utils/rules.js)`) | ✔ |
| logistics | orders (`orders (commande rattachee au colis)`) | ✔ |
| logistics | customs (`customs (statut declaration)`) | ✔ |
| logistics | auth (`auth`) | ✔ |
| logistics | auth-identity (`auth-identity (autorisation nominative de retrait exceptionnel — services/pickup-authorization-service.js:getActiveAuthorizationForUpdate/hasActiveAuthorization, jamais de requête directe sur user_pickup_authorizations, Lot 5)`) | ✔ |
| logistics | catalog (`catalog`) | ✔ |
| logistics | economic-engine (`economic-engine`) | ✔ |
| logistics | notifications (`notifications`) | ✔ |
| logistics | payments (`payments (marque une commande payee — services/payment-service.js ; confirme un paiement cash pickup transactionnel — services/confirm-pickup-cash-payment.js ; O7.2 Cycle B)`) | ✔ |
| logistics | refunds (`refunds`) | ✔ |
| logistics | wallet (`wallet`) | ✔ |
| logistics | purchasing (`purchasing (declenche verification/reapprovisionnement apres collecte cash relais — services/purchasing-trigger-service.js, O7.2 Cycle C)`) | ✔ |
| logistics | loyalty (`loyalty (recalcul de palier apres collecte cash relais / scan preparation — services/loyalty-service.js recalculateLoyalty/handleOrderConfirmed, O7.3 provider loyalty)`) | ✔ |
| loyalty | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/loyalty.js -> middleware/auth.js)`) | ✔ |
| loyalty | notifications (`notifications (FF-C1 2026-07-29 — émission de message ; preuve: services/loyalty-service.js -> services/notification-service.js)`) | ✔ |
| loyalty | auth-identity (`auth-identity (identification du client)`) | ✔ |
| loyalty | wallet (`wallet (aucune écriture — v_loyalty_summary et le calcul de palier ne lisent pas les tables wallet)`) | ✔ |
| notifications | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/notification-api.js -> middleware/auth.js ; routes/alerts.js -> middleware/auth.js)`) | ✔ |
| notifications | orders (`orders`) | ✔ |
| notifications | payments (`payments`) | ✔ |
| notifications | shared-cart (`shared-cart`) | ✔ |
| notifications | refunds (`refunds`) | ✔ |
| orders | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: routes/orders/create.js -> utils/rules.js ; routes/orders/qr.js -> utils/rules.js ; routes/orders/list.js -> utils/rules.js ; +1)`) | ✔ |
| orders | wallet (`wallet (application credit)`) | ✔ |
| orders | economic-engine (`economic-engine (cout figure a la commande)`) | ✔ |
| orders | logistics (`logistics (rattachement colis)`) | ✔ |
| orders | catalog (`catalog (lecture produit)`) | ✔ |
| orders | purchasing (`purchasing (lecture — engagement fournisseur déclenché par une commande ; scindée d'orders au Lot O1.4)`) | ✔ |
| orders | loyalty (`loyalty (remise palier au checkout + recalcul apres commande — services/loyalty-service.js getLoyaltyDiscount/recalculateLoyalty, O7.3 provider loyalty)`) | ✔ |
| orders | payments (`payments (marque un remboursement — services/payment-service.js markRefunded, O7.3 provider payments)`) | ✔ |
| orders | auth (`auth`) | ✔ |
| orders | auth-identity (`auth-identity (projection checkout boutique : identité client et téléphone)`) | ✔ |
| orders | customs (`customs`) | ✔ |
| orders | dashboard (`dashboard`) | ✔ |
| orders | documents (`documents`) | ✔ |
| orders | notifications (`notifications (projection idempotente du retrait disponible)`) | ✔ |
| orders | refunds (`refunds`) | ✔ |
| payments | platform-ops (`platform-ops (FF-C1 2026-07-29 — monitoring et exploitation technique ; preuve: routes/payments.js -> services/monitoring.js)`) | ✔ |
| payments | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/cash.js -> middleware/auth.js ; routes/payments.js -> middleware/auth.js ; routes/pickup-pay-cash.js -> middleware/auth.js ; +2)`) | ✔ |
| payments | refunds (`refunds (FF-C1 2026-07-29 — orchestration du remboursement ; preuve: services/payment-paypal.js -> services/refund-service.js)`) | ✔ |
| payments | documents (`documents (FF-C1 2026-07-29 — émission ou lecture documentaire ; preuve: services/payment-paypal.js -> services/documents/refund-receipt.js)`) | ✔ |
| payments | notifications (`notifications (FF-C1 2026-07-29 — émission de message ; preuve: services/cash-reminder-service.js -> services/notification-service.js ; services/payment-paypal.js -> services/notification-service.js ; services/payment-cash-confirm.js -> services/notification-service.js ; +2)`) | ✔ |
| payments | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: services/cash-reminder-service.js -> utils/rules.js)`) | ✔ |
| payments | orders (`orders (commande a payer)`) | ✔ |
| payments | logistics (`logistics (generation du code retrait pickup au moment du paiement — services/pickup-secret-service.js ; lecture du statut agrege colis pour reconciliation — utils/parcels.js ; O7.2 Cycle B)`) | ✔ |
| payments | loyalty (`loyalty (declenche le recalcul de palier apres paiement confirme — services/loyalty-service.js handleOrderConfirmed, O7.3 provider loyalty)`) | ✔ |
| payments | purchasing (`purchasing (declenche verification/reapprovisionnement apres encaissement — services/purchasing-trigger-service.js triggerPurchasing, O7.3 provider purchasing)`) | ✔ |
| platform-ops | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: routes/config.js -> utils/rules.js)`) | ✔ |
| platform-ops | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/modules.js -> middleware/auth.js ; routes/health.js -> middleware/auth.js ; routes/ops-api.js -> middleware/auth.js ; +2)`) | ✔ |
| platform-ops | economic-engine (`economic-engine (calcul de prix ponctuel pour modules sur-mesure — services/pricing-engine.js recommend, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)`) | ✔ |
| platform-ops | logistics (`logistics (simulateur declenche une transition colis via transitionParcelStatus — services/parcel-operations.js, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)`) | ✔ |
| platform-ops | orders (`orders (simulateur declenche une transition commande via transitionOrderStatus — services/order-status-machine.js, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)`) | ✔ |
| platform-ops | auth-identity (`auth-identity`) | ✔ |
| platform-ops | catalog (`catalog`) | ✔ |
| platform-ops | purchasing (`purchasing`) | ✔ |
| purchasing | orders (`orders (lecture : order_items, orders — le besoin d'achat naît d'une commande client)`) | ✔ |
| purchasing | auth (`auth (garde admin)`) | ✔ |
| purchasing | notifications (`notifications (notification fournisseur WhatsApp, via services/notification-service.js)`) | ✔ |
| purchasing | logistics (`logistics (declenche scan preparation + notification client apres reception hub complete — services/scan-operations.js triggerScan3, O7.2 Cycle C)`) | ✔ |
| recommendations | catalog (`catalog (lecture produit)`) | ✔ |
| recommendations | auth (`auth`) | ✔ |
| recommendations | logistics (`logistics`) | ✔ |
| refunds | orders (`orders (commande source)`) | ✔ |
| refunds | shared-cart (`shared-cart (panier source)`) | ✔ |
| refunds | wallet (`wallet (credit)`) | ✔ |
| refunds | documents (`documents (reçu)`) | ✔ |
| shared-cart | orders (`orders (arbitrage de la réclamation via order_items.shared_cart_item_id — feature orders, migration 123)`) | ✔ |
| shared-cart | notifications (`notifications (émission uniquement — WhatsApp création de liste)`) | ✔ |
| shared-cart | auth (`auth`) | ✔ |
| shared-cart | auth-identity (`auth-identity (projection boutique : b-share-cart.js consomme identité et téléphone)`) | ✔ |
| shared-cart | recommendations (`recommendations`) | ✔ |
| sourcing | catalog (`catalog (connecteurs fournisseur, catalog-import-orchestrator, catalog-enrichment, supplier-catalog-scanner pour le scan pricing lui-même, et depuis PDC-8 Lot 6 : catalog-promotion.js — appelé dans la transaction de POST .../import-product pour promouvoir normalized_source_contract V2 vers catalog_media/product_variants/product_skus/product_sku_media)`) | ✔ |
| sourcing | economic-engine (`economic-engine (pricing-engine.loadGlobalConfig — config de scan)`) | ✔ |
| sourcing | auth (`auth`) | ✔ |
| unsold-resolution | orders (`orders (commande source de l'invendu)`) | ✔ |
| unsold-resolution | catalog (`catalog (produit concerné)`) | ✔ |
| unsold-resolution | auth (`auth`) | ✔ |
| wallet | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/wallet.js -> middleware/auth.js)`) | ✔ |
| wallet | documents (`documents (FF-C1 2026-07-29 — émission ou lecture documentaire ; preuve: services/wallet-service.js -> services/documents/wallet-receipt.js ; routes/wallet.js -> services/documents/wallet-receipt.js)`) | ✔ |
| wallet | auth-identity (`auth-identity (identification du client)`) | ✔ |
| wallet | payments (`payments (finalise le paiement — payment-service.js markPaid, transactionnel, quand le debit wallet couvre integralement la commande ; invariant D-02, payment-service reste seul proprietaire de payment_status — O7.2 Cycle D)`) | ✔ |
| admin-dashboard | sourcing (`sourcing`) | ✔ |
| decision-signals | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/signals.js -> middleware/auth.js)`) | ✔ |
| decision-signals | logistics (`logistics (FF-C1 2026-07-29 — lecture ou orchestration logistique ; preuve: services/radar-queries.js -> utils/parcels.js)`) | ✔ |
| decision-signals | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: services/radar-queries.js -> utils/rules.js)`) | ✔ |

## Drifts

### ERROR (0)

- none

### WARN / DEBT (105)

Classification sémantique Lot O4 Phase E — voir `governance/business-graph-warning-semantics.js`. Catégories : EXPECTED_TOPOLOGY (relation légitime documentée), KNOWN_DEBT (déclaration manquante, pas un défaut de comportement), ACTIONABLE_DRIFT (écart probable à corriger), INVALID_DECLARATION (nom de feature inexistant), GENERATOR_LIMITATION (artefact d'extraction).

- **[DASH-MANIFEST-DUPLICATE-COPY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard — "public/features/admin-dashboard.feature.js" est une copie déclarée de "public/dashboards/features/admin-dashboard.feature.js" (APP_FEATURE_REGISTRY.md) — non chargée comme nœud séparé, résolue uniquement contre le canonique
- **[DASH-MANIFEST-DUPLICATE-COPY]** _[EXPECTED_TOPOLOGY]_ legacy-control-tower — "public/features/legacy-control-tower.feature.js" est une copie déclarée de "public/dashboards/features/legacy-control-tower.feature.js" (APP_FEATURE_REGISTRY.md) — non chargée comme nœud séparé, résolue uniquement contre le canonique
- **[DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED]** _[GENERATOR_LIMITATION]_ scope:backend — 16 appel(s) require()/import() dynamique(s) non résolu(s) statiquement dans le scope backend (ex. tests/unit/modal-mobile-canonical.test.js: CSS_BUNDLES_PATH | scripts/boutique-ownership-full-check.js: path.join(abs, f | scripts/contract-generate.js: ...) — limitation du modèle statique O5, jamais inventé
- **[DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED]** _[GENERATOR_LIMITATION]_ scope:boutique — 1 appel(s) require()/import() dynamique(s) non résolu(s) statiquement dans le scope boutique (ex. public/boutique/tests/unit/modal-cart-sku-guard.test.js: bundleConfigPath) — limitation du modèle statique O5, jamais inventé
- **[EXPOSE-ENTRY-UNPARSED]** _[GENERATOR_LIMITATION]_ logistics / GET/POST /api/parcels — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** _[GENERATOR_LIMITATION]_ orders / GET/POST /api/orders — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSED-ROUTE-UNRESOLVED]** _[GENERATOR_LIMITATION]_ infrastructure / GET /*.html — "GET /*.html" déclaré par infrastructure mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** _[GENERATOR_LIMITATION]_ infrastructure / GET /webhook/authkey-whatsapp — "GET /webhook/authkey-whatsapp" déclaré par infrastructure mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> catalog — dépendance cross-feature observée (canal: interface, 2 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "catalog"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> customs — dépendance cross-feature observée (canal: interface, 4 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "customs"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> dashboard — dépendance cross-feature observée (canal: interface, 14 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "dashboard"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> decision-signals — dépendance cross-feature observée (canal: interface, 3 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "decision-signals"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> documents — dépendance cross-feature observée (canal: interface, 1 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "documents"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> economic-engine — dépendance cross-feature observée (canal: interface, 22 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "economic-engine"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> inventory — dépendance cross-feature observée (canal: interface, 5 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "inventory"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> logistics — dépendance cross-feature observée (canal: interface, 7 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> orders — dépendance cross-feature observée (canal: interface, 3 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "orders"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard -> payments — dépendance cross-feature observée (canal: interface, 6 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ auth -> auth-identity — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "auth" vers "auth-identity"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ auth -> infrastructure — dépendance cross-feature observée (canal: static-code, 13 preuve(s)) sans contract.consumes déclaré chez "auth" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ auth-identity -> infrastructure — dépendance cross-feature observée (canal: static-code, 16 preuve(s)) sans contract.consumes déclaré chez "auth-identity" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ auth-identity -> logistics — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "auth-identity" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ auth-identity -> platform-ops — dépendance cross-feature observée (canal: static-code, 7 preuve(s)) sans contract.consumes déclaré chez "auth-identity" vers "platform-ops"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ catalog -> infrastructure — dépendance cross-feature observée (canal: static-code, 36 preuve(s)) sans contract.consumes déclaré chez "catalog" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ catalog -> orders — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "catalog" vers "orders"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ catalog -> platform-ops — dépendance cross-feature observée (canal: static-code, 62 preuve(s)) sans contract.consumes déclaré chez "catalog" vers "platform-ops"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ customs -> infrastructure — dépendance cross-feature observée (canal: static-code, 4 preuve(s)) sans contract.consumes déclaré chez "customs" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ dashboard -> infrastructure — dépendance cross-feature observée (canal: static-code, 46 preuve(s)) sans contract.consumes déclaré chez "dashboard" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ decision-signals -> infrastructure — dépendance cross-feature observée (canal: static-code, 6 preuve(s)) sans contract.consumes déclaré chez "decision-signals" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ documents -> auth — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "documents" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ documents -> infrastructure — dépendance cross-feature observée (canal: static-code, 21 preuve(s)) sans contract.consumes déclaré chez "documents" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ economic-engine -> infrastructure — dépendance cross-feature observée (canal: static-code, 72 preuve(s)) sans contract.consumes déclaré chez "economic-engine" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ incident-management -> infrastructure — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "incident-management" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ infrastructure -> auth-identity — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "auth-identity"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ infrastructure -> business-rules — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "business-rules"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ infrastructure -> decision-signals — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "decision-signals"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ infrastructure -> documents — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "documents"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ infrastructure -> loyalty — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ infrastructure -> purchasing — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "purchasing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ infrastructure -> sourcing — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "sourcing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ infrastructure -> unsold-resolution — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "unsold-resolution"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ inventory -> infrastructure — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "inventory" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ inventory -> logistics — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "inventory" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ inventory -> orders — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "inventory" vers "orders"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ inventory -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "inventory" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ logistics -> infrastructure — dépendance cross-feature observée (canal: static-code, 74 preuve(s)) sans contract.consumes déclaré chez "logistics" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ loyalty -> infrastructure — dépendance cross-feature observée (canal: static-code, 5 preuve(s)) sans contract.consumes déclaré chez "loyalty" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ notifications -> infrastructure — dépendance cross-feature observée (canal: static-code, 13 preuve(s)) sans contract.consumes déclaré chez "notifications" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ notifications -> platform-ops — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "notifications" vers "platform-ops"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ orders -> infrastructure — dépendance cross-feature observée (canal: interface+static-code, 57 preuve(s)) sans contract.consumes déclaré chez "orders" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ orders -> platform-ops — dépendance cross-feature observée (canal: static-code, 37 preuve(s)) sans contract.consumes déclaré chez "orders" vers "platform-ops"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ orders -> shared-cart — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "orders" vers "shared-cart"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ payments -> infrastructure — dépendance cross-feature observée (canal: interface+static-code, 45 preuve(s)) sans contract.consumes déclaré chez "payments" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ platform-ops -> infrastructure — dépendance cross-feature observée (canal: interface+static-code, 27 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ platform-ops -> notifications — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ platform-ops -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ platform-ops -> recommendations — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "recommendations"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ platform-ops -> shared-cart — dépendance cross-feature observée (canal: static-code, 6 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "shared-cart"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ purchasing -> infrastructure — dépendance cross-feature observée (canal: static-code, 20 preuve(s)) sans contract.consumes déclaré chez "purchasing" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ recommendations -> infrastructure — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "recommendations" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ recommendations -> platform-ops — dépendance cross-feature observée (canal: static-code, 7 preuve(s)) sans contract.consumes déclaré chez "recommendations" vers "platform-ops"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ refunds -> infrastructure — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "refunds" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ refunds -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "refunds" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ shared-cart -> infrastructure — dépendance cross-feature observée (canal: static-code, 15 preuve(s)) sans contract.consumes déclaré chez "shared-cart" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ shared-cart -> platform-ops — dépendance cross-feature observée (canal: static-code, 53 preuve(s)) sans contract.consumes déclaré chez "shared-cart" vers "platform-ops"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ sourcing -> infrastructure — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "sourcing" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ unsold-resolution -> infrastructure — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "unsold-resolution" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ wallet -> infrastructure — dépendance cross-feature observée (canal: static-code, 8 preuve(s)) sans contract.consumes déclaré chez "wallet" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[EXPECTED_TOPOLOGY]_ wallet -> platform-ops — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "wallet" vers "platform-ops"
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ alerts — table "alerts" : lifecycle owner = notifications (db.lifecycleOwnerOf), mais aussi écrite par catalog, logistics, orders, payments, purchasing
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ basket_items — table "basket_items" : lifecycle owner = shared-cart (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ baskets — table "baskets" : lifecycle owner = shared-cart (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ cart_shares — table "cart_shares" : lifecycle owner = shared-cart (db.lifecycleOwnerOf), mais aussi écrite par orders
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ catalog_media — table "catalog_media" : lifecycle owner = catalog (db.lifecycleOwnerOf), mais aussi écrite par sourcing
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ economic_snapshots — table "economic_snapshots" : lifecycle owner = economic-engine (db.lifecycleOwnerOf), mais aussi écrite par infrastructure
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ incidents — table "incidents" : lifecycle owner = incident-management (db.lifecycleOwnerOf), mais aussi écrite par dashboard, logistics, notifications, payments
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ invoices — table "invoices" : lifecycle owner = documents (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ loyalty_rewards — table "loyalty_rewards" : lifecycle owner = loyalty (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ notification_log — table "notification_log" : lifecycle owner = notifications (db.lifecycleOwnerOf), mais aussi écrite par platform-ops
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ order_comments — table "order_comments" : lifecycle owner = orders (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ order_item_real_cost_allocations — table "order_item_real_cost_allocations" : lifecycle owner = economic-engine (db.lifecycleOwnerOf), mais aussi écrite par customs
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ order_items — table "order_items" : lifecycle owner = orders (db.lifecycleOwnerOf), mais aussi écrite par dashboard, logistics
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ order_status_history — table "order_status_history" : lifecycle owner = orders (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ orders — table "orders" : lifecycle owner = orders (db.lifecycleOwnerOf), mais aussi écrite par customs, dashboard, inventory, logistics, payments, platform-ops, purchasing, wallet
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ parcel_items — table "parcel_items" : lifecycle owner = logistics (db.lifecycleOwnerOf), mais aussi écrite par dashboard, inventory, platform-ops
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ parcels — table "parcels" : lifecycle owner = logistics (db.lifecycleOwnerOf), mais aussi écrite par customs, dashboard, payments, platform-ops
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ pickup_print_tokens — table "pickup_print_tokens" : lifecycle owner = logistics (db.lifecycleOwnerOf), mais aussi écrite par infrastructure
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ pickup_reveal_codes — table "pickup_reveal_codes" : lifecycle owner = logistics (db.lifecycleOwnerOf), mais aussi écrite par infrastructure
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ price_history — table "price_history" : lifecycle owner = economic-engine (db.lifecycleOwnerOf), mais aussi écrite par catalog
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ product_sku_media — table "product_sku_media" : lifecycle owner = catalog (db.lifecycleOwnerOf), mais aussi écrite par sourcing
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ product_skus — table "product_skus" : lifecycle owner = catalog (db.lifecycleOwnerOf), mais aussi écrite par sourcing
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ product_variants — table "product_variants" : lifecycle owner = catalog (db.lifecycleOwnerOf), mais aussi écrite par economic-engine, sourcing
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ products — table "products" : lifecycle owner = catalog (db.lifecycleOwnerOf), mais aussi écrite par dashboard, economic-engine, sourcing
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ purchase_orders — table "purchase_orders" : lifecycle owner = purchasing (db.lifecycleOwnerOf), mais aussi écrite par orders
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ recipients — table "recipients" : lifecycle owner = orders (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ relais — table "relais" : lifecycle owner = logistics (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ revoked_tokens — table "revoked_tokens" : lifecycle owner = auth-identity (db.lifecycleOwnerOf), mais aussi écrite par infrastructure
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ scan_events — table "scan_events" : lifecycle owner = logistics (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ scans — table "scans" : lifecycle owner = logistics (db.lifecycleOwnerOf), mais aussi écrite par dashboard, orders, platform-ops
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ sms_log — table "sms_log" : lifecycle owner = orders (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ sourcing_candidate_events — table "sourcing_candidate_events" : lifecycle owner = sourcing (db.lifecycleOwnerOf), mais aussi écrite par catalog
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ sourcing_candidates — table "sourcing_candidates" : lifecycle owner = sourcing (db.lifecycleOwnerOf), mais aussi écrite par catalog
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ users — table "users" : lifecycle owner = auth-identity (db.lifecycleOwnerOf), mais aussi écrite par auth, dashboard, loyalty
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ wallet_transactions — table "wallet_transactions" : lifecycle owner = wallet (db.lifecycleOwnerOf), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ wallets — table "wallets" : lifecycle owner = wallet (db.lifecycleOwnerOf), mais aussi écrite par dashboard

## Orphan technical nodes

Fichiers présents dans le Technical Architecture Graph, non revendiqués par une carte feature ni un transversal déclaré (`governance/transversal-paths.json`).

- none

## Lot O5 — Feature Dependency Conformance & Hidden Coupling Gate

Meta Graph monté : oui.

### Coverage par scope

- backend : 774 fichier(s) `.js`/`.mjs` observés (canal A)
- boutique : 145 fichier(s) observés, dont 12 sous manifest non-canonique (canonicalFeature=null)
- dash : 82 fichier(s) observés
  - _dash static-string local dependency file coverage: COMPLETE (fichiers .js déclarés, résolus)_
  - _dash interface channel: consumer file resolution câblée via docs/DASHBOARDS_360.json (bridge vue -> fileId basé sur les entrées "views/" déjà gouvernées par implementedByEdges) — les modules dashboards référencés par META_GRAPH mais absents des vues gouvernées (ou ambigus) restent INTERFACE-CONSUMER-FILE-UNRESOLVED, jamais devinés_
  - _dash total runtime dependency observability: LIMITED BY O5 STATIC MODEL (dynamic import, registry lookup, dependency injection, event-driven dependency hors périmètre statique)_

### Dependency conformance summary (paires canonical-feature → canonical-feature)

| Consumer | Provider | Canaux | Preuves | Statut |
|---|---|---|---|---|
| admin-dashboard | catalog | interface | 2 | **OBSERVED_UNDECLARED** |
| admin-dashboard | customs | interface | 4 | **OBSERVED_UNDECLARED** |
| admin-dashboard | dashboard | interface | 14 | **OBSERVED_UNDECLARED** |
| admin-dashboard | decision-signals | interface | 3 | **OBSERVED_UNDECLARED** |
| admin-dashboard | documents | interface | 1 | **OBSERVED_UNDECLARED** |
| admin-dashboard | economic-engine | interface | 22 | **OBSERVED_UNDECLARED** |
| admin-dashboard | inventory | interface | 5 | **OBSERVED_UNDECLARED** |
| admin-dashboard | logistics | interface | 7 | **OBSERVED_UNDECLARED** |
| admin-dashboard | orders | interface | 3 | **OBSERVED_UNDECLARED** |
| admin-dashboard | payments | interface | 6 | **OBSERVED_UNDECLARED** |
| admin-dashboard | sourcing | interface | 3 | **DECLARED_AND_OBSERVED** |
| auth | auth-identity | static-code | 3 | **OBSERVED_UNDECLARED** |
| auth | infrastructure | static-code | 13 | **OBSERVED_UNDECLARED** |
| auth | notifications | static-code | 1 | **DECLARED_AND_OBSERVED** |
| auth-identity | auth | static-code | 2 | **DECLARED_AND_OBSERVED** |
| auth-identity | documents | interface | 1 | **DECLARED_AND_OBSERVED** |
| auth-identity | infrastructure | static-code | 16 | **OBSERVED_UNDECLARED** |
| auth-identity | logistics | static-code | 2 | **OBSERVED_UNDECLARED** |
| auth-identity | notifications | static-code | 2 | **DECLARED_AND_OBSERVED** |
| auth-identity | platform-ops | static-code | 7 | **OBSERVED_UNDECLARED** |
| auth-identity | wallet | interface | 1 | **DECLARED_AND_OBSERVED** |
| business-rules | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| business-rules | infrastructure | static-code | 3 | **DECLARED_AND_OBSERVED** |
| catalog | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| catalog | auth-identity | interface | 1 | **DECLARED_AND_OBSERVED** |
| catalog | business-rules | static-code | 7 | **DECLARED_AND_OBSERVED** |
| catalog | economic-engine | static-code | 6 | **DECLARED_AND_OBSERVED** |
| catalog | infrastructure | static-code | 36 | **OBSERVED_UNDECLARED** |
| catalog | logistics | static-code | 5 | **DECLARED_AND_OBSERVED** |
| catalog | orders | static-code | 3 | **OBSERVED_UNDECLARED** |
| catalog | platform-ops | static-code | 62 | **OBSERVED_UNDECLARED** |
| catalog | shared-cart | static-code, interface | 11 | **DECLARED_AND_OBSERVED** |
| customs | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| customs | documents | static-code | 2 | **DECLARED_AND_OBSERVED** |
| customs | economic-engine | static-code | 2 | **DECLARED_AND_OBSERVED** |
| customs | infrastructure | static-code | 4 | **OBSERVED_UNDECLARED** |
| dashboard | auth | static-code | 10 | **DECLARED_AND_OBSERVED** |
| dashboard | business-rules | static-code | 1 | **DECLARED_AND_OBSERVED** |
| dashboard | customs | static-code | 2 | **DECLARED_AND_OBSERVED** |
| dashboard | decision-signals | static-code | 2 | **DECLARED_AND_OBSERVED** |
| dashboard | documents | static-code | 1 | **DECLARED_AND_OBSERVED** |
| dashboard | economic-engine | static-code | 4 | **DECLARED_AND_OBSERVED** |
| dashboard | infrastructure | static-code | 46 | **OBSERVED_UNDECLARED** |
| dashboard | logistics | static-code | 7 | **DECLARED_AND_OBSERVED** |
| dashboard | orders | static-code | 6 | **DECLARED_AND_OBSERVED** |
| dashboard | purchasing | static-code | 2 | **DECLARED_AND_OBSERVED** |
| decision-signals | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| decision-signals | business-rules | static-code | 2 | **DECLARED_AND_OBSERVED** |
| decision-signals | infrastructure | static-code | 6 | **OBSERVED_UNDECLARED** |
| decision-signals | logistics | static-code | 1 | **DECLARED_AND_OBSERVED** |
| documents | auth | static-code | 3 | **OBSERVED_UNDECLARED** |
| documents | infrastructure | static-code | 21 | **OBSERVED_UNDECLARED** |
| economic-engine | auth | static-code | 11 | **DECLARED_AND_OBSERVED** |
| economic-engine | catalog | static-code | 2 | **DECLARED_AND_OBSERVED** |
| economic-engine | dashboard | static-code | 8 | **DECLARED_AND_OBSERVED** |
| economic-engine | infrastructure | static-code | 72 | **OBSERVED_UNDECLARED** |
| economic-engine | logistics | static-code | 3 | **DECLARED_AND_OBSERVED** |
| economic-engine | loyalty | static-code | 1 | **DECLARED_AND_OBSERVED** |
| economic-engine | orders | static-code | 2 | **DECLARED_AND_OBSERVED** |
| incident-management | infrastructure | static-code | 3 | **OBSERVED_UNDECLARED** |
| infrastructure | auth | static-code | 2 | **DECLARED_AND_OBSERVED** |
| infrastructure | auth-identity | static-code | 3 | **OBSERVED_UNDECLARED** |
| infrastructure | business-rules | static-code | 3 | **OBSERVED_UNDECLARED** |
| infrastructure | catalog | static-code | 4 | **DECLARED_AND_OBSERVED** |
| infrastructure | customs | static-code | 2 | **DECLARED_AND_OBSERVED** |
| infrastructure | dashboard | static-code | 7 | **DECLARED_AND_OBSERVED** |
| infrastructure | decision-signals | static-code | 2 | **OBSERVED_UNDECLARED** |
| infrastructure | documents | static-code | 2 | **OBSERVED_UNDECLARED** |
| infrastructure | economic-engine | static-code | 11 | **DECLARED_AND_OBSERVED** |
| infrastructure | inventory | static-code | 2 | **DECLARED_AND_OBSERVED** |
| infrastructure | logistics | static-code | 21 | **DECLARED_AND_OBSERVED** |
| infrastructure | loyalty | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | notifications | static-code | 4 | **DECLARED_AND_OBSERVED** |
| infrastructure | orders | static-code | 5 | **DECLARED_AND_OBSERVED** |
| infrastructure | payments | static-code | 4 | **DECLARED_AND_OBSERVED** |
| infrastructure | platform-ops | static-code | 5 | **DECLARED_AND_OBSERVED** |
| infrastructure | purchasing | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | recommendations | static-code | 1 | **DECLARED_AND_OBSERVED** |
| infrastructure | shared-cart | static-code | 6 | **DECLARED_AND_OBSERVED** |
| infrastructure | sourcing | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | unsold-resolution | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | wallet | static-code | 2 | **DECLARED_AND_OBSERVED** |
| inventory | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| inventory | infrastructure | static-code | 2 | **OBSERVED_UNDECLARED** |
| inventory | logistics | static-code | 1 | **OBSERVED_UNDECLARED** |
| inventory | orders | static-code | 1 | **OBSERVED_UNDECLARED** |
| inventory | payments | static-code | 1 | **OBSERVED_UNDECLARED** |
| logistics | auth | static-code | 13 | **DECLARED_AND_OBSERVED** |
| logistics | auth-identity | static-code | 2 | **DECLARED_AND_OBSERVED** |
| logistics | business-rules | static-code | 3 | **DECLARED_AND_OBSERVED** |
| logistics | catalog | static-code | 1 | **DECLARED_AND_OBSERVED** |
| logistics | infrastructure | static-code | 74 | **OBSERVED_UNDECLARED** |
| logistics | loyalty | static-code | 3 | **DECLARED_AND_OBSERVED** |
| logistics | notifications | static-code | 9 | **DECLARED_AND_OBSERVED** |
| logistics | orders | static-code | 15 | **DECLARED_AND_OBSERVED** |
| logistics | payments | static-code | 2 | **DECLARED_AND_OBSERVED** |
| logistics | purchasing | static-code | 1 | **DECLARED_AND_OBSERVED** |
| logistics | refunds | static-code | 1 | **DECLARED_AND_OBSERVED** |
| loyalty | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| loyalty | infrastructure | static-code | 5 | **OBSERVED_UNDECLARED** |
| loyalty | notifications | static-code | 3 | **DECLARED_AND_OBSERVED** |
| notifications | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| notifications | infrastructure | static-code | 13 | **OBSERVED_UNDECLARED** |
| notifications | platform-ops | static-code | 2 | **OBSERVED_UNDECLARED** |
| orders | auth | static-code | 12 | **DECLARED_AND_OBSERVED** |
| orders | auth-identity | static-code, interface | 9 | **DECLARED_AND_OBSERVED** |
| orders | business-rules | static-code | 8 | **DECLARED_AND_OBSERVED** |
| orders | catalog | static-code | 6 | **DECLARED_AND_OBSERVED** |
| orders | customs | static-code | 3 | **DECLARED_AND_OBSERVED** |
| orders | documents | static-code, interface | 10 | **DECLARED_AND_OBSERVED** |
| orders | economic-engine | static-code | 3 | **DECLARED_AND_OBSERVED** |
| orders | infrastructure | static-code, interface | 57 | **OBSERVED_UNDECLARED** |
| orders | logistics | static-code, interface | 16 | **DECLARED_AND_OBSERVED** |
| orders | loyalty | static-code | 5 | **DECLARED_AND_OBSERVED** |
| orders | notifications | static-code | 9 | **DECLARED_AND_OBSERVED** |
| orders | payments | static-code, interface | 8 | **DECLARED_AND_OBSERVED** |
| orders | platform-ops | static-code | 37 | **OBSERVED_UNDECLARED** |
| orders | refunds | static-code | 4 | **DECLARED_AND_OBSERVED** |
| orders | shared-cart | static-code | 3 | **OBSERVED_UNDECLARED** |
| orders | wallet | static-code, interface | 9 | **DECLARED_AND_OBSERVED** |
| payments | auth | static-code | 5 | **DECLARED_AND_OBSERVED** |
| payments | business-rules | static-code | 2 | **DECLARED_AND_OBSERVED** |
| payments | documents | static-code | 7 | **DECLARED_AND_OBSERVED** |
| payments | infrastructure | static-code, interface | 45 | **OBSERVED_UNDECLARED** |
| payments | logistics | static-code | 11 | **DECLARED_AND_OBSERVED** |
| payments | loyalty | static-code | 4 | **DECLARED_AND_OBSERVED** |
| payments | notifications | static-code | 7 | **DECLARED_AND_OBSERVED** |
| payments | orders | static-code | 15 | **DECLARED_AND_OBSERVED** |
| payments | platform-ops | static-code | 3 | **DECLARED_AND_OBSERVED** |
| payments | purchasing | static-code | 5 | **DECLARED_AND_OBSERVED** |
| payments | refunds | static-code | 2 | **DECLARED_AND_OBSERVED** |
| platform-ops | auth | static-code | 5 | **DECLARED_AND_OBSERVED** |
| platform-ops | auth-identity | static-code, interface | 6 | **DECLARED_AND_OBSERVED** |
| platform-ops | business-rules | static-code | 1 | **DECLARED_AND_OBSERVED** |
| platform-ops | catalog | static-code, interface | 21 | **DECLARED_AND_OBSERVED** |
| platform-ops | economic-engine | static-code | 1 | **DECLARED_AND_OBSERVED** |
| platform-ops | infrastructure | static-code, interface | 27 | **OBSERVED_UNDECLARED** |
| platform-ops | logistics | static-code, interface | 13 | **DECLARED_AND_OBSERVED** |
| platform-ops | notifications | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | orders | static-code, interface | 16 | **DECLARED_AND_OBSERVED** |
| platform-ops | payments | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | purchasing | static-code, interface | 2 | **DECLARED_AND_OBSERVED** |
| platform-ops | recommendations | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | shared-cart | static-code | 6 | **OBSERVED_UNDECLARED** |
| purchasing | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| purchasing | infrastructure | static-code | 20 | **OBSERVED_UNDECLARED** |
| purchasing | logistics | static-code | 2 | **DECLARED_AND_OBSERVED** |
| purchasing | notifications | static-code | 2 | **DECLARED_AND_OBSERVED** |
| purchasing | orders | static-code | 4 | **DECLARED_AND_OBSERVED** |
| recommendations | catalog | static-code | 1 | **DECLARED_AND_OBSERVED** |
| recommendations | infrastructure | static-code | 1 | **OBSERVED_UNDECLARED** |
| recommendations | platform-ops | static-code | 7 | **OBSERVED_UNDECLARED** |
| refunds | documents | static-code | 2 | **DECLARED_AND_OBSERVED** |
| refunds | infrastructure | static-code | 3 | **OBSERVED_UNDECLARED** |
| refunds | orders | static-code | 3 | **DECLARED_AND_OBSERVED** |
| refunds | payments | static-code | 1 | **OBSERVED_UNDECLARED** |
| refunds | wallet | static-code | 3 | **DECLARED_AND_OBSERVED** |
| shared-cart | auth | static-code | 4 | **DECLARED_AND_OBSERVED** |
| shared-cart | auth-identity | static-code | 1 | **DECLARED_AND_OBSERVED** |
| shared-cart | infrastructure | static-code | 15 | **OBSERVED_UNDECLARED** |
| shared-cart | notifications | static-code | 2 | **DECLARED_AND_OBSERVED** |
| shared-cart | orders | static-code | 9 | **DECLARED_AND_OBSERVED** |
| shared-cart | platform-ops | static-code | 53 | **OBSERVED_UNDECLARED** |
| shared-cart | recommendations | static-code, interface | 4 | **DECLARED_AND_OBSERVED** |
| sourcing | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| sourcing | catalog | static-code | 9 | **DECLARED_AND_OBSERVED** |
| sourcing | economic-engine | static-code | 1 | **DECLARED_AND_OBSERVED** |
| sourcing | infrastructure | static-code | 2 | **OBSERVED_UNDECLARED** |
| unsold-resolution | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | infrastructure | static-code | 1 | **OBSERVED_UNDECLARED** |
| wallet | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| wallet | auth-identity | static-code | 2 | **DECLARED_AND_OBSERVED** |
| wallet | documents | static-code | 4 | **DECLARED_AND_OBSERVED** |
| wallet | infrastructure | static-code | 8 | **OBSERVED_UNDECLARED** |
| wallet | payments | static-code | 1 | **DECLARED_AND_OBSERVED** |
| wallet | platform-ops | static-code | 2 | **OBSERVED_UNDECLARED** |

### Observed undeclared dependencies

- `admin-dashboard` → `catalog` (canaux: interface)
- `admin-dashboard` → `customs` (canaux: interface)
- `admin-dashboard` → `dashboard` (canaux: interface)
- `admin-dashboard` → `decision-signals` (canaux: interface)
- `admin-dashboard` → `documents` (canaux: interface)
- `admin-dashboard` → `economic-engine` (canaux: interface)
- `admin-dashboard` → `inventory` (canaux: interface)
- `admin-dashboard` → `logistics` (canaux: interface)
- `admin-dashboard` → `orders` (canaux: interface)
- `admin-dashboard` → `payments` (canaux: interface)
- `auth` → `auth-identity` (canaux: static-code)
- `auth` → `infrastructure` (canaux: static-code)
- `auth-identity` → `infrastructure` (canaux: static-code)
- `auth-identity` → `logistics` (canaux: static-code)
- `auth-identity` → `platform-ops` (canaux: static-code)
- `catalog` → `infrastructure` (canaux: static-code)
- `catalog` → `orders` (canaux: static-code)
- `catalog` → `platform-ops` (canaux: static-code)
- `customs` → `infrastructure` (canaux: static-code)
- `dashboard` → `infrastructure` (canaux: static-code)
- `decision-signals` → `infrastructure` (canaux: static-code)
- `documents` → `auth` (canaux: static-code)
- `documents` → `infrastructure` (canaux: static-code)
- `economic-engine` → `infrastructure` (canaux: static-code)
- `incident-management` → `infrastructure` (canaux: static-code)
- `infrastructure` → `auth-identity` (canaux: static-code)
- `infrastructure` → `business-rules` (canaux: static-code)
- `infrastructure` → `decision-signals` (canaux: static-code)
- `infrastructure` → `documents` (canaux: static-code)
- `infrastructure` → `loyalty` (canaux: static-code)
- `infrastructure` → `purchasing` (canaux: static-code)
- `infrastructure` → `sourcing` (canaux: static-code)
- `infrastructure` → `unsold-resolution` (canaux: static-code)
- `inventory` → `infrastructure` (canaux: static-code)
- `inventory` → `logistics` (canaux: static-code)
- `inventory` → `orders` (canaux: static-code)
- `inventory` → `payments` (canaux: static-code)
- `logistics` → `infrastructure` (canaux: static-code)
- `loyalty` → `infrastructure` (canaux: static-code)
- `notifications` → `infrastructure` (canaux: static-code)
- `notifications` → `platform-ops` (canaux: static-code)
- `orders` → `infrastructure` (canaux: static-code, interface)
- `orders` → `platform-ops` (canaux: static-code)
- `orders` → `shared-cart` (canaux: static-code)
- `payments` → `infrastructure` (canaux: static-code, interface)
- `platform-ops` → `infrastructure` (canaux: static-code, interface)
- `platform-ops` → `notifications` (canaux: static-code)
- `platform-ops` → `payments` (canaux: static-code)
- `platform-ops` → `recommendations` (canaux: static-code)
- `platform-ops` → `shared-cart` (canaux: static-code)
- `purchasing` → `infrastructure` (canaux: static-code)
- `recommendations` → `infrastructure` (canaux: static-code)
- `recommendations` → `platform-ops` (canaux: static-code)
- `refunds` → `infrastructure` (canaux: static-code)
- `refunds` → `payments` (canaux: static-code)
- `shared-cart` → `infrastructure` (canaux: static-code)
- `shared-cart` → `platform-ops` (canaux: static-code)
- `sourcing` → `infrastructure` (canaux: static-code)
- `unsold-resolution` → `infrastructure` (canaux: static-code)
- `wallet` → `infrastructure` (canaux: static-code)
- `wallet` → `platform-ops` (canaux: static-code)

### Declared without observed evidence (canal A/D uniquement — ne signifie pas "dépendance inexistante")

- `auth` → `platform-ops` (déclaré : `platform-ops`)
- `auth` → `orders` (déclaré : `orders`)
- `customs` → `logistics` (déclaré : `logistics (colis a classer)`)
- `dashboard` → `payments` (déclaré : `payments (lecture paiements)`)
- `dashboard` → `inventory` (déclaré : `inventory (lecture stock)`)
- `dashboard` → `wallet` (déclaré : `wallet (soldes et crédits)`)
- `dashboard` → `recommendations` (déclaré : `recommendations`)
- `documents` → `orders` (déclaré : `orders`)
- `documents` → `customs` (déclaré : `customs`)
- `documents` → `wallet` (déclaré : `wallet`)
- `documents` → `refunds` (déclaré : `refunds`)
- `documents` → `auth-identity` (déclaré : `auth-identity`)
- `economic-engine` → `wallet` (déclaré : `wallet`)
- `incident-management` → `logistics` (déclaré : `logistics (scan-engine écrit incidents — SQL inline)`)
- `incident-management` → `payments` (déclaré : `payments (reconciliation-service écrit incidents — SQL inline)`)
- `incident-management` → `notifications` (déclaré : `notifications (alert-engine écrit incidents — SQL inline)`)
- `incident-management` → `dashboard` (déclaré : `dashboard`)
- `inventory` → `catalog` (déclaré : `catalog (produit concerne)`)
- `logistics` → `customs` (déclaré : `customs (statut declaration)`)
- `logistics` → `economic-engine` (déclaré : `economic-engine`)
- `logistics` → `wallet` (déclaré : `wallet`)
- `loyalty` → `auth-identity` (déclaré : `auth-identity (identification du client)`)
- `loyalty` → `wallet` (déclaré : `wallet (aucune écriture — v_loyalty_summary et le calcul de palier ne lisent pas les tables wallet)`)
- `notifications` → `orders` (déclaré : `orders`)
- `notifications` → `payments` (déclaré : `payments`)
- `notifications` → `shared-cart` (déclaré : `shared-cart`)
- `notifications` → `refunds` (déclaré : `refunds`)
- `orders` → `purchasing` (déclaré : `purchasing (lecture — engagement fournisseur déclenché par une commande ; scindée d'orders au Lot O1.4)`)
- `orders` → `dashboard` (déclaré : `dashboard`)
- `recommendations` → `auth` (déclaré : `auth`)
- `recommendations` → `logistics` (déclaré : `logistics`)
- `refunds` → `shared-cart` (déclaré : `shared-cart (panier source)`)
- `unsold-resolution` → `orders` (déclaré : `orders (commande source de l'invendu)`)
- `unsold-resolution` → `catalog` (déclaré : `catalog (produit concerné)`)

### Transversal topology (consumer = local-manifest frontend-transversal, hors ontology gap)

- `boutique-manifest:boutique` → orders (static-code), platform-ops (static-code), shared-cart (static-code)

### Local-manifest dependencies without canonical consumer (ontology gap, KNOWN_DEBT)

- none

### Ambiguous owners / providers (jamais collapsés arbitrairement)

- none

### Interface consumer unresolved (canal D)

- none

### Dynamic dependencies non résolues statiquement (limitation du modèle, jamais inventées)

- scope `backend` : 16 appel(s) — ex. `tests/unit/modal-mobile-canonical.test.js`: `CSS_BUNDLES_PATH`, `scripts/boutique-ownership-full-check.js`: `path.join(abs, f`, `scripts/contract-generate.js`: `...`
- scope `boutique` : 1 appel(s) — ex. `public/boutique/tests/unit/modal-cart-sku-guard.test.js`: `bundleConfigPath`

## O6 — Dependency Disposition

> Couche de qualification/décision au-dessus des paires O5 `OBSERVED_UNDECLARED`. O6 classifie et gouverne la dette ; **O6 ne remédie pas** encore les coutures cross-feature. Détail par paire : `docs/O6_INVENTORY.md`. Enforcement : `npm run business-graph:disposition-check`.

Composition-root owners (dérivés de l'ownership des fichiers wiring, pas du nom) : `infrastructure`, `platform-ops`.

### Summary by family

| Family | N | Policy |
|---|---|---|
| PROJECTION | 10 | projection-dependency-policy |
| COMPOSITION_ROOT_WIRING | 11 | application-wiring-not-consumption |
| NON_RUNTIME_TEST | 9 | non-runtime-evidence |
| TECHNICAL_PRIMITIVE | 31 | technical-dependency-policy |
| BUSINESS_TRANSVERSAL_SERVICE | 0 | business-dependency-declare-candidate |
| CROSS_FEATURE_DIRECT_IMPORT | 0 | boundary-remediation-required |
| BUSINESS_FEATURE_INTERFACE | 0 | business-dependency-declare-candidate |
| PILOTING_CAPABILITY | 0 | piloting-capability-dependency |
| UNCLASSIFIED | 0 | _(bloquant si > 0)_ |
| **TOTAL** | **61** | |

### Projection dependencies

Vues Dash → endpoint backend. Jamais dans un `contract.consumes` backend.

- `admin-dashboard` → `catalog` — interface, RUNTIME_ONLY
- `admin-dashboard` → `customs` — interface, RUNTIME_ONLY
- `admin-dashboard` → `dashboard` — interface, RUNTIME_ONLY
- `admin-dashboard` → `decision-signals` — interface, RUNTIME_ONLY
- `admin-dashboard` → `documents` — interface, RUNTIME_ONLY
- `admin-dashboard` → `economic-engine` — interface, RUNTIME_ONLY
- `admin-dashboard` → `inventory` — interface, RUNTIME_ONLY
- `admin-dashboard` → `logistics` — interface, RUNTIME_ONLY
- `admin-dashboard` → `orders` — interface, RUNTIME_ONLY
- `admin-dashboard` → `payments` — interface, RUNTIME_ONLY

### Composition root wiring

Bootstrap/cron/error-handler qui montent ou déclenchent une feature. Pas une consommation de service.

- `infrastructure` → `auth-identity` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `business-rules` — import-mixed, RUNTIME_ONLY
- `infrastructure` → `decision-signals` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `documents` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `loyalty` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `purchasing` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `sourcing` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `unsold-resolution` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `notifications` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `recommendations` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `shared-cart` — business-file-import, RUNTIME_AND_TEST

### Non-runtime test evidence

Preuves 100 % tests/. Visible mais hors dette de contrat runtime.

- `auth-identity` → `logistics` — business-file-import, TEST_ONLY
- `auth` → `auth-identity` — business-file-import, TEST_ONLY
- `catalog` → `orders` — business-file-import, TEST_ONLY
- `inventory` → `logistics` — business-file-import, TEST_ONLY
- `inventory` → `orders` — business-file-import, TEST_ONLY
- `inventory` → `payments` — business-file-import, TEST_ONLY
- `orders` → `shared-cart` — business-file-import, TEST_ONLY
- `platform-ops` → `payments` — business-file-import, TEST_ONLY
- `refunds` → `payments` — business-file-import, TEST_ONLY

### Technical primitives

Usage de db.js / middleware / logger / utils / validators d'un transversal technique. Politique technique, pas `contract.consumes`.

- `auth-identity` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `auth-identity` → `platform-ops` — business-file-import, RUNTIME_AND_TEST
- `auth` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `catalog` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `catalog` → `platform-ops` — business-file-import, RUNTIME_AND_TEST
- `customs` → `infrastructure` — technical-primitive, RUNTIME_ONLY
- `dashboard` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `decision-signals` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `documents` → `auth` — technical-primitive, RUNTIME_ONLY
- `documents` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `economic-engine` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `incident-management` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `inventory` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `logistics` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `loyalty` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `notifications` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `notifications` → `platform-ops` — business-file-import, RUNTIME_ONLY
- `orders` → `infrastructure` — mixed, RUNTIME_AND_TEST
- `orders` → `platform-ops` — business-file-import, RUNTIME_AND_TEST
- `payments` → `infrastructure` — mixed, RUNTIME_AND_TEST
- `platform-ops` → `infrastructure` — mixed, RUNTIME_AND_TEST
- `purchasing` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `recommendations` → `infrastructure` — technical-primitive, RUNTIME_ONLY
- `recommendations` → `platform-ops` — business-file-import, RUNTIME_ONLY
- `refunds` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `shared-cart` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `shared-cart` → `platform-ops` — business-file-import, RUNTIME_AND_TEST
- `sourcing` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `unsold-resolution` → `infrastructure` — technical-primitive, RUNTIME_ONLY
- `wallet` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `wallet` → `platform-ops` — business-file-import, RUNTIME_AND_TEST

### Business transversal services

Consommation réelle d'un service transversal métier — candidat `contract.consumes` (internal API préférée).

- _none_

### Cross-feature direct imports

require() direct d'un fichier d'une autre business-feature — couture à casser AVANT déclaration.

- _none_

### Business feature interfaces

Consommation d'une business-feature via interface/http — candidat `contract.consumes`.

- _none_

### Piloting capability dependencies

Consommation de decision-signals (capacité de pilotage).

- _none_

### Exceptions requiring human decision

Ledger `governance/feature-dependency-exceptions.json` — uniquement les paires dont la politique de famille ne suffit pas (imports directs, cycles, ownership suspects). Une entrée dont la paire disparaît d'O5 devient stale (bloquant).

- _none_

### Runtime cycles

Cycles runtime réels (après exclusion test-only + composition-root). Chaque direction porte une décision dans le ledger.

- _none_

### Ontology gap coverage (flux local-manifest séparé, hors paires)

`tracking` et consorts vivent dans `model.o5.localManifestDependenciesWithoutCanonicalConsumer`, pas dans les paires `from → to`. Couverture par le registre ontologique autoritaire.

- _none_

### Unclassified dependencies

- _none_ (gate vert)

