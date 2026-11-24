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
- `market-autonomy`
- `market-control-plane`
- `market-delegation`
- `orders`
- `payments`
- `providers-services`
- `purchasing`
- `recommendations`
- `settlement`
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
- `external-provider-contracts`
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
| backend | 36 | 36 | 725 | 725 | 0 |
| dash | 3 | 3 | N/A | N/A | N/A |
| boutique | 16 | 16 | 106 | 106 | 0 |

_dash_ : pas de Technical Architecture Graph propre au dépôt dash dans ce pipeline — non scanné par arch:gen backend, couverture non mesurable ici (SCOPE, pas un gap)

### Identités canoniques

- **Cross-repo features** (11) : `auth-identity`, `auth-passkey`, `catalog`, `notifications`, `orders`, `payments`, `platform-ops`, `providers-services`, `recommendations`, `shared-cart`, `wallet`
- **Single-repo features** (29) : `admin-dashboard`, `auth`, `business-rules`, `customs`, `dashboard`, `decision-signals`, `documents`, `economic-engine`, `external-provider-contracts`, `incident-management`, `infrastructure`, `inventory`, `legacy-control-tower`, `local-stock`, `logistics`, `loyalty`, `market`, `market-autonomy`, `market-control-plane`, `market-delegation`, `market-operator-dashboard`, `platform`, `purchasing`, `refunds`, `settlement`, `sourcing`, `supplier-connectivity`, `unsold-resolution`, `wallet-loyalty`
- **Unmapped local manifests** (0) : —

### Ontology gaps

- **tracking-no-canonical-owner** (manifest boutique `tracking`)
  - constat : boutique/features/tracking.feature.js décrit un service d'analytics/tracking événementiel UI (suivi parcours, événements). Aucune feature backend ou dash canonique ne représente ce service : vérifié explicitement contre logistics (tracking colis physique — identité métier différente malgré le nom proche), infrastructure (middlewares/bootstrap transverses), notifications (émission de messages sortants, pas de collecte d'événements) et platform-ops (santé applicative). C'est un cas E pur (mission O4 §3) : véritable ONTOLOGY GAP, pas une erreur de nommage à corriger par une fusion.
  - décision actuelle : canonicalFeature reste null. sliceKind fixé à 'frontend-transversal' à titre PROVISOIRE — seule valeur du enum ALLOWED_SLICE_KINDS permettant d'éviter que ce manifeste retombe en BOUTIQUE-MANIFEST-UNGOVERNED, sans pour autant inventer une business feature. Ce n'est pas un vrai transversal multi-feature comme le manifeste `boutique` générique ou `platform` côté dash — c'est un classement de repli documenté.
  - question ouverte : Faut-il créer une feature 'analytics' dédiée côté backend/dash (si un service de collecte équivalent existe ou est prévu côté serveur), ou rattacher ce manifeste à une feature existante par proximité fonctionnelle (ex. platform-ops) ? Décision produit non tranchée par O4.

## Feature → implémentation

### admin-dashboard _(projection)_

> Tableau de bord admin SPA multi-vues.

- js: 38
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
- tests: 16
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 6
- dependencies (consumes): 3 — auth-identity, infrastructure, notifications
- consumers: 27 — auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, documents, economic-engine, infrastructure, inventory, logistics, loyalty, market-control-plane, market-delegation, market-operator-dashboard, notifications, orders, payments, platform-ops, providers-services, purchasing, settlement, shared-cart, sourcing, unsold-resolution, wallet, decision-signals

### auth-identity _(business-feature)_

> Authentifier un utilisateur et gérer son identité active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposées.

- scripts: 1
- services: 7
- routes: 4
- boutique: 3
- utils: 2
- migrations: 4
- tests: 15
- tables owned (lifecycle): 5 — `revoked_tokens`, `users`, `otp_codes`, `credential_action_tokens`, `user_pickup_authorizations`
- tables written: 5
- interfaces exposed: 28
- internal APIs: 13
- dependencies (consumes): 11 — orders, loyalty, logistics, catalog, platform-ops, infrastructure, auth, auth-passkey, notifications, wallet, documents
- consumers: 20 — auth, auth-passkey, business-rules, catalog, dashboard, documents, economic-engine, infrastructure, logistics, loyalty, market-autonomy, market-delegation, notifications, orders, payments, platform-ops, providers-services, settlement, shared-cart, wallet

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
- tests: 3
- tables owned (lifecycle): 2 — `business_rules`, `business_rules_history`
- tables written: 2
- interfaces exposed: 5
- internal APIs: 4
- dependencies (consumes): 3 — auth-identity, auth, infrastructure
- consumers: 8 — catalog, dashboard, economic-engine, logistics, orders, payments, platform-ops, decision-signals

### catalog _(business-feature)_

> Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.

- middleware: 1
- ci: 25
- utils: 1
- scripts: 35
- services: 88
- schemas: 5
- migrations: 26
- config: 1
- docs: 19
- routes: 7
- boutique: 39
- dash: 1
- tests: 211
- tables owned (lifecycle): 26 — `products`, `boutique_categories`, `boutique_subcategories`, `catalog_taxonomy_audit`, `catalog_field_overrides`, `catalog_terminology_reference`, `catalog_enrichment_runs`, `catalog_media`, `catalog_media_recovery_audit`, `product_skus`, `product_sku_media`, `product_variants`, `product_content_profile`, `product_content_sections`, `product_market_exposure`, `product_attributes`, `supplier_catalog_imports`, `supplier_catalog_sync_checkpoints`, `supplier_oauth_connections`, `catalog_field_sync_state`, `catalog_media_visual_fr_reviews`, `catalog_publication_decision_audit`, `catalog_product_sale_holds`, `catalog_product_quality_notes`, `catalog_stock_sync_state`, `supplier_catalog_import_rejections`
- tables written: 27
- interfaces exposed: 47
- internal APIs: 10
- dependencies (consumes): 18 — external-provider-contracts, sourcing, notifications, auth-identity, platform-ops, infrastructure, business-rules, economic-engine, customs, market-autonomy, market, sourcing, supplier-connectivity, purchasing, logistics, shared-cart, auth, orders
- consumers: 23 — auth-identity, customs, dashboard, documents, economic-engine, infrastructure, inventory, local-stock, logistics, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, orders, platform-ops, purchasing, recommendations, recommendations, refunds, shared-cart, sourcing, unsold-resolution, admin-dashboard

### customs _(business-feature)_

> Classer et declarer un colis douanierement ; la declaration est le pivot, jamais une optimisation.

