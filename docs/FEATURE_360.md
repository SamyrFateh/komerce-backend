# FEATURE 360

_Projection déterministe de lecture au-dessus de la chaîne Feature First O2-O7.3 déjà gouvernée. Feature 360 ne crée aucune nouvelle vérité architecturale ; toute correction se fait dans la source autoritaire existante._

## Global scorecard

- Features : **30**
- Healthy : **15**
- Attention : **15**
- Blocked : **0**
- Business dependencies : **174**
- Direct cross-feature imports : **1**
- Runtime cycles : **0**
- Ambiguous ownership signals : **0**
- Ontology gaps : **0**
- Debt items (total) : **43**
- Gate health — healthy : **17** · blocked : **0**

## Gate findings — intégrité de projection

- Source : `docs/GATE_FINDINGS.json` (version GF-2.1)
- Sources de gates : **18** (0 en échec)
- Findings : **20** total, **20** attribué(s), **0** sans attribution exploitable
- Fichiers non projetables : **0**
- Fichiers multi-projetés : **0**

## Features

| Feature | Kind | Boundary | Governance | Owns | Consumes | Consumed by | Debt |
|---|---|---|---|---|---|---|---|
| admin-dashboard | projection | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | catalog, customs, dashboard, decision-signals, documents, economic-engine, inventory, logistics, orders, payments, sourcing | _aucune_ | 0 |
| auth | technical-transversal | 🟡 ATTENTION | 🟡 ATTENTION | _aucune_ | auth-identity, infrastructure, notifications | auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, infrastructure, inventory, logistics, loyalty, notifications, orders, payments, platform-ops, purchasing, shared-cart, sourcing, unsold-resolution, wallet | 3 |
| auth-identity | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | otp_codes, revoked_tokens, user_pickup_authorizations, users | auth, auth-passkey, documents, infrastructure, notifications, platform-ops, wallet | auth, auth-passkey, catalog, logistics, orders, platform-ops, shared-cart, wallet | 0 |
| auth-passkey | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | webauthn_challenges, webauthn_credentials | auth, auth-identity, infrastructure, platform-ops | auth-identity | 0 |
| business-rules | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | business_rules, business_rules_history | auth, infrastructure | catalog, dashboard, decision-signals, logistics, orders, payments, platform-ops | 0 |
| catalog | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | boutique_categories, boutique_subcategories, catalog_enrichment_runs, catalog_field_overrides, catalog_media, product_attributes, product_content_profile, product_content_sections, product_sku_media, product_skus, product_variants, products, supplier_catalog_imports | auth, auth-identity, business-rules, economic-engine, infrastructure, logistics, platform-ops, shared-cart, sourcing | admin-dashboard, economic-engine, infrastructure, logistics, orders, platform-ops, recommendations, shared-cart, sourcing | 1 |
| customs | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | customs_categories, customs_shipment_parcels, customs_shipments | auth, documents, economic-engine, infrastructure, logistics | admin-dashboard, dashboard, infrastructure, orders | 0 |
| dashboard | business-transversal | 🟡 ATTENTION | 🟢 HEALTHY | order_incidents, partners | auth, business-rules, customs, decision-signals, documents, economic-engine, incident-management, infrastructure, logistics, orders, purchasing | admin-dashboard, economic-engine, infrastructure | 4 |
| decision-signals | piloting-capability | 🟢 HEALTHY | 🟢 HEALTHY | signals | auth, business-rules, infrastructure, logistics | admin-dashboard, dashboard | 0 |
| documents | business-transversal | 🟡 ATTENTION | 🟢 HEALTHY | invoices, transaction_documents | auth, infrastructure | admin-dashboard, auth-identity, customs, dashboard, orders, payments, refunds, wallet | 5 |
| economic-engine | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | charges, competitor_prices, cost_benchmarks, cost_component_events, cost_components, economic_snapshots, economic_variables, exchange_rates, finance_config, order_item_real_cost_allocations, price_history, pricing_category_dims, pricing_category_taxes, pricing_components, pricing_matrices_audit, pricing_strategies, pricing_strategy_history, risk_provisions | auth, catalog, dashboard, infrastructure, logistics, loyalty, orders | admin-dashboard, catalog, customs, dashboard, infrastructure, orders, platform-ops, sourcing | 1 |
| incident-management | business-transversal | 🟡 ATTENTION | 🟡 ATTENTION | incidents | infrastructure | dashboard, logistics, notifications, payments, platform-ops | 5 |
| infrastructure | technical-foundation | 🟢 HEALTHY | 🟡 ATTENTION | schema_migrations | auth, catalog, customs, dashboard, economic-engine, inventory, logistics, notifications, orders, payments, platform-ops, recommendations, shared-cart, wallet | auth, auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, inventory, logistics, loyalty, notifications, orders, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, sourcing, unsold-resolution, wallet | 11 |
| inventory | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | inventory_items | auth, infrastructure, logistics | admin-dashboard, infrastructure | 1 |
| legacy-control-tower | deprecated | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| logistics | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | carriers, parcel_events, parcel_items, parcels, pickup_print_tokens, pickup_reveal_codes, pickup_verify_attempts, relais, scan_events, scans, shipments | auth, auth-identity, business-rules, catalog, incident-management, infrastructure, loyalty, notifications, orders, payments, purchasing, refunds | admin-dashboard, catalog, customs, dashboard, decision-signals, economic-engine, infrastructure, inventory, orders, payments, platform-ops, purchasing | 3 |
| loyalty | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | loyalty_rewards, loyalty_tiers | auth, infrastructure, notifications | economic-engine, logistics, orders, payments | 2 |
| notifications | business-transversal | 🟢 HEALTHY | 🟡 ATTENTION | alerts, client_notifications, notification_log | auth, incident-management, infrastructure, platform-ops | auth, auth-identity, infrastructure, logistics, loyalty, orders, payments, purchasing, shared-cart | 1 |
| orders | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | customs_history, disputes, order_comments, order_item_cost_imputations, order_items, order_status_history, orders, recipients, sms_log | auth, auth-identity, business-rules, catalog, customs, documents, economic-engine, infrastructure, logistics, loyalty, notifications, payments, platform-ops, purchasing, refunds, shared-cart, wallet | admin-dashboard, dashboard, economic-engine, infrastructure, logistics, payments, platform-ops, purchasing, recommendations, refunds, shared-cart | 1 |
| payments | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | cash_collections, cash_deposits, paypal_events_processed, stripe_events_processed | auth, business-rules, documents, incident-management, infrastructure, logistics, loyalty, notifications, orders, platform-ops, purchasing, refunds | admin-dashboard, infrastructure, logistics, orders, wallet | 0 |
| platform | frontend-transversal | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| platform-ops | technical-transversal | 🟢 HEALTHY | 🟢 HEALTHY | fabrics, garment_models, store_credits | auth, auth-identity, business-rules, catalog, economic-engine, incident-management, infrastructure, logistics, orders, purchasing | auth-identity, auth-passkey, catalog, infrastructure, notifications, orders, payments, recommendations, shared-cart, wallet | 0 |
| purchasing | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | product_suppliers, purchase_orders, suppliers | auth, infrastructure, logistics, notifications, orders | dashboard, logistics, orders, payments, platform-ops | 0 |
| recommendations | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | _aucune_ | catalog, infrastructure, orders, platform-ops | infrastructure, shared-cart | 2 |
| refunds | business-transversal | 🟡 ATTENTION | 🟢 HEALTHY | refunds | documents, infrastructure, orders, wallet | logistics, orders, payments | 1 |
| shared-cart | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | basket_items, baskets, cart_shares, shared_cart_events, shared_cart_items, shared_cart_saved_access, shared_carts | auth, auth-identity, catalog, infrastructure, notifications, orders, platform-ops, recommendations | catalog, infrastructure, orders | 0 |
| sourcing | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | sourcing_candidate_events, sourcing_candidates | auth, catalog, economic-engine, infrastructure | admin-dashboard, catalog | 0 |
| unsold-resolution | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | unsold_items | auth, infrastructure | _aucune_ | 2 |
| wallet | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | wallet_consumptions, wallet_credit_lots, wallet_transactions, wallets | auth, auth-identity, documents, infrastructure, payments, platform-ops | auth-identity, infrastructure, orders, refunds | 0 |
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

