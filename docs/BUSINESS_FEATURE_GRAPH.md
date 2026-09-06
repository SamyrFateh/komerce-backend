# Business Feature Graph — Komerce (Lot O3)

> Généré par `scripts/business-graph-gen.js`. Ne pas éditer à la main.
> Source d'autorité : FEATURE_DOCTRINE > APP_FEATURE_REGISTRY > features/*.feature.js > ce document.
> Vérifié par `node scripts/business-graph-gen.js --check` (`npm run business-graph:check`).

## Feature Map

### Business features

- `auth-identity`
- `auth-passkey`
- `catalog`
- `customs`
- `economic-engine`
- `inventory`
- `local-stock`
- `logistics`
- `loyalty`
- `market`
- `orders`
- `payments`
- `providers-services`
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
| backend | 29 | 29 | 397 | 397 | 0 |
| dash | 3 | 3 | N/A | N/A | N/A |
| boutique | 16 | 16 | 104 | 104 | 0 |

_dash_ : pas de Technical Architecture Graph propre au dépôt dash dans ce pipeline — non scanné par arch:gen backend, couverture non mesurable ici (SCOPE, pas un gap)

### Identités canoniques

- **Cross-repo features** (11) : `auth-identity`, `auth-passkey`, `catalog`, `notifications`, `orders`, `payments`, `platform-ops`, `providers-services`, `recommendations`, `shared-cart`, `wallet`
- **Single-repo features** (22) : `admin-dashboard`, `auth`, `business-rules`, `customs`, `dashboard`, `decision-signals`, `documents`, `economic-engine`, `incident-management`, `infrastructure`, `inventory`, `legacy-control-tower`, `local-stock`, `logistics`, `loyalty`, `market`, `platform`, `purchasing`, `refunds`, `sourcing`, `unsold-resolution`, `wallet-loyalty`
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
- dependencies (consumes): 11 — catalog, customs, dashboard, decision-signals, documents, economic-engine, inventory, logistics, orders, payments, sourcing
- consumers: 0

### auth _(technical-transversal)_

> Fournir les gardes transverses d'authentification et de vérification d'identité (middlewares JWT/session/rôles) consommées par toutes les autres features.

- middleware: 7
- utils: 4
- tests: 13
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 6
- dependencies (consumes): 3 — auth-identity, infrastructure, notifications
- consumers: 23 — auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, documents, economic-engine, infrastructure, inventory, logistics, loyalty, notifications, orders, payments, platform-ops, providers-services, purchasing, shared-cart, sourcing, unsold-resolution, wallet, decision-signals

### auth-identity _(business-feature)_

> Authentifier un utilisateur et gérer son identité active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposées.

- services: 3
- routes: 3
- boutique: 3
- utils: 1
- migrations: 2
- tests: 8
- tables owned (lifecycle): 4 — `revoked_tokens`, `users`, `otp_codes`, `user_pickup_authorizations`
- tables written: 4
- interfaces exposed: 22
- internal APIs: 12
- dependencies (consumes): 11 — orders, loyalty, logistics, catalog, platform-ops, infrastructure, auth, auth-passkey, notifications, wallet, documents
- consumers: 16 — auth, auth-passkey, business-rules, catalog, dashboard, documents, economic-engine, logistics, loyalty, notifications, orders, payments, platform-ops, providers-services, shared-cart, wallet

### auth-passkey _(business-feature)_

> Gérer le cycle de vie Passkey Komerce : enrôlement, login nominal, métadonnées sûres et révocation explicite des authentificateurs du compte (AUTH-2→7).

- services: 3
- routes: 1
- migrations: 2
- tests: 8
- tables owned (lifecycle): 2 — `webauthn_credentials`, `webauthn_challenges`
- tables written: 2
- interfaces exposed: 8
- internal APIs: 0
- dependencies (consumes): 4 — auth, auth-identity, infrastructure, platform-ops
- consumers: 1 — auth-identity

### business-rules _(business-transversal)_

> Detenir le referentiel des regles metier parametrables, versionner chaque changement, et servir a toute feature la valeur en vigueur avec un repli garanti sur la valeur codee en dur.

- utils: 1
- routes: 1
- tests: 2
- tables owned (lifecycle): 2 — `business_rules`, `business_rules_history`
- tables written: 2
- interfaces exposed: 5
- internal APIs: 4
- dependencies (consumes): 3 — auth-identity, auth, infrastructure
- consumers: 8 — catalog, dashboard, economic-engine, logistics, orders, payments, platform-ops, decision-signals

### catalog _(business-feature)_

> Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.

- middleware: 1
- ci: 6
- utils: 1
- scripts: 2
- services: 42
- schemas: 4
- migrations: 14
- config: 1
- docs: 11
- routes: 6
- boutique: 39
- dash: 4
- tests: 62
- tables owned (lifecycle): 14 — `products`, `boutique_categories`, `boutique_subcategories`, `catalog_field_overrides`, `catalog_enrichment_runs`, `catalog_media`, `product_skus`, `product_sku_media`, `product_variants`, `product_content_profile`, `product_content_sections`, `product_attributes`, `supplier_catalog_imports`, `supplier_catalog_sync_checkpoints`
- tables written: 14
- interfaces exposed: 31
- internal APIs: 6
- dependencies (consumes): 11 — notifications, auth-identity, platform-ops, infrastructure, business-rules, economic-engine, sourcing, logistics, shared-cart, auth, orders
- consumers: 16 — auth-identity, customs, documents, economic-engine, infrastructure, inventory, local-stock, logistics, orders, platform-ops, purchasing, recommendations, shared-cart, sourcing, unsold-resolution, admin-dashboard

### customs _(business-feature)_

> Classer et declarer un colis douanierement ; la declaration est le pivot, jamais une optimisation.

- services: 3
- routes: 3
- migrations: 6
- dash: 2
- tests: 6
- tables owned (lifecycle): 3 — `customs_categories`, `customs_shipment_parcels`, `customs_shipments`
- tables written: 3
- interfaces exposed: 20
- internal APIs: 0
- dependencies (consumes): 7 — catalog, orders, logistics, infrastructure, documents, auth, economic-engine
- consumers: 6 — dashboard, documents, economic-engine, infrastructure, orders, admin-dashboard

### dashboard _(business-transversal)_

> Exposer les agrégats de pilotage et porter la transition UI vers un admin canonique greenfield, global pour Komerce et strictement scopé par marché pour les partenaires opérateurs pays, sans réutiliser les deux générations historiques de dashboards.

- middleware: 1
- services: 23
- routes: 24
- migrations: 2
- dash: 98
- tests: 65
- tables owned (lifecycle): 2 — `order_incidents`, `partners`
- tables written: 14
- interfaces exposed: 63
- internal APIs: 0
- dependencies (consumes): 18 — shared-cart, incident-management, orders, infrastructure, payments, logistics, inventory, economic-engine, wallet, auth, auth-identity, customs, documents, notifications, purchasing, business-rules, decision-signals, market
- consumers: 4 — economic-engine, infrastructure, sourcing, admin-dashboard

### decision-signals _(piloting-capability)_

> Detecter et qualifier des signaux operationnels (cash, colis, incidents) a partir des donnees produites par plusieurs features, pour l'aide a la decision admin.

- middleware: 1
- services: 9
- routes: 2
- migrations: 1
- tests: 13
- tables owned (lifecycle): 1 — `signals`
- tables written: 1
- interfaces exposed: 5
- internal APIs: 0
- dependencies (consumes): 4 — auth, infrastructure, logistics, business-rules
- consumers: 2 — dashboard, admin-dashboard

### documents _(business-transversal)_

> Generer et conserver un PDF officiel privé (facture, remboursement, wallet, retrait, douane) après événement confirmé ; exposer au client authentifié uniquement ses factures et remboursements essentiels.

- services: 7
- routes: 3
- migrations: 7
- utils: 5
- tests: 14
- tables owned (lifecycle): 2 — `invoices`, `transaction_documents`
- tables written: 2
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 9 — logistics, catalog, auth, infrastructure, orders, customs, wallet, refunds, auth-identity
- consumers: 10 — auth-identity, customs, dashboard, logistics, orders, payments, platform-ops, refunds, wallet, admin-dashboard

### economic-engine _(business-feature)_

> Calculer le prix, le cout et la marge d'un produit ou d'une commande selon une strategie tarifaire versionnee.

- utils: 3
- middleware: 1
- services: 30
- routes: 13
- migrations: 21
- dash: 6
- tests: 57
- tables owned (lifecycle): 19 — `exchange_rates`, `order_item_real_cost_allocations`, `charges`, `competitor_prices`, `cost_benchmarks`, `cost_component_events`, `cost_component_market_override_events`, `cost_component_market_overrides`, `cost_components`, `economic_snapshots`, `finance_config`, `price_history`, `pricing_category_dims`, `pricing_category_taxes`, `pricing_components`, `pricing_matrices_audit`, `pricing_strategies`, `pricing_strategy_history`, `risk_provisions`
- tables written: 19
- interfaces exposed: 88
- internal APIs: 2
- dependencies (consumes): 13 — refunds, platform-ops, customs, business-rules, auth-identity, market, infrastructure, logistics, catalog, auth, dashboard, orders, loyalty
- consumers: 9 — catalog, customs, dashboard, infrastructure, loyalty, orders, platform-ops, sourcing, admin-dashboard

### incident-management _(business-transversal)_

> Détecter, qualifier et résoudre les écarts entre l'état attendu et l'état réel d'une opération, avec impact client traçable.

- services: 2
- tests: 2
- tables owned (lifecycle): 1 — `incidents`
- tables written: 1
- interfaces exposed: 0
- internal APIs: 12
- dependencies (consumes): 3 — orders, infrastructure, logistics
- consumers: 5 — dashboard, logistics, notifications, payments, platform-ops

### infrastructure _(technical-foundation)_

> Infrastructure transversale consommée par toutes les features : middleware non-auth (error-handler, rate-limit, request-id, upload, validate), utilitaires partagés (logger, phone, rates, reference, rules), barrel de validation Joi, et bootstrap applicatif (Express, routes, crons, env, sécurité, migrations startup).

- middleware: 6
- utils: 4
- validators: 1
- bootstrap: 9
- migrations: 8
- scripts: 91
- docs: 60
- ci: 26
- assets: 29
- db: 16
- routes: 1
- config: 12
- tests: 18
- tables owned (lifecycle): 1 — `schema_migrations`
- tables written: 5
- interfaces exposed: 4
- internal APIs: 11
- dependencies (consumes): 14 — auth, catalog, customs, dashboard, economic-engine, inventory, logistics, notifications, platform-ops, orders, payments, recommendations, shared-cart, wallet
- consumers: 28 — auth, auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, documents, economic-engine, incident-management, inventory, local-stock, logistics, loyalty, market, notifications, orders, payments, platform-ops, providers-services, purchasing, recommendations, refunds, shared-cart, sourcing, unsold-resolution, wallet, decision-signals

### inventory _(business-feature)_

> Réceptionner, affecter et dispatcher les articles au hub.

- services: 1
- routes: 1
- dash: 1
- tests: 4
- tables owned (lifecycle): 1 — `inventory_items`
- tables written: 1
- interfaces exposed: 8
- internal APIs: 0
- dependencies (consumes): 5 — orders, catalog, logistics, infrastructure, auth
- consumers: 3 — dashboard, infrastructure, admin-dashboard

### legacy-control-tower _(deprecated)_

> Ancien control tower — deprecated.

- js: 37
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 0
- consumers: 0

### local-stock _(business-feature)_

> Porter le stock physique vendable local, calculer la disponibilité nette des allocations actives, projeter une disponibilité publique minimale et engager/consommer/libérer ce stock dans le cycle commande.

- services: 2
- routes: 1
- tests: 4
- tables owned (lifecycle): 2 — `local_stock`, `local_stock_allocations`
- tables written: 2
- interfaces exposed: 0
- internal APIs: 5
- dependencies (consumes): 4 — catalog, market, logistics, infrastructure
- consumers: 3 — orders, providers-services, recommendations

### logistics _(business-feature)_

> Faire transiter un colis du scan initial au retrait final, avec tracking client et transporteur.

- middleware: 1
- migrations: 2
- docs: 4
- utils: 3
- services: 23
- routes: 18
- boutique: 1
- dash: 2
- tests: 45
- tables owned (lifecycle): 11 — `parcels`, `relais`, `parcel_items`, `scan_events`, `scans`, `pickup_print_tokens`, `pickup_reveal_codes`, `carriers`, `parcel_events`, `pickup_verify_attempts`, `shipments`
- tables written: 11
- interfaces exposed: 70
- internal APIs: 15
- dependencies (consumes): 14 — documents, incident-management, infrastructure, business-rules, orders, auth, auth-identity, catalog, notifications, payments, refunds, purchasing, loyalty, market
- consumers: 18 — auth-identity, catalog, customs, dashboard, documents, economic-engine, incident-management, infrastructure, inventory, local-stock, notifications, orders, payments, platform-ops, purchasing, recommendations, admin-dashboard, decision-signals

