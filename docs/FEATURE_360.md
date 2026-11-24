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
| inventory | business-fea