**Consumes** : catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 41 fichier(s) déclaré(s)
  - js : 41

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="admin-dashboard"]_

## auth

**Kind** : technical-transversal  ·  **Status** : production

**Service** : Fournir les gardes transverses d'authentification et de vérification d'identité (middlewares JWT/session/rôles) consommées par toutes les autres features.

**Perimeter** :
- _in_ :
  - middlewares de garde transverses : authentification JWT/session, vérification de rôle, identité vérifiée, révocation de token, émission et durée canonique de session
- _out_ :
  - logique metier propre a chaque feature consommatrice — auth ne sait rien des commandes, paniers ou paiements

**Authority** : backend-core — tout changement de middleware d'authentification ou de politique de session doit etre valide par le proprietaire de auth

**Invariants** :
- toute route mutante passe par un middleware d'auth declare — jamais d'acces direct sans garde
- toute mutation portée par le cookie de session exige une Origin explicitement autorisée (AUTH-8b)
- staging/production utilisent exclusivement un cookie de session __Host- Secure, Path=/ et sans Domain (AUTH-8c)
- la durée absolue JWT + cookie est plafonnée à 7 jours et chaque preuve OTP/passkey/step-up émet une nouvelle jti (AUTH-8d)
- un JWT scoped ou dépourvu des claims de session canoniques ne peut jamais être élevé en session par les middlewares génériques (AUTH-8e)

**Owns** : _aucune_
**Writes (not owner)** : `users` (writer-not-owner)

**Exposes** : 2 internal API(s), 0 HTTP interface(s)
  - `requireAuth / requireVerifiedIdentity / softAuth` (middleware/auth.js, middleware/require-verified-identity.js, middleware/soft-auth.js) — undeclared-in-graph
  - `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` (utils/auth-session.js, utils/auth-session-policy.js, utils/auth-token-policy.js) — undeclared-in-graph

**Consumes** : auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 2, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (3) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "orders" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `UNRESOLVED_INTERNAL_API` (medium) — requireAuth / requireVerifiedIdentity / softAuth (middleware/auth.js, middleware/require-verified-identity.js, middleware/soft-auth.js) — statut: undeclared-in-graph
- `UNRESOLVED_INTERNAL_API` (medium) — signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict (utils/auth-session.js, utils/auth-session-policy.js, utils/auth-token-policy.js) — statut: undeclared-in-graph

**Implementation** : 26 fichier(s) déclaré(s)
  - middleware : 7
  - migrations : 2
  - tests : 13
  - utils : 4

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="auth"]_

## auth-identity

**Kind** : business-feature  ·  **Status** : production

**Service** : Authentifier un utilisateur et gérer son identité active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposées.