- services: 5
- routes: 3
- migrations: 8
- dash: 2
- tests: 17
- tables owned (lifecycle): 5 — `customs_categories`, `customs_shipment_parcels`, `customs_shipments`, `customs_shipment_fees`, `customs_shipment_parcel_events`
- tables written: 6
- interfaces exposed: 20
- internal APIs: 0
- dependencies (consumes): 8 — catalog, orders, logistics, infrastructure, documents, auth, economic-engine, market
- consumers: 9 — catalog, dashboard, documents, economic-engine, infrastructure, logistics, orders, sourcing, admin-dashboard

### dashboard _(business-transversal)_

> Exposer les agrégats de pilotage et porter un portail interne Canonical unifié accessible depuis /admin, dont la navigation et les workspaces sont adaptés au rôle, aux scopes marché et aux capabilities résolus côté serveur, sans réutiliser les deux générations historiques de dashboards.

- middleware: 1
- services: 47
- routes: 29
- migrations: 3
- dash: 197
- tests: 215
- tables owned (lifecycle): 3 — `customs_shipment_holds`, `order_incidents`, `partners`
- tables written: 21
- interfaces exposed: 89
- internal APIs: 0
- dependencies (consumes): 27 — shared-cart, incident-management, orders, infrastructure, payments, refunds, logistics, inventory, local-stock, economic-engine, wallet, auth, auth-identity, market-delegation, customs, documents, notifications, purchasing, supplier-connectivity, external-provider-contracts, business-rules, decision-signals, market, market-delegation, sourcing, catalog, market-autonomy
- consumers: 9 — economic-engine, infrastructure, market-control-plane, market-delegation, market-operator-dashboard, orders, sourcing, admin-dashboard, decision-signals

### decision-signals _(piloting-capability)_

> Detecter et qualifier des signaux operationnels et economiques a partir des donnees canoniques, puis porter leur cycle de vie global ou Market ID sans muter la verite metier source.

- middleware: 1
- services: 9
- routes: 2
- migrations: 2
- tests: 15
- tables owned (lifecycle): 1 — `signals`
- tables written: 1
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 9 — auth, infrastructure, logistics, purchasing, business-rules, market-delegation, payments, economic-engine, dashboard
- consumers: 5 — dashboard, incident-management, market-control-plane, orders, admin-dashboard

### documents _(business-transversal)_

> Generer et conserver un PDF officiel privé (facture, remboursement, wallet, retrait, douane) après événement confirmé ; exposer au client authentifié uniquement ses factures et remboursements essentiels.

- services: 9
- routes: 3
- migrations: 7
- utils: 5
- tests: 18
- tables owned (lifecycle): 2 — `invoices`, `transaction_documents`
- tables written: 2
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 9 — logistics, catalog, auth, infrastructure, orders, customs, wallet, refunds, auth-identity
- consumers: 11 — auth-identity, customs, dashboard, logistics, orders, payments, platform-ops, purchasing, refunds, wallet, admin-dashboard

### economic-engine _(business-feature)_

> Calculer les frontières économiques, la contribution et la couverture ; le marché borne le possible et le responsable autorisé décide le prix.

- utils: 3
- middleware: 1
- services: 56
- routes: 13
- migrations: 34
- dash: 6
- tests: 108
- tables owned (lifecycle): 31 — `order_item_real_cost_allocations`, `exchange_rates`, `charges`, `competitor_prices`, `cost_benchmarks`, `cost_component_events`, `cost_component_market_override_events`, `cost_component_market_overrides`, `cost_components`, `economic_risk_cost_events`, `economic_risk_watermark_events`, `economic_snapshots`, `economic_structure_cost_events`, `finance_config`, `international_n1_reconciliations`, `financial_movements`, `financial_movement_documents`, `market_price_observations`, `market_price_observation_events`, `price_history`, `pricing_category_dims`, `pricing_category_taxes`, `pricing_components`, `pricing_matrices_audit`, `pricing_market_decision_policy_events`, `pricing_maturity_disposition_events`, `pricing_strategies`, `pricing_strategy_history`, `risk_provisions`, `market_cost_attributions`, `order_cost_entry_events`
- tables written: 32
- interfaces exposed: 110
- internal APIs: 2
- dependencies (consumes): 16 — local-stock, refunds, platform-ops, customs, business-rules, auth-identity, market, market-autonomy, market-delegation, infrastructure, logistics, catalog, auth, dashboard, orders, loyalty
- consumers: 15 — catalog, customs, dashboard, infrastructure, loyalty, market-autonomy, market-control-plane, market-delegation, orders, platform-ops, purchasing, refunds, sourcing, admin-dashboard, decision-signals

### external-provider-contracts _(technical-transversal)_

> Qualifier, prouver et publier ce que Komerce peut réellement croire d un système externe avant qu une feature métier ne s appuie sur son contrat.

- services: 1
- scripts: 6
- workflows: 7
- config: 2
- tests: 8
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 12
- dependencies (consumes): 1 — infrastructure
- consumers: 4 — catalog, dashboard, purchasing, supplier-connectivity

### incident-management _(business-transversal)_

> Détecter, qualifier et résoudre les écarts entre l'état attendu et l'état réel d'une opération, avec impact client traçable.

- services: 5
- tests: 8
- tables owned (lifecycle): 1 — `incidents`
- tables written: 1
- interfaces exposed: 0
- internal APIs: 17
- dependencies (consumes): 4 — orders, infrastructure, logistics, decision-signals
- consumers: 8 — dashboard, logistics, notifications, orders, payments, platform-ops, purchasing, refunds

### infrastructure _(technical-foundation)_

> Infrastructure transversale consommée par toutes les features : middleware non-auth (error-handler, rate-limit, request-id, upload, validate), utilitaires partagés (logger, phone, rates, reference, rules), barrel de validation Joi, et bootstrap applicatif (Express, routes, crons, env, sécurité, migrations startup).

- services: 3
- middleware: 7
- utils: 5
- validators: 1
- bootstrap: 9
- migrations: 9
- scripts: 114
- docs: 61
- ci: 26
- assets: 33
- db: 16
- routes: 1
- config: 12
- tests: 107
- tables owned (lifecycle): 3 — `schema_migrations`, `outbox_events`, `physical_outcome_receipts`
- tables written: 10
- interfaces exposed: 4
- internal APIs: 11
- dependencies (consumes): 17 — market, auth, auth-identity, catalog, customs, dashboard, economic-engine, inventory, logistics, market-delegation, notifications, platform-ops, orders, payments, recommendations, shared-cart, wallet
- consumers: 34 — auth, auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, documents, economic-engine, external-provider-contracts, incident-management, inventory, local-stock, logistics, loyalty, market, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, notifications, orders, payments, platform-ops, providers-services, purchasing, recommendations, refunds, settlement, shared-cart, sourcing, unsold-resolution, wallet, decision-signals

