# FEATURE 360

_Projection déterministe de lecture au-dessus de la chaîne Feature First O2-O7.3 déjà gouvernée. Feature 360 ne crée aucune nouvelle vérité architecturale ; toute correction se fait dans la source autoritaire existante._

## Global scorecard

- Features : **40**
- Healthy : **34**
- Attention : **6**
- Blocked : **0**
- Business dependencies : **338**
- Direct cross-feature imports : **0**
- Runtime cycles : **0**
- Ambiguous ownership signals : **0**
- Ontology gaps : **0**
- Debt items (total) : **10**
- Gate health — healthy : **37** · blocked : **2**

## Gate findings — intégrité de projection

- Source : `docs/GATE_FINDINGS.json` (version GF-3.0)
- Sources de gates : **18** (0 en échec)
- Findings : **5** total, **5** attribué(s), **0** sans attribution exploitable
- Fichiers non projetables : **0**
- Fichiers multi-projetés : **0**

## Features

| Feature | Kind | Boundary | Governance | Owns | Consumes | Consumed by | Debt |
|---|---|---|---|---|---|---|---|
| admin-dashboard | projection | 🟡 ATTENTION | 🟢 HEALTHY | _aucune_ | catalog, customs, dashboard, decision-signals, documents, economic-engine, inventory, logistics, orders, payments | _aucune_ | 1 |
| auth | technical-transversal | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | auth-identity, infrastructure, notifications | auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, infrastructure, inventory, logistics, loyalty, market-control-plane, market-delegation, notifications, orders, payments, platform-ops, providers-services, purchasing, settlement, shared-cart, sourcing, unsold-resolution, wallet | 0 |
| auth-identity | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | credential_action_tokens, otp_codes, revoked_tokens, user_pickup_authorizations, users | auth, auth-passkey, catalog, documents, infrastructure, logistics, loyalty, notifications, orders, platform-ops, wallet | auth, auth-passkey, business-rules, catalog, dashboard, documents, economic-engine, infrastructure, logistics, loyalty, market-delegation, notifications, orders, payments, platform-ops, providers-services, settlement, shared-cart, wallet | 0 |
| auth-passkey | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | webauthn_challenges, webauthn_credentials | auth, auth-identity, infrastructure, platform-ops | auth-identity | 0 |
| business-rules | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | business_rules, business_rules_history | auth, auth-identity, infrastructure | catalog, dashboard, decision-signals, economic-engine, logistics, orders, payments, platform-ops | 0 |
| catalog | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | boutique_categories, boutique_subcategories, catalog_enrichment_runs, catalog_field_overrides, catalog_field_sync_state, catalog_media, catalog_media_recovery_audit, catalog_media_visual_fr_reviews, catalog_product_quality_notes, catalog_product_sale_holds, catalog_publication_decision_audit, catalog_stock_sync_state, catalog_taxonomy_audit, catalog_terminology_reference, product_attributes, product_content_profile, product_content_sections, product_market_exposure, product_sku_media, product_skus, product_variants, products, supplier_catalog_import_rejections, supplier_catalog_imports, supplier_catalog_sync_checkpoints, supplier_oauth_connections | auth, auth-identity, business-rules, customs, economic-engine, external-provider-contracts, infrastructure, logistics, market, market-autonomy, notifications, orders, platform-ops, purchasing, shared-cart, sourcing, supplier-connectivity | admin-dashboard, auth-identity, customs, dashboard, documents, economic-engine, infrastructure, inventory, local-stock, logistics, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, orders, platform-ops, purchasing, recommendations, refunds, shared-cart, sourcing, unsold-resolution | 0 |
| customs | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | customs_categories, customs_shipment_fees, customs_shipment_parcel_events, customs_shipment_parcels, customs_shipments | auth, catalog, documents, economic-engine, infrastructure, logistics, market, orders | admin-dashboard, catalog, dashboard, documents, economic-engine, infrastructure, logistics, orders, sourcing | 0 |
| dashboard | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | customs_shipment_holds, order_incidents, partners | auth, auth-identity, business-rules, catalog, customs, decision-signals, documents, economic-engine, external-provider-contracts, incident-management, infrastructure, inventory, local-stock, logistics, market, market-autonomy, market-delegation, notifications, orders, payments, purchasing, refunds, shared-cart, sourcing, supplier-connectivity, wallet | admin-dashboard, decision-signals, economic-engine, infrastructure, market-control-plane, market-delegation, orders, sourcing | 0 |
| decision-signals | piloting-capability | 🟢 HEALTHY | 🟢 HEALTHY | signals | auth, business-rules, dashboard, economic-engine, infrastructure, logistics, market-delegation, payments, purchasing | admin-dashboard, dashboard, incident-management, market-control-plane, orders | 0 |
| documents | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | invoices, transaction_documents | auth, auth-identity, catalog, customs, infrastructure, logistics, orders, refunds, wallet | admin-dashboard, auth-identity, customs, dashboard, logistics, orders, payments, platform-ops, purchasing, refunds, wallet | 0 |
| economic-engine | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | charges, competitor_prices, cost_benchmarks, cost_component_events, cost_component_market_override_events, cost_component_market_overrides, cost_components, economic_risk_cost_events, economic_risk_watermark_events, economic_snapshots, economic_structure_cost_events, exchange_rates, finance_config, financial_movement_documents, financial_movements, international_n1_reconciliations, market_cost_attributions, market_price_observation_events, market_price_observations, order_cost_entry_events, order_item_real_cost_allocations, price_history, pricing_category_dims, pricing_category_taxes, pricing_components, pricing_market_decision_policy_events, pricing_matrices_audit, pricing_maturity_disposition_events, pricing_strategies, pricing_strategy_history, risk_provisions | auth, auth-identity, business-rules, catalog, customs, dashboard, infrastructure, local-stock, logistics, loyalty, market, market-autonomy, market-delegation, orders, platform-ops, refunds | admin-dashboard, catalog, customs, dashboard, decision-signals, infrastructure, loyalty, market-autonomy, market-control-plane, market-delegation, orders, platform-ops, purchasing, refunds, sourcing | 0 |
| external-provider-contracts | technical-transversal | 🟡 ATTENTION | 🟢 HEALTHY | _aucune_ | _aucune_ | catalog, dashboard, purchasing, supplier-connectivity | 1 |
| incident-management | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | incidents | decision-signals, infrastructure, logistics, orders | dashboard, logistics, notifications, orders, payments, platform-ops, purchasing, refunds | 0 |
| infrastructure | technical-foundation | 🟢 HEALTHY | 🟢 HEALTHY | outbox_events, physical_outcome_receipts, schema_migrations | auth, auth-identity, catalog, customs, dashboard, economic-engine, inventory, logistics, market, market-delegation, notifications, orders, payments, platform-ops, recommendations, shared-cart, wallet | auth, auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, inventory, local-stock, logistics, loyalty, market, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, notifications, orders, payments, platform-ops, providers-services, purchasing, recommendations, refunds, settlement, shared-cart, sourcing, unsold-resolution, wallet | 0 |
| inventory | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | inventory_items | auth, catalog, infrastructure, logistics, orders | admin-dashboard, dashboard, infrastructure | 0 |
| legacy-control-tower | deprecated | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| local-stock | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | local_stock, local_stock_allocations | catalog, infrastructure, logistics, market | dashboard, economic-engine, logistics, market-delegation, orders, providers-services, recommendations | 0 |
| logistics | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | carriers, hub_box_bags, hub_custody_events, hub_physical_unit_placements, hub_physical_units, hub_purchase_allocations, international_shipment_charges, international_shipment_events, international_shipment_hub_units, international_shipment_relay_receipts, international_shipments, market_transport_sale_rates, parcel_events, parcel_items, parcels, pickup_code_generations, pickup_collect_failures, pickup_print_tokens, pickup_reveal_codes, pickup_verify_attempts, product_sku_physical_codes, relais, relay_product_return_receipts, scan_events, scans, shipments | auth, auth-identity, business-rules, catalog, customs, documents, incident-management, infrastructure, local-stock, loyalty, market, market-delegation, notifications, orders, payments, purchasing, refunds | admin-dashboard, auth-identity, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, infrastructure, inventory, local-stock, market-control-plane, market-delegation, notifications, orders, payments, platform-ops, purchasing, recommendations, refunds | 0 |
| loyalty | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | loyalty_rewards, loyalty_tiers | auth, auth-identity, economic-engine, infrastructure, notifications, orders | auth-identity, economic-engine, logistics, orders, payments | 0 |
| market | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | currency_parities, fx_public_reference_quotes, fx_rate_observations, markets, operator_market_scopes | infrastructure, notifications | catalog, customs, dashboard, economic-engine, infrastructure, local-stock, logistics, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, orders, payments, providers-services, recommendations, refunds, settlement, wallet | 0 |
| market-autonomy | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | product_market_price_draft_events, product_market_price_drafts | catalog, economic-engine, infrastructure, market | catalog, dashboard, economic-engine, market-delegation, market-operator-dashboard, orders, recommendations, shared-cart | 2 |
| market-control-plane | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | market_delivery_attestations | auth, catalog, dashboard, decision-signals, economic-engine, infrastructure, logistics, market, market-delegation, orders, payments, sourcing | _aucune_ | 1 |
| market-delegation | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | assignment_capability_ceiling, assignment_memberships, capability_registry, ceiling_template_capabilities, ceiling_templates, market_cash_control_policies, market_delegation_audit, market_operating_assignments, market_team_invitations, membership_capabilities | auth, auth-identity, catalog, dashboard, economic-engine, infrastructure, local-stock, logistics, market, market-autonomy, orders, payments, providers-services, settlement | dashboard, decision-signals, economic-engine, infrastructure, logistics, market-control-plane, market-operator-dashboard, orders, payments, settlement, unsold-resolution | 0 |
| market-operator-dashboard | unclassified | 🟡 ATTENTION | 🟢 HEALTHY | _aucune_ | catalog, infrastructure, market, market-autonomy, market-delegation | _aucune_ | 4 |
| notifications | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | alerts, client_notifications, notification_log | auth, auth-identity, incident-management, infrastructure, logistics, orders, platform-ops | auth, auth-identity, catalog, dashboard, infrastructure, logistics, loyalty, market, orders, payments, purchasing, refunds, shared-cart | 0 |
| orders | business-feature | 🟡 ATTENTION | 🟢 HEALTHY | customs_history, disputes, order_checkout_idempotency, order_comments, order_delivery_waves, order_item_cost_imputations, order_items, order_status_history, orders, recipients, relay_return_compensations, sms_log | auth, auth-identity, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, infrastructure, local-stock, logistics, loyalty, market, market-autonomy, market-delegation, notifications, payments, platform-ops, purchasing, refunds, shared-cart, wallet | admin-dashboard, auth-identity, catalog, customs, dashboard, documents, economic-engine, incident-management, infrastructure, inventory, logistics, loyalty, market-control-plane, market-delegation, notifications, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, unsold-resolution, wallet | 1 |
| payments | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | cash_collections, cash_confirmation_controls, cash_custody_losses, cash_custody_receipts, cash_deposit_allocations, cash_deposits, market_cash_destinations, market_payment_accounts, market_payment_providers, mobile_money_transactions, paypal_events_processed, stripe_events_processed | auth, auth-identity, business-rules, documents, incident-management, infrastructure, logistics, loyalty, market, market-delegation, notifications, orders, platform-ops, purchasing, refunds | admin-dashboard, dashboard, decision-signals, infrastructure, logistics, market-control-plane, market-delegation, orders, refunds | 0 |
| platform | frontend-transversal | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| platform-ops | technical-transversal | 🟢 HEALTHY | 🟢 HEALTHY | fabrics, garment_models | auth, auth-identity, business-rules, catalog, documents, economic-engine, incident-management, infrastructure, logistics, orders, purchasing, wallet | auth-identity, auth-passkey, catalog, economic-engine, infrastructure, notifications, orders, payments, providers-services, recommendations, shared-cart, wallet | 0 |
| providers-services | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | inquiries, physical_offers, providers, services | auth, auth-identity, infrastructure, local-stock, market, platform-ops, recommendations | market-delegation, recommendations | 0 |
| purchasing | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | hub_authorization_grants, manual_purchase_executions, product_suppliers, purchase_lines, purchase_order_authorizations, purchase_orders, purchase_variance_decisions, supplier_execution_events, supplier_execution_fulfillments, supplier_execution_order_lines, supplier_execution_orders, supplier_execution_payment_proofs, supplier_execution_payments, supplier_payment_settlements, suppliers | auth, catalog, documents, economic-engine, external-provider-contracts, incident-management, infrastructure, logistics, notifications, orders, sourcing, supplier-connectivity | catalog, dashboard, decision-signals, logistics, orders, payments, platform-ops, refunds, sourcing | 0 |
| recommendations | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | catalog, infrastructure, local-stock, logistics, market, market-autonomy, orders, platform-ops, providers-services | infrastructure, providers-services, shared-cart | 0 |
| refunds | business-transversal | 🟢 HEALTHY | 🟢 HEALTHY | local_cash_refund_authorizations, local_cash_refund_payouts, local_item_refund_reservations, local_mobile_refund_handoffs, order_item_refund_reservations, refund_execution_intents, refunds | catalog, documents, economic-engine, incident-management, infrastructure, logistics, market, notifications, orders, payments, purchasing, wallet | dashboard, documents, economic-engine, logistics, orders, payments | 0 |
| settlement | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | market_settlement_events, market_settlements | auth, auth-identity, infrastructure, market, market-delegation | market-delegation | 0 |
| shared-cart | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | basket_items, baskets, cart_shares, shared_cart_events, shared_cart_items, shared_cart_saved_access, shared_carts | auth, auth-identity, catalog, infrastructure, market-autonomy, notifications, orders, platform-ops, recommendations | catalog, dashboard, infrastructure, orders | 0 |
| sourcing | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | import_runtime_item_events, import_runtime_runs, provider_credentials, sourcing_candidate_events, sourcing_candidates, sourcing_canonical_entities, sourcing_canonical_entity_refs, sourcing_captures, sourcing_match_proposals, sourcing_observation_evidence, sourcing_observations, sourcing_provider_control_events, sourcing_resolution_bindings, sourcing_resolution_decisions, sourcing_source_provides, sourcing_source_requests, sourcing_sources, supplier_commercial_category_mappings | auth, catalog, customs, dashboard, economic-engine, infrastructure, purchasing | catalog, dashboard, market-control-plane, purchasing | 0 |
| supplier-connectivity | integration-adapter | 🟢 HEALTHY | 🟢 HEALTHY | _aucune_ | external-provider-contracts | catalog, dashboard, purchasing | 0 |
| unsold-resolution | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | unsold_items | auth, catalog, infrastructure, market-delegation, orders | _aucune_ | 0 |
| wallet | business-feature | 🟢 HEALTHY | 🟢 HEALTHY | wallet_consumptions, wallet_credit_lots, wallet_transactions, wallets | auth, auth-identity, documents, infrastructure, market, orders, platform-ops | auth-identity, dashboard, documents, infrastructure, orders, platform-ops, refunds | 0 |
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

