# FEATURE 360

_Projection déterministe de lecture au-dessus de la chaîne Feature First O2-O7.3 déjà gouvernée. Feature 360 ne crée aucune nouvelle vérité architecturale ; toute correction se fait dans la source autoritaire existante._

## Global scorecard

- Features : **37**
- Healthy : **35**
- Attention : **2**
- Blocked : **0**
- Business dependencies : **272**
- Direct cross-feature imports : **0**
- Runtime cycles : **0**
- Ambiguous ownership signals : **0**
- Ontology gaps : **0**
- Debt items (total) : **6**
- Gate health — healthy : **34** · blocked : **2**

## Gate findings — intégrité de projection

- Source : `docs/GATE_FINDINGS.json` (version GF-3.0)
- Sources de gates : **18** (0 en échec)
- Findings : **5** total, **5** attribué(s), **0** sans attribution exploitable
- Fichiers non projetables : **0**
- Fichiers multi-projetés : **0**

## Features

| Feature | Kind | Boundary | Governance | Owns | Consumes | Consumed by | Debt |
|---|---|---|---|---|---|---|---|
| admin-dashboard | projection | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | catalog, customs, dashboard, decision-signals, documents, economic-engine, inventory, logistics, orders, payments, sourcing | _aucune_ | 0 |
| auth | technical-transversal | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | auth-identity, infrastructure, notifications | auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, infrastructure, inventory, logistics, loyalty, market-delegation, notifications, orders, payments, platform-ops, providers-services, purchasing, settlement, shared-cart, sourcing, unsold-resolution, wallet | 0 |
| auth-identity | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | otp_codes, revoked_tokens, user_pickup_authorizations, users | auth, auth-passkey, catalog, documents, infrastructure, logistics, loyalty, notifications, orders, platform-ops, wallet | auth, auth-passkey, business-rules, catalog, dashboard, documents, economic-engine, logistics, loyalty, market-delegation, notifications, orders, payments, platform-ops, providers-services, settlement, shared-cart, wallet | 0 |
| auth-passkey | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | webauthn_challenges, webauthn_credentials | auth, auth-identity, infrastructure, platform-ops | auth-identity | 0 |
| business-rules | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | business_rules, business_rules_history | auth, auth-identity, infrastructure | catalog, dashboard, decision-signals, economic-engine, logistics, orders, payments, platform-ops | 0 |
| catalog | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | boutique_categories, boutique_subcategories, catalog_enrichment_runs, catalog_field_overrides, catalog_media, product_attributes, product_content_profile, product_content_sections, product_market_exposure, product_sku_media, product_skus, product_variants, products, supplier_catalog_imports, supplier_catalog_sync_checkpoints | auth, auth-identity, business-rules, economic-engine, infrastructure, logistics, market-autonomy, notifications, orders, platform-ops, shared-cart, sourcing | admin-dashboard, auth-identity, customs, documents, economic-engine, infrastructure, inventory, local-stock, logistics, market-autonomy, market-delegation, market-operator-dashboard, orders, platform-ops, purchasing, recommendations, shared-cart, sourcing, unsold-resolution | 0 |
| customs | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | customs_categories, customs_shipment_parcels, customs_shipments | auth, catalog, documents, economic-engine, infrastructure, logistics, orders | admin-dashboard, dashboard, documents, economic-engine, infrastructure, orders | 0 |
| dashboard | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | order_incidents, partners | auth, auth-identity, business-rules, customs, decision-signals, documents, economic-engine, incident-management, infrastructure, inventory, logistics, market, market-delegation, notifications, orders, payments, purchasing, shared-cart, wallet | admin-dashboard, economic-engine, infrastructure, sourcing | 0 |
| decision-signals | piloting-capability | 🟢 HEALTHY | 🟢 HEALTHY | signals | auth, business-rules, infrastructure, logistics | admin-dashboard, dashboard | 0 |
| documents | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | invoices, transaction_documents | auth, auth-identity, catalog, customs, infrastructure, logistics, orders, refunds, wallet | admin-dashboard, auth-identity, customs, dashboard, logistics, orders, payments, platform-ops, refunds, wallet | 0 |
| economic-engine | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | charges, competitor_prices, cost_benchmarks, cost_component_events, cost_component_market_override_events, cost_component_market_overrides, cost_components, economic_risk_cost_events, economic_risk_watermark_events, economic_snapshots, economic_structure_cost_events, exchange_rates, finance_config, market_price_observation_events, market_price_observations, order_item_real_cost_allocations, price_history, pricing_category_dims, pricing_category_taxes, pricing_components, pricing_market_decision_policy_events, pricing_matrices_audit, pricing_maturity_disposition_events, pricing_strategies, pricing_strategy_history, risk_provisions | auth, auth-identity, business-rules, catalog, customs, dashboard, infrastructure, logistics, loyalty, market, market-autonomy, market-delegation, orders, platform-ops, refunds | admin-dashboard, catalog, customs, dashboard, infrastructure, loyalty, market-autonomy, market-delegation, orders, platform-ops, sourcing | 0 |
| incident-management | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | incidents | infrastructure, logistics, orders | dashboard, logistics, notifications, payments, platform-ops | 0 |
| infrastructure | technical-foundation | 🟢 HEALTHY | 🟢 HEALTHY | schema_migrations | auth, catalog, customs, dashboard, economic-engine, inventory, logistics, notifications, orders, payments, platform-ops, recommendations, shared-cart, wallet | auth, auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, inventory, local-stock, logistics, loyalty, market, market-autonomy, market-delegation, market-operator-dashboard, notifications, orders, payments, platform-ops, providers-services, purchasing, recommendations, refunds, settlement, shared-cart, sourcing, unsold-resolution, wallet | 0 |
| inventory | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | inventory_items | auth, catalog, infrastructure, logistics, orders | admin-dashboard, dashboard, infrastructure | 0 |
| legacy-control-tower | deprecated | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| local-stock | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | local_stock, local_stock_allocations | catalog, infrastructure, logistics, market | orders, providers-services, recommendations | 0 |
| logistics | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | carriers, parcel_events, parcel_items, parcels, pickup_print_tokens, pickup_reveal_codes, pickup_verify_attempts, relais, scan_events, scans, shipments | auth, auth-identity, business-rules, catalog, documents, incident-management, infrastructure, loyalty, market, market-delegation, notifications, orders, payments, purchasing, refunds | admin-dashboard, auth-identity, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, infrastructure, inventory, local-stock, market-delegation, notifications, orders, payments, platform-ops, purchasing, recommendations | 0 |
| loyalty | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | loyalty_rewards, loyalty_tiers | auth, auth-identity, economic-engine, infrastructure, notifications, orders | auth-identity, economic-engine, logistics, orders, payments | 0 |
| market | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | currency_parities, markets, operator_market_scopes | infrastructure | dashboard, economic-engine, local-stock, logistics, market-autonomy, market-delegation, market-operator-dashboard, orders, payments, providers-services, recommendations, settlement | 0 |
| market-autonomy | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | product_market_price_draft_events, product_market_price_drafts | catalog, economic-engine, infrastructure, market | catalog, economic-engine, market-operator-dashboard, orders, shared-cart | 2 |
| market-delegation | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | assignment_capability_ceiling, assignment_memberships, capability_registry, ceiling_template_capabilities, ceiling_templates, market_cash_control_policies, market_delegation_audit, market_operating_assignments, market_team_invitations, membership_capabilities | auth, auth-identity, catalog, economic-engine, infrastructure, logistics, market, orders, providers-services, settlement | dashboard, economic-engine, logistics, payments, settlement | 0 |
| market-operator-dashboard | unclassified | 🟡 ATTENTION | 🟢 HEALTHY | _aucune_ | catalog, infrastructure, market, market-autonomy | _aucune_ | 4 |
| notifications | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | alerts, client_notifications, notification_log | auth, auth-identity, incident-management, infrastructure, logistics, orders, platform-ops | auth, auth-identity, catalog, dashboard, infrastructure, logistics, loyalty, orders, payments, purchasing, shared-cart | 0 |
| orders | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | customs_history, disputes, order_comments, order_item_cost_imputations, order_items, order_status_history, orders, recipients, sms_log | auth, auth-identity, business-rules, catalog, customs, documents, economic-engine, infrastructure, local-stock, logistics, loyalty, market, market-autonomy, notifications, payments, platform-ops, purchasing, refunds, shared-cart, wallet | admin-dashboard, auth-identity, catalog, customs, dashboard, documents, economic-engine, incident-management, infrastructure, inventory, logistics, loyalty, market-delegation, notifications, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, unsold-resolution, wallet | 0 |
| payments | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | cash_collections, cash_confirmation_controls, cash_deposits, mobile_money_transactions, paypal_events_processed, stripe_events_processed | auth, auth-identity, business-rules, documents, incident-management, infrastructure, logistics, loyalty, market, market-delegation, notifications, orders, platform-ops, purchasing, refunds | admin-dashboard, dashboard, infrastructure, logistics, orders | 0 |
| platform | frontend-transversal | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| platform-ops | technical-transversal | 🟢 HEALTHY | 🟢 HEALTHY | fabrics, garment_models | auth, auth-identity, business-rules, catalog, documents, economic-engine, incident-management, infrastructure, logistics, orders, purchasing, wallet | auth-identity, auth-passkey, catalog, economic-engine, infrastructure, notifications, orders, payments, providers-services, recommendations, shared-cart, wallet | 0 |
| providers-services | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | inquiries, physical_offers, providers, services | auth, auth-identity, infrastructure, local-stock, market, platform-ops, recommendations | market-delegation, recommendations | 0 |
| purchasing | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | product_suppliers, purchase_orders, suppliers | auth, catalog, infrastructure, logistics, notifications, orders | dashboard, logistics, orders, payments, platform-ops | 0 |
| recommendations | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | catalog, infrastructure, local-stock, logistics, market, orders, platform-ops, providers-services | infrastructure, providers-services, shared-cart | 0 |
| refunds | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | refunds | documents, infrastructure, orders, wallet | documents, economic-engine, logistics, orders, payments | 0 |
| settlement | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | market_settlement_events, market_settlements | auth, auth-identity, infrastructure, market, market-delegation | market-delegation | 0 |
| shared-cart | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | basket_items, baskets, cart_shares, shared_cart_events, shared_cart_items, shared_cart_saved_access, shared_carts | auth, auth-identity, catalog, infrastructure, market-autonomy, notifications, orders, platform-ops, recommendations | catalog, dashboard, infrastructure, orders | 0 |
| sourcing | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | sourcing_candidate_events, sourcing_candidates | auth, catalog, dashboard, economic-engine, infrastructure | admin-dashboard, catalog | 0 |
| unsold-resolution | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | unsold_items | auth, catalog, infrastructure, orders | _aucune_ | 0 |
| wallet | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | wallet_consumptions, wallet_credit_lots, wallet_transactions, wallets | auth, auth-identity, documents, infrastructure, orders, platform-ops | auth-identity, dashboard, documents, infrastructure, orders, platform-ops, refunds | 0 |
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