**Perimeter** :
- _in_ :
  - routes actives d'identité : OTP (request/verify/test-reset), login/register, magic-link, guest-checkout, admin-reset, consultation/édition du profil et des commandes client
- _out_ :
  - logique metier propre a chaque feature consommatrice — auth-identity ne sait rien des commandes, paniers ou paiements

**Authority** : backend-core — tout changement de middleware d'authentification doit etre valide par le proprietaire de middleware/auth.js

**Invariants** :
- [object Object]
- les routes de ce manifeste s'appuient sur authenticate (middleware/auth.js, feature auth) — pas de garde ad-hoc
- la projection boutique de l identité protège le focus du dialogue et associe chaque erreur de validation au champ concerné
- une seule autorisation nominative active par utilisateur, consultée au moment exact de la remise — jamais figée par commande
- le nom autorisé n'est jamais exposé au relais : logistics ne reçoit que des champs normalisés via getActiveAuthorizationForUpdate, jamais authorized_given_names/authorized_family_name en clair

**Owns** : `otp_codes`, `revoked_tokens`, `user_pickup_authorizations`, `users`

**Exposes** : 3 internal API(s), 22 HTTP interface(s)
  - `getActiveAuthorizationForUpdate` (services/pickup-authorization-service.js) — resolved
  - `hasActiveAuthorization` (services/pickup-authorization-service.js) — resolved
  - `makeIntlPhoneInput` (public/boutique/js/b-phone.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 1 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 2
  - [gate:feature-classification-check] 🟠 CLASSIFICATION-MISSING — champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)
  - [gate:feature-classification-check] 🟠 RATIONALE-SHORT — rationale absent ou < 2 entrées (1) — documenter au moins 2 raisons objectives

**Architectural debt** : _aucune_

**Implementation** : 16 fichier(s) déclaré(s), boutique: 5 fichier(s)
  - boutique : 3
  - migrations : 1
  - routes : 3
  - services : 2
  - tests : 6
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="auth-identity"]_

## auth-passkey

**Kind** : business-feature  ·  **Status** : production

**Service** : Gérer le cycle de vie Passkey Komerce : enrôlement, login nominal, métadonnées sûres et révocation explicite des authentificateurs du compte (AUTH-2→7).

**Perimeter** :
- _in_ :
  - génération des options WebAuthn (register/login), vérification cryptographique via @simplewebauthn/server, stockage/rotation des credentials et des challenges éphémères
- _out_ :
  - durcissement final de session/cookie/CSRF (AUTH-8b→e)
  - toute logique OTP/magic-link/guest-checkout — reste dans auth-identity

**Authority** : backend-core — toute vérification WebAuthn passe exclusivement par @simplewebauthn/server ; aucune ré-implémentation crypto/CBOR locale.

**Invariants** :
- un challenge register/login est à usage unique — sa consommation est atomique (UPDATE ... WHERE consumed_at IS NULL RETURNING) et couvre rejeu + expiration
- un challenge émis pour un user ne peut jamais être consommé au bénéfice d'un autre user
- expectedOrigin et expectedRPID viennent exclusivement de la config serveur, jamais du client
- une réponse register ne peut pas être vérifiée comme login, et inversement (ceremony_type strict)
- requireUserVerification est vérifié par la lib, pas seulement demandé à l'authenticator
- credential_id est unique (contrainte DB + vérification applicative avant insert)
- une credential revoked_at non nul est inutilisable au login, sans exception
- la gestion AUTH-6 ne retourne jamais credential_id, public_key ni sign_count au navigateur
- une révocation est toujours scellée par id de gestion ET user_id authentifié
- un challenge step_up est distinct de login/register et lié au user_id de la session
- une passkey d un autre compte ne peut jamais satisfaire un step-up
- les mutations de sécurité exigent auth_time récent avec amr otp ou passkey
- sign_count : régression rejetée pour les credentials non sauvegardées (backup_state=false) ; tolérée et tracée pour les passkeys synchronisées (backup_state=true)

**Owns** : `webauthn_challenges`, `webauthn_credentials`

**Exposes** : 0 internal API(s), 8 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 RATIONALE-SHORT — rationale absent ou < 2 entrées (1) — documenter au moins 2 raisons objectives

**Architectural debt** : _aucune_

**Implementation** : 12 fichier(s) déclaré(s), boutique: 10 fichier(s)
  - migrations : 2
  - routes : 1
  - services : 3
  - tests : 6

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="auth-passkey"]_

## business-rules

**Kind** : business-transversal  ·  **Status** : production

**Service** : Detenir le referentiel des regles metier parametrables, versionner chaque changement, et servir a toute feature la valeur en vigueur avec un repli garanti sur la valeur codee en dur.

**Perimeter** :
- _in_ :
  - lecture d'une regle en vigueur avec valeur de repli (getRule)
  - mutation d'une regle et historisation du changement (business_rules_history)
  - restitution admin du referentiel et de son historique
  - cache memoire TTL 60s et son invalidation
- _out_ :
  - la decision prise a partir de la regle : elle appartient a la feature qui lit (orders decide d'annuler, catalog decide de publier) — business-rules ne tranche jamais a leur place
  - les parametres economiques (marges, taux, composants de cout) : feature economic-engine, referentiel distinct
  - la configuration technique d'execution (variables d'environnement, feature flags de deploiement) : feature infrastructure

**Authority** : backend-core — toute regle nouvelle doit porter une valeur de repli codee en dur egale au comportement actuel : l'ajout d'une regle ne change jamais le comportement tant que la base est vide.