### inventory _(business-feature)_

> Réceptionner, affecter et dispatcher les articles au hub.

- services: 1
- routes: 1
- dash: 1
- tests: 3
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

- services: 3
- routes: 1
- tests: 5
- tables owned (lifecycle): 2 — `local_stock`, `local_stock_allocations`
- tables written: 2
- interfaces exposed: 2
- internal APIs: 6
- dependencies (consumes): 4 — catalog, market, logistics, infrastructure
- consumers: 7 — dashboard, economic-engine, logistics, market-delegation, orders, providers-services, recommendations

### logistics _(business-feature)_

> Faire transiter un colis du scan initial au retrait final, avec tracking client et transporteur.

- middleware: 1
- migrations: 16
- docs: 7
- utils: 3
- services: 52
- routes: 18
- boutique: 1
- dash: 2
- tests: 99
- tables owned (lifecycle): 26 — `parcels`, `relais`, `parcel_items`, `hub_physical_unit_placements`, `hub_physical_units`, `hub_purchase_allocations`, `scan_events`, `scans`, `pickup_print_tokens`, `pickup_reveal_codes`, `relay_product_return_receipts`, `carriers`, `hub_custody_events`, `hub_box_bags`, `international_shipment_charges`, `international_shipment_events`, `international_shipment_hub_units`, `international_shipment_relay_receipts`, `international_shipments`, `market_transport_sale_rates`, `parcel_events`, `pickup_collect_failures`, `pickup_code_generations`, `pickup_verify_attempts`, `product_sku_physical_codes`, `shipments`
- tables written: 28
- interfaces exposed: 78
- internal APIs: 32
- dependencies (consumes): 17 — customs, documents, incident-management, infrastructure, business-rules, orders, local-stock, auth, auth-identity, catalog, notifications, payments, refunds, purchasing, loyalty, market, market-delegation
- consumers: 22 — auth-identity, catalog, customs, dashboard, documents, economic-engine, incident-management, infrastructure, inventory, local-stock, market-control-plane, market-delegation, market-operator-dashboard, notifications, orders, payments, platform-ops, purchasing, recommendations, refunds, admin-dashboard, decision-signals

### loyalty _(business-feature)_

> Calculer et maintenir le statut de fidelite d'un client (palier + compteur gros panier) et ses recompenses.

- services: 1
- routes: 2
- tests: 6
- tables owned (lifecycle): 2 — `loyalty_tiers`, `loyalty_rewards`
- tables written: 2
- interfaces exposed: 12
- internal APIs: 0
- dependencies (consumes): 6 — orders, economic-engine, infrastructure, auth, notifications, auth-identity
- consumers: 5 — auth-identity, economic-engine, logistics, orders, payments

### market _(business-feature)_

> Porter le référentiel des marchés ouverts (pays, devise) et l'historique d'accès des opérateurs à un marché — jamais le settlement ni l'attribution économique, qui restent une primitive séparée et différée.

- scripts: 3
- migrations: 15
- services: 11
- tests: 32
- tables owned (lifecycle): 5 — `markets`, `operator_market_scopes`, `currency_parities`, `fx_rate_observations`, `fx_public_reference_quotes`
- tables written: 5
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 2 — infrastructure, notifications
- consumers: 18 — catalog, customs, dashboard, economic-engine, infrastructure, local-stock, logistics, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, orders, payments, providers-services, recommendations, refunds, settlement, wallet

### market-autonomy _(business-feature)_

> Permettre à un responsable pays explicitement scopé manager de décider un prix local, d’en voir l’impact économique, puis de l’activer sans approbation centrale lorsque les gates autorisent la position ; LOCAL_ACTIVE devient alors la seule vérité locale consommable par le buyer path.

- services: 4
- migrations: 3
- dash: 25
- tests: 11
- tables owned (lifecycle): 2 — `product_market_price_drafts`, `product_market_price_draft_events`
- tables written: 2
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 6 — market, economic-engine, catalog, infrastructure, market-delegation, auth-identity
- consumers: 8 — catalog, dashboard, economic-engine, market-delegation, market-operator-dashboard, orders, recommendations, shared-cart

### market-control-plane _(business-feature)_

> Montrer à l’administration centrale, pour chaque marché, l’état réel de sa mise en exploitation et la liste explicite des écarts, sans rien écrire ni décider d’autorisation.

- scripts: 2
- services: 4
- routes: 1
- tests: 12
- tables owned (lifecycle): 1 — `market_delivery_attestations`
- tables written: 1
- interfaces exposed: 7
- internal APIs: 9
- dependencies (consumes): 13 — orders, market, market-delegation, providers-services, payments, logistics, dashboard, catalog, decision-signals, economic-engine, sourcing, auth, infrastructure
- consumers: 1 — orders

### market-delegation _(business-feature)_

> Déléguer de façon explicite, auditable et révocable l’autorité d’exploitation d’un Market ID à un opérateur principal et à son équipe, tout en préservant les frontières GROUP de Komerce.

- migrations: 23
- config: 1
- middleware: 4
- services: 19
- routes: 15
- tests: 52
- tables owned (lifecycle): 10 — `market_operating_assignments`, `assignment_memberships`, `membership_capabilities`, `assignment_capability_ceiling`, `market_cash_control_policies`, `capability_registry`, `ceiling_templates`, `ceiling_template_capabilities`, `market_delegation_audit`, `market_team_invitations`
- tables written: 10
- interfaces exposed: 33
- internal APIs: 35
- dependencies (consumes): 14 — local-stock, market, auth, auth-identity, infrastructure, logistics, catalog, providers-services, orders, settlement, economic-engine, market-autonomy, dashboard, payments
- consumers: 13 — dashboard, dashboard, economic-engine, infrastructure, logistics, market-autonomy, market-control-plane, market-operator-dashboard, orders, payments, settlement, unsold-resolution, decision-signals

### market-operator-dashboard _(unclassified)_

> Permettre à un opérateur pays (market_operator) de se connecter au dashboard Canonical, de décider et exploiter son marché : KPIs, commandes, catalogue pays, pricing local, réseau Hub/Relais, douane, expéditions et Finance pays — sans jamais voir les données d'un autre marché ni recevoir automatiquement les gestes physiques ou autorités globales des rôles spécialisés.

- scripts: 2
- tests: 3
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 9 — market, auth, dashboard, catalog, market-autonomy, orders, logistics, market-delegation, infrastructure
- consumers: 0

### notifications _(business-transversal)_