**Exposes** : 6 internal API(s), 0 HTTP interface(s)
  - `requireAuth / requireVerifiedIdentity / softAuth` (middleware/auth.js) — resolved
  - `requireAuth / requireVerifiedIdentity / softAuth` (middleware/require-verified-identity.js) — resolved
  - `requireAuth / requireVerifiedIdentity / softAuth` (middleware/soft-auth.js) — resolved
  - `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` (utils/auth-session-policy.js) — resolved
  - `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` (utils/auth-session.js) — resolved
  - `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` (utils/auth-token-policy.js) — resolved

**Consumes** : auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 24 fichier(s) déclaré(s)
  - middleware : 7
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
- [object Object]
- le nom autorisé n'est jamais exposé au relais : logistics ne reçoit que des champs normalisés via getActiveAuthorizationForUpdate, jamais authorized_given_names/authorized_family_name en clair

**Owns** : `otp_codes`, `revoked_tokens`, `user_pickup_authorizations`, `users`

**Exposes** : 12 internal API(s), 22 HTTP interface(s)
  - `anonymizeUser` (services/user-mutation-service.js) — resolved
  - `createAdminUser` (services/user-mutation-service.js) — resolved
  - `deleteNonAdminUsers` (services/user-mutation-service.js) — resolved
  - `deleteUser` (services/user-mutation-service.js) — resolved
  - `getActiveAuthorizationForUpdate` (services/pickup-authorization-service.js) — resolved
  - `hasActiveAuthorization` (services/pickup-authorization-service.js) — resolved
  - `incrementBigBasketCount` (services/user-mutation-service.js) — resolved
  - `makeIntlPhoneInput` (public/boutique/js/b-phone.js) — resolved
  - `markBigBasketNotified` (services/user-mutation-service.js) — resolved
  - `recalculateUserLoyalty` (services/user-mutation-service.js) — resolved
  - _...2 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 20 fichier(s) déclaré(s), boutique: 5 fichier(s)
  - boutique : 3
  - migrations : 2
  - routes : 3
  - services : 3
  - tests : 8
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
- [object Object]
- un challenge émis pour un user ne peut jamais être consommé au bénéfice d'un autre user
- expectedOrigin et expectedRPID viennent exclusivement de la config serveur, jamais du client
- [object Object]
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
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 14 fichier(s) déclaré(s), boutique: 10 fichier(s)
  - migrations : 2
  - routes : 1
  - services : 3
  - tests : 8

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

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)

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
  - connecteurs fournisseurs (CSV, API, manuel, Noon, CJdropshipping)
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
  - bootstrap visuel CJ borné : 63 produits réels, médias fournisseur liés au lignage, exécution one-shot gardée
  - pool CJ de Raffinerie borné à 1000 références propres maximum, dédupliqué et reprenable, sans publication automatique
  - product_market_exposure : exposition commerciale produit x marché, fail-closed (absence de ligne = DISABLED), même patron que commercial_exposure sur physical_offers/services
  - migration 206 : snapshot de compatibilité produit x marché, reproduction exacte de publicCatalogVisibilitySql() croisée avec chaque marché actif — cutover, pas un all x all aveugle
  - services/catalog-public-view.js::publicCatalogVisibilitySql(alias, { marketCodeParam }) : le chemin de lecture storefront consulte désormais product_market_exposure quand un marché est fourni ; sans marché, comportement historique inchangé à l’identique
- _out_ :
  - calcul du prix final et valorisation transport (feature economic-engine)
  - decision de rail, routing et eligibilite logistique dynamique (feature logistics)
  - mise en avant / classement (feature recommendations)
  - fiche snapshot lecture seule du panier partage (feature shared-cart)
  - checkout final et paiement (features orders/payments)
  - décision d’exposition produit x marché (qui écrit product_market_exposure) : feature market-delegation, capability catalog.expose

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
- le pool fournisseur CJ de la Raffinerie ne dépasse jamais 1000 références propres ; son alimentation ne publie aucun produit automatiquement

**Owns** : `boutique_categories`, `boutique_subcategories`, `catalog_enrichment_runs`, `catalog_field_overrides`, `catalog_media`, `product_attributes`, `product_content_profile`, `product_content_sections`, `product_market_exposure`, `product_sku_media`, `product_skus`, `product_variants`, `products`, `supplier_catalog_imports`, `supplier_catalog_sync_checkpoints`

