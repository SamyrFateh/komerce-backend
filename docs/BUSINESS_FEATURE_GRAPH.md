# Business Feature Graph — Komerce (Lot O3)

> Généré par `scripts/business-graph-gen.js`. Ne pas éditer à la main.
> Source d'autorité : FEATURE_DOCTRINE > APP_FEATURE_REGISTRY > features/*.feature.js > ce document.
> Vérifié par `node scripts/business-graph-gen.js --check` (`npm run business-graph:check`).

## Feature Map

### Business features

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

- `dashboard`
- `documents`
- `incident-management`
- `notifications`
- `refunds`

### Technical transversals

- `auth`
- `auth-identity`
- `infrastructure`
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
| backend | 24 | 24 | 295 | 295 | 0 |
| dash | 3 | 3 | N/A | N/A | N/A |
| boutique | 10 | 10 | 67 | 67 | 0 |

_dash_ : pas de Technical Architecture Graph propre au dépôt dash dans ce pipeline — non scanné par arch:gen backend, couverture non mesurable ici (SCOPE, pas un gap)

### Identités canoniques

- **Cross-repo features** (6) : `auth-identity`, `catalog`, `payments`, `recommendations`, `shared-cart`, `wallet`
- **Single-repo features** (22) : `admin-dashboard`, `auth`, `customs`, `dashboard`, `decision-signals`, `documents`, `economic-engine`, `incident-management`, `infrastructure`, `inventory`, `legacy-control-tower`, `logistics`, `loyalty`, `notifications`, `orders`, `platform`, `platform-ops`, `purchasing`, `refunds`, `sourcing`, `unsold-resolution`, `wallet-loyalty`
- **Unmapped local manifests** (0) : —

### Ontology gaps

- **checkout-orders-boutique-coverage** (manifest boutique `checkout`)
  - constat : boutique/features/checkout.feature.js décrit un service quasi identique à backend:orders ("tunnel de commande, du panier valide à la confirmation") et son perimeter.out cite 'orders' — mais backend:orders.files.boutique est vide (0 fichier revendiqué), alors que backend:payments.files.boutique revendique factuellement b-checkout.js + b-checkout-render.js.
  - décision actuelle : canonicalFeature fixé à 'payments' (preuve fichier, priorité 1 de la mission O4 §6), sliceKind 'ui-orchestration' — pas 'frontend-slice' pur, car ce manifeste orchestre la soumission de commande ET la sélection du moyen de paiement sans être l'implémentation exclusive de l'un ou l'autre.
  - question ouverte : backend:orders devrait-il revendiquer explicitement une part de b-checkout.js (rendu récapitulatif / soumission commande), avec backend:payments ne gardant que la partie encaissement (b-paypal.js) ? Décision produit non tranchée par O4 — cf. mission §3 "si le cas est E, ne crée pas silencieusement, signale l'ONTOLOGY GAP".
- **tracking-no-canonical-owner** (manifest boutique `tracking`)
  - constat : boutique/features/tracking.feature.js décrit un service d'analytics/tracking événementiel UI (suivi parcours, événements). Aucune feature backend ou dash canonique ne représente ce service : vérifié explicitement contre logistics (tracking colis physique — identité métier différente malgré le nom proche), infrastructure (middlewares/bootstrap transverses), notifications (émission de messages sortants, pas de collecte d'événements) et platform-ops (santé applicative). C'est un cas E pur (mission O4 §3) : véritable ONTOLOGY GAP, pas une erreur de nommage à corriger par une fusion.
  - décision actuelle : canonicalFeature reste null. sliceKind fixé à 'frontend-transversal' à titre PROVISOIRE — seule valeur du enum ALLOWED_SLICE_KINDS permettant d'éviter que ce manifeste retombe en BOUTIQUE-MANIFEST-UNGOVERNED, sans pour autant inventer une business feature. Ce n'est pas un vrai transversal multi-feature comme le manifeste `boutique` générique ou `platform` côté dash — c'est un classement de repli documenté.
  - question ouverte : Faut-il créer une feature 'analytics' dédiée côté backend/dash (si un service de collecte équivalent existe ou est prévu côté serveur), ou rattacher ce manifeste à une feature existante par proximité fonctionnelle (ex. platform-ops) ? Décision produit non tranchée par O4.

## Feature → implémentation

### admin-dashboard _(projection)_

> Tableau de bord admin SPA multi-vues.

- js: 42
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 0
- consumers: 0

### auth _(technical-transversal)_

> Fournir les gardes transverses d'authentification et de vérification d'identité (middlewares JWT/session/rôles) consommées par toutes les autres features.

- middleware: 6
- migrations: 2
- tests: 8
- tables owned (lifecycle): 0
- tables written: 1
- interfaces exposed: 0
- internal APIs: 3
- dependencies (consumes): 3 — notification, operations, orders
- consumers: 14 — catalog, customs, dashboard, documents, economic-engine, infrastructure, inventory, logistics, orders, purchasing, recommendations, shared-cart, sourcing, unsold-resolution

### auth-identity _(technical-transversal)_

> Authentifier un utilisateur et gérer son identité active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposées.

- services: 2
- routes: 3
- boutique: 3
- tests: 5
- tables owned (lifecycle): 1 — `otp_codes`
- tables written: 3
- interfaces exposed: 20
- internal APIs: 0
- dependencies (consumes): 0
- consumers: 3 — loyalty, payments, wallet

### catalog _(business-feature)_

> Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.

- utils: 1
- services: 17
- migrations: 4
- docs: 3
- routes: 4
- boutique: 32
- dash: 4
- tests: 24
- tables owned (lifecycle): 6 — `boutique_categories`, `boutique_subcategories`, `catalog_field_overrides`, `catalog_enrichment_runs`, `product_skus`, `supplier_catalog_imports`
- tables written: 12
- interfaces exposed: 30
- internal APIs: 0
- dependencies (consumes): 4 — economic-engine, logistics, shared-cart, auth
- consumers: 8 — economic-engine, infrastructure, inventory, logistics, orders, recommendations, sourcing, unsold-resolution

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
- consumers: 6 — dashboard, documents, infrastructure, logistics, orders, shared-cart

### dashboard _(business-transversal)_

> Exposer en lecture agrégée les données opérationnelles et financières pour le contrôle total de la plateforme via les dashboards admin (Control Tower, Pilotage, Santé, Clients, Hub, Relais).

- services: 11
- routes: 17
- migrations: 1
- dash: 80
- tests: 33
- tables owned (lifecycle): 2 — `order_incidents`, `partners`
- tables written: 22
- interfaces exposed: 70
- internal APIs: 0
- dependencies (consumes): 10 — orders, payments, logistics, inventory, economic-engine, wallet, auth, customs, documents, recommendations
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
- dependencies (consumes): 0
- consumers: 0

### documents _(business-transversal)_

> Generer un document officiel (preuve de retrait, facture douane, reçu wallet, reçu remboursement) a partir d'un evenement metier confirme.

- services: 5
- routes: 1
- migrations: 5
- utils: 5
- tests: 10
- tables owned (lifecycle): 1 — `transaction_documents`
- tables written: 1
- interfaces exposed: 3
- internal APIs: 0
- dependencies (consumes): 5 — orders, customs, wallet, refunds, auth
- consumers: 5 — customs, dashboard, orders, refunds, shared-cart

### economic-engine _(business-feature)_

> Calculer le prix, le cout et la marge d'un produit ou d'une commande selon une strategie tarifaire versionnee.

- utils: 2
- services: 24
- routes: 12
- migrations: 18
- dash: 6
- tests: 45
- tables owned (lifecycle): 13 — `exchange_rates`, `competitor_prices`, `cost_benchmarks`, `cost_component_events`, `cost_components`, `economic_variables`, `pricing_category_dims`, `pricing_category_taxes`, `pricing_components`, `pricing_matrices_audit`, `pricing_strategies`, `pricing_strategy_history`, `risk_provisions`
- tables written: 20
- interfaces exposed: 73
- internal APIs: 0
- dependencies (consumes): 5 — catalog, auth, dashboard, orders, wallet
- consumers: 7 — catalog, customs, dashboard, infrastructure, logistics, orders, sourcing

### incident-management _(business-transversal)_

> Détecter, qualifier et résoudre les écarts entre l'état attendu et l'état réel d'une opération, avec impact client traçable.

- services: 1
- tests: 1
- tables owned (lifecycle): 0
- tables written: 1
- interfaces exposed: 0
- internal APIs: 5
- dependencies (consumes): 5 — logistics, payments, notifications, dashboard, ops-api legacy
- consumers: 0

### infrastructure _(technical-transversal)_

> Infrastructure transversale consommée par toutes les features : middleware non-auth (error-handler, rate-limit, request-id, upload, validate), utilitaires partagés (logger, phone, rates, reference, rules), barrel de validation Joi, et bootstrap applicatif (Express, routes, crons, env, sécurité, migrations startup).

- middleware: 5
- utils: 6
- validators: 1
- bootstrap: 8
- migrations: 6
- scripts: 85
- docs: 167
- ci: 25
- assets: 37
- db: 16
- config: 11
- tests: 19
- tables owned (lifecycle): 3 — `business_rules`, `business_rules_history`, `schema_migrations`
- tables written: 10
- interfaces exposed: 5
- internal APIs: 12
- dependencies (consumes): 14 — auth, catalog, customs, dashboard, economic-engine, inventory, logistics, notification, operations, orders, payment, recommendations, shared-cart, wallet
- consumers: 0

### inventory _(business-feature)_

> Réceptionner, affecter et dispatcher les articles au hub.

- services: 1
- routes: 1
- dash: 1
- tests: 3
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
- tables owned (lifecycle): 4 — `carriers`, `parcel_events`, `pickup_verify_attempts`, `shipments`
- tables written: 15
- interfaces exposed: 68
- internal APIs: 0
- dependencies (consumes): 9 — orders, customs, auth, catalog, economic-engine, notification, payment, refunds, wallet
- consumers: 8 — catalog, customs, dashboard, incident-management, infrastructure, orders, recommendations, shared-cart

### loyalty _(business-feature)_

> Calculer et maintenir le statut de fidelite d'un client (palier + compteur gros panier) et ses recompenses.

- services: 1
- routes: 1
- tests: 3
- tables owned (lifecycle): 3 — `users`, `loyalty_tiers`, `loyalty_rewards`
- tables written: 3
- interfaces exposed: 7
- internal APIs: 0
- dependencies (consumes): 2 — auth-identity, wallet
- consumers: 0

### notifications _(business-transversal)_

> Emettre une alerte ou un message sortant (WhatsApp, notification interne) declenche par une autre feature.

- tests: 15
- migrations: 5
- utils: 1
- services: 10
- routes: 3
- tables owned (lifecycle): 0
- tables written: 3
- interfaces exposed: 4
- internal APIs: 5
- dependencies (consumes): 1 — toutes les features emettrices
- consumers: 1 — incident-management

### orders _(business-feature)_

> Faire exister une commande, de la creation au statut final, avec un cout figure et une reference lisible.

- utils: 1
- services: 9
- routes: 13
- tests: 26
- tables owned (lifecycle): 3 — `order_item_cost_imputations`, `customs_history`, `disputes`
- tables written: 14
- interfaces exposed: 33
- internal APIs: 0
- dependencies (consumes): 12 — wallet, economic-engine, logistics, catalog, purchasing, auth, customs, dashboard, documents, notification, payment, refunds
- consumers: 11 — auth, dashboard, documents, economic-engine, infrastructure, logistics, payments, purchasing, refunds, shared-cart, unsold-resolution

### payments _(business-feature)_

> Encaisser un paiement (carte, PayPal, especes au retrait) et confirmer son etat de facon idempotente.

- services: 11
- routes: 4
- migrations: 1
- boutique: 4
- tests: 17
- tables owned (lifecycle): 3 — `cash_collections`, `cash_deposits`, `paypal_events_processed`
- tables written: 8
- interfaces exposed: 18
- internal APIs: 0
- dependencies (consumes): 2 — orders, auth-identity
- consumers: 2 — dashboard, incident-management

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

- services: 6
- routes: 5
- boutique: 7
- tests: 20
- tables owned (lifecycle): 6 — `parcels`, `parcel_items`, `scans`, `fabrics`, `garment_models`, `store_credits`
- tables written: 8
- interfaces exposed: 33
- internal APIs: 0
- dependencies (consumes): 0
- consumers: 0

### purchasing _(business-feature)_

> Transformer un besoin d'approvisionnement issu d'une commande en engagement fournisseur traçable (bon de commande), puis constater sa réception.

- services: 6
- routes: 1
- tests: 8
- tables owned (lifecycle): 3 — `product_suppliers`, `purchase_orders`, `suppliers`
- tables written: 5
- interfaces exposed: 10
- internal APIs: 0
- dependencies (consumes): 3 — orders, auth, notification
- consumers: 1 — orders

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
- consumers: 2 — dashboard, infrastructure

### refunds _(business-transversal)_

> Rembourser un client (wallet, cash, panier partage) de facon tracable et sans double remboursement.

- utils: 1
- services: 1
- tests: 3
- tables owned (lifecycle): 1 — `refunds`
- tables written: 1
- interfaces exposed: 0
- internal APIs: 1
- dependencies (consumes): 4 — orders, shared-cart, wallet, documents
- consumers: 3 — documents, logistics, orders

### shared-cart _(business-feature)_

> Permettre à plusieurs participants de composer et financer un panier commun, de la création à la commande finale.