> Projeter une information essentielle dans l application avec acquittement propriétaire ; conserver les canaux sortants historiques séparés et best-effort.

- tests: 23
- migrations: 6
- utils: 2
- services: 14
- routes: 4
- tables owned (lifecycle): 3 — `client_notifications`, `alerts`, `notification_log`
- tables written: 3
- interfaces exposed: 6
- internal APIs: 9
- dependencies (consumes): 7 — orders, logistics, auth-identity, incident-management, platform-ops, infrastructure, auth
- consumers: 13 — auth, auth-identity, catalog, dashboard, infrastructure, logistics, loyalty, market, orders, payments, purchasing, refunds, shared-cart

### orders _(business-feature)_

> Faire exister une commande, de la creation au statut final, avec un cout figure et une reference lisible.

- utils: 1
- services: 33
- routes: 11
- boutique: 3
- tests: 67
- tables owned (lifecycle): 12 — `order_items`, `orders`, `disputes`, `order_comments`, `order_item_cost_imputations`, `order_status_history`, `recipients`, `sms_log`, `customs_history`, `relay_return_compensations`, `order_delivery_waves`, `order_checkout_idempotency`
- tables written: 14
- interfaces exposed: 27
- internal APIs: 30
- dependencies (consumes): 25 — dashboard, market-control-plane, market-delegation, platform-ops, infrastructure, decision-signals, incident-management, business-rules, wallet, economic-engine, logistics, catalog, market-autonomy, local-stock, market, purchasing, loyalty, payments, auth, auth-identity, customs, documents, notifications, refunds, shared-cart
- consumers: 24 — auth-identity, catalog, customs, dashboard, documents, economic-engine, incident-management, infrastructure, inventory, logistics, loyalty, market-control-plane, market-delegation, market-operator-dashboard, notifications, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, unsold-resolution, wallet, admin-dashboard

### payments _(business-feature)_

> Encaisser un paiement (carte, PayPal, Mobile Money, especes au retrait) et confirmer son etat de facon idempotente.

- scripts: 1
- services: 23
- routes: 7
- migrations: 10
- boutique: 4
- tests: 37
- tables owned (lifecycle): 12 — `market_payment_providers`, `cash_collections`, `cash_deposit_allocations`, `cash_deposits`, `market_cash_destinations`, `cash_confirmation_controls`, `mobile_money_transactions`, `paypal_events_processed`, `stripe_events_processed`, `cash_custody_losses`, `cash_custody_receipts`, `market_payment_accounts`
- tables written: 12
- interfaces exposed: 25
- internal APIs: 0
- dependencies (consumes): 15 — auth-identity, incident-management, infrastructure, platform-ops, auth, refunds, documents, notifications, business-rules, orders, market, logistics, loyalty, purchasing, market-delegation
- consumers: 9 — dashboard, infrastructure, logistics, market-control-plane, market-delegation, orders, refunds, admin-dashboard, decision-signals

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

- middleware: 2
- compositionRoots: 3
- services: 6
- routes: 5
- boutique: 6
- tests: 23
- tables owned (lifecycle): 2 — `fabrics`, `garment_models`
- tables written: 6
- interfaces exposed: 33
- internal APIs: 0
- dependencies (consumes): 12 — documents, incident-management, purchasing, catalog, auth-identity, infrastructure, business-rules, auth, economic-engine, logistics, orders, wallet
- consumers: 12 — auth-identity, auth-passkey, catalog, economic-engine, infrastructure, notifications, orders, payments, providers-services, recommendations, shared-cart, wallet

### providers-services _(business-feature)_

> Porter l’identité d’un provider tiers, ses services et offres physiques, leur exposabilité, leur nom public minimal, leurs médias publics optionnels et le cycle contextualisé de demande/rappel. La cible service_id XOR physical_offer_id porte toujours le propos connu ; le client choisit request ou callback. Pour un Service explicitement compatible WhatsApp, le serveur peut remettre un handoff de conversation après création de l Inquiry, sans publier le numéro dans le détail. Aucun paiement, settlement, calendrier structuré ou order Komerce n’est créé par cette interaction.

- services: 4
- routes: 1
- boutique: 2
- ci: 1
- scripts: 2
- migrations: 3
- tests: 7
- tables owned (lifecycle): 4 — `providers`, `services`, `physical_offers`, `inquiries`
- tables written: 4
- interfaces exposed: 3
- internal APIs: 0
- dependencies (consumes): 7 — auth, auth-identity, platform-ops, market, local-stock, recommendations, infrastructure
- consumers: 3 — market-control-plane, market-delegation, recommendations

### purchasing _(business-feature)_

> Transformer un besoin d'approvisionnement issu d'une commande en engagement fournisseur traçable (bon de commande), puis constater sa réception.

- services: 53
- routes: 1
- migrations: 17
- scripts: 14
- tests: 92
- tables owned (lifecycle): 15 — `suppliers`, `purchase_lines`, `purchase_orders`, `product_suppliers`, `purchase_order_authorizations`, `hub_authorization_grants`, `supplier_execution_payments`, `supplier_payment_settlements`, `manual_purchase_executions`, `purchase_variance_decisions`, `supplier_execution_events`, `supplier_execution_fulfillments`, `supplier_execution_order_lines`, `supplier_execution_orders`, `supplier_execution_payment_proofs`
- tables written: 15
- interfaces exposed: 21
- internal APIs: 14
- dependencies (consumes): 12 — documents, supplier-connectivity, external-provider-contracts, sourcing, catalog, infrastructure, orders, auth, economic-engine, notifications, incident-management, logistics
- consumers: 9 — catalog, dashboard, logistics, orders, payments, platform-ops, refunds, sourcing, decision-signals

### recommendations _(business-feature)_

> Classer et suggérer des produits boutique selon un moteur de ranking dédié. Compose aussi en mémoire un rail Discovery local mixte (DiscoveryCard — Product Komerce, produit physique tiers, service tiers) et porte sa politique éditoriale d’activation serveur, sans jamais posséder ni cloner les données sources.

- scripts: 1
- services: 3
- routes: 1
- tests: 5
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 1
- internal APIs: 0
- dependencies (consumes): 10 — catalog, catalog, market-autonomy, platform-ops, infrastructure, logistics, orders, market, local-stock, providers-services
- consumers: 3 — infrastructure, providers-services, shared-cart

### refunds _(business-transversal)_

> Rembourser un client de facon tracable et sans double remboursement, quel que soit le flux appelant.