**Invariants** :
- une regle absente ou une base injoignable retourne la valeur de repli, jamais une erreur
- toute mutation de regle ecrit une ligne d'historique dans la meme transaction
- aucune feature ne lit business_rules directement : le seul chemin est getRule()

**Owns** : `business_rules`, `business_rules_history`

**Exposes** : 4 internal API(s), 5 HTTP interface(s)
  - `getAllRules` (utils/rules.js) — resolved
  - `getRule` (utils/rules.js) — resolved
  - `getRuleNumber` (utils/rules.js) — resolved
  - `setRule` (utils/rules.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 4 fichier(s) déclaré(s)
  - routes : 1
  - tests : 2
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="business-rules"]_

## catalog

**Kind** : business-feature  ·  **Status** : production

**Service** : Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.

**Perimeter** :
- _in_ :
  - connecteurs fournisseurs (CSV, API, manuel, Noon)
  - contrat source fournisseur versionne V1/V2 : brut integral + preservation explicite media, axes et unites vendables quand la source les connait
  - publication produit et déclenchement de l audit prix via economic-engine
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
- le prompt d enrichissement est du code : versionne dans le depot, chaque run trace, un echec IA ne bloque jamais un import
- la modal produit affiche le catalogue vivant et ne doit pas servir de fiche snapshot panier partage
- le parcours mobile Voir en grand appartient a b-modal-image-ux.js et modal-media.css
- aucune fiche candidate issue du pipeline ne passe lifecycle_status=active sans etre passee par la file d approbation, meme si needs_review est faux

**Owns** : `boutique_categories`, `boutique_subcategories`, `catalog_enrichment_runs`, `catalog_field_overrides`, `catalog_media`, `product_attributes`, `product_content_profile`, `product_content_sections`, `product_sku_media`, `product_skus`, `product_variants`, `products`, `supplier_catalog_imports`
**Writes (not owner)** : `alerts` (writer-not-owner)

**Exposes** : 6 internal API(s), 31 HTTP interface(s)
  - `applyPrice` (services/catalog-product-mutation-service.js) — resolved
  - `bulkAssignSourcingRail` (services/catalog-product-mutation-service.js) — resolved
  - `createDraftFromSourcingCandidate` (services/product-admin-service.js) — resolved
  - `createDraftProductFromSourcingCandidate` (services/catalog-candidate-product-service.js) — resolved
  - `replaceVariantsForSourcing` (services/catalog-product-mutation-service.js) — resolved
  - `updateSourcingFields` (services/catalog-product-mutation-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 1, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 RATIONALE-SHORT — rationale absent ou < 2 entrées (1) — documenter au moins 2 raisons objectives

**Architectural debt** (1) :
- `DIRECT_CROSS_FEATURE_IMPORT` (high) — 1 paire(s) classées CROSS_FEATURE_DIRECT_IMPORT

**Implementation** : 140 fichier(s) déclaré(s), boutique: 32 fichier(s)
  - boutique : 38
  - ci : 3
  - config : 1
  - dash : 4
  - docs : 4
  - migrations : 11
  - routes : 5
  - schemas : 4
  - services : 28
  - tests : 41
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
**Writes (not owner)** : `orders` (writer-not-owner)

**Exposes** : 0 internal API(s), 20 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 CLASSIFICATION-MISSING — champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)

**Architectural debt** : _aucune_

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
**Writes (not owner)** : `basket_items` (writer-not-owner), `baskets` (writer-not-owner), `invoices` (writer-not-owner), `loyalty_rewards` (writer-not-owner), `order_comments` (writer-not-owner), `order_items` (writer-not-owner), `order_status_history` (writer-not-owner), `orders` (writer-not-owner), `products` (writer-not-owner), `recipients` (writer-not-owner), `relais` (writer-not-owner), `scan_events` (writer-not-owner), `sms_log` (writer-not-owner), `users` (writer-not-owner), `wallet_transactions` (writer-not-owner), `wallets` (writer-not-owner)

**Exposes** : 0 internal API(s), 65 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 4
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (4) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "inventory" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "payments" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "recommendations" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 141 fichier(s) déclaré(s)
  - dash : 83
  - migrations : 1
  - routes : 16
  - services : 10
  - tests : 31

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

**Consumes** : auth (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 6 fichier(s) déclaré(s)
  - routes : 1
  - services : 2
  - tests : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="decision-signals"]_

## documents

**Kind** : business-transversal  ·  **Status** : production

**Service** : Generer et conserver un PDF officiel privé (facture, remboursement, wallet, retrait, douane) après événement confirmé ; exposer au client authentifié uniquement ses factures et remboursements essentiels.

**Perimeter** :
- _in_ :
  - generation PDF privée de facture, preuve de retrait, facture douane, reçu wallet et reçu remboursement
  - liste et téléchargement client authentifiés des factures et remboursements dans Mon Komerce et la commande concernée
- _out_ :
  - decision qu'un document doit etre genere (reste a la feature source : orders, customs, wallet, refunds)

**Authority** : backend-core — tout changement de gabarit de document doit etre valide par le proprietaire de document-service.js

**Invariants** :
- un document genere est immuable une fois emis — toute correction passe par une nouvelle generation versionnee
- aucun document ni lien documentaire n'est envoyé par WhatsApp
- tout téléchargement client exige une session et filtre par owner_user_id
- la projection client ne liste que les factures et reçus de remboursement ; les autres documents restent internes ou administratifs
- une URL de téléchargement client n'est exposée que lorsque le PDF existe et est disponible
- le PDF disponible possède une empreinte SHA-256 et ne peut pas être remplacé
- le PDF de facture est dérivé du HTML canonique qui embarque le vrai logo Komerce et porte une template_version dédiée