**Exposes** : 6 internal API(s), 31 HTTP interface(s)
  - `applyPrice` (services/catalog-product-mutation-service.js) — resolved
  - `bulkAssignSourcingRail` (services/catalog-product-mutation-service.js) — resolved
  - `createDraftFromSourcingCandidate` (services/product-admin-service.js) — resolved
  - `createDraftProductFromSourcingCandidate` (services/catalog-candidate-product-service.js) — resolved
  - `replaceVariantsForSourcing` (services/catalog-product-mutation-service.js) — resolved
  - `updateSourcingFields` (services/catalog-product-mutation-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), market-operator-dashboard (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🔴 BLOCKED — gates: check:imports, gate:feature-guard, fail: 1, warn: 2
  - [check:imports] 🟠 TEXT-GATE-DIAGNOSTIC — ⚠ js/b-pager.js — 1 export(s) non consommé(s) :
  - [check:imports] 🟠 TEXT-GATE-DIAGNOSTIC — ✔ Aucun import fantôme ni cycle inconnu ni module manquant.
  - [gate:feature-guard] 🔴 FEATURE-GUARD — @domain mismatch : ../js/product-image-loading-ux.js declare @domain "boutique" mais est liste dans catalog.feature.js (domain "catalog")

**Architectural debt** : _aucune_

**Implementation** : 199 fichier(s) déclaré(s), boutique: 33 fichier(s)
  - boutique : 39
  - ci : 6
  - config : 1
  - dash : 4
  - docs : 11
  - middleware : 1
  - migrations : 16
  - routes : 6
  - schemas : 4
  - scripts : 2
  - services : 43
  - tests : 65
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

**Exposes** : 0 internal API(s), 20 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

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

**Service** : Exposer les agrégats de pilotage et porter un portail interne Canonical unifié accessible depuis /admin, dont la navigation et les workspaces sont adaptés au rôle, aux scopes marché et aux capabilities résolus côté serveur, sans réutiliser les deux générations historiques de dashboards.

**Perimeter** :
- _in_ :
  - routes agrégées dashboard admin (KPIs, clients, opérations, hub, relais, radar, risques)
  - queries de métriques et cache dashboard
  - Legacy 1 : public/dashboards/admin/** — runtime actuel, gelé en maintenance corrective et rollback uniquement
  - Legacy 0 : public/dashboards/admin-legacy/** — génération antérieure deprecated, conservation historique/rollback
  - Canonical : public/dashboards/canonical/** — seule cible autorisée pour tout nouveau développement dashboard
  - Portail interne unique /admin — même shell Canonical pour administration centrale, opérateurs pays et rôles terrain autorisés
  - Operations Workspace : les rôles terrain natifs restent compatibles ; une membership pays peut exécuter une mutation seulement avec la capability execution.* exacte, résolue et auditée par market-delegation
  - Authentification commune puis landing/navigation contextuelles ; les deep-links /admin/** restent des destinations, pas des portails séparés
  - AdminContext canonical — projection UI d'une autorité market déjà résolue côté serveur, jamais une source d'autorisation locale
  - auth-guard et composants partagés des runtimes historiques tant qu’ils restent servis
- _out_ :
  - mutations de données (chaque feature métier owns ses mutations)
  - logique panier, commandes, paiements (feature orders / payments / shared-cart)
  - moteur tarifaire (feature economic-engine)
  - nouveau développement dashboard sous public/dashboards/admin/** ou public/dashboards/admin-legacy/** hors correctif explicite
  - import ou héritage UI de admin/** ou admin-legacy/** depuis canonical/**
  - migration écran-par-écran des anciennes vues : elles sont des sources de besoins, pas des unités à porter

**Authority** : backend-core — tout ajout de route agrégée ou de requête de métriques doit être validé par le propriétaire de dashboard-metrics.js et dashboard-cache.js

**Invariants** :
- dashboard agrège en lecture pour les vues de pilotage/reporting (Control Tower, Pilotage, Santé, Clients, radar, risques) : ces surfaces-là ne mutent aucune donnée. À l'inverse, les routes hub/relais/admin opérationnelles (voir db.tables entrées W/RW) écrivent réellement — ancien invariant "lecture seule" corrigé au Lot O1.5 (2026-07-12) car contredit par le code ; voir debt.knownGaps pour le plan de redistribution de ces mutations vers leurs features propriétaires
- les métriques passent par dashboard-cache.js (pas de requêtes directes dupliquées)
- Legacy 0 public/dashboards/admin-legacy/** est deprecated et ne reçoit aucun nouveau développement
- Legacy 1 public/dashboards/admin/** reste servi mais est gelé : correctifs et rollback uniquement, aucune nouvelle capacité dashboard
- Canonical public/dashboards/canonical/** est la seule cible de développement des quatre dashboards futurs : Pilotage, Commerce, Opérations, Finance
- canonical/** ne référence ni n’importe aucun code ou CSS de admin/** ou admin-legacy/** ; les anciennes vues ne servent que de sources de besoins
- /admin est la porte d’entrée interne unique ; les URLs /admin/** spécialisées sont des destinations/deep-links et non des portails métiers séparés
- authentification et autorisation restent séparées : login établit l’identité, le runtime et les APIs serveur contrôlent rôle, scope, Market ID et capabilities
- un futur OTP peut renforcer la preuve d’identité ou une action sensible sans devenir une source de rôle, scope, Market ID ou capability
- /admin-next sert canonical pendant la construction ; les routes /admin/* restent sur Legacy 1 jusqu’au cutover explicitement validé
- auth-guard.js protège toutes les routes admin historiques ; canonical valide sa session au bootstrap et ne contourne jamais /api/auth/me
- Komerce central et les partenaires pays partagent le même runtime canonical : aucune variante ou copie par marché
- le rôle vertical ne donne jamais un scope pays ; toute autorité market est résolue côté serveur puis appliquée avant agrégation
- un filtre pays du DashboardSchema est présentationnel : canonical ne charge jamais un agrégat global pour le filtrer ensuite côté client
- market est l'unité de délégation business ; corridor reste une dimension technique/logistique sans autorité
- le cockpit Démo / Staging ne possède aucune transition : il délègue à la route orders et lit les notifications/documents réellement persistés

**Owns** : `order_incidents`, `partners`
**Writes (not owner)** : `invoices` (writer-not-owner), `order_comments` (writer-not-owner), `order_items` (writer-not-owner), `order_status_history` (writer-not-owner), `orders` (writer-not-owner), `products` (writer-not-owner), `recipients` (writer-not-owner), `relais` (writer-not-owner), `scan_events` (writer-not-owner), `sms_log` (writer-not-owner), `wallet_transactions` (writer-not-owner), `wallets` (writer-not-owner)

**Exposes** : 0 internal API(s), 63 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 2 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 215 fichier(s) déclaré(s)
  - dash : 98
  - middleware : 1
  - migrations : 2
  - routes : 24
  - services : 23
  - tests : 67

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="dashboard"]_

## decision-signals

**Kind** : piloting-capability  ·  **Status** : staging

**Service** : Detecter et qualifier des signaux operationnels (cash, colis, incidents) a partir des donnees produites par plusieurs features, pour l'aide a la decision admin.

**Perimeter** :
- _in_ :
  - generation de signaux depuis des requetes radar cross-feature (cash, colis, incidents)
  - cycle de vie du signal : acknowledge / resolve / snooze
  - consultation admin des signaux (routes/signals.js)
  - Action Center Canonical : projection globale + lifecycle par signal_ref
- _out_ :
  - aucune decision metier engageante : la capability detecte, elle ne tranche aucun statut de commande, colis ou wallet
  - aucune UI ne devient propriétaire de la donnée source : Action Center reste une projection dashboard de cette capability
  - classement produit boutique (feature recommendations, qui reste seule proprietaire du ranking)

**Invariants** :
- un signal est un constat derive, jamais une mutation d'une table possedee par une autre feature
- acknowledge/resolve/snooze changent uniquement l'etat du signal, jamais l'etat de la donnee source
- open, acknowledged et snoozed forment un seul lifecycle actif ; disparition de la condition => auto-resolution
- aucune autorite market n'est inventee tant que signals ne porte pas un market_id canonique

**Owns** : `signals`

**Exposes** : 0 internal API(s), 5 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 26 fichier(s) déclaré(s)
  - middleware : 1
  - migrations : 1
  - routes : 2
  - services : 9
  - tests : 13

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

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 36 fichier(s) déclaré(s)
  - migrations : 7
  - routes : 3
  - services : 7
  - tests : 14
  - utils : 5

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="documents"]_

## economic-engine

**Kind** : business-feature  ·  **Status** : production

**Service** : Calculer les frontières économiques, la contribution et la couverture ; le marché borne le possible et le responsable autorisé décide le prix.

**Perimeter** :
- _in_ :
  - moteur de pricing et application des regles
  - audit des changements de prix produit dans price_history
  - allocation de cout
  - vérité des charges de structure de période issue de faits économiques append-only, distincte des configurations de charges
  - vérité du risque de période issue de faits append-only et d un watermark de revue explicite par marché
  - gate de couverture économique par marché, fail-closed sur maturité, risque et charges de structure attribuées
  - politique canonique de décision par marché : fenêtre, seuils de maturité/couverture et plafond de dispositions versionnés append-only
  - corridor de prix issu de preuves marché locales, sans fallback silencieux depuis une référence globale
  - explicabilité canonique de chaque ligne de coût : source, hypothèse, mouvement, nature économique, périmètre d allocation et impact
  - strategies tarifaires et matrices admin
  - gestion des provisions pour risque (routes/admin-risk-provisions.js — retaggé @domain economic-engine au Lot O2, était @domain dashboard)
- _out_ :
  - affichage produit cote catalogue (feature catalog, qui consomme economic-engine)
  - facturation finale (feature orders)
  - autorisation et audit de l’enregistrement délégué d’un fait MARKET_DIRECT par un opérateur pays (feature market-delegation, capability structure.event.record) — appelle recordStructureCostEvent() sans jamais dupliquer sa validation ni écrire directement dans economic_structure_cost_events

**Authority** : backend-core — toute frontière économique, règle de contribution, couverture ou application de prix reste derrière les services propriétaires economic-engine ; une charge fixe n a aucune autorité de fabrication du prix SKU

**Invariants** :
- une strategie tarifaire est versionnee, jamais modifiee retroactivement sur une commande deja figee
- aucun consommateur cross-feature ne modifie price_history directement ; l audit passe par economic-price-audit-service.js
- chaque ligne de coût exposée à la décision décrit sa provenance, son hypothèse, sa nature économique, son périmètre d allocation, son niveau de vérité et son chemin d impact sans promouvoir une configuration en réel
- une charge fixe configurée dans charges ne devient jamais un réel de période ; seule une preuve append-only dans economic_structure_cost_events peut porter cette vérité
- les articles génèrent la contribution ; le portefeuille absorbe collectivement les charges de structure ; aucune quote-part fixe analytique ne devient dette intrinsèque du SKU
- le coût variable complet est la frontière économique unitaire ; le marché borne le possible et le prix final exige une décision marché ou humaine autorisée
- une disposition de maturité ne transforme jamais une commande immature en MATURE et reste bornée par une politique externe versionnée
- un zéro de risque réalisé n existe que derrière un watermark de revue explicite ; une absence de faits ne vaut jamais preuve de zéro
- la fenêtre et les seuils du gate de décision marché proviennent d une politique append-only market-scoped ; aucune date ni seuil d autorisation n est choisi ad hoc par le navigateur
- un gate de couverture marché ne publie un ratio autorisant que sur commandes MATURE, charges de structure marché décisionnelles et vérité risque de période explicite
- une référence globale de concurrence reste informative et ne devient jamais silencieusement une preuve marché locale

**Owns** : `charges`, `competitor_prices`, `cost_benchmarks`, `cost_component_events`, `cost_component_market_override_events`, `cost_component_market_overrides`, `cost_components`, `economic_risk_cost_events`, `economic_risk_watermark_events`, `economic_snapshots`, `economic_structure_cost_events`, `exchange_rates`, `finance_config`, `market_price_observation_events`, `market_price_observations`, `order_item_real_cost_allocations`, `price_history`, `pricing_category_dims`, `pricing_category_taxes`, `pricing_components`, `pricing_market_decision_policy_events`, `pricing_matrices_audit`, `pricing_maturity_disposition_events`, `pricing_strategies`, `pricing_strategy_history`, `risk_provisions`

**Exposes** : 2 internal API(s), 94 HTTP interface(s)
  - `recommend` (services/pricing-engine.js) — resolved
  - `recordProductPriceChange` (services/economic-price-audit-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 160 fichier(s) déclaré(s)
  - dash : 6
  - middleware : 1
  - migrations : 28
  - routes : 13
  - services : 39
  - tests : 70
  - utils : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="economic-engine"]_

## incident-management

**Kind** : business-transversal  ·  **Status** : production

**Service** : Détecter, qualifier et résoudre les écarts entre l'état attendu et l'état réel d'une opération, avec impact client traçable.

**Perimeter** :
- _in_ :
  - création, qualification (type/sévérité/impact client) et résolution (reship/refund/manual_fix/dismissed/auto_resolved) d'un incident
  - table incidents possédée par incident-management ; les producteurs cross-feature passent par incident-write-service.js
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

**Consumes** : infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

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
  - `null` (bootstrap/*) — resolved
  - `null` (middleware/error-handler.js) — resolved
  - `null` (middleware/rate-limit.js) — resolved
  - `null` (middleware/request-id.js) — resolved
  - `null` (middleware/upload.js) — resolved
  - `null` (middleware/validate.js) — resolved
  - `null` (utils/logger.js) — resolved
  - `null` (utils/phone.js) — resolved
  - `null` (utils/rates.js) — resolved
  - `null` (utils/reference.js) — resolved
  - _...1 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), market-operator-dashboard (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 13 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 282 fichier(s) déclaré(s)
  - assets : 29
  - bootstrap : 9
  - ci : 26
  - config : 12
  - db : 16
  - docs : 60
  - middleware : 6
  - migrations : 8
  - routes : 1
  - scripts : 91
  - tests : 19
  - utils : 4
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

**Exposes** : 0 internal API(s), 8 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 1 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

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

## local-stock

**Kind** : business-feature  ·  **Status** : staging

**Service** : Porter le stock physique vendable local, calculer la disponibilité nette des allocations actives, projeter une disponibilité publique minimale et engager/consommer/libérer ce stock dans le cycle commande.

**Perimeter** :
- _in_ :
  - table local_stock : quantité physique, marché, lieu et commercial_exposure
  - table local_stock_allocations : engagement anti-survente avant paiement
  - projection availability calculée AVAILABLE_NOW | UNAVAILABLE, jamais persistée
  - projection checkout read-only LOCAL_STOCK | IMPORT | REVIEW_REQUIRED, quantité-aware et relay-scoped, jamais persistée
  - isStockExposable() : exposure ENABLED et disponibilité nette positive
  - cycle allocate -> consume | release, atomique avec la transaction orders
  - ajustement opérateur du stock local, tracé via updated_by
- _out_ :
  - stock hub/transit : feature inventory
  - stock import/national : feature catalog
  - pricing transport : local-stock ne calcule aucun fret
  - ETA import : domaine transport rail, jamais produit par local-stock
  - parcels et retrait : feature logistics
  - création et lifecycle commande : feature orders
  - autorité transactionnelle du checkout : POST /api/orders refait toujours la résolution sous verrou
  - réservation panier avec TTL ou cron dédié
  - granularité variant_combo : scope product_id uniquement à ce stade

**Authority** : backend-core — toute règle de vérité physique locale, exposition ou engageabilité reste dans la feature local-stock.

**Invariants** :
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]

**Owns** : `local_stock`, `local_stock_allocations`

**Exposes** : 5 internal API(s), 0 HTTP interface(s)
  - `allocateForOrderItem` (services/local-stock-service.js) — resolved
  - `consumeAllocationsForOrder` (services/local-stock-service.js) — resolved
  - `previewCheckoutFulfillmentSources` (services/local-stock-checkout-preview.js) — resolved
  - `releaseAllocationsForOrder` (services/local-stock-service.js) — resolved
  - `resolveCheckoutFulfillmentSources` (services/local-stock-service.js) — resolved

**Consumes** : catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED)
**Consumed by** : orders (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 7 fichier(s) déclaré(s)
  - routes : 1
  - services : 2
  - tests : 4

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="local-stock"]_

## logistics

**Kind** : business-feature  ·  **Status** : production

**Service** : Faire transiter un colis du scan initial au retrait final, avec tracking client et transporteur.

**Perimeter** :
- _in_ :
  - scan et operations colis
  - creation automatique de colis
  - secrets de retrait
  - retrait partiel parcel-scoped avec rotation one-shot du secret order-level
  - compatibilité verify→collect : le code courant est revalidé atomiquement à chaque remise physique
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
- [object Object]
- le retrait exceptionnel par autorisation nominative ne revele jamais le nom attendu a l'agent relais — comparaison aveugle uniquement
- le compteur de tentatives du retrait exceptionnel (exceptional_pickup_attempts) est distinct de celui du code secret (pickup_secret_attempts) — un echec sur l'un ne bloque jamais l'autre
- le jalon disponible au relais transmet à notifications le nom et l adresse publics nécessaires au lien de localisation, sans géocodage bloquant

**Owns** : `carriers`, `parcel_events`, `parcel_items`, `parcels`, `pickup_print_tokens`, `pickup_reveal_codes`, `pickup_verify_attempts`, `relais`, `scan_events`, `scans`, `shipments`

**Exposes** : 20 internal API(s), 70 HTTP interface(s)
  - `addParcelItem` (services/parcel-item-mutation-service.js) — resolved
  - `appendParcelShipmentInfo` (services/parcel-mutation-service.js) — resolved
  - `assignParcelItem` (services/parcel-item-mutation-service.js) — resolved
  - `assignSingleOrderItemToParcel` (services/parcel-item-mutation-service.js) — resolved
  - `assignWholeOrderItemToParcel` (services/parcel-item-mutation-service.js) — resolved
  - `createAutoPreparedParcel` (services/parcel-mutation-service.js) — resolved
  - `createHubParcel` (services/parcel-mutation-service.js) — resolved
  - `createRelais` (services/relais-mutation-service.js) — resolved
  - `detachUserFromScans` (services/scan-write-service.js) — resolved
  - `getOwnedRelais` (services/relais-mutation-service.js) — resolved
  - _...10 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 101 fichier(s) déclaré(s)
  - boutique : 1
  - dash : 2
  - docs : 4
  - middleware : 1
  - migrations : 2
  - routes : 18
  - services : 24
  - tests : 46
  - utils : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="logistics"]_

## loyalty

**Kind** : business-feature  ·  **Status** : production

**Service** : Calculer et maintenir le statut de fidelite d'un client (palier + compteur gros panier) et ses recompenses.

**Perimeter** :
- _in_ :
  - calcul et recalcul du palier de fidelite (recalculate_loyalty(), fonction DB appelee par routes/loyalty.js)
  - compteur et notification de gros panier (big_basket_count / big_basket_last_notified_count)
  - creation et traitement des recompenses (pending/granted/skipped), y compris les actions admin
  - synthese de fidelite exposee (v_loyalty_summary) et grille des paliers (loyalty_tiers)
- _out_ :
  - solde et mouvements wallet (feature wallet, scindee de wallet-loyalty au Lot O1)
  - paiement carte/PayPal (feature payments)
  - remboursement (feature refunds)

**Authority** : backend-core — tout changement de calcul de palier ou de recompense doit etre valide par le proprietaire de loyalty-service.js

**Invariants** :
- ne pas changer les calculs de fidelite (Lot O1 — ontology refactor, pas product refactor)
- le recalcul de palier est idempotent : rejouable sans dupliquer une recompense deja accordee

**Owns** : `loyalty_rewards`, `loyalty_tiers`

**Exposes** : 0 internal API(s), 12 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 7 fichier(s) déclaré(s)
  - routes : 2
  - services : 1
  - tests : 4

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="loyalty"]_

## market

**Kind** : business-feature  ·  **Status** : production

**Service** : Porter le référentiel des marchés ouverts (pays, devise) et l'historique d'accès des opérateurs à un marché — jamais le settlement ni l'attribution économique, qui restent une primitive séparée et différée.

**Perimeter** :
- _in_ :
  - référentiel markets (code pays, devise, minor_unit) — M0
  - historique d'accès operator_market_scopes (grain user, jamais settlement) — M1
  - scoping market_id sur relais et orders (snapshot résolu du relais) — M1b/M1c
  - requireMarketScope autorisation (serveur, enferme l'opérateur, jamais le client) — M2
  - consommation runtime de requireMarketScope par les surfaces admin canoniques scopées par marché (Dashboard, Order 360, Client, Pricing, Opérations, Finance et Expéditions/Douane)
  - garde Joi forbidMarketId + gate scripts/check-no-market-id-mutation.js — M2
  - boundary devise utils/currency.js (formatage minor_unit-aware, lookup markets avec cache 5 min) — M5
  - parités fixes currency_parities, projection via EUR reference (jamais un axe direct entre devises Zone franc) — P1
  - adapter client fmt/fmtPrice (public/boutique/js/b-utils.js), consomme currency_parities via /api/public/config, projette vers le marché courant (market-context.js, override ?market= inclus) — P2
  - snapshot display_total_amount/display_currency (orders, services/order-display-snapshot.js) — troisième vérité, distincte de total_kmf/total_eur (Payment Boundary, finance_config, jamais touchée) et de currency_parities seule — P3, freeze 22-08-2026
  - ouverture Mayotte (YT, EUR, minor_unit=2) — M10, premier marché après le seed KM
- _out_ :
  - MarketContext navigation acheteur — déjà livré côté boutique (public/boutique/js/market-context.js, chantier hero H2/H3), contextuel et commutable, jamais lu par requireMarketScope
  - migration des 94 colonnes *_kmf existantes vers utils/currency.js — M5 livre l'outil de formatage, ne touche à aucune colonne ni aucun appelant existant ; renommer une colonne de montant en prod est un chantier séparé, à fort risque
  - conversion d'affichage KMF→EUR diaspora (public/boutique/js/b-utils.js#fmt(), taux de change détecté par fuseau horaire) — mécanisme distinct, non remplacé par la boundary devise (qui porte la devise RÉELLE d'un marché, pas une conversion). b-utils.js devient un ADAPTER de cette boundary en P2, jamais l'inverse
  - P4/P5 — documents contractuels lisant le snapshot P3, dashboards agrégation cross-market en EUR reference — non faits, dépendent de P3/P2 respectivement
  - devises de sourcing flottantes (USD/AED/CNY) — concern séparé par construction (freeze invariant 4/5), currency_parities ne les contient jamais
  - settlement et attribution économique par opérateur (entité différée, hors périmètre)
  - corridor framework (relation traversant les scopes, pas un axe d'ownership, hors périmètre)
  - wallet multi-market (hors périmètre)
  - product_market_offer (déclencheur = 1er marchand local, pas divergence de prix, hors périmètre)
  - formatage devise affiché (feature economic-engine / boundary devise M5, qui consomme minor_unit)

**Authority** : backend-core — doctrine gelée dans KOMERCE_MARKET_LAYER_FREEZE.md (2026-08-19, READY TO FREEZE). Toute extension du périmètre (settlement, corridor framework, entité opérateur) exige un nouveau freeze, pas une extension silencieuse de ce manifeste.

**Invariants** :
- markets est un référentiel pur — aucune colonne ni logique d'autorisation n'y est ajoutée
- ouvrir un marché est un INSERT dans une migration, jamais un ALTER TABLE
- operator_market_scopes (M1) = historique d'accès grain user, jamais source du settlement (grain organisation, différé)
- révocation d'un scope = UPDATE revoked_at, jamais DELETE — l'historique d'accès n'est pas reconstructible sinon
- MarketContext (parcours acheteur) est un contexte client commutable, jamais une autorisation
- requireMarketScope (M2) est résolu serveur depuis operator_market_scopes, jamais depuis un market_id fourni par le client
- relais.market_id (M1b) est NOT NULL — un relais est un lieu physique, il ne peut pas exister sans marché
- orders.market_id (M1c) est un SNAPSHOT résolu du relais au moment de la commande, jamais une FK vivante re-synchronisée
- orders.relais_id est NOT NULL dans le schéma (vérifié par exécution réelle, pas supposé) — aucune commande sans relais n'est possible, le backfill orders.market_id est donc total par construction
- toute migration de market qui touche une table possédée par une autre feature (ex: relais, logistics ; orders) ajoute une colonne ou un index, jamais une règle métier de cette autre feature
- forbidMarketId (validators/index.js) échoue fort (400, message explicite) plutôt que de compter sur stripUnknown pour retirer market_id silencieusement d'un payload client
- scripts/check-no-market-id-mutation.js est un gate, pas une convention documentée : un market_id mutable non gardé dans validators/*.js fait échouer la CI
- utils/currency.js#getMarketCurrency throw si le marché n'existe pas — jamais de devise par défaut silencieuse
- utils/currency.js#formatAmount suppose un montant déjà dans l'unité affichée (12500, pas 1250000 sous-unité) — cohérent avec les colonnes *_kmf existantes, jamais une convention cents inventée sans besoin réel
- M10 (ouverture Mayotte) est un INSERT seul — vérifié réellement : 0 fichier de M1/M1b/M1c/M2/M5 modifié pour ouvrir ce marché, cf. tests/integration/market-open-mayotte.test.js
- reference_currency = EUR (canonique de la Currency Boundary), structurellement distinct de economic_engine_base_currency = KMF (economic-engine, inchangé) — ne jamais confondre les deux (freeze P1, 22-08-2026)
- invariant 9 : aucune paire directe entre deux devises Zone franc (KMF↔XAF) n'est jamais stockée ni calculée comme telle — toute conversion se dérive de deux parités vers EUR au moment du calcul, cf. currency_parities et projectAmount()
- currency_parities est la SEULE source de parités — aucune parité ne peut être maintenue manuellement dans un second artefact applicatif (server.js et b-utils.js consomment via adapter, ne portent jamais leur propre valeur)
- la Currency Boundary possède la règle monétaire ; utils/currency.js (serveur) et b-utils.js (client, P2) en sont les adapters, jamais des propriétaires concurrents de la règle
- aucune devise de sourcing flottante (USD/AED/CNY) dans currency_parities — absence par construction, pas par oubli (freeze invariants 4/5)
- P2 : b-utils.js#fmt(amount, "KMF") ne force plus un affichage KMF littéral depuis le 22-08-2026 — "KMF" est devenu l'alias "projette vers le marché courant" (résolu via market-context.js, override ?market= inclus). Toute AUTRE devise explicite (ex. "EUR") garde le comportement littéral historique, forcé, ignore le marché. Les 33 appels existants de fmt(x, "KMF") n'ont pas été modifiés — ils héritent du nouveau comportement automatiquement. Quiconque lit un de ces appels doit savoir que "KMF" ne veut plus dire "force KMF"
- P2 : fmt()/fmtPrice() restent SYNCHRONES (33 appelants dans des boucles de rendu) — la projection consomme un snapshot déjà chargé (fetch unique au chargement du module, jamais un round-trip par appel). Avant résolution du fetch (fenêtre courte, ou en cas d'échec réseau), repli sur l'affichage KMF brut — jamais un montant faux ni une exception
- P3 : orders.total_kmf/total_eur (Payment Boundary, finance_config) sont STRICTEMENT INCHANGÉS — Stripe, PayPal et cash_relais lisent exclusivement ces deux colonnes, jamais display_total_amount/display_currency. Les deux boundaries coexistent, jamais mélangées
- P3 : display_market_code (client, requête POST /api/orders) est un indice de CONTEXTE, jamais un montant, jamais une autorisation — le serveur calcule lui-même display_total_amount via projectAmount() (services/order-display-snapshot.js). Un code invalide ou absent ne bloque jamais la commande
- P3 : ne jamais supposer silencieusement que orders.market_id (celui du relais choisi) est le marché de navigation du client — display_market_code fait TOUJOURS foi s'il est valide ; relais.market_id n'est qu'un repli si aucun code n'a été fourni ou qu'il est invalide. Preuve en base : tests/integration/order-display-snapshot.test.js démontre une ligne où market_id (KM) ≠ display_currency (XAF)
- P3 : display_parity_snapshot (JSONB) est une métadonnée d'audit — la parité utilisée pour le calcul, jamais une source de vérité alternative. display_total_amount seul fait foi
- P3 : aucun recalcul ultérieur du display snapshot — figé à la création, comme total_kmf/total_eur. Pour les commandes antérieures à la migration 143, les 3 colonnes restent NULL — aucun backfill fabriqué (invariant 7 du freeze)
- P3 : resolveDisplaySnapshot() (services/order-display-snapshot.js) ne throw jamais — un échec de résolution retourne un snapshot vide, ne bloque jamais la création d'une commande. C'est une donnée d'audit/confirmation, pas une donnée de paiement
- P4 : correctif Payment Boundary trouvé pendant la cartographie P3 — services/invoice-service.js affichait "KMF" codé en dur sur toutes les factures, même en paiement EUR (Stripe/PayPal). Corrigé selon payment_mode, sans toucher currency_parities ni display_total_amount — ce n'est pas un chantier Currency Boundary, fichiers déclarés dans documents.feature.js (migrations/144_invoices_total_eur.sql), pas ici

**Owns** : `currency_parities`, `markets`, `operator_market_scopes`

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), market-operator-dashboard (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 22 fichier(s) déclaré(s)
  - migrations : 9
  - services : 3
  - tests : 10

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="market"]_

## market-autonomy

**Kind** : business-feature  ·  **Status** : staging

**Service** : Permettre à un responsable pays explicitement scopé manager de décider un prix local, d’en voir l’impact économique, puis de l’activer sans approbation centrale lorsque les gates autorisent la position ; LOCAL_ACTIVE devient alors la seule vérité locale consommable par le buyer path.

**Perimeter** :
- _in_ :
  - décision de prix commercial locale par market_id + product_id
  - devise résolue exclusivement depuis le marché serveur
  - audit append-only SET/RESET/AUTHORIZE/ACTIVATE de la décision locale
  - preview économique CDR + couverture marché avant activation
  - transition DRAFT_PENDING_GATE -> LOCAL_AUTHORIZED_PENDING_CUTOVER -> LOCAL_ACTIVE
  - projection du prix LOCAL_ACTIVE vers le KMF canonique sans modifier products.price_kmf
  - consommation LOCAL_ACTIVE par catalogue, liste partagée et checkout via boundary propriétaire
  - refus fail-closed si une granularité SKU/variante explicite entrerait en conflit
  - projection manager/viewer de la capacité réellement disponible
  - surface Canonical de test de l’autonomie pays
  - surface équipe pays intégrée : lecture, invitation, délégation et révocation de capabilities, dont provider.manage lorsqu’il est LIVE
  - parcours explicite d’acceptation d’invitation avec retour vers le Market ID résolu côté serveur
  - politique de protection des encaissements intégrée à Autonomie pays : cash actif/suspendu et validation SINGLE/DUAL_ALWAYS
- _out_ :
  - mutation de products.price_kmf global
  - validation humaine centrale de la stratégie commerciale pays
  - création/activation d’un marché
  - settlement et mouvements financiers
  - rôles terrain implicites
  - prix local par SKU — tant que cette granularité n’est pas modélisée explicitement

**Authority** : backend-core — la stratégie locale appartient au manager du marché ; le moteur économique peut refuser une activation destructive ou sous-couverte non autorisée, mais aucun admin central ne valide le choix commercial pays.

**Invariants** :
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]

**Owns** : `product_market_price_draft_events`, `product_market_price_drafts`

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : catalog (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), market-operator-dashboard (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (2) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "auth-identity" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "market-delegation" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 18 fichier(s) déclaré(s)
  - dash : 8
  - migrations : 1
  - services : 4
  - tests : 5

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="market-autonomy"]_

## market-delegation

**Kind** : business-feature  ·  **Status** : staging

**Service** : Déléguer de façon explicite, auditable et révocable l’autorité d’exploitation d’un Market ID à un opérateur principal et à son équipe, tout en préservant les frontières GROUP de Komerce.

**Perimeter** :
- _in_ :
  - capability_registry : registre exécutable DELEGATION / EXECUTION / BOUNDARY
  - Market Operating Assignment : mandat unique actif par Market ID
  - ceiling template et plafond effectif concédé par le central
  - memberships et capabilities membres, toujours sous le plafond
  - règle de délégation : DELEGATION reste grant(member) ⊆ grant(grantor) ⊆ ceiling ; EXECUTION LIVE peut être accordé par team.grant sous ceiling sans devenir un droit du grantor
  - audit append-only des mutations de délégation
  - calcul déterministe de la projection vers operator_market_scopes, persistée exclusivement par la boundary de la feature market
  - autonomy_rate calculé uniquement sur la classe DELEGATION
  - LOT 1A : lecture équipe, invitation, acceptation, modification capabilities et révocation par capabilities team.*
  - invitation persistée 72 h par défaut, token brut jamais stocké et capabilities revalidées à l’acceptation
  - anti-lockout : la dernière membership possédant team.grant ne peut pas être retirée silencieusement
  - adoption legacy : scopes actifs convertis en assignments/memberships, manager vers DELEGATION LIVE et viewer vers whitelist read-only
  - bridge runtime request-local : une membership active déjà projetée peut satisfaire market_operator uniquement sur les routes qui admettent explicitement ce rôle
  - reprojection transactionnelle après création, acceptation, modification de capabilities ou révocation de membership
  - politique cash partenaire par assignment : activation/désactivation et SINGLE ou DUAL_ALWAYS
  - LOT 2A : réseau local (relais) — création, modification, suspension et réactivation par capabilities network.*, jamais de hard-delete
  - un relais reste rattaché à son marché d’origine ; toute tentative de lecture/écriture cross-market échoue en 404, sans confirmer l’existence de la ressource sur un autre marché
  - un provider reste rattaché à son marché d’origine ; provider.manage ne permet jamais une réassignation cross-market et les mutations passent par providers-services, lifecycle owner
  - LOT 4 (écriture) : décision d’exposition produit x marché — capability catalog.expose, upsert auditable sur product_market_exposure (catalog, lifecycle owner), jamais de SQL direct
  - LOT 4 (cutover lecture) : catalog.expose LIVE — migration 206 (snapshot, catalog) préserve exactement la visibilité storefront existante au moment du cutover ; migration 207 (activation, market-delegation) ouvre le droit d’agir sans jamais toucher l’exposition elle-même ; séparation stricte entre les deux, vérifiée par test
  - LOT 7 (structure-event) : structure.event.record — un opérateur pays enregistre un fait MARKET_DIRECT de charge structurelle pour son propre marché via le writer canonique economic-engine (recordStructureCostEvent), jamais un GROUP, jamais un market_id choisi, jamais de SQL direct sur economic_structure_cost_events
  - migration 210 : promotion LIVE de structure.event.record backfillée sur les assignments actifs (ceiling) et les managers déjà reconnus (team.grant + team.revoke + network.read), jamais un élargissement aux viewers ; ne crée jamais d’événement économique
  - LOT 4 (local-offer) : exposition commerciale des services/offres physiques déjà créés — capability local_offer.manage, toggle ENABLED/DISABLED sur services.commercial_exposure et physical_offers.commercial_exposure (providers-services, lifecycle owner), jamais de SQL direct, jamais de suppression
  - un service ou une offre physique reste rattaché à son marché d’origine ; toute tentative cross-market échoue en 404, sans confirmer l’existence de la ressource
  - migration 204 : promotion LIVE de local_offer.manage backfillée sur les assignments actifs (ceiling) et les managers déjà reconnus (team.grant + team.revoke + network.read), jamais un élargissement aux viewers
  - LOT 5 (client-case) : workflow de litige (disputes) — capability client.case.handle, transitions open/processing/resolved/closed et note de résolution via dispute-mutation-service.js (orders, lifecycle owner), jamais refund_kmf/refund_eur
  - un litige reste rattaché à son marché d’origine (via order_id → orders.market_id) ; toute tentative cross-market échoue en 404, sans confirmer l’existence de la ressource
  - migration 205 : promotion LIVE de client.case.handle backfillée sur les assignments actifs (ceiling) et les managers déjà reconnus (team.grant + team.revoke + network.read), jamais un élargissement aux viewers ; la migration elle-même n’écrit jamais refund_kmf/refund_eur
  - LOT 6 (settlement) : lecture via finance.read, READY -> REQUESTED via finance.act et PAID -> RECEIVED via settlement.receive ; market-delegation autorise et audite mais la feature settlement possède market_settlements et les écritures
  - migration 209 : finance.act + settlement.receive deviennent LIVE et sont backfillées dans les ceilings actifs ; auto-grant seulement aux managers déjà dotés de team.grant + team.revoke + finance.read
  - LOT 8 (execution bridge) : les 7 capabilities execution.* LIVE entrent dans le ceiling/template sans auto-grant manager ; team.grant peut les déléguer explicitement à un membre terrain et chaque consommation est auditée avant la mutation métier
- _out_ :
  - référentiel markets, Currency Boundary et persistance operator_market_scopes : feature market
  - rôle global users.role et user.role.set : frontière auth-identity/GROUP, jamais déléguée au partenaire
  - règles d’allocation GROUP et vérité économique consolidée : economic-engine
  - fonctions Hub/transit mutualisées : hors Market Operating Assignment
  - providers/relais comme principaux locaux secondaires : jamais des assignments concurrents ; leur gestion locale reste déléguable sans transformer leur identité en user_role
  - lecture publique du réseau relais (GET /api/relais) et son cycle de vie technique hors délégation : feature logistics, propriétaire de la table relais
  - routage inter-îles KM (island/island_code consommés par services/routing.js) : hors périmètre, couplage géographique pré-existant non résolu par cette feature
  - catalogue global (products) : feature catalog, jamais modifié par cette feature — product_market_exposure n’est qu’une projection
  - câblage du chemin de lecture storefront (catalog-public-view.js / catalog-product-detail.js) : feature catalog, propriétaire de publicCatalogVisibilitySql() et de la logique de résolution marché ; market-delegation ne fait qu’autoriser/auditer la décision d’exposition qui alimente cette lecture
  - calcul automatique commission/revenue_share et payout bancaire/Mobile Money : hors LOT 6 ; la feature settlement ne fait qu’attester/tracer le cycle sans inventer de formule ni déclencher de transfert
  - vérité d’encaissement et état de double confirmation : feature payments
  - contrat juridique partenaire complet : hors backend, seule sa projection exécutable pourra entrer plus tard
  - montant et décision de remboursement (disputes.refund_kmf/disputes.refund_eur) : feature refunds, jamais délégable — vérité financière irréversible. client.case.handle ne pilote que le workflow (statut, résolution textuelle), jamais le chiffre
  - cycle de vie status (draft/active/suspended) des services et offres physiques : hors périmètre de local_offer.manage, qui ne bascule que commercial_exposure ; isServiceExposable/isPhysicalOfferExposable continuent d’exiger les deux (status ET exposure) — providers-services reste propriétaire du cycle complet
  - création READY, choix amount/currency et passage REQUESTED -> PAID : jamais une autorité de l’opérateur pays ; READY et PAID restent centraux dans la feature settlement

**Authority** : backend-core — cette feature possède la délégation d’autorité marché et son équipe ; elle ne possède ni le référentiel market, ni operator_market_scopes, ni users.role, ni les règles GROUP, ni les fonctions terrain mutualisées, ni la vérité monétaire du settlement.

**Invariants** :
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]

**Owns** : `assignment_capability_ceiling`, `assignment_memberships`, `capability_registry`, `ceiling_template_capabilities`, `ceiling_templates`, `market_cash_control_policies`, `market_delegation_audit`, `market_operating_assignments`, `market_team_invitations`, `membership_capabilities`

**Exposes** : 33 internal API(s), 0 HTTP interface(s)
  - `acceptInvitation` (services/market-delegation-team-service.js) — resolved
  - `addMembership` (services/market-delegation-service.js) — resolved
  - `attachMarketDelegatedRoleFor` (middleware/require-market-delegated-role.js) — resolved
  - `confirmSettlementReceived` (services/market-delegation-settlement-service.js) — resolved
  - `createProvider` (services/market-delegation-provider-service.js) — resolved
  - `createRelais` (services/market-delegation-network-service.js) — resolved
  - `grantMembershipCapabilities` (services/market-delegation-service.js) — resolved
  - `inviteTeamMember` (services/market-delegation-team-service.js) — resolved
  - `listDisputes` (services/market-delegation-client-case-service.js) — resolved
  - `listExposure` (services/market-delegation-catalog-service.js) — resolved
  - _...23 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 65 fichier(s) déclaré(s)
  - middleware : 2
  - migrations : 15
  - routes : 10
  - services : 13
  - tests : 25

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="market-delegation"]_

## market-operator-dashboard

**Kind** : unclassified  ·  **Status** : staging

**Service** : Permettre à un opérateur pays (market_operator) de se connecter au dashboard Canonical, de décider et exploiter son marché : KPIs, commandes, catalogue pays, pricing local, réseau Hub/Relais, douane, expéditions et Finance pays — sans jamais voir les données d'un autre marché ni recevoir automatiquement les gestes physiques ou autorités globales des rôles spécialisés.

**Perimeter** :
- _in_ :
  - Operations Workspace (routes/admin-operations-workspace.js, possédé par `dashboard`) : pilotage Hub/Relais market-scoped ; mutations terrain restent agent_hub/agent_relais selon capability
  - Catalogue pays : exposition/configuration produit × marché via les primitives market-scoped ; aucune mutation de la vérité catalogue globale
  - Expéditions & Douane : visibilité, supervision et configuration du marché ; gestes physiques/transit spécialisés restent soumis aux capabilities dédiées
  - Finance pays : recettes, coûts, marges, rapprochements, justificatifs et configuration locale livrée ; actes comptables sensibles restent explicitement délégués
  - Navigation Canonical : domaines visibles selon responsibilities/capabilities effectives, jamais selon une simple promesse UI
  - Remontage navigation après résolution async de la session pour appliquer le filtrage rôle/capability
  - Script CLI provision-market-operator.js : création utilisateur + scope atomique, idempotent
  - Script CLI seed-market-test-data.js : banc staging strictement Market ID pour catalogue, pricing et commandes de recette pays
  - Parcours complet cible : login → context → dashboards scopés → Catalogue pays → Atelier → Commandes → Opérations/Douane/Expéditions → Finance pays → équipe/partners
- _out_ :
  - Dashboard Legacy (admin/) — gelé, market_operator volontairement exclu de ROLE_SHELLS
  - Catalogue GLOBAL / vérité produit globale / requireCatalogGlobalAuthority — reste une autorité centrale ; ne pas confondre avec Catalogue pays
  - Mutations Hub physiques (scan, pack, seal, ship) — capacités spécialisées agent_hub/admin sauf délégation future explicite
  - Mutations terrain relais (réception, remise, cash) — capacités spécialisées agent_relais/admin sauf délégation future explicite
  - Actes comptables globaux, consolidation cross-market et autorités financières centrales — hors délégation pays
  - Sourcing global — reste séparé tant que sa délégation pays n'est pas explicitement décidée
  - Pricing mutations globales (apply strategy, update competitor global) — réservées aux autorités correspondantes ; la décision locale reste au pays
  - Refacturation multi-marché (Railway, Hub fixe) — chantier séparé, dépend du ratio de couverture
  - Ratio de couverture par marché — chantier pricing Phase 3d, pas ce lot

**Authority** : backend-core — tout changement de rôle ou de scope marché sur cette surface doit être validé par le propriétaire de middleware/require-market-scope.js.

**Invariants** :
- Le scope serveur est l'autorité — le navigateur ne choisit jamais son marché
- Un market_operator sans scope actif dans operator_market_scopes n'accède à rien
- Le Responsable pays doit disposer des outils correspondant à sa responsabilité : Catalogue pays, Atelier, Commandes, Opérations, Douane, Expéditions et Finance pays
- Un guard actuellement trop restrictif sur une responsabilité cible est un gap d'implémentation à fermer, pas une justification pour retirer cette responsabilité de la doctrine
- Catalogue pays ne peut jamais modifier silencieusement la vérité catalogue globale
- Les mutations physiques Hub (scan/pack/seal/ship) restent exclusivement derrière des capabilities terrain explicites
- Les mutations terrain relais (réception/remise/cash) restent exclusivement derrière des capabilities terrain explicites
- Finance pays ne donne jamais implicitement une autorité comptable globale ou cross-market
- Les utility links d'autorité globale sont masqués pour les profils non autorisés
- agent_hub garde les droits Hub correspondant à son périmètre opérationnel
- agent_relais reste limité à son relais_id physique pour ses gestes terrain
- Le dashboard Legacy (admin/) ne reçoit jamais market_operator dans ROLE_SHELLS — il est gelé
- Le provisioning est idempotent — ne recrée ni user ni scope existant
- Le seed staging ne crée, n'expose ni ne nettoie jamais une donnée d'un autre Market ID
- Le seed staging ne fabrique jamais un prix LOCAL_ACTIVE sans passage par le gate économique canonique

**Owns** : _aucune_

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 4
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (4) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "auth" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "dashboard" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "logistics" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "orders" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 5 fichier(s) déclaré(s)
  - scripts : 2
  - tests : 3

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="market-operator-dashboard"]_

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
- le WhatsApp de disponibilité peut enrichir son message existant d un unique lien cartographique dérivé du nom et de l adresse publics du relais ; aucun second message n est émis

**Owns** : `alerts`, `client_notifications`, `notification_log`

**Exposes** : 9 internal API(s), 6 HTTP interface(s)
  - `buildRelayMapUrl / formatRelayPoint / appendRelayLocation` (services/notifications/relay-location.js) — resolved
  - `createAlert` (utils/alerts.js) — resolved
  - `emitOrderMilestone / emitExceptional / resolveOrderMilestones` (services/client-notification-service.js) — resolved
  - `notifyLoyaltyEarned` (services/notifications/loyalty.js) — resolved
  - `notifyOrder*` (services/notifications/order.js) — resolved
  - `notifyParcel*` (services/notifications/parcel.js) — resolved
  - `notifyText` (services/notifications/misc.js) — resolved
  - `sendOtpMessage / sendMagicLink` (services/notifications/otp-auth.js) — resolved
  - `setNotificationOutcomeListener` (services/notifications/internals.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟡 ATTENTION — gates: check:imports, fail: 0, warn: 1
  - [check:imports] 🟠 TEXT-GATE-DIAGNOSTIC — ⚠ js/b-notifications.js — 1 export(s) non consommé(s) :

**Architectural debt** : _aucune_

**Implementation** : 44 fichier(s) déclaré(s), boutique: 3 fichier(s)
  - migrations : 6
  - routes : 4
  - services : 13
  - tests : 19
  - utils : 2

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
  - workflow de litige (disputes) : statut open/processing/resolved/closed et note de résolution — services/dispute-mutation-service.js, jamais refund_kmf/refund_eur, qui restent hors de ce workflow (voir refunds ci-dessous)
- _out_ :
  - encaissement du paiement (feature payments)
  - logique panier partage (feature shared-cart, consommatrice d'orders)
  - remboursement (feature refunds, lecture seule sur orders) — le montant refund_kmf/refund_eur d'un litige n'est ni lu ni écrit par le workflow de statut, même quand le litige passe resolved/closed
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
- [object Object]
- transition de statut uniquement via order-status-machine.js
- annulation libere les achats fournisseurs lies dans la meme transaction via purchasing

**Owns** : `customs_history`, `disputes`, `order_comments`, `order_item_cost_imputations`, `order_items`, `order_status_history`, `orders`, `recipients`, `sms_log`

**Exposes** : 30 internal API(s), 27 HTTP interface(s)
  - `appendOrderNote` (services/order-mutation-service.js) — resolved
  - `backfillRoutingFields` (services/order-mutation-service.js) — resolved
  - `checkoutCart` (public/boutique/js/b-checkout.js) — resolved
  - `finalizePickupCollection` (services/order-mutation-service.js) — resolved
  - `forcePaymentStatusForSimulation` (services/payment-service.js) — resolved
  - `makeInput` (public/boutique/js/b-checkout.js) — resolved
  - `markCashPaidAt` (services/order-mutation-service.js) — resolved
  - `markCashReminderSent` (services/order-mutation-service.js) — resolved
  - `markFailed` (services/payment-service.js) — resolved
  - `markPaid` (services/payment-service.js) — resolved
  - _...20 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 71 fichier(s) déclaré(s), boutique: 17 fichier(s)
  - boutique : 3
  - routes : 12
  - services : 17
  - tests : 38
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="orders"]_

## payments

**Kind** : business-feature  ·  **Status** : production

**Service** : Encaisser un paiement (carte, PayPal, Mobile Money, especes au retrait) et confirmer son etat de facon idempotente.

**Perimeter** :
- _in_ :
  - integration Stripe et PayPal (intent, capture, webhook, evenements)
  - Mobile Money multi-provider par marché (Orange Money CM, MTN MoMo CG, KartaPay KM vers MVola/Holo)
  - réconciliation périodique des paiements Mobile Money pending si callback perdu
  - paiement cash au retrait et relances cash
  - contrôle partagé de toute confirmation cash, avec option partenaire de double approbation par acteurs distincts
  - confirmation de paiement et idempotence webhook/callback
- _out_ :
  - creation de la commande elle-meme (feature orders)
  - orchestration du checkout boutique (projection frontend de orders)
  - remboursement (feature refunds, qui consomme payments en lecture)
  - credit wallet (feature wallet-loyalty)

**Authority** : backend-core — tout changement de provider, callback, webhook ou logique d idempotence paiement doit etre valide par le propriétaire payments.

**Invariants** :
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- aucun secret de paiement en dur dans le code
- [object Object]
- un provider activé en DB mais non configuré runtime reste indisponible (fail-closed, aucun fallback silencieux)
- [object Object]
- [object Object]
- [object Object]

**Owns** : `cash_collections`, `cash_confirmation_controls`, `cash_deposits`, `mobile_money_transactions`, `paypal_events_processed`, `stripe_events_processed`

**Exposes** : 0 internal API(s), 25 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 58 fichier(s) déclaré(s), boutique: 6 fichier(s)
  - boutique : 4
  - migrations : 5
  - routes : 5
  - services : 19
  - tests : 25

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

**Owns** : `fabrics`, `garment_models`
**Writes (not owner)** : `notification_log` (writer-not-owner), `parcel_items` (writer-not-owner), `parcels` (writer-not-owner), `scans` (writer-not-owner)

**Exposes** : 0 internal API(s), 33 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 1 test-only, 5 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🔴 BLOCKED — gates: check:css-specificity-guard, fail: 1, warn: 0
  - [check:css-specificity-guard] 🔴 TEXT-GATE-DIAGNOSTIC — ✖ 9 nouvel/nouveaux override(s) hors baseline.

**Architectural debt** : _aucune_

**Implementation** : 40 fichier(s) déclaré(s), boutique: 26 fichier(s)
  - boutique : 6
  - compositionRoots : 3
  - routes : 5
  - services : 6
  - tests : 20

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="platform-ops"]_

## providers-services

**Kind** : business-feature  ·  **Status** : staging

**Service** : Porter l’identité d’un provider tiers, ses services et offres physiques, leur exposabilité, leur nom public minimal, leurs médias publics optionnels et le cycle contextualisé de demande/rappel. La cible service_id XOR physical_offer_id porte toujours le propos connu ; le client choisit request ou callback. Aucun paiement, settlement, calendrier structuré, contact provider direct ou order Komerce n’est créé par cette interaction.

**Perimeter** :
- _in_ :
  - table providers (identité et contact privé, market, statut pending|active|suspended)
  - table services (prestation d’un provider, exposition DISABLED par défaut, image_ref public optionnel)
  - table physical_offers (produit physique tiers, image_ref public optionnel)
  - actions_enabled historiques sur service/physical_offer, projetées publiquement vers request et/ou callback
  - projection publique provider_name pour humaniser une fiche exposable sans exposer provider_id ni contact privé
  - table inquiries (cycle sent -> answered -> accepted|declined ; exactement une cible service_id XOR physical_offer_id)
  - intent request|callback et requester_note facultative : la note enrichit la cible sans jamais remplacer le propos connu
  - isServiceExposable() / isPhysicalOfferExposable() — provider actif + objet actif + exposition ENABLED + marché correspondant
  - POST /api/providers-services/inquiries — mutation client authentifiée, téléphone demandeur dérivé de la session canonique serveur
  - consumer Boutique des actions request/callback — identité Komerce puis création de l’Inquiry propriétaire
  - seed Discovery staging Anjouan — dataset déterministe, idempotent, strictement opt-in et impossible en production
  - seed modal V2 staging — cas sérieux pièce auto, plomberie, électricité, ciment et réception
  - listProviders(marketId) — lecture scopée marché, suspendus en dernier
  - getOwnedProvider(providerId, marketId) — null (jamais une erreur) si le provider existe sur un autre marché
  - updateProvider(providerId, marketId, patch) — coordonnées uniquement ; le marché n’est jamais réassignable par cette voie
  - listServicesForMarket(marketId) / listPhysicalOffersForMarket(marketId) — lecture scopée marché, masqués en dernier
  - getOwnedService(serviceId, marketId) / getOwnedPhysicalOffer(physicalOfferId, marketId) — null (jamais une erreur) si la ressource existe sur un autre marché
  - setServiceExposure(serviceId, marketId, exposure) / setPhysicalOfferExposure(physicalOfferId, marketId, exposure) — bascule commercial_exposure uniquement, jamais le status ; idempotent (changed:false sans écriture si déjà dans l’état demandé)
- _out_ :
  - authentification provider (pas de users / user_role pour le provider)
  - profil public provider riche, bio, téléphone, adresse exacte, métriques sociales ou comparaison de providers
  - exposition de providers.phone, public_phone ou public_whatsapp dans le détail client
  - appel direct tel: ou WhatsApp provider depuis la fiche Discovery
  - scheduler / créneaux structurés : requested_window/proposed_window restent du texte libre
  - paiement, commission, settlement, provider wallet
  - orders Komerce : request/callback créent une Inquiry, jamais une ligne orders
  - action order sur providers-services tant qu’aucun contrat orders explicite n’existe ; un Product Komerce continue d’utiliser le parcours product
  - market_offer / multi-offres / ranking
  - god-table Listing/Offer unifiée
  - prescription artisan et shared-cart
  - composition, ranking et ordre éditorial du rail Près de vous — owner recommendations
  - surface produit/catalogue et navigation — owner catalog
  - hébergement/stockage binaire des médias — image_ref reste une référence, pas un media service

**Authority** : backend-core — providers-services possède le cycle demande/confirmation, la projection request/callback, le nom public minimal du provider, les médias source service/physical_offer, le contexte Inquiry et ses données de démonstration staging ; recommendations ne fait que projeter ces lectures.

**Invariants** :
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]

**Owns** : `inquiries`, `physical_offers`, `providers`, `services`

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED)
**Consumed by** : market-delegation (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 19 fichier(s) déclaré(s), boutique: 4 fichier(s)
  - boutique : 2
  - ci : 1
  - migrations : 3
  - routes : 1
  - scripts : 2
  - services : 4
  - tests : 6

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="providers-services"]_

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
- tout message WhatsApp fournisseur part d un purchase_order déjà persisté ; un rejeu de notification ne recrée jamais le bon ni ne confirme son statut

**Owns** : `product_suppliers`, `purchase_orders`, `suppliers`

**Exposes** : 3 internal API(s), 10 HTTP interface(s)
  - `repairOrderedWithoutPurchaseOrders` (services/repair-ordered-without-purchase-orders.js) — resolved
  - `syncPurchaseOrdersOnOrderCancel` (services/purchasing-cancel-service.js) — resolved
  - `triggerPurchasing` (services/purchasing-trigger-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 18 fichier(s) déclaré(s)
  - routes : 1
  - services : 7
  - tests : 10

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="purchasing"]_

## recommendations

**Kind** : business-feature  ·  **Status** : staging

**Service** : Classer et suggérer des produits boutique selon un moteur de ranking dédié. Compose aussi en mémoire un rail Discovery local mixte (DiscoveryCard — Product Komerce, produit physique tiers, service tiers) et porte sa politique éditoriale d’activation serveur, sans jamais posséder ni cloner les données sources.

**Perimeter** :
- _in_ :
  - moteur de classement boutique
  - endpoint de suggestions
  - DiscoveryCard — projection de lecture mixte (product|physical_offer|service), jamais persistée
  - politique éditoriale serveur explicite du rail local : activation globale, candidats et ordre
  - surface read-only surface=local sur la façade /api/boutique/suggestions
- _out_ :
  - données produit source (feature catalog)
  - prix affiché (feature economic-engine)
  - vérité d’exposabilité stock/service/offre physique (local-stock / providers-services)
  - cycle Inquiry, paiement, réservation ou settlement
  - taxonomie ou navigation frontend parallèle pour le local

**Authority** : backend-core — recommendations possède le ranking et l’ordre éditorial du rail ; les features sources possèdent seules leur vérité métier et leur exposabilité.

**Invariants** :
- le ranking ne modifie jamais les données produit, lecture seule sur catalog
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]

**Owns** : _aucune_

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED)
**Consumed by** : infrastructure (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 11 fichier(s) déclaré(s), boutique: 6 fichier(s)
  - ci : 1
  - routes : 1
  - scripts : 1
  - services : 3
  - tests : 5

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="recommendations"]_

## refunds

**Kind** : business-transversal  ·  **Status** : production

**Service** : Rembourser un client de facon tracable et sans double remboursement, quel que soit le flux appelant.

**Perimeter** :
- _in_ :
  - service de remboursement transverse et son orchestration
- _out_ :
  - credit wallet lui-meme (feature wallet, consommee ici)
  - reçu de remboursement document (feature documents, consommee ici)

**Authority** : backend-core — tout changement de logique de remboursement doit etre valide par le proprietaire de refund-service.js

**Invariants** :
- un remboursement n'est jamais applique deux fois pour le meme evenement source
- tout refund externe ou crédit compensatoire est idempotent par événement source ; un rejeu ne déclenche jamais un second remboursement

**Owns** : `refunds`

**Exposes** : 1 internal API(s), 0 HTTP interface(s)
  - `processRefund(orderOrCartId, reason)`  — documented-signature-no-file

**Consumes** : documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 2 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 6 fichier(s) déclaré(s)
  - services : 1
  - tests : 4
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="refunds"]_

## settlement

**Kind** : business-feature  ·  **Status** : staging

**Service** : Tracer de bout en bout le règlement dû à un opérateur pays : READY attesté centralement, REQUESTED par le pays, PAID centralement, RECEIVED par le pays.

**Perimeter** :
- _in_ :
  - market_settlements : snapshot monétaire amount + currency immuable, rattaché au Market Operating Assignment et jamais supprimé
  - market_settlement_events : journal strictement append-only READY_ATTESTED / REQUESTED / PAID / RECEIVED
  - création READY exclusivement par acteur central admin/finance, montant explicitement attesté et devise dérivée du marché côté serveur
  - machine stricte READY -> REQUESTED -> PAID -> RECEIVED, également protégée par trigger DB
  - boundary lifecycle interne consommée par market-delegation pour REQUESTED et RECEIVED
- _out_ :
  - promotion des capabilities finance.act + settlement.receive : migration 209 possédée par market-delegation, pas par ce slice lifecycle
  - route et service d’orchestration délégués : propriété market-delegation ; settlement ne revendique que la boundary lifecycle
  - calcul automatique du montant dû : aucune règle commission/margin_share/revenue_share fiable n’existe encore dans le code
  - payout bancaire ou Mobile Money : aucun transfert externe n’est initié par cette feature dans ce lot
  - choix de devise par le navigateur : currency vient toujours de markets.currency
  - modification d’un READY existant : amount/currency/assignment/source sont immuables ; une correction future crée une nouvelle attestation, jamais un UPDATE silencieux
  - suppression destructive d’un settlement ou réécriture d’un événement financier : interdites au niveau DB
  - refund client : feature refunds, totalement distincte du settlement opérateur
  - réconciliation cash terrain -> Komerce : feature payments/dashboard, flux économique inverse et distinct
  - configuration générale du marché : market_config.update reste hors périmètre

**Authority** : backend-core — toute modification de amount/currency, de la machine de statut ou du sens de PAID exige une décision financière explicite ; finance.act ne doit jamais devenir un payout implicite.

**Invariants** :
- READY signifie montant attesté par l’autorité centrale, jamais montant calculé implicitement par Komerce
- amount, currency, market_id, assignment_id et provenance de l’attestation sont immuables après création
- currency est dérivée de markets.currency côté serveur et vérifiée en DB ; aucun client ne choisit la devise
- la boundary lifecycle ne connaît aucun rôle pays : l’autorisation finance.act / settlement.receive reste dans market-delegation
- seul le central peut faire REQUESTED -> PAID et une payment_reference est obligatoire
- market_settlements ne peut jamais être supprimé ; une correction crée une nouvelle attestation
- market_settlement_events est append-only : UPDATE et DELETE bloqués par trigger DB
- la migration d’activation des capabilities ne crée ni ne modifie aucune vérité market_settlements

**Owns** : `market_settlement_events`, `market_settlements`

**Exposes** : 5 internal API(s), 0 HTTP interface(s)
  - `confirmReceived()`  — documented-signature-no-file
  - `createReadySettlement()`  — documented-signature-no-file
  - `listForAssignment()`  — documented-signature-no-file
  - `markPaid()`  — documented-signature-no-file
  - `requestSettlement()`  — documented-signature-no-file

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED)
**Consumed by** : market-delegation (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 7 fichier(s) déclaré(s)
  - migrations : 1
  - routes : 1
  - services : 1
  - tests : 4

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="settlement"]_

## shared-cart

**Kind** : business-feature  ·  **Status** : production

**Service** : Permettre à un créateur de publier une liste immuable par lien public ; chaque acheteur sélectionne une ou plusieurs lignes disponibles, passe par le récapitulatif puis le checkout canonique sans mélanger son panier personnel ; la liste se ferme automatiquement lorsque sa dernière ligne est réclamée.

**Perimeter** :
- _in_ :
  - création puis publication immuable, fermeture explicite ou automatique et annulation de la liste partagée
  - lecture publique et propriétaire (avec statut de réclamation dérivé par jointure)
  - réconciliation de complétion : dernière ligne réclamée => OPEN -> CLOSED
- _out_ :
  - paiement carte/PayPal/cash (feature payments, consommée en sortie)
  - arbitrage de la réclamation d'un article (index unique order_items.shared_cart_item_id, migration 123 — feature orders)
  - création de la commande (feature orders)
  - crédit wallet (feature wallet)

**Authority** : backend-core — le domaine shared-cart est seul autorisé à écrire son lifecycle : close/cancel explicites via shared-cart-lifecycle.js ; fermeture automatique de complétion via la frontière cross-feature cart-share-service.js appelée par orders.

**Invariants** :
- une liste publiée est un snapshot structurellement immuable : OPEN signifie achetable, jamais éditable
- tant que les listes V1 ne sont pas nommables, un créateur possède au maximum une liste OPEN
- Mon panier reste indépendant ; une seule liste OPEN peut occuper le slot partagé local
- une sélection de liste est locale, ne réserve rien et passe toujours par récapitulatif puis checkout canonique
- une commande porte soit sur PERSONAL_CART soit sur SHARED_LIST, jamais les deux
- un article de liste n'est jamais réclamable deux fois — arbitré par index unique, pas par verrou applicatif (migration 123)
- dès que toutes les lignes possèdent un order_items.shared_cart_item_id, la liste passe automatiquement OPEN -> CLOSED ; aucun état observable 100% réclamé + OPEN
- aucune donnée financière n'est stockée sur shared_carts — le total se calcule toujours par SUM() sur shared_cart_items
- lien partagé ouvre une boutique — jamais un guichet de paiement (Boutique First)
- annulation de liste (cancel) n'effectue jamais de remboursement — aucune contribution n'y transite

**Owns** : `basket_items`, `baskets`, `cart_shares`, `shared_cart_events`, `shared_cart_items`, `shared_cart_saved_access`, `shared_carts`

**Exposes** : 3 internal API(s), 16 HTTP interface(s)
  - `closeCompletedSharedCartForOrderItems` (services/cart-share-service.js) — resolved
  - `deleteUserBasketData` (services/shared-cart-user-cleanup.js) — resolved
  - `markShareConvertedToOrder` (services/cart-share-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 58 fichier(s) déclaré(s), boutique: 18 fichier(s)
  - boutique : 10
  - dash : 1
  - migrations : 20
  - routes : 4
  - services : 9
  - tests : 14

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

**Exposes** : 2 internal API(s), 23 HTTP interface(s)
  - `archiveMissingCandidatesFromCatalogImport` (services/sourcing-candidate-import-service.js) — resolved
  - `upsertCandidateFromCatalogImport` (services/sourcing-candidate-import-service.js) — resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 17 fichier(s) déclaré(s)
  - middleware : 1
  - migrations : 5
  - routes : 2
  - services : 3
  - tests : 6

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

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

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

**Exposes** : 0 internal API(s), 9 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED)

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
  - services : 1
  - tests : 4

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
