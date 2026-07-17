# FEATURE 360

_Projection déterministe de lecture au-dessus de la chaîne Feature First O2-O7.3 déjà gouvernée. Feature 360 ne crée aucune nouvelle vérité architecturale ; toute correction se fait dans la source autoritaire existante._

## Global scorecard

- Features : **28**
- Healthy : **5**
- Attention : **23**
- Blocked : **0**
- Business dependencies : **92**
- Direct cross-feature imports : **0**
- Runtime cycles : **0**
- Ambiguous ownership signals : **69**
- Ontology gaps : **0**
- Debt items (total) : **125**

## Features

| Feature | Kind | Boundary | Governance | Owns | Consumes | Consumed by | Debt |
|---|---|---|---|---|---|---|---|
| admin-dashboard | projection | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | sourcing | _aucune_ | 0 |
| auth | technical-transversal | 🟡 ATTENTION | 🟡 ATTENTION | _aucune_ | _aucune_ | catalog, customs, dashboard, documents, economic-engine, infrastructure, inventory, logistics, orders, purchasing, shared-cart, sourcing, unsold-resolution | 4 |
| auth-identity | technical-transversal | 🟢 HEALTHY | 🟡 ATTENTION | otp_codes | notifications | payments, shared-cart, wallet | 1 |
| catalog | business-feature | 🟢 HEALTHY | 🟡 ATTENTION | boutique_categories, boutique_subcategories, catalog_enrichment_runs, catalog_field_overrides, product_attributes, product_content_profile, product_content_sections, supplier_catalog_imports | auth, economic-engine, logistics, shared-cart | economic-engine, infrastructure, logistics, orders, sourcing | 9 |
| customs | business-feature | 🟡 ATTENTION | 🟡 ATTENTION | customs_categories, customs_shipment_parcels, customs_shipments | auth, documents, economic-engine | dashboard, infrastructure, orders, shared-cart | 3 |
| dashboard | business-transversal | 🟡 ATTENTION | 🟡 ATTENTION | order_incidents, partners | auth, customs, decision-signals, documents, economic-engine, logistics, orders, purchasing | economic-engine, infrastructure | 13 |
| decision-signals | piloting-capability | 🟢 HEALTHY | 🟢 HEALTHY | signals | logistics | dashboard, notifications | 0 |
| documents | business-transversal | 🟡 ATTENTION | 🟢 HEALTHY | transaction_documents | auth | customs, dashboard, orders, payments, refunds, shared-cart, wallet | 4 |
| economic-engine | business-feature | 🟡 ATTENTION | 🟡 ATTENTION | competitor_prices, cost_benchmarks, cost_component_events, cost_components, economic_variables, exchange_rates, pricing_category_dims, pricing_category_taxes, pricing_components, pricing_matrices_audit, pricing_strategies, pricing_strategy_history, risk_provisions | auth, catalog, dashboard, loyalty, orders | catalog, customs, dashboard, infrastructure, orders, platform-ops, sourcing | 8 |
| incident-management | business-transversal | 🟡 ATTENTION | 🟡 ATTENTION | _aucune_ | _aucune_ | _aucune_ | 6 |
| infrastructure | technical-transversal | 🟢 HEALTHY | 🟡 ATTENTION | business_rules, business_rules_history, schema_migrations | auth, catalog, customs, dashboard, economic-engine, inventory, logistics, orders, recommendations, shared-cart, wallet | _aucune_ | 21 |
| inventory | business-feature | 🟡 ATTENTION | 🟡 ATTENTION | inventory_items | auth | infrastructure | 2 |
| legacy-control-tower | deprecated | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| logistics | business-feature | 🟡 ATTENTION | 🟡 ATTENTION | carriers, parcel_events, pickup_verify_attempts, shipments | auth, catalog, loyalty, notifications, orders, payments, purchasing, refunds | catalog, dashboard, decision-signals, infrastructure, orders, payments, platform-ops, purchasing, shared-cart | 10 |
| loyalty | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | loyalty_rewards, loyalty_tiers, users | notifications | economic-engine, logistics, orders, payments, shared-cart | 2 |
| notifications | business-transversal | 🟢 HEALTHY | 🟡 ATTENTION | _aucune_ | decision-signals | auth-identity, logistics, loyalty, orders, payments, purchasing, shared-cart | 4 |
| orders | business-feature | 🟡 ATTENTION | 🟡 ATTENTION | customs_history, disputes, order_item_cost_imputations | auth, catalog, customs, documents, economic-engine, logistics, loyalty, notifications, payments, refunds, wallet | dashboard, economic-engine, infrastructure, logistics, payments, platform-ops, purchasing, shared-cart | 10 |
| payments | business-feature | 🟢 HEALTHY | 🟡 ATTENTION | cash_collections, cash_deposits, paypal_events_processed | auth-identity, documents, logistics, loyalty, notifications, orders, purchasing, refunds, wallet | logistics, orders, shared-cart, wallet | 3 |
| platform | frontend-transversal | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| platform-ops | technical-transversal | 🟢 HEALTHY | 🟡 ATTENTION | fabrics, garment_models, parcel_items, parcels, scans, store_credits | economic-engine, logistics, orders | _aucune_ | 2 |
| purchasing | business-feature | 🟢 HEALTHY | 🟡 ATTENTION | product_suppliers, purchase_orders, suppliers | auth, logistics, notifications, orders | dashboard, logistics, payments | 3 |
| recommendations | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | _aucune_ | _aucune_ | infrastructure | 3 |
| refunds | business-transversal | 🟡 ATTENTION | 🟢 HEALTHY | refunds | documents, wallet | logistics, orders, payments, shared-cart | 2 |
| shared-cart | business-feature | 🟡 ATTENTION | 🟡 ATTENTION | basket_items, baskets, cart_contributions, cart_shares, collective_payment_sessions, collective_payment_tokens, collective_stock_reservations, collective_workspace_contributions, collective_workspace_events, collective_workspace_items, collective_workspaces, order_items, recipients, shared_cart_contributions, shared_cart_estimations, shared_cart_events, shared_cart_items, shared_carts, stripe_events_processed | auth, auth-identity, customs, documents, logistics, loyalty, notifications, orders, payments, refunds | catalog, infrastructure | 5 |
| sourcing | business-feature | 🟢 HEALTHY | 🟡 ATTENTION | _aucune_ | auth, catalog, economic-engine | admin-dashboard | 7 |
| unsold-resolution | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | unsold_items | auth | _aucune_ | 2 |
| wallet | business-feature | 🟢 HEALTHY | 🟡 ATTENTION | wallet_consumptions, wallet_credit_lots, wallet_transactions, wallets | auth-identity, documents, payments | infrastructure, orders, payments, refunds | 1 |
| wallet-loyalty | deprecated | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |

## admin-dashboard

**Kind** : projection  ·  **Status** : production

**Service** : Tableau de bord admin SPA multi-vues.

**Perimeter** :
- _in_ :
  - admin/**
- _out_ :
  - API backend

**Authority** : dashboards

**Invariants** :
- tout fichier admin/**/*.js doit etre declare ici

**Owns** : _aucune_

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : sourcing (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** : _aucune_

**Implementation** : 42 fichier(s) déclaré(s)
  - js : 42

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="admin-dashboard"]_

## auth

**Kind** : technical-transversal  ·  **Status** : production

**Service** : Fournir les gardes transverses d'authentification et de vérification d'identité (middlewares JWT/session/rôles) consommées par toutes les autres features.

**Perimeter** :
- _in_ :
  - middlewares de garde transverses : authentification JWT/session, vérification de rôle, identité vérifiée, révocation de token
- _out_ :
  - logique metier propre a chaque feature consommatrice — auth ne sait rien des commandes, paniers ou paiements