**Owns** : `invoices`, `transaction_documents`

**Exposes** : 0 internal API(s), 9 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 5
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (5) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "auth-identity" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "customs" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "orders" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "refunds" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 35 fichier(s) déclaré(s)
  - migrations : 6
  - routes : 3
  - services : 7
  - tests : 14
  - utils : 5

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="documents"]_

## economic-engine

**Kind** : business-feature  ·  **Status** : production

**Service** : Calculer le prix, le cout et la marge d'un produit ou d'une commande selon une strategie tarifaire versionnee.

**Perimeter** :
- _in_ :
  - moteur de pricing et application des regles
  - audit des changements de prix produit dans price_history
  - allocation de cout
  - strategies tarifaires et matrices admin
  - gestion des provisions pour risque (routes/admin-risk-provisions.js — retaggé @domain economic-engine au Lot O2, était @domain dashboard)
- _out_ :
  - affichage produit cote catalogue (feature catalog, qui consomme economic-engine)
  - facturation finale (feature orders)

**Authority** : backend-core — tout changement de formule de prix ou d audit price_history doit rester derrière les services propriétaires economic-engine

**Invariants** :
- une strategie tarifaire est versionnee, jamais modifiee retroactivement sur une commande deja figee
- aucun consommateur cross-feature ne modifie price_history directement ; l audit passe par economic-price-audit-service.js

**Owns** : `charges`, `competitor_prices`, `cost_benchmarks`, `cost_component_events`, `cost_components`, `economic_snapshots`, `economic_variables`, `exchange_rates`, `finance_config`, `order_item_real_cost_allocations`, `price_history`, `pricing_category_dims`, `pricing_category_taxes`, `pricing_components`, `pricing_matrices_audit`, `pricing_strategies`, `pricing_strategy_history`, `risk_provisions`

**Exposes** : 2 internal API(s), 73 HTTP interface(s)
  - `recommend` (services/pricing-engine.js) — resolved
  - `recordProductPriceChange` (services/economic-price-audit-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 CLASSIFICATION-MISSING — champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)

**Architectural debt** (1) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 111 fichier(s) déclaré(s)
  - dash : 6
  - migrations : 18
  - routes : 12
  - services : 26
  - tests : 47
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

**Owns** : `incidents`

**Exposes** : 12 internal API(s), 0 HTTP interface(s)
  - `acknowledgeAlertEngineIncident` (services/incident-write-service.js) — resolved
  - `createAlertEngineIncidentIfNew` (services/incident-write-service.js) — resolved
  - `createReconciliationIncident` (services/incident-write-service.js) — resolved
  - `createScanIncident` (services/incident-write-service.js) — resolved
  - `detachUserFromIncidents` (services/incident-write-service.js) — resolved
  - `escalateIncident` (services/incident-service.js) — resolved
  - `getIncident` (services/incident-service.js) — resolved
  - `getIncidentDashboard` (services/incident-service.js) — resolved
  - `listIncidents` (services/incident-service.js) — resolved
  - `resolveIncident` (services/incident-service.js) — resolved
  - _...2 de plus, voir FEATURE_360.json_

**Consumes** : infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 4
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 1, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (5) :
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "dashboard / ops-api legacy (écrit incidents — SQL inline)" — ne correspond à aucun nom de feature connu
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "dashboard" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "logistics" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "notifications" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "payments" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 4 fichier(s) déclaré(s)
  - services : 2
  - tests : 2

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="incident-management"]_

## infrastructure

**Kind** : technical-foundation  ·  **Status** : production

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

**Owns** : `schema_migrations`
**Writes (not owner)** : `economic_snapshots` (writer-not-owner), `pickup_print_tokens` (writer-not-owner), `pickup_reveal_codes` (writer-not-owner), `revoked_tokens` (writer-not-owner)

**Exposes** : 11 internal API(s), 4 HTTP interface(s)
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
  - _...1 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 9 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 11, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (11) :
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
- `UNRESOLVED_INTERNAL_API` (medium) — validators/index.js — barrel des schémas Joi (null) — statut: undeclared-in-graph

**Implementation** : 279 fichier(s) déclaré(s)
  - assets : 37
  - bootstrap : 9
  - ci : 23
  - config : 12
  - db : 16
  - docs : 60
  - middleware : 5
  - migrations : 6
  - routes : 1
  - scripts : 87
  - tests : 17
  - utils : 5
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
- [object Object]

**Owns** : `inventory_items`
**Writes (not owner)** : `orders` (writer-not-owner)

**Exposes** : 0 internal API(s), 8 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 2 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 CLASSIFICATION-MISSING — champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)

**Architectural debt** (1) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "catalog" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 7 fichier(s) déclaré(s)
  - dash : 1
  - routes : 1
  - services : 1
  - tests : 4

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
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

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
- le retrait exceptionnel par autorisation nominative ne revele jamais le nom attendu a l'agent relais — comparaison aveugle uniquement
- le compteur de tentatives du retrait exceptionnel (exceptional_pickup_attempts) est distinct de celui du code secret (pickup_secret_attempts) — un echec sur l'un ne bloque jamais l'autre