### loyalty _(business-feature)_

> Calculer et maintenir le statut de fidelite d'un client (palier + compteur gros panier) et ses recompenses.

- services: 1
- routes: 2
- tests: 4
- tables owned (lifecycle): 2 — `loyalty_tiers`, `loyalty_rewards`
- tables written: 2
- interfaces exposed: 12
- internal APIs: 0
- dependencies (consumes): 6 — orders, economic-engine, infrastructure, auth, notifications, auth-identity
- consumers: 5 — auth-identity, economic-engine, logistics, orders, payments

### market _(business-feature)_

> Porter le référentiel des marchés ouverts (pays, devise) et l'historique d'accès des opérateurs à un marché — jamais le settlement ni l'attribution économique, qui restent une primitive séparée et différée.

- migrations: 9
- services: 3
- tests: 10
- tables owned (lifecycle): 3 — `markets`, `operator_market_scopes`, `currency_parities`
- tables written: 3
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 1 — infrastructure
- consumers: 7 — dashboard, economic-engine, local-stock, logistics, orders, providers-services, recommendations

### notifications _(business-transversal)_

> Projeter une information essentielle dans l application avec acquittement propriétaire ; conserver les canaux sortants historiques séparés et best-effort.

- tests: 19
- migrations: 6
- utils: 2
- services: 13
- routes: 4
- tables owned (lifecycle): 3 — `client_notifications`, `alerts`, `notification_log`
- tables written: 3
- interfaces exposed: 6
- internal APIs: 9
- dependencies (consumes): 7 — orders, logistics, auth-identity, incident-management, platform-ops, infrastructure, auth
- consumers: 11 — auth, auth-identity, catalog, dashboard, infrastructure, logistics, loyalty, orders, payments, purchasing, shared-cart

### orders _(business-feature)_

> Faire exister une commande, de la creation au statut final, avec un cout figure et une reference lisible.

- utils: 1
- services: 16
- routes: 12
- boutique: 3
- tests: 37
- tables owned (lifecycle): 9 — `order_items`, `orders`, `order_comments`, `order_item_cost_imputations`, `order_status_history`, `recipients`, `sms_log`, `customs_history`, `disputes`
- tables written: 9
- interfaces exposed: 27
- internal APIs: 30
- dependencies (consumes): 19 — platform-ops, infrastructure, business-rules, wallet, economic-engine, logistics, catalog, local-stock, market, purchasing, loyalty, payments, auth, auth-identity, customs, documents, notifications, refunds, shared-cart
- consumers: 21 — auth-identity, catalog, customs, dashboard, documents, economic-engine, incident-management, infrastructure, inventory, logistics, loyalty, notifications, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, unsold-resolution, wallet, admin-dashboard

### payments _(business-feature)_

> Encaisser un paiement (carte, PayPal, especes au retrait) et confirmer son etat de facon idempotente.

- services: 12
- routes: 4
- migrations: 2
- boutique: 2
- tests: 20
- tables owned (lifecycle): 4 — `cash_collections`, `cash_deposits`, `paypal_events_processed`, `stripe_events_processed`
- tables written: 4
- interfaces exposed: 18
- internal APIs: 0
- dependencies (consumes): 13 — auth-identity, incident-management, infrastructure, platform-ops, auth, refunds, documents, notifications, business-rules, orders, logistics, loyalty, purchasing
- consumers: 5 — dashboard, infrastructure, logistics, orders, admin-dashboard

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
- services: 6
- routes: 5
- boutique: 6
- tests: 20
- tables owned (lifecycle): 2 — `fabrics`, `garment_models`
- tables written: 6
- interfaces exposed: 33
- internal APIs: 0
- dependencies (consumes): 12 — documents, incident-management, purchasing, catalog, auth-identity, infrastructure, business-rules, auth, economic-engine, logistics, orders, wallet
- consumers: 12 — auth-identity, auth-passkey, catalog, economic-engine, infrastructure, notifications, orders, payments, providers-services, recommendations, shared-cart, wallet

### providers-services _(business-feature)_

> Porter l’identité d’un provider tiers, ses services et offres physiques, leur exposabilité, leur nom public minimal, leurs médias publics optionnels et le cycle contextualisé de demande/rappel. La cible service_id XOR physical_offer_id porte toujours le propos connu ; le client choisit request ou callback. Aucun paiement, settlement, calendrier structuré, contact provider direct ou order Komerce n’est créé par cette interaction.

- services: 3
- routes: 1
- boutique: 2
- ci: 1
- scripts: 2
- migrations: 3
- tests: 5
- tables owned (lifecycle): 4 — `providers`, `services`, `physical_offers`, `inquiries`
- tables written: 4
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 7 — auth, auth-identity, platform-ops, market, local-stock, recommendations, infrastructure
- consumers: 1 — recommendations

### purchasing _(business-feature)_

> Transformer un besoin d'approvisionnement issu d'une commande en engagement fournisseur traçable (bon de commande), puis constater sa réception.

- services: 7
- routes: 1
- tests: 10
- tables owned (lifecycle): 3 — `product_suppliers`, `purchase_orders`, `suppliers`
- tables written: 3
- interfaces exposed: 10
- internal APIs: 3
- dependencies (consumes): 6 — catalog, infrastructure, orders, auth, notifications, logistics
- consumers: 5 — dashboard, logistics, orders, payments, platform-ops

### recommendations _(business-feature)_

> Classer et suggérer des produits boutique selon un moteur de ranking dédié. Compose aussi en mémoire un rail Discovery local mixte (DiscoveryCard — Product Komerce, produit physique tiers, service tiers) et porte sa politique éditoriale d’activation serveur, sans jamais posséder ni cloner les données sources.

- ci: 1
- scripts: 1
- services: 3
- routes: 1
- tests: 5
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 8 — catalog, platform-ops, infrastructure, logistics, orders, market, local-stock, providers-services
- consumers: 3 — infrastructure, providers-services, shared-cart

### refunds _(business-transversal)_

> Rembourser un client de facon tracable et sans double remboursement, quel que soit le flux appelant.

- utils: 1
- services: 1
- tests: 4
- tables owned (lifecycle): 1 — `refunds`
- tables written: 1
- interfaces exposed: 0
- internal APIs: 1
- dependencies (consumes): 4 — infrastructure, orders, wallet, documents
- consumers: 5 — documents, economic-engine, logistics, orders, payments

### shared-cart _(business-feature)_

> Permettre à un créateur de publier une liste immuable par lien public ; chaque acheteur sélectionne une ou plusieurs lignes disponibles, passe par le récapitulatif puis le checkout canonique sans mélanger son panier personnel ; la liste se ferme automatiquement lorsque sa dernière ligne est réclamée.

- services: 9
- routes: 4
- migrations: 20
- tests: 14
- boutique: 10
- dash: 1
- tables owned (lifecycle): 7 — `basket_items`, `baskets`, `cart_shares`, `shared_cart_events`, `shared_cart_items`, `shared_cart_saved_access`, `shared_carts`
- tables written: 7
- interfaces exposed: 16
- internal APIs: 3
- dependencies (consumes): 8 — recommendations, platform-ops, infrastructure, orders, catalog, notifications, auth, auth-identity
- consumers: 4 — catalog, dashboard, infrastructure, orders

### sourcing _(business-feature)_

> Identifier, qualifier et arbitrer des opportunités fournisseur ou produit (scan pricing, décision garder/watchlist/rejeter) avant leur entrée dans le catalogue.

- middleware: 1
- migrations: 5
- services: 3
- routes: 2
- tests: 6
- tables owned (lifecycle): 2 — `sourcing_candidates`, `sourcing_candidate_events`
- tables written: 2
- interfaces exposed: 23
- internal APIs: 2
- dependencies (consumes): 5 — infrastructure, catalog, economic-engine, auth, dashboard
- consumers: 2 — catalog, admin-dashboard

### unsold-resolution _(business-feature)_

> Arbitrer et liquider la valeur immobilisée d'une commande invendue (WhatsApp, revendeur, don, destruction).

- routes: 1
- dash: 1
- tests: 1
- tables owned (lifecycle): 1 — `unsold_items`
- tables written: 1
- interfaces exposed: 7
- internal APIs: 0
- dependencies (consumes): 4 — orders, catalog, auth, infrastructure
- consumers: 0

### wallet _(business-feature)_

> Tenir un solde client et son historique de credit/debit, avec application exactement une fois.