**Authority** : backend-core — tout changement de middleware d'authentification doit etre valide par le proprietaire de middleware/auth.js

**Invariants** :
- toute route mutante passe par un middleware d'auth declare — jamais d'acces direct sans garde

**Owns** : _aucune_
**Writes (not owner)** : `users` (writer-not-owner)

**Exposes** : 1 internal API(s), 0 HTTP interface(s)
  - `requireAuth / requireVerifiedIdentity / softAuth` (middleware/auth.js, middleware/require-verified-identity.js, middleware/soft-auth.js) — undeclared-in-graph

**Consumes** : _aucune_
**Consumed by** : catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 2 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 1, declared-only deps: 2, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** (4) :
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "notification" — ne correspond à aucun nom de feature connu
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "operations" — ne correspond à aucun nom de feature connu
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "orders" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `UNRESOLVED_INTERNAL_API` (medium) — requireAuth / requireVerifiedIdentity / softAuth (middleware/auth.js, middleware/require-verified-identity.js, middleware/soft-auth.js) — statut: undeclared-in-graph

**Implementation** : 16 fichier(s) déclaré(s)
  - middleware : 6
  - migrations : 2
  - tests : 8

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="auth"]_

## auth-identity

**Kind** : technical-transversal  ·  **Status** : production

**Service** : Authentifier un utilisateur et gérer son identité active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposées.

**Perimeter** :
- _in_ :
  - routes actives d'identité : OTP (request/verify/test-reset), login/register, magic-link, guest-checkout, admin-reset, consultation/édition du profil et des commandes client
- _out_ :
  - logique metier propre a chaque feature consommatrice — auth-identity ne sait rien des commandes, paniers ou paiements

**Authority** : backend-core — tout changement de middleware d'authentification doit etre valide par le proprietaire de middleware/auth.js

**Invariants** :
- toute route mutante passe par un middleware d'auth declare — jamais d'acces direct sans garde
- les routes de ce manifeste s'appuient sur authenticate (middleware/auth.js, feature auth) — pas de garde ad-hoc

**Owns** : `otp_codes`
**Writes (not owner)** : `revoked_tokens` (ambiguous), `users` (writer-not-owner)

**Exposes** : 1 internal API(s), 20 HTTP interface(s)
  - `makeIntlPhoneInput` (public/boutique/js/b-phone.js) — resolved

**Consumes** : notifications (BUSINESS_TRANSVERSAL_SERVICE)
**Consumed by** : payments (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 2 primitive dependencies, 1 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 1, ontology gaps: 0

**Architectural debt** (1) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table revoked_tokens — écrite par auth-identity (W), aucun lifecycle owner résolu (multi-writer non classifié)

**Implementation** : 11 fichier(s) déclaré(s), boutique: 4 fichier(s)
  - boutique : 3
  - routes : 3
  - services : 1
  - tests : 4

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="auth-identity"]_

## catalog

**Kind** : business-feature  ·  **Status** : production

**Service** : Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.

**Perimeter** :
- _in_ :
  - connecteurs fournisseurs (CSV, API, manuel, Noon)
  - contrat source fournisseur versionne V1/V2 : brut integral + preservation explicite media, axes et unites vendables quand la source les connait
  - publication et audit prix produit
  - categories boutique admin
  - catalogue vivant Boutique : grille, cartes produit, ouverture fiche produit
  - catalogue canonique : produit, medias publics, axes d options descriptifs et unites vendables SKU
  - contrat detail produit public v1 : identity, pricing, media, option_axes, sellable_units et delivery_options deja resolues par leurs autorites
  - projection des rails de livraison deja commercialement exposes par logistics, sans inventer prix ni delai
  - modal produit catalogue : un fetch Product Detail, un etat de selection SKU, deux compositions responsive mobile/desktop
  - raffinerie catalogue : donnee source EN conservee, eligibilite douane/transport (catalog_exclusions), enrichissement FR, overrides traces, approbation humaine unique
  - glossaire metier EN->FR (catalog_glossary)
  - file d approbation admin (etage 6) : approve/reject/override en un ecran, seul point de validation humaine avant lifecycle_status=active
- _out_ :
  - calcul du prix final et valorisation transport (feature economic-engine)
  - decision de rail, routing et eligibilite logistique dynamique (feature logistics)
  - mise en avant / classement (feature recommendations)
  - fiche snapshot lecture seule du panier partage (feature shared-cart)
  - checkout final et paiement (features orders/payments)

**Authority** : backend-core — normalized-product possede le contrat source versionne ; catalog possede le catalogue canonique et le contrat detail public ; toute modification modal catalogue suit DOCTRINE_PRODUCT_DETAIL_CONTRACT.md et docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md

**Invariants** :
- un produit publie a toujours passe product-publication-guard.js
- jamais de creation produit par formulaire vide : tout entre par un connecteur (le manuel EST un connecteur)
- la donnee source ne se perd jamais : raw_payload reste le brut integral et normalized_source_contract preserve separement le mapping V2 valide
- une structure riche connue ne doit pas etre aplatie puis reconstruite par heuristique ; une source pauvre reste pauvre honnêtement
- toute retouche manuelle est un override trace (catalog_field_overrides), jamais une edition de la fiche generee
- la boutique ne lit que les champs publies : les champs de cuisine source/content_source/normalized_source_contract lui sont invisibles
- une unite vendable = un SKU ; product_variants decrit les axes et ne porte pas la verite de stock cible
- GET /api/products/:id/detail retourne un contrat v1 valide par schema ; un produit legacy expose ses axes mais aucune fausse sellable_unit
- le contrat detail compose des faits et resultats proprietaires ; il ne recalcule ni pricing ni routing ni eligibilite rail
- delivery_options contient uniquement les rails deja commercialement exposes par logistics ; absence de prix ou ETA reste null tant qu aucun moteur proprietaire ne les fournit
- le frontend ne decide jamais d un rail ni d un delai universel de livraison
- mobile et desktop chargent le meme contrat detail et consomment le meme etat de selection SKU
- un seul owner derive disponibilite et media courants ; les renderers responsive ne font que composer
- b-modal-desktop-enhancers ne calcule ni prix ni stock ni livraison ni sous-total
- b-modal-approche-c-hybrid ne rend ni livraison produit ni sous-total produit
- le prompt d enrichissement est du code : versionne dans le depot, chaque run trace, un echec IA ne bloque jamais un import
- la modal produit affiche le catalogue vivant et ne doit pas servir de fiche snapshot panier partage
- le parcours mobile Voir en grand appartient a b-modal-image-ux.js et modal-media.css
- aucune fiche candidate issue du pipeline ne passe lifecycle_status=active sans etre passee par la file d approbation, meme si needs_review est faux

**Owns** : `boutique_categories`, `boutique_subcategories`, `catalog_enrichment_runs`, `catalog_field_overrides`, `product_attributes`, `product_content_profile`, `product_content_sections`, `supplier_catalog_imports`
**Writes (not owner)** : `alerts` (ambiguous), `catalog_media` (ambiguous), `price_history` (ambiguous), `product_sku_media` (ambiguous), `product_skus` (ambiguous), `product_variants` (ambiguous), `products` (ambiguous), `sourcing_candidate_events` (ambiguous), `sourcing_candidates` (ambiguous)

**Exposes** : 0 internal API(s), 31 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)
**Consumed by** : economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)

**Projections** : admin-dashboard

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 9, ontology gaps: 0