- utils: 5
- migrations: 3
- services: 13
- tests: 28
- tables owned (lifecycle): 7 — `refunds`, `refund_execution_intents`, `order_item_refund_reservations`, `local_item_refund_reservations`, `local_cash_refund_authorizations`, `local_cash_refund_payouts`, `local_mobile_refund_handoffs`
- tables written: 7
- interfaces exposed: 0
- internal APIs: 1
- dependencies (consumes): 12 — market, infrastructure, orders, logistics, payments, wallet, documents, notifications, economic-engine, catalog, incident-management, purchasing
- consumers: 6 — dashboard, documents, economic-engine, logistics, orders, payments

### settlement _(business-feature)_

> Tracer de bout en bout le règlement dû à un opérateur pays : READY attesté centralement, REQUESTED par le pays, PAID centralement, RECEIVED par le pays.

- migrations: 1
- services: 1
- routes: 1
- tests: 4
- tables owned (lifecycle): 2 — `market_settlements`, `market_settlement_events`
- tables written: 2
- interfaces exposed: 3
- internal APIs: 5
- dependencies (consumes): 5 — market, market-delegation, auth, auth-identity, infrastructure
- consumers: 1 — market-delegation

### shared-cart _(business-feature)_

> Permettre à un créateur de publier une liste immuable par lien public ; chaque acheteur sélectionne une ou plusieurs lignes disponibles, passe par le récapitulatif puis le checkout canonique sans mélanger son panier personnel ; la liste se ferme automatiquement lorsque sa dernière ligne est réclamée.

- services: 9
- routes: 4
- migrations: 20
- tests: 18
- boutique: 10
- dash: 1
- tables owned (lifecycle): 7 — `basket_items`, `baskets`, `cart_shares`, `shared_cart_events`, `shared_cart_items`, `shared_cart_saved_access`, `shared_carts`
- tables written: 7
- interfaces exposed: 16
- internal APIs: 3
- dependencies (consumes): 9 — recommendations, platform-ops, infrastructure, orders, catalog, market-autonomy, notifications, auth, auth-identity
- consumers: 4 — catalog, dashboard, infrastructure, orders

### sourcing _(business-feature)_

> Identifier, qualifier et arbitrer des opportunités fournisseur ou produit (scan pricing, décision garder/watchlist/rejeter) avant leur entrée dans le catalogue.

- middleware: 1
- migrations: 15
- scripts: 8
- services: 34
- routes: 2
- tests: 57
- tables owned (lifecycle): 18 — `sourcing_candidates`, `import_runtime_runs`, `sourcing_candidate_events`, `sourcing_sources`, `sourcing_provider_control_events`, `sourcing_source_provides`, `sourcing_captures`, `sourcing_observations`, `sourcing_observation_evidence`, `sourcing_canonical_entities`, `sourcing_canonical_entity_refs`, `sourcing_match_proposals`, `sourcing_resolution_decisions`, `sourcing_resolution_bindings`, `import_runtime_item_events`, `provider_credentials`, `sourcing_source_requests`, `supplier_commercial_category_mappings`
- tables written: 18
- interfaces exposed: 30
- internal APIs: 24
- dependencies (consumes): 7 — infrastructure, catalog, purchasing, economic-engine, customs, auth, dashboard
- consumers: 6 — catalog, catalog, dashboard, market-control-plane, purchasing, admin-dashboard

### supplier-connectivity _(integration-adapter)_

> Permettre à Komerce d accueillir un fournisseur par une autorité unique d identité provider, une Supplier Order Identity opaque et une résolution d adapter fail-closed, sans déplacer les décisions métier des features consommatrices.

- services: 4
- tests: 5
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 10
- dependencies (consumes): 1 — external-provider-contracts
- consumers: 3 — catalog, dashboard, purchasing

### unsold-resolution _(business-feature)_

> Garder les colis non retirés sous responsabilité du relais ; la liquidation n'est autorisée qu'après clôture physique, juridique et financière certifiée.

- migrations: 2
- routes: 1
- dash: 3
- tests: 4
- tables owned (lifecycle): 1 — `unsold_items`
- tables written: 1
- interfaces exposed: 7
- internal APIs: 0
- dependencies (consumes): 5 — orders, catalog, auth, market-delegation, infrastructure
- consumers: 0

### wallet _(business-feature)_

> Tenir un solde client et son historique de credit/debit, avec application exactement une fois.