- services: 1
- routes: 1
- migrations: 2
- boutique: 2
- tests: 4
- tables owned (lifecycle): 4 — `wallet_transactions`, `wallets`, `wallet_consumptions`, `wallet_credit_lots`
- tables written: 4
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 6 — orders, platform-ops, infrastructure, auth, documents, auth-identity
- consumers: 7 — auth-identity, dashboard, documents, infrastructure, orders, platform-ops, refunds

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
| `alerts` | `notifications` | declared-table-owner | notifications | — |
| `basket_items` | `shared-cart` | single-writer | shared-cart | — |
| `baskets` | `shared-cart` | single-writer | shared-cart | — |
| `boutique_categories` | `catalog` | single-writer | catalog | — |
| `boutique_subcategories` | `catalog` | single-writer | catalog | — |
| `business_rules` | `business-rules` | single-writer | business-rules | dashboard, economic-engine, logistics |
| `business_rules_history` | `business-rules` | single-writer | business-rules | dashboard |
| `carriers` | `logistics` | single-writer | logistics | — |
| `cart_shares` | `shared-cart` | declared-table-owner | shared-cart | — |
| `cash_collections` | `payments` | single-writer | payments | — |
| `cash_deposits` | `payments` | single-writer | payments | — |
| `catalog_enrichment_runs` | `catalog` | single-writer | catalog | — |
| `catalog_exclusions` | _ambiguë_ | no-declared-writer | — | catalog |
| `catalog_field_overrides` | `catalog` | single-writer | catalog | — |
| `catalog_glossary` | _ambiguë_ | no-declared-writer | — | catalog |
| `catalog_media` | `catalog` | declared-table-owner | catalog | sourcing |
| `charges` | `economic-engine` | single-writer | economic-engine | — |
| `client_notifications` | `notifications` | single-writer | notifications | dashboard |
| `competitor_prices` | `economic-engine` | single-writer | economic-engine | — |
| `cost_benchmarks` | `economic-engine` | single-writer | economic-engine | — |
| `cost_component_events` | `economic-engine` | single-writer | economic-engine | — |
| `cost_component_market_override_events` | `economic-engine` | declared-table-owner | economic-engine | — |
| `cost_component_market_overrides` | `economic-engine` | declared-table-owner | economic-engine | — |
| `cost_components` | `economic-engine` | single-writer | economic-engine | — |
| `currency_parities` | `market` | declared-table-owner | market | — |
| `customs_categories` | `customs` | single-writer | customs | economic-engine |
| `customs_effective_rates` | _ambiguë_ | no-declared-writer | — | customs, dashboard |
| `customs_history` | `orders` | single-writer | orders | — |
| `customs_shipment_parcels` | `customs` | single-writer | customs | documents, economic-engine |
| `customs_shipments` | `customs` | single-writer | customs | dashboard, documents, economic-engine |
| `disputes` | `orders` | single-writer | orders | — |
| `economic_snapshots` | `economic-engine` | declared-table-owner | economic-engine, infrastructure | — |
| `economic_variables` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `exchange_rates` | `economic-engine` | single-writer | economic-engine | dashboard |
| `fabrics` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `finance_config` | `economic-engine` | single-writer | economic-engine | loyalty |
| `garment_models` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `incidents` | `incident-management` | declared-table-owner | incident-management | dashboard, logistics, notifications, payments, platform-ops |
| `inquiries` | `providers-services` | single-writer | providers-services | — |
| `inventory_items` | `inventory` | single-writer | inventory | — |
| `invoices` | `documents` | multi-writer-resolved-by-classification-signal | dashboard, documents | auth-identity, logistics, platform-ops |
| `local_stock` | `local-stock` | single-writer | local-stock | — |
| `local_stock_allocations` | `local-stock` | single-writer | local-stock | — |
| `loyalty_rewards` | `loyalty` | single-writer | loyalty | — |
| `loyalty_tiers` | `loyalty` | single-writer | loyalty | auth-identity |
| `markets` | `market` | declared-table-owner | market | local-stock, providers-services, recommendations |
| `notification_log` | `notifications` | declared-table-owner | notifications, platform-ops | — |
| `operator_market_scopes` | `market` | declared-table-owner | market | — |
| `order_comments` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | — |
| `order_incidents` | `dashboard` | single-writer | dashboard | — |
| `order_item_cost_imputations` | `orders` | single-writer | orders | dashboard, economic-engine |
| `order_item_real_cost_allocations` | `economic-engine` | declared-table-owner | economic-engine | dashboard |
| `order_items` | `orders` | declared-table-owner | dashboard, orders | auth-identity, catalog, customs, documents, economic-engine, inventory, logistics, payments, platform-ops, purchasing, recommendations, shared-cart |
| `order_status_history` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | — |
| `orders` | `orders` | declared-table-owner | dashboard, orders | auth-identity, catalog, customs, documents, economic-engine, incident-management, inventory, logistics, loyalty, notifications, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, unsold-resolution, wallet |
| `otp_codes` | `auth-identity` | single-writer | auth-identity | — |
| `parcel_events` | `logistics` | single-writer | logistics | — |
| `parcel_items` | `logistics` | declared-table-owner | logistics, platform-ops | customs, dashboard, documents, economic-engine, inventory, orders, payments |
| `parcels` | `logistics` | declared-table-owner | logistics, platform-ops | auth-identity, customs, dashboard, documents, economic-engine, incident-management, inventory, notifications, orders, payments, recommendations |
| `partners` | `dashboard` | single-writer | dashboard | — |
| `paypal_events_processed` | `payments` | single-writer | payments | — |
| `physical_offers` | `providers-services` | single-writer | providers-services | — |
| `pickup_print_tokens` | `logistics` | declared-table-owner | infrastructure, logistics | — |
| `pickup_reveal_codes` | `logistics` | declared-table-owner | infrastructure, logistics | — |
| `pickup_verify_attempts` | `logistics` | single-writer | logistics | — |
| `price_history` | `economic-engine` | declared-table-owner | economic-engine | — |
| `pricing_benchmarks` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `pricing_category_dims` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_category_taxes` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_components` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_global_access_grants` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `pricing_matrices_audit` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_strategies` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_strategy_history` | `economic-engine` | single-writer | economic-engine | — |
| `product_attributes` | `catalog` | single-writer | catalog | — |
| `product_content_profile` | `catalog` | single-writer | catalog | — |
| `product_content_sections` | `catalog` | single-writer | catalog | — |
| `product_sku_media` | `catalog` | declared-table-owner | catalog | sourcing |
| `product_skus` | `catalog` | declared-table-owner | catalog | sourcing |
| `product_suppliers` | `purchasing` | single-writer | purchasing | logistics |
| `product_variants` | `catalog` | declared-table-owner | catalog | economic-engine, logistics, orders, sourcing |
| `products` | `catalog` | declared-table-owner | catalog, dashboard | auth-identity, customs, documents, economic-engine, inventory, local-stock, logistics, orders, platform-ops, purchasing, recommendations, shared-cart, unsold-resolution |
| `providers` | `providers-services` | single-writer | providers-services | — |
| `purchase_orders` | `purchasing` | declared-table-owner | purchasing | logistics |
| `recipients` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | documents, economic-engine, logistics, notifications |
| `refunds` | `refunds` | single-writer | refunds | documents, economic-engine, orders |
| `relais` | `logistics` | declared-table-owner | dashboard, logistics | auth-identity, documents, economic-engine, local-stock, notifications, orders, platform-ops, purchasing |
| `revoked_tokens` | `auth-identity` | declared-table-owner | auth-identity, infrastructure | auth |
| `risk_provisions` | `economic-engine` | single-writer | economic-engine | — |
| `scan_events` | `logistics` | declared-table-owner | dashboard, logistics | incident-management, notifications, payments, platform-ops |
| `scans` | `logistics` | declared-table-owner | logistics, platform-ops | dashboard |
| `schema_migrations` | `infrastructure` | single-writer | infrastructure | — |
| `services` | `providers-services` | single-writer | providers-services | — |
| `shared_cart_events` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_items` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_saved_access` | `shared-cart` | single-writer | shared-cart | — |
| `shared_carts` | `shared-cart` | single-writer | shared-cart | — |
| `shipments` | `logistics` | single-writer | logistics | — |
| `signals` | `decision-signals` | single-writer | decision-signals | dashboard |
| `sms_log` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | — |
| `sourcing_candidate_events` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_candidates` | `sourcing` | declared-table-owner | sourcing | catalog |
| `store_credits` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `stripe_events_processed` | `payments` | single-writer | payments | — |
| `supplier_catalog_imports` | `catalog` | single-writer | catalog | sourcing |
| `supplier_catalog_sync_checkpoints` | `catalog` | single-writer | catalog | — |
| `suppliers` | `purchasing` | single-writer | purchasing | — |
| `suppliers_stats` | _ambiguë_ | no-declared-writer | — | dashboard |
| `transaction_documents` | `documents` | single-writer | documents | dashboard |
| `unsold_items` | `unsold-resolution` | single-writer | unsold-resolution | — |
| `user_pickup_authorizations` | `auth-identity` | single-writer | auth-identity | — |
| `users` | `auth-identity` | declared-table-owner | auth-identity | auth, auth-passkey, business-rules, dashboard, documents, economic-engine, logistics, loyalty, notifications, orders, payments, platform-ops, shared-cart, wallet |
| `v_loyalty_summary` | _ambiguë_ | no-declared-writer | — | loyalty |
| `v_unsold_pipeline` | _ambiguë_ | no-declared-writer | — | unsold-resolution |
| `wallet_consumptions` | `wallet` | single-writer | wallet | — |
| `wallet_credit_lots` | `wallet` | single-writer | wallet | — |
| `wallet_transactions` | `wallet` | multi-writer-resolved-by-classification-signal | dashboard, wallet | documents |
| `wallets` | `wallet` | multi-writer-resolved-by-classification-signal | dashboard, wallet | documents, refunds |
| `webauthn_challenges` | `auth-passkey` | single-writer | auth-passkey | — |
| `webauthn_credentials` | `auth-passkey` | single-writer | auth-passkey | — |

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
| `POST /api/auth/register` | auth-identity | `routes/auth.js` (resolved-owned) |
| `GET /api/client/invoices` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `POST /api/client/magic-link` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/client/magic-link/validate` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/client/orders` | auth-identity | `routes/client-auth.js` (resolved-owned) |
| `GET /api/auth/me/pickup-authorization` | auth-identity | `routes/auth.js` (resolved-owned) |
| `PUT /api/auth/me/pickup-authorization` | auth-identity | `routes/auth.js` (resolved-owned) |
| `DELETE /api/auth/me/pickup-authorization` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/passkey/register/options` | auth-passkey | `routes/auth-passkey.js` (resolved-owned) |
| `POST /api/auth/passkey/register/verify` | auth-passkey | `routes/auth-passkey.js` (resolved-owned) |
| `POST /api/auth/passkey/login/options` | auth-passkey | `routes/auth-passkey.js` (resolved-owned) |
| `POST /api/auth/passkey/login/verify` | auth-passkey | `routes/auth-passkey.js` (resolved-owned) |
| `GET /api/auth/passkey/credentials` | auth-passkey | `routes/auth-passkey.js` (resolved-owned) |
| `DELETE /api/auth/passkey/credentials/{id}` | auth-passkey | `routes/auth-passkey.js` (resolved-owned) |
| `POST /api/auth/passkey/step-up/options` | auth-passkey | `routes/auth-passkey.js` (resolved-owned) |
| `POST /api/auth/passkey/step-up/verify` | auth-passkey | `routes/auth-passkey.js` (resolved-owned) |
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
| `GET /api/admin/demo/orders/{id}/timeline` | dashboard | `routes/admin/demo-order-flow.js` (resolved-owned) |
| `GET /api/dashboard/clients` | dashboard | `routes/dashboard-clients.js` (resolved-owned) |
| `GET /api/admin/entities/clients` | dashboard | `routes/admin-client-index.js` (resolved-owned) |
| `GET /api/admin/entities/clients/market/{id}` | dashboard | `routes/admin-client-index.js` (resolved-owned) |
| `GET /api/dashboard/ops` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/dashboard/hub` | dashboard | `routes/dashboard-hub.js` (resolved-owned) |
| `GET /api/hub-dash/dashboard` | dashboard | `routes/hub-dashboard.js` (resolved-owned) |
| `GET /api/relay/dashboard` | dashboard | `routes/relay-dashboard.js` (resolved-owned) |
| `GET /api/admin/radar` | dashboard | `routes/admin-radar.js` (resolved-owned) |
| `GET /api/admin/partners` | dashboard | `routes/admin/partners.js` (resolved-owned) |
| `GET /api/admin/users` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `GET /api/admin/counts` | dashboard | `routes/admin/system.js` (resolved-owned) |
| `POST /api/admin/reset` | dashboard | `routes/admin/system.js` (resolved-owned) |
| `POST /api/admin/seed-test` | dashboard | `routes/admin/system.js` (resolved-owned) |
| `POST /api/admin/purchasing/repair-ordered-without-pos` | dashboard | `routes/admin/system.js` (resolved-owned) |
| `GET /api/admin/alerts` | dashboard | `routes/admin/dashboard.js` (resolved-owned) |
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
| `GET /api/admin/workspaces/pricing` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/simulate` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/flow` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/products/{id}/apply-price` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `GET /api/admin/workspaces/pricing/strategy` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/strategy/apply` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/competitors` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/competitors/{id}/deactivate` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/cost-components` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/cost-components/{id}/update` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/cost-components/{id}/toggle` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `GET /api/admin/workspaces/pricing/market/{id}` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/market/{id}/cost-components/{id}/update` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/market/{id}/cost-components/{id}/toggle` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/pricing/market/{id}/cost-components/{id}/reset` | economic-engine | `routes/admin-pricing-workspace.js` (resolved-owned) |
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
| `GET /api/admin/loyalty/pending` | loyalty | `routes/admin-loyalty.js` (resolved-owned) |
| `GET /api/admin/loyalty/history` | loyalty | `routes/admin-loyalty.js` (resolved-owned) |
| `POST /api/admin/loyalty/reward/{id}` | loyalty | `routes/admin-loyalty.js` (resolved-owned) |
| `POST /api/admin/loyalty/skip/{id}` | loyalty | `routes/admin-loyalty.js` (resolved-owned) |
| `GET /api/admin/loyalty/stats` | loyalty | `routes/admin-loyalty.js` (resolved-owned) |
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
| `GET /api/admin/workspaces/sourcing` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/imports` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/products/{id}/update` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/candidates/{id}/update` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/candidates/{id}/scan` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/candidates/{id}/promote` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/candidates/{id}/watchlist` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/candidates/{id}/reject` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/suppliers` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/suppliers/{id}/update` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/suppliers/{id}/deactivate` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/suppliers/{id}/activate` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
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
| `GET /api/admin/action-center` | decision-signals | `routes/admin-action-center.js` (resolved-owned) |
| `POST /api/admin/action-center/generate` | decision-signals | `routes/admin-action-center.js` (resolved-owned) |
| `POST /api/admin/action-center/signals/{id}/acknowledge` | decision-signals | `routes/admin-action-center.js` (resolved-owned) |
| `POST /api/admin/action-center/signals/{id}/snooze` | decision-signals | `routes/admin-action-center.js` (resolved-owned) |
| `POST /api/admin/action-center/signals/{id}/resolve` | decision-signals | `routes/admin-action-center.js` (resolved-owned) |

### API internes (contract.internalApi)

| Fonction | Fichier | Feature | Statut |
|---|---|---|---|
| `requireAuth / requireVerifiedIdentity / softAuth` | `middleware/auth.js` | auth | resolved |
| `requireAuth / requireVerifiedIdentity / softAuth` | `middleware/require-verified-identity.js` | auth | resolved |
| `requireAuth / requireVerifiedIdentity / softAuth` | `middleware/soft-auth.js` | auth | resolved |
| `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` | `utils/auth-session.js` | auth | resolved |
| `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` | `utils/auth-session-policy.js` | auth | resolved |
| `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` | `utils/auth-token-policy.js` | auth | resolved |
| `makeIntlPhoneInput` | `public/boutique/js/b-phone.js` | auth-identity | resolved |
| `createAdminUser` | `services/user-mutation-service.js` | auth-identity | resolved |
| `setUserRole` | `services/user-mutation-service.js` | auth-identity | resolved |
| `setUserPasswordHash` | `services/user-mutation-service.js` | auth-identity | resolved |
| `anonymizeUser` | `services/user-mutation-service.js` | auth-identity | resolved |
| `deleteUser` | `services/user-mutation-service.js` | auth-identity | resolved |
| `deleteNonAdminUsers` | `services/user-mutation-service.js` | auth-identity | resolved |
| `incrementBigBasketCount` | `services/user-mutation-service.js` | auth-identity | resolved |
| `markBigBasketNotified` | `services/user-mutation-service.js` | auth-identity | resolved |
| `recalculateUserLoyalty` | `services/user-mutation-service.js` | auth-identity | resolved |
| `getActiveAuthorizationForUpdate` | `services/pickup-authorization-service.js` | auth-identity | resolved |
| `hasActiveAuthorization` | `services/pickup-authorization-service.js` | auth-identity | resolved |
| `getRuleNumber` | `utils/rules.js` | business-rules | resolved |
| `getRule` | `utils/rules.js` | business-rules | resolved |
| `getAllRules` | `utils/rules.js` | business-rules | resolved |
| `setRule` | `utils/rules.js` | business-rules | resolved |
| `createDraftFromSourcingCandidate` | `services/product-admin-service.js` | catalog | resolved |
| `createDraftProductFromSourcingCandidate` | `services/catalog-candidate-product-service.js` | catalog | resolved |
| `applyPrice` | `services/catalog-product-mutation-service.js` | catalog | resolved |
| `updateSourcingFields` | `services/catalog-product-mutation-service.js` | catalog | resolved |
| `bulkAssignSourcingRail` | `services/catalog-product-mutation-service.js` | catalog | resolved |
| `replaceVariantsForSourcing` | `services/catalog-product-mutation-service.js` | catalog | resolved |
| `recommend` | `services/pricing-engine.js` | economic-engine | resolved |
| `recordProductPriceChange` | `services/economic-price-audit-service.js` | economic-engine | resolved |
| `listIncidents` | `services/incident-service.js` | incident-management | resolved |
| `getIncident` | `services/incident-service.js` | incident-management | resolved |
| `resolveIncident` | `services/incident-service.js` | incident-management | resolved |
| `escalateIncident` | `services/incident-service.js` | incident-management | resolved |
| `getIncidentDashboard` | `services/incident-service.js` | incident-management | resolved |
| `createScanIncident` | `services/incident-write-service.js` | incident-management | resolved |
| `createReconciliationIncident` | `services/incident-write-service.js` | incident-management | resolved |
| `createAlertEngineIncidentIfNew` | `services/incident-write-service.js` | incident-management | resolved |
| `acknowledgeAlertEngineIncident` | `services/incident-write-service.js` | incident-management | resolved |
| `resolveOpsIncident` | `services/incident-write-service.js` | incident-management | resolved |
| `detachUserFromIncidents` | `services/incident-write-service.js` | incident-management | resolved |
| `seedIncident` | `services/incident-write-service.js` | incident-management | resolved |
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
| `resolveCheckoutFulfillmentSources` | `services/local-stock-service.js` | local-stock | resolved |
| `allocateForOrderItem` | `services/local-stock-service.js` | local-stock | resolved |
| `consumeAllocationsForOrder` | `services/local-stock-service.js` | local-stock | resolved |
| `releaseAllocationsForOrder` | `services/local-stock-service.js` | local-stock | resolved |
| `previewCheckoutFulfillmentSources` | `services/local-stock-checkout-preview.js` | local-stock | resolved |
| `transitionParcelStatus` | `services/parcel-operations.js` | logistics | resolved |
| `recordHubPreparationScan` | `services/scan-write-service.js` | logistics | resolved |
| `recordQrCollectionScan` | `services/scan-write-service.js` | logistics | resolved |
| `detachUserFromScans` | `services/scan-write-service.js` | logistics | resolved |
| `assignWholeOrderItemToParcel` | `services/parcel-item-mutation-service.js` | logistics | resolved |
| `assignParcelItem` | `services/parcel-item-mutation-service.js` | logistics | resolved |
| `addParcelItem` | `services/parcel-item-mutation-service.js` | logistics | resolved |
| `removeParcelItem` | `services/parcel-item-mutation-service.js` | logistics | resolved |
| `assignSingleOrderItemToParcel` | `services/parcel-item-mutation-service.js` | logistics | resolved |
| `createHubParcel` | `services/parcel-mutation-service.js` | logistics | resolved |
| `createAutoPreparedParcel` | `services/parcel-mutation-service.js` | logistics | resolved |
| `setParcelWeight` | `services/parcel-mutation-service.js` | logistics | resolved |
| `appendParcelShipmentInfo` | `services/parcel-mutation-service.js` | logistics | resolved |
| `markCustomsCleared` | `services/parcel-mutation-service.js` | logistics | resolved |
| `markBackorderReminderSent` | `services/parcel-mutation-service.js` | logistics | resolved |
| `setNotificationOutcomeListener` | `services/notifications/internals.js` | notifications | resolved |
| `createAlert` | `utils/alerts.js` | notifications | resolved |
| `notifyOrder*` | `services/notifications/order.js` | notifications | resolved |
| `notifyParcel*` | `services/notifications/parcel.js` | notifications | resolved |
| `sendOtpMessage / sendMagicLink` | `services/notifications/otp-auth.js` | notifications | resolved |
| `notifyLoyaltyEarned` | `services/notifications/loyalty.js` | notifications | resolved |
| `notifyText` | `services/notifications/misc.js` | notifications | resolved |
| `buildRelayMapUrl / formatRelayPoint / appendRelayLocation` | `services/notifications/relay-location.js` | notifications | resolved |
| `emitOrderMilestone / emitExceptional / resolveOrderMilestones` | `services/client-notification-service.js` | notifications | resolved |
| `transitionOrderStatus` | `services/order-status-machine.js` | orders | resolved |
| `markPaid` | `services/payment-service.js` | orders | resolved |
| `markRefunded` | `services/payment-service.js` | orders | resolved |
| `markFailed` | `services/payment-service.js` | orders | resolved |
| `forcePaymentStatusForSimulation` | `services/payment-service.js` | orders | resolved |
| `setInventoryCompletion` | `services/order-mutation-service.js` | orders | resolved |
| `recomputeCustomsCosts` | `services/order-mutation-service.js` | orders | resolved |
| `backfillRoutingFields` | `services/order-mutation-service.js` | orders | resolved |
| `setStripePaymentId` | `services/order-mutation-service.js` | orders | resolved |
| `setPaypalOrderId` | `services/order-mutation-service.js` | orders | resolved |
| `setPaypalCaptureMetadata` | `services/order-mutation-service.js` | orders | resolved |
| `setPaypalCaptureId` | `services/order-mutation-service.js` | orders | resolved |
| `appendOrderNote` | `services/order-mutation-service.js` | orders | resolved |
| `markCashPaidAt` | `services/order-mutation-service.js` | orders | resolved |
| `markCashReminderSent` | `services/order-mutation-service.js` | orders | resolved |
| `setWalletApplied` | `services/order-mutation-service.js` | orders | resolved |
| `setSupplierSnapshot` | `services/order-mutation-service.js` | orders | resolved |
| `setComputedStatus` | `services/order-mutation-service.js` | orders | resolved |
| `writePickupSecret` | `services/order-mutation-service.js` | orders | resolved |
| `setPickupAttemptState` | `services/order-mutation-service.js` | orders | resolved |
| `setPickupAttemptsOnly` | `services/order-mutation-service.js` | orders | resolved |
| `setExceptionalPickupAttemptState` | `services/order-mutation-service.js` | orders | resolved |
| `setCollectedByName` | `services/order-mutation-service.js` | orders | resolved |
| `recordPickupRegeneration` | `services/order-mutation-service.js` | orders | resolved |
| `markPickupSecretRevealed` | `services/order-mutation-service.js` | orders | resolved |
| `finalizePickupCollection` | `services/order-mutation-service.js` | orders | resolved |
| `updateOrderItemAvailabilityDetails` | `services/order-item-availability-service.js` | orders | resolved |
| `setOrderItemAvailabilityStatus` | `services/order-item-availability-service.js` | orders | resolved |
| `checkoutCart` | `public/boutique/js/b-checkout.js` | orders | resolved |
| `makeInput` | `public/boutique/js/b-checkout.js` | orders | resolved |
| `triggerPurchasing` | `services/purchasing-trigger-service.js` | purchasing | resolved |
| `repairOrderedWithoutPurchaseOrders` | `services/repair-ordered-without-purchase-orders.js` | purchasing | resolved |
| `syncPurchaseOrdersOnOrderCancel` | `services/purchasing-cancel-service.js` | purchasing | resolved |
| `processRefund(orderOrCartId, reason)` | `null` | refunds | documented-signature-no-file |
| `deleteUserBasketData` | `services/shared-cart-user-cleanup.js` | shared-cart | resolved |
| `markShareConvertedToOrder` | `services/cart-share-service.js` | shared-cart | resolved |
| `closeCompletedSharedCartForOrderItems` | `services/cart-share-service.js` | shared-cart | resolved |
| `upsertCandidateFromCatalogImport` | `services/sourcing-candidate-import-service.js` | sourcing | resolved |
| `archiveMissingCandidatesFromCatalogImport` | `services/sourcing-candidate-import-service.js` | sourcing | resolved |

## Cross-feature dependencies

| Feature | consumes | Résolu ? |
|---|---|---|
| auth | auth-identity (`auth-identity`) | ✔ |
| auth | infrastructure (`infrastructure`) | ✔ |
| auth | notifications (`notifications`) | ✔ |
| auth-identity | orders (`orders (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| auth-identity | loyalty (`loyalty (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| auth-identity | logistics (`logistics (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| auth-identity | catalog (`catalog (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| auth-identity | platform-ops (`platform-ops (monitoring/exploitation transverse observé dans le code)`) | ✔ |
| auth-identity | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| auth-identity | auth (`auth (middleware/auth.js — garde authenticate/requireAdmin utilisée par routes/client-auth.js, routes/auth.js)`) | ✔ |
| auth-identity | auth-passkey (`auth-passkey (middleware/require-recent-auth.js — preuve récente exigée par les mutations de sécurité du profil)`) | ✔ |
| auth-identity | notifications (`notifications (services/notification-service.js — envoi OTP/alertes depuis routes/client-auth.js, routes/otp.js)`) | ✔ |
| auth-identity | wallet (`wallet (projection boutique account : b-komerce.js lit uniquement le solde canonique via GET /api/wallet)`) | ✔ |
| auth-identity | documents (`documents (projection boutique account : b-komerce.js liste et télécharge les factures et remboursements privés)`) | ✔ |
| auth-passkey | auth (`auth (middleware/auth.js — authenticate, utils/auth-cookie.js — setAuthCookie, utils/auth-session.js — signAuthToken, politique de session canonique AUTH-8)`) | ✔ |
| auth-passkey | auth-identity (`auth-identity (users — identité utilisateur canonique lue sans mutation)`) | ✔ |
| auth-passkey | infrastructure (`infrastructure (db.js — accès aux tables WebAuthn et users en lecture)`) | ✔ |
| auth-passkey | platform-ops (`platform-ops (utils/logger.js — journalisation structurée des événements WebAuthn)`) | ✔ |
| business-rules | auth-identity (`auth-identity (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| business-rules | auth (`auth (garde de route admin)`) | ✔ |
| business-rules | infrastructure (`infrastructure (journalisation, acces base)`) | ✔ |
| catalog | notifications (`notifications (alert persistence via utils/alerts.js)`) | ✔ |
| catalog | auth-identity (`auth-identity (projection boutique b-greeting consomme /api/auth/me pour personnaliser la surface catalogue)`) | ✔ |
| catalog | platform-ops (`platform-ops (monitoring/exploitation transverse observé dans le code)`) | ✔ |
| catalog | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| catalog | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: services/suppliers/catalog-import-orchestrator.js -> utils/rules.js ; services/catalog-product-detail.js -> utils/rules.js ; services/catalog-enrichment.js -> utils/rules.js)`) | ✔ |
| catalog | economic-engine (`economic-engine (prix produit, valorisation commerciale transport et audit price_history propriétaire)`) | ✔ |
| catalog | sourcing (`sourcing (persistence lifecycle sourcing_candidates et sourcing_candidate_events via sourcing-candidate-import-service ; catalog n execute plus de SQL direct sur ces tables)`) | ✔ |
| catalog | logistics (`logistics (rails et eligibilite transport ; le catalog ne decide jamais le rail)`) | ✔ |
| catalog | shared-cart (`shared-cart (ne pas reutiliser la modal catalogue pour la fiche snapshot)`) | ✔ |
| catalog | auth (`auth`) | ✔ |
| catalog | orders (`orders (actions panier depuis les surfaces produit boutique — preuve: b-catalog.js, render-product-card.js, b-modal-desktop-product.js, b-subcat.js, b-favs.js, b-modal-buybox-shared.js (+ tests) -> b-cart-core.js/b-cart.js, propriete orders-client canonicalFeature:orders)`) | ✔ |
| customs | catalog (`catalog (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| customs | orders (`orders (persistence via order-mutation-service ? LOT11)`) | ✔ |
| customs | logistics (`logistics (colis a classer)`) | ✔ |
| customs | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| customs | documents (`documents (facture douane generee)`) | ✔ |
| customs | auth (`auth`) | ✔ |
| customs | economic-engine (`economic-engine`) | ✔ |
| dashboard | shared-cart (`shared-cart (suppression des paniers utilisateur via API interne lifecycle-owned)`) | ✔ |
| dashboard | incident-management (`incident-management (incident persistence via incident-write-service)`) | ✔ |
| dashboard | orders (`orders (lecture commandes)`) | ✔ |
| dashboard | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| dashboard | payments (`payments (lecture paiements)`) | ✔ |
| dashboard | logistics (`logistics (lecture colis)`) | ✔ |
| dashboard | inventory (`inventory (lecture stock)`) | ✔ |
| dashboard | economic-engine (`economic-engine (métriques financières)`) | ✔ |
| dashboard | wallet (`wallet (soldes et crédits)`) | ✔ |
| dashboard | auth (`auth`) | ✔ |
| dashboard | auth-identity (`auth-identity (mutations users via services/user-mutation-service.js ? LOT12)`) | ✔ |
| dashboard | customs (`customs`) | ✔ |
| dashboard | documents (`documents`) | ✔ |
| dashboard | notifications (`notifications (réconciliation idempotente des jalons client affichés dans le cockpit de démo)`) | ✔ |
| dashboard | purchasing (`purchasing (repare les commandes sans purchase order — services/repair-ordered-without-purchase-orders.js, O7.3 provider purchasing)`) | ✔ |
| dashboard | business-rules (`business-rules (utils/rules.js — routes/dashboard-shared.js lit une règle en vigueur)`) | ✔ |
| dashboard | decision-signals (`decision-signals (services/radar-queries.js — routes/admin-radar.js)`) | ✔ |
| dashboard | market (`market (autorité horizontale des partenaires pays via requireMarketScope et operator_market_scopes)`) | ✔ |
| documents | logistics (`logistics (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| documents | catalog (`catalog (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| documents | auth (`auth (gardes authenticate/requireAdmin sur les routes documents et factures)`) | ✔ |
| documents | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| documents | orders (`orders`) | ✔ |
| documents | customs (`customs`) | ✔ |
| documents | wallet (`wallet`) | ✔ |
| documents | refunds (`refunds`) | ✔ |
| documents | auth-identity (`auth-identity`) | ✔ |
| economic-engine | refunds (`refunds (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| economic-engine | platform-ops (`platform-ops (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| economic-engine | customs (`customs (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| economic-engine | business-rules (`business-rules (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| economic-engine | auth-identity (`auth-identity (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| economic-engine | market (`market (autorité serveur des modèles Pricing pays via markets et operator_market_scopes)`) | ✔ |
| economic-engine | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| economic-engine | logistics (`logistics (FF-C1 2026-07-29 — lecture ou orchestration logistique ; preuve: services/transport-pricing.js -> services/transport-rails.js)`) | ✔ |
| economic-engine | catalog (`catalog (donnees produit source)`) | ✔ |
| economic-engine | auth (`auth`) | ✔ |
| economic-engine | dashboard (`dashboard`) | ✔ |
| economic-engine | orders (`orders`) | ✔ |
| economic-engine | loyalty (`loyalty (invalidation du cache de configuration finance apres modification admin — services/loyalty-service.js invalidateConfigCache, O7.3 provider loyalty)`) | ✔ |
| incident-management | orders (`orders (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| incident-management | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| incident-management | logistics (`logistics (scan-engine écrit incidents — SQL inline)`) | ✔ |
| infrastructure | auth (`auth — bootstrap/api-routes.js monte les routes auth`) | ✔ |
| infrastructure | catalog (`catalog — bootstrap/api-routes.js monte les routes catalog`) | ✔ |
| infrastructure | customs (`customs — bootstrap/api-routes.js monte les routes customs`) | ✔ |
| infrastructure | dashboard (`dashboard — bootstrap/api-routes.js monte les routes dashboard`) | ✔ |
| infrastructure | economic-engine (`economic-engine — bootstrap/api-routes.js monte les routes economic-engine`) | ✔ |
| infrastructure | inventory (`inventory — bootstrap/api-routes.js monte les routes inventory`) | ✔ |
| infrastructure | logistics (`logistics — bootstrap/api-routes.js monte les routes logistics`) | ✔ |
| infrastructure | notifications (`notifications — bootstrap/api-routes.js monte les routes notification`) | ✔ |
| infrastructure | platform-ops (`platform-ops — bootstrap/api-routes.js monte les routes operations`) | ✔ |
| infrastructure | orders (`orders — bootstrap/api-routes.js monte les routes orders`) | ✔ |
| infrastructure | payments (`payments — bootstrap/api-routes.js monte les routes payment`) | ✔ |
| infrastructure | recommendations (`recommendations — bootstrap/api-routes.js monte les routes recommendations`) | ✔ |
| infrastructure | shared-cart (`shared-cart — bootstrap/api-routes.js monte les routes shared-cart`) | ✔ |
| infrastructure | wallet (`wallet — bootstrap/api-routes.js monte les routes wallet`) | ✔ |
| inventory | orders (`orders (persistence via order-mutation-service ? LOT11)`) | ✔ |
| inventory | catalog (`catalog (produit concerne)`) | ✔ |
| inventory | logistics (`logistics (mutation parcel_items via parcel-item-mutation-service)`) | ✔ |
| inventory | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| inventory | auth (`auth`) | ✔ |
| local-stock | catalog (`catalog`) | ✔ |
| local-stock | market (`market`) | ✔ |
| local-stock | logistics (`logistics`) | ✔ |
| local-stock | infrastructure (`infrastructure`) | ✔ |
| logistics | documents (`documents (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| logistics | incident-management (`incident-management (incident persistence via incident-write-service)`) | ✔ |
| logistics | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| logistics | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: utils/parcels.js -> utils/rules.js ; services/parcel-operations.js -> utils/rules.js)`) | ✔ |
| logistics | orders (`orders (commande rattachee au colis)`) | ✔ |
| logistics | auth (`auth`) | ✔ |
| logistics | auth-identity (`auth-identity (autorisation nominative de retrait exceptionnel — services/pickup-authorization-service.js:getActiveAuthorizationForUpdate/hasActiveAuthorization, jamais de requête directe sur user_pickup_authorizations, Lot 5)`) | ✔ |
| logistics | catalog (`catalog`) | ✔ |
| logistics | notifications (`notifications`) | ✔ |
| logistics | payments (`payments (marque une commande payee — services/payment-service.js ; confirme un paiement cash pickup transactionnel — services/confirm-pickup-cash-payment.js ; O7.2 Cycle B)`) | ✔ |
| logistics | refunds (`refunds`) | ✔ |
| logistics | purchasing (`purchasing (declenche verification/reapprovisionnement apres collecte cash relais — services/purchasing-trigger-service.js, O7.2 Cycle C)`) | ✔ |
| logistics | loyalty (`loyalty (recalcul de palier apres collecte cash relais / scan preparation — services/loyalty-service.js recalculateLoyalty/handleOrderConfirmed, O7.3 provider loyalty)`) | ✔ |
| logistics | market (`market (autorisation de lecture Hub terrain scopée côté serveur — routes/hub.js consomme middleware/require-market-scope.js ; jamais de market_id client)`) | ✔ |
| loyalty | orders (`orders (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| loyalty | economic-engine (`economic-engine (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| loyalty | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| loyalty | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/loyalty.js -> middleware/auth.js)`) | ✔ |
| loyalty | notifications (`notifications (FF-C1 2026-07-29 — émission de message ; preuve: services/loyalty-service.js -> services/notification-service.js)`) | ✔ |
| loyalty | auth-identity (`auth-identity (identification du client)`) | ✔ |
| market | infrastructure (`infrastructure (db.js — pool de connexion Postgres, seule dépendance de middleware/require-market-scope.js)`) | ✔ |
| notifications | orders (`orders (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| notifications | logistics (`logistics (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| notifications | auth-identity (`auth-identity (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| notifications | incident-management (`incident-management (incident persistence via incident-write-service)`) | ✔ |
| notifications | platform-ops (`platform-ops (monitoring/exploitation transverse observé dans le code)`) | ✔ |
| notifications | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| notifications | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/notification-api.js -> middleware/auth.js ; routes/alerts.js -> middleware/auth.js)`) | ✔ |
| orders | platform-ops (`platform-ops (monitoring/exploitation transverse observé dans le code)`) | ✔ |
| orders | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| orders | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: routes/orders/create.js -> utils/rules.js ; routes/orders/qr.js -> utils/rules.js ; routes/orders/list.js -> utils/rules.js ; +1)`) | ✔ |
| orders | wallet (`wallet (application credit)`) | ✔ |
| orders | economic-engine (`economic-engine (cout figure a la commande)`) | ✔ |
| orders | logistics (`logistics (rattachement colis)`) | ✔ |
| orders | catalog (`catalog (lecture produit)`) | ✔ |
| orders | local-stock (`local-stock (Vague 2 D2 — allocateForOrderItem à la création de commande, consumeAllocationsForOrder/releaseAllocationsForOrder sur les transitions confirmed/cancelled ; preuve: routes/orders/create.js -> services/local-stock-service.js ; services/order-status-machine.js -> services/local-stock-service.js)`) | ✔ |
| orders | market (`market (P3 — resolveDisplaySnapshot() résout le contexte marché du client via utils/currency.js ; preuve: services/order-display-snapshot.js -> utils/currency.js)`) | ✔ |
| orders | purchasing (`purchasing (engagement fournisseur + sync annulation via syncPurchaseOrdersOnOrderCancel ; aucun SQL direct orders -> purchase_orders)`) | ✔ |
| orders | loyalty (`loyalty (remise palier au checkout + recalcul apres commande — services/loyalty-service.js getLoyaltyDiscount/recalculateLoyalty, O7.3 provider loyalty)`) | ✔ |
| orders | payments (`payments (marque un remboursement — services/payment-service.js markRefunded, O7.3 provider payments)`) | ✔ |
| orders | auth (`auth`) | ✔ |
| orders | auth-identity (`auth-identity (projection checkout boutique : identité client et téléphone)`) | ✔ |
| orders | customs (`customs`) | ✔ |
| orders | documents (`documents`) | ✔ |
| orders | notifications (`notifications (projection idempotente du retrait disponible)`) | ✔ |
| orders | refunds (`refunds`) | ✔ |
| orders | shared-cart (`shared-cart (projection frontend orders-client uniquement : consommation via shared-cart-surface-api.js / shared-cart-library-api.js ; aucun import direct des internes group/* ; côté backend, appelle services/cart-share-service.js markShareConvertedToOrder pour lier une commande à un lien de partage — campagne WRITER-NOT-OWNER 2026-08, plus de SQL direct sur cart_shares)`) | ✔ |
| payments | auth-identity (`auth-identity (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| payments | incident-management (`incident-management (incident persistence via incident-write-service)`) | ✔ |
| payments | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
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
| platform-ops | documents (`documents (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| platform-ops | incident-management (`incident-management (incident persistence via incident-write-service)`) | ✔ |
| platform-ops | purchasing (`purchasing (client API transversal appelle le référentiel fournisseurs /api/purchasing/suppliers)`) | ✔ |
| platform-ops | catalog (`catalog (shell/client API transversal monte et appelle les surfaces catalogue sans en posséder l’état)`) | ✔ |
| platform-ops | auth-identity (`auth-identity (client API transversal et shell identité consomment les endpoints auth)`) | ✔ |
| platform-ops | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| platform-ops | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: routes/config.js -> utils/rules.js)`) | ✔ |
| platform-ops | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/modules.js -> middleware/auth.js ; routes/health.js -> middleware/auth.js ; routes/ops-api.js -> middleware/auth.js ; +2)`) | ✔ |
| platform-ops | economic-engine (`economic-engine (calcul de prix ponctuel pour modules sur-mesure — services/pricing-engine.js recommend, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)`) | ✔ |
| platform-ops | logistics (`logistics (simulateur declenche une transition colis via transitionParcelStatus — services/parcel-operations.js, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)`) | ✔ |
| platform-ops | orders (`orders (simulateur délègue statuts commande/paiement à order-status-machine + payment-service ; le chaos payment reste non-production et owner-bound)`) | ✔ |
| platform-ops | wallet (`wallet (simulateur crédite les remboursements via wallet-service.credit ; aucun store_credits legacy direct)`) | ✔ |
| providers-services | auth (`auth — authenticateOrCreateGuest et session canonique côté serveur`) | ✔ |
| providers-services | auth-identity (`auth-identity — requireIdentity() côté Boutique avant mutation`) | ✔ |
| providers-services | platform-ops (`platform-ops — bus et showToast comme primitives UI transverses`) | ✔ |
| providers-services | market (`market — référentiel markets, résolution code -> id côté serveur`) | ✔ |
| providers-services | local-stock (`local-stock — déclaration et exposition du stock local Product Komerce du seed Discovery staging via les primitives owner`) | ✔ |
| providers-services | recommendations (`recommendations — réutilise le tooling Discovery CJ pour construire les candidats staging ; recommendations reste propriétaire de la sélection et de l ordre éditorial`) | ✔ |
| providers-services | infrastructure (`infrastructure — dépendance technique db.js et résolution KOMERCE_ENV`) | ✔ |
| purchasing | catalog (`catalog (dépendance data cross-feature observée et gouvernée par O5)`) | ✔ |
| purchasing | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| purchasing | orders (`orders (lecture : order_items, orders — le besoin d'achat et l'intention d'annulation naissent d'une commande client)`) | ✔ |
| purchasing | auth (`auth (garde admin)`) | ✔ |
| purchasing | notifications (`notifications (notification fournisseur WhatsApp, via services/notification-service.js)`) | ✔ |
| purchasing | logistics (`logistics (declenche scan preparation + notification client apres reception hub complete — services/scan-operations.js triggerScan3, O7.2 Cycle C)`) | ✔ |
| recommendations | catalog (`catalog (lecture produit)`) | ✔ |
| recommendations | platform-ops (`platform-ops (monitoring/exploitation transverse observé dans le code)`) | ✔ |
| recommendations | infrastructure (`infrastructure (DB et composition root)`) | ✔ |
| recommendations | logistics (`logistics`) | ✔ |
| recommendations | orders (`orders (frontière frontend orders-client/cart-public-api.js consommée par b-modal-suggestions.js)`) | ✔ |
| recommendations | market (`market (référentiel markets — résolution code -> id côté serveur)`) | ✔ |
| recommendations | local-stock (`local-stock — isStockExposable() pour la carte product du rail Discovery`) | ✔ |
| recommendations | providers-services (`providers-services — isServiceExposable()/getService()/isPhysicalOfferExposable()/getPhysicalOffer() pour les cartes tierces`) | ✔ |
| refunds | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| refunds | orders (`orders (commande source)`) | ✔ |
| refunds | wallet (`wallet (credit)`) | ✔ |
| refunds | documents (`documents (reçu)`) | ✔ |
| shared-cart | recommendations (`recommendations (modal partagé consomme suggestions via interface /api/boutique/suggestions)`) | ✔ |
| shared-cart | platform-ops (`platform-ops (monitoring/exploitation transverse observé dans le code)`) | ✔ |
| shared-cart | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| shared-cart | orders (`orders (arbitrage de la réclamation via order_items.shared_cart_item_id — feature orders, migration 123)`) | ✔ |
| shared-cart | catalog (`catalog (lecture seule des produits)`) | ✔ |
| shared-cart | notifications (`notifications (émission uniquement — WhatsApp création de liste)`) | ✔ |
| shared-cart | auth (`auth`) | ✔ |
| shared-cart | auth-identity (`auth-identity (projection boutique : b-share-cart.js consomme identité et téléphone)`) | ✔ |
| sourcing | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| sourcing | catalog (`catalog (connecteurs fournisseur, catalog-import-orchestrator, catalog-enrichment, supplier-catalog-scanner pour le scan pricing, catalog-candidate-product-service pour créer le brouillon products, et catalog-promotion.js pour promouvoir normalized_source_contract V2 vers catalog_media/product_variants/product_skus/product_sku_media dans la transaction de POST .../import-product)`) | ✔ |
| sourcing | economic-engine (`economic-engine (pricing-engine.loadGlobalConfig — config de scan)`) | ✔ |
| sourcing | auth (`auth`) | ✔ |
| sourcing | dashboard (`dashboard (registre partenaires partagé via partner-admin-service ; 4E filtre strictement partner_type=sourcing)`) | ✔ |
| unsold-resolution | orders (`orders (commande source de l'invendu)`) | ✔ |
| unsold-resolution | catalog (`catalog (produit concerné)`) | ✔ |
| unsold-resolution | auth (`auth`) | ✔ |
| unsold-resolution | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| wallet | orders (`orders (persistence via order-mutation-service ? LOT11)`) | ✔ |
| wallet | platform-ops (`platform-ops (monitoring/exploitation transverse observé dans le code)`) | ✔ |
| wallet | infrastructure (`infrastructure (dépendance technique transversale observée : DB, logger, helpers ou bootstrap possédés par infrastructure)`) | ✔ |
| wallet | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/wallet.js -> middleware/auth.js)`) | ✔ |
| wallet | documents (`documents (FF-C1 2026-07-29 — émission ou lecture documentaire ; preuve: services/wallet-service.js -> services/documents/wallet-receipt.js ; routes/wallet.js -> services/documents/wallet-receipt.js)`) | ✔ |
| wallet | auth-identity (`auth-identity (identification du client)`) | ✔ |
| admin-dashboard | catalog (`catalog`) | ✔ |
| admin-dashboard | customs (`customs`) | ✔ |
| admin-dashboard | dashboard (`dashboard`) | ✔ |
| admin-dashboard | decision-signals (`decision-signals`) | ✔ |
| admin-dashboard | documents (`documents`) | ✔ |
| admin-dashboard | economic-engine (`economic-engine`) | ✔ |
| admin-dashboard | inventory (`inventory`) | ✔ |
| admin-dashboard | logistics (`logistics`) | ✔ |
| admin-dashboard | orders (`orders`) | ✔ |
| admin-dashboard | payments (`payments`) | ✔ |
| admin-dashboard | sourcing (`sourcing`) | ✔ |
| decision-signals | auth (`auth (FF-C1 2026-07-29 — garde de route et contexte d’identité ; preuve: routes/signals.js -> middleware/auth.js)`) | ✔ |
| decision-signals | infrastructure (`infrastructure (2026-08-17 — accès DB et logger techniques ; preuve: services/radar-queries.js, services/signal-service.js, routes/signals.js -> db.js / utils/logger.js)`) | ✔ |
| decision-signals | logistics (`logistics (FF-C1 2026-07-29 — lecture ou orchestration logistique ; preuve: services/radar-queries.js -> utils/parcels.js)`) | ✔ |
| decision-signals | business-rules (`business-rules (FF-C1 2026-07-29 — lecture du référentiel de règles métier ; preuve: services/radar-queries.js -> utils/rules.js)`) | ✔ |

## Drifts

### ERROR (0)

- none

### DETTE / DRIFT ACTIONNABLE (0)

Seules INVALID_DECLARATION, ACTIONABLE_DRIFT et KNOWN_DEBT constituent de la dette gouvernance. Les topologies attendues et limites du générateur restent visibles séparément et ne consomment aucun budget de dette.

- none

### TOPOLOGIE ATTENDUE — hors dette (33)

- **[DASH-MANIFEST-DUPLICATE-COPY]** admin-dashboard — "public/features/admin-dashboard.feature.js" est une copie déclarée de "public/dashboards/features/admin-dashboard.feature.js" (APP_FEATURE_REGISTRY.md) — non chargée comme nœud séparé, résolue uniquement contre le canonique
- **[DASH-MANIFEST-DUPLICATE-COPY]** legacy-control-tower — "public/features/legacy-control-tower.feature.js" est une copie déclarée de "public/dashboards/features/legacy-control-tower.feature.js" (APP_FEATURE_REGISTRY.md) — non chargée comme nœud séparé, résolue uniquement contre le canonique
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** dashboard -> loyalty — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "dashboard" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** dashboard -> platform — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "dashboard" vers "platform"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> auth-identity — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "auth-identity"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> auth-passkey — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "auth-passkey"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> business-rules — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "business-rules"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> decision-signals — dépendance cross-feature observée (canal: static-code, 3 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "decision-signals"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> documents — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "documents"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> local-stock — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "local-stock"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> loyalty — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> providers-services — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "providers-services"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> purchasing — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "purchasing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> sourcing — dépendance cross-feature observée (canal: static-code, 2 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "sourcing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> unsold-resolution — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "infrastructure" vers "unsold-resolution"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** inventory -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "inventory" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** platform-ops -> auth-passkey — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "auth-passkey"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** platform-ops -> notifications — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "notifications"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** platform-ops -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** platform-ops -> providers-services — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "providers-services"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** platform-ops -> recommendations — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "recommendations"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** platform-ops -> shared-cart — dépendance cross-feature observée (canal: static-code, 6 preuve(s)) sans contract.consumes déclaré chez "platform-ops" vers "shared-cart"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** refunds -> auth — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "refunds" vers "auth"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** refunds -> payments — dépendance cross-feature observée (canal: static-code, 1 preuve(s)) sans contract.consumes déclaré chez "refunds" vers "payments"
- **[WRITER-NOT-OWNER]** invoices — table "invoices" : lifecycle owner = documents (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** order_comments — table "order_comments" : lifecycle owner = orders (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** order_status_history — table "order_status_history" : lifecycle owner = orders (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** recipients — table "recipients" : lifecycle owner = orders (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** relais — table "relais" : lifecycle owner = logistics (db.tables "!"), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** scan_events — table "scan_events" : lifecycle owner = logistics (db.tables "!"), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** sms_log — table "sms_log" : lifecycle owner = orders (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** wallet_transactions — table "wallet_transactions" : lifecycle owner = wallet (classification.signals.ownsTables), mais aussi écrite par dashboard
- **[WRITER-NOT-OWNER]** wallets — table "wallets" : lifecycle owner = wallet (classification.signals.ownsTables), mais aussi écrite par dashboard

### LIMITES DU GÉNÉRATEUR — hors dette (13)

- **[DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED]** scope:backend — 16 appel(s) require()/import() dynamique(s) non résolu(s) statiquement dans le scope backend (ex. tests/unit/modal-mobile-canonical.test.js: CSS_BUNDLES_PATH | scripts/boutique-ownership-full-check.js: path.join(abs, f | scripts/contract-generate.js: ...) — limitation du modèle statique O5, jamais inventé
- **[DYNAMIC-LOCAL-DEPENDENCY-UNRESOLVED]** scope:boutique — 1 appel(s) require()/import() dynamique(s) non résolu(s) statiquement dans le scope boutique (ex. public/boutique/tests/unit/modal-cart-sku-guard.test.js: bundleConfigPath) — limitation du modèle statique O5, jamais inventé
- **[EXPOSE-ENTRY-UNPARSED]** local-stock / GET /api/local-stock/availability?product_id=X&market=CODE — projection Discovery minimale availability/exposable ; market CODE résolu serveur — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** local-stock / GET /api/local-stock/checkout-preview?relais_id=R&product_id=P&quantity=Q — projection checkout read-only, relais -> market_id résolu serveur, jamais une réservation — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** logistics / GET/POST /api/parcels — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** orders / GET/POST /api/orders — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** providers-services / GET /api/providers-services/physical-offers/:id?market=CODE — lecture publique minimale + provider_name + image_ref + actions request/callback — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** providers-services / GET /api/providers-services/services/:id?market=CODE — lecture publique minimale + provider_name + image_ref + actions request/callback — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** providers-services / POST /api/providers-services/inquiries?market=CODE — identité Komerce obligatoire ; service_id XOR physical_offer_id ; intent request|callback ; requester_note facultative — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** recommendations / GET /api/boutique/suggestions — ranking produit historique — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSE-ENTRY-UNPARSED]** recommendations / GET /api/boutique/suggestions?surface=local&market=CODE — DiscoveryCard[] read-only, [] si activation ou données absentes — entrée contract.exposes non parseable (attendu "METHOD /path")
- **[EXPOSED-ROUTE-UNRESOLVED]** infrastructure / GET /*.html — "GET /*.html" déclaré par infrastructure mais absent du contrat OpenAPI généré (docs/contract/openapi.json)
- **[EXPOSED-ROUTE-UNRESOLVED]** infrastructure / GET /webhook/authkey-whatsapp — "GET /webhook/authkey-whatsapp" déclaré par infrastructure mais absent du contrat OpenAPI généré (docs/contract/openapi.json)

## Orphan technical nodes

Fichiers présents dans le Technical Architecture Graph, non revendiqués par une carte feature ni un transversal déclaré (`governance/transversal-paths.json`).

- none

## Lot O5 — Feature Dependency Conformance & Hidden Coupling Gate

Meta Graph monté : oui.

### Coverage par scope

- backend : 1056 fichier(s) `.js`/`.mjs` observés (canal A)
- boutique : 212 fichier(s) observés, dont 12 sous manifest non-canonique (canonicalFeature=null)
- dash : 82 fichier(s) observés
  - _dash static-string local dependency file coverage: COMPLETE (fichiers .js déclarés, résolus)_
  - _dash interface channel: consumer file resolution câblée via docs/DASHBOARDS_360.json (bridge vue -> fileId basé sur les entrées "views/" déjà gouvernées par implementedByEdges) — les modules dashboards référencés par META_GRAPH mais absents des vues gouvernées (ou ambigus) restent INTERFACE-CONSUMER-FILE-UNRESOLVED, jamais devinés_
  - _dash total runtime dependency observability: LIMITED BY O5 STATIC MODEL (dynamic import, registry lookup, dependency injection, event-driven dependency hors périmètre statique)_

### Dependency conformance summary (paires canonical-feature → canonical-feature)

| Consumer | Provider | Canaux | Preuves | Statut |
|---|---|---|---|---|
| admin-dashboard | catalog | interface | 2 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | customs | interface | 4 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | dashboard | interface | 14 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | decision-signals | interface | 3 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | documents | interface | 1 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | economic-engine | interface | 22 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | inventory | interface | 5 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | logistics | interface | 7 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | orders | interface | 3 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | payments | interface | 6 | **DECLARED_AND_OBSERVED** |
| admin-dashboard | sourcing | interface | 3 | **DECLARED_AND_OBSERVED** |
| auth | auth-identity | static-code, data-read | 5 | **DECLARED_AND_OBSERVED** |
| auth | infrastructure | static-code | 14 | **DECLARED_AND_OBSERVED** |
| auth | notifications | static-code | 1 | **DECLARED_AND_OBSERVED** |
| auth-identity | auth | static-code | 9 | **DECLARED_AND_OBSERVED** |
| auth-identity | auth-passkey | static-code | 4 | **DECLARED_AND_OBSERVED** |
| auth-identity | catalog | data-read | 1 | **DECLARED_AND_OBSERVED** |
| auth-identity | documents | interface, data-read | 2 | **DECLARED_AND_OBSERVED** |
| auth-identity | infrastructure | static-code | 15 | **DECLARED_AND_OBSERVED** |
| auth-identity | logistics | static-code, data-read | 6 | **DECLARED_AND_OBSERVED** |
| auth-identity | loyalty | data-read | 1 | **DECLARED_AND_OBSERVED** |
| auth-identity | notifications | static-code | 3 | **DECLARED_AND_OBSERVED** |
| auth-identity | orders | data-read | 2 | **DECLARED_AND_OBSERVED** |
| auth-identity | platform-ops | static-code | 7 | **DECLARED_AND_OBSERVED** |
| auth-identity | wallet | interface | 1 | **DECLARED_AND_OBSERVED** |
| auth-passkey | auth | static-code | 4 | **DECLARED_AND_OBSERVED** |
| auth-passkey | auth-identity | static-code, data-read | 4 | **DECLARED_AND_OBSERVED** |
| auth-passkey | infrastructure | static-code | 5 | **DECLARED_AND_OBSERVED** |
| auth-passkey | platform-ops | static-code | 2 | **DECLARED_AND_OBSERVED** |
| business-rules | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| business-rules | auth-identity | data-read | 1 | **DECLARED_AND_OBSERVED** |
| business-rules | infrastructure | static-code | 3 | **DECLARED_AND_OBSERVED** |
| catalog | auth | static-code | 4 | **DECLARED_AND_OBSERVED** |
| catalog | auth-identity | interface | 1 | **DECLARED_AND_OBSERVED** |
| catalog | business-rules | static-code | 7 | **DECLARED_AND_OBSERVED** |
| catalog | economic-engine | static-code | 7 | **DECLARED_AND_OBSERVED** |
| catalog | infrastructure | static-code | 40 | **DECLARED_AND_OBSERVED** |
| catalog | logistics | static-code | 5 | **DECLARED_AND_OBSERVED** |
| catalog | notifications | static-code | 2 | **DECLARED_AND_OBSERVED** |
| catalog | orders | static-code, data-read | 15 | **DECLARED_AND_OBSERVED** |
| catalog | platform-ops | static-code | 75 | **DECLARED_AND_OBSERVED** |
| catalog | shared-cart | static-code, interface | 13 | **DECLARED_AND_OBSERVED** |
| catalog | sourcing | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| customs | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| customs | catalog | data-read | 1 | **DECLARED_AND_OBSERVED** |
| customs | documents | static-code | 2 | **DECLARED_AND_OBSERVED** |
| customs | economic-engine | static-code | 2 | **DECLARED_AND_OBSERVED** |
| customs | infrastructure | static-code | 4 | **DECLARED_AND_OBSERVED** |
| customs | logistics | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| customs | orders | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| dashboard | auth | static-code | 18 | **DECLARED_AND_OBSERVED** |
| dashboard | auth-identity | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| dashboard | business-rules | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| dashboard | customs | static-code, data-read | 4 | **DECLARED_AND_OBSERVED** |
| dashboard | decision-signals | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| dashboard | documents | static-code, data-write, data-read | 4 | **DECLARED_AND_OBSERVED** |
| dashboard | economic-engine | static-code, data-read | 6 | **DECLARED_AND_OBSERVED** |
| dashboard | incident-management | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| dashboard | infrastructure | static-code | 86 | **DECLARED_AND_OBSERVED** |
| dashboard | inventory | static-code | 1 | **DECLARED_AND_OBSERVED** |
| dashboard | logistics | static-code, data-read, data-write | 21 | **DECLARED_AND_OBSERVED** |
| dashboard | loyalty | static-code | 1 | **OBSERVED_UNDECLARED** |
| dashboard | market | static-code | 13 | **DECLARED_AND_OBSERVED** |
| dashboard | notifications | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| dashboard | orders | static-code, data-write, data-read | 12 | **DECLARED_AND_OBSERVED** |
| dashboard | payments | static-code | 1 | **DECLARED_AND_OBSERVED** |
| dashboard | platform | static-code | 1 | **OBSERVED_UNDECLARED** |
| dashboard | purchasing | static-code | 2 | **DECLARED_AND_OBSERVED** |
| dashboard | shared-cart | static-code | 1 | **DECLARED_AND_OBSERVED** |
| dashboard | wallet | data-write | 2 | **DECLARED_AND_OBSERVED** |
| decision-signals | auth | static-code | 2 | **DECLARED_AND_OBSERVED** |
| decision-signals | business-rules | static-code | 2 | **DECLARED_AND_OBSERVED** |
| decision-signals | infrastructure | static-code | 7 | **DECLARED_AND_OBSERVED** |
| decision-signals | logistics | static-code | 1 | **DECLARED_AND_OBSERVED** |
| documents | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| documents | auth-identity | data-read | 1 | **DECLARED_AND_OBSERVED** |
| documents | catalog | data-read | 1 | **DECLARED_AND_OBSERVED** |
| documents | customs | data-read | 2 | **DECLARED_AND_OBSERVED** |
| documents | infrastructure | static-code | 21 | **DECLARED_AND_OBSERVED** |
| documents | logistics | data-read | 3 | **DECLARED_AND_OBSERVED** |
| documents | orders | data-read | 3 | **DECLARED_AND_OBSERVED** |
| documents | refunds | data-read | 1 | **DECLARED_AND_OBSERVED** |
| documents | wallet | data-read | 2 | **DECLARED_AND_OBSERVED** |
| economic-engine | auth | static-code | 12 | **DECLARED_AND_OBSERVED** |
| economic-engine | auth-identity | data-read | 1 | **DECLARED_AND_OBSERVED** |
| economic-engine | business-rules | data-read | 1 | **DECLARED_AND_OBSERVED** |
| economic-engine | catalog | static-code, data-read | 6 | **DECLARED_AND_OBSERVED** |
| economic-engine | customs | data-read | 3 | **DECLARED_AND_OBSERVED** |
| economic-engine | dashboard | static-code | 8 | **DECLARED_AND_OBSERVED** |
| economic-engine | infrastructure | static-code | 82 | **DECLARED_AND_OBSERVED** |
| economic-engine | logistics | static-code, data-read | 6 | **DECLARED_AND_OBSERVED** |
| economic-engine | loyalty | static-code | 1 | **DECLARED_AND_OBSERVED** |
| economic-engine | market | static-code | 1 | **DECLARED_AND_OBSERVED** |
| economic-engine | orders | static-code, data-read | 6 | **DECLARED_AND_OBSERVED** |
| economic-engine | platform-ops | data-read | 2 | **DECLARED_AND_OBSERVED** |
| economic-engine | refunds | data-read | 1 | **DECLARED_AND_OBSERVED** |
| incident-management | infrastructure | static-code | 3 | **DECLARED_AND_OBSERVED** |
| incident-management | logistics | data-read | 2 | **DECLARED_AND_OBSERVED** |
| incident-management | orders | data-read | 1 | **DECLARED_AND_OBSERVED** |
| infrastructure | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| infrastructure | auth-identity | static-code | 3 | **OBSERVED_UNDECLARED** |
| infrastructure | auth-passkey | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | business-rules | static-code | 3 | **OBSERVED_UNDECLARED** |
| infrastructure | catalog | static-code | 5 | **DECLARED_AND_OBSERVED** |
| infrastructure | customs | static-code | 2 | **DECLARED_AND_OBSERVED** |
| infrastructure | dashboard | static-code | 14 | **DECLARED_AND_OBSERVED** |
| infrastructure | decision-signals | static-code | 3 | **OBSERVED_UNDECLARED** |
| infrastructure | documents | static-code | 2 | **OBSERVED_UNDECLARED** |
| infrastructure | economic-engine | static-code | 12 | **DECLARED_AND_OBSERVED** |
| infrastructure | inventory | static-code | 2 | **DECLARED_AND_OBSERVED** |
| infrastructure | local-stock | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | logistics | static-code | 21 | **DECLARED_AND_OBSERVED** |
| infrastructure | loyalty | static-code | 2 | **OBSERVED_UNDECLARED** |
| infrastructure | notifications | static-code | 4 | **DECLARED_AND_OBSERVED** |
| infrastructure | orders | static-code | 5 | **DECLARED_AND_OBSERVED** |
| infrastructure | payments | static-code | 4 | **DECLARED_AND_OBSERVED** |
| infrastructure | platform-ops | static-code | 5 | **DECLARED_AND_OBSERVED** |
| infrastructure | providers-services | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | purchasing | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | recommendations | static-code | 1 | **DECLARED_AND_OBSERVED** |
| infrastructure | shared-cart | static-code | 6 | **DECLARED_AND_OBSERVED** |
| infrastructure | sourcing | static-code | 2 | **OBSERVED_UNDECLARED** |
| infrastructure | unsold-resolution | static-code | 1 | **OBSERVED_UNDECLARED** |
| infrastructure | wallet | static-code | 2 | **DECLARED_AND_OBSERVED** |
| inventory | auth | static-code | 2 | **DECLARED_AND_OBSERVED** |
| inventory | catalog | data-read | 1 | **DECLARED_AND_OBSERVED** |
| inventory | infrastructure | static-code | 2 | **DECLARED_AND_OBSERVED** |
| inventory | logistics | static-code, data-read | 4 | **DECLARED_AND_OBSERVED** |
| inventory | orders | static-code, data-read | 4 | **DECLARED_AND_OBSERVED** |
| inventory | payments | static-code | 1 | **OBSERVED_UNDECLARED** |
| local-stock | catalog | data-read | 1 | **DECLARED_AND_OBSERVED** |
| local-stock | infrastructure | static-code | 3 | **DECLARED_AND_OBSERVED** |
| local-stock | logistics | data-read | 1 | **DECLARED_AND_OBSERVED** |
| local-stock | market | data-read | 1 | **DECLARED_AND_OBSERVED** |
| logistics | auth | static-code | 13 | **DECLARED_AND_OBSERVED** |
| logistics | auth-identity | static-code, data-read | 5 | **DECLARED_AND_OBSERVED** |
| logistics | business-rules | static-code, data-read | 4 | **DECLARED_AND_OBSERVED** |
| logistics | catalog | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| logistics | documents | data-read | 1 | **DECLARED_AND_OBSERVED** |
| logistics | incident-management | static-code, data-read | 2 | **DECLARED_AND_OBSERVED** |
| logistics | infrastructure | static-code | 84 | **DECLARED_AND_OBSERVED** |
| logistics | loyalty | static-code | 3 | **DECLARED_AND_OBSERVED** |
| logistics | market | static-code | 1 | **DECLARED_AND_OBSERVED** |
| logistics | notifications | static-code | 12 | **DECLARED_AND_OBSERVED** |
| logistics | orders | static-code, data-read | 33 | **DECLARED_AND_OBSERVED** |
| logistics | payments | static-code | 1 | **DECLARED_AND_OBSERVED** |
| logistics | purchasing | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| logistics | refunds | static-code | 1 | **DECLARED_AND_OBSERVED** |
| loyalty | auth | static-code | 2 | **DECLARED_AND_OBSERVED** |
| loyalty | auth-identity | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| loyalty | economic-engine | data-read | 1 | **DECLARED_AND_OBSERVED** |
| loyalty | infrastructure | static-code | 7 | **DECLARED_AND_OBSERVED** |
| loyalty | notifications | static-code | 3 | **DECLARED_AND_OBSERVED** |
| loyalty | orders | data-read | 1 | **DECLARED_AND_OBSERVED** |
| market | infrastructure | static-code | 8 | **DECLARED_AND_OBSERVED** |
| notifications | auth | static-code | 3 | **DECLARED_AND_OBSERVED** |
| notifications | auth-identity | data-read | 1 | **DECLARED_AND_OBSERVED** |
| notifications | incident-management | static-code, data-read | 2 | **DECLARED_AND_OBSERVED** |
| notifications | infrastructure | static-code | 13 | **DECLARED_AND_OBSERVED** |
| notifications | logistics | data-read | 3 | **DECLARED_AND_OBSERVED** |
| notifications | orders | data-read | 2 | **DECLARED_AND_OBSERVED** |
| notifications | platform-ops | static-code | 2 | **DECLARED_AND_OBSERVED** |
| orders | auth | static-code | 14 | **DECLARED_AND_OBSERVED** |
| orders | auth-identity | static-code, interface, data-read | 11 | **DECLARED_AND_OBSERVED** |
| orders | business-rules | static-code | 8 | **DECLARED_AND_OBSERVED** |
| orders | catalog | static-code, data-read | 9 | **DECLARED_AND_OBSERVED** |
| orders | customs | static-code | 3 | **DECLARED_AND_OBSERVED** |
| orders | documents | static-code, interface | 10 | **DECLARED_AND_OBSERVED** |
| orders | economic-engine | static-code | 3 | **DECLARED_AND_OBSERVED** |
| orders | infrastructure | static-code, interface | 58 | **DECLARED_AND_OBSERVED** |
| orders | local-stock | static-code | 3 | **DECLARED_AND_OBSERVED** |
| orders | logistics | static-code, interface, data-read | 23 | **DECLARED_AND_OBSERVED** |
| orders | loyalty | static-code | 7 | **DECLARED_AND_OBSERVED** |
| orders | market | static-code | 2 | **DECLARED_AND_OBSERVED** |
| orders | notifications | static-code | 12 | **DECLARED_AND_OBSERVED** |
| orders | payments | static-code, interface | 7 | **DECLARED_AND_OBSERVED** |
| orders | platform-ops | static-code | 38 | **DECLARED_AND_OBSERVED** |
| orders | purchasing | static-code | 1 | **DECLARED_AND_OBSERVED** |
| orders | refunds | static-code, data-read | 5 | **DECLARED_AND_OBSERVED** |
| orders | shared-cart | static-code | 9 | **DECLARED_AND_OBSERVED** |
| orders | wallet | static-code, interface | 11 | **DECLARED_AND_OBSERVED** |
| payments | auth | static-code | 5 | **DECLARED_AND_OBSERVED** |
| payments | auth-identity | data-read | 1 | **DECLARED_AND_OBSERVED** |
| payments | business-rules | static-code | 2 | **DECLARED_AND_OBSERVED** |
| payments | documents | static-code | 7 | **DECLARED_AND_OBSERVED** |
| payments | incident-management | static-code, data-read | 2 | **DECLARED_AND_OBSERVED** |
| payments | infrastructure | static-code, interface | 41 | **DECLARED_AND_OBSERVED** |
| payments | logistics | static-code, data-read | 15 | **DECLARED_AND_OBSERVED** |
| payments | loyalty | static-code | 4 | **DECLARED_AND_OBSERVED** |
| payments | notifications | static-code | 12 | **DECLARED_AND_OBSERVED** |
| payments | orders | static-code, data-read | 24 | **DECLARED_AND_OBSERVED** |
| payments | platform-ops | static-code | 3 | **DECLARED_AND_OBSERVED** |
| payments | purchasing | static-code | 5 | **DECLARED_AND_OBSERVED** |
| payments | refunds | static-code | 2 | **DECLARED_AND_OBSERVED** |
| platform-ops | auth | static-code | 5 | **DECLARED_AND_OBSERVED** |
| platform-ops | auth-identity | static-code, interface, data-read | 7 | **DECLARED_AND_OBSERVED** |
| platform-ops | auth-passkey | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | business-rules | static-code | 1 | **DECLARED_AND_OBSERVED** |
| platform-ops | catalog | static-code, interface, data-read | 25 | **DECLARED_AND_OBSERVED** |
| platform-ops | documents | data-read | 1 | **DECLARED_AND_OBSERVED** |
| platform-ops | economic-engine | static-code | 1 | **DECLARED_AND_OBSERVED** |
| platform-ops | incident-management | static-code, data-read | 2 | **DECLARED_AND_OBSERVED** |
| platform-ops | infrastructure | static-code, interface | 30 | **DECLARED_AND_OBSERVED** |
| platform-ops | logistics | static-code, interface, data-read | 16 | **DECLARED_AND_OBSERVED** |
| platform-ops | notifications | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | orders | static-code, interface, data-read | 20 | **DECLARED_AND_OBSERVED** |
| platform-ops | payments | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | providers-services | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | purchasing | static-code, interface | 2 | **DECLARED_AND_OBSERVED** |
| platform-ops | recommendations | static-code | 1 | **OBSERVED_UNDECLARED** |
| platform-ops | shared-cart | static-code | 6 | **OBSERVED_UNDECLARED** |
| platform-ops | wallet | static-code | 2 | **DECLARED_AND_OBSERVED** |
| providers-services | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| providers-services | auth-identity | static-code | 1 | **DECLARED_AND_OBSERVED** |
| providers-services | infrastructure | static-code | 7 | **DECLARED_AND_OBSERVED** |
| providers-services | local-stock | static-code | 2 | **DECLARED_AND_OBSERVED** |
| providers-services | market | data-read | 1 | **DECLARED_AND_OBSERVED** |
| providers-services | platform-ops | static-code | 2 | **DECLARED_AND_OBSERVED** |
| providers-services | recommendations | static-code | 1 | **DECLARED_AND_OBSERVED** |
| purchasing | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| purchasing | catalog | data-read | 1 | **DECLARED_AND_OBSERVED** |
| purchasing | infrastructure | static-code | 20 | **DECLARED_AND_OBSERVED** |
| purchasing | logistics | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| purchasing | notifications | static-code | 5 | **DECLARED_AND_OBSERVED** |
| purchasing | orders | static-code, data-read | 7 | **DECLARED_AND_OBSERVED** |
| recommendations | catalog | static-code, data-read | 5 | **DECLARED_AND_OBSERVED** |
| recommendations | infrastructure | static-code | 6 | **DECLARED_AND_OBSERVED** |
| recommendations | local-stock | static-code | 3 | **DECLARED_AND_OBSERVED** |
| recommendations | logistics | data-read | 1 | **DECLARED_AND_OBSERVED** |
| recommendations | market | data-read | 1 | **DECLARED_AND_OBSERVED** |
| recommendations | orders | static-code, data-read | 4 | **DECLARED_AND_OBSERVED** |
| recommendations | platform-ops | static-code | 10 | **DECLARED_AND_OBSERVED** |
| recommendations | providers-services | static-code | 1 | **DECLARED_AND_OBSERVED** |
| refunds | auth | static-code | 1 | **OBSERVED_UNDECLARED** |
| refunds | documents | static-code | 2 | **DECLARED_AND_OBSERVED** |
| refunds | infrastructure | static-code | 3 | **DECLARED_AND_OBSERVED** |
| refunds | orders | static-code, data-read | 4 | **DECLARED_AND_OBSERVED** |
| refunds | payments | static-code | 1 | **OBSERVED_UNDECLARED** |
| refunds | wallet | static-code, data-read | 4 | **DECLARED_AND_OBSERVED** |
| shared-cart | auth | static-code | 4 | **DECLARED_AND_OBSERVED** |
| shared-cart | auth-identity | static-code, data-read | 2 | **DECLARED_AND_OBSERVED** |
| shared-cart | catalog | static-code, data-read | 5 | **DECLARED_AND_OBSERVED** |
| shared-cart | infrastructure | static-code | 17 | **DECLARED_AND_OBSERVED** |
| shared-cart | notifications | static-code | 2 | **DECLARED_AND_OBSERVED** |
| shared-cart | orders | static-code, data-read | 12 | **DECLARED_AND_OBSERVED** |
| shared-cart | platform-ops | static-code | 50 | **DECLARED_AND_OBSERVED** |
| shared-cart | recommendations | static-code, interface | 3 | **DECLARED_AND_OBSERVED** |
| sourcing | auth | static-code | 2 | **DECLARED_AND_OBSERVED** |
| sourcing | catalog | static-code, data-read | 16 | **DECLARED_AND_OBSERVED** |
| sourcing | dashboard | static-code | 1 | **DECLARED_AND_OBSERVED** |
| sourcing | economic-engine | static-code | 4 | **DECLARED_AND_OBSERVED** |
| sourcing | infrastructure | static-code | 5 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | catalog | data-read | 1 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | infrastructure | static-code | 1 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | orders | data-read | 1 | **DECLARED_AND_OBSERVED** |
| wallet | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| wallet | auth-identity | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| wallet | documents | static-code | 4 | **DECLARED_AND_OBSERVED** |
| wallet | infrastructure | static-code | 7 | **DECLARED_AND_OBSERVED** |
| wallet | orders | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| wallet | platform-ops | static-code | 2 | **DECLARED_AND_OBSERVED** |

### Observed undeclared dependencies

- `dashboard` → `loyalty` (canaux: static-code)
- `dashboard` → `platform` (canaux: static-code)
- `infrastructure` → `auth-identity` (canaux: static-code)
- `infrastructure` → `auth-passkey` (canaux: static-code)
- `infrastructure` → `business-rules` (canaux: static-code)
- `infrastructure` → `decision-signals` (canaux: static-code)
- `infrastructure` → `documents` (canaux: static-code)
- `infrastructure` → `local-stock` (canaux: static-code)
- `infrastructure` → `loyalty` (canaux: static-code)
- `infrastructure` → `providers-services` (canaux: static-code)
- `infrastructure` → `purchasing` (canaux: static-code)
- `infrastructure` → `sourcing` (canaux: static-code)
- `infrastructure` → `unsold-resolution` (canaux: static-code)
- `inventory` → `payments` (canaux: static-code)
- `platform-ops` → `auth-passkey` (canaux: static-code)
- `platform-ops` → `notifications` (canaux: static-code)
- `platform-ops` → `payments` (canaux: static-code)
- `platform-ops` → `providers-services` (canaux: static-code)
- `platform-ops` → `recommendations` (canaux: static-code)
- `platform-ops` → `shared-cart` (canaux: static-code)
- `refunds` → `auth` (canaux: static-code)
- `refunds` → `payments` (canaux: static-code)

### Declared without observed evidence (canal A/D uniquement — ne signifie pas "dépendance inexistante")

- none

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
| PROJECTION | 0 | projection-dependency-policy |
| COMPOSITION_ROOT_WIRING | 16 | application-wiring-not-consumption |
| NON_RUNTIME_TEST | 6 | non-runtime-evidence |
| TECHNICAL_PRIMITIVE | 0 | technical-dependency-policy |
| BUSINESS_TRANSVERSAL_SERVICE | 0 | business-dependency-declare-candidate |
| CROSS_FEATURE_DIRECT_IMPORT | 0 | boundary-remediation-required |
| BUSINESS_FEATURE_INTERFACE | 0 | business-dependency-declare-candidate |
| PILOTING_CAPABILITY | 0 | piloting-capability-dependency |
| UNCLASSIFIED | 0 | _(bloquant si > 0)_ |
| **TOTAL** | **22** | |

### Projection dependencies

Vues Dash → endpoint backend. Jamais dans un `contract.consumes` backend.

- _none_

### Composition root wiring

Bootstrap/cron/error-handler qui montent ou déclenchent une feature. Pas une consommation de service.

- `infrastructure` → `auth-identity` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `auth-passkey` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `business-rules` — import-mixed, RUNTIME_ONLY
- `infrastructure` → `decision-signals` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `documents` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `local-stock` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `loyalty` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `providers-services` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `purchasing` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `sourcing` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `unsold-resolution` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `auth-passkey` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `notifications` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `providers-services` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `recommendations` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `shared-cart` — business-file-import, RUNTIME_AND_TEST

### Non-runtime test evidence

Preuves 100 % tests/. Visible mais hors dette de contrat runtime.

- `dashboard` → `loyalty` — business-file-import, TEST_ONLY
- `dashboard` → `platform` — business-file-import, TEST_ONLY
- `inventory` → `payments` — business-file-import, TEST_ONLY
- `platform-ops` → `payments` — business-file-import, TEST_ONLY
- `refunds` → `auth` — technical-primitive, TEST_ONLY
- `refunds` → `payments` — business-file-import, TEST_ONLY

### Technical primitives

Usage de db.js / middleware / logger / utils / validators d'un transversal technique. Politique technique, pas `contract.consumes`.

- _none_

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