**Owns** : `carriers`, `parcel_events`, `parcel_items`, `parcels`, `pickup_print_tokens`, `pickup_reveal_codes`, `pickup_verify_attempts`, `relais`, `scan_events`, `scans`, `shipments`
**Writes (not owner)** : `alerts` (writer-not-owner), `orders` (writer-not-owner)

**Exposes** : 15 internal API(s), 70 HTTP interface(s)
  - `addParcelItem` (services/parcel-item-mutation-service.js) — resolved
  - `appendParcelShipmentInfo` (services/parcel-mutation-service.js) — resolved
  - `assignParcelItem` (services/parcel-item-mutation-service.js) — resolved
  - `assignSingleOrderItemToParcel` (services/parcel-item-mutation-service.js) — resolved
  - `assignWholeOrderItemToParcel` (services/parcel-item-mutation-service.js) — resolved
  - `createAutoPreparedParcel` (services/parcel-mutation-service.js) — resolved
  - `createHubParcel` (services/parcel-mutation-service.js) — resolved
  - `detachUserFromScans` (services/scan-write-service.js) — resolved
  - `markBackorderReminderSent` (services/parcel-mutation-service.js) — resolved
  - `markCustomsCleared` (services/parcel-mutation-service.js) — resolved
  - _...5 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 3
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 CLASSIFICATION-MISSING — champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)

**Architectural debt** (3) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "customs" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "economic-engine" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "wallet" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 83 fichier(s) déclaré(s)
  - boutique : 1
  - dash : 2
  - docs : 4
  - middleware : 1
  - migrations : 2
  - routes : 18
  - services : 16
  - tests : 36
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

**Owns** : `loyalty_rewards`, `loyalty_tiers`
**Writes (not owner)** : `users` (writer-not-owner)

**Exposes** : 0 internal API(s), 7 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED)
**Consumed by** : economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

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

**Service** : Projeter une information essentielle dans l application avec acquittement propriétaire ; conserver les canaux sortants historiques séparés et best-effort.

**Perimeter** :
- _in_ :
  - envoi WhatsApp via Meta
  - moteur d'alertes internes
  - routes d'emission de notification
  - cycle in-app client open -> acknowledged | resolved
  - réconciliation des trois jalons préparation, expédition et disponibilité
  - contrat explicite order.exception.* pour les événements exceptionnels actionnables
- _out_ :
  - tests/unit/notification-service.test.js
  - décision métier de notifier (reste à la feature émettrice)

**Authority** : backend-core — tout changement de template ou de canal doit etre valide par le proprietaire de notification-service.js

**Invariants** :
- notifications est un puits d'evenements — elle ne decide jamais elle-meme qu'un evenement metier a eu lieu
- livraison outbound best-effort — l'echec d'envoi WhatsApp ne doit jamais bloquer la transaction emettrice (fire-and-forget)
- une notification client est idempotente et accessible uniquement à son propriétaire authentifié
- acquitter une notification ne modifie jamais l état métier de la commande
- seuls les événements essentiels et actionnables entrent dans le flux client
- la lecture réconcilie une émission manquée depuis la vérité métier sans créer de doublon
- un jalon plus récent résout le jalon précédent de la même commande sans créer un message pour in_transit
- une exception exige une clé order.exception.* et un déclencheur métier confirmé

**Owns** : `alerts`, `client_notifications`, `notification_log`