- services: 1
- routes: 1
- migrations: 2
- boutique: 2
- tests: 6
- tables owned (lifecycle): 4 — `wallet_transactions`, `wallets`, `wallet_consumptions`, `wallet_credit_lots`
- tables written: 4
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 7 — market, orders, platform-ops, infrastructure, auth, documents, auth-identity
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
| `assignment_capability_ceiling` | `market-delegation` | declared-table-owner | market-delegation | market-control-plane |
| `assignment_memberships` | `market-delegation` | declared-table-owner | market-delegation | market-control-plane |
| `basket_items` | `shared-cart` | multi-writer-resolved-by-classification-signal | dashboard, shared-cart | — |
| `baskets` | `shared-cart` | multi-writer-resolved-by-classification-signal | dashboard, shared-cart | — |
| `boutique_categories` | `catalog` | single-writer | catalog | — |
| `boutique_subcategories` | `catalog` | single-writer | catalog | — |
| `business_rules` | `business-rules` | single-writer | business-rules | dashboard, economic-engine, logistics |
| `business_rules_history` | `business-rules` | single-writer | business-rules | dashboard |
| `capability_registry` | `market-delegation` | declared-table-owner | market-delegation | — |
| `carriers` | `logistics` | single-writer | logistics | market-control-plane |
| `cart_shares` | `shared-cart` | declared-table-owner | shared-cart | — |
| `cash_collections` | `payments` | single-writer | payments | — |
| `cash_confirmation_controls` | `payments` | single-writer | payments | — |
| `cash_custody_losses` | `payments` | declared-table-owner | payments | — |
| `cash_custody_receipts` | `payments` | declared-table-owner | payments | — |
| `cash_deposit_allocations` | `payments` | single-writer | payments | — |
| `cash_deposits` | `payments` | single-writer | payments | — |
| `catalog_enrichment_runs` | `catalog` | single-writer | catalog | — |
| `catalog_exclusions` | _ambiguë_ | no-declared-writer | — | catalog |
| `catalog_field_overrides` | `catalog` | single-writer | catalog | — |
| `catalog_field_sync_state` | `catalog` | declared-table-owner | catalog | — |
| `catalog_global_access_grants` | _ambiguë_ | no-declared-writer | — | market-control-plane |
| `catalog_glossary` | _ambiguë_ | no-declared-writer | — | catalog |
| `catalog_media` | `catalog` | declared-table-owner | catalog | dashboard, sourcing |
| `catalog_media_recovery_audit` | `catalog` | declared-table-owner | catalog | — |
| `catalog_media_visual_fr_reviews` | `catalog` | declared-table-owner | catalog | — |
| `catalog_product_quality_notes` | `catalog` | declared-table-owner | catalog | — |
| `catalog_product_sale_holds` | `catalog` | declared-table-owner | catalog | — |
| `catalog_publication_decision_audit` | `catalog` | declared-table-owner | catalog | — |
| `catalog_stock_sync_state` | `catalog` | declared-table-owner | catalog | — |
| `catalog_taxonomy_audit` | `catalog` | single-writer | catalog | — |
| `catalog_terminology_reference` | `catalog` | single-writer | catalog | — |
| `ceiling_template_capabilities` | `market-delegation` | declared-table-owner | market-delegation | — |
| `ceiling_templates` | `market-delegation` | declared-table-owner | market-delegation | — |
| `charges` | `economic-engine` | multi-writer-resolved-by-classification-signal | economic-engine, infrastructure | — |
| `client_notifications` | `notifications` | single-writer | notifications | dashboard |
| `competitor_prices` | `economic-engine` | single-writer | economic-engine | — |
| `cost_benchmarks` | `economic-engine` | single-writer | economic-engine | — |
| `cost_component_events` | `economic-engine` | single-writer | economic-engine | — |
| `cost_component_market_override_events` | `economic-engine` | declared-table-owner | economic-engine | — |
| `cost_component_market_overrides` | `economic-engine` | declared-table-owner | economic-engine | — |
| `cost_components` | `economic-engine` | single-writer | economic-engine | — |
| `credential_action_tokens` | `auth-identity` | single-writer | auth-identity | — |
| `currency_parities` | `market` | declared-table-owner | market | market-autonomy |
| `customs_categories` | `customs` | single-writer | customs | economic-engine |
| `customs_effective_rates` | _ambiguë_ | no-declared-writer | — | customs, dashboard |
| `customs_history` | `orders` | single-writer | orders | — |
| `customs_shipment_fees` | `customs` | declared-table-owner | customs | — |
| `customs_shipment_holds` | `dashboard` | single-writer | dashboard | — |
| `customs_shipment_parcel_events` | `customs` | declared-table-owner | customs | — |
| `customs_shipment_parcels` | `customs` | single-writer | customs | dashboard, documents, economic-engine |
| `customs_shipments` | `customs` | single-writer | customs | dashboard, documents, economic-engine, logistics |
| `dashboard_global_access_grants` | _ambiguë_ | no-declared-writer | — | market-control-plane |
| `decision_signal_global_access_grants` | _ambiguë_ | no-declared-writer | — | market-control-plane |
| `disputes` | `orders` | single-writer | orders | catalog, market-delegation |
| `economic_risk_cost_events` | `economic-engine` | declared-table-owner | economic-engine | — |
| `economic_risk_watermark_events` | `economic-engine` | declared-table-owner | economic-engine | — |
| `economic_snapshots` | `economic-engine` | declared-table-owner | economic-engine, infrastructure | — |
| `economic_structure_cost_events` | `economic-engine` | declared-table-owner | economic-engine | market-delegation |
| `economic_variables` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `exchange_rates` | `economic-engine` | single-writer | economic-engine | dashboard |
| `fabrics` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `finance_config` | `economic-engine` | multi-writer-resolved-by-classification-signal | economic-engine, infrastructure | loyalty |
| `financial_movement_documents` | `economic-engine` | declared-table-owner | economic-engine | — |
| `financial_movements` | `economic-engine` | declared-table-owner | economic-engine | — |
| `fx_public_reference_quotes` | `market` | declared-table-owner | market | — |
| `fx_rate_observations` | `market` | declared-table-owner | market | — |
| `garment_models` | `platform-ops` | single-writer | platform-ops | economic-engine |
| `hub_authorization_grants` | `purchasing` | declared-table-owner | purchasing | logistics |
| `hub_box_bags` | `logistics` | declared-table-owner | logistics | — |
| `hub_custody_events` | `logistics` | declared-table-owner | logistics | — |
| `hub_physical_unit_placements` | `logistics` | declared-table-owner | logistics | dashboard |
| `hub_physical_units` | `logistics` | declared-table-owner | logistics | dashboard |
| `hub_purchase_allocations` | `logistics` | declared-table-owner | logistics | dashboard |
| `import_runtime_item_events` | `sourcing` | declared-table-owner | sourcing | — |
| `import_runtime_runs` | `sourcing` | declared-table-owner | sourcing | catalog, dashboard |
| `incidents` | `incident-management` | declared-table-owner | incident-management | dashboard, logistics, notifications, orders, payments, platform-ops, refunds |
| `inquiries` | `providers-services` | single-writer | providers-services | — |
| `international_n1_reconciliations` | `economic-engine` | declared-table-owner | economic-engine | — |
| `international_shipment_charges` | `logistics` | declared-table-owner | logistics | — |
| `international_shipment_events` | `logistics` | declared-table-owner | logistics | — |
| `international_shipment_hub_units` | `logistics` | declared-table-owner | logistics | — |
| `international_shipment_relay_receipts` | `logistics` | declared-table-owner | logistics | orders, refunds |
| `international_shipments` | `logistics` | declared-table-owner | logistics | — |
| `inventory_items` | `inventory` | single-writer | inventory | — |
| `invoices` | `documents` | multi-writer-resolved-by-classification-signal | dashboard, documents | auth-identity, logistics, platform-ops |
| `local_cash_refund_authorizations` | `refunds` | single-writer | refunds | — |
| `local_cash_refund_payouts` | `refunds` | single-writer | refunds | — |
| `local_item_refund_reservations` | `refunds` | single-writer | refunds | orders |
| `local_mobile_refund_handoffs` | `refunds` | single-writer | refunds | — |
| `local_stock` | `local-stock` | single-writer | local-stock | logistics |
| `local_stock_allocations` | `local-stock` | single-writer | local-stock | logistics |
| `loyalty_rewards` | `loyalty` | single-writer | loyalty | — |
| `loyalty_tiers` | `loyalty` | single-writer | loyalty | auth-identity |
| `manual_purchase_executions` | `purchasing` | declared-table-owner | purchasing | — |
| `market_cash_control_policies` | `market-delegation` | declared-table-owner | market-delegation | market-control-plane, payments |
| `market_cash_destinations` | `payments` | single-writer | payments | — |
| `market_cost_attributions` | `economic-engine` | declared-table-owner | economic-engine | — |
| `market_delegation_audit` | `market-delegation` | declared-table-owner | market-delegation | — |
| `market_delivery_attestations` | `market-control-plane` | single-writer | market-control-plane | — |
| `market_operating_assignments` | `market-delegation` | declared-table-owner | market-delegation | market-control-plane, payments, settlement |
| `market_payment_accounts` | `payments` | declared-table-owner | payments | — |
| `market_payment_providers` | `payments` | declared-table-owner | payments | market-control-plane |
| `market_price_observation_events` | `economic-engine` | declared-table-owner | economic-engine | — |
| `market_price_observations` | `economic-engine` | declared-table-owner | economic-engine | — |
| `market_settlement_events` | `settlement` | declared-table-owner | settlement | — |
| `market_settlements` | `settlement` | declared-table-owner | settlement | market-delegation |
| `market_team_invitations` | `market-delegation` | declared-table-owner | market-delegation | — |
| `market_transport_sale_rates` | `logistics` | declared-table-owner | logistics | — |
| `markets` | `market` | declared-table-owner | market | catalog, dashboard, local-stock, market-autonomy, market-control-plane, market-delegation, providers-services, recommendations, settlement |
| `membership_capabilities` | `market-delegation` | declared-table-owner | market-delegation | market-control-plane |
| `mobile_money_transactions` | `payments` | single-writer | payments | — |
| `notification_log` | `notifications` | declared-table-owner | notifications, platform-ops | — |
| `operator_market_scopes` | `market` | declared-table-owner | market | market-delegation |
| `order_checkout_idempotency` | `orders` | declared-table-owner | orders | — |
| `order_comments` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | — |
| `order_cost_entry_events` | `economic-engine` | declared-table-owner | economic-engine | — |
| `order_delivery_waves` | `orders` | declared-table-owner | orders | — |
| `order_incidents` | `dashboard` | single-writer | dashboard | — |
| `order_item_cost_imputations` | `orders` | single-writer | orders | dashboard, economic-engine |
| `order_item_real_cost_allocations` | `economic-engine` | declared-table-owner | customs, economic-engine | dashboard |
| `order_item_refund_reservations` | `refunds` | single-writer | refunds | orders |
| `order_items` | `orders` | declared-table-owner | dashboard, logistics, orders | auth-identity, catalog, customs, documents, economic-engine, inventory, payments, platform-ops, purchasing, recommendations, refunds, shared-cart |
| `order_status_history` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | — |
| `orders` | `orders` | declared-table-owner | dashboard, economic-engine, orders | auth-identity, catalog, customs, documents, incident-management, inventory, logistics, loyalty, market-control-plane, notifications, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, unsold-resolution, wallet |
| `otp_codes` | `auth-identity` | single-writer | auth-identity | — |
| `outbox_events` | `infrastructure` | single-writer | infrastructure | — |
| `parcel_events` | `logistics` | declared-table-owner | logistics | — |
| `parcel_items` | `logistics` | declared-table-owner | dashboard, logistics, platform-ops | customs, dashboard, documents, economic-engine, inventory, orders, payments, refunds |
| `parcels` | `logistics` | declared-table-owner | dashboard, logistics, platform-ops | auth-identity, customs, dashboard, documents, economic-engine, incident-management, inventory, notifications, orders, payments, recommendations, refunds |
| `partners` | `dashboard` | single-writer | dashboard | — |
| `paypal_events_processed` | `payments` | single-writer | payments | — |
| `physical_offers` | `providers-services` | single-writer | providers-services | market-delegation |
| `physical_outcome_receipts` | `infrastructure` | single-writer | infrastructure | — |
| `pickup_code_generations` | `logistics` | declared-table-owner | logistics | — |
| `pickup_collect_failures` | `logistics` | declared-table-owner | logistics | — |
| `pickup_print_tokens` | `logistics` | declared-table-owner | infrastructure, logistics | — |
| `pickup_reveal_codes` | `logistics` | declared-table-owner | infrastructure, logistics | — |
| `pickup_verify_attempts` | `logistics` | single-writer | logistics | — |
| `price_history` | `economic-engine` | declared-table-owner | economic-engine | — |
| `pricing_benchmarks` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `pricing_category_dims` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_category_taxes` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_components` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_global_access_grants` | _ambiguë_ | no-declared-writer | — | economic-engine, market-control-plane |
| `pricing_market_decision_policy_events` | `economic-engine` | declared-table-owner | economic-engine | — |
| `pricing_matrices_audit` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_maturity_disposition_events` | `economic-engine` | declared-table-owner | economic-engine | — |
| `pricing_strategies` | `economic-engine` | single-writer | economic-engine | — |
| `pricing_strategy_history` | `economic-engine` | single-writer | economic-engine | — |
| `product_attributes` | `catalog` | single-writer | catalog | — |
| `product_content_profile` | `catalog` | single-writer | catalog | — |
| `product_content_sections` | `catalog` | single-writer | catalog | — |
| `product_market_exposure` | `catalog` | declared-table-owner | catalog | dashboard, market-delegation |
| `product_market_price_draft_events` | `market-autonomy` | declared-table-owner | market-autonomy | — |
| `product_market_price_drafts` | `market-autonomy` | declared-table-owner | market-autonomy | catalog, dashboard, market-delegation |
| `product_sku_media` | `catalog` | declared-table-owner | catalog | sourcing |
| `product_sku_physical_codes` | `logistics` | declared-table-owner | logistics | — |
| `product_skus` | `catalog` | declared-table-owner | catalog | market-autonomy, purchasing, sourcing |
| `product_suppliers` | `purchasing` | single-writer | purchasing | logistics |
| `product_variants` | `catalog` | declared-table-owner | catalog | economic-engine, logistics, market-autonomy, orders, sourcing |
| `products` | `catalog` | declared-table-owner | catalog, dashboard, logistics | auth-identity, customs, documents, economic-engine, inventory, local-stock, market-autonomy, market-delegation, orders, platform-ops, purchasing, recommendations, refunds, shared-cart, sourcing, unsold-resolution |
| `provider_credentials` | `sourcing` | declared-table-owner | sourcing | — |
| `providers` | `providers-services` | single-writer | providers-services | market-delegation |
| `purchase_lines` | `purchasing` | declared-table-owner | purchasing | dashboard, refunds |
| `purchase_order_authorizations` | `purchasing` | declared-table-owner | purchasing | logistics |
| `purchase_orders` | `purchasing` | declared-table-owner | purchasing | dashboard, logistics, refunds |
| `purchase_variance_decisions` | `purchasing` | declared-table-owner | purchasing | — |
| `recipients` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | documents, economic-engine, logistics, notifications |
| `refund_execution_intents` | `refunds` | single-writer | refunds | orders |
| `refunds` | `refunds` | single-writer | refunds | documents, economic-engine, orders |
| `relais` | `logistics` | declared-table-owner | dashboard, logistics | auth-identity, documents, economic-engine, local-stock, market-control-plane, market-delegation, notifications, orders, platform-ops, purchasing |
| `relay_product_return_receipts` | `logistics` | declared-table-owner | logistics | — |
| `relay_return_compensations` | `orders` | declared-table-owner | orders | — |
| `revoked_tokens` | `auth-identity` | declared-table-owner | auth-identity, infrastructure | auth |
| `risk_provisions` | `economic-engine` | single-writer | economic-engine | — |
| `scan_events` | `logistics` | declared-table-owner | dashboard, logistics | incident-management, notifications, payments, platform-ops |
| `scans` | `logistics` | declared-table-owner | logistics, orders, platform-ops | dashboard |
| `schema_migrations` | `infrastructure` | single-writer | infrastructure | — |
| `services` | `providers-services` | single-writer | providers-services | market-delegation |
| `shared_cart_events` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_items` | `shared-cart` | single-writer | shared-cart | — |
| `shared_cart_saved_access` | `shared-cart` | single-writer | shared-cart | — |
| `shared_carts` | `shared-cart` | single-writer | shared-cart | — |
| `shipments` | `logistics` | single-writer | logistics | — |
| `signals` | `decision-signals` | declared-table-owner | orders, decision-signals | dashboard |
| `sms_log` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | — |
| `sourcing_candidate_events` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_candidates` | `sourcing` | declared-table-owner | catalog, sourcing | dashboard |
| `sourcing_canonical_entities` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_canonical_entity_refs` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_captures` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_global_access_grants` | _ambiguë_ | no-declared-writer | — | market-control-plane |
| `sourcing_match_proposals` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_observation_evidence` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_observations` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_provider_control_events` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_resolution_bindings` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_resolution_decisions` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_source_provides` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_source_requests` | `sourcing` | declared-table-owner | sourcing | — |
| `sourcing_sources` | `sourcing` | declared-table-owner | sourcing | — |
| `store_credits` | _ambiguë_ | no-declared-writer | — | economic-engine |
| `stripe_events_processed` | `payments` | single-writer | payments | — |
| `supplier_catalog_import_rejections` | `catalog` | declared-table-owner | catalog | — |
| `supplier_catalog_imports` | `catalog` | single-writer | catalog | sourcing |
| `supplier_catalog_sync_checkpoints` | `catalog` | single-writer | catalog | — |
| `supplier_commercial_category_mappings` | `sourcing` | declared-table-owner | sourcing | — |
| `supplier_execution_events` | `purchasing` | declared-table-owner | purchasing | — |
| `supplier_execution_fulfillments` | `purchasing` | declared-table-owner | purchasing | — |
| `supplier_execution_order_lines` | `purchasing` | declared-table-owner | purchasing | — |
| `supplier_execution_orders` | `purchasing` | declared-table-owner | purchasing | — |
| `supplier_execution_payment_proofs` | `purchasing` | declared-table-owner | purchasing | — |
| `supplier_execution_payments` | `purchasing` | declared-table-owner | purchasing | — |
| `supplier_oauth_connections` | `catalog` | single-writer | catalog | — |
| `supplier_payment_settlements` | `purchasing` | single-writer | purchasing | — |
| `suppliers` | `purchasing` | single-writer | purchasing | catalog, sourcing |
| `suppliers_stats` | _ambiguë_ | no-declared-writer | — | dashboard |
| `transaction_documents` | `documents` | single-writer | documents | dashboard |
| `unsold_items` | `unsold-resolution` | single-writer | unsold-resolution | — |
| `user_pickup_authorizations` | `auth-identity` | single-writer | auth-identity | — |
| `users` | `auth-identity` | declared-table-owner | auth-identity, infrastructure | auth, auth-passkey, business-rules, dashboard, documents, economic-engine, logistics, loyalty, market-delegation, notifications, orders, payments, platform-ops, settlement, shared-cart, wallet |
| `v_loyalty_summary` | _ambiguë_ | no-declared-writer | — | loyalty |
| `v_unsold_pipeline` | _ambiguë_ | no-declared-writer | — | unsold-resolution |
| `wallet_consumptions` | `wallet` | multi-writer-resolved-by-classification-signal | dashboard, wallet | — |
| `wallet_credit_lots` | `wallet` | multi-writer-resolved-by-classification-signal | dashboard, wallet | — |
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
| `PUT /api/auth/me/password` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/activate-account` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/password-reset/request` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/password-reset/confirm` | auth-identity | `routes/auth.js` (resolved-owned) |
| `POST /api/auth/step-up/otp/request` | auth-identity | `routes/auth-step-up-otp.js` (resolved-owned) |
| `POST /api/auth/step-up/otp/verify` | auth-identity | `routes/auth-step-up-otp.js` (resolved-owned) |
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
| `GET /api/admin/workspaces/catalog` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/approval/{id}/approve` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/approval/{id}/override` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/approval/{id}/reject` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/categories` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/categories/{id}/deactivate` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/categories/{id}/subcategories` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/categories/{id}/subcategories/{id}/deactivate` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/categories/{id}/subcategories/{id}/update` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/categories/{id}/update` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/products` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/products/{id}/deactivate` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/catalog/products/{id}/update` | catalog | `routes/admin-catalog-workspace.js` (resolved-owned) |
| `POST /api/integrations/aliexpress/oauth/refresh` | catalog | `routes/integrations-aliexpress.js` (resolved-owned) |
| `GET /api/integrations/aliexpress/oauth/start` | catalog | `routes/integrations-aliexpress.js` (resolved-owned) |
| `GET /api/integrations/aliexpress/status` | catalog | `routes/integrations-aliexpress.js` (resolved-owned) |
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
| `GET /api/admin/dashboard/events` | dashboard | `routes/admin-dashboard-events.js` (resolved-owned) |
| `GET /api/admin/demo/orders/{id}/timeline` | dashboard | `routes/admin/demo-order-flow.js` (resolved-owned) |
| `GET /api/dashboard/clients` | dashboard | `routes/dashboard-clients.js` (resolved-owned) |
| `GET /api/admin/entities/clients` | dashboard | `routes/admin-client-index.js` (resolved-owned) |
| `GET /api/admin/entities/clients/market/{id}` | dashboard | `routes/admin-client-index.js` (resolved-owned) |
| `GET /api/dashboard/ops` | dashboard | `routes/dashboard-ops.js` (resolved-owned) |
| `GET /api/dashboard/hub` | dashboard | `routes/dashboard-hub.js` (resolved-owned) |
| `GET /api/hub-dash/dashboard` | dashboa