**Architectural debt** (9) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table alerts — écrite par catalog (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table catalog_media — écrite par catalog (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table price_history — écrite par catalog (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table product_sku_media — écrite par catalog (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table product_skus — écrite par catalog (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table product_variants — écrite par catalog (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table products — écrite par catalog (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table sourcing_candidate_events — écrite par catalog (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table sourcing_candidates — écrite par catalog (RW), aucun lifecycle owner résolu (multi-writer non classifié)

**Implementation** : 128 fichier(s) déclaré(s), boutique: 24 fichier(s)
  - boutique : 39
  - dash : 4
  - docs : 4
  - migrations : 9
  - routes : 5
  - schemas : 3
  - services : 26
  - tests : 37
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="catalog"]_

## customs

**Kind** : business-feature  ·  **Status** : production

**Service** : Classer et declarer un colis douanierement ; la declaration est le pivot, jamais une optimisation.

**Perimeter** :
- _in_ :
  - classification douaniere
  - analytics douane
  - categories et shipments admin douane
- _out_ :
  - transport physique du colis (feature logistics, qui consomme le statut douane)
  - generation de la facture douane document (feature documents)

**Authority** : backend-core — toute regle de classification doit etre validee par le proprietaire de customs-classification.js, conformement a docs/doctrine/DOUANE_DECLARATION_PIVOT.md

**Invariants** :
- la declaration est instrumentee, jamais optimisee pour reduire un cout

**Owns** : `customs_categories`, `customs_shipment_parcels`, `customs_shipments`
**Writes (not owner)** : `order_item_real_cost_allocations` (ambiguous), `orders` (ambiguous), `parcels` (writer-not-owner)

**Exposes** : 0 internal API(s), 20 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : admin-dashboard

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 2, ontology gaps: 0

**Architectural debt** (3) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table order_item_real_cost_allocations — écrite par customs (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par customs (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "logistics" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 20 fichier(s) déclaré(s)
  - dash : 2
  - migrations : 6
  - routes : 3
  - services : 3
  - tests : 6

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="customs"]_

## dashboard

**Kind** : business-transversal  ·  **Status** : production

**Service** : Exposer en lecture agrégée les données opérationnelles et financières pour le contrôle total de la plateforme via les dashboards admin (Control Tower, Pilotage, Santé, Clients, Hub, Relais).

**Perimeter** :
- _in_ :
  - routes agrégées dashboard admin (KPIs, clients, opérations, hub, relais, radar, risques)
  - queries de métriques et cache dashboard
  - shell admin SPA + views opérationnelles (ControlTower, Pilotage, Santé, Simulator, ActionCenter)
  - admin-legacy Control Tower v7 (actif en prod)
  - auth-guard et composants partagés du shell admin
- _out_ :
  - mutations de données (chaque feature métier owns ses mutations)
  - logique panier, commandes, paiements (feature orders / payments / shared-cart)
  - moteur tarifaire (feature economic-engine)
  - views métier déléguées : PricingView, ProductsView, CategoriesView, etc.

**Authority** : backend-core — tout ajout de route agrégée ou de requête de métriques doit être validé par le propriétaire de dashboard-metrics.js et dashboard-cache.js

**Invariants** :
- dashboard agrège en lecture pour les vues de pilotage/reporting (Control Tower, Pilotage, Santé, Clients, radar, risques) : ces surfaces-là ne mutent aucune donnée. À l'inverse, les routes hub/relais/admin opérationnelles (voir db.tables entrées W/RW) écrivent réellement — ancien invariant "lecture seule" corrigé au Lot O1.5 (2026-07-12) car contredit par le code ; voir debt.knownGaps pour le plan de redistribution de ces mutations vers leurs features propriétaires
- les métriques passent par dashboard-cache.js (pas de requêtes directes dupliquées)
- admin-legacy ct-app-v7.js / ct-views-v7.js sont actifs en prod — ne pas supprimer sans migration
- auth-guard.js protège toutes les routes admin ; aucune route admin sans vérification de token

**Owns** : `order_incidents`, `partners`
**Writes (not owner)** : `basket_items` (writer-not-owner), `baskets` (writer-not-owner), `incidents` (ambiguous), `invoices` (ambiguous), `loyalty_rewards` (writer-not-owner), `order_comments` (ambiguous), `order_items` (writer-not-owner), `order_status_history` (ambiguous), `orders` (ambiguous), `parcel_items` (writer-not-owner), `parcels` (writer-not-owner), `products` (ambiguous), `recipients` (writer-not-owner), `relais` (ambiguous), `scan_events` (ambiguous), `scans` (writer-not-owner), `sms_log` (ambiguous), `users` (writer-not-owner), `wallet_transactions` (writer-not-owner), `wallets` (writer-not-owner)

**Exposes** : 0 internal API(s), 70 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), decision-signals (PILOTING_CAPABILITY), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED)
**Consumed by** : economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)

**Projections** : admin-dashboard

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 4
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 9, ontology gaps: 0

**Architectural debt** (13) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table incidents — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table invoices — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table order_comments — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table order_status_history — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table products — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table relais — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table scan_events — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table sms_log — écrite par dashboard (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "inventory" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "payments" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "recommendations" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 142 fichier(s) déclaré(s)
  - dash : 80
  - migrations : 1
  - routes : 17
  - services : 11
  - tests : 33

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="dashboard"]_

## decision-signals

**Kind** : piloting-capability  ·  **Status** : staging

**Service** : Detecter et qualifier des signaux operationnels (cash, colis, incidents) a partir des donnees produites par plusieurs features, pour l'aide a la decision admin.

**Perimeter** :
- _in_ :
  - generation de signaux depuis des requetes radar cross-feature (cash, colis, incidents)
  - cycle de vie du signal : acknowledge / resolve / snooze
  - consultation admin des signaux (routes/signals.js)
- _out_ :
  - aucune decision metier engageante : la capability detecte, elle ne tranche aucun statut de commande, colis ou wallet
  - aucune UI propre : la restitution visuelle passe par dashboard (routes/admin-radar.js), qui reste une projection
  - classement produit boutique (feature recommendations, qui reste seule proprietaire du ranking)

**Invariants** :
- un signal est un constat derive, jamais une mutation d'une table possedee par une autre feature
- acknowledge/resolve/snooze changent uniquement l'etat du signal, jamais l'etat de la donnee source

**Owns** : `signals`

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : logistics (BUSINESS_FEATURE_INTERFACE)
**Consumed by** : dashboard (PILOTING_CAPABILITY), notifications (PILOTING_CAPABILITY)

**Projections** : admin-dashboard

**Technical context** : 2 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** : _aucune_

**Implementation** : 6 fichier(s) déclaré(s)
  - routes : 1
  - services : 2
  - tests : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="decision-signals"]_

## documents

**Kind** : business-transversal  ·  **Status** : production

**Service** : Generer un document officiel (preuve de retrait, facture douane, reçu wallet, reçu remboursement) a partir d'un evenement metier confirme.

**Perimeter** :
- _in_ :
  - generation PDF/HTML de preuve de retrait, facture douane, reçu wallet, reçu remboursement
- _out_ :
  - decision qu'un document doit etre genere (reste a la feature source : orders, customs, wallet, refunds)

**Authority** : backend-core — tout changement de gabarit de document doit etre valide par le proprietaire de document-service.js

**Invariants** :
- un document genere est immuable une fois emis — toute correction passe par une nouvelle generation versionnee

**Owns** : `transaction_documents`

**Exposes** : 0 internal API(s), 3 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED)
**Consumed by** : customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (BUSINESS_TRANSVERSAL_SERVICE), refunds (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (BUSINESS_TRANSVERSAL_SERVICE)

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 4
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** (4) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "customs" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "orders" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "refunds" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 26 fichier(s) déclaré(s)
  - migrations : 5
  - routes : 1
  - services : 5
  - tests : 10
  - utils : 5

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="documents"]_

## economic-engine

**Kind** : business-feature  ·  **Status** : production

**Service** : Calculer le prix, le cout et la marge d'un produit ou d'une commande selon une strategie tarifaire versionnee.

**Perimeter** :
- _in_ :
  - moteur de pricing et application des regles
  - allocation de cout
  - strategies tarifaires et matrices admin
  - gestion des provisions pour risque (routes/admin-risk-provisions.js — retaggé @domain economic-engine au Lot O2, était @domain dashboard)
- _out_ :
  - affichage produit cote catalogue (feature catalog, qui consomme economic-engine)
  - facturation finale (feature orders)

**Authority** : backend-core — tout changement de formule de prix doit etre valide par le proprietaire de pricing-engine.js

**Invariants** :
- une strategie tarifaire est versionnee, jamais modifiee retroactivement sur une commande deja figee

**Owns** : `competitor_prices`, `cost_benchmarks`, `cost_component_events`, `cost_components`, `economic_variables`, `exchange_rates`, `pricing_category_dims`, `pricing_category_taxes`, `pricing_components`, `pricing_matrices_audit`, `pricing_strategies`, `pricing_strategy_history`, `risk_provisions`
**Writes (not owner)** : `charges` (ambiguous), `economic_snapshots` (ambiguous), `finance_config` (ambiguous), `order_item_real_cost_allocations` (ambiguous), `price_history` (ambiguous), `product_variants` (ambiguous), `products` (ambiguous)

**Exposes** : 1 internal API(s), 73 HTTP interface(s)
  - `recommend` (services/pricing-engine.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)

**Projections** : admin-dashboard

**Technical context** : 1 primitive dependencies, 1 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 7, ontology gaps: 0

**Architectural debt** (8) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table charges — écrite par economic-engine (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table economic_snapshots — écrite par economic-engine (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table finance_config — écrite par economic-engine (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table order_item_real_cost_allocations — écrite par economic-engine (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table price_history — écrite par economic-engine (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table product_variants — écrite par economic-engine (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table products — écrite par economic-engine (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 107 fichier(s) déclaré(s)
  - dash : 6
  - migrations : 18
  - routes : 12
  - services : 24
  - tests : 45
  - utils : 2

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="economic-engine"]_

## incident-management

**Kind** : business-transversal  ·  **Status** : production

**Service** : Détecter, qualifier et résoudre les écarts entre l'état attendu et l'état réel d'une opération, avec impact client traçable.

**Perimeter** :
- _in_ :
  - création, qualification (type/sévérité/impact client) et résolution (reship/refund/manual_fix/dismissed/auto_resolved) d'un incident
  - table incidents en écriture multi-domaines : logistics (scan-engine), payments (reconciliation-service), notifications (alert-engine), dashboard (ops-api legacy, SQL inline hors incident-service.js)
  - engagement opérationnel réel déclenché par une résolution (ex. reship crée un incident fils)
- _out_ :
  - logique métier propre au domaine qui a détecté l'écart (logistics, payments, notifications restent propriétaires de leurs propres flux)
  - health check / observation technique passive (feature platform-ops)

**Authority** : backend-core — tout changement de lifecycle incident doit etre valide par le proprietaire de services/incident-service.js

**Invariants** :
- jamais de suppression d'incident (soft-close uniquement)
- résolution explicite avec raison et type
- une résolution reship crée un incident fils

**Owns** : _aucune_
**Writes (not owner)** : `incidents` (ambiguous)

**Exposes** : 5 internal API(s), 0 HTTP interface(s)
  - `escalateIncident` (services/incident-service.js) — resolved
  - `getIncident` (services/incident-service.js) — resolved
  - `getIncidentDashboard` (services/incident-service.js) — resolved
  - `listIncidents` (services/incident-service.js) — resolved
  - `resolveIncident` (services/incident-service.js) — resolved

**Consumes** : _aucune_
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 4
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 1, ambiguous ownership: 1, ontology gaps: 0

**Architectural debt** (6) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table incidents — écrite par incident-management (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "dashboard / ops-api legacy (écrit incidents — SQL inline)" — ne correspond à aucun nom de feature connu
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "dashboard" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "logistics" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "notifications" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "payments" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 2 fichier(s) déclaré(s)
  - services : 1
  - tests : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="incident-management"]_

## infrastructure

**Kind** : technical-transversal  ·  **Status** : production

**Service** : Infrastructure transversale consommée par toutes les features : middleware non-auth (error-handler, rate-limit, request-id, upload, validate), utilitaires partagés (logger, phone, rates, reference, rules), barrel de validation Joi, et bootstrap applicatif (Express, routes, crons, env, sécurité, migrations startup).

**Perimeter** :
- _in_ :
  - middleware non-auth
  - utils transversaux
  - validators
  - bootstrap
- _out_ :
  - middleware auth (feature auth)
  - services métier
  - logique backend spécifique

**Authority** : backend — ces fichiers sont consommés par toutes les features. Tout changement ici a un impact potentiel global.

**Invariants** :
- tout fichier middleware/ non-auth doit être listé ici
- tout fichier utils/ à @domain infrastructure doit être listé ici
- tout fichier bootstrap/ doit être listé ici
- validators/index.js est le barrel unique de validation

**Owns** : `business_rules`, `business_rules_history`, `schema_migrations`
**Writes (not owner)** : `charges` (ambiguous), `economic_snapshots` (ambiguous), `finance_config` (ambiguous), `pickup_print_tokens` (ambiguous), `pickup_reveal_codes` (ambiguous), `revoked_tokens` (ambiguous), `users` (writer-not-owner)

**Exposes** : 12 internal API(s), 5 HTTP interface(s)
  - `bootstrap/* — démarrage Express, routage, crons, migrations`  — undeclared-in-graph
  - `middleware/error-handler.js — gestion centralisée des erreurs Express`  — undeclared-in-graph
  - `middleware/rate-limit.js — rate limiting par IP/route`  — undeclared-in-graph
  - `middleware/request-id.js — injection X-Request-Id`  — undeclared-in-graph
  - `middleware/upload.js — multer file upload`  — undeclared-in-graph
  - `middleware/validate.js — validation Joi des requêtes`  — undeclared-in-graph
  - `utils/logger.js — wrapper pino structuré`  — undeclared-in-graph
  - `utils/phone.js — normalisation numéros téléphone Comores`  — undeclared-in-graph
  - `utils/rates.js — taux de change KMF/EUR`  — undeclared-in-graph
  - `utils/reference.js — génération de références commande/colis`  — undeclared-in-graph
  - _...2 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 9 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 12, declared-only deps: 3, ambiguous ownership: 6, ontology gaps: 0

**Architectural debt** (21) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table charges — écrite par infrastructure (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table economic_snapshots — écrite par infrastructure (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table finance_config — écrite par infrastructure (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table pickup_print_tokens — écrite par infrastructure (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table pickup_reveal_codes — écrite par infrastructure (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table revoked_tokens — écrite par infrastructure (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "notification — bootstrap/api-routes.js monte les routes notification" — ne correspond à aucun nom de feature connu
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "operations — bootstrap/api-routes.js monte les routes operations" — ne correspond à aucun nom de feature connu
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "payment — bootstrap/api-routes.js monte les routes payment" — ne correspond à aucun nom de feature connu
- `UNRESOLVED_INTERNAL_API` (medium) — bootstrap/* — démarrage Express, routage, crons, migrations (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — middleware/error-handler.js — gestion centralisée des erreurs Express (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — middleware/rate-limit.js — rate limiting par IP/route (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — middleware/request-id.js — injection X-Request-Id (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — middleware/upload.js — multer file upload (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — middleware/validate.js — validation Joi des requêtes (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — utils/logger.js — wrapper pino structuré (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — utils/phone.js — normalisation numéros téléphone Comores (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — utils/rates.js — taux de change KMF/EUR (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — utils/reference.js — génération de références commande/colis (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — utils/rules.js — moteur de règles métier centralisé (null) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — validators/index.js — barrel des schémas Joi (null) — statut: undeclared-in-graph

**Implementation** : 384 fichier(s) déclaré(s)
  - assets : 37
  - bootstrap : 8
  - ci : 25
  - config : 11
  - db : 16
  - docs : 167
  - middleware : 5
  - migrations : 6
  - scripts : 85
  - tests : 17
  - utils : 6
  - validators : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="infrastructure"]_

## inventory

**Kind** : business-feature  ·  **Status** : staging

**Service** : Réceptionner, affecter et dispatcher les articles au hub.

**Perimeter** :
- _in_ :
  - suivi de stock et endpoint de lecture/mise a jour
- _out_ :
  - decision de publication produit (feature catalog, qui consomme inventory)

**Authority** : backend-core — tout changement de calcul de disponibilite doit etre valide par le proprietaire de inventory-service.js

**Invariants** :
- le stock ne descend jamais sous zero sans flag explicite de surventee assumee

**Owns** : `inventory_items`
**Writes (not owner)** : `orders` (ambiguous), `parcel_items` (writer-not-owner)

**Exposes** : 0 internal API(s), 8 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED)
**Consumed by** : infrastructure (DECLARED_AND_OBSERVED)

**Projections** : admin-dashboard

**Technical context** : 1 primitive dependencies, 1 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 1, ontology gaps: 0

**Architectural debt** (2) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par inventory (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "catalog" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 6 fichier(s) déclaré(s)
  - dash : 1
  - routes : 1
  - services : 1
  - tests : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="inventory"]_

## legacy-control-tower

**Kind** : deprecated  ·  **Status** : deprecated

**Service** : Ancien control tower — deprecated.

**Perimeter** :
- _in_ :
  - admin-legacy/js/**
- _out_ :
  - admin/ (remplacement)

**Authority** : dashboards

**Invariants** :
- tout fichier legacy doit rester ici

**Owns** : _aucune_

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : _aucune_
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** : _aucune_

**Implementation** : 37 fichier(s) déclaré(s)
  - js : 37

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="legacy-control-tower"]_

## logistics

**Kind** : business-feature  ·  **Status** : production

**Service** : Faire transiter un colis du scan initial au retrait final, avec tracking client et transporteur.

**Perimeter** :
- _in_ :
  - scan et operations colis
  - creation automatique de colis
  - secrets de retrait
  - tracking client et transitaire
  - relais et transporteurs
  - consignes hub prescrites au scan : repack, mesure volume, photo de scelle (bornes de responsabilite)
  - saisie volumes produits (POST /hub/volume) et photos de scelle (POST /hub/photo)
- _out_ :
  - cout du transport (feature economic-engine)
  - declaration douaniere (feature customs)
  - preuve de retrait document (feature documents, consommee ici)

**Authority** : backend-core — tout changement de la machine de scan doit etre valide par le proprietaire de scan-engine.js

**Invariants** :
- le fret maritime ne se ventile jamais au poids : volume si snapshot, repartition egale confidence low sinon
- un produit tague fragile ne se repacke jamais (repack_exempt) : la protection prime sur le volume
- la photo de scelle Dubai est la borne 1 de responsabilite : avant = fournisseur, apres = transport
- le systeme prescrit (repack/measure/photo), l agent execute, jamais l inverse (R2)
- un colis ne change de statut que via une sequence de scan validee
- secret de retrait a usage unique

**Owns** : `carriers`, `parcel_events`, `pickup_verify_attempts`, `shipments`
**Writes (not owner)** : `alerts` (ambiguous), `incidents` (ambiguous), `order_items` (writer-not-owner), `orders` (ambiguous), `parcel_items` (writer-not-owner), `parcels` (writer-not-owner), `pickup_print_tokens` (ambiguous), `pickup_reveal_codes` (ambiguous), `relais` (ambiguous), `scan_events` (ambiguous), `scans` (writer-not-owner)

**Exposes** : 1 internal API(s), 68 HTTP interface(s)
  - `transitionParcelStatus` (services/parcel-operations.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (BUSINESS_FEATURE_INTERFACE), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : admin-dashboard

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 3
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 7, ontology gaps: 0

**Architectural debt** (10) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table alerts — écrite par logistics (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table incidents — écrite par logistics (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par logistics (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table pickup_print_tokens — écrite par logistics (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table pickup_reveal_codes — écrite par logistics (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table relais — écrite par logistics (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table scan_events — écrite par logistics (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "customs" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "economic-engine" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 77 fichier(s) déclaré(s)
  - boutique : 1
  - dash : 2
  - docs : 4
  - middleware : 1
  - migrations : 2
  - routes : 18
  - services : 13
  - tests : 33
  - utils : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="logistics"]_

## loyalty

**Kind** : business-feature  ·  **Status** : production

**Service** : Calculer et maintenir le statut de fidelite d'un client (palier + compteur gros panier) et ses recompenses.

**Perimeter** :
- _in_ :
  - calcul et recalcul du palier de fidelite (recalculate_loyalty(), fonction DB appelee par routes/loyalty.js)
  - compteur et notification de gros panier (big_basket_count / big_basket_last_notified_count)
  - creation des recompenses "pending" (loyalty_rewards) au declenchement du seuil gros panier
  - synthese de fidelite exposee (v_loyalty_summary) et grille des paliers (loyalty_tiers)
- _out_ :
  - solde et mouvements wallet (feature wallet, scindee de wallet-loyalty au Lot O1)
  - paiement carte/PayPal (feature payments)
  - remboursement (feature refunds)
  - traitement admin des recompenses en attente (routes/admin-loyalty.js — actuellement @domain dashboard, ecrit loyalty_rewards.status ; voir ONTOLOGY_GAP, non deplace dans ce lot)

**Authority** : backend-core — tout changement de calcul de palier ou de recompense doit etre valide par le proprietaire de loyalty-service.js

**Invariants** :
- ne pas changer les calculs de fidelite (Lot O1 — ontology refactor, pas product refactor)
- le recalcul de palier est idempotent : rejouable sans dupliquer une recompense deja accordee

**Owns** : `loyalty_rewards`, `loyalty_tiers`, `users`

**Exposes** : 0 internal API(s), 7 HTTP interface(s)

**Consumes** : notifications (BUSINESS_TRANSVERSAL_SERVICE)
**Consumed by** : economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 2 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** (2) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "auth-identity" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 5 fichier(s) déclaré(s)
  - routes : 1
  - services : 1
  - tests : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="loyalty"]_

## notifications

**Kind** : business-transversal  ·  **Status** : production

**Service** : Emettre une alerte ou un message sortant (WhatsApp, notification interne) declenche par une autre feature.

**Perimeter** :
- _in_ :
  - envoi WhatsApp via Meta
  - moteur d'alertes internes
  - routes d'emission de notification
- _out_ :
  - decision de declencher une notification (reste a la feature emettrice : orders, payments, etc.)
  - tests/unit/notification-service.test.js

**Authority** : backend-core — tout changement de template ou de canal doit etre valide par le proprietaire de notification-service.js

**Invariants** :
- notifications est un puits d'evenements — elle ne decide jamais elle-meme qu'un evenement metier a eu lieu
- livraison outbound best-effort — l'echec d'envoi WhatsApp ne doit jamais bloquer la transaction emettrice (fire-and-forget)

**Owns** : _aucune_
**Writes (not owner)** : `alerts` (ambiguous), `incidents` (ambiguous), `notification_log` (ambiguous)

**Exposes** : 5 internal API(s), 4 HTTP interface(s)
  - `notifyLoyaltyEarned` (services/notifications/loyalty.js) — resolved
  - `notifyOrder*` (services/notifications/order.js) — resolved
  - `notifyParcel*` (services/notifications/parcel.js) — resolved
  - `notifyText` (services/notifications/misc.js) — resolved
  - `sendOtpMessage / sendMagicLink` (services/notifications/otp-auth.js) — resolved

**Consumes** : decision-signals (PILOTING_CAPABILITY)
**Consumed by** : auth-identity (BUSINESS_TRANSVERSAL_SERVICE), logistics (DECLARED_AND_OBSERVED), loyalty (BUSINESS_TRANSVERSAL_SERVICE), orders (BUSINESS_TRANSVERSAL_SERVICE), payments (BUSINESS_TRANSVERSAL_SERVICE), purchasing (BUSINESS_TRANSVERSAL_SERVICE), shared-cart (BUSINESS_TRANSVERSAL_SERVICE)

**Projections** : _aucune_

**Technical context** : 2 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 1, ambiguous ownership: 3, ontology gaps: 0

**Architectural debt** (4) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table alerts — écrite par notifications (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table incidents — écrite par notifications (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table notification_log — écrite par notifications (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "toutes les features emettrices (orders, payments, shared-cart, refunds...) en entree evenementielle uniquement" — ne correspond à aucun nom de feature connu

**Implementation** : 36 fichier(s) déclaré(s)
  - migrations : 5
  - routes : 3
  - services : 11
  - tests : 16
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="notifications"]_

## orders

**Kind** : business-feature  ·  **Status** : production

**Service** : Faire exister une commande, de la creation au statut final, avec un cout figure et une reference lisible.

**Perimeter** :
- _in_ :
  - creation, annulation, machine de statut de la commande
  - snapshot de cout a la commande
  - rattachement aux colis et aux achats fournisseurs
  - facturation et token public de facture
  - collecte QR au retrait
- _out_ :
  - encaissement du paiement (feature payments)
  - logique panier partage (feature shared-cart, consommatrice d'orders)
  - remboursement (feature refunds, lecture seule sur orders)
  - tarification (feature economic-engine, orders ne fait que la consommer)
  - engagement fournisseur : création, confirmation et réception d'un bon de commande (feature purchasing, scindée d'orders au Lot O1.4, 2026-07-12) — orders ne fait que consommer purchasing (lecture) et libérer les bons de commande liés à l'annulation (cancel-order-purchase-orders.js, reste dans orders car appelé exclusivement par order-status-machine.js)

**Authority** : backend-core — tout changement de la machine de statut ou du schema order_reference doit etre valide par le proprietaire de order-status-machine.js

**Invariants** :
- annulation libre et 100% avant ordered (plancher 24h) ; commande ferme des ordered — demande wallet-only ensuite (DOCTRINE_ANNULATION)
- le badge Remboursable/Ferme du suivi EST le contrat : il ne dit jamais autre chose que ce que le code fait
- tout remboursement retourne au payeur, jamais au destinataire
- reference de commande lisible et unique
- snapshot de cout figure a la creation, jamais recalcule retroactivement
- transition de statut uniquement via order-status-machine.js
- annulation libere les achats fournisseurs lies dans la meme transaction

**Owns** : `customs_history`, `disputes`, `order_item_cost_imputations`
**Writes (not owner)** : `alerts` (ambiguous), `cart_shares` (writer-not-owner), `invoices` (ambiguous), `order_comments` (ambiguous), `order_items` (writer-not-owner), `order_status_history` (ambiguous), `orders` (ambiguous), `purchase_orders` (writer-not-owner), `recipients` (writer-not-owner), `scans` (writer-not-owner), `sms_log` (ambiguous)

**Exposes** : 1 internal API(s), 33 HTTP interface(s)
  - `transitionOrderStatus` (services/order-status-machine.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (BUSINESS_TRANSVERSAL_SERVICE), payments (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : admin-dashboard

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 2, ambiguous ownership: 6, ontology gaps: 0

**Architectural debt** (10) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table alerts — écrite par orders (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table invoices — écrite par orders (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table order_comments — écrite par orders (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table order_status_history — écrite par orders (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par orders (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table sms_log — écrite par orders (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "notification" — ne correspond à aucun nom de feature connu
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "payment" — ne correspond à aucun nom de feature connu
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "dashboard" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "purchasing" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 49 fichier(s) déclaré(s)
  - routes : 13
  - services : 9
  - tests : 26
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="orders"]_

## payments

**Kind** : business-feature  ·  **Status** : production

**Service** : Encaisser un paiement (carte, PayPal, especes au retrait) et confirmer son etat de facon idempotente.

**Perimeter** :
- _in_ :
  - integration Stripe et PayPal (intent, webhook, evenements)
  - paiement cash au retrait et relances cash
  - confirmation de paiement et idempotence webhook
- _out_ :
  - creation de la commande elle-meme (feature orders)
  - remboursement (feature refunds, qui consomme payments en lecture)
  - credit wallet (feature wallet-loyalty)

**Authority** : backend-core — tout changement de webhook ou de logique d'idempotence doit etre valide par le proprietaire de payment-service.js

**Invariants** :
- idempotence stricte sur tout webhook (Stripe, PayPal)
- aucun secret de paiement en dur dans le code
- un paiement confirme ne peut etre confirme deux fois

**Owns** : `cash_collections`, `cash_deposits`, `paypal_events_processed`
**Writes (not owner)** : `alerts` (ambiguous), `incidents` (ambiguous), `orders` (ambiguous), `parcels` (writer-not-owner), `stripe_events_processed` (writer-not-owner)

**Exposes** : 3 internal API(s), 18 HTTP interface(s)
  - `makeInput` (public/boutique/js/b-checkout.js) — resolved
  - `markPaid` (services/payment-service.js) — resolved
  - `markRefunded` (services/payment-service.js) — resolved

**Consumes** : auth-identity (DECLARED_AND_OBSERVED), documents (BUSINESS_TRANSVERSAL_SERVICE), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (BUSINESS_TRANSVERSAL_SERVICE), orders (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (BUSINESS_TRANSVERSAL_SERVICE), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : admin-dashboard

**Technical context** : 3 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 3, ontology gaps: 0

**Architectural debt** (3) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table alerts — écrite par payments (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table incidents — écrite par payments (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par payments (RW), aucun lifecycle owner résolu (multi-writer non classifié)

**Implementation** : 37 fichier(s) déclaré(s), boutique: 2 fichier(s)
  - boutique : 4
  - migrations : 1
  - routes : 4
  - services : 11
  - tests : 17

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="payments"]_

## platform

**Kind** : frontend-transversal  ·  **Status** : production

**Service** : Infrastructure transversale dashboards (auth-guard, service worker, composants colis partages, QR viewer).

**Perimeter** :
- _in_ :
  - js/*, sw.js — utilitaires partages hors admin/
- _out_ :
  - vues admin (consomment ces utilitaires)

**Authority** : dashboards — tout changement de perimetre de ce domaine doit etre reflete ici.

**Invariants** :
- tout fichier js/* ou sw.js hors admin/ doit etre declare ici

**Owns** : _aucune_

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : _aucune_
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** : _aucune_

**Implementation** : 4 fichier(s) déclaré(s)
  - js : 4

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="platform"]_

## platform-ops

**Kind** : technical-transversal  ·  **Status** : production

**Service** : Exposer la sante applicative, la configuration et les modules actifs — infrastructure d'exploitation, pas de service metier.

**Perimeter** :
- _in_ :
  - health check, configuration exposee, liste de modules actifs, API d'operations interne
- _out_ :
  - toute logique metier — platform-ops n'a pas de regle metier propre

**Authority** : backend-core — infrastructure partagee, changement valide par l'equipe plateforme

**Invariants** :
- les surfaces de santé et monitoring n'écrivent aucune donnée métier
- le simulator écrit dans les tables d'autres features par design de simulation
- les modules (fabrics, garment_models) sont les seules tables possédées par platform-ops

**Owns** : `fabrics`, `garment_models`, `parcel_items`, `parcels`, `scans`, `store_credits`
**Writes (not owner)** : `notification_log` (ambiguous), `orders` (ambiguous)

**Exposes** : 0 internal API(s), 33 HTTP interface(s)

**Consumes** : economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 2 primitive dependencies, 4 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 2, ontology gaps: 0

**Architectural debt** (2) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table notification_log — écrite par platform-ops (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par platform-ops (RW), aucun lifecycle owner résolu (multi-writer non classifié)

**Implementation** : 38 fichier(s) déclaré(s)
  - boutique : 7
  - routes : 5
  - services : 6
  - tests : 20

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="platform-ops"]_

## purchasing

**Kind** : business-feature  ·  **Status** : production

**Service** : Transformer un besoin d'approvisionnement issu d'une commande en engagement fournisseur traçable (bon de commande), puis constater sa réception.

**Perimeter** :
- _in_ :
  - déclenchement automatique d'un bon de commande (purchase_order) quand une commande client nécessite un réassort fournisseur
  - notification/confirmation du fournisseur (manuel ou WhatsApp) et suivi du statut du bon de commande
  - réception (partielle ou totale) d'un bon de commande, et rattachement au flux logistique
  - réparation/rattrapage des commandes marquées "ordered" sans (ou avec) bon de commande cohérent (outils admin de correction)
  - gestion des fournisseurs et de leur mapping produit (routes/purchasing.js /suppliers/*)
  - administration transverse des bons de commande, historiquement exposée depuis le dashboard (services/purchasing-admin-service.js — retaggé @domain purchasing au Lot O2, écrit orders/product_suppliers/purchase_orders/suppliers)
- _out_ :
  - cycle de vie de la commande cliente elle-même — orders reste seul propriétaire de order-status-machine.js (feature orders, scindée au Lot O1.4)
  - confirmation de paiement client (order-payment-confirmation.js, reste dans orders)
  - mouvement physique du colis une fois reçu (feature logistics, lecture seule sur purchase_orders/product_suppliers)
  - entrée catalogue / import fournisseur en amont (feature catalog — sourcing/catalog-import, hors périmètre purchasing)

**Authority** : backend-core — tout changement du flux d'engagement fournisseur (déclenchement, confirmation, réception) doit être validé par le propriétaire de services/purchasing-trigger-service.js et services/purchasing-receive-service.js

**Invariants** :
- un besoin d'achat déjà couvert par un bon de commande existant ne recrée jamais de doublon (idempotence applicative anti-replay, I-SWEEP-3B)
- purchasing peut consommer et lire la commande cliente, mais ne possède jamais son cycle de vie — toute mutation de orders.status continue de passer exclusivement par order-status-machine.js (feature orders)
- une réception ne peut être appliquée qu'à un bon de commande existant et cohérent

**Owns** : `product_suppliers`, `purchase_orders`, `suppliers`
**Writes (not owner)** : `alerts` (ambiguous), `orders` (ambiguous)

**Exposes** : 2 internal API(s), 10 HTTP interface(s)
  - `repairOrderedWithoutPurchaseOrders` (services/repair-ordered-without-purchase-orders.js) — resolved
  - `triggerPurchasing` (services/purchasing-trigger-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), notifications (BUSINESS_TRANSVERSAL_SERVICE), orders (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 1, ambiguous ownership: 2, ontology gaps: 0

**Architectural debt** (3) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table alerts — écrite par purchasing (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par purchasing (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "notification (notifyLoyaltyEarned-like : notification fournisseur WhatsApp, via services/notification-service.js)" — ne correspond à aucun nom de feature connu

**Implementation** : 15 fichier(s) déclaré(s)
  - routes : 1
  - services : 6
  - tests : 8

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="purchasing"]_

## recommendations

**Kind** : business-feature  ·  **Status** : staging

**Service** : Classer et suggerer des produits boutique selon un moteur de ranking dedie.

**Perimeter** :
- _in_ :
  - moteur de classement boutique
  - endpoint de suggestions
- _out_ :
  - donnees produit source (feature catalog)
  - prix affiche (feature economic-engine)

**Authority** : backend-core — tout changement de formule de classement doit etre valide par le proprietaire de boutique-ranking-engine.js

**Invariants** :
- le ranking ne modifie jamais les donnees produit, lecture seule sur catalog

**Owns** : _aucune_

**Exposes** : 0 internal API(s), 1 HTTP interface(s)

**Consumes** : _aucune_
**Consumed by** : infrastructure (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 3
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** (3) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "auth" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "catalog" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "logistics" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 4 fichier(s) déclaré(s), boutique: 2 fichier(s)
  - routes : 1
  - services : 1
  - tests : 2

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="recommendations"]_

## refunds

**Kind** : business-transversal  ·  **Status** : production

**Service** : Rembourser un client (wallet, cash, panier partage) de facon tracable et sans double remboursement.

**Perimeter** :
- _in_ :
  - service de remboursement transverse et son orchestration
- _out_ :
  - credit wallet lui-meme (feature wallet, consommee ici)
  - reçu de remboursement document (feature documents, consommee ici)

**Authority** : backend-core — tout changement de logique de remboursement doit etre valide par le proprietaire de refund-service.js

**Invariants** :
- un remboursement n'est jamais applique deux fois pour le meme evenement source

**Owns** : `refunds`

**Exposes** : 1 internal API(s), 0 HTTP interface(s)
  - `processRefund(orderOrCartId, reason)`  — documented-signature-no-file

**Consumes** : documents (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (BUSINESS_TRANSVERSAL_SERVICE), shared-cart (BUSINESS_TRANSVERSAL_SERVICE)

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** (2) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "orders" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "shared-cart" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 5 fichier(s) déclaré(s)
  - services : 1
  - tests : 3
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="refunds"]_

## shared-cart

**Kind** : business-feature  ·  **Status** : production

**Service** : Permettre à plusieurs participants de composer et financer un panier commun, de la création à la commande finale.

**Perimeter** :
- _in_ :
  - création, contribution, clôture, annulation du panier partagé
  - estimation et garde financière du panier (financial guard)
  - transitions d'état v4/v4.1 et réparation des réservations stock collectives
- _out_ :
  - paiement carte/PayPal lui-même (feature payments)
  - création de la commande finale (feature orders, consommée en sortie)
  - crédit wallet (feature wallet, consommée en sortie)
  - tests/unit/collective-payment-orchestrator.test.js

**Authority** : backend-core — tout changement de machine d'état v4/v4.1 doit être validé par le propriétaire de shared-cart-engine.js

**Invariants** :
- snapshot figé après 1ère contribution payée
- idempotence webhook Stripe sur shared_cart_contributions
- fenêtre paiement 48h — aucune extension sans machine de statut
- annulation restores wallet si contribution confirmée
- lien partagé ouvre une boutique — jamais un guichet (Boutique First)
- participant consulte en lecture seule — règle sa part seulement si panier payable

**Owns** : `basket_items`, `baskets`, `cart_contributions`, `cart_shares`, `collective_payment_sessions`, `collective_payment_tokens`, `collective_stock_reservations`, `collective_workspace_contributions`, `collective_workspace_events`, `collective_workspace_items`, `collective_workspaces`, `order_items`, `recipients`, `shared_cart_contributions`, `shared_cart_estimations`, `shared_cart_events`, `shared_cart_items`, `shared_carts`, `stripe_events_processed`
**Writes (not owner)** : `alerts` (ambiguous), `orders` (ambiguous)

**Exposes** : 0 internal API(s), 33 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (BUSINESS_TRANSVERSAL_SERVICE), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), refunds (BUSINESS_TRANSVERSAL_SERVICE)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 2, ambiguous ownership: 2, ontology gaps: 0

**Architectural debt** (5) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table alerts — écrite par shared-cart (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par shared-cart (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "notification" — ne correspond à aucun nom de feature connu
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "products" — ne correspond à aucun nom de feature connu
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 106 fichier(s) déclaré(s), boutique: 8 fichier(s)
  - boutique : 14
  - dash : 2
  - migrations : 14
  - routes : 8
  - services : 27
  - tests : 41

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="shared-cart"]_

## sourcing

**Kind** : business-feature  ·  **Status** : production

**Service** : Identifier, qualifier et arbitrer des opportunités fournisseur ou produit (scan pricing, décision garder/watchlist/rejeter) avant leur entrée dans le catalogue.

**Perimeter** :
- _in_ :
  - ingestion catalogue fournisseur brut (dispatch CSV / saisie manuelle / API)
  - scan de candidat (pricing-engine) et décision garder / watchlist / rejeter
  - cycle de vie du candidat : raw_imported → normalized → scanned → imported_to_catalog / rejected / watchlist
  - transformation candidat → produit (déclenchement, pas la fiche catalogue elle-même)
  - journal d'événements candidat (audit, correction manuelle, scan, décision)
- _out_ :
  - connecteurs fournisseur eux-mêmes et normalisation NormalizedSupplierProduct (feature catalog, services/suppliers/connectors/* + services/supplier-catalog-scanner.js restent dans catalog — leur service principal reste l'entrée catalogue, pas la qualification)
  - orchestration d'import idempotent supplier_catalog_imports (feature catalog, services/suppliers/catalog-import-orchestrator.js)
  - enrichissement FR de la fiche produit après import (feature catalog, catalog-enrichment)
  - fiche produit elle-même une fois créée (feature catalog)
  - moteur margin/rail admin economic-engine (routes/sourcing.js, services/sourcing-analysis.js, services/sourcing-mutations.js) — HOMONYME sans rapport : voir note ci-dessous
  - calcul de prix (feature economic-engine, pricing-engine, consommé ici en lecture)

**Authority** : backend-core — tout changement du cycle de vie candidat (states, transitions) doit être validé par le propriétaire de routes/sourcing-scanner.js

**Invariants** :
- un candidat exclu (rejet manuel ou auto-exclusion douane/légale) n'est jamais ré-importable (ING-5 verrou 1)
- une devise hors whitelist (AED, EUR, USD, KMF) ne produit jamais de purchase_price_kmf faux (ING-5 verrou 2)
- un candidat déjà importé (état imported_to_catalog + product_id) ne peut pas être ré-importé
- le payload fournisseur brut est conservé intégralement (raw_payload) pour rejouabilité

**Owns** : _aucune_
**Writes (not owner)** : `catalog_media` (ambiguous), `product_sku_media` (ambiguous), `product_skus` (ambiguous), `product_variants` (ambiguous), `products` (ambiguous), `sourcing_candidate_events` (ambiguous), `sourcing_candidates` (ambiguous)

**Exposes** : 0 internal API(s), 11 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 7, ontology gaps: 0

**Architectural debt** (7) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table catalog_media — écrite par sourcing (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table product_sku_media — écrite par sourcing (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table product_skus — écrite par sourcing (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table product_variants — écrite par sourcing (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table products — écrite par sourcing (W), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table sourcing_candidate_events — écrite par sourcing (RW), aucun lifecycle owner résolu (multi-writer non classifié)
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table sourcing_candidates — écrite par sourcing (RW), aucun lifecycle owner résolu (multi-writer non classifié)

**Implementation** : 6 fichier(s) déclaré(s)
  - migrations : 4
  - routes : 1
  - tests : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="sourcing"]_

## unsold-resolution

**Kind** : business-feature  ·  **Status** : production

**Service** : Arbitrer et liquider la valeur immobilisée d'une commande invendue (WhatsApp, revendeur, don, destruction).

**Perimeter** :
- _in_ :
  - détection des commandes disponibles depuis 14 jours sans retrait (auto_unsold() sur orders)
  - arbitrage et résolution d'un invendu : vente WhatsApp, vente revendeur, don, destruction
  - calcul du prix de liquidation depuis le prix original (politique actuelle : 75% par défaut, ajustable via PATCH avant résolution)
- _out_ :
  - réception, affectation et dispatch des articles au hub (feature inventory — aucun point de contact technique : pas de table écrite en commun, pas de require croisé)
  - décision de publication produit (feature catalog)

**Authority** : backend-core — tout changement de calcul de liquidation doit etre valide par le proprietaire de routes/unsold.js

**Invariants** :
- un invendu résolu ne revient jamais en available
- toute résolution possède un statut terminal autorisé et un horodatage resolved_at

**Owns** : `unsold_items`

**Exposes** : 0 internal API(s), 7 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 1 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** (2) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "catalog" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "orders" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 3 fichier(s) déclaré(s)
  - dash : 1
  - routes : 1
  - tests : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="unsold-resolution"]_

## wallet

**Kind** : business-feature  ·  **Status** : production

**Service** : Tenir un solde client et son historique de credit/debit, avec application exactement une fois.

**Perimeter** :
- _in_ :
  - solde wallet et historique de credit/debit
  - application/retrait du wallet sur une commande (orders.wallet_applied_kmf)
- _out_ :
  - paiement carte/PayPal (feature payments)
  - remboursement initiateur (feature refunds, qui credite le wallet)
  - programme de fidelite et ses recompenses (feature loyalty, scindee de wallet-loyalty au Lot O1)
  - emission du recu wallet (services/documents/wallet-receipt.js, @domain documents — consommateur en aval, pas ownership wallet)

**Authority** : backend-core — tout changement de calcul de solde doit etre valide par le proprietaire de wallet-service.js

**Invariants** :
- application wallet une seule fois par evenement source
- solde jamais negatif sans flag explicite admin

**Owns** : `wallet_consumptions`, `wallet_credit_lots`, `wallet_transactions`, `wallets`
**Writes (not owner)** : `orders` (ambiguous)

**Exposes** : 0 internal API(s), 9 HTTP interface(s)

**Consumes** : auth-identity (DECLARED_AND_OBSERVED), documents (BUSINESS_TRANSVERSAL_SERVICE), payments (DECLARED_AND_OBSERVED)
**Consumed by** : infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 2 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 1, ontology gaps: 0

**Architectural debt** (1) :
- `AMBIGUOUS_TABLE_OWNERSHIP` (medium) — table orders — écrite par wallet (RW), aucun lifecycle owner résolu (multi-writer non classifié)

**Implementation** : 10 fichier(s) déclaré(s), boutique: 2 fichier(s)
  - boutique : 2
  - migrations : 2
  - routes : 1
  - services : 2
  - tests : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="wallet"]_

## wallet-loyalty

**Kind** : deprecated  ·  **Status** : deprecated

**Service** : DÉPRÉCIÉ — scindé au Lot O1.2 (2026-07-12) en features/wallet.feature.js et features/loyalty.feature.js. Ne rend plus aucun service propre.

**Perimeter** :
- _out_ :
  - tout — voir features/wallet.feature.js et features/loyalty.feature.js

**Authority** : backend-core — manifest déprécié, aucune autorité propre ; voir wallet.feature.js et loyalty.feature.js

**Owns** : _aucune_

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : _aucune_
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0

**Architectural debt** : _aucune_

**Implementation** : 0 fichier(s) déclaré(s)

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="wallet-loyalty"]_