**Consumes** : catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟡 ATTENTION — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (1) :
- `DECLARED_NOT_OBSERVED` (low) — contract.consumes déclare "sourcing" — aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 38 fichier(s) déclaré(s)
  - js : 38

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
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market-control-plane (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 27 fichier(s) déclaré(s)
  - middleware : 7
  - tests : 16
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

**Owns** : `credential_action_tokens`, `otp_codes`, `revoked_tokens`, `user_pickup_authorizations`, `users`

**Exposes** : 13 internal API(s), 28 HTTP interface(s)
  - `anonymizeUser` (services/user-mutation-service.js) — resolved
  - `createAdminUser` (services/user-mutation-service.js) — resolved
  - `deleteNonAdminUsers` (services/user-mutation-service.js) — resolved
  - `deleteUser` (services/user-mutation-service.js) — resolved
  - `getActiveAuthorizationForUpdate` (services/pickup-authorization-service.js) — resolved
  - `hasActiveAuthorization` (services/pickup-authorization-service.js) — resolved
  - `incrementBigBasketCount` (services/user-mutation-service.js) — resolved
  - `makeIntlPhoneInput` (public/boutique/js/b-phone.js) — resolved
  - `markBigBasketNotified` (services/user-mutation-service.js) — resolved
  - `markUserPendingActivation` (services/user-mutation-service.js) — resolved
  - _...3 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : 🟢 HEALTHY — cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : 🟢 HEALTHY — orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : 🟢 HEALTHY — gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 36 fichier(s) déclaré(s), boutique: 5 fichier(s)
  - boutique : 3
  - migrations : 4
  - routes : 4
  - scripts : 1
  - services : 7
  - tests : 15
  - utils : 2

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

**Implementation** : 5 fichier(s) déclaré(s)
  - routes : 1
  - tests : 3
  - utils : 1

_Détails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json → features[id="business-rules"]_

## catalog

**Kind** : business-feature  ·  **Status** : production

**Service** : Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.

**Perimeter** :
- _in_ :
  - connecteurs fournisseurs (CSV, API, manuel, Noon, CJdropshipping, AliExpress, Allegro Sandbox, eBay Sandbox Browse enregistré dans le dispatch générique P3)
  - identité d’approvisionnement par produit : le canal MANUAL choisit un fournisseur réel enregistré ou, à défaut, le Fournisseur central Hub protégé ; cette identité reste distincte du vendeur externe, du provider et de Supplier Order Identity (migration 403)
  - les produits saisis par le Fournisseur central Hub portent un contrat source V2 explicite sans vendeur ni SKU ; l’identité réelle du vendeur et les SKU arrivent seulement à la confirmation d’achat
  - contrat source fournisseur versionne V1/V2 : brut integral + preservation explicite media, axes et unites vendables quand la source les connait
  - publication produit et déclenchement de l audit prix via economic-engine
  - categories boutique admin
  - catalogue vivant Boutique : grille, cartes produit, ouverture fiche produit
  - catalogue canonique : produit, medias publics, axes d options descriptifs et unites vendables SKU
  - contrat detail produit public v1 : identity, pricing, media, option_axes, sellable_units et delivery_options deja resolues par leurs autorites
  - projection des rails de livraison deja commercialement exposes par logistics, sans inventer prix ni delai
  - modal produit catalogue : un fetch Product Detail, un etat de selection SKU, deux compositions responsive mobile/desktop
  - raffinerie catalogue : donnee source EN conservee, eligibilite douane/transport (catalog_exclusions), enrichissement FR, overrides traces, approbation humaine unique
  - contrat de revue visuelle des medias source : preuve attachée à l’identité du média et à sa variante, texte incrusté présenté en FR si nécessaire, sans dépendance IA ni publication automatique ; une image canonique importée par le Hub reçoit une identité interne liée à son UUID média, jamais un faux identifiant fournisseur
  - produit manuel Fournisseur central Hub sans variantes : préparation explicite depuis l’inspecteur Catalogue d’une unité vendable interne par défaut, stock initial zéro, sans SKU ni identité fournisseur, avant la bascule SKU de l’approbation
  - recette propriétaire staging : revue Chromium automatisée explicitement attribuée au run GitHub et au compte authentifié sur candidats Sourcing TEST, y compris les médias manuels Hub ; jamais une attestation humaine, jamais recevable hors staging, jamais une publication sans geste explicite
  - projection par lot KIR : préparation Catalogue, publication et visibilité par marché depuis les produits réellement promus ; lecture seule, sans automatiser une décision
  - Catalogue global maître : registre paginé de toutes les fiches réellement remises depuis Sourcing/Raffinerie ; fournisseurs, taxonomie boutique, écarts actionnables et corrections par autorité sans confondre remise et vente
  - Catalogue pré-publication : contrôle canonique des prérequis candidat à la demande en lecture seule, sans déclencher de publication ni confondre approbation Catalogue, revue visuelle FR et décisions marchés
  - Catalogue global commercial : projection read-only de l assortiment approuve a la vente, compose uniquement des produits issus de KIR clos et possedant exposition ENABLED + prix LOCAL_ACTIVE sur au moins un marche ; drafts et lots ouverts restent hors de cette lecture
  - glossaire metier EN->FR (catalog_glossary)
  - mémoire terminologique externe sourcée et filtrée par corpus (catalog_terminology_reference), avec priorité au glossaire Komerce
  - challenge FR cold-start permanent : 100 produits CJ jamais vus, source exacte, enrichissement TERMIUM incrémental, aucune dépendance IA runtime et seconde revue obligatoire
  - campagne FR Quality branchée : traductions + reviews hashées → dry-run → application atomique en overrides manuels sur drafts inactifs → readiness → checkpoint, jamais de publication automatique
  - gate final Raffinerie→Catalogue : 974 candidats attendus, vérité source V2, médias, SKU/SOI complets, catégorie, file humaine, zéro exposition marché avant publication ; mode final exige en plus contenu FR revu + publication guard PASS
  - file d approbation admin (etage 6) : approve/reject/override en un ecran, seul point de validation humaine avant lifecycle_status=active ; chaque décision réussie est journalisée dans catalog_publication_decision_audit avec acteur et snapshots minimaux
  - bootstrap visuel CJ borné : 63 produits réels, médias fournisseur liés au lignage, exécution one-shot gardée
  - pool CJ de Raffinerie borné à 1000 références propres maximum, dédupliqué et reprenable, sans publication automatique
  - source Allegro Sandbox vendeur : offres exactes V2 en PLN, OAuth refresh chiffré sous verrou, aucun achat automatique
  - source AliExpress de stress-test Raffinerie : Open Platform Drop Shipping api-sg, OAuth serveur géré et chiffré, feed/detail normalisés V2, aucune publication automatique
  - pool AliExpress staging borné à 500 références réellement en stock, dédupliqué et reprenable, alimenté exclusivement via la Raffinerie et sans publication automatique
  - dataset E2E unifié 700 historique : 200 AliExpress validés + 500 CJ semantic-positive, cohabitant dans une base Railway isolée explicitement gardée, sans exposition marché ni publication automatique
  - dataset E2E réconcilié 712 : 200 AliExpress + 500 CJ historiques certifiés + 12 CJ nouveaux uniques, matérialisés par identité fournisseur exacte, taxonomie boutique dynamique active, SKU/SOI complets et zéro exposition marché
  - certification catalogue canonique v1 : provider-independent, versionnée et fail-closed ; un produit certifié possède source V2, taxonomie boutique catégorie+sous-catégorie active, média, SKU/SOI, contenu FR prêt, zéro exposition marché et publication guard PASS ; les datasets 700/712 sont des corpus de preuve et non la définition de la certification
  - chaque sous-catégorie boutique commerciale active déclare une affinité douanière administrable ; le produit fournisseur réel garde priorité et l affinité ne sert qu en fallback de proximi