- services: 27
- routes: 8
- migrations: 14
- tests: 41
- boutique: 14
- dash: 2
- tables owned (lifecycle): 19 — `order_items`, `basket_items`, `baskets`, `collective_payment_sessions`, `collective_workspace_contributions`, `collective_workspace_items`, `collective_workspaces`, `recipients`, `cart_shares`, `stripe_events_processed`, `cart_contributions`, `collective_payment_tokens`, `collective_stock_reservations`, `collective_workspace_events`, `shared_cart_contributions`, `shared_cart_estimations`, `shared_cart_events`, `shared_cart_items`, `shared_carts`
- tables written: 21
- interfaces exposed: 33
- internal APIs: 0
- dependencies (consumes): 8 — orders, wallet, products, notification, auth, customs, documents, logistics
- consumers: 3 — catalog, infrastructure, refunds

### sourcing _(business-feature)_

> Identifier, qualifier et arbitrer des opportunités fournisseur ou produit (scan pricing, décision garder/watchlist/rejeter) avant leur entrée dans le catalogue.

- migrations: 4
- routes: 1
- tests: 1
- tables owned (lifecycle): 0
- tables written: 3
- interfaces exposed: 11
- internal APIs: 0
- dependencies (consumes): 3 — catalog, economic-engine, auth
- consumers: 0

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
- tables owned (lifecycle): 4 — `wallet_transactions`, `wallets`, `wallet_credit_lots`, `wallet_consumptions`
- tables written: 5
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 1 — auth-identity
- consumers: 9 — dashboard, documents, economic-engine, infrastructure, logistics, loyalty, orders, refunds, shared-cart

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
| `alerts` | _ambiguë_ | ambiguous-multi-writer | catalog, logistics, notifications, orders, payments, purchasing, shared-cart | — |
| `basket_items` | `shared-cart` | multi-writer-resolved-by-classification-signal | dashboard, shared-cart | — |
| `baskets` | `shared-cart` | multi-writer-resolved-by-classification-signal | dashboard, shared-cart | — |
| `boutique_categories` | `catalog` | single-writer | catalog | — |
| `boutique_subcategories` | `catalog` | single-writer | catalog | — |
| `business_rules` | `infrastructure` | single-writer | infrastructure | dashboard, economic-engine, logistics |
| `business_rules_history` | `infrastructure` | single-writer | infrastructure | dashboard |
| `carriers` | `logistics` | single-writer | logistics | — |
| `cart_contributions` | `shared-cart` | single-writer | shared-cart | — |
| `cart_shares` | `shared-cart` | multi-writer-resolved-by-classification-signal | orders, shared-cart | — |
| `cash_collections` | `payments` | single-writer | payments | — |
| `cash_deposits` | `payments` | single-writer | payments | — |
| `catalog_enrichment_runs` | `catalog` | single-writer | catalog | — |
| `catalog_exclusions` | _ambiguë_ | no-declared-writer | — | catalog |
| `catalog_field_overrides` | `catalog` | single-writer | catalog | — |
| `catalog_glossary` | _ambiguë_ | no-declared-writer | — | catalog |
| `charges` | _ambiguë_ | ambiguous-multi-writer | economic-engine, infrastructure | — |
| `collective_payment_sessions` | `shared-cart` | single-writer | shared-cart | dashboard |
| `collective_payment_tokens` | `shared-cart` | single-writer | shared-cart | — |
| `collective_stock_reservations` | `shared-cart` | single-writer | shared-cart | — |
| `collective_workspace_contributions` | `shared-cart` | single-writer | shared-cart | dashboard |
| `collective_workspace_events` | `shared-cart` | single-writer | shared-cart | — |
| `collective_workspace_items` | `shared-cart` | single-writer | shared-cart | dashboard |
| `collective_workspaces` | `shared-cart` | single-writer | shared-cart | dashboard |
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
| `economic_snapshots` | _ambiguë_ | ambiguous-multi-writer | economic-engine, infrastructure | — |
| `economic_variables` | `economic-engine` | single-writer | economic-engine | — |
| `exchange_rates` | `economic-engine` | single-writer | economic-engine | dashboard |
| `fabrics` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `finance_config` | _ambiguë_ | ambiguous-multi-writer | economic-engine, infrastructure | loyalty, shared-cart |
| `garment_models` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `incidents` | _ambiguë_ | ambiguous-multi-writer | dashboard, incident-management, logistics, notifications, payments | platform-ops |
| `inventory_items` | `inventory` | single-writer | inventory | — |
| `invoices` | _ambiguë_ | ambiguous-multi-writer | dashboard, orders | auth-identity, documents, logistics, platform-ops |
| `loyalty_rewards` | `loyalty` | multi-writer-resolved-by-classification-signal | dashboard, loyalty | — |
| `loyalty_tiers` | `loyalty` | single-writer | loyalty | auth-identity |
| `notification_log` | _ambiguë_ | ambiguous-multi-writer | notifications, platform-ops | — |
| `order_comments` | _ambiguë_ | ambiguous-multi-writer | dashboard, orders | — |
| `order_incidents` | `dashboard` | single-writer | dashboard | — |
| `order_item_cost_imputations` | `orders` | single-writer | orders | dashboard, economic-engine |
| `order_item_real_cost_allocations` | _ambiguë_ | ambiguous-multi-writer | customs, economic-engine | dashboard |
| `order_items` | `shared-cart` | multi-writer-resolved-by-classification-signal | dashboard, logistics, orders, shared-cart | auth-identity, catalog, customs, documents, economic-engine, inventory, payments, platform-ops, purchasing, recommendations |
| `order_status_history` | _ambiguë_ | ambiguous-multi-writer | dashboard, orders | — |
| `orders` | _ambiguë_ | ambiguous-multi-writer | customs, dashboard, inventory, logistics, orders, payments, platform-ops, purchasing, shared-cart, wallet | auth-identity, catalog, documents, economic-engine, incident-management, loyalty, notifications, recommendations, refunds, unsold-resolution |
| `otp_codes` | `auth-identity` | single-writer | auth-identity | — |
| `parcel_events` | `logistics` | single-writer | logistics | — |
| `parcel_items` | `platform-ops` | multi-writer-resolved-by-classification-signal | dashboard, inventory, logistics, platform-ops | customs, documents, economic-engine, orders, payments |
| `parcels` | `platform-ops` | multi-writer-resolved-by-classification-signal | customs, dashboard, logistics, payments, platform-ops | auth-identity, documents, economic-engine, incident-management, inventory, notifications, orders, recommendations |
| `partners` | `dashboard` | single-writer | dashboard | — |
| `paypal_events_processed` | `payments` | single-writer | payments | — |
| `pickup_print_tokens` | _ambiguë_ | ambiguous-multi-writer | infrastructure, logistics | — |
| `pickup_reveal_codes` | _ambiguë_ | ambiguous-multi-writer | infrastructure, logistics | — |
| `pickup_verify_attempts` | `logistics` | single-writer | logistics | — |
| `price_history` | _ambiguë_ | ambiguous-multi-writer | catalog, economic-engine | — |
| `pricing_benchmarks` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `pricing_category_dims` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_category_taxes` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_components` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_matrices_audit` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_strategies` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_strategy_history` | `economic-engine` | single-writer | economic-engine | — |
| `product_skus` | `catalog` | single-writer | catalog | — |
| `product_suppliers` | `purchasing` | single-writer | purchasing | logistics |
| `product_variants` | _ambiguë_ | ambiguous-multi-writer | catalog, economic-engine | logistics, orders |
| `products` | _ambiguë_ | ambiguous-multi-writer | catalog, dashboard, economic-engine, sourcing | auth-identity, customs, documents, inventory, logistics, orders, platform-ops, purchasing, recommendations, shared-cart, unsold-resolution |
| `purchase_orders` | `purchasing` | multi-writer-resolved-by-classification-signal | orders, purchasing | logistics |
| `recipients` | `shared-cart` | multi-writer-resolved-by-classification-signal | dashboard, orders, shared-cart | documents, economic-engine, logistics, notifications |
| `refunds` | `refunds` | single-writer | refunds | documents, economic-engine, orders |
| `relais` | _ambiguë_ | ambiguous-multi-writer | dashboard, logistics | auth-identity, documents, economic-engine, notifications, orders, platform-ops, purchasing, shared-cart |
| `revoked_tokens` | _ambiguë_ | ambiguous-multi-writer | auth-identity, infrastructure | auth |
| `risk_provisions` | `economic-engine` | single-writer | economic-engine | — |
| `scan_events` | _ambiguë_ | ambiguous-multi-writer | dashboard, logistics | incident-management, notifications, payments, platform-ops |
| `scans` | `platform-ops` | multi-writer-resolved-by-classification-signal | dashboard, logistics, orders, platform-ops | — |
| `schema_migrations` | `infrastructure` | single-writer | infrastructure | — |
| `shared_cart_contributions` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_estimations` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_events` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_items` | `shared-cart` | single-writer | shared-cart | — |
| `shared_carts` | `shared-cart` | single-writer | shared-cart | — |
| `shipments` | `logistics` | single-writer | logistics | — |
| `signals` | `decision-signals` | single-writer | decision-signals | dashboard |
| `sms_log` | _ambiguë_ | ambiguous-multi-writer | dashboard, orders | — |
| `sourcing_candidate_events` | _ambiguë_ | ambiguous-multi-writer | catalog, sourcing | — |
| `sourcing_candidates` | _ambiguë_ | ambiguous-multi-writer | catalog, sourcing | — |
| `store_credits` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `stripe_events_processed` | `shared-cart` | multi-writer-resolved-by-classification-signal | payments, shared-cart | — |
| `supplier_catalog_imports` | `catalog` | single-writer | catalog | sourcing |
| `suppliers` | `purchasing` | single-writer | purchasing | — |
| `suppliers_stats` | _ambiguë_ | no-declared-writer | — | dashboard |
| `transaction_documents` | `documents` | single-writer | documents | — |
| `unsold_items` | `unsold-resolution` | single-writer | unsold-resolution | — |
| `users` | `loyalty` | multi-writer-resolved-by-classification-signal | auth, auth-identity, dashboard, infrastructure, loyalty | documents, economic-engine, logistics, notifications, orders, payments, platform-ops, shared-cart, wallet |
| `v_loyalty_summary` | _ambiguë_ | no-declared-writer | — | loyalty |
| `v_unsold_pipeline` | _ambiguë_ | no-declared-writer | — | unsold-resolution |
| `wallet_consumptions` | `wallet` | single-writer | wallet | — |
| `wallet_credit_lots` | `wallet` | single-writer | wallet | documents |
| `wallet_transactions` | `wallet` | multi-writer-resolved-by-classification-signal | dashboard, wallet | documents |
| `wallets` | `wallet` | multi-writer-resolved-by-classification-signal | dashboard, wallet | refunds |

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
| `GET /api/auth/invoices` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/login` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/logout` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/magic-link` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/auth/magic-link/validate` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/auth/me` | auth-identity | `routes/auth.js` (resolved-owned) |
| `PUT /api/auth/me` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/auth/orders` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/orders-by-phone` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/register` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/client/invoices` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `POST /api/client/magic-link` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/client/magic-link/validate` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/client/orders` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/products` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/{id}` | catalog | `routes/products.js` (resolved-owned) |
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
| `GET /api/products/{id}/skus` | catalog | — (not-in-openapi-contract) |
| `GET /api/products/{id}/skus/readiness` | catalog | — (not-in-openapi-contract) |
| `POST /api/products/{id}/skus` | catalog | — (not-in-openapi-contract) |
| `DELETE /api/products/{id}/skus/{id}` | catalog | — (not-in-openapi-contract) |
| `GET /api/products/categories` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/products/subcategories` | catalog | `routes/products.js` (resolved-owned) |
| `GET /api/admin/customs-shipments` | customs | `routes/admin-customs-shipments.js` (resolved-owned) |
| `GET /api/admin/customs` | customs | `routes/admin.js` (resolved-different-owner) |
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
| `GET /api/admin/dashboard` | dashboard | `routes/admin-dashboard.js` (resolved-owned) |
| `GET /api/dashboard/clients` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/ops` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/hub` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/hub-dash/dashboard` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `GET /api/relay/dashboard` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `GET /api/admin/radar` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/rules` | dashboard | `routes/admin-rules.js` (resolved-owned) |
| `GET /api/admin/loyalty/pending` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `GET /api/admin/partners` | dashboard | `routes/admin.js` (resolved-owned) |
| `GET /api/admin/users` | dashboard | `routes/admin.js` (resolved-owned) |
| `GET /api/admin/counts` | dashboard | `routes/admin.js` (resolved-owned) |
| `POST /api/admin/reset` | dashboard | `routes/admin.js` (resolved-owned) |
| `POST /api/admin/seed-test` | dashboard | `routes/admin.js` (resolved-owned) |
| `POST /api/admin/purchasing/repair-ordered-without-pos` | dashboard | `routes/admin.js` (resolved-owned) |
| `GET /api/admin/alerts` | dashboard | `routes/admin.js` (resolved-owned) |
| `GET /api/admin/loyalty/history` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `POST /api/admin/loyalty/reward/{id}` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `POST /api/admin/loyalty/skip/{id}` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `GET /api/admin/loyalty/stats` | dashboard | `routes/admin-loyalty.js` (resolved-owned) |
| `GET /api/admin/margins` | dashboard | `routes/admin.js` (resolved-owned) |
| `POST /api/admin/partners` | dashboard | `routes/admin.js` (resolved-owned) |
| `DELETE /api/admin/partners/{id}` | dashboard | `routes/admin.js` (resolved-owned) |
| `GET /api/admin/partners/{id}` | dashboard | `routes/admin.js` (resolved-owned) |
| `PUT /api/admin/partners/{id}` | dashboard | `routes/admin.js` (resolved-owned) |
| `GET /api/admin/partners/stats` | dashboard | `routes/admin.js` (resolved-owned) |
| `GET /api/admin/radar/alerts` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `POST /api/admin/radar/cache/invalidate` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/radar/money` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/radar/orders-by-detail/{id}` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/radar/status-details` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/rules/{id}` | dashboard | `routes/admin-rules.js` (resolved-owned) |
| `PATCH /api/admin/rules/{id}` | dashboard | `routes/admin-rules.js` (resolved-owned) |
| `POST /api/admin/rules/{id}/reset` | dashboard | `routes/admin-rules.js` (resolved-owned) |
| `GET /api/admin/rules/audit` | dashboard | `routes/admin-rules.js` (resolved-owned) |
| `POST /api/admin/users` | dashboard | `routes/admin.js` (resolved-owned) |
| `DELETE /api/admin/users/{id}` | dashboard | `routes/admin.js` (resolved-owned) |
| `PUT /api/admin/users/{id}/password` | dashboard | `routes/admin.js` (resolved-owned) |
| `PUT /api/admin/users/{id}/role` | dashboard | `routes/admin.js` (resolved-owned) |
| `GET /api/dashboard/clients/detail` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/clients/list` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/forecast` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/global` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/history` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/hub-dubai` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/pilotage` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/pipeline` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/relais` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/retards` | dashboard | `routes/dashboard.js` (resolved-owned) |
| `GET /api/dashboard/stats` | dashboard | `routes/dashboard.js` (resolved-owned) |
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
| `GET /api/admin/documents` | documents | `routes/admin.js` (resolved-different-owner) |
| `GET /api/admin/documents/summary` | documents | `routes/admin.js` (resolved-different-owner) |
| `GET /api/admin/documents/{id}` | documents | `routes/admin.js` (resolved-different-owner) |
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
| `GET /api/dashboard/annulations-parcels` | economic-engine | `routes/dashboard.js` (resolved-different-owner) |
| `GET /api/dashboard/finance` | economic-engine | `routes/dashboard.js` (resolved-different-owner) |
| `GET /api/dashboard/payments` | economic-engine | `routes/dashboard.js` (resolved-different-owner) |
| `GET /api/dashboard/sales` | economic-engine | `routes/dashboard.js` (resolved-different-owner) |
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
| `GET /api/health` | infrastructure | `routes/health.js` (resolved-different-owner) |
| `GET /api/public/config` | infrastructure | `routes/public.js` (resolved-different-owner) |
| `GET /webhook/authkey-whatsapp` | infrastructure | — (not-in-openapi-contract) |
| `POST /api/shared-carts/stripe/webhook` | infrastructure | `routes/shared-cart-cash.js` (resolved-different-owner) |
| `GET /*.html` | infrastructure | — (not-in-openapi-contract) |
| `GET /api/hub/inventory/buffer` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `GET /api/hub/inventory/open-parcels` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `GET /api/hub/inventory/order/{id}/dispatch` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `GET /api/hub/inventory/proposals` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `POST /api/hub/inventory/propose-all` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `POST /api/hub/inventory/receive` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `POST /api/hub/inventory/scan-assign` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `GET /api/hub/inventory/stats` | inventory | `routes/inventory-api.js` (resolved-owned) |
| `POST /api/v2/parcels/{id}/scan` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/tracking/{id}` | logistics | `routes/tracking.js` (resolved-owned) |
| `GET /api/carriers` | logistics | `routes/carriers.js` (resolved-owned) |
| `POST /api/carriers` | logistics | `routes/carriers.js` (resolved-owned) |
| `DELETE /api/carriers/{id}` | logistics | `routes/carriers.js` (resolved-owned) |
| `PATCH /api/carriers/{id}` | logistics | `routes/carriers.js` (resolved-owned) |
| `PATCH /api/carriers/customs/{id}` | logistics | `routes/carriers.js` (resolved-owned) |
| `GET /api/client/tracking` | logistics | `routes/client-tracking.js` (resolved-owned) |
| `GET /api/hub/auto-distribute` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/auto-distribute` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/auto-distribute/cleanup` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/batch-scan` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/pack` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/hub/pending` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/photo` | logistics | — (not-in-openapi-contract) |
| `POST /api/hub/scan` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/seal` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/hub/search` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/hub/stats/week` | logistics | `routes/hub.js` (resolved-owned) |
| `GET /api/hub/today` | logistics | `routes/hub.js` (resolved-owned) |
| `POST /api/hub/volume` | logistics | — (not-in-openapi-contract) |
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
| `GET /api/v2/parcels` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}/label` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/v2/parcels/{id}/timeline` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/v2/parcels/alerts` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/v2/parcels/critical` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/v2/parcels/kpis` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/v2/parcels/reconciliation` | logistics | `routes/parcel-api-v2.js` (resolved-owned) |
| `GET /api/loyalty/tiers` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `GET /api/loyalty/me` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `GET /api/loyalty/users` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `GET /api/loyalty/stats` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `PUT /api/loyalty/tiers/{id}` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `POST /api/loyalty/recalculate/{id}` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `POST /api/loyalty/recalculate-all` | loyalty | `routes/loyalty.js` (resolved-owned) |
| `GET /api/v2/notifications` | notifications | `routes/notification-api.js` (resolved-owned) |
| `GET /api/v2/notifications/stats` | notifications | `routes/notification-api.js` (resolved-owned) |
| `GET /webhook/meta-whatsapp` | notifications | `routes/meta-whatsapp.js` (resolved-owned) |
| `POST /webhook/meta-whatsapp` | notifications | `routes/meta-whatsapp.js` (resolved-owned) |
| `GET /api/orders/{id}` | orders | `routes/orders.js` (resolved-owned) |
| `POST /api/orders/{id}/cancel` | orders | `routes/orders.js` (resolved-owned) |
| `GET /api/invoices/public/{id}` | orders | `routes/invoices.js` (resolved-owned) |
| `GET /api/admin/orders` | orders | `routes/admin.js` (resolved-different-owner) |
| `DELETE /api/admin/orders/{id}` | orders | `routes/admin.js` (resolved-different-owner) |
| `POST /api/admin/orders/{id}/refund` | orders | `routes/admin.js` (resolved-different-owner) |
| `POST /api/hub/orders/mark-ordered` | orders | `routes/hub.js` (resolved-different-owner) |
| `GET /api/invoices` | orders | `routes/invoices.js` (resolved-owned) |
| `GET /api/invoices/{id}` | orders | `routes/invoices.js` (resolved-owned) |
| `POST /api/invoices/{id}/deliver` | orders | `routes/invoices.js` (resolved-owned) |
| `GET /api/invoices/{id}/download` | orders | `routes/invoices.js` (resolved-owned) |
| `GET /api/invoices/{id}/json` | orders | `routes/invoices.js` (resolved-owned) |
| `POST /api/orders/{id}/cancel-backorder` | orders | `routes/orders.js` (resolved-owned) |
| `PATCH /api/orders/{id}/cost` | orders | `routes/orders.js` (resolved-owned) |
| `GET /api/orders/{id}/history` | orders | `routes/orders.js` (resolved-owned) |
| `POST /api/orders/{id}/mark-availability` | orders | `routes/orders.js` (resolved-owned) |
| `GET /api/orders/{id}/parcels` | orders | `routes/orders.js` (resolved-owned) |
| `POST /api/orders/{id}/partial-ship` | orders | `routes/orders.js` (resolved-owned) |
| `POST /api/orders/{id}/qr-token` | orders | `routes/orders.js` (resolved-owned) |
| `PATCH /api/orders/{id}/status` | orders | `routes/orders.js` (resolved-owned) |
| `GET /api/orders/{id}/sub-orders` | orders | `routes/orders.js` (resolved-owned) |
| `GET /api/orders/credits` | orders | `routes/orders.js` (resolved-owned) |
| `PATCH /api/orders/parcels/{id}/status` | orders | `routes/orders.js` (resolved-owned) |
| `GET /api/orders/problems` | orders | `routes/orders.js` (resolved-owned) |
| `GET /api/orders/relais` | orders | `routes/orders.js` (resolved-owned) |
| `GET /api/orders/retrait/{id}` | orders | `routes/orders.js` (resolved-owned) |
| `PATCH /api/orders/sub-orders/{id}/status` | orders | `routes/orders.js` (resolved-owned) |
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
| `GET /health` | platform-ops | `routes/unknown.js` (resolved-different-owner) |
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
| `GET /api/v2/parcels/{id}/orders` | platform-ops | `routes/parcel-api-v2.js` (resolved-different-owner) |
| `GET /api/v2/parcels/{id}/scans` | platform-ops | `routes/parcel-api-v2.js` (resolved-different-owner) |
| `GET /api/v2/parcels/{id}/detail` | platform-ops | `routes/parcel-api-v2.js` (resolved-different-owner) |
| `GET /api/v2/reconciliation` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/reconciliation/summary` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /api/v2/scan-events` | platform-ops | `routes/ops-api.js` (resolved-owned) |
| `GET /health/detailed` | platform-ops | `routes/detailed.js` (resolved-different-owner) |
| `GET /health/metrics` | platform-ops | `routes/metrics.js` (resolved-different-owner) |
| `GET /health/ready` | platform-ops | `routes/ready.js` (resolved-different-owner) |
| `GET /health/version` | platform-ops | `routes/version.js` (resolved-different-owner) |
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
| `POST /api/shared-carts/from-cart-items` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/from-basket` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/from-order` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `GET /api/shared-carts/mine` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `GET /api/shared-carts/{id}` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `GET /api/shared-carts/{id}/as-cart-items` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `PUT /api/shared-carts/{id}/items` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/close` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/finalize` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/awaiting-choice/complete` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/awaiting-choice/adjust` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/awaiting-choice/cancel` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/extend-window` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/{id}/cancel` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `GET /api/shared-carts/public/{id}` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `GET /api/shared-carts/public/{id}/estimations` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/public/{id}/estimations` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `DELETE /api/shared-carts/public/{id}/estimations/{id}` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `GET /api/shared-carts/public/{id}/estimations/by-phone` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/public/{id}/contributions` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/public/{id}/contributions/cash` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `POST /api/shared-carts/contributions/{id}/confirm-cash` | shared-cart | `routes/shared-cart-cash.js` (resolved-owned) |
| `GET /api/admin/shared-carts` | shared-cart | `routes/shared-cart-refund-admin.js` (resolved-owned) |
| `GET /api/admin/shared-carts/refund-queue` | shared-cart | `routes/shared-cart-refund-admin.js` (resolved-owned) |
| `GET /api/admin/shared-carts/{id}` | shared-cart | `routes/shared-cart-refund-admin.js` (resolved-owned) |
| `POST /api/admin/shared-carts/{id}/expire` | shared-cart | `routes/shared-cart-refund-admin.js` (resolved-owned) |
| `POST /api/admin/shared-carts/{id}/extend` | shared-cart | `routes/shared-cart-refund-admin.js` (resolved-owned) |
| `POST /api/admin/shared-carts/{id}/note` | shared-cart | `routes/shared-cart-refund-admin.js` (resolved-owned) |
| `POST /api/admin/shared-carts/refund-queue/{id}/mark-refunded` | shared-cart | `routes/shared-cart-refund-admin.js` (resolved-owned) |
| `POST /api/shares` | shared-cart | `routes/shares.js` (resolved-owned) |
| `GET /api/shares/{id}` | shared-cart | `routes/shares.js` (resolved-owned) |
| `POST /api/shares/{id}/contributions` | shared-cart | `routes/shares.js` (resolved-owned) |
| `PATCH /api/shares/{id}/contributions/{id}` | shared-cart | `routes/shares.js` (resolved-owned) |
| `GET /api/admin/sourcing/connectors` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `POST /api/admin/sourcing/catalogs/import` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `GET /api/admin/sourcing/catalogs` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `GET /api/admin/sourcing/candidates` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `GET /api/admin/sourcing/candidates/{id}` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `PUT /api/admin/sourcing/candidates/{id}` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `POST /api/admin/sourcing/candidates/{id}/scan` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `POST /api/admin/sourcing/candidates/scan-batch` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `POST /api/admin/sourcing/candidates/{id}/import-product` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `POST /api/admin/sourcing/candidates/{id}/reject` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
| `POST /api/admin/sourcing/candidates/{id}/watchlist` | sourcing | `routes/sourcing.js` (resolved-different-owner) |
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
| `—` | `utils/rules.js` | infrastructure | resolved |
| `—` | `validators/index.js` | infrastructure | resolved |
| `—` | `bootstrap/*` | infrastructure | resolved |
| `notifyOrder*` | `services/notifications/order.js` | notifications | resolved |
| `notifyParcel*` | `services/notifications/parcel.js` | notifications | resolved |
| `sendOtpMessage / sendMagicLink` | `services/notifications/otp-auth.js` | notifications | resolved |
| `notifyLoyaltyEarned` | `services/notifications/loyalty.js` | notifications | resolved |
| `notifyText` | `services/notifications/misc.js` | notifications | resolved |
| `processRefund(orderOrCartId, reason)` | `null` | refunds | documented-signature-no-file |

## Cross-feature dependencies

| Feature | consumes | Résolu ? |
|---|---|---|
| auth | notification (`notification`) | ✖ |
| auth | operations (`operations`) | ✖ |
| auth | orders (`orders`) | ✔ |
| catalog | economic-engine (`economic-engine (prix produit et valorisation commerciale transport)`) | ✔ |
| catalog | logistics (`logistics (rails et eligibilite transport ; le catalog ne decide jamais le rail)`) | ✔ |
| catalog | shared-cart (`shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)`) | ✔ |
| catalog | auth (`auth`) | ✔ |
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
| documents | orders (`orders, customs, wallet, refunds (donnees source du document)`) | ✔ |
| documents | customs (`orders, customs, wallet, refunds (donnees source du document)`) | ✔ |
| documents | wallet (`orders, customs, wallet, refunds (donnees source du document)`) | ✔ |
| documents | refunds (`orders, customs, wallet, refunds (donnees source du document)`) | ✔ |
| documents | auth (`auth`) | ✔ |
| economic-engine | catalog (`catalog (donnees produit source)`) | ✔ |
| economic-engine | auth (`auth`) | ✔ |
| economic-engine | dashboard (`dashboard`) | ✔ |
| economic-engine | orders (`orders`) | ✔ |
| economic-engine | wallet (`wallet`) | ✔ |
| incident-management | logistics (`logistics (scan-engine écrit incidents — SQL inline)`) | ✔ |
| incident-management | payments (`payments (reconciliation-service écrit incidents — SQL inline)`) | ✔ |
| incident-management | notifications (`notifications (alert-engine écrit incidents — SQL inline)`) | ✔ |
| incident-management | dashboard (`dashboard / ops-api legacy (écrit incidents — SQL inline)`) | ✔ |
| incident-management | ops-api legacy (`dashboard / ops-api legacy (écrit incidents — SQL inline)`) | ✖ |
| infrastructure | auth (`auth — bootstrap/api-routes.js monte les routes auth`) | ✔ |
| infrastructure | catalog (`catalog — bootstrap/api-routes.js monte les routes catalog`) | ✔ |
| infrastructure | customs (`customs — bootstrap/api-routes.js monte les routes customs`) | ✔ |
| infrastructure | dashboard (`dashboard — bootstrap/api-routes.js monte les routes dashboard`) | ✔ |
| infrastructure | economic-engine (`economic-engine — bootstrap/api-routes.js monte les routes economic-engine`) | ✔ |
| infrastructure | inventory (`inventory — bootstrap/api-routes.js monte les routes inventory`) | ✔ |
| infrastructure | logistics (`logistics — bootstrap/api-routes.js monte les routes logistics`) | ✔ |
| infrastructure | notification (`notification — bootstrap/api-routes.js monte les routes notification`) | ✖ |
| infrastructure | operations (`operations — bootstrap/api-routes.js monte les routes operations`) | ✖ |
| infrastructure | orders (`orders — bootstrap/api-routes.js monte les routes orders`) | ✔ |
| infrastructure | payment (`payment — bootstrap/api-routes.js monte les routes payment`) | ✖ |
| infrastructure | recommendations (`recommendations — bootstrap/api-routes.js monte les routes recommendations`) | ✔ |
| infrastructure | shared-cart (`shared-cart — bootstrap/api-routes.js monte les routes shared-cart`) | ✔ |
| infrastructure | wallet (`wallet — bootstrap/api-routes.js monte les routes wallet`) | ✔ |
| inventory | catalog (`catalog (produit concerne)`) | ✔ |
| inventory | auth (`auth`) | ✔ |
| logistics | orders (`orders (commande rattachee au colis)`) | ✔ |
| logistics | customs (`customs (statut declaration)`) | ✔ |
| logistics | auth (`auth`) | ✔ |
| logistics | catalog (`catalog`) | ✔ |
| logistics | economic-engine (`economic-engine`) | ✔ |
| logistics | notification (`notification`) | ✖ |
| logistics | payment (`payment`) | ✖ |
| logistics | refunds (`refunds`) | ✔ |
| logistics | wallet (`wallet`) | ✔ |
| loyalty | auth-identity (`auth-identity (identification du client)`) | ✔ |
| loyalty | wallet (`wallet (aucune écriture — v_loyalty_summary et le calcul de palier ne lisent pas les tables wallet)`) | ✔ |
| notifications | toutes les features emettrices (`toutes les features emettrices (orders, payments, shared-cart, refunds...) en entree evenementielle uniquement`) | ✖ |
| orders | wallet (`wallet (application credit)`) | ✔ |
| orders | economic-engine (`economic-engine (cout figure a la commande)`) | ✔ |
| orders | logistics (`logistics (rattachement colis)`) | ✔ |
| orders | catalog (`catalog (lecture produit)`) | ✔ |
| orders | purchasing (`purchasing (lecture — engagement fournisseur déclenché par une commande ; scindée d'orders au Lot O1.4)`) | ✔ |
| orders | auth (`auth`) | ✔ |
| orders | customs (`customs`) | ✔ |
| orders | dashboard (`dashboard`) | ✔ |
| orders | documents (`documents`) | ✔ |
| orders | notification (`notification`) | ✖ |
| orders | payment (`payment`) | ✖ |
| orders | refunds (`refunds`) | ✔ |
| payments | orders (`orders (commande a payer)`) | ✔ |
| payments | auth-identity (`auth-identity (verification du payeur)`) | ✔ |
| purchasing | orders (`orders (lecture : order_items, orders — le besoin d'achat naît d'une commande client)`) | ✔ |
| purchasing | auth (`auth (garde admin)`) | ✔ |
| purchasing | notification (`notification (notifyLoyaltyEarned-like : notification fournisseur WhatsApp, via services/notification-service.js)`) | ✖ |
| recommendations | catalog (`catalog (lecture produit)`) | ✔ |
| recommendations | auth (`auth`) | ✔ |
| recommendations | logistics (`logistics`) | ✔ |
| refunds | orders (`orders (commande source)`) | ✔ |
| refunds | shared-cart (`shared-cart (panier source)`) | ✔ |
| refunds | wallet (`wallet (credit)`) | ✔ |
| refunds | documents (`documents (reçu)`) | ✔ |
| shared-cart | orders (`orders`) | ✔ |
| shared-cart | wallet (`wallet`) | ✔ |
| shared-cart | products (`products`) | ✖ |
| shared-cart | notification (`notification`) | ✖ |
| shared-cart | auth (`auth`) | ✔ |
| shared-cart | customs (`customs`) | ✔ |
| shared-cart | documents (`documents`) | ✔ |
| shared-cart | logistics (`logistics`) | ✔ |
| sourcing | catalog (`catalog (connecteurs fournisseur, catalog-import-orchestrator, catalog-enrichment, supplier-catalog-scanner pour le scan pricing lui-même)`) | ✔ |
| sourcing | economic-engine (`economic-engine (pricing-engine.loadGlobalConfig — config de scan)`) | ✔ |
| sourcing | auth (`auth`) | ✔ |
| unsold-resolution | orders (`orders (commande source de l'invendu)`) | ✔ |
| unsold-resolution | catalog (`catalog (produit concerné)`) | ✔ |
| unsold-resolution | auth (`auth`) | ✔ |
| wallet | auth-identity (`auth-identity (identification du client)`) | ✔ |

## Drifts

### ERROR (0)

- none

### WARN / DEBT (192)

Classification sémantique Lot O4 Phase E — voir `governance/business-graph-warning-semantics.js`. Catégories : EXPECTED_TOPOLOGY (relation légitime documentée), KNOWN_DEBT (déclaration manquante, pas un défaut de comportement), ACTIONABLE_DRIFT (écart probable à corriger), INVALID_DECLARATION (nom de feature inexistant), GENERATOR_LIMITATION (artefact d'extraction).

- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ auth -> "notification" (entrée: "notification") — contract.consumes de auth référence "notification", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ auth -> "operations" (entrée: "operations") — contract.consumes de auth référence "operations", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[GENERATOR_LIMITATION]_ incident-management -> "ops-api legacy" (entrée: "dashboard / ops-api legacy (écrit incidents — SQL inline)") — contract.consumes de incident-management référence "ops-api legacy", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ infrastructure -> "notification" (entrée: "notification — bootstrap/api-routes.js monte les routes notification") — contract.consumes de infrastructure référence "notification", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ infrastructure -> "operations" (entrée: "operations — bootstrap/api-routes.js monte les routes operations") — contract.consumes de infrastructure référence "operations", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ infrastructure -> "payment" (entrée: "payment — bootstrap/api-routes.js monte les routes payment") — contract.consumes de infrastructure référence "payment", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ logistics -> "notification" (entrée: "notification") — contract.consumes de logistics référence "notification", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ logistics -> "payment" (entrée: "payment") — contract.consumes de logistics référence "payment", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[GENERATOR_LIMITATION]_ notifications -> "toutes les features emettrices" (entrée: "toutes les features emettrices (orders, payments, shared-cart, refunds...) en entree evenementielle uniquement") — contract.consumes de notifications référence "toutes les features emettrices", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ orders -> "notification" (entrée: "notification") — contract.consumes de orders référence "notification", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ orders -> "payment" (entrée: "payment") — contract.consumes de orders référence "payment", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ purchasing -> "notification" (entrée: "notification (notifyLoyaltyEarned-like : notification fournisseur WhatsApp, via services/notification-service.js)") — contract.consumes de purchasing référence "notification", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ shared-cart -> "notification" (entrée: "notification") — contract.consumes de shared-cart référence "notification", ne correspond à aucun nom de feature connu
- **[CONSUMES-REFERENCE-UNRESOLVED]** _[INVALID_DECLARATION]_ shared-cart -> "products" (entrée: "products") — contract.consumes de shared-cart référence "products", ne correspond à aucun nom de feature connu
- **[DASH-MANIFEST-DUPLICATE-COPY]** _[EXPECTED_TOPOLOGY]_ admin-dashboard — "public/features/admin-dashboard.feature.js" est une copie déclarée de "public/dashboards/features/admin-dashboard.feature.js" (APP_FEATURE_REGISTRY.md) — non chargée comme nœud séparé, résolue uniquement contre le canonique
- **[DASH-MANIFEST-DUPLICATE-COPY]** _[EXPECTED_TOPOLOGY]_ legacy-control-tower — "public/features/legacy-control-tower.feature.js" est une copie déclarée de "public/dashboards/features/legacy-control-tower.feature.js" (APP_FEATURE_REGISTRY.md) — non chargée comme nœud séparé, résolue uniquement contre le canonique
- **[DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED]** _[GENERATOR_LIMITATION]_ scope:backend — 14 appel(s) require()/import() dynamique(s) non résolu(s) statiquement dans le scope backend (ex. scripts/boutique-ownership-full-check.js: path.join(abs, f | scripts/contract-generate.js: ... | scripts/feature-audit.js: full) — limitation du modèle statique O5, jamais inventé
- **[EXPOSE-ENTRY-UNPARSED]** _[GENERATOR_LIMITATION]_ logistics / GET/POST /api/parcels — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** _[GENERATOR_LIMITATION]_ orders / GET/POST /api/orders — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ customs / GET /api/admin/customs — contract.exposes déclare "GET /api/admin/customs" mais le contrat OpenAPI le résout vers "routes/admin.js", non déclaré dans customs.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ documents / GET /api/admin/documents — contract.exposes déclare "GET /api/admin/documents" mais le contrat OpenAPI le résout vers "routes/admin.js", non déclaré dans documents.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ documents / GET /api/admin/documents/{id} — contract.exposes déclare "GET /api/admin/documents/{id}" mais le contrat OpenAPI le résout vers "routes/admin.js", non déclaré dans documents.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ documents / GET /api/admin/documents/summary — contract.exposes déclare "GET /api/admin/documents/summary" mais le contrat OpenAPI le résout vers "routes/admin.js", non déclaré dans documents.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ economic-engine / GET /api/dashboard/annulations-parcels — contract.exposes déclare "GET /api/dashboard/annulations-parcels" mais le contrat OpenAPI le résout vers "routes/dashboard.js", non déclaré dans economic-engine.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ economic-engine / GET /api/dashboard/finance — contract.exposes déclare "GET /api/dashboard/finance" mais le contrat OpenAPI le résout vers "routes/dashboard.js", non déclaré dans economic-engine.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ economic-engine / GET /api/dashboard/payments — contract.exposes déclare "GET /api/dashboard/payments" mais le contrat OpenAPI le résout vers "routes/dashboard.js", non déclaré dans economic-engine.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ economic-engine / GET /api/dashboard/sales — contract.exposes déclare "GET /api/dashboard/sales" mais le contrat OpenAPI le résout vers "routes/dashboard.js", non déclaré dans economic-engine.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ infrastructure / GET /api/health — contract.exposes déclare "GET /api/health" mais le contrat OpenAPI le résout vers "routes/health.js", non déclaré dans infrastructure.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[KNOWN_DEBT]_ infrastructure / GET /api/public/config — contract.exposes déclare "GET /api/public/config" mais le contrat OpenAPI le résout vers "routes/public.js", non déclaré dans infrastructure.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ infrastructure / POST /api/shared-carts/stripe/webhook — contract.exposes déclare "POST /api/shared-carts/stripe/webhook" mais le contrat OpenAPI le résout vers "routes/shared-cart-cash.js", non déclaré dans infrastructure.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ orders / DELETE /api/admin/orders/{id} — contract.exposes déclare "DELETE /api/admin/orders/{id}" mais le contrat OpenAPI le résout vers "routes/admin.js", non déclaré dans orders.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ orders / GET /api/admin/orders — contract.exposes déclare "GET /api/admin/orders" mais le contrat OpenAPI le résout vers "routes/admin.js", non déclaré dans orders.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ orders / POST /api/admin/orders/{id}/refund — contract.exposes déclare "POST /api/admin/orders/{id}/refund" mais le contrat OpenAPI le résout vers "routes/admin.js", non déclaré dans orders.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ orders / POST /api/hub/orders/mark-ordered — contract.exposes déclare "POST /api/hub/orders/mark-ordered" mais le contrat OpenAPI le résout vers "routes/hub.js", non déclaré dans orders.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[KNOWN_DEBT]_ platform-ops / GET /api/v2/parcels/{id}/detail — contract.exposes déclare "GET /api/v2/parcels/{id}/detail" mais le contrat OpenAPI le résout vers "routes/parcel-api-v2.js", non déclaré dans platform-ops.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[KNOWN_DEBT]_ platform-ops / GET /api/v2/parcels/{id}/orders — contract.exposes déclare "GET /api/v2/parcels/{id}/orders" mais le contrat OpenAPI le résout vers "routes/parcel-api-v2.js", non déclaré dans platform-ops.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[KNOWN_DEBT]_ platform-ops / GET /api/v2/parcels/{id}/scans — contract.exposes déclare "GET /api/v2/parcels/{id}/scans" mais le contrat OpenAPI le résout vers "routes/parcel-api-v2.js", non déclaré dans platform-ops.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[GENERATOR_LIMITATION]_ platform-ops / GET /health — contract.exposes déclare "GET /health" mais le contrat OpenAPI le résout vers "routes/unknown.js", non déclaré dans platform-ops.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[KNOWN_DEBT]_ platform-ops / GET /health/detailed — contract.exposes déclare "GET /health/detailed" mais le contrat OpenAPI le résout vers "routes/detailed.js", non déclaré dans platform-ops.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[KNOWN_DEBT]_ platform-ops / GET /health/metrics — contract.exposes déclare "GET /health/metrics" mais le contrat OpenAPI le résout vers "routes/metrics.js", non déclaré dans platform-ops.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[KNOWN_DEBT]_ platform-ops / GET /health/ready — contract.exposes déclare "GET /health/ready" mais le contrat OpenAPI le résout vers "routes/ready.js", non déclaré dans platform-ops.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[KNOWN_DEBT]_ platform-ops / GET /health/version — contract.exposes déclare "GET /health/version" mais le contrat OpenAPI le résout vers "routes/version.js", non déclaré dans platform-ops.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / GET /api/admin/sourcing/candidates — contract.exposes déclare "GET /api/admin/sourcing/candidates" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / GET /api/admin/sourcing/candidates/{id} — contract.exposes déclare "GET /api/admin/sourcing/candidates/{id}" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / GET /api/admin/sourcing/catalogs — contract.exposes déclare "GET /api/admin/sourcing/catalogs" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / GET /api/admin/sourcing/connectors — contract.exposes déclare "GET /api/admin/sourcing/connectors" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / POST /api/admin/sourcing/candidates/{id}/import-product — contract.exposes déclare "POST /api/admin/sourcing/candidates/{id}/import-product" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / POST /api/admin/sourcing/candidates/{id}/reject — contract.exposes déclare "POST /api/admin/sourcing/candidates/{id}/reject" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / POST /api/admin/sourcing/candidates/{id}/scan — contract.exposes déclare "POST /api/admin/sourcing/candidates/{id}/scan" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / POST /api/admin/sourcing/candidates/{id}/watchlist — contract.exposes déclare "POST /api/admin/sourcing/candidates/{id}/watchlist" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / POST /api/admin/sourcing/candidates/scan-batch — contract.exposes déclare "POST /api/admin/sourcing/candidates/scan-batch" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / POST /api/admin/sourcing/catalogs/import — contract.exposes déclare "POST /api/admin/sourcing/catalogs/import" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-OWNER-MISMATCH]** _[ACTIONABLE_DRIFT]_ sourcing / PUT /api/admin/sourcing/candidates/{id} — contract.exposes déclare "PUT /api/admin/sourcing/candidates/{id}" mais le contrat OpenAPI le résout vers "routes/sourcing.js", non déclaré dans sourcing.files.routes
- **[EXPOSED-ROUTE-UNRESOLVED]** _[ACTIONABLE_DRIFT]_ catalog / DELETE /api/products/{id}/skus/{id} — "DELETE /api/products/{id}/skus/{id}" déclaré par catalog mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** _[ACTIONABLE_DRIFT]_ catalog / GET /api/products/{id}/skus — "GET /api/products/{id}/skus" déclaré par catalog mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** _[ACTIONABLE_DRIFT]_ catalog / GET /api/products/{id}/skus/readiness — "GET /api/products/{id}/skus/readiness" déclaré par catalog mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** _[ACTIONABLE_DRIFT]_ catalog / POST /api/products/{id}/skus — "POST /api/products/{id}/skus" déclaré par catalog mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** _[GENERATOR_LIMITATION]_ infrastructure / GET /*.html — "GET /*.html" déclaré par infrastructure mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** _[GENERATOR_LIMITATION]_ infrastructure / GET /webhook/authkey-whatsapp — "GET /webhook/authkey-whatsapp" déclaré par infrastructure mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** _[GENERATOR_LIMITATION]_ logistics / POST /api/hub/photo — "POST /api/hub/photo" déclaré par logistics mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** _[GENERATOR_LIMITATION]_ logistics / POST /api/hub/volume — "POST /api/hub/volume" déclaré par logistics mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[LOCAL-MANIFEST-DEPENDENCY-WITHOUT-CANONICAL-CONSUMER]** _[KNOWN_DEBT]_ boutique-manifest:tracking — 5 dépendance(s) technique(s) observée(s) depuis boutique-manifest:tracking (ontology gap déjà documenté, canonicalFeature=null) vers auth-identity, logistics, orders — visible mais non collapsable en paire canonical-feature (pas de Feature Card consumer pour déclarer contract.consumes)
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> catalog — dépendance cross-feature observée (canal: interface, 2 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "catalog"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> customs — dépendance cross-feature observée (canal: interface, 4 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "customs"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> dashboard — dépendance cross-feature observée (canal: interface, 20 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "dashboard"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> decision-signals — dépendance cross-feature observée (canal: interface, 3 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "decision-signals"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> economic-engine — dépendance cross-feature observée (canal: interface, 20 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "economic-engine"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> inventory — dépendance cross-feature observée (canal: interface, 5 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "inventory"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> logistics — dépendance cross-feature observée (canal: interface, 8 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> orders — dépendance cross-feature observée (canal: interface, 3 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "orders"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ admin-dashboard -> payments — dépendance cross-feature observée (canal: interface, 6 preuve(s)) sans contract.consumes déclaré chez "admin-dashboard" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ auth -> auth-identity — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "auth" vers "auth-identity"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ auth -> infrastructure — dépendance cross-feature observée (canal: static-code, 13 preuve(s)) sans contract.consumes déclaré chez "auth" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ auth -> notifications — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "auth" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ auth-identity -> auth — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "auth-identity" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ auth-identity -> infrastructure — dépendance cross-feature observée (canal: static-code, 12 preuve(s)) sans contract.consumes déclaré chez "auth-identity" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ auth-identity -> logistics — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "auth-identity" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ auth-identity -> notifications — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "auth-identity" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ auth-identity -> orders — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "auth-identity" vers "orders"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ catalog -> infrastructure — dépendance cross-feature observée (canal: static-code, 33 preuve(s)) sans contract.consumes déclaré chez "catalog" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ customs -> infrastructure — dépendance cross-feature observée (canal: static-code, 4 preuve(s)) sans contract.consumes déclaré chez "customs" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ dashboard -> catalog — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "dashboard" vers "catalog"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ dashboard -> decision-signals — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "dashboard" vers "decision-signals"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ dashboard -> infrastructure — dépendance cross-feature observée (canal: static-code, 52 preuve(s)) sans contract.consumes déclaré chez "dashboard" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ dashboard -> purchasing — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "dashboard" vers "purchasing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ decision-signals -> auth — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "decision-signals" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ decision-signals -> infrastructure — dépendance cross-feature observée (canal: static-code, 8 preuve(s)) sans contract.consumes déclaré chez "decision-signals" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ decision-signals -> logistics — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "decision-signals" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ documents -> infrastructure — dépendance cross-feature observée (canal: static-code, 16 preuve(s)) sans contract.consumes déclaré chez "documents" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ economic-engine -> infrastructure — dépendance cross-feature observée (canal: static-code, 72 preuve(s)) sans contract.consumes déclaré chez "economic-engine" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ economic-engine -> logistics — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "economic-engine" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ economic-engine -> loyalty — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "economic-engine" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ incident-management -> infrastructure — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "incident-management" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> auth-identity — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "auth-identity"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> decision-signals — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "decision-signals"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> loyalty — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> notifications — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> payments — dépendance cross-feature observée (canal: static-code, 4 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> platform-ops — dépendance cross-feature observée (canal: static-code, 5 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "platform-ops"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> purchasing — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "purchasing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> sourcing — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "sourcing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ infrastructure -> unsold-resolution — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "unsold-resolution"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ inventory -> infrastructure — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "inventory" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ inventory -> logistics — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "inventory" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ logistics -> infrastructure — dépendance cross-feature observée (canal: static-code, 73 preuve(s)) sans contract.consumes déclaré chez "logistics" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ logistics -> loyalty — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "logistics" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ logistics -> notifications — dépendance cross-feature observée (canal: static-code, 8 preuve(s)) sans contract.consumes déclaré chez "logistics" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ logistics -> payments — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "logistics" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ logistics -> purchasing — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "logistics" vers "purchasing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ loyalty -> auth — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "loyalty" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ loyalty -> infrastructure — dépendance cross-feature observée (canal: static-code, 5 preuve(s)) sans contract.consumes déclaré chez "loyalty" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ loyalty -> notifications — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "loyalty" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ notifications -> auth — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "notifications" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ notifications -> auth-identity — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "notifications" vers "auth-identity"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ notifications -> decision-signals — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "notifications" vers "decision-signals"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ notifications -> infrastructure — dépendance cross-feature observée (canal: static-code, 11 preuve(s)) sans contract.consumes déclaré chez "notifications" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ orders -> infrastructure — dépendance cross-feature observée (canal: static-code, 63 preuve(s)) sans contract.consumes déclaré chez "orders" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ orders -> loyalty — dépendance cross-feature observée (canal: static-code, 7 preuve(s)) sans contract.consumes déclaré chez "orders" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ orders -> notifications — dépendance cross-feature observée (canal: static-code, 8 preuve(s)) sans contract.consumes déclaré chez "orders" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ orders -> payments — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "orders" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> auth — dépendance cross-feature observée (canal: static-code, 5 preuve(s)) sans contract.consumes déclaré chez "payments" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> documents — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "payments" vers "documents"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> infrastructure — dépendance cross-feature observée (canal: static-code, 39 preuve(s)) sans contract.consumes déclaré chez "payments" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> logistics — dépendance cross-feature observée (canal: interface+static-code, 9 preuve(s)) sans contract.consumes déclaré chez "payments" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> loyalty — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "payments" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> notifications — dépendance cross-feature observée (canal: static-code, 6 preuve(s)) sans contract.consumes déclaré chez "payments" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> platform-ops — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "payments" vers "platform-ops"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> purchasing — dépendance cross-feature observée (canal: static-code, 4 preuve(s)) sans contract.consumes déclaré chez "payments" vers "purchasing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> refunds — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "payments" vers "refunds"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ payments -> wallet — dépendance cross-feature observée (canal: interface, 1 preuve(s)) sans contract.consumes déclaré chez "payments" vers "wallet"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> auth — dépendance cross-feature observée (canal: static-code, 5 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> catalog — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "catalog"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> economic-engine — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "economic-engine"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> infrastructure — dépendance cross-feature observée (canal: static-code, 27 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> logistics — dépendance cross-feature observée (canal: static-code, 4 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> orders — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "orders"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> purchasing — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "purchasing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ platform-ops -> shared-cart — dépendance cross-feature observée (canal: static-code, 4 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "shared-cart"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ purchasing -> infrastructure — dépendance cross-feature observée (canal: static-code, 18 preuve(s)) sans contract.consumes déclaré chez "purchasing" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ purchasing -> logistics — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "purchasing" vers "logistics"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ purchasing -> notifications — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "purchasing" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ recommendations -> infrastructure — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "recommendations" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ refunds -> infrastructure — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "refunds" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ shared-cart -> auth-identity — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "shared-cart" vers "auth-identity"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ shared-cart -> infrastructure — dépendance cross-feature observée (canal: static-code, 61 preuve(s)) sans contract.consumes déclaré chez "shared-cart" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ shared-cart -> loyalty — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "shared-cart" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ shared-cart -> notifications — dépendance cross-feature observée (canal: static-code, 6 preuve(s)) sans contract.consumes déclaré chez "shared-cart" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ shared-cart -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "shared-cart" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ shared-cart -> refunds — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "shared-cart" vers "refunds"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ sourcing -> infrastructure — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "sourcing" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ unsold-resolution -> infrastructure — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "unsold-resolution" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ wallet -> auth — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "wallet" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ wallet -> documents — dépendance cross-feature observée (canal: static-code, 4 preuve(s)) sans contract.consumes déclaré chez "wallet" vers "documents"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ wallet -> infrastructure — dépendance cross-feature observée (canal: static-code, 8 preuve(s)) sans contract.consumes déclaré chez "wallet" vers "infrastructure"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** _[ACTIONABLE_DRIFT]_ wallet -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "wallet" vers "payments"
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ alerts — table "alerts" a 7 écrivain(s) déclaré(s) (catalog, logistics, notifications, orders, payments, purchasing, shared-cart) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ basket_items — table "basket_items" : lifecycle owner = shared-cart (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ baskets — table "baskets" : lifecycle owner = shared-cart (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ cart_shares — table "cart_shares" : lifecycle owner = shared-cart (classification.signals.ownsTables), mais aussi écrite par orders
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ charges — table "charges" a 2 écrivain(s) déclaré(s) (economic-engine, infrastructure) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ economic_snapshots — table "economic_snapshots" a 2 écrivain(s) déclaré(s) (economic-engine, infrastructure) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ finance_config — table "finance_config" a 2 écrivain(s) déclaré(s) (economic-engine, infrastructure) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ incidents — table "incidents" a 5 écrivain(s) déclaré(s) (dashboard, incident-management, logistics, notifications, payments) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ invoices — table "invoices" a 2 écrivain(s) déclaré(s) (dashboard, orders) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ loyalty_rewards — table "loyalty_rewards" : lifecycle owner = loyalty (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ notification_log — table "notification_log" a 2 écrivain(s) déclaré(s) (notifications, platform-ops) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ order_comments — table "order_comments" a 2 écrivain(s) déclaré(s) (dashboard, orders) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ order_item_real_cost_allocations — table "order_item_real_cost_allocations" a 2 écrivain(s) déclaré(s) (customs, economic-engine) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ order_items — table "order_items" : lifecycle owner = shared-cart (classification.signals.ownsTables), mais aussi écrite par dashboard, logistics, orders
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ order_status_history — table "order_status_history" a 2 écrivain(s) déclaré(s) (dashboard, orders) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ orders — table "orders" a 10 écrivain(s) déclaré(s) (customs, dashboard, inventory, logistics, orders, payments, platform-ops, purchasing, shared-cart, wallet) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ parcel_items — table "parcel_items" : lifecycle owner = platform-ops (classification.signals.ownsTables), mais aussi écrite par dashboard, inventory, logistics
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ parcels — table "parcels" : lifecycle owner = platform-ops (classification.signals.ownsTables), mais aussi écrite par customs, dashboard, logistics, payments
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ pickup_print_tokens — table "pickup_print_tokens" a 2 écrivain(s) déclaré(s) (infrastructure, logistics) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ pickup_reveal_codes — table "pickup_reveal_codes" a 2 écrivain(s) déclaré(s) (infrastructure, logistics) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ price_history — table "price_history" a 2 écrivain(s) déclaré(s) (catalog, economic-engine) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ product_variants — table "product_variants" a 2 écrivain(s) déclaré(s) (catalog, economic-engine) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ products — table "products" a 4 écrivain(s) déclaré(s) (catalog, dashboard, economic-engine, sourcing) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ purchase_orders — table "purchase_orders" : lifecycle owner = purchasing (classification.signals.ownsTables), mais aussi écrite par orders
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ recipients — table "recipients" : lifecycle owner = shared-cart (classification.signals.ownsTables), mais aussi écrite par dashboard, orders
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ relais — table "relais" a 2 écrivain(s) déclaré(s) (dashboard, logistics) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ revoked_tokens — table "revoked_tokens" a 2 écrivain(s) déclaré(s) (auth-identity, infrastructure) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ scan_events — table "scan_events" a 2 écrivain(s) déclaré(s) (dashboard, logistics) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ scans — table "scans" : lifecycle owner = platform-ops (classification.signals.ownsTables), mais aussi écrite par dashboard, logistics, orders
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ sms_log — table "sms_log" a 2 écrivain(s) déclaré(s) (dashboard, orders) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ sourcing_candidate_events — table "sourcing_candidate_events" a 2 écrivain(s) déclaré(s) (catalog, sourcing) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ sourcing_candidates — table "sourcing_candidates" a 2 écrivain(s) déclaré(s) (catalog, sourcing) sans owner de lifecycle univoque (classification.signals.ownsTables) — WRITES != OWNS, à rendre visible, pas nécessairement une erreur
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ stripe_events_processed — table "stripe_events_processed" : lifecycle owner = shared-cart (classification.signals.ownsTables), mais aussi écrite par payments
- **[WRITER-NOT-OWNER]** _[ACTIONABLE_DRIFT]_ users — table "users" : lifecycle owner = loyalty (classification.signals.ownsTables), mais aussi écrite par auth, auth-identity, dashboard, infrastructure
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ wallet_transactions — table "wallet_transactions" : lifecycle owner = wallet (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** _[EXPECTED_TOPOLOGY]_ wallets — table "wallets" : lifecycle owner = wallet (classification.signals.ownsTables), mais aussi écrite par dashboard

## Orphan technical nodes

Fichiers présents dans le Technical Architecture Graph, non revendiqués par une carte feature ni un transversal déclaré (`governance/transversal-paths.json`).

- none

## Lot O5 — Feature Dependency Conformance & Hidden Coupling Gate

Meta Graph monté : oui.

### Coverage par scope

- backend : 779 fichier(s) `.js`/`.mjs` observés (canal A)
- boutique : 91 fichier(s) observés, dont 63 sous manifest non-canonique (canonicalFeature=null)
- dash : 83 fichier(s) observés
  - _dash static-string local dependency file coverage: COMPLETE (fichiers .js déclarés, résolus)_
  - _dash interface channel: consumer file resolution câblée via docs/DASHBOARDS_360.json (bridge vue -> fileId basé sur les entrées "views/" déjà gouvernées par implementedByEdges) — les modules dashboards référencés par META_GRAPH mais absents des vues gouvernées (ou ambigus) restent INTERFACE-CONSUMER-FILE-UNRESOLVED, jamais devinés_
  - _dash total runtime dependency observability: LIMITED BY O5 STATIC MODEL (dynamic import, registry lookup, dependency injection, event-driven dependency hors périmètre statique)_

### Dependency conformance summary (paires canonical-feature → canonical-feature)

| Consumer | Provider | Canaux | Preuves | Statut |
|---|---|---|---|---|
| admin-dashboard | catalog | interface | 2 | **OBSERVED_UNDECLARED** |
| admin-dashboard | customs | interface | 4 | **OBSERVED_UNDECLARED** |
| admin-dashboard | dashboard | interface | 20 | **OBSERVED_UNDECLARED** |
| admin-dashboard | decision-signals | interface | 3 | **OBSERVED_UNDECLARED** |
| admin-dashboard | economic-engine | interface | 20 | **OBSERVED_UNDECLARED** |
| admin-dashboard | inventory | interface | 5 | **OBSERVED_UNDECLARED** |
| admin-dashboard | logistics | interface | 8 | **OBSERVED_UNDECLARED** |
| admin-dashboard | orders | interface | 3 | **OBSERVED_UNDECLARED** |
| admin-dashboard | payments | interface | 6 | **OBSERVED_UNDECLARED** |
| auth | auth-identity | static-code | 3 | **OBSERVED_UNDECLARED** |
| auth | infrastructure | static-code | 13 | **OBSERVED_UNDECLARED** |
| auth | notifications | static-code | 1 | **OBSERVED_UNDECLARED** |
| auth-identity | auth | static-code | 2 | **OBSERVED_UNDECLARED** |
| auth-identity | infrastructure | static-code | 12 | **OBSERVED_UNDECLARED** |
| auth-identity | logistics | static-code | 2 | **OBSERVED_UNDECLARED** |
| auth-identity | notifications | static-code | 2 | **OBSERVED_UNDECLARED** |
| auth-identity | orders | static-code | 1 | **OBSERVED_UNDECLARED** |
| catalog | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| catalog | economic-engine | static-code | 4 | **DECLARED_AND_OBSERVED** |
| catalog | infrastructure | static-code | 33 | **OBSERVED_UNDECLARED** |
| catalog | logistics | static-code | 2 | **DECLARED_AND_OBSERVED** |
| customs | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| customs | documents | static-code | 2 | **DECLARED_AND_OBSERVED** |
| customs | economic-engine | static-code | 2 | **DECLARED_AND_OBSERVED** |
| customs | infrastructure | static-code | 4 | **OBSERVED_UNDECLARED** |
| dashboard | auth | static-code | 11 | **DECLARED_AND_OBSERVED** |
| dashboard | catalog | static-code | 1 | **OBSERVED_UNDECLARED** |
| dashboard | customs | static-code | 2 | **DECLARED_AND_OBSERVED** |
| dashboard | decision-signals | static-code | 2 | **OBSERVED_UNDECLARED** |
| dashboard | documents | static-code | 1 | **DECLARED_AND_OBSERVED** |
| dashboard | economic-engine | static-code | 4 | **DECLARED_AND_OBSERVED** |
| dashboard | infrastructure | static-code | 52 | **OBSERVED_UNDECLARED** |
| dashboard | logistics | static-code | 5 | **DECLARED_AND_OBSERVED** |
| dashboard | orders | static-code | 6 | **DECLARED_AND_OBSERVED** |
| dashboard | purchasing | static-code | 2 | **OBSERVED_UNDECLARED** |
| decision-signals | auth | static-code | 1 | **OBSERVED_UNDECLARED** |
| decision-signals | infrastructure | static-code | 8 | **OBSERVED_UNDECLARED** |
| decision-signals | logistics | static-code | 1 | **OBSERVED_UNDECLARED** |
| documents | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| documents | infrastructure | static-code | 16 | **OBSERVED_UNDECLARED** |
| economic-engine | auth | static-code | 11 | **DECLARED_AND_OBSERVED** |
| economic-engine | catalog | static-code | 2 | **DECLARED_AND_OBSERVED** |
| economic-engine | dashboard | static-code | 8 | **DECLARED_AND_OBSERVED** |
| economic-engine | infrastructure | static-code | 72 | **OBSERVED_UNDECLARED** |
| economic-engine | logistics | static-code | 2 | **OBSERVED_UNDECLARED** |
| economic-engine | loyalty | static-code | 1 | **OBSERVED_UNDECLARED** |
| economic-engine | orders | static-code | 2 | **DECLARED_AND_OBSERVED** |
| incident-management | infrastructure | static-code | 3 | **OBSERVED_UNDECLARED** |
| infrastructure | auth | static-code | 2 | **DECLARED_AND_OBSERVED** |
| infrastructure | auth-identity | static-code | 3 | **OBSERVED_UNDECLARED** |
| infrastructure | catalog | static-code | 3 | **DECLARED_AND_OBSERVED** |
| infrastructure | customs | static-code | 2 | **DECLARED_AND_OBSERVED** |
| infrastructure | dashboard | static-code | 8 | **DECLARED_AND_OBSERVED** |
| infrastructure | decision-signals | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | economic-engine | static-code | 11 | **DECLARED_AND_OBSERVED** |
| infrastructure | inventory | static-code | 2 | **DECLARED_AND_OBSERVED** |
| infrastructure | logistics | static-code | 20 | **DECLARED_AND_OBSERVED** |
| infrastructure | loyalty | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | notifications | static-code | 2 | **OBSERVED_UNDECLARED** |
| infrastructure | orders | static-code | 6 | **DECLARED_AND_OBSERVED** |
| infrastructure | payments | static-code | 4 | **OBSERVED_UNDECLARED** |
| infrastructure | platform-ops | static-code | 5 | **OBSERVED_UNDECLARED** |
| infrastructure | purchasing | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | recommendations | static-code | 1 | **DECLARED_AND_OBSERVED** |
| infrastructure | shared-cart | static-code | 10 | **DECLARED_AND_OBSERVED** |
| infrastructure | sourcing | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | unsold-resolution | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | wallet | static-code | 2 | **DECLARED_AND_OBSERVED** |
| inventory | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| inventory | infrastructure | static-code | 2 | **OBSERVED_UNDECLARED** |
| inventory | logistics | static-code | 1 | **OBSERVED_UNDECLARED** |
| logistics | auth | static-code | 13 | **DECLARED_AND_OBSERVED** |
| logistics | catalog | static-code | 1 | **DECLARED_AND_OBSERVED** |
| logistics | infrastructure | static-code | 73 | **OBSERVED_UNDECLARED** |
| logistics | loyalty | static-code | 3 | **OBSERVED_UNDECLARED** |
| logistics | notifications | static-code | 8 | **OBSERVED_UNDECLARED** |
| logistics | orders | static-code | 14 | **DECLARED_AND_OBSERVED** |
| logistics | payments | static-code | 2 | **OBSERVED_UNDECLARED** |
| logistics | purchasing | static-code | 1 | **OBSERVED_UNDECLARED** |
| logistics | refunds | static-code | 1 | **DECLARED_AND_OBSERVED** |
| loyalty | auth | static-code | 1 | **OBSERVED_UNDECLARED** |
| loyalty | infrastructure | static-code | 5 | **OBSERVED_UNDECLARED** |
| loyalty | notifications | static-code | 3 | **OBSERVED_UNDECLARED** |
| notifications | auth | static-code | 2 | **OBSERVED_UNDECLARED** |
| notifications | auth-identity | static-code | 3 | **OBSERVED_UNDECLARED** |
| notifications | decision-signals | static-code | 2 | **OBSERVED_UNDECLARED** |
| notifications | infrastructure | static-code | 11 | **OBSERVED_UNDECLARED** |
| orders | auth | static-code | 13 | **DECLARED_AND_OBSERVED** |
| orders | catalog | static-code | 3 | **DECLARED_AND_OBSERVED** |
| orders | customs | static-code | 3 | **DECLARED_AND_OBSERVED** |
| orders | documents | static-code | 7 | **DECLARED_AND_OBSERVED** |
| orders | economic-engine | static-code | 2 | **DECLARED_AND_OBSERVED** |
| orders | infrastructure | static-code | 63 | **OBSERVED_UNDECLARED** |
| orders | logistics | static-code | 8 | **DECLARED_AND_OBSERVED** |
| orders | loyalty | static-code | 7 | **OBSERVED_UNDECLARED** |
| orders | notifications | static-code | 8 | **OBSERVED_UNDECLARED** |
| orders | payments | static-code | 3 | **OBSERVED_UNDECLARED** |
| orders | refunds | static-code | 4 | **DECLARED_AND_OBSERVED** |
| orders | wallet | static-code | 7 | **DECLARED_AND_OBSERVED** |
| payments | auth | static-code | 5 | **OBSERVED_UNDECLARED** |
| payments | auth-identity | static-code | 4 | **DECLARED_AND_OBSERVED** |
| payments | documents | static-code | 2 | **OBSERVED_UNDECLARED** |
| payments | infrastructure | static-code | 39 | **OBSERVED_UNDECLARED** |
| payments | logistics | static-code, interface | 9 | **OBSERVED_UNDECLARED** |
| payments | loyalty | static-code | 3 | **OBSERVED_UNDECLARED** |
| payments | notifications | static-code | 6 | **OBSERVED_UNDECLARED** |
| payments | orders | static-code, interface | 14 | **DECLARED_AND_OBSERVED** |
| payments | platform-ops | static-code | 1 | **OBSERVED_UNDECLARED** |
| payments | purchasing | static-code | 4 | **OBSERVED_UNDECLARED** |
| payments | refunds | static-code | 2 | **OBSERVED_UNDECLARED** |
| payments | wallet | interface | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | auth | static-code | 5 | **OBSERVED_UNDECLARED** |
| platform-ops | catalog | static-code | 2 | **OBSERVED_UNDECLARED** |
| platform-ops | economic-engine | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | infrastructure | static-code | 27 | **OBSERVED_UNDECLARED** |
| platform-ops | logistics | static-code | 4 | **OBSERVED_UNDECLARED** |
| platform-ops | orders | static-code | 2 | **OBSERVED_UNDECLARED** |
| platform-ops | payments | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | purchasing | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | shared-cart | static-code | 4 | **OBSERVED_UNDECLARED** |
| purchasing | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| purchasing | infrastructure | static-code | 18 | **OBSERVED_UNDECLARED** |
| purchasing | logistics | static-code | 1 | **OBSERVED_UNDECLARED** |
| purchasing | notifications | static-code | 2 | **OBSERVED_UNDECLARED** |
| purchasing | orders | static-code | 3 | **DECLARED_AND_OBSERVED** |
| recommendations | infrastructure | static-code | 1 | **OBSERVED_UNDECLARED** |
| refunds | documents | static-code | 2 | **DECLARED_AND_OBSERVED** |
| refunds | infrastructure | static-code | 3 | **OBSERVED_UNDECLARED** |
| refunds | wallet | static-code | 3 | **DECLARED_AND_OBSERVED** |
| shared-cart | auth | static-code | 5 | **DECLARED_AND_OBSERVED** |
| shared-cart | auth-identity | static-code | 3 | **OBSERVED_UNDECLARED** |
| shared-cart | customs | static-code | 1 | **DECLARED_AND_OBSERVED** |
| shared-cart | documents | static-code | 3 | **DECLARED_AND_OBSERVED** |
| shared-cart | infrastructure | static-code | 61 | **OBSERVED_UNDECLARED** |
| shared-cart | logistics | static-code | 2 | **DECLARED_AND_OBSERVED** |
| shared-cart | loyalty | static-code | 3 | **OBSERVED_UNDECLARED** |
| shared-cart | notifications | static-code | 6 | **OBSERVED_UNDECLARED** |
| shared-cart | orders | static-code | 6 | **DECLARED_AND_OBSERVED** |
| shared-cart | payments | static-code | 1 | **OBSERVED_UNDECLARED** |
| shared-cart | refunds | static-code | 2 | **OBSERVED_UNDECLARED** |
| sourcing | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| sourcing | catalog | static-code | 8 | **DECLARED_AND_OBSERVED** |
| sourcing | economic-engine | static-code | 1 | **DECLARED_AND_OBSERVED** |
| sourcing | infrastructure | static-code | 1 | **OBSERVED_UNDECLARED** |
| unsold-resolution | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | infrastructure | static-code | 1 | **OBSERVED_UNDECLARED** |
| wallet | auth | static-code | 1 | **OBSERVED_UNDECLARED** |
| wallet | auth-identity | static-code | 2 | **DECLARED_AND_OBSERVED** |
| wallet | documents | static-code | 4 | **OBSERVED_UNDECLARED** |
| wallet | infrastructure | static-code | 8 | **OBSERVED_UNDECLARED** |
| wallet | payments | static-code | 1 | **OBSERVED_UNDECLARED** |

### Observed undeclared dependencies

- `admin-dashboard` → `catalog` (canaux: interface)
- `admin-dashboard` → `customs` (canaux: interface)
- `admin-dashboard` → `dashboard` (canaux: interface)
- `admin-dashboard` → `decision-signals` (canaux: interface)
- `admin-dashboard` → `economic-engine` (canaux: interface)
- `admin-dashboard` → `inventory` (canaux: interface)
- `admin-dashboard` → `logistics` (canaux: interface)
- `admin-dashboard` → `orders` (canaux: interface)
- `admin-dashboard` → `payments` (canaux: interface)
- `auth` → `auth-identity` (canaux: static-code)
- `auth` → `infrastructure` (canaux: static-code)
- `auth` → `notifications` (canaux: static-code)
- `auth-identity` → `auth` (canaux: static-code)
- `auth-identity` → `infrastructure` (canaux: static-code)
- `auth-identity` → `logistics` (canaux: static-code)
- `auth-identity` → `notifications` (canaux: static-code)
- `auth-identity` → `orders` (canaux: static-code)
- `catalog` → `infrastructure` (canaux: static-code)
- `customs` → `infrastructure` (canaux: static-code)
- `dashboard` → `catalog` (canaux: static-code)
- `dashboard` → `decision-signals` (canaux: static-code)
- `dashboard` → `infrastructure` (canaux: static-code)
- `dashboard` → `purchasing` (canaux: static-code)
- `decision-signals` → `auth` (canaux: static-code)
- `decision-signals` → `infrastructure` (canaux: static-code)
- `decision-signals` → `logistics` (canaux: static-code)
- `documents` → `infrastructure` (canaux: static-code)
- `economic-engine` → `infrastructure` (canaux: static-code)
- `economic-engine` → `logistics` (canaux: static-code)
- `economic-engine` → `loyalty` (canaux: static-code)
- `incident-management` → `infrastructure` (canaux: static-code)
- `infrastructure` → `auth-identity` (canaux: static-code)
- `infrastructure` → `decision-signals` (canaux: static-code)
- `infrastructure` → `loyalty` (canaux: static-code)
- `infrastructure` → `notifications` (canaux: static-code)
- `infrastructure` → `payments` (canaux: static-code)
- `infrastructure` → `platform-ops` (canaux: static-code)
- `infrastructure` → `purchasing` (canaux: static-code)
- `infrastructure` → `sourcing` (canaux: static-code)
- `infrastructure` → `unsold-resolution` (canaux: static-code)
- `inventory` → `infrastructure` (canaux: static-code)
- `inventory` → `logistics` (canaux: static-code)
- `logistics` → `infrastructure` (canaux: static-code)
- `logistics` → `loyalty` (canaux: static-code)
- `logistics` → `notifications` (canaux: static-code)
- `logistics` → `payments` (canaux: static-code)
- `logistics` → `purchasing` (canaux: static-code)
- `loyalty` → `auth` (canaux: static-code)
- `loyalty` → `infrastructure` (canaux: static-code)
- `loyalty` → `notifications` (canaux: static-code)
- `notifications` → `auth` (canaux: static-code)
- `notifications` → `auth-identity` (canaux: static-code)
- `notifications` → `decision-signals` (canaux: static-code)
- `notifications` → `infrastructure` (canaux: static-code)
- `orders` → `infrastructure` (canaux: static-code)
- `orders` → `loyalty` (canaux: static-code)
- `orders` → `notifications` (canaux: static-code)
- `orders` → `payments` (canaux: static-code)
- `payments` → `auth` (canaux: static-code)
- `payments` → `documents` (canaux: static-code)
- `payments` → `infrastructure` (canaux: static-code)
- `payments` → `logistics` (canaux: static-code, interface)
- `payments` → `loyalty` (canaux: static-code)
- `payments` → `notifications` (canaux: static-code)
- `payments` → `platform-ops` (canaux: static-code)
- `payments` → `purchasing` (canaux: static-code)
- `payments` → `refunds` (canaux: static-code)
- `payments` → `wallet` (canaux: interface)
- `platform-ops` → `auth` (canaux: static-code)
- `platform-ops` → `catalog` (canaux: static-code)
- `platform-ops` → `economic-engine` (canaux: static-code)
- `platform-ops` → `infrastructure` (canaux: static-code)
- `platform-ops` → `logistics` (canaux: static-code)
- `platform-ops` → `orders` (canaux: static-code)
- `platform-ops` → `payments` (canaux: static-code)
- `platform-ops` → `purchasing` (canaux: static-code)
- `platform-ops` → `shared-cart` (canaux: static-code)
- `purchasing` → `infrastructure` (canaux: static-code)
- `purchasing` → `logistics` (canaux: static-code)
- `purchasing` → `notifications` (canaux: static-code)
- `recommendations` → `infrastructure` (canaux: static-code)
- `refunds` → `infrastructure` (canaux: static-code)
- `shared-cart` → `auth-identity` (canaux: static-code)
- `shared-cart` → `infrastructure` (canaux: static-code)
- `shared-cart` → `loyalty` (canaux: static-code)
- `shared-cart` → `notifications` (canaux: static-code)
- `shared-cart` → `payments` (canaux: static-code)
- `shared-cart` → `refunds` (canaux: static-code)
- `sourcing` → `infrastructure` (canaux: static-code)
- `unsold-resolution` → `infrastructure` (canaux: static-code)
- `wallet` → `auth` (canaux: static-code)
- `wallet` → `documents` (canaux: static-code)
- `wallet` → `infrastructure` (canaux: static-code)
- `wallet` → `payments` (canaux: static-code)

### Declared without observed evidence (canal A/D uniquement — ne signifie pas "dépendance inexistante")

- `auth` → `orders` (déclaré : `orders`)
- `catalog` → `shared-cart` (déclaré : `shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)`)
- `customs` → `logistics` (déclaré : `logistics (colis a classer)`)
- `dashboard` → `payments` (déclaré : `payments (lecture paiements)`)
- `dashboard` → `inventory` (déclaré : `inventory (lecture stock)`)
- `dashboard` → `wallet` (déclaré : `wallet (soldes et crédits)`)
- `dashboard` → `recommendations` (déclaré : `recommendations`)
- `documents` → `orders` (déclaré : `orders, customs, wallet, refunds (donnees source du document)`)
- `documents` → `customs` (déclaré : `orders, customs, wallet, refunds (donnees source du document)`)
- `documents` → `wallet` (déclaré : `orders, customs, wallet, refunds (donnees source du document)`)
- `documents` → `refunds` (déclaré : `orders, customs, wallet, refunds (donnees source du document)`)
- `economic-engine` → `wallet` (déclaré : `wallet`)
- `incident-management` → `logistics` (déclaré : `logistics (scan-engine écrit incidents — SQL inline)`)
- `incident-management` → `payments` (déclaré : `payments (reconciliation-service écrit incidents — SQL inline)`)
- `incident-management` → `notifications` (déclaré : `notifications (alert-engine écrit incidents — SQL inline)`)
- `incident-management` → `dashboard` (déclaré : `dashboard / ops-api legacy (écrit incidents — SQL inline)`)
- `inventory` → `catalog` (déclaré : `catalog (produit concerne)`)
- `logistics` → `customs` (déclaré : `customs (statut declaration)`)
- `logistics` → `economic-engine` (déclaré : `economic-engine`)
- `logistics` → `wallet` (déclaré : `wallet`)
- `loyalty` → `auth-identity` (déclaré : `auth-identity (identification du client)`)
- `loyalty` → `wallet` (déclaré : `wallet (aucune écriture — v_loyalty_summary et le calcul de palier ne lisent pas les tables wallet)`)
- `orders` → `purchasing` (déclaré : `purchasing (lecture — engagement fournisseur déclenché par une commande ; scindée d'orders au Lot O1.4)`)
- `orders` → `dashboard` (déclaré : `dashboard`)
- `recommendations` → `catalog` (déclaré : `catalog (lecture produit)`)
- `recommendations` → `auth` (déclaré : `auth`)
- `recommendations` → `logistics` (déclaré : `logistics`)
- `refunds` → `orders` (déclaré : `orders (commande source)`)
- `refunds` → `shared-cart` (déclaré : `shared-cart (panier source)`)
- `shared-cart` → `wallet` (déclaré : `wallet`)
- `unsold-resolution` → `orders` (déclaré : `orders (commande source de l'invendu)`)
- `unsold-resolution` → `catalog` (déclaré : `catalog (produit concerné)`)

### Transversal topology (consumer = local-manifest frontend-transversal, hors ontology gap)

- `boutique-manifest:boutique` → auth-identity (interface), catalog (interface), catalog (static-code), logistics (interface), orders (interface), payments (static-code), platform-ops (interface), purchasing (interface), recommendations (interface), recommendations (static-code), shared-cart (interface), shared-cart (static-code), wallet (static-code)

### Local-manifest dependencies without canonical consumer (ontology gap, KNOWN_DEBT)

- `boutique-manifest:tracking` → auth-identity (interface), auth-identity (static-code), logistics (interface), orders (interface)

### Ambiguous owners / providers (jamais collapsés arbitrairement)

- none

### Interface consumer unresolved (canal D)

- none

### Dynamic dependencies non résolues statiquement (limitation du modèle, jamais inventées)

- scope `backend` : 14 appel(s) — ex. `scripts/boutique-ownership-full-check.js`: `path.join(abs, f`, `scripts/contract-generate.js`: `...`, `scripts/feature-audit.js`: `full`

## O6 — Dependency Disposition

> Couche de qualification/décision au-dessus des paires O5 `OBSERVED_UNDECLARED`. O6 classifie et gouverne la dette ; **O6 ne remédie pas** encore les coutures cross-feature. Détail par paire : `docs/O6_INVENTORY.md`. Enforcement : `npm run business-graph:disposition-check`.

Composition-root owners (dérivés de l'ownership des fichiers wiring, pas du nom) : `infrastructure`.

### Summary by family

| Family | N | Policy |
|---|---|---|
| PROJECTION | 9 | projection-dependency-policy |
| COMPOSITION_ROOT_WIRING | 9 | application-wiring-not-consumption |
| NON_RUNTIME_TEST | 9 | non-runtime-evidence |
| TECHNICAL_PRIMITIVE | 33 | technical-dependency-policy |
| BUSINESS_TRANSVERSAL_SERVICE | 11 | business-dependency-declare-candidate |
| CROSS_FEATURE_DIRECT_IMPORT | 18 | boundary-remediation-required |
| BUSINESS_FEATURE_INTERFACE | 3 | business-dependency-declare-candidate |
| PILOTING_CAPABILITY | 2 | piloting-capability-dependency |
| UNCLASSIFIED | 0 | _(bloquant si > 0)_ |
| **TOTAL** | **94** | |

### Projection dependencies

Vues Dash → endpoint backend. Jamais dans un `contract.consumes` backend.

- `admin-dashboard` → `catalog` — interface, RUNTIME_ONLY
- `admin-dashboard` → `customs` — interface, RUNTIME_ONLY
- `admin-dashboard` → `dashboard` — interface, RUNTIME_ONLY
- `admin-dashboard` → `decision-signals` — interface, RUNTIME_ONLY
- `admin-dashboard` → `economic-engine` — interface, RUNTIME_ONLY
- `admin-dashboard` → `inventory` — interface, RUNTIME_ONLY
- `admin-dashboard` → `logistics` — interface, RUNTIME_ONLY
- `admin-dashboard` → `orders` — interface, RUNTIME_ONLY
- `admin-dashboard` → `payments` — interface, RUNTIME_ONLY

### Composition root wiring

Bootstrap/cron/error-handler qui montent ou déclenchent une feature. Pas une consommation de service.

- `infrastructure` → `auth-identity` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `decision-signals` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `loyalty` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `notifications` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `payments` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `platform-ops` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `purchasing` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `sourcing` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `unsold-resolution` — business-file-import, RUNTIME_ONLY

### Non-runtime test evidence

Preuves 100 % tests/. Visible mais hors dette de contrat runtime.

- `auth-identity` → `logistics` — business-file-import, TEST_ONLY
- `auth` → `auth-identity` — business-file-import, TEST_ONLY
- `auth` → `notifications` — business-file-import, TEST_ONLY
- `economic-engine` → `logistics` — business-file-import, TEST_ONLY
- `inventory` → `logistics` — business-file-import, TEST_ONLY
- `platform-ops` → `catalog` — business-file-import, TEST_ONLY
- `platform-ops` → `payments` — business-file-import, TEST_ONLY
- `platform-ops` → `purchasing` — business-file-import, TEST_ONLY
- `platform-ops` → `shared-cart` — business-file-import, TEST_ONLY

### Technical primitives

Usage de db.js / middleware / logger / utils / validators d'un transversal technique. Politique technique, pas `contract.consumes`.

- `auth-identity` → `auth` — technical-primitive, RUNTIME_ONLY
- `auth-identity` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `auth` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `catalog` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `customs` → `infrastructure` — technical-primitive, RUNTIME_ONLY
- `dashboard` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `decision-signals` → `auth` — technical-primitive, RUNTIME_ONLY
- `decision-signals` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `documents` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `economic-engine` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `incident-management` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `inventory` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `logistics` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `loyalty` → `auth` — technical-primitive, RUNTIME_ONLY
- `loyalty` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `notifications` → `auth` — technical-primitive, RUNTIME_ONLY
- `notifications` → `auth-identity` — business-file-import, RUNTIME_AND_TEST _(exception: runtime-cycle)_
- `notifications` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `orders` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `payments` → `auth` — technical-primitive, RUNTIME_ONLY
- `payments` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `payments` → `platform-ops` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `auth` — technical-primitive, RUNTIME_ONLY
- `platform-ops` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `purchasing` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `recommendations` → `infrastructure` — technical-primitive, RUNTIME_ONLY
- `refunds` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `shared-cart` → `auth-identity` — business-file-import, RUNTIME_ONLY
- `shared-cart` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST
- `sourcing` → `infrastructure` — technical-primitive, RUNTIME_ONLY
- `unsold-resolution` → `infrastructure` — technical-primitive, RUNTIME_ONLY
- `wallet` → `auth` — technical-primitive, RUNTIME_ONLY
- `wallet` → `infrastructure` — technical-primitive, RUNTIME_AND_TEST

### Business transversal services

Consommation réelle d'un service transversal métier — candidat `contract.consumes` (internal API préférée).

- `auth-identity` → `notifications` — business-file-import, RUNTIME_ONLY _(exception: runtime-cycle)_
- `logistics` → `notifications` — business-file-import, RUNTIME_AND_TEST
- `loyalty` → `notifications` — business-file-import, RUNTIME_AND_TEST
- `orders` → `notifications` — business-file-import, RUNTIME_AND_TEST
- `payments` → `documents` — business-file-import, RUNTIME_AND_TEST
- `payments` → `notifications` — business-file-import, RUNTIME_AND_TEST
- `payments` → `refunds` — business-file-import, RUNTIME_AND_TEST
- `purchasing` → `notifications` — business-file-import, RUNTIME_AND_TEST
- `shared-cart` → `notifications` — business-file-import, RUNTIME_AND_TEST
- `shared-cart` → `refunds` — business-file-import, RUNTIME_ONLY
- `wallet` → `documents` — business-file-import, RUNTIME_AND_TEST

### Cross-feature direct imports

require() direct d'un fichier d'une autre business-feature — couture à casser AVANT déclaration.

- `auth-identity` → `orders` — business-file-import, RUNTIME_ONLY _(exception: direct-import, ownership-suspect)_
- `dashboard` → `catalog` — business-file-import, RUNTIME_ONLY _(exception: direct-import)_
- `dashboard` → `purchasing` — business-file-import, RUNTIME_AND_TEST _(exception: direct-import)_
- `economic-engine` → `loyalty` — business-file-import, RUNTIME_ONLY _(exception: direct-import)_
- `logistics` → `loyalty` — business-file-import, RUNTIME_AND_TEST _(exception: direct-import)_
- `logistics` → `payments` — business-file-import, RUNTIME_ONLY _(exception: direct-import, runtime-cycle)_
- `logistics` → `purchasing` — business-file-import, RUNTIME_ONLY _(exception: direct-import, runtime-cycle)_
- `orders` → `loyalty` — business-file-import, RUNTIME_AND_TEST _(exception: direct-import)_
- `orders` → `payments` — business-file-import, RUNTIME_AND_TEST _(exception: direct-import)_
- `payments` → `loyalty` — business-file-import, RUNTIME_ONLY _(exception: direct-import)_
- `payments` → `purchasing` — business-file-import, RUNTIME_AND_TEST _(exception: direct-import)_
- `platform-ops` → `economic-engine` — business-file-import, RUNTIME_ONLY _(exception: direct-import, ownership-suspect)_
- `platform-ops` → `logistics` — business-file-import, RUNTIME_AND_TEST _(exception: direct-import, ownership-suspect)_
- `platform-ops` → `orders` — business-file-import, RUNTIME_AND_TEST _(exception: direct-import, ownership-suspect)_
- `purchasing` → `logistics` — business-file-import, RUNTIME_ONLY _(exception: direct-import, runtime-cycle)_
- `shared-cart` → `loyalty` — business-file-import, RUNTIME_AND_TEST _(exception: direct-import)_
- `shared-cart` → `payments` — business-file-import, RUNTIME_ONLY _(exception: direct-import)_
- `wallet` → `payments` — business-file-import, RUNTIME_ONLY _(exception: direct-import, runtime-cycle)_

### Business feature interfaces

Consommation d'une business-feature via interface/http — candidat `contract.consumes`.

- `decision-signals` → `logistics` — technical-primitive, RUNTIME_ONLY
- `payments` → `logistics` — mixed, RUNTIME_AND_TEST _(exception: runtime-cycle)_
- `payments` → `wallet` — interface, RUNTIME_ONLY _(exception: runtime-cycle)_

### Piloting capability dependencies

Consommation de decision-signals (capacité de pilotage).

- `dashboard` → `decision-signals` — business-file-import, RUNTIME_AND_TEST
- `notifications` → `decision-signals` — business-file-import, RUNTIME_AND_TEST

### Exceptions requiring human decision

Ledger `governance/feature-dependency-exceptions.json` — uniquement les paires dont la politique de famille ne suffit pas (imports directs, cycles, ownership suspects). Une entrée dont la paire disparaît d'O5 devient stale (bloquant).

- `auth-identity` → `notifications` — **boundary-to-break** — BUSINESS_TRANSVERSAL_SERVICE — preuve: routes/client-auth.js -> services/notification-service.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration.
- `auth-identity` → `orders` — **ownership-review** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/authkey-client.js -> services/invoice-public-token.js. Transversal technique important directement un fichier de business-feature : revoir l'ownership avant toute déclaration.
- `dashboard` → `catalog` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/admin/index.js -> routes/admin/catalog-approval.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `dashboard` → `purchasing` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/admin/system.js -> services/repair-ordered-without-purchase-orders.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `economic-engine` → `loyalty` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/admin-finance-config.js -> services/loyalty-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `logistics` → `loyalty` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/scan-operations.js -> routes/loyalty.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `logistics` → `payments` — **boundary-to-break** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/parcel-auto-create-service.js -> services/payment-service.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration.
- `logistics` → `purchasing` — **boundary-to-break** — CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/pickup-secret.js -> routes/purchasing.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration.
- `notifications` → `auth-identity` — **boundary-to-break** — TECHNICAL_PRIMITIVE — preuve: services/notifications/internals.js -> services/authkey-client.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration.
- `orders` → `loyalty` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/verify-qr-collection.js -> routes/loyalty.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `orders` → `payments` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/admin-order-refund.js -> services/payment-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `payments` → `logistics` — **boundary-to-break** — BUSINESS_FEATURE_INTERFACE — preuve: services/payment-paypal.js -> routes/pickup-secret.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration.
- `payments` → `loyalty` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/payment-cash-confirm.js -> services/loyalty-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `payments` → `purchasing` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/cash.js -> services/purchasing-trigger-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `payments` → `wallet` — **boundary-to-break** — BUSINESS_FEATURE_INTERFACE — preuve: public/boutique/js/b-checkout.js -> /api/wallet. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration.
- `platform-ops` → `economic-engine` — **ownership-review** — CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/modules.js -> services/pricing-engine.js. Transversal technique important directement un fichier de business-feature : revoir l'ownership avant toute déclaration.
- `platform-ops` → `logistics` — **ownership-review** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/simulator/state-advancer.js -> services/parcel-operations.js. Transversal technique important directement un fichier de business-feature : revoir l'ownership avant toute déclaration.
- `platform-ops` → `orders` — **ownership-review** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/simulator/state-advancer.js -> services/order-status-machine.js. Transversal technique important directement un fichier de business-feature : revoir l'ownership avant toute déclaration.
- `purchasing` → `logistics` — **boundary-to-break** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/purchasing-receive-service.js -> routes/scans.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration.
- `shared-cart` → `loyalty` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: routes/shared-cart.js -> services/loyalty-service.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `shared-cart` → `payments` — **internal-api-required** — CROSS_FEATURE_DIRECT_IMPORT — preuve: public/boutique/js/b-share-cart.js -> public/boutique/js/b-checkout.js. Import direct cross-feature : exposer une internal API / interface avant de déclarer contract.consumes.
- `wallet` → `payments` — **boundary-to-break** — CROSS_FEATURE_DIRECT_IMPORT — preuve: services/wallet-service.js -> services/payment-service.js. Direction d'un cycle runtime réel : couture à casser ou dépendance à inverser avant déclaration.

### Runtime cycles

Cycles runtime réels (après exclusion test-only + composition-root). Chaque direction porte une décision dans le ledger.

- `auth-identity` ↔ `notifications` — auth-identity→notifications (BUSINESS_TRANSVERSAL_SERVICE) ; notifications→auth-identity (TECHNICAL_PRIMITIVE)
- `logistics` ↔ `payments` — logistics→payments (CROSS_FEATURE_DIRECT_IMPORT) ; payments→logistics (BUSINESS_FEATURE_INTERFACE)
- `logistics` ↔ `purchasing` — logistics→purchasing (CROSS_FEATURE_DIRECT_IMPORT) ; purchasing→logistics (CROSS_FEATURE_DIRECT_IMPORT)
- `payments` ↔ `wallet` — payments→wallet (BUSINESS_FEATURE_INTERFACE) ; wallet→payments (CROSS_FEATURE_DIRECT_IMPORT)

### Ontology gap coverage (flux local-manifest séparé, hors paires)

`tracking` et consorts vivent dans `model.o5.localManifestDependenciesWithoutCanonicalConsumer`, pas dans les paires `from → to`. Couverture par le registre ontologique autoritaire.

- `tracking` → auth-identity, logistics, orders — couvert

### Unclassified dependencies

- _none_ (gate vert)