**Exposes** : 7 internal API(s), 6 HTTP interface(s)
  - `emitOrderMilestone / emitExceptional / resolveOrderMilestones` (services/client-notification-service.js) — resolved
  - `notifyLoyaltyEarned` (services/notifications/loyalty.js) — resolved
  - `notifyOrder*` (services/notifications/order.js) — resolved
  - `notifyParcel*` (services/notifications/parcel.js) — resolved
  - `notifyText` (services/notifications/misc.js) — resolved
  - `sendOtpMessage / sendMagicLink` (services/notifications/otp-auth.js) — resolved
  - `setNotificationOutcomeListener` (services/notifications/internals.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟡 ATTENTION — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 1, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (1) :
- `CONSUMES_REFERENCE_UNRESOLVED` (low) — contract.consumes référence "toutes les features emettrices (orders, payments, shared-cart, refunds...) en entree evenementielle uniquement" — ne correspond à aucun nom de feature connu

**Implementation** : 41 fichier(s) déclaré(s), boutique: 3 fichier(s)
  - migrations : 6
  - routes : 4
  - services : 12
  - tests : 18
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
  - collecte QR au retrait
  - projection checkout boutique : finalisation d’une sélection en commande, sans ownership de l’encaissement
- _out_ :
  - encaissement du paiement (feature payments)
  - logique panier partage (feature shared-cart, consommatrice d'orders)
  - remboursement (feature refunds, lecture seule sur orders)
  - tarification (feature economic-engine, orders ne fait que la consommer)
  - matérialisation, conservation et téléchargement des factures (feature documents ; orders ne fournit que l’événement confirmé et les données source)
  - engagement fournisseur : création, confirmation, réception et annulation d'un bon de commande (feature purchasing, scindée d'orders au Lot O1.4, 2026-07-12) — orders déclenche la synchronisation d'annulation via l'API interne purchasing, sans SQL direct sur purchase_orders

**Authority** : backend-core — tout changement de la machine de statut ou du schema order_reference doit etre valide par le proprietaire de order-status-machine.js

**Invariants** :
- annulation libre et 100% avant ordered (plancher 24h) ; commande ferme des ordered — demande wallet-only ensuite (DOCTRINE_ANNULATION)
- le badge Remboursable/Ferme du suivi EST le contrat : il ne dit jamais autre chose que ce que le code fait
- [object Object]
- [object Object]
- [object Object]
- transition de statut uniquement via order-status-machine.js
- annulation libere les achats fournisseurs lies dans la meme transaction via purchasing

**Owns** : `customs_history`, `disputes`, `order_comments`, `order_item_cost_imputations`, `order_items`, `order_status_history`, `orders`, `recipients`, `sms_log`
**Writes (not owner)** : `alerts` (writer-not-owner)

**Exposes** : 5 internal API(s), 27 HTTP interface(s)
  - `checkoutCart` (public/boutique/js/b-checkout.js) — resolved
  - `makeInput` (public/boutique/js/b-checkout.js) — resolved
  - `setOrderItemAvailabilityStatus` (services/order-item-availability-service.js) — resolved
  - `transitionOrderStatus` (services/order-status-machine.js) — resolved
  - `updateOrderItemAvailabilityDetails` (services/order-item-availability-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (1) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "dashboard" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 54 fichier(s) déclaré(s), boutique: 14 fichier(s)
  - boutique : 3
  - routes : 12
  - services : 9
  - tests : 29
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
  - orchestration du checkout boutique (projection frontend de orders)
  - remboursement (feature refunds, qui consomme payments en lecture)
  - credit wallet (feature wallet-loyalty)

**Authority** : backend-core — tout changement de webhook ou de logique d'idempotence doit etre valide par le proprietaire de payment-service.js

**Invariants** :
- [object Object]
- aucun secret de paiement en dur dans le code
- [object Object]

**Owns** : `cash_collections`, `cash_deposits`, `paypal_events_processed`, `stripe_events_processed`
**Writes (not owner)** : `alerts` (writer-not-owner), `orders` (writer-not-owner)

**Exposes** : 2 internal API(s), 18 HTTP interface(s)
  - `markPaid` (services/payment-service.js) — resolved
  - `markRefunded` (services/payment-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 CLASSIFICATION-MISSING — champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)

**Architectural debt** : _aucune_

**Implementation** : 38 fichier(s) déclaré(s), boutique: 3 fichier(s)
  - boutique : 2
  - migrations : 1
  - routes : 4
  - services : 12
  - tests : 19

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
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

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

**Owns** : `fabrics`, `garment_models`, `store_credits`
**Writes (not owner)** : `notification_log` (writer-not-owner), `orders` (writer-not-owner), `parcel_items` (writer-not-owner), `parcels` (writer-not-owner), `scans` (writer-not-owner)

**Exposes** : 0 internal API(s), 33 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 1 test-only, 4 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: check:body-classes, fail: 0, warn: 7
  - [check:body-classes] 🟠 TEXT-GATE-DIAGNOSTIC — ↳ Référencé en CSS : css\cart.css:2188, css\cart.css:2199 … — sélecteur legacy ou JS manquant
  - [check:body-classes] 🟠 TEXT-GATE-DIAGNOSTIC — ⚠ 0 erreur, 6 avertissement(s) — exit 0
  - [check:body-classes] 🟠 TEXT-GATE-DIAGNOSTIC — ⚠ [B-2] Classe body 'k-view-fav' retirée mais jamais ajoutée dans le JS ou HTML inline
  - [check:body-classes] 🟠 TEXT-GATE-DIAGNOSTIC — ⚠ [B-2] Classe body 'k-view-group' retirée mais jamais ajoutée dans le JS ou HTML inline
  - [check:body-classes] 🟠 TEXT-GATE-DIAGNOSTIC — ⚠ [B-2] Classe body 'k-view-komerce' retirée mais jamais ajoutée dans le JS ou HTML inline
  - [check:body-classes] 🟠 TEXT-GATE-DIAGNOSTIC — ⚠ [B-2] Classe body 'k-view-track' retirée mais jamais ajoutée dans le JS ou HTML inline
  - [check:body-classes] 🟠 TEXT-GATE-DIAGNOSTIC — ⚠ [B-3] CSS utilise body.ck-is-me mais aucun JS ne gère cette classe

**Architectural debt** : _aucune_

**Implementation** : 40 fichier(s) déclaré(s), boutique: 21 fichier(s)
  - boutique : 6
  - compositionRoots : 3
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
  - synchronisation d'annulation : pending/notified suivent l'annulation de la commande ; les POs engagées déclenchent une alerte sans forçage
  - réparation/rattrapage des commandes marquées "ordered" sans (ou avec) bon de commande cohérent (outils admin de correction)
  - gestion des fournisseurs et de leur mapping produit (routes/purchasing.js /suppliers/*)
  - administration transverse des bons de commande, historiquement exposée depuis le dashboard (services/purchasing-admin-service.js — retaggé @domain purchasing au Lot O2, écrit orders/product_suppliers/purchase_orders/suppliers)
- _out_ :
  - cycle de vie de la commande cliente elle-même — orders reste seul propriétaire de order-status-machine.js (feature orders, scindée au Lot O1.4)
  - confirmation de paiement client (order-payment-confirmation.js, reste dans orders)
  - mouvement physique du colis une fois reçu (feature logistics, lecture seule sur purchase_orders/product_suppliers)
  - entrée catalogue / import fournisseur en amont (feature catalog — sourcing/catalog-import, hors périmètre purchasing)

**Authority** : backend-core — tout changement du flux d'engagement fournisseur (déclenchement, confirmation, réception, annulation) doit rester derrière les services propriétaires purchasing

**Invariants** :
- [object Object]
- purchasing peut consommer et lire la commande cliente, mais ne possède jamais son cycle de vie — toute mutation de orders.status continue de passer exclusivement par order-status-machine.js (feature orders)
- une réception ne peut être appliquée qu'à un bon de commande existant et cohérent
- aucun consommateur cross-feature ne modifie purchase_orders directement : la synchronisation d'annulation passe par purchasing-cancel-service.js

**Owns** : `product_suppliers`, `purchase_orders`, `suppliers`
**Writes (not owner)** : `alerts` (writer-not-owner), `orders` (writer-not-owner)

**Exposes** : 3 internal API(s), 10 HTTP interface(s)
  - `repairOrderedWithoutPurchaseOrders` (services/repair-ordered-without-purchase-orders.js) — resolved
  - `syncPurchaseOrdersOnOrderCancel` (services/purchasing-cancel-service.js) — resolved
  - `triggerPurchasing` (services/purchasing-trigger-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 SIDEEFFECT-NO-INVARIANT — externalSideEffect "outbound-message" mais aucun invariant lié (idempotence, webhook…) — documenter la garantie

**Architectural debt** : _aucune_

**Implementation** : 18 fichier(s) déclaré(s)
  - routes : 1
  - services : 7
  - tests : 10

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

**Consumes** : catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)
**Consumed by** : infrastructure (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (2) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "auth" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "logistics" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 4 fichier(s) déclaré(s), boutique: 3 fichier(s)
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

**Consumes** : documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 1 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 CLASSIFICATION-MISSING — champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)

**Architectural debt** (1) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "shared-cart" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 6 fichier(s) déclaré(s)
  - services : 1
  - tests : 4
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="refunds"]_

## shared-cart

**Kind** : business-feature  ·  **Status** : production

**Service** : Permettre à un créateur de publier une liste immuable par lien public ; chaque acheteur sélectionne une ou plusieurs lignes disponibles, passe par le récapitulatif puis le checkout canonique sans mélanger son panier personnel.

**Perimeter** :
- _in_ :
  - création puis publication immuable, fermeture et annulation de la liste partagée
  - lecture publique et propriétaire (avec statut de réclamation dérivé par jointure)
- _out_ :
  - paiement carte/PayPal/cash (feature payments, consommée en sortie)
  - arbitrage de la réclamation d'un article (index unique order_items.shared_cart_item_id, migration 123 — feature orders)
  - création de la commande (feature orders)
  - crédit wallet (feature wallet)

**Authority** : backend-core — tout changement de statut (open/closed/cancelled) doit être validé par le propriétaire de shared-cart-lifecycle.js

**Invariants** :
- une liste publiée est un snapshot structurellement immuable : OPEN signifie achetable, jamais éditable
- tant que les listes V1 ne sont pas nommables, un créateur possède au maximum une liste OPEN
- Mon panier reste indépendant ; une seule liste OPEN peut occuper le slot partagé local
- une sélection de liste est locale, ne réserve rien et passe toujours par récapitulatif puis checkout canonique
- une commande porte soit sur PERSONAL_CART soit sur SHARED_LIST, jamais les deux
- un article de liste n'est jamais réclamable deux fois — arbitré par index unique, pas par verrou applicatif (migration 123)
- aucune donnée financière n'est stockée sur shared_carts — le total se calcule toujours par SUM() sur shared_cart_items
- lien partagé ouvre une boutique — jamais un guichet de paiement (Boutique First)
- annulation de liste (cancel) n'effectue jamais de remboursement — aucune contribution n'y transite

**Owns** : `basket_items`, `baskets`, `cart_shares`, `shared_cart_events`, `shared_cart_items`, `shared_cart_saved_access`, `shared_carts`

**Exposes** : 0 internal API(s), 16 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: check:breakpoints, fail: 0, warn: 1
  - [check:breakpoints] 🟠 TEXT-GATE-DIAGNOSTIC — Total : 2 violations dans 2 fichiers.

**Architectural debt** : _aucune_

**Implementation** : 56 fichier(s) déclaré(s), boutique: 18 fichier(s)
  - boutique : 11
  - dash : 1
  - migrations : 19
  - routes : 4
  - services : 8
  - tests : 13

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
  - persistence lifecycle des sourcing_candidates issus des imports catalog via frontière owner dédiée
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

**Owns** : `sourcing_candidate_events`, `sourcing_candidates`

**Exposes** : 2 internal API(s), 11 HTTP interface(s)
  - `archiveMissingCandidatesFromCatalogImport` (services/sourcing-candidate-import-service.js) — resolved
  - `upsertCandidateFromCatalogImport` (services/sourcing-candidate-import-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: gate:feature-classification-check, fail: 0, warn: 1
  - [gate:feature-classification-check] 🟠 CLASSIFICATION-MISSING — champ `classification` absent — ajouter lors du prochain changement de ce manifest (ratchet phase 2)

**Architectural debt** : _aucune_

**Implementation** : 8 fichier(s) déclaré(s)
  - migrations : 4
  - routes : 1
  - services : 1
  - tests : 2

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

**Consumes** : auth (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

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
- [object Object]
- solde jamais negatif sans flag explicite admin

**Owns** : `wallet_consumptions`, `wallet_credit_lots`, `wallet_transactions`, `wallets`
**Writes (not owner)** : `orders` (writer-not-owner)

**Exposes** : 0 internal API(s), 9 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 10 fichier(s) déclaré(s), boutique: 3 fichier(s)
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
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 0 fichier(s) déclaré(s)

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="wallet-loyalty"]_
