# FEATURE 360

_Projection dÃ©terministe de lecture au-dessus de la chaÃ®ne Feature First O2-O7.3 dÃ©jÃ  gouvernÃ©e. Feature 360 ne crÃ©e aucune nouvelle vÃ©ritÃ© architecturale ; toute correction se fait dans la source autoritaire existante._

## Global scorecard

- Features : **40**
- Healthy : **34**
- Attention : **6**
- Blocked : **0**
- Business dependencies : **335**
- Direct cross-feature imports : **0**
- Runtime cycles : **0**
- Ambiguous ownership signals : **0**
- Ontology gaps : **0**
- Debt items (total) : **10**
- Gate health â€” healthy : **37** Â· blocked : **2**

## Gate findings â€” intÃ©gritÃ© de projection

- Source : `docs/GATE_FINDINGS.json` (version GF-3.0)
- Sources de gates : **18** (0 en Ã©chec)
- Findings : **5** total, **5** attribuÃ©(s), **0** sans attribution exploitable
- Fichiers non projetables : **0**
- Fichiers multi-projetÃ©s : **0**

## Features

| Feature | Kind | Boundary | Governance | Owns | Consumes | Consumed by | Debt |
|---|---|---|---|---|---|---|---|
| admin-dashboard | projection | ğŸŸ¡ ATTENTION | ğŸŸ¢ HEALTHY | _aucune_ | catalog, customs, dashboard, decision-signals, documents, economic-engine, inventory, logistics, orders, payments | _aucune_ | 1 |
| auth | technical-transversal | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | _aucune_ | auth-identity, infrastructure, notifications | auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, infrastructure, inventory, logistics, loyalty, market-control-plane, market-delegation, notifications, orders, payments, platform-ops, providers-services, purchasing, settlement, shared-cart, sourcing, unsold-resolution, wallet | 0 |
| auth-identity | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | credential_action_tokens, otp_codes, revoked_tokens, user_pickup_authorizations, users | auth, auth-passkey, catalog, documents, infrastructure, logistics, loyalty, notifications, orders, platform-ops, wallet | auth, auth-passkey, business-rules, catalog, dashboard, documents, economic-engine, infrastructure, logistics, loyalty, market-delegation, notifications, orders, payments, platform-ops, providers-services, settlement, shared-cart, wallet | 0 |
| auth-passkey | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | webauthn_challenges, webauthn_credentials | auth, auth-identity, infrastructure, platform-ops | auth-identity | 0 |
| business-rules | business-transversal | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | business_rules, business_rules_history | auth, auth-identity, infrastructure | catalog, dashboard, decision-signals, economic-engine, logistics, orders, payments, platform-ops | 0 |
| catalog | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | boutique_categories, boutique_subcategories, catalog_enrichment_runs, catalog_field_overrides, catalog_field_sync_state, catalog_media, catalog_media_recovery_audit, catalog_media_visual_fr_reviews, catalog_product_quality_notes, catalog_product_sale_holds, catalog_publication_decision_audit, catalog_stock_sync_state, catalog_taxonomy_audit, catalog_terminology_reference, product_attributes, product_content_profile, product_content_sections, product_market_exposure, product_sku_media, product_skus, product_variants, products, supplier_catalog_import_rejections, supplier_catalog_imports, supplier_catalog_sync_checkpoints, supplier_oauth_connections | auth, auth-identity, business-rules, customs, economic-engine, external-provider-contracts, infrastructure, logistics, market, market-autonomy, notifications, orders, platform-ops, purchasing, shared-cart, sourcing, supplier-connectivity | admin-dashboard, auth-identity, customs, dashboard, documents, economic-engine, infrastructure, inventory, local-stock, logistics, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, orders, platform-ops, purchasing, recommendations, shared-cart, sourcing, unsold-resolution | 0 |
| customs | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | customs_categories, customs_shipment_fees, customs_shipment_parcel_events, customs_shipment_parcels, customs_shipments | auth, catalog, documents, economic-engine, infrastructure, logistics, market, orders | admin-dashboard, catalog, dashboard, documents, economic-engine, infrastructure, logistics, orders, sourcing | 0 |
| dashboard | business-transversal | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | customs_shipment_holds, order_incidents, partners | auth, auth-identity, business-rules, catalog, customs, decision-signals, documents, economic-engine, external-provider-contracts, incident-management, infrastructure, inventory, local-stock, logistics, market, market-autonomy, market-delegation, notifications, orders, payments, purchasing, refunds, shared-cart, sourcing, supplier-connectivity, wallet | admin-dashboard, decision-signals, economic-engine, infrastructure, market-control-plane, market-delegation, orders, sourcing | 0 |
| decision-signals | piloting-capability | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | signals | auth, business-rules, dashboard, economic-engine, infrastructure, logistics, market-delegation, payments, purchasing | admin-dashboard, dashboard, incident-management, market-control-plane, orders | 0 |
| documents | business-transversal | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | invoices, transaction_documents | auth, auth-identity, catalog, customs, infrastructure, logistics, orders, refunds, wallet | admin-dashboard, auth-identity, customs, dashboard, logistics, orders, payments, platform-ops, purchasing, refunds, wallet | 0 |
| economic-engine | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | charges, competitor_prices, cost_benchmarks, cost_component_events, cost_component_market_override_events, cost_component_market_overrides, cost_components, economic_risk_cost_events, economic_risk_watermark_events, economic_snapshots, economic_structure_cost_events, exchange_rates, finance_config, financial_movement_documents, financial_movements, international_n1_reconciliations, market_cost_attributions, market_price_observation_events, market_price_observations, order_cost_entry_events, order_item_real_cost_allocations, price_history, pricing_category_dims, pricing_category_taxes, pricing_components, pricing_market_decision_policy_events, pricing_matrices_audit, pricing_maturity_disposition_events, pricing_strategies, pricing_strategy_history, risk_provisions | auth, auth-identity, business-rules, catalog, customs, dashboard, infrastructure, local-stock, logistics, loyalty, market, market-autonomy, market-delegation, orders, platform-ops, refunds | admin-dashboard, catalog, customs, dashboard, decision-signals, infrastructure, loyalty, market-autonomy, market-control-plane, market-delegation, orders, platform-ops, purchasing, refunds, sourcing | 0 |
| external-provider-contracts | technical-transversal | ğŸŸ¡ ATTENTION | ğŸŸ¢ HEALTHY | _aucune_ | _aucune_ | catalog, dashboard, purchasing, supplier-connectivity | 1 |
| incident-management | business-transversal | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | incidents | decision-signals, infrastructure, logistics, orders | dashboard, logistics, notifications, orders, payments, platform-ops, purchasing | 0 |
| infrastructure | technical-foundation | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | outbox_events, physical_outcome_receipts, schema_migrations | auth, auth-identity, catalog, customs, dashboard, economic-engine, inventory, logistics, market, market-delegation, notifications, orders, payments, platform-ops, recommendations, shared-cart, wallet | auth, auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, inventory, local-stock, logistics, loyalty, market, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, notifications, orders, payments, platform-ops, providers-services, purchasing, recommendations, refunds, settlement, shared-cart, sourcing, unsold-resolution, wallet | 0 |
| inventory | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | inventory_items | auth, catalog, infrastructure, logistics, orders | admin-dashboard, dashboard, infrastructure | 0 |
| legacy-control-tower | deprecated | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| local-stock | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | local_stock, local_stock_allocations | catalog, infrastructure, logistics, market | dashboard, economic-engine, logistics, market-delegation, orders, providers-services, recommendations | 0 |
| logistics | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | carriers, hub_box_bags, hub_custody_events, hub_physical_unit_placements, hub_physical_units, hub_purchase_allocations, international_shipment_charges, international_shipment_events, international_shipment_hub_units, international_shipment_relay_receipts, international_shipments, market_transport_sale_rates, parcel_events, parcel_items, parcels, pickup_code_generations, pickup_collect_failures, pickup_print_tokens, pickup_reveal_codes, pickup_verify_attempts, product_sku_physical_codes, relais, relay_product_return_receipts, scan_events, scans, shipments | auth, auth-identity, business-rules, catalog, customs, documents, incident-management, infrastructure, local-stock, loyalty, market, market-delegation, notifications, orders, payments, purchasing, refunds | admin-dashboard, auth-identity, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, infrastructure, inventory, local-stock, market-control-plane, market-delegation, notifications, orders, payments, platform-ops, purchasing, recommendations, refunds | 0 |
| loyalty | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | loyalty_rewards, loyalty_tiers | auth, auth-identity, economic-engine, infrastructure, notifications, orders | auth-identity, economic-engine, logistics, orders, payments | 0 |
| market | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | currency_parities, fx_public_reference_quotes, fx_rate_observations, markets, operator_market_scopes | infrastructure, notifications | catalog, customs, dashboard, economic-engine, infrastructure, local-stock, logistics, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, orders, payments, providers-services, recommendations, refunds, settlement, wallet | 0 |
| market-autonomy | business-feature | ğŸŸ¡ ATTENTION | ğŸŸ¢ HEALTHY | product_market_price_draft_events, product_market_price_drafts | catalog, economic-engine, infrastructure, market | catalog, dashboard, economic-engine, market-delegation, market-operator-dashboard, orders, recommendations, shared-cart | 2 |
| market-control-plane | business-feature | ğŸŸ¡ ATTENTION | ğŸŸ¢ HEALTHY | market_delivery_attestations | auth, catalog, dashboard, decision-signals, economic-engine, infrastructure, logistics, market, market-delegation, orders, payments, sourcing | _aucune_ | 1 |
| market-delegation | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | assignment_capability_ceiling, assignment_memberships, capability_registry, ceiling_template_capabilities, ceiling_templates, market_cash_control_policies, market_delegation_audit, market_operating_assignments, market_team_invitations, membership_capabilities | auth, auth-identity, catalog, dashboard, economic-engine, infrastructure, local-stock, logistics, market, market-autonomy, orders, payments, providers-services, settlement | dashboard, decision-signals, economic-engine, infrastructure, logistics, market-control-plane, market-operator-dashboard, orders, payments, settlement, unsold-resolution | 0 |
| market-operator-dashboard | unclassified | ğŸŸ¡ ATTENTION | ğŸŸ¢ HEALTHY | _aucune_ | catalog, infrastructure, market, market-autonomy, market-delegation | _aucune_ | 4 |
| notifications | business-transversal | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | alerts, client_notifications, notification_log | auth, auth-identity, incident-management, infrastructure, logistics, orders, platform-ops | auth, auth-identity, catalog, dashboard, infrastructure, logistics, loyalty, market, orders, payments, purchasing, refunds, shared-cart | 0 |
| orders | business-feature | ğŸŸ¡ ATTENTION | ğŸŸ¢ HEALTHY | customs_history, disputes, order_checkout_idempotency, order_comments, order_item_cost_imputations, order_items, order_status_history, orders, recipients, relay_return_compensations, sms_log | auth, auth-identity, business-rules, catalog, customs, dashboard, decision-signals, documents, economic-engine, incident-management, infrastructure, local-stock, logistics, loyalty, market, market-autonomy, market-delegation, notifications, payments, platform-ops, purchasing, refunds, shared-cart, wallet | admin-dashboard, auth-identity, catalog, customs, dashboard, documents, economic-engine, incident-management, infrastructure, inventory, logistics, loyalty, market-control-plane, market-delegation, notifications, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, unsold-resolution, wallet | 1 |
| payments | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | cash_collections, cash_confirmation_controls, cash_custody_losses, cash_custody_receipts, cash_deposit_allocations, cash_deposits, market_cash_destinations, market_payment_accounts, market_payment_providers, mobile_money_transactions, paypal_events_processed, stripe_events_processed | auth, auth-identity, business-rules, documents, incident-management, infrastructure, logistics, loyalty, market, market-delegation, notifications, orders, platform-ops, purchasing, refunds | admin-dashboard, dashboard, decision-signals, infrastructure, logistics, market-control-plane, market-delegation, orders, refunds | 0 |
| platform | frontend-transversal | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | _aucune_ | _aucune_ | _aucune_ | 0 |
| platform-ops | technical-transversal | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | fabrics, garment_models | auth, auth-identity, business-rules, catalog, documents, economic-engine, incident-management, infrastructure, logistics, orders, purchasing, wallet | auth-identity, auth-passkey, catalog, economic-engine, infrastructure, notifications, orders, payments, providers-services, recommendations, shared-cart, wallet | 0 |
| providers-services | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | inquiries, physical_offers, providers, services | auth, auth-identity, infrastructure, local-stock, market, platform-ops, recommendations | market-delegation, recommendations | 0 |
| purchasing | business-feature | ğŸŸ¢ HEALTHY | ğŸŸ¢ HEALTHY | hub_authorization_grants, manual_purchase_executions, product_suppliers, purchase_lines, purchase_order_authorizations, purchase_orders, purchase_variance_decisions, supplier_execution_events, supplier_execution_fulfillments, supplier_execution_order_lines, supplier_execution_orders, supplier_execution_payment_proofs, supplier_execution_payments, supplier_payment_settlements, suppliers | auth, catalog, documents, economic-engine, external-provider-contracts, incident-management, infrastrucm«ëŒ+Š×®º+º$zzb¥çGW&RÂÆöv—7F–72Âæ÷F–f–6F–öç2Â÷&FW'2Â6÷W&6–ærÂ7WÆ–W"Ö6öææV7F—f—G’Â6FÆörÂF6†&ö&BÂFV6—6–öâ×6–væÇ2ÂÆöv—7F–72Â÷&FW'2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2Â6÷W&6–ærÂÀ§Â&V6öÖÖVæFF–öç2Â'W6–æW72ÖfVGW&RÂ	ùú"„TÅD…’Â	ùú"„TÅD…’ÂöV7VæUòÂ6FÆörÂ–æg&7G'V7GW&RÂÆö6Â×7Fö6²ÂÆöv—7F–72ÂÖ&¶WBÂÖ&¶WBÖWFöæö×’Â÷&FW'2ÂÆFf÷&ÒÖ÷2Â&÷f–FW'2×6W'f–6W2Â–æg&7G'V7GW&RÂ&÷f–FW'2×6W'f–6W2Â6†&VBÖ6'BÂÀ§Â&VgVæG2Â'W6–æW72×G&ç7fW'6ÂÂ	ùú"„TÅD…’Â	ùú"„TÅD…’ÂÆö6Åö66…÷&VgVæEöWF†÷&—¦F–öç2ÂÆö6Åö66…÷&VgVæE÷–÷WG2ÂÆö6Åö—FVÕ÷&VgVæE÷&W6W'fF–öç2ÂÆö6ÅöÖö&–ÆU÷&VgVæEö†æFöfg2Â÷&FW%ö—FVÕ÷&VgVæE÷&W6W'fF–öç2Â&VgVæEöW†V7WF–öåö–çFVçG2Â&VgVæG2ÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂÆöv—7F–72ÂÖ&¶WBÂæ÷F–f–6F–öç2Â÷&FW'2Â–ÖVçG2ÂvÆÆWBÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72Â÷&FW'2Â–ÖVçG2ÂÀ§Â6WGFÆVÖVçBÂ'W6–æW72ÖfVGW&RÂ	ùú"„TÅD…’Â	ùú"„TÅD…’ÂÖ&¶WE÷6WGFÆVÖVçEöWfVçG2ÂÖ&¶WE÷6WGFÆVÖVçG2ÂWF‚ÂWF‚Ö–FVçF—G’Â–æg&7G'V7GW&RÂÖ&¶WBÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖFVÆVvF–öâÂÀ§Â6†&VBÖ6'BÂ'W6–æW72ÖfVGW&RÂ	ùú"„TÅD…’Â	ùú"„TÅD…’Â&6¶WEö—FV×2Â&6¶WG2Â6'E÷6†&W2Â6†&VEö6'EöWfVçG2Â6†&VEö6'Eö—FV×2Â6†&VEö6'E÷6fVEö66W72Â6†&VEö6'G2ÂWF‚ÂWF‚Ö–FVçF—G’Â6FÆörÂ–æg&7G'V7GW&RÂÖ&¶WBÖWFöæö×’Âæ÷F–f–6F–öç2Â÷&FW'2ÂÆFf÷&ÒÖ÷2Â&V6öÖÖVæFF–öç2Â6FÆörÂF6†&ö&BÂ–æg&7G'V7GW&RÂ÷&FW'2ÂÀ§Â6÷W&6–ærÂ'W6–æW72ÖfVGW&RÂ	ùú"„TÅD…’Â	ùú"„TÅD…’Â–×÷'E÷'VçF–ÖUö—FVÕöWfVçG2Â–×÷'E÷'VçF–ÖU÷'Vç2Â&÷f–FW%ö7&VFVçF–Ç2Â6÷W&6–æuö6æF–FFUöWfVçG2Â6÷W&6–æuö6æF–FFW2Â6÷W&6–æuö6æöæ–6ÅöVçF—F–W2Â6÷W&6–æuö6æöæ–6ÅöVçF—G•÷&Vg2Â6÷W&6–æuö6GW&W2Â6÷W&6–æuöÖF6…÷&÷÷6Ç2Â6÷W&6–æuöö'6W'fF–öåöWf–FVæ6RÂ6÷W&6–æuöö'6W'fF–öç2Â6÷W&6–æu÷&÷f–FW%ö6öçG&öÅöWfVçG2Â6÷W&6–æu÷&W6öÇWF–öåö&–æF–æw2Â6÷W&6–æu÷&W6öÇWF–öåöFV6—6–öç2Â6÷W&6–æu÷6÷W&6U÷&÷f–FW2Â6÷W&6–æu÷6÷W&6U÷&WVW7G2Â6÷W&6–æu÷6÷W&6W2Â7WÆ–W%ö6öÖÖW&6–Åö6FVv÷'•öÖ–æw2ÂWF‚Â6FÆörÂ7W7Fö×2ÂF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂW&6†6–ærÂ6FÆörÂF6†&ö&BÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂW&6†6–ærÂÀ§Â7WÆ–W"Ö6öææV7F—f—G’Â–çFVw&F–öâÖFFW"Â	ùú"„TÅD…’Â	ùú"„TÅD…’ÂöV7VæUòÂW‡FW&æÂ×&÷f–FW"Ö6öçG&7G2Â6FÆörÂF6†&ö&BÂW&6†6–ærÂÀ§ÂVç6öÆB×&W6öÇWF–öâÂ'W6–æW72ÖfVGW&RÂ	ùú"„TÅD…’Â	ùú"„TÅD…’ÂVç6öÆEö—FV×2ÂWF‚Â6FÆörÂ–æg&7G'V7GW&RÂÖ&¶WBÖFVÆVvF–öâÂ÷&FW'2ÂöV7VæUòÂÀ§ÂvÆÆWBÂ'W6–æW72ÖfVGW&RÂ	ùú"„TÅD…’Â	ùú"„TÅD…’ÂvÆÆWEö6öç7V×F–öç2ÂvÆÆWEö7&VF—EöÆ÷G2ÂvÆÆWE÷G&ç67F–öç2ÂvÆÆWG2ÂWF‚ÂWF‚Ö–FVçF—G’ÂFö7VÖVçG2Â–æg&7G'V7GW&RÂÖ&¶WBÂ÷&FW'2ÂÆFf÷&ÒÖ÷2ÂWF‚Ö–FVçF—G’ÂF6†&ö&BÂFö7VÖVçG2Â–æg&7G'V7GW&RÂ÷&FW'2ÂÆFf÷&ÒÖ÷2Â&VgVæG2ÂÀ§ÂvÆÆWBÖÆ÷–ÇG’ÂFW&V6FVBÂ	ùú"„TÅD…’Â	ùú"„TÅD…’ÂöV7VæUòÂöV7VæUòÂöV7VæUòÂÀ ¢22FÖ–âÖF6†&ö&@ ¢¢¤¶–æB¢¢¢&ö¦V7F–öâ+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢F&ÆVRFR&÷&BFÖ–â5×VÇF’×gVW2à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢ÒFÖ–âò¢ ¢Òö÷WEò ¢Ò’&6¶Væ@ ¢¢¤WF†÷&—G’¢¢¢F6†&ö&G0 ¢¢¤–çf&–çG2¢¢ ¢ÒF÷WBf–6†–W"FÖ–âò¢¢ò¢æ§2Fö—BWG&RFV6Æ&R–6 ¢¢¤÷vç2¢¢¢öV7VæUğ ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢6FÆör„DT4Ä$TEôäEôô%4U%dTB’Â7W7Fö×2„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFV6—6–öâ×6–væÇ2„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–çfVçF÷'’„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢öV7VæUğ ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùúEDTåD”ôâ(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢ƒ’ ¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R'6÷W&6–ær"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB ¢¢¤–×ÆVÖVçFF–öâ¢¢¢3‚f–6†–W"‡2’L:–6Æ,:’‡2¢Ò§2¢3€ ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&FÖ–âÖF6†&ö&B%Õğ ¢22WF€ ¢¢¤¶–æB¢¢¢FV6†æ–6Â×G&ç7fW'6Â+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢f÷W&æ—"ÆW2v&FW2G&ç7fW'6W2BvWF†VçF–f–6F–öâWBFRl:—&–f–6F–öâBv–FVçF—L:’†Ö–FFÆWv&W2¥uB÷6W76–öâ÷,;FÆW2’6öç6öÖÜ:–W2"F÷WFW2ÆW2WG&W2fVGW&W2à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢ÒÖ–FFÆWv&W2FRv&FRG&ç7fW'6W2¢WF†VçF–f–6F–öâ¥uB÷6W76–öâÂl:—&–f–6F–öâFR,;FÆRÂ–FVçF—L:’l:—&–fœ:–RÂ,:—fö6F–öâFRFö¶VâÂ:–Ö—76–öâWBGW,:–R6æöæ—VRFR6W76–öà¢Òö÷WEò ¢ÒÆöv—VRÖWF–W"&÷&R6†VRfVGW&R6öç6öÖÖG&–6R(	BWF‚æR6—B&–VâFW26öÖÖæFW2Âæ–W'2÷R–VÖVçG0 ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WB6†ævVÖVçBFRÖ–FFÆWv&RBvWF†VçF–f–6F–öâ÷RFRöÆ—F—VRFR6W76–öâFö—BWG&RfÆ–FR"ÆR&÷&–WF—&RFRWF€ ¢¢¤–çf&–çG2¢¢ ¢ÒF÷WFR&÷WFR×WFçFR76R"VâÖ–FFÆWv&RBvWF‚FV6Æ&R(	B¦Ö—2Bv66W2F—&V7B6ç2v&FP¢ÒF÷WFR×WFF–öâ÷'L:–R"ÆR6öö¶–RFR6W76–öâW†–vRVæR÷&–v–âW‡Æ–6—FVÖVçBWF÷&—<:–R„UD‚Ó†"¢Ò7Fv–ær÷&öGV7F–öâWF–Æ—6VçBW†6ÇW6—fVÖVçBVâ6öö¶–RFR6W76–öâõô†÷7BÒ6V7W&RÂFƒÒòWB6ç2FöÖ–â„UD‚Ó†2¢ÒÆGW,:–R'6öÇVR¥uB²6öö¶–RW7BÆföæì:–R:r¦÷W'2WB6†VR&WWfRõE÷76¶W’÷7FW×W:–ÖWBVæRæ÷WfVÆÆR§F’„UD‚Ó†B¢ÒVâ¥uB66÷VB÷RL:—÷W'gRFW26Æ–×2FR6W76–öâ6æöæ—VW2æRWWB¦Ö—2:§G&R:–ÆWl:’Vâ6W76–öâ"ÆW2Ö–FFÆWv&W2|:–ì:—&—VW2„UD‚Ó†R ¢¢¤÷vç2¢¢¢öV7VæUğ ¢¢¤W‡÷6W2¢¢¢b–çFW&æÂ’‡2’Â…EE–çFW&f6R‡2¢Ò&WV—&TWF‚ò&WV—&UfW&–f–VD–FVçF—G’ò6ögDWF††Ö–FFÆWv&RöWF‚æ§2’(	B&W6öÇfV@¢Ò&WV—&TWF‚ò&WV—&UfW&–f–VD–FVçF—G’ò6ögDWF††Ö–FFÆWv&R÷&WV—&R×fW&–f–VBÖ–FVçF—G’æ§2’(	B&W6öÇfV@¢Ò&WV—&TWF‚ò&WV—&UfW&–f–VD–FVçF—G’ò6ögDWF††Ö–FFÆWv&R÷6ögBÖWF‚æ§2’(	B&W6öÇfV@¢Ò6–väWF…Fö¶Vâò&W6öÇfU6W76–öåGFÅ6V6öæG2ò6W76–öä6Æ–×5fW&FÚ±î¸Â¸­yêë¢°k¢G§¦*^ict` (utils/auth-session-policy.js) â€” resolved
  - `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` (utils/auth-session.js) â€” resolved
  - `signAuthToken / resolveSessionTtlSeconds / sessionClaimsVerdict` (utils/auth-token-policy.js) â€” resolved

**Consumes** : auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market-control-plane (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : ğŸŸ¢ HEALTHY â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 27 fichier(s) dÃ©clarÃ©(s)
  - middleware : 7
  - tests : 16
  - utils : 4

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="auth"]_

## auth-identity

**Kind** : business-feature  Â·  **Status** : production

**Service** : Authentifier un utilisateur et gÃ©rer son identitÃ© active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposÃ©es.

**Perimeter** :
- _in_ :
  - routes actives d'identitÃ© : OTP (request/verify/test-reset), login/register, magic-link, guest-checkout, admin-reset, consultation/Ã©dition du profil et des commandes client
- _out_ :
  - logique metier propre a chaque feature consommatrice â€” auth-identity ne sait rien des commandes, paniers ou paiements

**Authority** : backend-core â€” tout changement de middleware d'authentification doit etre valide par le proprietaire de middleware/auth.js

**Invariants** :
- [object Object]
- les routes de ce manifeste s'appuient sur authenticate (middleware/auth.js, feature auth) â€” pas de garde ad-hoc
- la projection boutique de l identitÃ© protÃ¨ge le focus du dialogue et associe chaque erreur de validation au champ concernÃ©
- [object Object]
- le nom autorisÃ© n'est jamais exposÃ© au relais : logistics ne reÃ§oit que des champs normalisÃ©s via getActiveAuthorizationForUpdate, jamais authorized_given_names/authorized_family_name en clair

**Owns** : `credential_action_tokens`, `otp_codes`, `revoked_tokens`, `user_pickup_authorizations`, `users`

**Exposes** : 13 internal API(s), 28 HTTP interface(s)
  - `anonymizeUser` (services/user-mutation-service.js) â€” resolved
  - `createAdminUser` (services/user-mutation-service.js) â€” resolved
  - `deleteNonAdminUsers` (services/user-mutation-service.js) â€” resolved
  - `deleteUser` (services/user-mutation-service.js) â€” resolved
  - `getActiveAuthorizationForUpdate` (services/pickup-authorization-service.js) â€” resolved
  - `hasActiveAuthorization` (services/pickup-authorization-service.js) â€” resolved
  - `incrementBigBasketCount` (services/user-mutation-service.js) â€” resolved
  - `makeIntlPhoneInput` (public/boutique/js/b-phone.js) â€” resolved
  - `markBigBasketNotified` (services/user-mutation-service.js) â€” resolved
  - `markUserPendingActivation` (services/user-mutation-service.js) â€” resolved
  - _...3 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : ğŸŸ¢ HEALTHY â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 36 fichier(s) dÃ©clarÃ©(s), boutique: 5 fichier(s)
  - boutique : 3
  - migrations : 4
  - routes : 4
  - scripts : 1
  - services : 7
  - tests : 15
  - utils : 2

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="auth-identity"]_

## auth-passkey

**Kind** : business-feature  Â·  **Status** : production

**Service** : GÃ©rer le cycle de vie Passkey Komerce : enrÃ´lement, login nominal, mÃ©tadonnÃ©es sÃ»res et rÃ©vocation explicite des authentificateurs du compte (AUTH-2â†’7).

**Perimeter** :
- _in_ :
  - gÃ©nÃ©ration des options WebAuthn (register/login), vÃ©rification cryptographique via @simplewebauthn/server, stockage/rotation des credentials et des challenges Ã©phÃ©mÃ¨res
- _out_ :
  - durcissement final de session/cookie/CSRF (AUTH-8bâ†’e)
  - toute logique OTP/magic-link/guest-checkout â€” reste dans auth-identity

**Authority** : backend-core â€” toute vÃ©rification WebAuthn passe exclusivement par @simplewebauthn/server ; aucune rÃ©-implÃ©mentation crypto/CBOR locale.

**Invariants** :
- [object Object]
- un challenge Ã©mis pour un user ne peut jamais Ãªtre consommÃ© au bÃ©nÃ©fice d'un autre user
- expectedOrigin et expectedRPID viennent exclusivement de la config serveur, jamais du client
- [object Object]
- requireUserVerification est vÃ©rifiÃ© par la lib, pas seulement demandÃ© Ã  l'authenticator
- credential_id est unique (contrainte DB + vÃ©rification applicative avant insert)
- une credential revoked_at non nul est inutilisable au login, sans exception
- la gestion AUTH-6 ne retourne jamais credential_id, public_key ni sign_count au navigateur
- une rÃ©vocation est toujours scellÃ©e par id de gestion ET user_id authentifiÃ©
- un challenge step_up est distinct de login/register et liÃ© au user_id de la session
- une passkey d un autre compte ne peut jamais satisfaire un step-up
- les mutations de sÃ©curitÃ© exigent auth_time rÃ©cent avec amr otp ou passkey
- sign_count : rÃ©gression rejetÃ©e pour les credentials non sauvegardÃ©es (backup_state=false) ; tolÃ©rÃ©e et tracÃ©e pour les passkeys synchronisÃ©es (backup_state=true)

**Owns** : `webauthn_challenges`, `webauthn_credentials`

**Exposes** : 0 internal API(s), 8 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)
**Consumed by** : auth-identity (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : ğŸŸ¢ HEALTHY â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 14 fichier(s) dÃ©clarÃ©(s), boutique: 10 fichier(s)
  - migrations : 2
  - routes : 1
  - services : 3
  - tests : 8

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="auth-passkey"]_

## business-rules

**Kind** : business-transversal  Â·  **Status** : production

**Service** : Detenir le referentiel des regles metier parametrables, versionner chaque changement, et servir a toute feature la valeur en vigueur avec un repli garanti sur la valeur codee en dur.

**Perimeter** :
- _in_ :
  - lecture d'une regle en vigueur avec valeur de repli (getRule)
  - mutation d'une regle et historisation du changement (business_rules_history)
  - restitution admin du referentiel et de son historique
  - cache memoire TTL 60s et son invalidation
- _out_ :
  - la decision prise a partir de la regle : elle appartient a la feature qui lit (orders decide d'annuler, catalog decide de publier) â€” business-rules ne tranche jamais a leur place
  - les parametres economiques (marges, taux, composants de cout) : feature economic-engine, referentiel distinct
  - la configuration technique d'execution (variables d'environnement, feature flags de deploiement) : feature infrastructure

**Authority** : backend-core â€” toute regle nouvelle doit porter une valeur de repli codee en dur egale au comportement actuel : l'ajout d'une regle ne change jamais le comportement tant que la base est vide.

**Invariants** :
- une regle absente ou une base injoignable retourne la valeur de repli, jamais une erreur
- toute mutation de regle ecrit une ligne d'historique dans la meme transaction
- aucune feature ne lit business_rules directement : le seul chemin est getRule()

**Owns** : `business_rules`, `business_rules_history`

**Exposes** : 4 internal API(s), 5 HTTP interface(s)
  - `getAllRules` (utils/rules.js) â€” resolved
  - `getRule` (utils/rules.js) â€” resolved
  - `getRuleNumber` (utils/rules.js) â€” resolved
  - `setRule` (utils/rules.js) â€” resolved

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : ğŸŸ¢ HEALTHY â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 5 fichier(s) dÃ©clarÃ©(s)
  - routes : 1
  - tests : 3
  - utils : 1

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="business-rules"]_

## catalog

**Kind** : business-feature  Â·  **Status** : production

**Service** : Raffiner les donnees fournisseur en catalogue canonique, publier les unites vendables et exposer un contrat detail produit stable a la Boutique.

**Perimeter** :
- _in_ :
  - connecteurs fournisseurs (CSV, API, manuel, Noon, CJdropshipping, AliExpress, Allegro Sandbox, eBay Sandbox Browse enregistrÃ© dans le dispatch gÃ©nÃ©rique P3)
  - identitÃ© dâ€™approvisionnement par produit : le canal MANUAL choisit un fournisseur rÃ©el enregistrÃ© ou, Ã  dÃ©faut, le Fournisseur central Hub protÃ©gÃ© ; cette identitÃ© reste distincte du vendeur externe, du provider et de Supplier Order Identity (migration 403)
  - les produits saisis par le Fournisseur central Hub portent un contrat source V2 explicite sans vendeur ni SKU ; lâ€™identitÃ© rÃ©elle du vendeur et les SKU arrivent seulement Ã  la confirmation dâ€™achat
  - contrat source fournisseur versionne V1/V2 : brut integral + preservation explicite media, axes et unites vendables quand la source les connait
  - publication produit et dÃ©clenchement de l audit prix via economic-engine
  - categories boutique admin
  - catalogue vivant Boutique : grille, cartes produit, ouverture fiche produit
  - catalogue canonique : produit, medias publics, axes d options descriptifs et unites vendables SKU
  - contrat detail produit public v1 : identity, pricing, media, option_axes, sellable_units et delivery_options deja resolues par leurs autorites
  - projection des rails de livraison deja commercialement exposes par logistics, sans inventer prix ni delai
  - modal produit catalogue : un fetch Product Detail, un etat de selection SKU, deux compositions responsive mobile/desktop
  - raffinerie catalogue : donnee source EN conservee, eligibilite douane/transport (catalog_exclusions), enrichissement FR, overrides traces, approbation humaine unique
  - contrat de revue visuelle des medias source : preuve attachÃ©e Ã  lâ€™identitÃ© du mÃ©dia et Ã  sa variante, texte incrustÃ© prÃ©sentÃ© en FR si nÃ©cessaire, sans dÃ©pendance IA ni publication automatique ; une image canonique importÃ©e par le Hub reÃ§oit une identitÃ© interne liÃ©e Ã  son UUID mÃ©dia, jamais un faux identifiant fournisseur
  - produit manuel Fournisseur central Hub sans variantes : prÃ©paration explicite depuis lâ€™inspecteur Catalogue dâ€™une unitÃ© vendable interne par dÃ©faut, stock initial zÃ©ro, sans SKU ni identitÃ© fournisseur, avant la bascule SKU de lâ€™approbation
  - recette propriÃ©taire staging : revue Chromium automatisÃ©e explicitement attribuÃ©e au run GitHub et au compte authentifiÃ© sur candidats Sourcing TEST, y compris les mÃ©dias manuels Hub ; jamais une attestation humaine, jamais recevable hors staging, jamais une publication sans geste explicite
  - projection par lot KIR : prÃ©paration Catalogue, publication et visibilitÃ© par marchÃ© depuis les produits rÃ©ellement promus ; lecture seule, sans automatiser une dÃ©cision
  - Catalogue global maÃ®tre : registre paginÃ© de toutes les fiches rÃ©ellement remises depuis Sourcing/Raffinerie ; fournisseurs, taxonomie boutique, Ã©carts actionnables et corrections par autoritÃ© sans confondre remise et vente
  - Catalogue prÃ©-publication : contrÃ´le canonique des prÃ©requis candidat Ã  la demande en lecture seule, sans dÃ©clencher de publication ni confondre approbation Catalogue, revue visuelle FR et dÃ©cisions marchÃ©s
  - Catalogue global commercial : projection read-only de l assortiment approuve a la vente, compose uniquement des produits issus de KIR clos et possedant exposition ENABLED + prix LOCAL_ACTIVE sur au moins un marche ; drafts et lots ouverts restent hors de cette lecture
  - glossaire metier EN->FR (catalog_glossary)
  - mÃ©moire terminologique externe sourcÃ©e et filtrÃ©e par corpus (catalog_terminology_reference), avec prioritÃ© au glossaire Komerce
  - challenge FR cold-start permanent : 100 produits CJ jamais vus, source exacte, enrichissement TERMIUM incrÃ©mental, aucune dÃ©pendance IA runtime et seconde revue obligatoire
  - campagne FR Quality branchÃ©e : traductions + reviews hashÃ©es â†’ dry-run â†’ application atomique en overrides manuels sur drafts inactifs â†’ readiness â†’ checkpoint, jamais de publication automatique
  - gate final Raffinerieâ†’Catalogue : 974 candidats attendus, vÃ©ritÃ© source V2, mÃ©dias, SKU/SOI complets, catÃ©gorie, file humaine, zÃ©ro exposition marchÃ© avant publication ; mode final exige en plus contenu FR revu + publication guard PASS
  - file d approbation admin (etage 6) : approve/reject/override en un ecran, seul point de validation humaine avant lifecycle_status=active ; chaque dÃ©cision rÃ©ussie est journalisÃ©e dans catalog_publication_decision_audit avec acteur et snapshots minimaux
  - bootstrap visuel CJ bornÃ© : 63 produits rÃ©els, mÃ©dias fournisseur liÃ©s au lignage, exÃ©cution one-shot gardÃ©e
  - pool CJ de Raffinerie bornÃ© Ã  1000 rÃ©fÃ©rences propres maximum, dÃ©dupliquÃ© et reprenable, sans publication automatique
  - source Allegro Sandbox vendeur : offres exactes V2 en PLN, OAuth refresh chiffrÃ© sous verrou, aucun achat automatique
  - source AliExpress de stress-test Raffinerie : Open Platform Drop Shipping api-sg, OAuth serveur gÃ©rÃ© et chiffrÃ©, feed/detail normalisÃ©s V2, aucune publication automatique
  - pool AliExpress staging bornÃ© Ã  500 rÃ©fÃ©rences rÃ©ellement en stock, dÃ©dupliquÃ© et reprenable, alimentÃ© exclusivement via la Raffinerie et sans publication automatique
  - dataset E2E unifiÃ© 700 historique : 200 AliExpress validÃ©s + 500 CJ semantic-positive, cohabitant dans une base Railway isolÃ©e explicitement gardÃ©e, sans exposition marchÃ© ni publication automatique
  - dataset E2E rÃ©conciliÃ© 712 : 200 AliExpress + 500 CJ historiques certifiÃ©s + 12 CJ nouveaux uniques, matÃ©rialisÃ©s par identitÃ© fournisseur exacte, taxonomie boutique dynamique active, SKU/SOI complets et zÃ©ro exposition marchÃ©
  - certification catalogue canonique v1 : provider-independent, versionnÃ©e et fail-closed ; un produit certifiÃ© possÃ¨de source V2, taxonomie boutique catÃ©gorie+sous-catÃ©gorie active, mÃ©dia, SKU/SOI, contenu FR prÃªt, zÃ©ro exposition marchÃ© et publication guard PASS ; les datasets 700/712 sont des corpus de preuve et non la dÃ©finition de la certification
  - chaque sous-catÃ©gorie boutique commerciale active dÃ©clare une affinitÃ© douaniÃ¨re administrable ; le produit fournisseur rÃ©el garde prioritÃ© et l affinitÃ© ne sert qu en fallback de proximitÃ© pour Ã©viter les catÃ©gories Komerce nulles sur un produit acceptÃ©
  - un dataset E2E certifiÃ© peut Ãªtre transfÃ©rÃ© vers le catalogue rÃ©el uniquement par replay des contrats fournisseur V2 via les autoritÃ©s canoniques import/scan/promotion ; les identitÃ©s dÃ©jÃ  prÃ©sentes sont laissÃ©es intactes et aucune exposition marchÃ© n est crÃ©Ã©e automatiquement
  - product_market_exposure : exposition commerciale produit x marchÃ©, fail-closed (absence de ligne = DISABLED), mÃªme patron que commercial_exposure sur physical_offers/services
  - migration 206 : snapshot de compatibilitÃ© produit x marchÃ©, reproduction exacte de publicCatalogVisibilitySql() croisÃ©e avec chaque marchÃ© actif â€” cutover, pas un all x all aveugle
  - services/catalog-public-view.js::publicCatalogVisibilitySql(alias, { marketCodeParam }) : le chemin de lecture storefront consulte dÃ©sormais product_market_exposure quand un marchÃ© est fourni ; sans marchÃ©, comportement historique inchangÃ© Ã  lâ€™identique
- _out_ :
  - calcul du prix final et valorisation transport (feature economic-engine)
  - decision de rail, routing et eligibilite logistique dynamique (feature logistics)
  - mise en avant / classement (feature recommendations)
  - fiche snapshot lecture seule du panier partage (feature shared-cart)
  - checkout final et paiement (features orders/payments)
  - dÃ©cision dâ€™exposition produit x marchÃ© (qui Ã©crit product_market_exposure) : feature market-delegation, capability catalog.expose

**Authority** : backend-core â€” normalized-product possede le contrat source versionne ; catalog possede le catalogue canonique et le contrat detail public ; toute modification modal catalogue suit DOCTRINE_PRODUCT_DETAIL_CONTRACT.md et docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md

**Invariants** :
- [object Object]
- un produit publie a toujours passe product-publication-guard.js
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- jamais de creation produit par formulaire vide : tout entre par un connecteur (le manuel EST un connecteur)
- la donnee source ne se perd jamais : raw_payload reste le brut integral et normalized_source_contract preserve separement le mapping V2 valide
- une structure riche connue ne doit pas etre aplatie puis reconstruite par heuristique ; une source pauvre reste pauvre honnÃªtement
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
- le pool fournisseur CJ de la Raffinerie ne dÃ©passe jamais 1000 rÃ©fÃ©rences propres ; son alimentation ne publie aucun produit automatiquement
- la source AliExpress reste une entrÃ©e de Raffinerie : elle ne crÃ©e ni ne publie jamais directement un produit canonique
- aucune clÃ© customs_categories ni rÃ¨gle de correspondance catÃ©gorie fournisseur ne doit Ãªtre codÃ©e en dur dans supplier-catalog-scanner ; la configuration active vient de customs_categories
- tout sourcing par requÃªte destinÃ© aux campagnes E2E doit porter une preuve discovery.semantic_relevance issue du gate canonique provider-independent ; une ligne hors requÃªte ne compte jamais vers la cible
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- les datasets E2E 700 et 712 restent des corpus historiques de preuve de non-rÃ©gression ; aucun nombre ni fournisseur ne dÃ©finit la certification canonique
- le pool AliExpress staging ne dÃ©passe jamais 500 rÃ©fÃ©rences propres en stock et ne peut pas s exÃ©cuter en production
- les access/refresh tokens fournisseur sont persistÃ©s chiffrÃ©s ; l App Secret reste uniquement en variable serveur et aucun token n est exposÃ© au navigateur

**Owns** : `boutique_categories`, `boutique_subcategories`, `catalog_enrichment_runs`, `catalog_field_overrides`, `catalog_field_sync_state`, `catalog_media`, `catm«ëŒ+Š×®º+º$zzb¥æÆöuöÖVF–÷&V6÷fW'•öVF—FÂ6FÆöuöÖVF–÷f—7VÅög%÷&Wf–Ww6Â6FÆöu÷&öGV7E÷VÆ—G•öæ÷FW6Â6FÆöu÷&öGV7E÷6ÆUö†öÆG6Â6FÆöu÷V&Æ–6F–öåöFV6—6–öåöVF—FÂ6FÆöu÷7Fö6µ÷7–æ5÷7FFVÂ6FÆöu÷F†öæö×•öVF—FÂ6FÆöu÷FW&Ö–æöÆöw•÷&VfW&Væ6VÂ&öGV7EöGG&–'WFW6Â&öGV7Eö6öçFVçE÷&öf–ÆVÂ&öGV7Eö6öçFVçE÷6V7F–öç6Â&öGV7EöÖ&¶WEöW‡÷7W&VÂ&öGV7E÷6·UöÖVF–Â&öGV7E÷6·W6Â&öGV7E÷f&–çG6Â&öGV7G6Â7WÆ–W%ö6FÆöuö–×÷'E÷&V¦V7F–öç6Â7WÆ–W%ö6FÆöuö–×÷'G6Â7WÆ–W%ö6FÆöu÷7–æ5ö6†V6·ö–çG6Â7WÆ–W%ööWF…ö6öææV7F–öç6 ¢¢¥w&—FW2†æ÷B÷væW"’¢¢¢6÷W&6–æuö6æF–FFW6‡w&—FW"Öæ÷BÖ÷væW" ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’ÂCr…EE–çFW&f6R‡2¢ÒÇ•&–6V‡6W'f–6W2ö6FÆör×&öGV7BÖ×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò'VÆ´76–vå6÷W&6–æu&–Æ‡6W'f–6W2ö6FÆör×&öGV7BÖ×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò7&VFTG&gDg&öÕ6÷W&6–æt6æF–FFV‡6W'f–6W2÷&öGV7BÖFÖ–â×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò7&VFTG&gE&öGV7Dg&öÕ6÷W&6–æt6æF–FFV‡6W'f–6W2ö6FÆörÖ6æF–FFR×&öGV7B×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒÖ–&TÇ”6FÆöu&öGV7E&÷WFT6æ'–‡6W'f–6W2ö6FÆör×&öGV7B×&÷WFRÖ6æ'’æ§2’(	B&W6öÇfV@¢Ò&VD6FÆöu&öGV7E6÷W&6V‡6W'f–6W2ö6FÆör×&öGV7B×6÷W&6R×&VB×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò&VE'Vå&öw&W76‡6W'f–6W2ö6FÆör×'Vâ×&öw&W72æ§2’(	B&W6öÇfV@¢Ò&WÆ6Uf&–çG4f÷%6÷W&6–æv‡6W'f–6W2ö6FÆör×&öGV7BÖ×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò&W6öÇfT6FÆöu&öGV7E&VDÖöFV‡6W'f–6W2ö6FÆör×&öGV7B×6÷W&6R×&VB×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒWFFU6÷W&6–ætf–VÆG6‡6W'f–6W2ö6FÆör×&öGV7BÖ×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@ ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â'W6–æW72×'VÆW2„DT4Ä$TEôäEôô%4U%dTB’Â7W7Fö×2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’ÂW‡FW&æÂ×&÷f–FW"Ö6öçG&7G2„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’Âæ÷F–f–6F–öç2„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’ÂÆFf÷&ÒÖ÷2„DT4Ä$TEôäEôô%4U%dTB’ÂW&6†6–ær„DT4Ä$TEôäEôô%4U%dTB’Â6†&VBÖ6'B„DT4Ä$TEôäEôô%4U%dTB’Â6÷W&6–ær„DT4Ä$TEôäEôô%4U%dTB’Â7WÆ–W"Ö6öææV7F—f—G’„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢FÖ–âÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â7W7Fö×2„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’Â–çfVçF÷'’„DT4Ä$TEôäEôô%4U%dTB’ÂÆö6Â×7Fö6²„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ6öçG&öÂ×ÆæR„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’ÂÆFf÷&ÒÖ÷2„DT4Ä$TEôäEôô%4U%dTB’ÂW&6†6–ær„DT4Ä$TEôäEôô%4U%dTB’Â&V6öÖÖVæFF–öç2„DT4Ä$TEôäEôô%4U%dTB’Â6†&VBÖ6'B„DT4Ä$TEôäEôô%4U%dTB’Â6÷W&6–ær„DT4Ä$TEôäEôô%4U%dTB’ÂVç6öÆB×&W6öÇWF–öâ„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùKB$Äô4´TB(	BvFW3¢6†V6³¦–×÷'G2ÂvFS¦fVGW&RÖwV&BÂf–Ã¢Âv&ã¢ ¢Ò¶6†V6³¦–×÷'G5Ò	ùúDU…BÔtDRÔD”täõ5D”2(	B)ª§2ö"×vW"æ§2(	BW‡÷'B‡2’æöâ6öç6öÖÜ:’‡2’ ¢Ò¶6†V6³¦–×÷'G5Ò	ùúDU…BÔtDRÔD”täõ5D”2(	B)ÉBV7Vâ–×÷'BfçL;FÖRæ’7–6ÆR–æ6öæçRæ’ÖöGVÆRÖçVçBà¢Ò¶vFS¦fVGW&RÖwV&EÒ	ùKBdTEU$RÔuT$B(	BFöÖ–âÖ—6ÖF6‚¢ââö§2÷&öGV7BÖ–ÖvRÖÆöF–ær×W‚æ§2FV6Æ&RFöÖ–â&&÷WF—VR"Ö—2W7BÆ—7FRFç26FÆöræfVGW&Ræ§2†FöÖ–â&6FÆör" ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢CS’f–6†–W"‡2’L:–6Æ,:’‡2’Â&÷WF—VS¢32f–6†–W"‡2¢Ò&÷WF—VR¢3¢Ò6’¢#P¢Ò6öæf–r¢¢ÒF6‚¢¢ÒFö72¢¢ÒÖ–FFÆWv&R¢¢ÒÖ–w&F–öç2¢#`¢Ò&÷WFW2¢p¢Ò66†VÖ2¢P¢Ò67&—G2¢3P¢Ò6W'f–6W2¢ƒ€¢ÒFW7G2¢#¢ÒWF–Ç2¢ ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&6FÆör%Õğ ¢227W7Fö×0 ¢¢¤¶–æB¢¢¢'W6–æW72ÖfVGW&R+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢6Æ76W"WBFV6Æ&W"Vâ6öÆ—2F÷Væ–W&VÖVçB²ÆFV6Æ&F–öâW7BÆR—f÷BÂ¦Ö—2VæR÷F–Ö—6F–öâà ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò6Æ76–f–6F–öâF÷Væ–W&P¢ÒæÇ—F–72F÷VæP¢Ò6FVv÷&–W2WB6†—ÖVçG2FÖ–âF÷VæP¢Òö÷WEò ¢ÒG&ç7÷'B‡—6—VRGR6öÆ—2†fVGW&RÆöv—7F–72ÂV’6öç6öÖÖRÆR7FGWBF÷VæR¢ÒvVæW&F–öâFRÆf7GW&RF÷VæRFö7VÖVçB†fVGW&RFö7VÖVçG2 ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WFR&VvÆRFR6Æ76–f–6F–öâFö—BWG&RfÆ–FVR"ÆR&÷&–WF—&RFR7W7Fö×2Ö6Æ76–f–6F–öâæ§2Â6öæf÷&ÖVÖVçBFö72öFö7G&–æRôDõTäUôDT4Ä$D”ôåõ•dõBæÖ@ ¢¢¤–çf&–çG2¢¢ ¢ÒÆFV6Æ&F–öâW7B–ç7G'VÖVçFVRÂ¦Ö—2÷F–Ö—6VR÷W"&VGV—&RVâ6÷W@¢ÒÆ6Æ76–f–6F–öâf÷W&æ—76WW"æR6öææ:çBV7VæR6Ì:’FR6L:–v÷&–RÜ:—F–W"VâGW"¢VÆÆR66÷&RVæ—VVÖVçBÆW27W7Fö×5ö6FVv÷&–W27F—fW2WBÆWW"6Æ76–f–6F–öå÷FW&×26öæf–wW,:¢Ò6’ÆR&öGV—B,:–VÂæRW&ÖWB2Vâ6Æ76VÖVçB7Vff—6ÖÖVçBf–&ÆRÂVæRff–æ—L:’FÖ–æ—7G&&ÆR÷'L:–R"Æ6÷W2Ö6L:–v÷&–R&÷WF—VRWWBf÷W&æ—"Æ6L:–v÷&–RF÷Væœ:‡&R7F—fRÆÇW2&ö6†R²6WGFRff–æ—L:’æR&–ÖR¦Ö—2VâÖF6‚f÷W&æ—76WW"ÖVF—VÒö†–v€ ¢¢¤÷vç2¢¢¢7W7Fö×5ö6FVv÷&–W6Â7W7Fö×5÷6†—ÖVçEöfVW6Â7W7Fö×5÷6†—ÖVçE÷&6VÅöWfVçG6Â7W7Fö×5÷6†—ÖVçE÷&6VÇ6Â7W7Fö×5÷6†—ÖVçG6 ¢¢¥w&—FW2†æ÷B÷væW"’¢¢¢÷&FW%ö—FVÕ÷&VÅö6÷7EöÆÆö6F–öç6‡w&—FW"Öæ÷BÖ÷væW" ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â#…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢FÖ–âÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â6÷W&6–ær„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢3Rf–6†–W"‡2’L:–6Æ,:’‡2¢ÒF6‚¢ ¢ÒÖ–w&F–öç2¢€¢Ò&÷WFW2¢0¢Ò6W'f–6W2¢P¢ÒFW7G2¢p ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&7W7Fö×2%Õğ ¢22F6†&ö&@ ¢¢¤¶–æB¢¢¢'W6–æW72×G&ç7fW'6Â+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢W‡÷6W"ÆW2w,:–vG2FR–Æ÷FvRWB÷'FW"Vâ÷'F–Â–çFW&æR6æöæ–6ÂVæ–fœ:’66W76–&ÆRFWV—2öFÖ–âÂFöçBÆæf–vF–öâWBÆW2v÷&·76W26öçBFL:—2R,;FÆRÂW‚66÷W2Ö&6Œ:’WBW‚6&–Æ—F–W2,:—6öÇW2<;GL:’6W'fWW"Â6ç2,:—WF–Æ—6W"ÆW2FWW‚|:–ì:—&F–öç2†—7F÷&—VW2FRF6†&ö&G2à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò&÷WFW2w,:–|:–W2F6†&ö&BFÖ–â„µ—2Â6Æ–VçG2Â÷:—&F–öç2Â‡V"Â&VÆ—2Â&F"Â&—7VW2¢ÒVW&–W2FRÜ:—G&—VW2WB66†RF6†&ö&@¢ÒÆVv7’¢V&Æ–2öF6†&ö&G2öFÖ–âò¢¢(	B'VçF–ÖR7GVVÂÂvVÌ:’VâÖ–çFVææ6R6÷'&V7F—fRWB&öÆÆ&6²Væ—VVÖVç@¢ÒÆVv7’¢V&Æ–2öF6†&ö&G2öFÖ–âÖÆVv7’ò¢¢(	B|:–ì:—&F–öâçL:—&–WW&RFW&V6FVBÂ6öç6W'fF–öâ†—7F÷&—VR÷&öÆÆ&6°¢Ò6æöæ–6Â¢V&Æ–2öF6†&ö&G2ö6æöæ–6Âò¢¢(	B6WVÆR6–&ÆRWF÷&—<:–R÷W"F÷WBæ÷WfVRL:—fVÆ÷VÖVçBF6†&ö&@¢Ò÷'F–Â–çFW&æRVæ—VRöFÖ–â(	BÜ:¦ÖR6†VÆÂ6æöæ–6Â÷W"FÖ–æ—7G&F–öâ6VçG&ÆRÂ÷:—&FWW'2—2WB,;FÆW2FW'&–âWF÷&—<:—0¢Ò÷W&F–öç2v÷&·76R¢ÆW2,;FÆW2FW'&–âæF–g2&W7FVçB6ö×F–&ÆW2²VæRÖVÖ&W'6†——2WWBWŒ:–7WFW"VæR×WFF–öâ6WVÆVÖVçBfV2Æ6&–Æ—G’W†V7WF–öââ¢W†7FRÂ,:—6öÇVRWBVF—L:–R"Ö&¶WBÖFVÆVvF–öà¢ÒW76R6æöæ—VR*²6†G2f÷W&æ—76WW'2+²‚öFÖ–â÷v÷&·76W2÷W&6†6–ærÂFöÖ–æR÷:—&F–öç2Â,;FÆRFÖ–â’¢:–7&âFRÆV7GW&Rö7F–öâ7W"ÆW2&÷WFW2ö’÷W&6†6–ærW†—7FçFW2†Æ–væW2÷WfW'FW2w&÷W:–W2f÷W&æ—76WW"²‡V"Â,:—&F–öâFR'&÷V–ÆÆöâÂL:—F6†VÖVçBÂ6÷VÖ—76–öâÂ6öæf—&ÖF–öâ'F–VÆÆR’(	BÆÆöv—VRWBÆW2×WFF–öç2&W7FVçBFç2ÆfVGW&RW&6†6–æp¢ÒÖ–æ’Ö‡V"6æöæ–6Â‚öFÖ–âö‡V"’¢FWW‚'&æ6†W2FÖ–æ—7G&F—fW2WB÷:—&F–öææVÆÆW2Âf–ÆRFRF÷76–W'2:vV6†RÆ–ÖVçL:–R"&ö¦V7F–öç2&÷&œ:—F—&W2W†—7FçFW2ÂææVRFRG&f–Â:G&ö—FR,:—WF–Æ—6çBÆW2ÖöGVÆW26†G2ô‡V"Æ—fR²V7VæR×WFF–öâæ’W&Ö—76–öâ6Æ–VçB&ÆÌ:†ÆP¢ÒWF†VçF–f–6F–öâ6öÖ×VæRV—2ÆæF–æröæf–vF–öâ6öçFW‡GVVÆÆW2²ÆW2FVWÖÆ–æ·2öFÖ–âò¢¢&W7FVçBFW2FW7F–æF–öç2Â2FW2÷'F–Ç2<:—,:—0¢ÒFÖ–ä6öçFW‡B6æöæ–6Â(	B&ö¦V7F–öâT’BwVæRWF÷&—L:’Ö&¶WBL:–¬:,:—6öÇVR<;GL:’6W'fWW"Â¦Ö—2VæR6÷W&6RBvWF÷&—6F–öâÆö6ÆP¢ÒÆöv—7F–726öçG&öÂF÷vW"6æöæ–6Â¢&ö¦V7F–öâ&VBÖöæÇ’VæB×FòÖVæBBVæR6öÖÖæFRÖ&¶WBFRÂVævvVÖVçB6Æ–VçBR&VÆ—2ÂÖöçG&çB7W'&VçE÷7FvR²†VÇF‚²6W6R²f–Æ–F–öâ6ç27,:–W"FRÆ–fV7–6ÆRÂ7FGWB÷Rl:—&—L:’Ü:—F–W"&ÆÌ:†ÆP¢ÒF÷W"FR6öçG,;FÆRæ—fVR¢6–ç†6W2w&†—VW2&Vw&÷WVçBÆW2æWVb:—FW26æöæ—VW2WB6†VR6öÖÖæFR&W7FRVæ—VR:6öâ:—FRv÷WfW&æçFR²6÷W2Ü:—FRÂ6÷VÆWW"WB6W6Rf—6–&ÆW2Fç2Æ6'FR²&÷VvR6–væ–f–R7F–öâ&WV—6RÂ÷&ævR&W÷6R7W"Vâg&’6–væÂÜ:—F–W"Â¦Ö—27W"G&VçFRÖ–çWFW2B–æ7F—f—L:’²L:—F–Â–çL:–w,:’ÂÆ–VâfW'2W76R&÷&œ:—F—&R6÷VÖ—2R,;FÆR²ÆW26W6W27G'V7GW&VÆÆW2w,:†vVçBFW2f—G26æöæ—VW26öÖ×Vç0¢Ò6æöæ–6Â&VfW&Væ6R&W6öÇfW"¢,:—6öÇWF–öâ&VBÖöæÇ’BVæR,:–l:—&Væ6R÷:—&F–öææVÆÆRfW'26öâ–FVçF—L:’&÷&œ:—F—&RÂ66öÖÖæFR6Æ–VçFRÂ6÷6—F–öâ6öçG&öÂF÷vW"WB6FW7F–æF–öâ6æöæ—VR²V7VæRW'6—7Fæ6RÂV7Vâ7FGWB&ÆÌ:†ÆRÂV7VæR:–Ì:—fF–öâBWF÷&—L:¢ÒWF‚ÖwV&BWB6ö×÷6çG2'F|:—2FW2'VçF–ÖW2†—7F÷&—VW2FçB^(	––Ç2&W7FVçB6W'f—0¢Òö÷WEò ¢Ò×WFF–öç2FRFöæì:–W2†6†VRfVGW&RÜ:—F–W"÷vç26W2×WFF–öç2¢ÒÆöv—VRæ–W"Â6öÖÖæFW2Â–VÖVçG2†fVGW&R÷&FW'2ò–ÖVçG2ò6†&VBÖ6'B¢ÒÖ÷FWW"F&–f—&R†fVGW&RV6öæöÖ–2ÖVæv–æR¢Òæ÷WfVRL:—fVÆ÷VÖVçBF6†&ö&B6÷W2V&Æ–2öF6†&ö&G2öFÖ–âò¢¢÷RV&Æ–2öF6†&ö&G2öFÖ–âÖÆVv7’ò¢¢†÷'26÷'&V7F–bW‡Æ–6—FP¢Ò–×÷'B÷RŒ:—&—FvRT’FRFÖ–âò¢¢÷RFÖ–âÖÆVv7’ò¢¢FWV—26æöæ–6Âò¢ ¢ÒÖ–w&F–öâ:–7&â×"Ü:–7&âFW2æ6–VææW2gVW2¢VÆÆW26öçBFW26÷W&6W2FR&W6ö–ç2Â2FW2Væ—L:—2:÷'FW ¢ÒW'6—7Fæ6RBVâ:—FB6öçG&öÂF÷vW"6öæ7W'&VçB¢7W'&VçE÷7FvRö†VÇF‚&W7FVçBFW2&ö¦V7F–öç2L:—&—l:–W2FW2fVGW&W2&÷&œ:—F—&W2²F÷WFRÖL:—&–Æ—6F–öâgWGW&RW†–vRVâ&W6ö–âFRW&f÷&Öæ6RÖW7W,: ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WB¦÷WBFR&÷WFRw,:–|:–R÷RFR&W\:§FRFRÜ:—G&—VW2Fö—B:§G&RfÆ–L:’"ÆR&÷&œ:—F—&RFRF6†&ö&BÖÖWG&–72æ§2WBF6†&ö&BÖ66†Ræ§0 ¢¢¤–çf&–çG2¢¢ ¢ÒF6†&ö&Bw,:†vRVâÆV7GW&R÷W"ÆW2gVW2FR–Æ÷FvR÷&W÷'F–ær„6öçG&öÂF÷vW"Â–Æ÷FvRÂ6çL:’Â6Æ–VçG2Â&F"Â&—7VW2’¢6W27W&f6W2ÖÌ:æR×WFVçBV7VæRFöæì:–Râ8Âv–çfW'6RÂÆW2&÷WFW2‡V"÷&VÆ—2öFÖ–â÷:—&F–öææVÆÆW2‡fö—"F"çF&ÆW2VçG,:–W2rõ%r’:–7&—fVçB,:–VÆÆVÖVçB(	Bæ6–Vâ–çf&–çB&ÆV7GW&R6WVÆR"6÷'&–|:’RÆ÷BóãRƒ##bÓrÓ"’6"6öçG&VF—B"ÆR6öFR²fö—"FV'Bæ¶æ÷väv2÷W"ÆRÆâFR&VF—7G&–'WF–öâFR6W2×WFF–öç2fW'2ÆWW'2fVGW&W2&÷&œ:—F—&W0¢ÒÆW2Ü:—G&—VW276VçB"F6†&ö&BÖ66†Ræ§2‡2FR&W\:§FW2F—&V7FW2GWÆ—\:–W2¢ÒÆVv7’V&Æ–2öF6†&ö&G2öFÖ–âÖÆVv7’ò¢¢W7BFW&V6FVBWBæR&\:vö—BV7Vâæ÷WfVRL:—fVÆ÷VÖVç@¢ÒÆVv7’V&Æ–2öF6†&ö&G2öFÖ–âò¢¢&W7FR6W'f’Ö—2W7BvVÌ:’¢6÷'&V7F–g2WB&öÆÆ&6²Væ—VVÖVçBÂV7VæRæ÷WfVÆÆR66—L:’F6†&ö&@¢Ò6æöæ–6ÂV&Æ–2öF6†&ö&G2ö6æöæ–6Âò¢¢W7BÆ6WVÆR6–&ÆRFRL:—fVÆ÷VÖVçBFW2VG&RF6†&ö&G2gWGW'2¢–Æ÷FvRÂ6öÖÖW&6RÂ÷:—&F–öç2Âf–ææ6P¢Ò6æöæ–6Âò¢¢æR,:–l:—&Væ6Ræ’î(	––×÷'FRV7Vâ6öFR÷R552FRFÖ–âò¢¢÷RFÖ–âÖÆVv7’ò¢¢²ÆW2æ6–VææW2gVW2æR6W'fVçBVRFR6÷W&6W2FR&W6ö–ç0¢ÒöFÖ–âW7BÆ÷'FRN(	–VçG,:–R–çFW&æRVæ—VR²ÆW2U$Ç2öFÖ–âò¢¢7:–6–Æ—<:–W26öçBFW2FW7F–æF–öç2öFVWÖÆ–æ·2WBæöâFW2÷'F–Ç2Ü:—F–W'2<:—,:—0¢ÒWF†VçF–f–6F–öâWBWF÷&—6F–öâ&W7FVçB<:—,:–W2¢Æöv–â:—F&Æ—BÎ(	––FVçF—L:’ÂÆR'VçF–ÖRWBÆW2—26W'fWW"6öçG,;FÆVçB,;FÆRÂ66÷RÂÖ&¶WB”BWB6&–Æ—F–W0¢ÒVâgWGW"õEWWB&Væf÷&6W"Æ&WWfRN(	––FVçF—L:’÷RVæR7F–öâ6Vç6–&ÆR6ç2FWfVæ—"VæR6÷W&6RFR,;FÆRÂ66÷RÂÖ&¶WB”B÷R6&–Æ—G¢ÒöFÖ–âÖæW‡B6W'B6æöæ–6ÂVæFçBÆ6öç7G'V7F–öâ²ÆW2&÷WFW2öFÖ–âò¢&W7FVçB7W"ÆVv7’§W7^(	–R7WF÷fW"W‡Æ–6—FVÖVçBfÆ–L:¢ÒWF‚ÖwV&Bæ§2&÷L:†vRF÷WFW2ÆW2&÷WFW2FÖ–â†—7F÷&—VW2²6æöæ–6ÂfÆ–FR66W76–öâR&ö÷G7G&WBæR6öçF÷W&æR¦Ö—2ö’öWF‚öÖP¢Ò¶öÖW&6R6VçG&ÂWBÆW2'FVæ—&W2—2'FvVçBÆRÜ:¦ÖR'VçF–ÖR6æöæ–6Â¢V7VæRf&–çFR÷R6÷–R"Ö&6Œ:¢ÒÆR,;FÆRfW'F–6ÂæRFöææR¦Ö—2Vâ66÷R—2²F÷WFRWF÷&—L:’Ö&¶WBW7B,:—6öÇVR<;GL:’6W'fWW"V—2Æ—\:–RfçBw,:–vF–öà¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢ÒVâf–ÇG&R—2GRF6†&ö&E66†VÖW7B,:—6VçFF–öææVÂ¢6æöæ–6ÂæR6†&vR¦Ö—2Vâw,:–vBvÆö&Â÷W"ÆRf–ÇG&W"Vç7V—FR<;GL:’6Æ–Vç@¢ÒÖ&¶WBW7BÂwVæ—L:’FRL:–Ì:–vF–öâ'W6–æW72²6÷'&–F÷"&W7FRVæRF–ÖVç6–öâFV6†æ—VRöÆöv—7F—VR6ç2WF÷&—L:¢ÒÆR6ö6·—BL:–Öòò7Fv–æræR÷7<:†FRV7VæRG&ç6—F–öâ¢–ÂL:–Ì:†wVR:Æ&÷WFR÷&FW'2WBÆ—BÆW2æ÷F–f–6F–öç2öFö7VÖVçG2,:–VÆÆVÖVçBW'6—7L:—0¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ ¢¢¤÷vç2¢¢¢7W7Fö×5÷6†—ÖVçEö†öÆG6Â÷&FW%ö–æ6–FVçG6Â'FæW'6 ¢¢¥w&—FW2†æ÷B÷væW"’¢¢¢&6¶WEö—FV×6‡w&—FW"Öæ÷BÖ÷væW"’Â&6¶WG6‡w&—FW"Öæ÷BÖ÷væW"’Â–çfö–6W6‡w&—FW"Öæ÷BÖ÷væW"’Â÷&FW%ö6öÖÖVçG6‡w&—FW"Öæ÷BÖ÷væW"’Â÷&FW%ö—FV×6‡w&—FW"Öæ÷BÖ÷væW"’Â÷&FW%÷7FGW5ö†—7F÷'–‡w&—FW"Öæ÷BÖ÷væW"’Â÷&FW'6‡w&—FW"Öæ÷BÖ÷væW"’Â&6VÅö—FV×6‡w&—FW"Öæ÷BÖ÷væW"’Â&6VÇ6‡w&—FW"Öæ÷BÖ÷væW"’Â&öGV7G6‡w&—FW"Öæ÷BÖ÷væW"’Â&V6—–VçG6‡w&—FW"Öæ÷BÖ÷væW"’Â&VÆ—6‡w&—FW"Öæ÷BÖ÷væW"’Â66åöWfVçG6‡w&—FW"Öæ÷BÖ÷væW"’Â6×5öÆöv‡w&—FW"Öæ÷BÖ÷væW"’ÂvÆÆWEö6öç7V×F–öç6‡w&—FW"Öæ÷BÖ÷væW"’ÂvÆÆWEö7&VF—EöÆ÷G6‡w&—FW"Öæ÷BÖ÷væW"’ÂvÆÆWE÷G&ç67F–öç6‡w&—FW"Öæ÷BÖ÷væW"’ÂvÆÆWG6‡w&—FW"Öæ÷BÖ÷væW" ¢¢¤W‡÷6Ú±î¸Â¸­yêë¢°k¢G§¦*^e : 1
  - migrations : 26
  - routes : 7
  - schemas : 5
  - scripts : 35
  - services : 88
  - tests : 211
  - utils : 1

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="catalog"]_

## customs

**Kind** : business-feature  Â·  **Status** : production

**Service** : Classer et declarer un colis douanierement ; la declaration est le pivot, jamais une optimisation.

**Perimeter** :
- _in_ :
  - classification douaniere
  - analytics douane
  - categories et shipments admin douane
- _out_ :
  - transport physique du colis (feature logistics, qui consomme le statut douane)
  - generation de la facture douane document (feature documents)

**Authority** : backend-core â€” toute regle de classification doit etre validee par le proprietaire de customs-classification.js, conformement a docs/doctrine/DOUANE_DECLARATION_PIVOT.md

**Invariants** :
- la declaration est instrumentee, jamais optimisee pour reduire un cout
- la classification fournisseur ne connaÃ®t aucune clÃ© de catÃ©gorie mÃ©tier en dur : elle score uniquement les customs_categories actives et leur classification_terms configurÃ©
- si le produit rÃ©el ne permet pas un classement suffisamment fiable, une affinitÃ© administrable portÃ©e par la sous-catÃ©gorie boutique peut fournir la catÃ©gorie douaniÃ¨re active la plus proche ; cette affinitÃ© ne prime jamais un match fournisseur medium/high

**Owns** : `customs_categories`, `customs_shipment_fees`, `customs_shipment_parcel_events`, `customs_shipment_parcels`, `customs_shipments`
**Writes (not owner)** : `order_item_real_cost_allocations` (writer-not-owner)

**Exposes** : 0 internal API(s), 20 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : ğŸŸ¢ HEALTHY â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 35 fichier(s) dÃ©clarÃ©(s)
  - dash : 2
  - migrations : 8
  - routes : 3
  - services : 5
  - tests : 17

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="customs"]_

## dashboard

**Kind** : business-transversal  Â·  **Status** : production

**Service** : Exposer les agrÃ©gats de pilotage et porter un portail interne Canonical unifiÃ© accessible depuis /admin, dont la navigation et les workspaces sont adaptÃ©s au rÃ´le, aux scopes marchÃ© et aux capabilities rÃ©solus cÃ´tÃ© serveur, sans rÃ©utiliser les deux gÃ©nÃ©rations historiques de dashboards.

**Perimeter** :
- _in_ :
  - routes agrÃ©gÃ©es dashboard admin (KPIs, clients, opÃ©rations, hub, relais, radar, risques)
  - queries de mÃ©triques et cache dashboard
  - Legacy 1 : public/dashboards/admin/** â€” runtime actuel, gelÃ© en maintenance corrective et rollback uniquement
  - Legacy 0 : public/dashboards/admin-legacy/** â€” gÃ©nÃ©ration antÃ©rieure deprecated, conservation historique/rollback
  - Canonical : public/dashboards/canonical/** â€” seule cible autorisÃ©e pour tout nouveau dÃ©veloppement dashboard
  - Portail interne unique /admin â€” mÃªme shell Canonical pour administration centrale, opÃ©rateurs pays et rÃ´les terrain autorisÃ©s
  - Operations Workspace : les rÃ´les terrain natifs restent compatibles ; une membership pays peut exÃ©cuter une mutation seulement avec la capability execution.* exacte, rÃ©solue et auditÃ©e par market-delegation
  - Espace canonique Â« Achats fournisseurs Â» (/admin/workspaces/purchasing, domaine OpÃ©rations, rÃ´le admin) : Ã©cran de lecture/action sur les routes /api/purchasing existantes (lignes ouvertes groupÃ©es fournisseur + Hub, prÃ©paration de brouillon, dÃ©tachement, soumission, confirmation partielle) â€” la logique et les mutations restent dans la feature purchasing
  - Mini-app Hub Canonical (/admin/hub) : deux branches administratives et opÃ©rationnelles, file de dossiers Ã  gauche alimentÃ©e par projections propriÃ©taires existantes, panneau de travail Ã  droite rÃ©utilisant les modules Achats/Hub Live ; aucune mutation ni permission client parallÃ¨le
  - Authentification commune puis landing/navigation contextuelles ; les deep-links /admin/** restent des destinations, pas des portails sÃ©parÃ©s
  - AdminContext canonical â€” projection UI d'une autoritÃ© market dÃ©jÃ  rÃ©solue cÃ´tÃ© serveur, jamais une source d'autorisation locale
  - Logistics Control Tower canonical : projection read-only end-to-end d une commande Market de l engagement client au relais, montrant current_stage + health + cause + filiation sans crÃ©er de lifecycle, statut ou vÃ©ritÃ© mÃ©tier parallÃ¨le
  - Tour de contrÃ´le niveau 1 : cinq phases graphiques regroupent les neuf Ã©tapes canoniques et chaque commande reste unique Ã  son Ã©tape gouvernante ; sous-Ã©tape, couleur et cause visibles dans la carte ; rouge signifie action requise, orange repose sur un vrai signal mÃ©tier, jamais sur trente minutes d inactivitÃ© ; dÃ©tail intÃ©grÃ©, lien vers espace propriÃ©taire soumis au rÃ´le ; les causes structurelles agrÃ¨gent des faits canoniques communs
  - Canonical Reference Resolver : rÃ©solution read-only d une rÃ©fÃ©rence opÃ©rationnelle vers son identitÃ© propriÃ©taire, sa commande cliente, sa position Control Tower et sa destination canonique ; aucune persistance, aucun statut parallÃ¨le, aucune Ã©lÃ©vation d autoritÃ©
  - auth-guard et composants partagÃ©s des runtimes historiques tant quâ€™ils restent servis
- _out_ :
  - mutations de donnÃ©es (chaque feature mÃ©tier owns ses mutations)
  - logique panier, commandes, paiements (feature orders / payments / shared-cart)
  - moteur tarifaire (feature economic-engine)
  - nouveau dÃ©veloppement dashboard sous public/dashboards/admin/** ou public/dashboards/admin-legacy/** hors correctif explicite
  - import ou hÃ©ritage UI de admin/** ou admin-legacy/** depuis canonical/**
  - migration Ã©cran-par-Ã©cran des anciennes vues : elles sont des sources de besoins, pas des unitÃ©s Ã  porter
  - persistance d un Ã©tat Control Tower concurrent : current_stage/health restent des projections dÃ©rivÃ©es des features propriÃ©taires ; toute matÃ©rialisation future exige un besoin de performance mesurÃ©

**Authority** : backend-core â€” tout ajout de route agrÃ©gÃ©e ou de requÃªte de mÃ©triques doit Ãªtre validÃ© par le propriÃ©taire de dashboard-metrics.js et dashboard-cache.js

**Invariants** :
- dashboard agrÃ¨ge en lecture pour les vues de pilotage/reporting (Control Tower, Pilotage, SantÃ©, Clients, radar, risques) : ces surfaces-lÃ  ne mutent aucune donnÃ©e. Ã€ l'inverse, les routes hub/relais/admin opÃ©rationnelles (voir db.tables entrÃ©es W/RW) Ã©crivent rÃ©ellement â€” ancien invariant "lecture seule" corrigÃ© au Lot O1.5 (2026-07-12) car contredit par le code ; voir debt.knownGaps pour le plan de redistribution de ces mutations vers leurs features propriÃ©taires
- les mÃ©triques passent par dashboard-cache.js (pas de requÃªtes directes dupliquÃ©es)
- Legacy 0 public/dashboards/admin-legacy/** est deprecated et ne reÃ§oit aucun nouveau dÃ©veloppement
- Legacy 1 public/dashboards/admin/** reste servi mais est gelÃ© : correctifs et rollback uniquement, aucune nouvelle capacitÃ© dashboard
- Canonical public/dashboards/canonical/** est la seule cible de dÃ©veloppement des quatre dashboards futurs : Pilotage, Commerce, OpÃ©rations, Finance
- canonical/** ne rÃ©fÃ©rence ni nâ€™importe aucun code ou CSS de admin/** ou admin-legacy/** ; les anciennes vues ne servent que de sources de besoins
- /admin est la porte dâ€™entrÃ©e interne unique ; les URLs /admin/** spÃ©cialisÃ©es sont des destinations/deep-links et non des portails mÃ©tiers sÃ©parÃ©s
- authentification et autorisation restent sÃ©parÃ©es : login Ã©tablit lâ€™identitÃ©, le runtime et les APIs serveur contrÃ´lent rÃ´le, scope, Market ID et capabilities
- un futur OTP peut renforcer la preuve dâ€™identitÃ© ou une action sensible sans devenir une source de rÃ´le, scope, Market ID ou capability
- /admin-next sert canonical pendant la construction ; les routes /admin/* restent sur Legacy 1 jusquâ€™au cutover explicitement validÃ©
- auth-guard.js protÃ¨ge toutes les routes admin historiques ; canonical valide sa session au bootstrap et ne contourne jamais /api/auth/me
- Komerce central et les partenaires pays partagent le mÃªme runtime canonical : aucune variante ou copie par marchÃ©
- le rÃ´le vertical ne donne jamais un scope pays ; toute autoritÃ© market est rÃ©solue cÃ´tÃ© serveur puis appliquÃ©e avant agrÃ©gation
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- un filtre pays du DashboardSchema est prÃ©sentationnel : canonical ne charge jamais un agrÃ©gat global pour le filtrer ensuite cÃ´tÃ© client
- market est l'unitÃ© de dÃ©lÃ©gation business ; corridor reste une dimension technique/logistique sans autoritÃ©
- le cockpit DÃ©mo / Staging ne possÃ¨de aucune transition : il dÃ©lÃ¨gue Ã  la route orders et lit les notifications/documents rÃ©ellement persistÃ©s
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]

**Owns** : `customs_shipment_holds`, `order_incidents`, `partners`
**Writes (not owner)** : `basket_items` (writer-not-owner), `baskets` (writer-not-owner), `invoices` (writer-not-owner), `order_comments` (writer-not-owner), `order_items` (writer-not-owner), `order_status_history` (writer-not-owner), `orders` (writer-not-owner), `parcel_items` (writer-not-owner), `parcels` (writer-not-owner), `products` (writer-not-owner), `recipients` (writer-not-owner), `relais` (writer-not-owner), `scan_events` (writer-not-owner), `sms_log` (writer-not-owner), `wallet_consumptions` (writer-not-owner), `wallet_credit_lots` (writer-not-owner), `wallet_transactions` (writer-not-owner), `wallets` (writer-not-owner)

**Exposes** : 0 internal API(s), 89 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), external-provider-contracts (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), supplier-connectivity (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), market-control-plane (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitivem«ëŒ+Š×®º+º$zzb¥ç&EÒ	ùKBdTEU$RÔuT$B(	BFöÖ–âÖ—6ÖF6‚¢ââö§2÷&öGV7BÖ–ÖvRÖÆöF–ær×W‚æ§2FV6Æ&RFöÖ–â&&÷WF—VR"Ö—2W7BÆ—7FRFç26FÆöræfVGW&Ræ§2†FöÖ–â&6FÆör" ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢CS’f–6†–W"‡2’L:–6Æ,:’‡2’Â&÷WF—VS¢32f–6†–W"‡2¢Ò&÷WF—VR¢3¢Ò6’¢#P¢Ò6öæf–r¢¢ÒF6‚¢¢ÒFö72¢¢ÒÖ–FFÆWv&R¢¢ÒÖ–w&F–öç2¢#`¢Ò&÷WFW2¢p¢Ò66†VÖ2¢P¢Ò67&—G2¢3P¢Ò6W'f–6W2¢ƒ€¢ÒFW7G2¢#¢ÒWF–Ç2¢ ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&6FÆör%Õğ ¢227W7Fö×0 ¢¢¤¶–æB¢¢¢'W6–æW72ÖfVGW&R+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢6Æ76W"WBFV6Æ&W"Vâ6öÆ—2F÷Væ–W&VÖVçB²ÆFV6Æ&F–öâW7BÆR—f÷BÂ¦Ö—2VæR÷F–Ö—6F–öâà ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò6Æ76–f–6F–öâF÷Væ–W&P¢ÒæÇ—F–72F÷VæP¢Ò6FVv÷&–W2WB6†—ÖVçG2FÖ–âF÷VæP¢Òö÷WEò ¢ÒG&ç7÷'B‡—6—VRGR6öÆ—2†fVGW&RÆöv—7F–72ÂV’6öç6öÖÖRÆR7FGWBF÷VæR¢ÒvVæW&F–öâFRÆf7GW&RF÷VæRFö7VÖVçB†fVGW&RFö7VÖVçG2 ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WFR&VvÆRFR6Æ76–f–6F–öâFö—BWG&RfÆ–FVR"ÆR&÷&–WF—&RFR7W7Fö×2Ö6Æ76–f–6F–öâæ§2Â6öæf÷&ÖVÖVçBFö72öFö7G&–æRôDõTäUôDT4Ä$D”ôåõ•dõBæÖ@ ¢¢¤–çf&–çG2¢¢ ¢ÒÆFV6Æ&F–öâW7B–ç7G'VÖVçFVRÂ¦Ö—2÷F–Ö—6VR÷W"&VGV—&RVâ6÷W@¢ÒÆ6Æ76–f–6F–öâf÷W&æ—76WW"æR6öææ:çBV7VæR6Ì:’FR6L:–v÷&–RÜ:—F–W"VâGW"¢VÆÆR66÷&RVæ—VVÖVçBÆW27W7Fö×5ö6FVv÷&–W27F—fW2WBÆWW"6Æ76–f–6F–öå÷FW&×26öæf–wW,:¢Ò6’ÆR&öGV—B,:–VÂæRW&ÖWB2Vâ6Æ76VÖVçB7Vff—6ÖÖVçBf–&ÆRÂVæRff–æ—L:’FÖ–æ—7G&&ÆR÷'L:–R"Æ6÷W2Ö6L:–v÷&–R&÷WF—VRWWBf÷W&æ—"Æ6L:–v÷&–RF÷Væœ:‡&R7F—fRÆÇW2&ö6†R²6WGFRff–æ—L:’æR&–ÖR¦Ö—2VâÖF6‚f÷W&æ—76WW"ÖVF—VÒö†–v€ ¢¢¤÷vç2¢¢¢7W7Fö×5ö6FVv÷&–W6Â7W7Fö×5÷6†—ÖVçEöfVW6Â7W7Fö×5÷6†—ÖVçE÷&6VÅöWfVçG6Â7W7Fö×5÷6†—ÖVçE÷&6VÇ6Â7W7Fö×5÷6†—ÖVçG6 ¢¢¥w&—FW2†æ÷B÷væW"’¢¢¢÷&FW%ö—FVÕ÷&VÅö6÷7EöÆÆö6F–öç6‡w&—FW"Öæ÷BÖ÷væW" ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â#…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢FÖ–âÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â6÷W&6–ær„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢3Rf–6†–W"‡2’L:–6Æ,:’‡2¢ÒF6‚¢ ¢ÒÖ–w&F–öç2¢€¢Ò&÷WFW2¢0¢Ò6W'f–6W2¢P¢ÒFW7G2¢p ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&7W7Fö×2%Õğ ¢22F6†&ö&@ ¢¢¤¶–æB¢¢¢'W6–æW72×G&ç7fW'6Â+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢W‡÷6W"ÆW2w,:–vG2FR–Æ÷FvRWB÷'FW"Vâ÷'F–Â–çFW&æR6æöæ–6ÂVæ–fœ:’66W76–&ÆRFWV—2öFÖ–âÂFöçBÆæf–vF–öâWBÆW2v÷&·76W26öçBFL:—2R,;FÆRÂW‚66÷W2Ö&6Œ:’WBW‚6&–Æ—F–W2,:—6öÇW2<;GL:’6W'fWW"Â6ç2,:—WF–Æ—6W"ÆW2FWW‚|:–ì:—&F–öç2†—7F÷&—VW2FRF6†&ö&G2à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò&÷WFW2w,:–|:–W2F6†&ö&BFÖ–â„µ—2Â6Æ–VçG2Â÷:—&F–öç2Â‡V"Â&VÆ—2Â&F"Â&—7VW2¢ÒVW&–W2FRÜ:—G&—VW2WB66†RF6†&ö&@¢ÒÆVv7’¢V&Æ–2öF6†&ö&G2öFÖ–âò¢¢(	B'VçF–ÖR7GVVÂÂvVÌ:’VâÖ–çFVææ6R6÷'&V7F—fRWB&öÆÆ&6²Væ—VVÖVç@¢ÒÆVv7’¢V&Æ–2öF6†&ö&G2öFÖ–âÖÆVv7’ò¢¢(	B|:–ì:—&F–öâçL:—&–WW&RFW&V6FVBÂ6öç6W'fF–öâ†—7F÷&—VR÷&öÆÆ&6°¢Ò6æöæ–6Â¢V&Æ–2öF6†&ö&G2ö6æöæ–6Âò¢¢(	B6WVÆR6–&ÆRWF÷&—<:–R÷W"F÷WBæ÷WfVRL:—fVÆ÷VÖVçBF6†&ö&@¢Ò÷'F–Â–çFW&æRVæ—VRöFÖ–â(	BÜ:¦ÖR6†VÆÂ6æöæ–6Â÷W"FÖ–æ—7G&F–öâ6VçG&ÆRÂ÷:—&FWW'2—2WB,;FÆW2FW'&–âWF÷&—<:—0¢Ò÷W&F–öç2v÷&·76R¢ÆW2,;FÆW2FW'&–âæF–g2&W7FVçB6ö×F–&ÆW2²VæRÖVÖ&W'6†——2WWBWŒ:–7WFW"VæR×WFF–öâ6WVÆVÖVçBfV2Æ6&–Æ—G’W†V7WF–öââ¢W†7FRÂ,:—6öÇVRWBVF—L:–R"Ö&¶WBÖFVÆVvF–öà¢ÒW76R6æöæ—VR*²6†G2f÷W&æ—76WW'2+²‚öFÖ–â÷v÷&·76W2÷W&6†6–ærÂFöÖ–æR÷:—&F–öç2Â,;FÆRFÖ–â’¢:–7&âFRÆV7GW&Rö7F–öâ7W"ÆW2&÷WFW2ö’÷W&6†6–ærW†—7FçFW2†Æ–væW2÷WfW'FW2w&÷W:–W2f÷W&æ—76WW"²‡V"Â,:—&F–öâFR'&÷V–ÆÆöâÂL:—F6†VÖVçBÂ6÷VÖ—76–öâÂ6öæf—&ÖF–öâ'F–VÆÆR’(	BÆÆöv—VRWBÆW2×WFF–öç2&W7FVçBFç2ÆfVGW&RW&6†6–æp¢ÒÖ–æ’Ö‡V"6æöæ–6Â‚öFÖ–âö‡V"’¢FWW‚'&æ6†W2FÖ–æ—7G&F—fW2WB÷:—&F–öææVÆÆW2Âf–ÆRFRF÷76–W'2:vV6†RÆ–ÖVçL:–R"&ö¦V7F–öç2&÷&œ:—F—&W2W†—7FçFW2ÂææVRFRG&f–Â:G&ö—FR,:—WF–Æ—6çBÆW2ÖöGVÆW26†G2ô‡V"Æ—fR²V7VæR×WFF–öâæ’W&Ö—76–öâ6Æ–VçB&ÆÌ:†ÆP¢ÒWF†VçF–f–6F–öâ6öÖ×VæRV—2ÆæF–æröæf–vF–öâ6öçFW‡GVVÆÆW2²ÆW2FVWÖÆ–æ·2öFÖ–âò¢¢&W7FVçBFW2FW7F–æF–öç2Â2FW2÷'F–Ç2<:—,:—0¢ÒFÖ–ä6öçFW‡B6æöæ–6Â(	B&ö¦V7F–öâT’BwVæRWF÷&—L:’Ö&¶WBL:–¬:,:—6öÇVR<;GL:’6W'fWW"Â¦Ö—2VæR6÷W&6RBvWF÷&—6F–öâÆö6ÆP¢ÒÆöv—7F–726öçG&öÂF÷vW"6æöæ–6Â¢&ö¦V7F–öâ&VBÖöæÇ’VæB×FòÖVæBBVæR6öÖÖæFRÖ&¶WBFRÂVævvVÖVçB6Æ–VçBR&VÆ—2ÂÖöçG&çB7W'&VçE÷7FvR²†VÇF‚²6W6R²f–Æ–F–öâ6ç27,:–W"FRÆ–fV7–6ÆRÂ7FGWB÷Rl:—&—L:’Ü:—F–W"&ÆÌ:†ÆP¢ÒF÷W"FR6öçG,;FÆRæ—fVR¢6–ç†6W2w&†—VW2&Vw&÷WVçBÆW2æWVb:—FW26æöæ—VW2WB6†VR6öÖÖæFR&W7FRVæ—VR:6öâ:—FRv÷WfW&æçFR²6÷W2Ü:—FRÂ6÷VÆWW"WB6W6Rf—6–&ÆW2Fç2Æ6'FR²&÷VvR6–væ–f–R7F–öâ&WV—6RÂ÷&ævR&W÷6R7W"Vâg&’6–væÂÜ:—F–W"Â¦Ö—27W"G&VçFRÖ–çWFW2B–æ7F—f—L:’²L:—F–Â–çL:–w,:’ÂÆ–VâfW'2W76R&÷&œ:—F—&R6÷VÖ—2R,;FÆR²ÆW26W6W27G'V7GW&VÆÆW2w,:†vVçBFW2f—G26æöæ—VW26öÖ×Vç0¢Ò6æöæ–6Â&VfW&Væ6R&W6öÇfW"¢,:—6öÇWF–öâ&VBÖöæÇ’BVæR,:–l:—&Væ6R÷:—&F–öææVÆÆRfW'26öâ–FVçF—L:’&÷&œ:—F—&RÂ66öÖÖæFR6Æ–VçFRÂ6÷6—F–öâ6öçG&öÂF÷vW"WB6FW7F–æF–öâ6æöæ—VR²V7VæRW'6—7Fæ6RÂV7Vâ7FGWB&ÆÌ:†ÆRÂV7VæR:–Ì:—fF–öâBWF÷&—L:¢ÒWF‚ÖwV&BWB6ö×÷6çG2'F|:—2FW2'VçF–ÖW2†—7F÷&—VW2FçB^(	––Ç2&W7FVçB6W'f—0¢Òö÷WEò ¢Ò×WFF–öç2FRFöæì:–W2†6†VRfVGW&RÜ:—F–W"÷vç26W2×WFF–öç2¢ÒÆöv—VRæ–W"Â6öÖÖæFW2Â–VÖVçG2†fVGW&R÷&FW'2ò–ÖVçG2ò6†&VBÖ6'B¢ÒÖ÷FWW"F&–f—&R†fVGW&RV6öæöÖ–2ÖVæv–æR¢Òæ÷WfVRL:—fVÆ÷VÖVçBF6†&ö&B6÷W2V&Æ–2öF6†&ö&G2öFÖ–âò¢¢÷RV&Æ–2öF6†&ö&G2öFÖ–âÖÆVv7’ò¢¢†÷'26÷'&V7F–bW‡Æ–6—FP¢Ò–×÷'B÷RŒ:—&—FvRT’FRFÖ–âò¢¢÷RFÖ–âÖÆVv7’ò¢¢FWV—26æöæ–6Âò¢ ¢ÒÖ–w&F–öâ:–7&â×"Ü:–7&âFW2æ6–VææW2gVW2¢VÆÆW26öçBFW26÷W&6W2FR&W6ö–ç2Â2FW2Væ—L:—2:÷'FW ¢ÒW'6—7Fæ6RBVâ:—FB6öçG&öÂF÷vW"6öæ7W'&VçB¢7W'&VçE÷7FvRö†VÇF‚&W7FVçBFW2&ö¦V7F–öç2L:—&—l:–W2FW2fVGW&W2&÷&œ:—F—&W2²F÷WFRÖL:—&–Æ—6F–öâgWGW&RW†–vRVâ&W6ö–âFRW&f÷&Öæ6RÖW7W,: ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WB¦÷WBFR&÷WFRw,:–|:–R÷RFR&W\:§FRFRÜ:—G&—VW2Fö—B:§G&RfÆ–L:’"ÆR&÷&œ:—F—&RFRF6†&ö&BÖÖWG&–72æ§2WBF6†&ö&BÖ66†Ræ§0 ¢¢¤–çf&–çG2¢¢ ¢ÒF6†&ö&Bw,:†vRVâÆV7GW&R÷W"ÆW2gVW2FR–Æ÷FvR÷&W÷'F–ær„6öçG&öÂF÷vW"Â–Æ÷FvRÂ6çL:’Â6Æ–VçG2Â&F"Â&—7VW2’¢6W27W&f6W2ÖÌ:æR×WFVçBV7VæRFöæì:–Râ8Âv–çfW'6RÂÆW2&÷WFW2‡V"÷&VÆ—2öFÖ–â÷:—&F–öææVÆÆW2‡fö—"F"çF&ÆW2VçG,:–W2rõ%r’:–7&—fVçB,:–VÆÆVÖVçB(	Bæ6–Vâ–çf&–çB&ÆV7GW&R6WVÆR"6÷'&–|:’RÆ÷BóãRƒ##bÓrÓ"’6"6öçG&VF—B"ÆR6öFR²fö—"FV'Bæ¶æ÷väv2÷W"ÆRÆâFR&VF—7G&–'WF–öâFR6W2×WFF–öç2fW'2ÆWW'2fVGW&W2&÷&œ:—F—&W0¢ÒÆW2Ü:—G&—VW276VçB"F6†&ö&BÖ66†Ræ§2‡2FR&W\:§FW2F—&V7FW2GWÆ—\:–W2¢ÒÆVv7’V&Æ–2öF6†&ö&G2öFÖ–âÖÆVv7’ò¢¢W7BFW&V6FVBWBæR&\:vö—BV7Vâæ÷WfVRL:—fVÆ÷VÖVç@¢ÒÆVv7’V&Æ–2öF6†&ö&G2öFÖ–âò¢¢&W7FR6W'f’Ö—2W7BvVÌ:’¢6÷'&V7F–g2WB&öÆÆ&6²Væ—VVÖVçBÂV7VæRæ÷WfVÆÆR66—L:’F6†&ö&@¢Ò6æöæ–6ÂV&Æ–2öF6†&ö&G2ö6æöæ–6Âò¢¢W7BÆ6WVÆR6–&ÆRFRL:—fVÆ÷VÖVçBFW2VG&RF6†&ö&G2gWGW'2¢–Æ÷FvRÂ6öÖÖW&6RÂ÷:—&F–öç2Âf–ææ6P¢Ò6æöæ–6Âò¢¢æR,:–l:—&Væ6Ræ’î(	––×÷'FRV7Vâ6öFR÷R552FRFÖ–âò¢¢÷RFÖ–âÖÆVv7’ò¢¢²ÆW2æ6–VææW2gVW2æR6W'fVçBVRFR6÷W&6W2FR&W6ö–ç0¢ÒöFÖ–âW7BÆ÷'FRN(	–VçG,:–R–çFW&æRVæ—VR²ÆW2U$Ç2öFÖ–âò¢¢7:–6–Æ—<:–W26öçBFW2FW7F–æF–öç2öFVWÖÆ–æ·2WBæöâFW2÷'F–Ç2Ü:—F–W'2<:—,:—0¢ÒWF†VçF–f–6F–öâWBWF÷&—6F–öâ&W7FVçB<:—,:–W2¢Æöv–â:—F&Æ—BÎ(	––FVçF—L:’ÂÆR'VçF–ÖRWBÆW2—26W'fWW"6öçG,;FÆVçB,;FÆRÂ66÷RÂÖ&¶WB”BWB6&–Æ—F–W0¢ÒVâgWGW"õEWWB&Væf÷&6W"Æ&WWfRN(	––FVçF—L:’÷RVæR7F–öâ6Vç6–&ÆR6ç2FWfVæ—"VæR6÷W&6RFR,;FÆRÂ66÷RÂÖ&¶WB”B÷R6&–Æ—G¢ÒöFÖ–âÖæW‡B6W'B6æöæ–6ÂVæFçBÆ6öç7G'V7F–öâ²ÆW2&÷WFW2öFÖ–âò¢&W7FVçB7W"ÆVv7’§W7^(	–R7WF÷fW"W‡Æ–6—FVÖVçBfÆ–L:¢ÒWF‚ÖwV&Bæ§2&÷L:†vRF÷WFW2ÆW2&÷WFW2FÖ–â†—7F÷&—VW2²6æöæ–6ÂfÆ–FR66W76–öâR&ö÷G7G&WBæR6öçF÷W&æR¦Ö—2ö’öWF‚öÖP¢Ò¶öÖW&6R6VçG&ÂWBÆW2'FVæ—&W2—2'FvVçBÆRÜ:¦ÖR'VçF–ÖR6æöæ–6Â¢V7VæRf&–çFR÷R6÷–R"Ö&6Œ:¢ÒÆR,;FÆRfW'F–6ÂæRFöææR¦Ö—2Vâ66÷R—2²F÷WFRWF÷&—L:’Ö&¶WBW7B,:—6öÇVR<;GL:’6W'fWW"V—2Æ—\:–RfçBw,:–vF–öà¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢ÒVâf–ÇG&R—2GRF6†&ö&E66†VÖW7B,:—6VçFF–öææVÂ¢6æöæ–6ÂæR6†&vR¦Ö—2Vâw,:–vBvÆö&Â÷W"ÆRf–ÇG&W"Vç7V—FR<;GL:’6Æ–Vç@¢ÒÖ&¶WBW7BÂwVæ—L:’FRL:–Ì:–vF–öâ'W6–æW72²6÷'&–F÷"&W7FRVæRF–ÖVç6–öâFV6†æ—VRöÆöv—7F—VR6ç2WF÷&—L:¢ÒÆR6ö6·—BL:–Öòò7Fv–æræR÷7<:†FRV7VæRG&ç6—F–öâ¢–ÂL:–Ì:†wVR:Æ&÷WFR÷&FW'2WBÆ—BÆW2æ÷F–f–6F–öç2öFö7VÖVçG2,:–VÆÆVÖVçBW'6—7L:—0¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ ¢¢¤÷vç2¢¢¢7W7Fö×5÷6†—ÖVçEö†öÆG6Â÷&FW%ö–æ6–FVçG6Â'FæW'6 ¢¢¥w&—FW2†æ÷B÷væW"’¢¢¢&6¶WEö—FV×6‡w&—FW"Öæ÷BÖ÷væW"’Â&6¶WG6‡w&—FW"Öæ÷BÖ÷væW"’Â–çfö–6W6‡w&—FW"Öæ÷BÖ÷væW"’Â÷&FW%ö6öÖÖVçG6‡w&—FW"Öæ÷BÖ÷væW"’Â÷&FW%ö—FV×6‡w&—FW"Öæ÷BÖ÷væW"’Â÷&FW%÷7FGW5ö†—7F÷'–‡w&—FW"Öæ÷BÖ÷væW"’Â÷&FW'6‡w&—FW"Öæ÷BÖ÷væW"’Â&6VÅö—FV×6‡w&—FW"Öæ÷BÖ÷væW"’Â&6VÇ6‡w&—FW"Öæ÷BÖ÷væW"’Â&öGV7G6‡w&—FW"Öæ÷BÖ÷væW"’Â&V6—–VçG6‡w&—FW"Öæ÷BÖ÷væW"’Â&VÆ—6‡w&—FW"Öæ÷BÖ÷væW"’Â66åöWfVçG6‡w&—FW"Öæ÷BÖ÷væW"’Â6×5öÆöv‡w&—FW"Öæ÷BÖ÷væW"’ÂvÆÆWEö6öç7V×F–öç6‡w&—FW"Öæ÷BÖ÷væW"’ÂvÆÆWEö7&VF—EöÆ÷G6‡w&—FW"Öæ÷BÖ÷væW"’ÂvÆÆWE÷G&ç67F–öç6‡w&—FW"Öæ÷BÖ÷væW"’ÂvÆÆWG6‡w&—FW"Öæ÷BÖ÷væW" ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Âƒ’…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â'W6–æW72×'VÆW2„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’Â7W7Fö×2„DT4Ä$TEôäEôô%4U%dTB’ÂFV6—6–öâ×6–væÇ2„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’ÂW‡FW&æÂ×&÷f–FW"Ö6öçG&7G2„DT4Ä$TEôäEôô%4U%dTB’Â–æ6–FVçBÖÖævVÖVçB„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’Â–çfVçF÷'’„DT4Ä$TEôäEôô%4U%dTB’ÂÆö6Â×7Fö6²„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB’Âæ÷F–f–6F–öç2„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂW&6†6–ær„DT4Ä$TEôäEôô%4U%dTB’Â&VgVæG2„DT4Ä$TEôäEôô%4U%dTB’Â6†&VBÖ6'B„DT4Ä$TEôäEôô%4U%dTB’Â6÷W&6–ær„DT4Ä$TEôäEôô%4U%dTB’Â7WÆ–W"Ö6öææV7F—f—G’„DT4Ä$TEôäEôô%4U%dTB’ÂvÆÆWB„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢FÖ–âÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFV6—6–öâ×6–væÇ2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ6öçG&öÂ×ÆæR„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â6÷W&6–ær„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fVÚ±î¸Â¸­yêë¢°k¢G§¦*^g partenaire ne demande jamais un credential au hasard : le type, le propriÃ©taire, les prÃ©requis, les actions de crÃ©ation et les Ã©lÃ©ments Ã  obtenir proviennent du contrat fournisseur qualifiÃ©
- l IA peut accÃ©lÃ©rer la lecture et la formalisation mais ne devient jamais l autoritÃ© du contrat : la provenance reste documentation fournisseur, confirmation fournisseur ou preuve runtime explicite
- les adapters provider et les side effects restent possÃ©dÃ©s par leurs features mÃ©tier ; external-provider-contracts ne devient jamais un god-adapter

**Owns** : _aucune_

**Exposes** : 12 internal API(s), 0 HTTP interface(s)
  - `assertConversation` (scripts/provider-contract-proof.js) â€” resolved
  - `assertThrough` (scripts/provider-contract-proof.js) â€” resolved
  - `buildConversation` (scripts/provider-contract-proof.js) â€” resolved
  - `buildProof` (scripts/provider-contract-proof.js) â€” resolved
  - `checkReady` (services/external-provider-onboarding-contracts.js) â€” resolved
  - `publicContract` (services/external-provider-onboarding-contracts.js) â€” resolved
  - `run` (scripts/provider-certification-reconciliation.js) â€” resolved
  - `runBatch` (scripts/external-provider-batch-proof.js) â€” resolved
  - `runEbayBrowseReadOnlyProof` (scripts/ebay-sandbox-browse-proof.js) â€” resolved
  - `runStripeReadOnlyProof` (scripts/stripe-provider-contract-proof.js) â€” resolved
  - _...2 de plus, voir FEATURE_360.json_

**Consumes** : _aucune_
**Consumed by** : catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), supplier-connectivity (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : ğŸŸ¡ ATTENTION â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (1) :
- `DECLARED_NOT_OBSERVED` (low) â€” contract.consumes dÃ©clare "infrastructure" â€” aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 24 fichier(s) dÃ©clarÃ©(s)
  - config : 2
  - scripts : 6
  - services : 1
  - tests : 8
  - workflows : 7

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="external-provider-contracts"]_

## incident-management

**Kind** : business-transversal  Â·  **Status** : production

**Service** : DÃ©tecter, qualifier et rÃ©soudre les Ã©carts entre l'Ã©tat attendu et l'Ã©tat rÃ©el d'une opÃ©ration, avec impact client traÃ§able.

**Perimeter** :
- _in_ :
  - crÃ©ation, qualification (type/sÃ©vÃ©ritÃ©/impact client) et rÃ©solution dâ€™un incident sous autoritÃ© explicite
  - table incidents possÃ©dÃ©e par incident-management ; les producteurs cross-feature passent par incident-write-service.js
  - gouvernance F2 : origin_domain, resolver_domain et resolution_class dÃ©terminÃ©s dÃ¨s la crÃ©ation
  - policy de blocage des transitions physiques irrÃ©versibles consommÃ©e par Logistics
  - F3 : due_at persistant, escalade SLA durable vers Action Center et marqueur dâ€™escalade idempotent
  - F3 : fermeture PHYSICAL_PROOF uniquement aprÃ¨s nouvelle preuve scan_events et revalidation synchrone du prÃ©dicat
  - F3 : fermeture UPSTREAM_TRUTH uniquement aprÃ¨s correction authoritative amont puis revalidation du prÃ©dicat par le caller
  - engagement opÃ©rationnel rÃ©el dÃ©clenchÃ© par une rÃ©solution lorsque lâ€™autoritÃ© le permet
- _out_ :
  - logique mÃ©tier propre au domaine qui a dÃ©tectÃ© l'Ã©cart (logistics, payments, notifications restent propriÃ©taires de leurs propres flux)
  - preuve physique : scan_events reste lifecycle-owned par Logistics
  - correction de vÃ©ritÃ© UPSTREAM_TRUTH : reste propriÃ©taire du domaine resolver_domain ; Incident Management ne fait que revalider/fermer ensuite
  - health check / observation technique passive (feature platform-ops)

**Authority** : backend-core â€” tout changement de lifecycle incident doit etre valide par le proprietaire de services/incident-service.js

**Invariants** :
- jamais de suppression d'incident (soft-close uniquement)
- rÃ©solution explicite avec raison et type
- origin_domain, resolver_domain et resolution_class sont queryables dÃ¨s la crÃ©ation gouvernÃ©e
- tout nouvel incident gouvernÃ© possÃ¨de due_at dÃ©rivÃ© uniquement de resolution_class
- un incident historique UNCLASSIFIED ne peut pas Ãªtre fermÃ© par un chemin terminal gÃ©nÃ©rique
- UPSTREAM_TRUTH ne peut jamais Ãªtre fermÃ© avant correction authoritative amont et revalidation du prÃ©dicat original
- PHYSICAL_PROOF ne peut jamais Ãªtre fermÃ© par un chemin terminal gÃ©nÃ©rique : nouvelle preuve + revalidation sont obligatoires
- une escalade SLA ne rÃ©sout jamais lâ€™incident et atteint un sink durable Action Center
- le marqueur escalation_level et le signal Action Center sont atomiques dans une mÃªme transaction
- scan_events reste append-only/lifecycle-owned par Logistics ; Incident Management ne rÃ©Ã©crit jamais la preuve

**Owns** : `incidents`

**Exposes** : 17 internal API(s), 0 HTTP interface(s)
  - `acknowledgeAlertEngineIncident` (services/incident-write-service.js) â€” resolved
  - `assertParcelTransitionAllowed` (services/parcel-transition-guard.js) â€” resolved
  - `createAlertEngineIncidentIfNew` (services/incident-write-service.js) â€” resolved
  - `createReconciliationIncident` (services/incident-write-service.js) â€” resolved
  - `createScanIncident` (services/incident-write-service.js) â€” resolved
  - `createSupplierShortageIncident` (services/incident-write-service.js) â€” resolved
  - `detachUserFromIncidents` (services/incident-write-service.js) â€” resolved
  - `escalateIncident` (services/incident-service.js) â€” resolved
  - `getIncident` (services/incident-service.js) â€” resolved
  - `getIncidentDashboard` (services/incident-service.js) â€” resolved
  - _...7 de plus, voir FEATURE_360.json_

**Consumes** : decision-signals (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : dashboard (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : ğŸŸ¢ HEALTHY â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 13 fichier(s) dÃ©clarÃ©(s)
  - services : 5
  - tests : 8

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="incident-management"]_

## infrastructure

**Kind** : technical-foundation  Â·  **Status** : production

**Service** : Infrastructure transversale consommÃ©e par toutes les features : middleware non-auth (error-handler, rate-limit, request-id, upload, validate), utilitaires partagÃ©s (logger, phone, rates, reference, rules), barrel de validation Joi, et bootstrap applicatif (Express, routes, crons, env, sÃ©curitÃ©, migrations startup).

**Perimeter** :
- _in_ :
  - middleware non-auth
  - utils transversaux
  - validators
  - bootstrap
- _out_ :
  - middleware auth (feature auth)
  - services mÃ©tier
  - logique backend spÃ©cifique

**Authority** : backend â€” ces fichiers sont consommÃ©s par toutes les features. Tout changement ici a un impact potentiel global.

**Invariants** :
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- tout fichier middleware/ non-auth doit Ãªtre listÃ© ici
- tout fichier utils/ Ã  @domain infrastructure doit Ãªtre listÃ© ici
- tout fichier bootstrap/ doit Ãªtre listÃ© ici
- validators/index.js est le barrel unique de validation
- [object Object]
- [object Object]
- [object Object]
- [object Object]
- [object Object]

**Owns** : `outbox_events`, `physical_outcome_receipts`, `schema_migrations`
**Writes (not owner)** : `charges` (writer-not-owner), `economic_snapshots` (writer-not-owner), `finance_config` (writer-not-owner), `pickup_print_tokens` (writer-not-owner), `pickup_reveal_codes` (writer-not-owner), `revoked_tokens` (writer-not-owner), `users` (writer-not-owner)

**Exposes** : 11 internal API(s), 4 HTTP interface(s)
  - `null` (bootstrap/*) â€” resolved
  - `null` (middleware/error-handler.js) â€” resolved
  - `null` (middleware/rate-limit.js) â€” resolved
  - `null` (middleware/request-id.js) â€” resolved
  - `null` (middleware/upload.js) â€” resolved
  - `null` (middleware/validate.js) â€” resolved
  - `null` (utils/logger.js) â€” resolved
  - `null` (utils/phone.js) â€” resolved
  - `null` (utils/rates.js) â€” resolved
  - `null` (utils/reference.js) â€” resolved
  - _...1 de plus, voir FEATURE_360.json_

**Consumes** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)
**Consumed by** : auth (DECLARED_AND_OBSERVED), auth-identity (DECLARED_AND_OBSERVED), auth-passkey (DECLARED_AND_OBSERVED), business-rules (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), customs (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), documents (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), incident-management (DECLARED_AND_OBSERVED), inventory (DECLARED_AND_OBSERVED), local-stock (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), loyalty (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-autonomy (DECLARED_AND_OBSERVED), market-control-plane (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), market-operator-dashboard (DECLARED_AND_OBSERVED), notifications (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), platform-ops (DECLARED_AND_OBSERVED), providers-services (DECLARED_AND_OBSERVED), purchasing (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), refunds (DECLARED_AND_OBSERVED), settlement (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED), unsold-resolution (DECLARED_AND_OBSERVED), wallet (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 13 composition-root

**Boundary health** : ğŸŸ¢ HEALTHY â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 0
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** : _aucune_

**Implementation** : 404 fichier(s) dÃ©clarÃ©(s)
  - assets : 33
  - bootstrap : 9
  - ci : 26
  - config : 12
  - db : 16
  - docs : 61
  - middleware : 7
  - migrations : 9
  - routes : 1
  - scripts : 114
  - services : 3
  - tests : 107
  - utils : 5
  - validators : 1

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="infrastructure"]_

## inventory

**Kind** : business-feature  Â·  **Status** : staging

**Service** : RÃ©ceptionner, affecter et dispatcher les articles au hub.

**Perimeter** :
- _in_ :
  - suivi de stock et endpoint de lecture/mise a jour
- _out_ :
  - decision de publication produit (feature catalog, qui consomme inventory)

**Authority** : backend-core â€” tout changement de calcul de disponibilite doit etre valide par le proprietaire de inventory-service.js

**Invariants** :
- [object Object]
- [object Object]

**Owns** : `inventory_items`

**Exposes** : 0 internal API(s), 8 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARm«ëŒ+Š×®º+º$zzb¥çF–6ÆW2R‡V"à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò7V—f’FR7Fö6²WBVæGö–çBFRÆV7GW&RöÖ—6R¦÷W ¢Òö÷WEò ¢ÒFV6—6–öâFRV&Æ–6F–öâ&öGV—B†fVGW&R6FÆörÂV’6öç6öÖÖR–çfVçF÷'’ ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WB6†ævVÖVçBFR6Æ7VÂFRF—7öæ–&–Æ—FRFö—BWG&RfÆ–FR"ÆR&÷&–WF—&RFR–çfVçF÷'’×6W'f–6Ræ§0 ¢¢¤–çf&–çG2¢¢ ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ ¢¢¤÷vç2¢¢¢–çfVçF÷'•ö—FV×6  ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â‚…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢FÖ–âÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä&Ú±î¸Â¸­yêë¢°k¢G§¦*^ticles au hub.

**Perimeter** :
- _in_ :
  - suivi de stock et endpoint de lecture/mise a jour
- _out_ :
  - decision de publication produit (feature catalog, qui consomme inventory)

**Authority** : backend-core â€” tout changement de calcul de disponibilite doit etre valide par le proprietaire de inventory-service.js

**Invariants** :
- [object Object]
- [object Object]

**Owns** : `inventory_items`

**Exposes** : 0 internal API(s), 8 HTTP interface(s)

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED)
**Consumed by** : admin-dashboard (DECLARED_AND_OBSERVED), dashboard (DECLARm«ëŒ+Š×®º+º$zzb¥ævF–öâ6†WFWW"(	BL:–¬:Æ—g,:’<;GL:’&÷WF—VR‡V&Æ–2ö&÷WF—VRö§2öÖ&¶WBÖ6öçFW‡Bæ§2Â6†çF–W"†W&òƒ"ôƒ2’Â6öçFW‡GVVÂWB6öÖ×WF&ÆRÂ¦Ö—2ÇR"&WV—&TÖ&¶WE66÷P¢ÒÖ–w&F–öâFW2“B6öÆöææW2¥ö¶ÖbW†—7FçFW2fW'2WF–Ç2ö7W'&Væ7’æ§2(	BÓRÆ—g&RÂv÷WF–ÂFRf÷&ÖFvRÂæRF÷V6†R:V7VæR6öÆöææRæ’V7VâVÆçBW†—7FçB²&VæöÖÖW"VæR6öÆöææRFRÖöçFçBVâ&öBW7BVâ6†çF–W"<:—,:’Â:f÷'B&—7VP¢Ò6öçfW'6–öâBvff–6†vR´Ôn(i$UU"F–7÷&‡V&Æ–2ö&÷WF—VRö§2ö"×WF–Ç2æ§26f×B‚’ÂFW‚FR6†ævRL:—FV7L:’"gW6VR†÷&—&R’(	BÜ:–6æ—6ÖRF—7F–æ7BÂæöâ&V×Æ<:’"Æ&÷VæF'’FWf—6R‡V’÷'FRÆFWf—6R,8”TÄÄRBwVâÖ&6Œ:’Â2VæR6öçfW'6–öâ’â"×WF–Ç2æ§2FWf–VçBVâDDU"FR6WGFR&÷VæF'’Vâ"Â¦Ö—2Âv–çfW'6P¢ÒBõR(	BFö7VÖVçG26öçG&7GVVÇ2Æ—6çBÆR6æ6†÷B2ÂF6†&ö&G2w,:–vF–öâ7&÷72ÖÖ&¶WBVâUU"&VfW&Væ6R(	Bæöâf—G2ÂL:—VæFVçBFR2õ"&W7V7F—fVÖVç@¢ÒFWf—6W2FR6÷W&6–ærfÆ÷GFçFW2…U4BôTBô4å’’(	B6öæ6W&â<:—,:’"6öç7G'V7F–öâ†g&VW¦R–çf&–çBBóR’Â7W'&Væ7•÷&—F–W2æRÆW26öçF–VçB¦Ö—0¢Ò6WGFÆVÖVçBWBGG&–'WF–öâ:–6öæöÖ—VR"÷:—&FWW"†VçF—L:’F–fl:—,:–RÂ†÷'2:—&–Ü:‡G&R¢Ò6÷'&–F÷"g&ÖWv÷&²‡&VÆF–öâG&fW'6çBÆW266÷W2Â2Vâ†RBv÷væW'6†—Â†÷'2:—&–Ü:‡G&R¢ÒvÆÆWB×VÇF’ÖÖ&¶WB††÷'2:—&–Ü:‡G&R¢Ò&öGV7EöÖ&¶WEööffW"†L:–6ÆVæ6†WW"ÒW"Ö&6†æBÆö6ÂÂ2F—fW&vVæ6RFR&—‚Â†÷'2:—&–Ü:‡G&R¢Òf÷&ÖFvRFWf—6Rff–6Œ:’†fVGW&RV6öæöÖ–2ÖVæv–æRò&÷VæF'’FWf—6RÓRÂV’6öç6öÖÖRÖ–æ÷%÷Væ—B ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BFö7G&–æRvVÌ:–RFç2´ôÔU$4UôÔ$´UEôÄ”U%ôe$TU¤RæÖBƒ##bÓ‚Ó’Â$TE’Dòe$TU¤R’âF÷WFRW‡FVç6–öâGR:—&–Ü:‡G&R‡6WGFÆVÖVçBÂ6÷'&–F÷"g&ÖWv÷&²ÂVçF—L:’÷:—&FWW"’W†–vRVâæ÷WfVRg&VW¦RÂ2VæRW‡FVç6–öâ6–ÆVæ6–WW6RFR6RÖæ–fW7FRà ¢¢¤–çf&–çG2¢¢ ¢ÒÖ&¶WG2÷'FRL:—6÷&Ö—2ÆRÆ–fV7–6ÆR6æöæ—VR$õd•4”ôä”ärô5D•dRõ5U5TäDTBô4Äõ4TBWB7F÷&Vg&öçE÷FW‡G2²V7VæRWF÷&—6F–öâWF–Æ—6FWW"î(	–W7BL:—&—l:–RFR6W26†×0¢ÒÖ&¶WBÖÆ–fV7–6ÆR×6W'f–6RW7BÆR6WVÂw&—FW"'VçF–ÖRFRÆ–fV7–6ÆU÷7FGW2ö—5ö7F—fR²4Äõ4TBW7BFW&Ö–æÂWBF÷WFRG&ç6—F–öâ7V—BÆÖG&–6RW‡Æ–6—FP¢Ò&÷f—6–öææW"Vâæ÷WfVRÖ&6Œ:’7,:–RVæRÆ–væR$õd•4”ôä”är²&W&÷f—6–öææW"VâÖ&¶WB”B†—7F÷&—VRW†–vRW‡Æ–6—FVÖVçBVâ:—FB$õd•4”ôä”är6ç276–væÖVçB5D•dRWB6öç6W'fRÎ(	––FVçF—L:’ö†—7F÷&—VRGRÖ&6Œ:¢Ò÷W&F÷%öÖ&¶WE÷66÷W2„Ó’Ò†—7F÷&—VRBv6<:‡2w&–âW6W"Â¦Ö—26÷W&6RGR6WGFÆVÖVçB†w&–â÷&væ—6F–öâÂF–fl:—,:’¢Ò,:—fö6F–öâBwVâ66÷RÒUDDR&Wfö¶VEöBÂ¦Ö—2DTÄUDR(	BÂv†—7F÷&—VRBv6<:‡2âvW7B2&V6öç7G'V7F–&ÆR6–æöà¢ÒÖ&¶WD6öçFW‡B‡&6÷W'26†WFWW"’W7BVâ6öçFW‡FR6Æ–VçB6öÖ×WF&ÆRÂ¦Ö—2VæRWF÷&—6F–öà¢Ò&WV—&TÖ&¶WE66÷R„Ó"’W7B,:—6öÇR6W'fWW"FWV—2÷W&F÷%öÖ&¶WE÷66÷W2Â¦Ö—2FWV—2VâÖ&¶WEö–Bf÷W&æ’"ÆR6Æ–Vç@¢Ò&VÆ—2æÖ&¶WEö–B„Ó"’W7BäõBåTÄÂ(	BVâ&VÆ—2W7BVâÆ–WR‡—6—VRÂ–ÂæRWWB2W†—7FW"6ç2Ö&6Œ:¢Ò÷&FW'2æÖ&¶WEö–B„Ó2’W7BVâ4ä4„õB,:—6öÇRGR&VÆ—2RÖöÖVçBFRÆ6öÖÖæFRÂ¦Ö—2VæRd²f—fçFR&R×7–æ6‡&öæ—<:–P¢Ò÷&FW'2ç&VÆ—5ö–BW7BäõBåTÄÂFç2ÆR66Œ:–Ö‡l:—&–fœ:’"WŒ:–7WF–öâ,:–VÆÆRÂ27W÷<:’’(	BV7VæR6öÖÖæFR6ç2&VÆ—2âvW7B÷76–&ÆRÂÆR&6¶f–ÆÂ÷&FW'2æÖ&¶WEö–BW7BFöæ2F÷FÂ"6öç7G'V7F–öà¢ÒF÷WFRÖ–w&F–öâFRÖ&¶WBV’F÷V6†RVæRF&ÆR÷7<:–L:–R"VæRWG&RfVGW&R†Wƒ¢&VÆ—2ÂÆöv—7F–72²÷&FW'2’¦÷WFRVæR6öÆöææR÷RVâ–æFW‚Â¦Ö—2VæR,:†vÆRÜ:—F–W"FR6WGFRWG&RfVGW&P¢Òf÷&&–DÖ&¶WD–B‡fÆ–FF÷'2ö–æFW‚æ§2’:–6†÷VRf÷'BƒCÂÖW76vRW‡Æ–6—FR’ÇWL;GBVRFR6ö×FW"7W"7G&—Væ¶æ÷vâ÷W"&WF—&W"Ö&¶WEö–B6–ÆVæ6–WW6VÖVçBBwVâ–ÆöB6Æ–Vç@¢Ò67&—G2ö6†V6²ÖæòÖÖ&¶WBÖ–BÖ×WFF–öâæ§2W7BVâvFRÂ2VæR6öçfVçF–öâFö7VÖVçL:–R¢VâÖ&¶WEö–B×WF&ÆRæöâv&L:’Fç2fÆ–FF÷'2ò¢æ§2f—B:–6†÷VW"Æ4¢ÒWF–Ç2ö7W'&Væ7’æ§26vWDÖ&¶WD7W'&Væ7’F‡&÷r6’ÆRÖ&6Œ:’âvW†—7FR2(	B¦Ö—2FRFWf—6R"L:–fWB6–ÆVæ6–WW6P¢ÒWF–Ç2ö7W'&Væ7’æ§26f÷&ÖDÖ÷VçB7W÷6RVâÖöçFçBL:–¬:Fç2ÂwVæ—L:’ff–6Œ:–Rƒ#SÂ2#S6÷W2×Væ—L:’’(	B6öŒ:—&VçBfV2ÆW26öÆöææW2¥ö¶ÖbW†—7FçFW2Â¦Ö—2VæR6öçfVçF–öâ6VçG2–çfVçL:–R6ç2&W6ö–â,:–VÀ¢ÒÓ†÷WfW'GW&RÖ–÷GFR’W7BVâ”å4U%B6WVÂ(	Bl:—&–fœ:’,:–VÆÆVÖVçB¢f–6†–W"FRÓôÓ"ôÓ2ôÓ"ôÓRÖöF–fœ:’÷W"÷Wg&—"6RÖ&6Œ:’Â6bâFW7G2ö–çFVw&F–öâöÖ&¶WBÖ÷VâÖÖG&—‚çFW7Bæ§0¢Ò&VfW&Væ6Uö7W'&Væ7’ÒUU"†6æöæ—VRFRÆ7W'&Væ7’&÷VæF'’’Â7G'V7GW&VÆÆVÖVçBF—7F–æ7BFRV6öæöÖ–5öVæv–æUö&6Uö7W'&Væ7’Ò´Ôb†V6öæöÖ–2ÖVæv–æRÂ–æ6†æ|:’’(	BæR¦Ö—26öæföæG&RÆW2FWW‚†g&VW¦RÂ#"Ó‚Ó##b¢Ò–çf&–çB’¢V7VæR—&RF—&V7FRVçG&RFWW‚FWf—6W2¦öæRg&æ2„´Ôn(iE„b’âvW7B¦Ö—27Fö6¼:–Ræ’6Æ7VÌ:–R6öÖÖRFVÆÆR(	BF÷WFR6öçfW'6–öâ6RL:—&—fRFRFWW‚&—L:—2fW'2UU"RÖöÖVçBGR6Æ7VÂÂ6bâ7W'&Væ7•÷&—F–W2WB&ö¦V7DÖ÷VçB‚¢Ò7W'&Væ7•÷&—F–W2W7BÆ4UTÄR6÷W&6RFR&—L:—2(	BV7VæR&—L:’æRWWB:§G&RÖ–çFVçVRÖçVVÆÆVÖVçBFç2Vâ6V6öæB'FVf7BÆ–6F–b‡6W'fW"æ§2WB"×WF–Ç2æ§26öç6öÖÖVçBf–FFW"ÂæR÷'FVçB¦Ö—2ÆWW"&÷&RfÆWW"¢ÒÆ7W'&Væ7’&÷VæF'’÷7<:†FRÆ,:†vÆRÖöì:—F—&R²WF–Ç2ö7W'&Væ7’æ§2‡6W'fWW"’WB"×WF–Ç2æ§2†6Æ–VçBÂ"’Vâ6öçBÆW2FFW'2Â¦Ö—2FW2&÷&œ:—F—&W26öæ7W'&VçG2FRÆ,:†vÆP¢ÒV7VæRFWf—6RFR6÷W&6–ærfÆ÷GFçFR…U4BôTBô4å’’Fç27W'&Væ7•÷&—F–W2(	B'6Væ6R"6öç7G'V7F–öâÂ2"÷V&Æ’†g&VW¦R–çf&–çG2BóR¢Ò"¢"×WF–Ç2æ§26f×B†Ö÷VçBÂ$´Ôb"’æRf÷&6RÇW2Vâff–6†vR´ÔbÆ—GL:—&ÂFWV—2ÆR#"Ó‚Ó##b(	B$´Ôb"W7BFWfVçRÂvÆ–2'&ö¦WGFRfW'2ÆRÖ&6Œ:’6÷W&çB"‡,:—6öÇRf–Ö&¶WBÖ6öçFW‡Bæ§2Â÷fW'&–FRöÖ&¶WCÒ–æ6ÇW2’âF÷WFRUE$RFWf—6RW‡Æ–6—FR†W‚â$UU""’v&FRÆR6ö×÷'FVÖVçBÆ—GL:—&Â†—7F÷&—VRÂf÷&<:’Â–væ÷&RÆRÖ&6Œ:’âÆW232VÇ2W†—7FçG2FRf×B‡‚Â$´Ôb"’âvöçB2:—L:’ÖöF–fœ:—2(	B–Ç2Œ:—&—FVçBGRæ÷WfVR6ö×÷'FVÖVçBWFöÖF—VVÖVçBâV–6öçVRÆ—BVâFR6W2VÇ2Fö—B6fö—"VR$´Ôb"æRfWWBÇW2F—&R&f÷&6R´Ôb ¢Ò"¢f×B‚’öf×E&–6R‚’&W7FVçB5”ä4…$ôäU2ƒ32VÆçG2Fç2FW2&÷V6ÆW2FR&VæGR’(	BÆ&ö¦V7F–öâ6öç6öÖÖRVâ6æ6†÷BL:–¬:6†&|:’†fWF6‚Væ—VRR6†&vVÖVçBGRÖöGVÆRÂ¦Ö—2Vâ&÷VæB×G&—"VÂ’âfçB,:—6öÇWF–öâGRfWF6‚†fVì:§G&R6÷W'FRÂ÷RVâ62B|:–6†V2,:—6VR’Â&WÆ’7W"Âvff–6†vR´Ôb''WB(	B¦Ö—2VâÖöçFçBfW‚æ’VæRW†6WF–öà¢Ò2¢÷&FW'2çF÷FÅö¶Öb÷F÷FÅöWW"…–ÖVçB&÷VæF'’Âf–ææ6Uö6öæf–r’6öçB5E$”5DTÔTåB”ä4„ä|8•2(	B7G&—RÂ•ÂWB66…÷&VÆ—2Æ—6VçBW†6ÇW6—fVÖVçB6W2FWW‚6öÆöææW2Â¦Ö—2F—7Æ•÷F÷FÅöÖ÷VçBöF—7Æ•ö7W'&Væ7’âÆW2FWW‚&÷VæF&–W26öW†—7FVçBÂ¦Ö—2Ü:–Ææ|:–W0¢Ò2¢F—7Æ•öÖ&¶WEö6öFR†6Æ–VçBÂ&W\:§FRõ5Bö’ö÷&FW'2’W7BVâ–æF–6RFR4ôåDU…DRÂ¦Ö—2VâÖöçFçBÂ¦Ö—2VæRWF÷&—6F–öâ(	BÆR6W'fWW"6Æ7VÆRÇV’ÖÜ:¦ÖRF—7Æ•÷F÷FÅöÖ÷VçBf–&ö¦V7DÖ÷VçB‚’‡6W'f–6W2ö÷&FW"ÖF—7Æ’×6æ6†÷Bæ§2’âVâ6öFR–çfÆ–FR÷R'6VçBæR&Æ÷VR¦Ö—2Æ6öÖÖæFP¢Ò2¢æR¦Ö—27W÷6W"6–ÆVæ6–WW6VÖVçBVR÷&FW'2æÖ&¶WEö–B†6VÇV’GR&VÆ—26†ö—6’’W7BÆRÖ&6Œ:’FRæf–vF–öâGR6Æ–VçB(	BF—7Æ•öÖ&¶WEö6öFRf—BDõT¤õU%2fö’2v–ÂW7BfÆ–FR²&VÆ—2æÖ&¶WEö–BâvW7BRwVâ&WÆ’6’V7Vâ6öFRâv:—L:’f÷W&æ’÷RRv–ÂW7B–çfÆ–FRâ&WWfRVâ&6R¢FW7G2ö–çFVw&F–öâö÷&FW"ÖF—7Æ’×6æ6†÷BçFW7Bæ§2L:–ÖöçG&RVæRÆ–væRü;’Ö&¶WEö–B„´Ò’(šF—7Æ•ö7W'&Væ7’…„b¢Ò2¢F—7Æ•÷&—G•÷6æ6†÷B„¥4ôä"’W7BVæRÜ:—FFöæì:–RBvVF—B(	BÆ&—L:’WF–Æ—<:–R÷W"ÆR6Æ7VÂÂ¦Ö—2VæR6÷W&6RFRl:—&—L:’ÇFW&æF—fRâF—7Æ•÷F÷FÅöÖ÷VçB6WVÂf—Bfö¢Ò2¢V7Vâ&V6Æ7VÂVÇL:—&–WW"GRF—7Æ’6æ6†÷B(	Bf–|:’:Æ7,:–F–öâÂ6öÖÖRF÷FÅö¶Öb÷F÷FÅöWW"â÷W"ÆW26öÖÖæFW2çL:—&–WW&W2:ÆÖ–w&F–öâC2ÂÆW226öÆöææW2&W7FVçBåTÄÂ(	BV7Vâ&6¶f–ÆÂf'&—\:’†–çf&–çBrGRg&VW¦R¢Ò2¢&W6öÇfTF—7Æ•6æ6†÷B‚’‡6W'f–6W2ö÷&FW"ÖF—7Æ’×6æ6†÷Bæ§2’æRF‡&÷r¦Ö—2(	BVâ:–6†V2FR,:—6öÇWF–öâ&WF÷W&æRVâ6æ6†÷Bf–FRÂæR&Æ÷VR¦Ö—2Æ7,:–F–öâBwVæR6öÖÖæFRâ2vW7BVæRFöæì:–RBvVF—Bö6öæf—&ÖF–öâÂ2VæRFöæì:–RFR–VÖVç@¢ÒB¢6÷'&V7F–b–ÖVçB&÷VæF'’G&÷Wl:’VæFçBÆ6'Föw&†–R2(	B6W'f–6W2ö–çfö–6R×6W'f–6Ræ§2ff–6†—B$´Ôb"6öL:’VâGW"7W"F÷WFW2ÆW2f7GW&W2ÂÜ:¦ÖRVâ–VÖVçBUU"…7G&—Rõ•Â’â6÷'&–|:’6VÆöâ–ÖVçEöÖöFRÂ6ç2F÷V6†W"7W'&Væ7•÷&—F–W2æ’F—7Æ•÷F÷FÅöÖ÷VçB(	B6RâvW7B2Vâ6†çF–W"7W'&Væ7’&÷VæF'’Âf–6†–W'2L:–6Æ,:—2Fç2Fö7VÖVçG2æfVGW&Ræ§2†Ö–w&F–öç2óCEö–çfö–6W5÷F÷FÅöWW"ç7Â’Â2–6 ¢¢¤÷vç2¢¢¢7W'&Væ7•÷&—F–W6Âg…÷V&Æ–5÷&VfW&Væ6U÷V÷FW6Âg…÷&FUöö'6W'fF–öç6ÂÖ&¶WG6Â÷W&F÷%öÖ&¶WE÷66÷W6  ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’Âæ÷F–f–6F–öç2„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢6FÆör„DT4Ä$TEôäEôô%4U%dTB’Â7W7Fö×2„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆö6Â×7Fö6²„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ6öçG&öÂ×ÆæR„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’Â&÷f–FW'2×6W'f–6W2„DT4Ä$TEôäEôô%4U%dTB’Â&V6öÖÖVæFF–öç2„DT4Ä$TEôäEôô%4U%dTB’Â&VgVæG2„DT4Ä$TEôäEôô%4U%dTB’Â6WGFÆVÖVçB„DT4Ä$TEôäEôô%4U%dTB’ÂvÆÆWB„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂBFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢cf–6†–W"‡2’L:–6Æ,:’‡2¢ÒÖ–w&F–öç2¢P¢Ò67&—G2¢0¢Ò6W'f–6W2¢¢ÒFW7G2¢3  ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&Ö&¶WB%Õğ ¢22Ö&¶WBÖWFöæö× ¢¢¤¶–æB¢¢¢'W6–æW72ÖfVGW&R+r¢¥7FGW2¢¢¢7Fv–æp ¢¢¥6W'f–6R¢¢¢W&ÖWGG&R:Vâ&W7öç6&ÆR—2W‡Æ–6—FVÖVçB66÷:’ÖævW"FRL:–6–FW"Vâ&—‚Æö6ÂÂN(	–Vâfö—"Î(	––×7B:–6öæöÖ—VRÂV—2FRÎ(	–7F—fW"6ç2&ö&F–öâ6VçG&ÆRÆ÷'7VRÆW2vFW2WF÷&—6VçBÆ÷6—F–öâ²Äô4Åô5D•dRFWf–VçBÆ÷'2Æ6WVÆRl:—&—L:’Æö6ÆR6öç6öÖÖ&ÆR"ÆR'W–W"F‚à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢ÒL:–6—6–öâFR&—‚6öÖÖW&6–ÂÆö6ÆR"Ö&¶WEö–B²&öGV7Eö–@¢ÒFWf—6R,:—6öÇVRW†6ÇW6—fVÖVçBFWV—2ÆRÖ&6Œ:’6W'fWW ¢ÒVF—BVæBÖöæÇ’4UBõ$U4UBôUD„õ$•¤Rô5D•dDRFRÆL:–6—6–öâÆö6ÆP¢Ò&Wf–Wr:–6öæöÖ—VR4E"²6÷WfW'GW&RÖ&6Œ:’fçB7F—fF–öà¢ÒG&ç6—F–öâE$eEõTäD”äuôtDRÓâÄô4ÅôUD„õ$•¤TEõTäD”äuô5UDõdU"ÓâÄô4Åô5D•dP¢Ò&ö¦V7F–öâGR&—‚Äô4Åô5D•dRfW'2ÆR´Ôb6æöæ—VR6ç2ÖöF–f–W"&öGV7G2ç&–6Uö¶Ö`¢Ò6öç6öÖÖF–öâÄô4Åô5D•dR"6FÆöwVRÂÆ—7FR'F|:–RWB6†V6¶÷WBf–&÷VæF'’&÷&œ:—F—&P¢Ò&VgW2f–ÂÖ6Æ÷6VB6’VæRw&çVÆ&—L:’4µR÷f&–çFRW‡Æ–6—FRVçG&W&—BVâ6öæfÆ—@¢Ò&ö¦V7F–öâÖævW"÷f–WvW"FRÆ66—L:’,:–VÆÆVÖVçBF—7öæ–&ÆP¢Ò7W&f6R6æöæ–6ÂFRFW7BFRÎ(	–WFöæöÖ–R—0¢Ò7W&f6R:—V—R—2–çL:–w,:–R¢ÆV7GW&RÂ–çf—FF–öâÂL:–Ì:–vF–öâWB,:—fö6F–öâFR6&–Æ—F–W2ÂFöçB&÷f–FW"æÖævRÆ÷'7^(	––ÂW7BÄ•dP¢Ò&6÷W'2W‡Æ–6—FRN(	–66WFF–öâN(	––çf—FF–öâfV2&WF÷W"fW'2ÆRÖ&¶WB”B,:—6öÇR<;GL:’6W'fWW ¢ÒöÆ—F—VRFR&÷FV7F–öâFW2Væ6—76VÖVçG2–çL:–w,:–R:WFöæöÖ–R—2¢66‚7F–b÷7W7VæGRWBfÆ–FF–öâ4”ätÄRôETÅôÅt•0¢Òö÷WEò ¢Ò×WFF–öâFR&öGV7G2ç&–6Uö¶ÖbvÆö&À¢ÒfÆ–FF–öâ‡VÖ–æR6VçG&ÆRFRÆ7G&L:–v–R6öÖÖW&6–ÆR—0¢Ò7,:–F–öâö7F—fF–öâN(	—VâÖ&6Œ:¢Ò6WGFÆVÖVçBWBÖ÷WfVÖVçG2f–ææ6–W'0¢Ò,;FÆW2FW'&–â–×Æ–6—FW0¢Ò&—‚Æö6Â"4µR(	BFçBVR6WGFRw&çVÆ&—L:’î(	–W7B2ÖöL:–Æ—<:–RW‡Æ–6—FVÖVç@ ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BÆ7G&L:–v–RÆö6ÆR'F–VçBRÖævW"GRÖ&6Œ:’²ÆRÖ÷FWW":–6öæöÖ—VRWWB&VgW6W"VæR7F—fF–öâFW7G'V7F—fR÷R6÷W2Ö6÷WfW'FRæöâWF÷&—<:–RÂÖ—2V7VâFÖ–â6VçG&ÂæRfÆ–FRÆR6†ö—‚6öÖÖW&6–Â—2à ¢¢¤–çf&–çG2¢¢ ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V6Ú±î¸Â¸­yêë¢°k¢G§¦*^t]

**Owns** : `product_market_price_draft_events`, `product_market_price_drafts`

**Exposes** : 0 internal API(s), 0 HTTP interface(s)

**Consumes** : catalog (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED)
**Consumed by** : catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), market-operator-dashboard (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), recommendations (DECLARED_AND_OBSERVED), shared-cart (DECLARED_AND_OBSERVED)

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 1 test-only, 0 composition-root

**Boundary health** : ğŸŸ¡ ATTENTION â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 2
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (2) :
- `DECLARED_NOT_OBSERVED` (low) â€” contract.consumes dÃ©clare "auth-identity" â€” aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)
- `DECLARED_NOT_OBSERVED` (low) â€” contract.consumes dÃ©clare "market-delegation" â€” aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 43 fichier(s) dÃ©clarÃ©(s)
  - dash : 25
  - migrations : 3
  - services : 4
  - tests : 11

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="market-autonomy"]_

## market-control-plane

**Kind** : business-feature  Â·  **Status** : staging

**Service** : Montrer Ã  lâ€™administration centrale, pour chaque marchÃ©, lâ€™Ã©tat rÃ©el de sa mise en exploitation et la liste explicite des Ã©carts, sans rien Ã©crire ni dÃ©cider dâ€™autorisation.

**Perimeter** :
- _in_ :
  - GET /api/admin/markets : liste des marchÃ©s avec statut dâ€™affectation et nombre de personnes actives
  - POST /api/admin/markets : provisionne un marchÃ© PROVISIONING en composant les writers canoniques market + market-delegation + payments + logistics ; paiement initial, cash policy et premier relais peuvent rendre la readiness rÃ©ellement verte avant activation
  - GET /api/admin/markets/central-authority : titulaires actifs des cinq autorisations centrales explicites (dashboard, catalog, decision_signal, pricing, sourcing) et autoritÃ© dÃ©clarÃ©e de chaque capability de groupe
  - GET /api/admin/markets/:marketCode/control-plane : affectation, Ã©quipe et capacitÃ©s, plafond, fournisseurs de paiement, politique de caisse, relais actifs, Ã©carts
  - POST /api/admin/markets/:marketCode/lifecycle : transition lifecycle centrale ; ACTIVE exige readiness plate-forme ET exploitation vertes
  - PUT /api/admin/markets/:marketCode/storefront : Ã©dition des textes boutique par admin central, via market-lifecycle-service et audit
  - POST /api/admin/markets/:marketCode/reprovision : reconstruit la configuration opÃ©rationnelle dâ€™un Market ID historique dÃ©jÃ  remis en PROVISIONING, sans recrÃ©er son identitÃ©
  - rapport dâ€™Ã©carts calculÃ© (computeGaps) + deux verdicts readiness indÃ©pendants : platform et operations ; MARKET_INACTIVE nâ€™est pas un blocker de readiness pendant PROVISIONING
- _out_ :
  - activation/suspension/fermeture : transitions lifecycle hors POST de provisioning ; toujours via le writer market et une porte readiness
  - dÃ©cision dâ€™autorisation : market-delegation reste le seul moteur ; cette vue nâ€™autorise rien
  - rÃ©fÃ©rentiel markets et devise : feature market (rÃ©fÃ©rentiel pur)
  - accÃ¨s dâ€™un opÃ©rateur pays Ã  sa propre vue : hors lot, la vue est centrale
  - cycle de vie PROVISIONING/ACTIVE/SUSPENDED/CLOSED et responsable opÃ©rationnel : lots E et F du chantier (migrations)

**Authority** : backend-core â€” le Control Plane orchestre le provisioning mais nâ€™Ã©crit aucune table mÃ©tier directement : chaque mutation passe par le service propriÃ©taire (market ou market-delegation).

**Invariants** :
- les vues restent en lecture seule ; POST /api/admin/markets orchestre uniquement des writers propriÃ©taires et crÃ©e toujours PROVISIONING, jamais ACTIVE
- la vue nâ€™accorde aucun droit : lâ€™accÃ¨s central est le rÃ´le admin dÃ©clarÃ©, jamais dÃ©duit dâ€™un scope ou dâ€™un rÃ´le dâ€™opÃ©rateur
- un Ã©cart est signalÃ©, jamais rÃ©parÃ© ni masquÃ©
- central(X, domaine) est lâ€™unique porte vers les cinq autorisations centrales explicites : elle dÃ©lÃ¨gue aux fonctions existantes des middlewares, sans SQL dâ€™autorisation dupliquÃ©, et le rÃ´le admin nâ€™en implique aucune
- chaque capability de groupe ou CENTRAL_ONLY dÃ©clare dans le registre son domaine dâ€™autoritÃ© centrale ou null ; null est un constat (aucune table ne lâ€™applique aujourdâ€™hui), jamais une autorisation
- le code marchÃ© est validÃ© cÃ´tÃ© serveur (deux lettres) ; un code invalide est un 400 et un code inconnu un 404

**Owns** : `market_delivery_attestations`

**Exposes** : 9 internal API(s), 7 HTTP interface(s)
  - `central()`  â€” documented-signature-no-file
  - `computeGaps()`  â€” documented-signature-no-file
  - `getControlPlane()`  â€” documented-signature-no-file
  - `listMarkets()`  â€” documented-signature-no-file
  - `overview()`  â€” documented-signature-no-file
  - `provisionMarket()`  â€” documented-signature-no-file
  - `readinessFromGaps()`  â€” documented-signature-no-file
  - `reprovisionMarket()`  â€” documented-signature-no-file
  - `setMarketLifecycle()`  â€” documented-signature-no-file

**Consumes** : auth (DECLARED_AND_OBSERVED), catalog (DECLARED_AND_OBSERVED), dashboard (DECLARED_AND_OBSERVED), decision-signals (DECLARED_AND_OBSERVED), economic-engine (DECLARED_AND_OBSERVED), infrastructure (DECLARED_AND_OBSERVED), logistics (DECLARED_AND_OBSERVED), market (DECLARED_AND_OBSERVED), market-delegation (DECLARED_AND_OBSERVED), orders (DECLARED_AND_OBSERVED), payments (DECLARED_AND_OBSERVED), sourcing (DECLARED_AND_OBSERVED)
**Consumed by** : _aucune_

**Projections** : _aucune_

**Technical context** : 0 primitive dependencies, 0 test-only, 0 composition-root

**Boundary health** : ğŸŸ¡ ATTENTION â€” cross-feature imports: 0, runtime cycles: 0, unclassified: 0, declared-not-observed: 1
**Governance health** : ğŸŸ¢ HEALTHY â€” orphan files: 0, unresolved internal APIs: 0, declared-only deps: 0, ambiguous ownership: 0, ontology gaps: 0
**Gate health** : ğŸŸ¢ HEALTHY â€” gates: _aucun_, fail: 0, warn: 0

**Architectural debt** (1) :
- `DECLARED_NOT_OBSERVED` (low) â€” contract.consumes dÃ©clare "providers-services" â€” aucune preuve O5 (ni DECLARED_AND_OBSERVED, ni OBSERVED_UNDECLARED)

**Implementation** : 19 fichier(s) dÃ©clarÃ©(s)
  - routes : 1
  - scripts : 2
  - services : 4
  - tests : 12

_DÃ©tails complets (fichiers, tables, interfaces) : voir docs/FEATURE_360.json â†’ features[id="market-control-plane"]_

## market-delegation

**Kind** : business-feature  Â·  **Status** : staging

**Service** : DÃ©lÃ©guer de faÃ§on explicite, auditable et rÃ©vocable lâ€™autoritÃ© dâ€™exploitation dâ€™un Market ID Ã  un opÃ©rateur principal et Ã  son Ã©quipe, tout en prÃ©servant les frontiÃ¨res GROUP de Komerce.

**Perimeter** :
- _in_ :
  - capability_registry : registre exÃ©cutable DELEGATION / EXECUTION / BOUNDARY
  - Market Operating Assignment : mandat unique actif par Market ID
  - ceiling template et plafond effectif concÃ©dÃ© par le central
  - memberships et capabilities membres, toujours sous le plafond
  - rÃ¨gle de dÃ©lÃ©gation : DELEGATION reste grant(member) âŠ† grant(grantor) âŠ† ceiling ; EXECUTION LIVE peut Ãªtre accordÃ© par team.grant sous ceiling sans devenir un droit du grantor
  - audit append-only des mutations de dÃ©lÃ©gation
  - M3 : responsable opÃ©rationnel et rÃ©fÃ©rent central sont des dÃ©signations sans droit implicite ; les limites financiÃ¨res nâ€™existent que sur les capabilities amount_bearing et restent bornÃ©es par le ceiling
  - G : central_referent_user_id et les limit_amount de provisioning ne sont modifiÃ©s que par les writers market-delegation ; un nouveau marchÃ© fournit toutes les limites amount_bearing avant de pouvoir devenir platform-ready
  - M5 : ACTIVE autorise READ+ACT ; SUSPENDED conserve READ uniquement ; PROVISIONING/CLOSED ne sont jamais retournÃ©s comme marchÃ©s dÃ©lÃ©guÃ©s actifs ; lâ€™effet vient de capability_registry.effect
  - calcul dÃ©terministe de la projection vers operator_market_scopes, persistÃ©e exclusivement par la boundary de la feature market
  - autonomy_rate calculÃ© uniquement sur la classe DELEGATION
  - LOT 1A : lecture Ã©quipe, invitation, acceptation, modification capabilities et rÃ©vocation par capabilities team.*
  - invitation persistÃ©e 72 h par dÃ©faut, token brut jamais stockÃ© et capabilities revalidÃ©es Ã  lâ€™acceptation
  - M4 : la mÃªme invitation accepte EMAIL ou WHATSAPP/E.164 ; invited_by_user_id est canonique, une invitation centrale peut dÃ©signer le premier operating lead sans que cette dÃ©signation nâ€™accorde elle-mÃªme une capability
  - anti-lockout : la derniÃ¨re membership possÃ©dant team.grant ne peut pas Ãªtre retirÃ©e silencieusement
  - adoption legacy : scopes actifs convertis en assignments/memberships, manager vers DELEGATION LIVE et viewer vers whitelist read-only
  - bridge runtime request-local : une membership active dÃ©jÃ  projetÃ©e peut satisfaire market_operator uniquement sur les routes qui admettent explicitement ce rÃ´le
  - reprojection transactionnelle aprÃ¨s crÃ©ation, acceptation, modification de capabilities ou rÃ©vocation de membership
  - politique cash partenaire par assignment : activation/dÃ©sactivation et SINGLE ou DUAL_ALWAYS
  - LOT 2A : rÃ©seau local (relais) â€” crÃ©ation, modification, suspension et rÃ©activation par capabilities network.*, jamais de hard-delete
  - un relais reste rattachÃ© Ã  son marchÃ© dâ€™origine ; toute tentative de lecture/Ã©criture cross-market Ã©choue en 404, sans confirmer lâ€™existence de la ressource sur un autre marchÃ©
  - un provider reste rattachÃ© Ã  son marchÃ© dâ€™origine ; provider.manage ne permet jamais une rÃ©assignation cross-market et les mutations passent par providers-services, lifecycle owner
  - D8 Partners : le registre historique multi-types est gouvernÃ© par partners.read (lecture) et partners.manage (mutation) ; provider.manage ne vaut jamais autoritÃ© implicite sur partners.
  - D9 Pricing Workspace : chaque endpoint marchÃ© est autorisÃ© par sa capability exacte ; le socle require-market-scope est supprimÃ© et la projection viewer/manager dÃ©rive des capabilities rÃ©ellement dÃ©tenues.
  - LOT 4 (Ã©criture) : dÃ©cision dâ€™exposition produit x marchÃ© â€” capability catalog.expose, upsert auditable sur product_market_exposure (catalog, lifecycle owner), jamais de SQL direct
  - Exception Catalogue pays Admin central : rÃ´le admin revÃ©rifiÃ© dans users, marchÃ© explicitement choisi avec assignment ACTIVE, lecture/exposition vÃ©rifiÃ©es cÃ´tÃ© serveur et Ã©critures auditÃ©es ; les opÃ©rateurs restent soumis Ã  catalog.read/catalog.expose et au ceiling de leur membership.
  - LOT 4B (validation simple marchÃ©) : un candidat catalogue dÃ©jÃ  prÃ©parÃ© et publiable peut Ãªtre validÃ© par le Responsable pays ; market-delegation dÃ©lÃ¨gue la premiÃ¨re publication Ã  catalog-approval puis active lâ€™exposition du marchÃ© dans la mÃªme transaction, sans reprendre lâ€™autoritÃ© lifecycle de products
  - LOT 4C (prÃªt Ã  vendre) : la dÃ©cision pays part uniquement dâ€™une fiche dÃ©jÃ  publiable/certifiÃ©e ; la projection assemble corridor Ã©conomique, prix proposÃ© et Ã©tat dâ€™exposition sans Ã©crire, puis lâ€™UI compose les writers canoniques pricing + catalog ; le bulk est rÃ©servÃ© aux lignes vertes
  - LOT 4 (cutover lecture) : catalog.expose LIVE â€” migration 206 (snapshot, catalog) prÃ©serve exactement la visibilitÃ© storefront existante au moment du cutover ; migration 207 (activation, market-delegation) ouvre le droit dâ€™agir sans jamais toucher lâ€™exposition elle-mÃªme ; sÃ©paration stricte entre les deux, vÃ©rifiÃ©e par test
  - LOT 7 (structure-event) : structure.event.record â€” un opÃ©rateur pays enregistre un fait MARKET_DIRECT de charge structurelle pour son propre marchÃ© via le writer canonique economic-engine (recordStructureCostEvent), jamais un GROUP, jamais un market_id choisi, jamais de SQL direct sur economic_structure_cost_events
  - migration 210 : promotion LIVE de structure.event.record backfillÃ©e sur les assignments actifs (ceiling) et les managers dÃ©jÃ  reconnus (team.grant + team.revoke + network.read), jamais un Ã©largissement aux viewers ; ne crÃ©e jamais dâ€™Ã©vÃ©nement Ã©conomique
  - LOT 4 (local-offer) : exposition commerciale des services/offres physiques dÃ©jÃ  crÃ©Ã©s â€” capability local_offer.manage, toggle ENABLED/DISABLED sur services.commercial_exposure et physical_offers.commercial_exposure (providers-services, lifecycle owner), jamais de SQL direct, jamais de suppression
  - un service ou une offre physique reste rattachÃ© Ã  son marchÃ© dâ€™origine ; toute tentative cross-market Ã©choue en 404, sans confirmer lâ€™existence de la ressource
  - migration 204 : promotion LIVE de local_offer.manage backfillÃ©e sur les assignments actifs (ceiling) et les managers dÃ©jÃ  reconnus (team.grant + team.revoke + network.read), jamais un Ã©largissement aux viewers
  - LOT 5 (client-case) : workflow de litige (disputes) â€” capability client.case.handle, transitions open/processing/resolved/closed et note de rÃ©solution via dispute-mutation-service.js (orders, lifecycle owner), jamais refund_kmf/refund_eur
  - un litige reste rattachÃ© Ã  son marchÃ© dâ€™origine (via order_id â†’ orders.market_id) ; toute tentative cross-market Ã©choue en 404, sans confirmer lâ€™existence de la ressource
  - migration 205 : promotion LIVE de client.case.handle backfillÃ©e sur les assignments actifs (ceiling) et les managers dÃ©jÃ  reconnus (team.grant + team.revoke + network.read), jamais un Ã©largissement aux viewers ; la migration elle-mÃªme nâ€™Ã©crit jamais refund_kmf/refund_eur
  - LOT 6 (settlement) : lecture via finance.read, READY -> REQUESTED via finance.act et PAID -> RECEIVED via settlement.receive ; market-delegation autorise et audite mais la feature settlement possÃ¨de market_settlements et les Ã©critures
  - migration 209 : finance.act + settlement.receive deviennent LIVE et sont backfillÃ©es dans les ceilings actifs ; auto-grant seulement aux managers dÃ©jÃ  dotÃ©s de team.grant + team.revoke + finance.read
  - LOT 8 (execution bridge) : les 7 capabilities execution.* LIVE entrent dans le ceiling/template sans auto-grant manager ; team.grant peut les dÃ©lÃ©guer explicitement Ã  un membre terrain et chaque consommation est auditÃ©e avant la mutation mÃ©tier
- _out_ :
  - rÃ©fÃ©rentiel markets, Currency Boundary et persistance operator_market_scopes : feature markem«ëŒ+Š×®º+º$zzb¥ç@¢Ò,;FÆRvÆö&ÂW6W'2ç&öÆRWBW6W"ç&öÆRç6WB¢g&öçFœ:‡&RWF‚Ö–FVçF—G’ôu$õUÂ¦Ö—2L:–Ì:–w\:–RR'FVæ—&P¢Ò,:†vÆW2N(	–ÆÆö6F–öâu$õUWBl:—&—L:’:–6öæöÖ—VR6öç6öÆ–L:–R¢V6öæöÖ–2ÖVæv–æP¢Òföæ7F–öç2‡V"÷G&ç6—B×WGVÆ—<:–W2¢†÷'2Ö&¶WB÷W&F–ær76–væÖVç@¢Ò&÷f–FW'2÷&VÆ—26öÖÖR&–æ6—W‚Æö6W‚6V6öæF—&W2¢¦Ö—2FW276–væÖVçG26öæ7W'&VçG2²ÆWW"vW7F–öâÆö6ÆR&W7FRL:–Ì:–wV&ÆR6ç2G&ç6f÷&ÖW"ÆWW"–FVçF—L:’VâW6W%÷&öÆP¢ÒÆV7GW&RV&Æ—VRGR,:—6VR&VÆ—2„tUBö’÷&VÆ—2’WB6öâ7–6ÆRFRf–RFV6†æ—VR†÷'2L:–Ì:–vF–öâ¢fVGW&RÆöv—7F–72Â&÷&œ:—F—&RFRÆF&ÆR&VÆ—0¢Ò&÷WFvR–çFW"Ü:æÆW2´Ò†—6ÆæBö—6ÆæEö6öFR6öç6öÖÜ:—2"6W'f–6W2÷&÷WF–æræ§2’¢†÷'2:—&–Ü:‡G&RÂ6÷WÆvR|:–öw&†—VR,:’ÖW†—7FçBæöâ,:—6öÇR"6WGFRfVGW&P¢Ò6FÆöwVRvÆö&Â‡&öGV7G2’¢fVGW&R6FÆör&W7FRÆ–fV7–6ÆR÷væW"²Ö&¶WBÖFVÆVvF–öâî(	œ:–7&—B¦Ö—2&öGV7G2F—&V7FVÖVçBWBæRWWBL:–6ÆVæ6†W"VæR&VÖœ:‡&RV&Æ–6F–öâ^(	–VâL:–Ì:–wVçB:6FÆörÖ&÷fÂÆ÷'2N(	—VæRfÆ–FF–öâ‡VÖ–æRÖ&6Œ:’²&öGV7EöÖ&¶WEöW‡÷7W&R&W7FRÆ&ö¦V7F–öâ—0¢Ò<:&&ÆvRGR6†VÖ–âFRÆV7GW&R7F÷&Vg&öçB†6FÆör×V&Æ–2×f–Wræ§2ò6FÆör×&öGV7BÖFWF–Âæ§2’¢fVGW&R6FÆörÂ&÷&œ:—F—&RFRV&Æ–46FÆöuf—6–&–Æ—G•7Â‚’WBFRÆÆöv—VRFR,:—6öÇWF–öâÖ&6Œ:’²Ö&¶WBÖFVÆVvF–öâæRf—B^(	–WF÷&—6W"öVF—FW"ÆL:–6—6–öâN(	–W‡÷6—F–öâV’Æ–ÖVçFR6WGFRÆV7GW&P¢Ò6Æ7VÂWFöÖF—VR6öÖÖ—76–öâ÷&WfVçVU÷6†&RWB–÷WB&æ6—&RôÖö&–ÆRÖöæW’¢†÷'2ÄõBb²ÆfVGW&R6WGFÆVÖVçBæRf—B^(	–GFW7FW"÷G&6W"ÆR7–6ÆR6ç2–çfVçFW"FRf÷&×VÆRæ’L:–6ÆVæ6†W"FRG&ç6fW'@¢Òl:—&—L:’N(	–Væ6—76VÖVçBWB:—FBFRF÷V&ÆR6öæf—&ÖF–öâ¢fVGW&R–ÖVçG0¢Ò6öçG&B§W&–F—VR'FVæ—&R6ö×ÆWB¢†÷'2&6¶VæBÂ6WVÆR6&ö¦V7F–öâWŒ:–7WF&ÆR÷W'&VçG&W"ÇW2F&@¢ÒÖöçFçBWBL:–6—6–öâFR&VÖ&÷W'6VÖVçB†F—7WFW2ç&VgVæEö¶ÖböF—7WFW2ç&VgVæEöWW"’¢fVGW&R&VgVæG2Â¦Ö—2L:–Ì:–v&ÆR(	Bl:—&—L:’f–ææ6œ:‡&R—',:—fW'6–&ÆRâ6Æ–VçBæ66Ræ†æFÆRæR–Æ÷FRVRÆRv÷&¶fÆ÷r‡7FGWBÂ,:—6öÇWF–öâFW‡GVVÆÆR’Â¦Ö—2ÆR6†–fg&P¢Ò7–6ÆRFRf–R7FGW2†G&gBö7F—fR÷7W7VæFVB’FW26W'f–6W2WBöfg&W2‡—6—VW2¢†÷'2:—&–Ü:‡G&RFRÆö6ÅööffW"æÖævRÂV’æR&67VÆRVR6öÖÖW&6–ÅöW‡÷7W&R²—56W'f–6TW‡÷6&ÆRö—5‡—6–6ÄöffW$W‡÷6&ÆR6öçF–çVVçBN(	–W†–vW"ÆW2FWW‚‡7FGW2UBW‡÷7W&R’(	B&÷f–FW'2×6W'f–6W2&W7FR&÷&œ:—F—&RGR7–6ÆR6ö×ÆW@¢Ò7,:–F–öâ$TE’Â6†ö—‚Ö÷VçBö7W'&Væ7’WB76vR$UTU5DTBÓâ”B¢¦Ö—2VæRWF÷&—L:’FRÎ(	–÷:—&FWW"—2²$TE’WB”B&W7FVçB6VçG&W‚Fç2ÆfVGW&R6WGFÆVÖVç@ ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	B6WGFRfVGW&R÷7<:†FRÆL:–Ì:–vF–öâN(	–WF÷&—L:’Ö&6Œ:’WB6öâ:—V—R²VÆÆRæR÷7<:†FRæ’ÆR,:–l:—&VçF–VÂÖ&¶WBÂæ’÷W&F÷%öÖ&¶WE÷66÷W2Âæ’W6W'2ç&öÆRÂæ’ÆW2,:†vÆW2u$õUÂæ’ÆW2föæ7F–öç2FW'&–â×WGVÆ—<:–W2Âæ’Æl:—&—L:’Ööì:—F—&RGR6WGFÆVÖVçBà ¢¢¤–çf&–çG2¢¢ ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ ¢¢¤÷vç2¢¢¢76–væÖVçEö6&–Æ—G•ö6V–Æ–ævÂ76–væÖVçEöÖVÖ&W'6†—6Â6&–Æ—G•÷&Vv—7G'–Â6V–Æ–æu÷FV×ÆFUö6&–Æ—F–W6Â6V–Æ–æu÷FV×ÆFW6ÂÖ&¶WEö66…ö6öçG&öÅ÷öÆ–6–W6ÂÖ&¶WEöFVÆVvF–öåöVF—FÂÖ&¶WEö÷W&F–æuö76–væÖVçG6ÂÖ&¶WE÷FVÕö–çf—FF–öç6ÂÖVÖ&W'6†—ö6&–Æ—F–W6  ¢¢¤W‡÷6W2¢¢¢3R–çFW&æÂ’‡2’Â32…EE–çFW&f6R‡2¢Ò66WD–çf—FF–öæ‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×FVÒ×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒFDÖVÖ&W'6†—‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒGF6„Ö&¶WDFVÆVvFVE&öÆTf÷&†Ö–FFÆWv&R÷&WV—&RÖÖ&¶WBÖFVÆVvFVB×&öÆRæ§2’(	B&W6öÇfV@¢Ò6öæf—&Õ6WGFÆVÖVçE&V6V—fVF‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6WGFÆVÖVçB×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò7&VFU&÷f–FW&‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò7&VFU&VÆ—6‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒVç7W&T÷W&F÷$ÖVÖ&W'6†—‡6W'f–6W2öÖ&¶WBÖ÷W&F÷"×&÷f—6–öæ–æræ§2’(	B&W6öÇfV@¢Òw&çDÖVÖ&W'6†—6&–Æ—F–W6‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Òw&çD÷W&F÷%66÷V‡6W'f–6W2öÖ&¶WBÖ÷W&F÷"×&÷f—6–öæ–æræ§2’(	B&W6öÇfV@¢Ò–çf—FUFVÔÖVÖ&W&‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×FVÒ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Òòââã#RFRÇW2Âfö—"dTEU$Uó3cæ§6öåğ ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆö6Â×7Fö6²„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’Â&÷f–FW'2×6W'f–6W2„DT4Ä$TEôäEôô%4U%dTB’Â6WGFÆVÖVçB„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢F6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFV6—6–öâ×6–væÇ2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ6öçG&öÂ×ÆæR„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’Â6WGFÆVÖVçB„DT4Ä$TEôäEôô%4U%dTB’ÂVç6öÆB×&W6öÇWF–öâ„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢Bf–6†–W"‡2’L:–6Æ,:’‡2¢Ò6öæf–r¢¢ÒÖ–FFÆWv&R¢@¢ÒÖ–w&F–öç2¢#0¢Ò&÷WFW2¢P¢Ò6W'f–6W2¢¢ÒFW7G2¢S  ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&Ö&¶WBÖFVÆVvF–öâ%Õğ ¢22Ö&¶WBÖ÷W&F÷"ÖF6†&ö&@ ¢¢¤¶–æB¢¢¢Væ6Æ76–f–VB+r¢¥7FGW2¢¢¢7Fv–æp ¢¢¥6W'f–6R¢¢¢W&ÖWGG&R:Vâ÷:—&FWW"—2†Ö&¶WEö÷W&F÷"’FR6R6öææV7FW"RF6†&ö&B6æöæ–6ÂÂFRL:–6–FW"WBW‡Æö—FW"6öâÖ&6Œ:’¢µ—2Â6öÖÖæFW2Â6FÆöwVR—2Â&–6–ærÆö6ÂÂ,:—6VR‡V"õ&VÆ—2ÂF÷VæRÂW‡:–F—F–öç2WBf–ææ6R—2(	B6ç2¦Ö—2fö—"ÆW2Föæì:–W2BwVâWG&RÖ&6Œ:’æ’&V6Wfö—"WFöÖF—VVÖVçBÆW2vW7FW2‡—6—VW2÷RWF÷&—L:—2vÆö&ÆW2FW2,;FÆW27:–6–Æ—<:—2à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò÷W&F–öç2v÷&·76R‡&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§2Â÷7<:–L:’"F6†&ö&F’¢ÆV7GW&R"÷W&F–öç2ç&VB²×WFF–öç2"W†V7WF–öââ¢W†7FR²W6W'2ç&öÆR6W'B6WVÆVÖVçBFR6ö×F–&–Æ—L:’&WVW7BÖÆö6Â,:‡2WF÷&—6F–öà¢Ò6FÆöwVR—2¢W‡÷6—F–öâö6öæf–wW&F–öâ&öGV—B9rÖ&6Œ:’f–ÆW2&–Ö—F—fW2Ö&¶WB×66÷VB²V7VæR×WFF–öâFRÆl:—&—L:’6FÆöwVRvÆö&ÆP¢ÒW‡:–F—F–öç2bF÷VæR¢f—6–&–Æ—L:’Â7WW'f—6–öâWB6öæf–wW&F–öâGRÖ&6Œ:’²vW7FW2‡—6—VW2÷G&ç6—B7:–6–Æ—<:—2&W7FVçB6÷VÖ—2W‚6&–Æ—F–W2L:–Fœ:–W0¢Òf–ææ6R—2¢&V6WGFW2Â6ü;·G2ÂÖ&vW2Â&&ö6†VÖVçG2Â§W7F–f–6F–g2WB6öæf–wW&F–öâÆö6ÆRÆ—g,:–R²7FW26ö×F&ÆW26Vç6–&ÆW2&W7FVçBW‡Æ–6—FVÖVçBL:–Ì:–w\:—0¢Òæf–vF–öâ6æöæ–6Â¢FöÖ–æW2f—6–&ÆW26VÆöâ&W7öç6–&–Æ—F–W2ö6&–Æ—F–W2VffV7F—fW2Â¦Ö—26VÆöâVæR6–×ÆR&öÖW76RT¢Ò&VÖöçFvRæf–vF–öâ,:‡2,:—6öÇWF–öâ7–æ2FRÆ6W76–öâ÷W"Æ—VW"ÆRf–ÇG&vR,;FÆRö6&–Æ—G¢Ò67&—B4Ä’&÷f—6–öâÖÖ&¶WBÖ÷W&F÷"æ§2¢7,:–F–öâWF–Æ—6FWW"²66÷RFöÖ—VRÂ–FV×÷FVç@¢Ò67&—B4Ä’6VVBÖÖ&¶WB×FW7BÖFFæ§2¢&æ27Fv–ær7G&–7FVÖVçBÖ&¶WB”B÷W"6FÆöwVRÂ&–6–ærWB6öÖÖæFW2FR&V6WGFR—0¢Ò&6÷W'26ö×ÆWB6–&ÆR¢Æöv–â(i"6öçFW‡B(i"F6†&ö&G266÷:—2(i"6FÆöwVR—2(i"FVÆ–W"(i"6öÖÖæFW2(i"÷:—&F–öç2ôF÷VæRôW‡:–F—F–öç2(i"f–ææ6R—2(i":—V—R÷'FæW'0¢Òö÷WEò ¢ÒF6†&ö&BÆVv7’†FÖ–âò’(	BvVÌ:’ÂÖ&¶WEö÷W&F÷"föÆöçF—&VÖVçBW†6ÇRFR$ôÄUõ4„TÄÅ0¢Ò6FÆöwVRtÄô$Âòl:—&—L:’&öGV—BvÆö&ÆRò&WV—&T6FÆötvÆö&ÄWF†÷&—G’(	B&W7FRVæRWF÷&—L:’6VçG&ÆR²æR26öæföæG&RfV26FÆöwVR—0¢Ò×WFF–öç2‡V"‡—6—VW2(	B6&–Æ—F–W2W†V7WF–öââ¢W‡Æ–6—FW2²ÆR,;FÆRW'6—7FçBæR6öç7F—GVR¦Ö—2Î(	–WF÷&—L:’Ö&6Œ:¢Ò×WFF–öç2FW'&–â&VÆ—2(	B6&–Æ—F–W2W†V7WF–öââ¢W‡Æ–6—FW2²VâvVçE÷&VÆ—2W'6—7FçB&W7FRVâÇW2&÷&ì:’"6öâ&VÆ—5ö–B‡—6—VP¢Ò7FW26ö×F&ÆW2vÆö&W‚Â6öç6öÆ–FF–öâ7&÷72ÖÖ&¶WBWBWF÷&—L:—2f–ææ6œ:‡&W26VçG&ÆW2(	B†÷'2L:–Ì:–vF–öâ—0¢Ò6÷W&6–ærvÆö&Â(	B&W7FR<:—,:’FçBVR6L:–Ì:–vF–öâ—2âvW7B2W‡Æ–6—FVÖVçBL:–6–L:–P¢Ò&–6–ær×WFF–öç2vÆö&ÆW2†Ç’7G&FVw’ÂWFFR6ö×WF—F÷"vÆö&Â’(	B,:—6W'l:–W2W‚WF÷&—L:—26÷'&W7öæFçFW2²ÆL:–6—6–öâÆö6ÆR&W7FRR—0¢Ò&Vf7GW&F–öâ×VÇF’ÖÖ&6Œ:’…&–Çv’Â‡V"f—†R’(	B6†çF–W"<:—,:’ÂL:—VæBGR&F–òFR6÷WfW'GW&P¢Ò&F–òFR6÷WfW'GW&R"Ö&6Œ:’(	B6†çF–W"&–6–ær†6R6BÂ26RÆ÷@ ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WFRWF÷&—L:’Ö&6Œ:’FR6WGFR7W&f6RFö—B:§G&RfÆ–L:–R"Ö&¶WBÖFVÆVvF–öâ²÷W&F÷%öÖ&¶WE÷66÷W2&W7FRVæR&ö¦V7F–öâFR6ö×F–&–Æ—L:’Â¦Ö—2Æ6÷W&6RFRG&ö—BFW2v÷&·76W2Ö–w,:—2à ¢¢¤–çf&–çG2¢¢ ¢ÒÆR66÷R6W'fWW"W7BÂvWF÷&—L:’(	BÆRæf–vFWW"æR6†ö—6—B¦Ö—26öâÖ&6Œ:¢ÒVæR&ö¦V7F–öâ÷W&F÷%öÖ&¶WE÷66÷W2æR7Vff—B¦Ö—2:VÆÆR6WVÆR¢ÆW2v÷&·76W2Ö–w,:—2W†–vVçBÖVÖ&W'6†—ö6&–Æ—G’÷RVæRWF÷&—L:’6VçG&ÆRW‡Æ–6—FP¢ÒÆR&W7öç6&ÆR—2Fö—BF—7÷6W"FW2÷WF–Ç26÷'&W7öæFçB:6&W7öç6&–Æ—L:’¢6FÆöwVR—2ÂFVÆ–W"Â6öÖÖæFW2Â÷:—&F–öç2ÂF÷VæRÂW‡:–F—F–öç2WBf–ææ6R—0¢ÒVâwV&B7GVVÆÆVÖVçBG&÷&W7G&–7F–b7W"VæR&W7öç6&–Æ—L:’6–&ÆRW7BVâvBv–×Ì:–ÖVçFF–öâ:fW&ÖW"Â2VæR§W7F–f–6F–öâ÷W"&WF—&W"6WGFR&W7öç6&–Æ—L:’FRÆFö7G&–æP¢Ò6FÆöwVR—2æRWWB¦Ö—2ÖöF–f–W"6–ÆVæ6–WW6VÖVçBÆl:—&—L:’6FÆöwVRvÆö&ÆP¢ÒÆW2×WFF–öç2‡—6—VW2‡V"‡66â÷6²÷6VÂ÷6†—’&W7FVçBW†6ÇW6—fVÖVçBFW'&œ:‡&RFW26&–Æ—F–W2FW'&–âW‡Æ–6—FW0¢ÒÆW2×WFF–öç2FW'&–â&VÆ—2‡,:–6WF–öâ÷&VÖ—6Rö66‚’&W7FVçBW†6ÇW6—fVÖVçBFW'&œ:‡&RFW26&–Æ—F–W2FW'&–âW‡Æ–6—FW0¢Òf–ææ6R—2æRFöææR¦Ö—2–×Æ–6—FVÖVçBVæRWF÷&—L:’6ö×F&ÆRvÆö&ÆR÷R7&÷72ÖÖ&¶W@¢ÒÆW2WF–Æ—G’Æ–æ·2BvWF÷&—L:’vÆö&ÆR6öçBÖ7\:—2÷W"ÆW2&öf–Ç2æöâWF÷&—<:—0¢ÒvVçEö‡V"æRF—&RV7VâÖ&¶WB”BFRW6W'2ç&öÆR²ÆW2vW7FW2GRv÷&·76R÷:—&F–öç2W†–vVçBÆWW"W†V7WF–öââ¢W†7FP¢ÒvVçE÷&VÆ—2&W7FRÆ–Ö—L:’:6öâ&VÆ—5ö–B‡—6—VR÷W"6W2vW7FW2FW'&–âÂVâÇW2FRÆ6&–Æ—G’W†V7WF–öââ¢W†7FP¢ÒÆRF6†&ö&BÆVv7’†FÖ–âò’æR&\:vö—B¦Ö—2Ö&¶WEö÷W&F÷"Fç2$ôÄUõ4„TÄÅ2(	B–ÂW7BvVÌ:¢ÒÆR&÷f—6–öæ–ærW7B–FV×÷FVçB(	BæR&V7,:–Ræ’W6W"æ’66÷RW†—7Fç@¢ÒÆR6VVB7Fv–æræR7,:–RÂâvW‡÷6Ræ’æRæWGFö–R¦Ö—2VæRFöæì:–RBwVâWG&RÖ&¶WB”@¢ÒÆR6VVB7Fv–æræRf'&—VR¦Ö—2Vâ&—‚Äô4Åô5D•dR6ç276vR"ÆRvFR:–6öæöÖ—VR6æöæ—VP ¢¢¤÷vç2¢¢¢öV7VæUğ ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢6FÆör„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢öV7VæUğ ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùúEDTåD”ôâ(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢@¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢ƒB’ ¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&WF‚"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&F6†&ö&B"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&Æöv—7F–72"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&÷&FW'2"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB ¢¢¤–×ÆVÖVçFF–öâ¢¢¢Rf–6†–W"‡2’L:–6Æ,:’‡2¢Ò67&—G2¢ ¢ÒFW7G2¢0 ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&Ö&¶WBÖ÷W&F÷"ÖF6†&ö&B%Õğ ¢22æ÷F–f–6F–öç0 ¢¢¤¶–æB¢¢¢'W6–æW72×G&ç7fW'6Â+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢&ö¦WFW"VæR–æf÷&ÖF–öâW76VçF–VÆÆRFç2ÂÆ–6F–öâfV27V—GFVÖVçB&÷&œ:—F—&R²6öç6W'fW"ÆW26æW‚6÷'FçG2†—7F÷&—VW2<:—,:—2WB&W7BÖVff÷'Bà ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢ÒVçfö’v†G4f–ÖWF¢ÒÖ÷FWW"BvÆW'FW2–çFW&æW0¢Ò&÷WFW2BvVÖ—76–öâFRæ÷F–f–6F–öà¢Ò7–6ÆR–âÖ6Æ–VçB÷VâÓâ6¶æ÷vÆVFvVBÂ&W6öÇfV@¢Ò,:–6öæ6–Æ–F–öâFW2G&ö—2¦Æöç2,:—&F–öâÂW‡:–F—F–öâWBF—7öæ–&–Æ—L:¢Ò6öçG&BW‡Æ–6—FR÷&FW"æW†6WF–öââ¢÷W"ÆW2:—l:–æVÖVçG2W†6WF–öææVÇ27F–öææ&ÆW0¢Òö÷WEò ¢ÒFW7G2÷Væ—Böæ÷F–f–6F–öâ×6W'f–6RçFW7Bæ§0¢ÒL:–6—6–öâÜ:—F–W"FRæ÷F–f–W"‡&W7FR:ÆfVGW&R:–ÖWGG&–6R ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WB6†ævVÖVçBFRFV×ÆFR÷RFR6æÂFö—BWG&RfÆ–FR"ÆR&÷&–WF—&RFRæ÷F–f–6F–öâ×6W'f–6Ræ§0 ¢¢¤–çf&–çG2¢¢ ¢Òæ÷F–f–6F–öç2W7BVâV—G2BvWfVæVÖVçG2(	BVÆÆRæRFV6–FR¦Ö—2VÆÆRÖÖVÖRRwVâWfVæVÖVçBÖWF–W"WRÆ–WP¢ÒÆ—g&—6öâ÷WF&÷VæB&W7BÖVff÷'B(	BÂvV6†V2BvVçfö’v†G4æRFö—B¦Ö—2&Æ÷VW"ÆG&ç67F–öâVÖWGG&–6R†f—&RÖæBÖf÷&vWB¢ÒVæRæ÷F–f–6F–öâ6Æ–VçBW7B–FV×÷FVçFRWB66W76–&ÆRVæ—VVÖVçB:6öâ&÷&œ:—F—&RWF†VçF–fœ:¢Ò7V—GFW"VæRæ÷F–f–6F–öâæRÖöF–f–R¦Ö—2Â:—FBÜ:—F–W"FRÆ6öÖÖæFP¢Ò6WVÇ2ÆW2:—l:–æVÖVçG2W76VçF–VÇ2WB7F–öææ&ÆW2VçG&VçBFç2ÆRfÇW‚6Æ–Vç@¢ÒÆÆV7GW&R,:–6öæ6–Æ–RVæR:–Ö—76–öâÖç\:–RFWV—2Æl:—&—L:’Ü:—F–W"6ç27,:–W"FRF÷V&Æöà¢ÒVâ¦ÆöâÇW2,:–6VçB,:—6÷WBÆR¦Æöâ,:–<:–FVçBFRÆÜ:¦ÖR6öÖÖæFR6ç27,:–W"VâÖW76vR÷W"–å÷G&ç6—@¢ÒVæRW†6WF–öâW†–vRVæR6Ì:’÷&FW"æW†6WF–öââ¢WBVâL:–6ÆVæ6†WW"Ü:—F–W"6öæf—&Ü:¢ÒÆRv†G4FRF—7öæ–&–Æ—L:’WWBVç&–6†—"6öâÖW76vRW†—7FçBBVâVæ—VRÆ–Vâ6'Föw&†—VRL:—&—l:’GRæöÒWFÚ±î¸Â¸­yêë¢°k¢G§¦*^m«ëŒ+Š×®º+º$zzb¥ç@¢Ò,;FÆRvÆö&ÂW6W'2ç&öÆRWBW6W"ç&öÆRç6WB¢g&öçFœ:‡&RWF‚Ö–FVçF—G’ôu$õUÂ¦Ö—2L:–Ì:–w\:–RR'FVæ—&P¢Ò,:†vÆW2N(	–ÆÆö6F–öâu$õUWBl:—&—L:’:–6öæöÖ—VR6öç6öÆ–L:–R¢V6öæöÖ–2ÖVæv–æP¢Òföæ7F–öç2‡V"÷G&ç6—B×WGVÆ—<:–W2¢†÷'2Ö&¶WB÷W&F–ær76–væÖVç@¢Ò&÷f–FW'2÷&VÆ—26öÖÖR&–æ6—W‚Æö6W‚6V6öæF—&W2¢¦Ö—2FW276–væÖVçG26öæ7W'&VçG2²ÆWW"vW7F–öâÆö6ÆR&W7FRL:–Ì:–wV&ÆR6ç2G&ç6f÷&ÖW"ÆWW"–FVçF—L:’VâW6W%÷&öÆP¢ÒÆV7GW&RV&Æ—VRGR,:—6VR&VÆ—2„tUBö’÷&VÆ—2’WB6öâ7–6ÆRFRf–RFV6†æ—VR†÷'2L:–Ì:–vF–öâ¢fVGW&RÆöv—7F–72Â&÷&œ:—F—&RFRÆF&ÆR&VÆ—0¢Ò&÷WFvR–çFW"Ü:æÆW2´Ò†—6ÆæBö—6ÆæEö6öFR6öç6öÖÜ:—2"6W'f–6W2÷&÷WF–æræ§2’¢†÷'2:—&–Ü:‡G&RÂ6÷WÆvR|:–öw&†—VR,:’ÖW†—7FçBæöâ,:—6öÇR"6WGFRfVGW&P¢Ò6FÆöwVRvÆö&Â‡&öGV7G2’¢fVGW&R6FÆör&W7FRÆ–fV7–6ÆR÷væW"²Ö&¶WBÖFVÆVvF–öâî(	œ:–7&—B¦Ö—2&öGV7G2F—&V7FVÖVçBWBæRWWBL:–6ÆVæ6†W"VæR&VÖœ:‡&RV&Æ–6F–öâ^(	–VâL:–Ì:–wVçB:6FÆörÖ&÷fÂÆ÷'2N(	—VæRfÆ–FF–öâ‡VÖ–æRÖ&6Œ:’²&öGV7EöÖ&¶WEöW‡÷7W&R&W7FRÆ&ö¦V7F–öâ—0¢Ò<:&&ÆvRGR6†VÖ–âFRÆV7GW&R7F÷&Vg&öçB†6FÆör×V&Æ–2×f–Wræ§2ò6FÆör×&öGV7BÖFWF–Âæ§2’¢fVGW&R6FÆörÂ&÷&œ:—F—&RFRV&Æ–46FÆöuf—6–&–Æ—G•7Â‚’WBFRÆÆöv—VRFR,:—6öÇWF–öâÖ&6Œ:’²Ö&¶WBÖFVÆVvF–öâæRf—B^(	–WF÷&—6W"öVF—FW"ÆL:–6—6–öâN(	–W‡÷6—F–öâV’Æ–ÖVçFR6WGFRÆV7GW&P¢Ò6Æ7VÂWFöÖF—VR6öÖÖ—76–öâ÷&WfVçVU÷6†&RWB–÷WB&æ6—&RôÖö&–ÆRÖöæW’¢†÷'2ÄõBb²ÆfVGW&R6WGFÆVÖVçBæRf—B^(	–GFW7FW"÷G&6W"ÆR7–6ÆR6ç2–çfVçFW"FRf÷&×VÆRæ’L:–6ÆVæ6†W"FRG&ç6fW'@¢Òl:—&—L:’N(	–Væ6—76VÖVçBWB:—FBFRF÷V&ÆR6öæf—&ÖF–öâ¢fVGW&R–ÖVçG0¢Ò6öçG&B§W&–F—VR'FVæ—&R6ö×ÆWB¢†÷'2&6¶VæBÂ6WVÆR6&ö¦V7F–öâWŒ:–7WF&ÆR÷W'&VçG&W"ÇW2F&@¢ÒÖöçFçBWBL:–6—6–öâFR&VÖ&÷W'6VÖVçB†F—7WFW2ç&VgVæEö¶ÖböF—7WFW2ç&VgVæEöWW"’¢fVGW&R&VgVæG2Â¦Ö—2L:–Ì:–v&ÆR(	Bl:—&—L:’f–ææ6œ:‡&R—',:—fW'6–&ÆRâ6Æ–VçBæ66Ræ†æFÆRæR–Æ÷FRVRÆRv÷&¶fÆ÷r‡7FGWBÂ,:—6öÇWF–öâFW‡GVVÆÆR’Â¦Ö—2ÆR6†–fg&P¢Ò7–6ÆRFRf–R7FGW2†G&gBö7F—fR÷7W7VæFVB’FW26W'f–6W2WBöfg&W2‡—6—VW2¢†÷'2:—&–Ü:‡G&RFRÆö6ÅööffW"æÖævRÂV’æR&67VÆRVR6öÖÖW&6–ÅöW‡÷7W&R²—56W'f–6TW‡÷6&ÆRö—5‡—6–6ÄöffW$W‡÷6&ÆR6öçF–çVVçBN(	–W†–vW"ÆW2FWW‚‡7FGW2UBW‡÷7W&R’(	B&÷f–FW'2×6W'f–6W2&W7FR&÷&œ:—F—&RGR7–6ÆR6ö×ÆW@¢Ò7,:–F–öâ$TE’Â6†ö—‚Ö÷VçBö7W'&Væ7’WB76vR$UTU5DTBÓâ”B¢¦Ö—2VæRWF÷&—L:’FRÎ(	–÷:—&FWW"—2²$TE’WB”B&W7FVçB6VçG&W‚Fç2ÆfVGW&R6WGFÆVÖVç@ ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	B6WGFRfVGW&R÷7<:†FRÆL:–Ì:–vF–öâN(	–WF÷&—L:’Ö&6Œ:’WB6öâ:—V—R²VÆÆRæR÷7<:†FRæ’ÆR,:–l:—&VçF–VÂÖ&¶WBÂæ’÷W&F÷%öÖ&¶WE÷66÷W2Âæ’W6W'2ç&öÆRÂæ’ÆW2,:†vÆW2u$õUÂæ’ÆW2föæ7F–öç2FW'&–â×WGVÆ—<:–W2Âæ’Æl:—&—L:’Ööì:—F—&RGR6WGFÆVÖVçBà ¢¢¤–çf&–çG2¢¢ ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ ¢¢¤÷vç2¢¢¢76–væÖVçEö6&–Æ—G•ö6V–Æ–ævÂ76–væÖVçEöÖVÖ&W'6†—6Â6&–Æ—G•÷&Vv—7G'–Â6V–Æ–æu÷FV×ÆFUö6&–Æ—F–W6Â6V–Æ–æu÷FV×ÆFW6ÂÖ&¶WEö66…ö6öçG&öÅ÷öÆ–6–W6ÂÖ&¶WEöFVÆVvF–öåöVF—FÂÖ&¶WEö÷W&F–æuö76–væÖVçG6ÂÖ&¶WE÷FVÕö–çf—FF–öç6ÂÖVÖ&W'6†—ö6&–Æ—F–W6  ¢¢¤W‡÷6W2¢¢¢3R–çFW&æÂ’‡2’Â32…EE–çFW&f6R‡2¢Ò66WD–çf—FF–öæ‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×FVÒ×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒFDÖVÖ&W'6†—‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒGF6„Ö&¶WDFVÆVvFVE&öÆTf÷&†Ö–FFÆWv&R÷&WV—&RÖÖ&¶WBÖFVÆVvFVB×&öÆRæ§2’(	B&W6öÇfV@¢Ò6öæf—&Õ6WGFÆVÖVçE&V6V—fVF‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6WGFÆVÖVçB×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò7&VFU&÷f–FW&‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò7&VFU&VÆ—6‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒVç7W&T÷W&F÷$ÖVÖ&W'6†—‡6W'f–6W2öÖ&¶WBÖ÷W&F÷"×&÷f—6–öæ–æræ§2’(	B&W6öÇfV@¢Òw&çDÖVÖ&W'6†—6&–Æ—F–W6‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Òw&çD÷W&F÷%66÷V‡6W'f–6W2öÖ&¶WBÖ÷W&F÷"×&÷f—6–öæ–æræ§2’(	B&W6öÇfV@¢Ò–çf—FUFVÔÖVÖ&W&‡6W'f–6W2öÖ&¶WBÖFVÆVvF–öâ×FVÒ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Òòââã#RFRÇW2Âfö—"dTEU$Uó3cæ§6öåğ ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆö6Â×7Fö6²„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’Â&÷f–FW'2×6W'f–6W2„DT4Ä$TEôäEôô%4U%dTB’Â6WGFÆVÖVçB„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢F6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFV6—6–öâ×6–væÇ2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ6öçG&öÂ×ÆæR„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’Â6WGFÆVÖVçB„DT4Ä$TEôäEôô%4U%dTB’ÂVç6öÆB×&W6öÇWF–öâ„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢Bf–6†–W"‡2’L:–6Æ,:’‡2¢Ò6öæf–r¢¢ÒÖ–FFÆWv&R¢@¢ÒÖ–w&F–öç2¢#0¢Ò&÷WFW2¢P¢Ò6W'f–6W2¢¢ÒFW7G2¢S  ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&Ö&¶WBÖFVÆVvF–öâ%Õğ ¢22Ö&¶WBÖ÷W&F÷"ÖF6†&ö&@ ¢¢¤¶–æB¢¢¢Væ6Æ76–f–VB+r¢¥7FGW2¢¢¢7Fv–æp ¢¢¥6W'f–6R¢¢¢W&ÖWGG&R:Vâ÷:—&FWW"—2†Ö&¶WEö÷W&F÷"’FR6R6öææV7FW"RF6†&ö&B6æöæ–6ÂÂFRL:–6–FW"WBW‡Æö—FW"6öâÖ&6Œ:’¢µ—2Â6öÖÖæFW2Â6FÆöwVR—2Â&–6–ærÆö6ÂÂ,:—6VR‡V"õ&VÆ—2ÂF÷VæRÂW‡:–F—F–öç2WBf–ææ6R—2(	B6ç2¦Ö—2fö—"ÆW2Föæì:–W2BwVâWG&RÖ&6Œ:’æ’&V6Wfö—"WFöÖF—VVÖVçBÆW2vW7FW2‡—6—VW2÷RWF÷&—L:—2vÆö&ÆW2FW2,;FÆW27:–6–Æ—<:—2à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò÷W&F–öç2v÷&·76R‡&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§2Â÷7<:–L:’"F6†&ö&F’¢ÆV7GW&R"÷W&F–öç2ç&VB²×WFF–öç2"W†V7WF–öââ¢W†7FR²W6W'2ç&öÆR6W'B6WVÆVÖVçBFR6ö×F–&–Æ—L:’&WVW7BÖÆö6Â,:‡2WF÷&—6F–öà¢Ò6FÆöwVR—2¢W‡÷6—F–öâö6öæf–wW&F–öâ&öGV—B9rÖ&6Œ:’f–ÆW2&–Ö—F—fW2Ö&¶WB×66÷VB²V7VæR×WFF–öâFRÆl:—&—L:’6FÆöwVRvÆö&ÆP¢ÒW‡:–F—F–öç2bF÷VæR¢f—6–&–Æ—L:’Â7WW'f—6–öâWB6öæf–wW&F–öâGRÖ&6Œ:’²vW7FW2‡—6—VW2÷G&ç6—B7:–6–Æ—<:—2&W7FVçB6÷VÖ—2W‚6&–Æ—F–W2L:–Fœ:–W0¢Òf–ææ6R—2¢&V6WGFW2Â6ü;·G2ÂÖ&vW2Â&&ö6†VÖVçG2Â§W7F–f–6F–g2WB6öæf–wW&F–öâÆö6ÆRÆ—g,:–R²7FW26ö×F&ÆW26Vç6–&ÆW2&W7FVçBW‡Æ–6—FVÖVçBL:–Ì:–w\:—0¢Òæf–vF–öâ6æöæ–6Â¢FöÖ–æW2f—6–&ÆW26VÆöâ&W7öç6–&–Æ—F–W2ö6&–Æ—F–W2VffV7F—fW2Â¦Ö—26VÆöâVæR6–×ÆR&öÖW76RT¢Ò&VÖöçFvRæf–vF–öâ,:‡2,:—6öÇWF–öâ7–æ2FRÆ6W76–öâ÷W"Æ—VW"ÆRf–ÇG&vR,;FÆRö6&–Æ—G¢Ò67&—B4Ä’&÷f—6–öâÖÖ&¶WBÖ÷W&F÷"æ§2¢7,:–F–öâWF–Æ—6FWW"²66÷RFöÖ—VRÂ–FV×÷FVç@¢Ò67&—B4Ä’6VVBÖÖ&¶WB×FW7BÖFFæ§2¢&æ27Fv–ær7G&–7FVÖVçBÖ&¶WB”B÷W"6FÆöwVRÂ&–6–ærWB6öÖÖæFW2FR&V6WGFR—0¢Ò&6÷W'26ö×ÆWB6–&ÆR¢Æöv–â(i"6öçFW‡B(i"F6†&ö&G266÷:—2(i"6FÆöwVR—2(i"FVÆ–W"(i"6öÖÖæFW2(i"÷:—&F–öç2ôF÷VæRôW‡:–F—F–öç2(i"f–ææ6R—2(i":—V—R÷'FæW'0¢Òö÷WEò ¢ÒF6†&ö&BÆVv7’†FÖ–âò’(	BvVÌ:’ÂÖ&¶WEö÷W&F÷"föÆöçF—&VÖVçBW†6ÇRFR$ôÄUõ4„TÄÅ0¢Ò6FÆöwVRtÄô$Âòl:—&—L:’&öGV—BvÆö&ÆRò&WV—&T6FÆötvÆö&ÄWF†÷&—G’(	B&W7FRVæRWF÷&—L:’6VçG&ÆR²æR26öæföæG&RfV26FÆöwVR—0¢Ò×WFF–öç2‡V"‡—6—VW2(	B6&–Æ—F–W2W†V7WF–öââ¢W‡Æ–6—FW2²ÆR,;FÆRW'6—7FçBæR6öç7F—GVR¦Ö—2Î(	–WF÷&—L:’Ö&6Œ:¢Ò×WFF–öç2FW'&–â&VÆ—2(	B6&–Æ—F–W2W†V7WF–öââ¢W‡Æ–6—FW2²VâvVçE÷&VÆ—2W'6—7FçB&W7FRVâÇW2&÷&ì:’"6öâ&VÆ—5ö–B‡—6—VP¢Ò7FW26ö×F&ÆW2vÆö&W‚Â6öç6öÆ–FF–öâ7&÷72ÖÖ&¶WBWBWF÷&—L:—2f–ææ6œ:‡&W26VçG&ÆW2(	B†÷'2L:–Ì:–vF–öâ—0¢Ò6÷W&6–ærvÆö&Â(	B&W7FR<:—,:’FçBVR6L:–Ì:–vF–öâ—2âvW7B2W‡Æ–6—FVÖVçBL:–6–L:–P¢Ò&–6–ær×WFF–öç2vÆö&ÆW2†Ç’7G&FVw’ÂWFFR6ö×WF—F÷"vÆö&Â’(	B,:—6W'l:–W2W‚WF÷&—L:—26÷'&W7öæFçFW2²ÆL:–6—6–öâÆö6ÆR&W7FRR—0¢Ò&Vf7GW&F–öâ×VÇF’ÖÖ&6Œ:’…&–Çv’Â‡V"f—†R’(	B6†çF–W"<:—,:’ÂL:—VæBGR&F–òFR6÷WfW'GW&P¢Ò&F–òFR6÷WfW'GW&R"Ö&6Œ:’(	B6†çF–W"&–6–ær†6R6BÂ26RÆ÷@ ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WFRWF÷&—L:’Ö&6Œ:’FR6WGFR7W&f6RFö—B:§G&RfÆ–L:–R"Ö&¶WBÖFVÆVvF–öâ²÷W&F÷%öÖ&¶WE÷66÷W2&W7FRVæR&ö¦V7F–öâFR6ö×F–&–Æ—L:’Â¦Ö—2Æ6÷W&6RFRG&ö—BFW2v÷&·76W2Ö–w,:—2à ¢¢¤–çf&–çG2¢¢ ¢ÒÆR66÷R6W'fWW"W7BÂvWF÷&—L:’(	BÆRæf–vFWW"æR6†ö—6—B¦Ö—26öâÖ&6Œ:¢ÒVæR&ö¦V7F–öâ÷W&F÷%öÖ&¶WE÷66÷W2æR7Vff—B¦Ö—2:VÆÆR6WVÆR¢ÆW2v÷&·76W2Ö–w,:—2W†–vVçBÖVÖ&W'6†—ö6&–Æ—G’÷RVæRWF÷&—L:’6VçG&ÆRW‡Æ–6—FP¢ÒÆR&W7öç6&ÆR—2Fö—BF—7÷6W"FW2÷WF–Ç26÷'&W7öæFçB:6&W7öç6&–Æ—L:’¢6FÆöwVR—2ÂFVÆ–W"Â6öÖÖæFW2Â÷:—&F–öç2ÂF÷VæRÂW‡:–F—F–öç2WBf–ææ6R—0¢ÒVâwV&B7GVVÆÆVÖVçBG&÷&W7G&–7F–b7W"VæR&W7öç6&–Æ—L:’6–&ÆRW7BVâvBv–×Ì:–ÖVçFF–öâ:fW&ÖW"Â2VæR§W7F–f–6F–öâ÷W"&WF—&W"6WGFR&W7öç6&–Æ—L:’FRÆFö7G&–æP¢Ò6FÆöwVR—2æRWWB¦Ö—2ÖöF–f–W"6–ÆVæ6–WW6VÖVçBÆl:—&—L:’6FÆöwVRvÆö&ÆP¢ÒÆW2×WFF–öç2‡—6—VW2‡V"‡66â÷6²÷6VÂ÷6†—’&W7FVçBW†6ÇW6—fVÖVçBFW'&œ:‡&RFW26&–Æ—F–W2FW'&–âW‡Æ–6—FW0¢ÒÆW2×WFF–öç2FW'&–â&VÆ—2‡,:–6WF–öâ÷&VÖ—6Rö66‚’&W7FVçBW†6ÇW6—fVÖVçBFW'&œ:‡&RFW26&–Æ—F–W2FW'&–âW‡Æ–6—FW0¢Òf–ææ6R—2æRFöææR¦Ö—2–×Æ–6—FVÖVçBVæRWF÷&—L:’6ö×F&ÆRvÆö&ÆR÷R7&÷72ÖÖ&¶W@¢ÒÆW2WF–Æ—G’Æ–æ·2BvWF÷&—L:’vÆö&ÆR6öçBÖ7\:—2÷W"ÆW2&öf–Ç2æöâWF÷&—<:—0¢ÒvVçEö‡V"æRF—&RV7VâÖ&¶WB”BFRW6W'2ç&öÆR²ÆW2vW7FW2GRv÷&·76R÷:—&F–öç2W†–vVçBÆWW"W†V7WF–öââ¢W†7FP¢ÒvVçE÷&VÆ—2&W7FRÆ–Ö—L:’:6öâ&VÆ—5ö–B‡—6—VR÷W"6W2vW7FW2FW'&–âÂVâÇW2FRÆ6&–Æ—G’W†V7WF–öââ¢W†7FP¢ÒÆRF6†&ö&BÆVv7’†FÖ–âò’æR&\:vö—B¦Ö—2Ö&¶WEö÷W&F÷"Fç2$ôÄUõ4„TÄÅ2(	B–ÂW7BvVÌ:¢ÒÆR&÷f—6–öæ–ærW7B–FV×÷FVçB(	BæR&V7,:–Ræ’W6W"æ’66÷RW†—7Fç@¢ÒÆR6VVB7Fv–æræR7,:–RÂâvW‡÷6Ræ’æRæWGFö–R¦Ö—2VæRFöæì:–RBwVâWG&RÖ&¶WB”@¢ÒÆR6VVB7Fv–æræRf'&—VR¦Ö—2Vâ&—‚Äô4Åô5D•dR6ç276vR"ÆRvFR:–6öæöÖ—VR6æöæ—VP ¢¢¤÷vç2¢¢¢öV7VæUğ ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢6FÆör„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢öV7VæUğ ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùúEDTåD”ôâ(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢@¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢ƒB’ ¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&WF‚"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&F6†&ö&B"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&Æöv—7F–72"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&÷&FW'2"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB ¢¢¤–×ÆVÖVçFF–öâ¢¢¢Rf–6†–W"‡2’L:–6Æ,:’‡2¢Ò67&—G2¢ ¢ÒFW7G2¢0 ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&Ö&¶WBÖ÷W&F÷"ÖF6†&ö&B%Õğ ¢22æ÷F–f–6F–öç0 ¢¢¤¶–æB¢¢¢'W6–æW72×G&ç7fW'6Â+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢&ö¦WFW"VæR–æf÷&ÖF–öâW76VçF–VÆÆRFç2ÂÆ–6F–öâfV27V—GFVÖVçB&÷&œ:—F—&R²6öç6W'fW"ÆW26æW‚6÷'FçG2†—7F÷&—VW2<:—,:—2WB&W7BÖVff÷'Bà ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢ÒVçfö’v†G4f–ÖWF¢ÒÖ÷FWW"BvÆW'FW2–çFW&æW0¢Ò&÷WFW2BvVÖ—76–öâFRæ÷F–f–6F–öà¢Ò7–6ÆR–âÖ6Æ–VçB÷VâÓâ6¶æ÷vÆVFvVBÂ&W6öÇfV@¢Ò,:–6öæ6–Æ–F–öâFW2G&ö—2¦Æöç2,:—&F–öâÂW‡:–F—F–öâWBF—7öæ–&–Æ—L:¢Ò6öçG&BW‡Æ–6—FR÷&FW"æW†6WF–öââ¢÷W"ÆW2:—l:–æVÖVçG2W†6WF–öææVÇ27F–öææ&ÆW0¢Òö÷WEò ¢ÒFW7G2÷Væ—Böæ÷F–f–6F–öâ×6W'f–6RçFW7Bæ§0¢ÒL:–6—6–öâÜ:—F–W"FRæ÷F–f–W"‡&W7FR:ÆfVGW&R:–ÖWGG&–6R ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WB6†ævVÖVçBFRFV×ÆFR÷RFR6æÂFö—BWG&RfÆ–FR"ÆR&÷&–WF—&RFRæ÷F–f–6F–öâ×6W'f–6Ræ§0 ¢¢¤–çf&–çG2¢¢ ¢Òæ÷F–f–6F–öç2W7BVâV—G2BvWfVæVÖVçG2(	BVÆÆRæRFV6–FR¦Ö—2VÆÆRÖÖVÖRRwVâWfVæVÖVçBÖWF–W"WRÆ–WP¢ÒÆ—g&—6öâ÷WF&÷VæB&W7BÖVff÷'B(	BÂvV6†V2BvVçfö’v†G4æRFö—B¦Ö—2&Æ÷VW"ÆG&ç67F–öâVÖWGG&–6R†f—&RÖæBÖf÷&vWB¢ÒVæRæ÷F–f–6F–öâ6Æ–VçBW7B–FV×÷FVçFRWB66W76–&ÆRVæ—VVÖVçB:6öâ&÷&œ:—F—&RWF†VçF–fœ:¢Ò7V—GFW"VæRæ÷F–f–6F–öâæRÖöF–f–R¦Ö—2Â:—FBÜ:—F–W"FRÆ6öÖÖæFP¢Ò6WVÇ2ÆW2:—l:–æVÖVçG2W76VçF–VÇ2WB7F–öææ&ÆW2VçG&VçBFç2ÆRfÇW‚6Æ–Vç@¢ÒÆÆV7GW&R,:–6öæ6–Æ–RVæR:–Ö—76–öâÖç\:–RFWV—2Æl:—&—L:’Ü:—F–W"6ç27,:–W"FRF÷V&Æöà¢ÒVâ¦ÆöâÇW2,:–6VçB,:—6÷WBÆR¦Æöâ,:–<:–FVçBFRÆÜ:¦ÖR6öÖÖæFR6ç27,:–W"VâÖW76vR÷W"–å÷G&ç6—@¢ÒVæRW†6WF–öâW†–vRVæR6Ì:’÷&FW"æW†6WF–öââ¢WBVâL:–6ÆVæ6†WW"Ü:—F–W"6öæf—&Ü:¢ÒÆRv†G4FRF—7öæ–&–Æ—L:’WWBVç&–6†—"6öâÖW76vRW†—7FçBBVâVæ—VRÆ–Vâ6'Föw&†—VRL:—&—l:’GRæöÒWF6F–öç2öÖ—62æ§2’(	B&W6öÇfV@¢Ò6VæD÷GÖW76vRò6VæDÖv–4Æ–æ¶‡6W'f–6W2öæ÷F–f–6F–öç2ö÷GÖWF‚æ§2’(	B&W6öÇfV@¢Ò6WDæ÷F–f–6F–öä÷WF6öÖTÆ—7FVæW&‡6W'f–6W2öæ÷F–f–6F–öç2ö–çFW&æÇ2æ§2’(	B&W6öÇfV@ ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â–æ6–FVçBÖÖævVÖVçB„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’ÂÆFf÷&ÒÖ÷2„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÆ÷–ÇG’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂW&6†6–ær„DT4Ä$TEôäEôô%4U%dTB’Â&VgVæG2„DT4Ä$TEôäEôô%4U%dTB’Â6†&VBÖ6'B„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùúEDTåD”ôâ(	BvFW3¢6†V6³¦–×÷'G2Âf–Ã¢Âv&ã¢¢Ò¶6†V6³¦–×÷'G5Ò	ùúDU…BÔtDRÔD”täõ5D”2(	B)ª§2ö"Öæ÷F–f–6F–öç2æ§2(	BW‡÷'B‡2’æöâ6öç6öÖÜ:’‡2’  ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢C’f–6†–W"‡2’L:–6Æ,:’‡2’Â&÷WF—VS¢2f–6†–W"‡2¢ÒÖ–w&F–öç2¢`¢Ò&÷WFW2¢@¢Ò6W'f–6W2¢@¢ÒFW7G2¢#0¢ÒWF–Ç2¢  ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&æ÷F–f–6F–öç2%Õğ ¢22÷&FW'0 ¢¢¤¶–æB¢¢¢'W6–æW72ÖfVGW&R+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢f—&RW†—7FW"VæR6öÖÖæFRÂFRÆ7&VF–öâR7FGWBf–æÂÂfV2Vâ6÷WBf–wW&RWBVæR&VfW&Væ6RÆ—6–&ÆRà ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò7&VF–öâÂæçVÆF–öâÂÖ6†–æRFR7FGWBFRÆ6öÖÖæFP¢Ò6æ6†÷BFR6÷WBÆ6öÖÖæFP¢Ò&GF6†VÖVçBW‚6öÆ—2WBW‚6†G2f÷W&æ—76WW'0¢Ò6öÆÆV7FR"R&WG&—@¢Ò&ö¦V7F–öâ6†V6¶÷WB&÷WF—VR¢f–æÆ—6F–öâN(	—VæR<:–ÆV7F–öâVâ6öÖÖæFRÂ6ç2÷væW'6†—FRÎ(	–Væ6—76VÖVç@¢Òv÷&¶fÆ÷rFRÆ—F–vR†F—7WFW2’¢7FGWB÷Vâ÷&ö6W76–ær÷&W6öÇfVBö6Æ÷6VBWBæ÷FRFR,:—6öÇWF–öâ(	B6W'f–6W2öF—7WFRÖ×WFF–öâ×6W'f–6Ræ§2Â¦Ö—2&VgVæEö¶Öb÷&VgVæEöWW"ÂV’&W7FVçB†÷'2FR6Rv÷&¶fÆ÷r‡fö—"&VgVæG26’ÖFW76÷W2¢Ò4bc¢FVÖæFRFR&WF÷W"&GF6Œ:–R:Vâ'F–6ÆR,:–VÆÆVÖVçB&VÖ—2Â6ç2&WWfRFR&W&—6R‡—6—VRæ’Ö÷WfVÖVçBf–ææ6–W ¢Òö÷WEò ¢ÒVæ6—76VÖVçBGR–VÖVçB†fVGW&R–ÖVçG2¢ÒÆöv—VRæ–W"'FvR†fVGW&R6†&VBÖ6'BÂ6öç6öÖÖG&–6RBv÷&FW'2¢Ò&VÖ&÷W'6VÖVçB†fVGW&R&VgVæG2ÂÆV7GW&R6WVÆR7W"÷&FW'2’(	BÆRÖöçFçB&VgVæEö¶Öb÷&VgVæEöWW"BwVâÆ—F–vRâvW7Bæ’ÇRæ’:–7&—B"ÆRv÷&¶fÆ÷rFR7FGWBÂÜ:¦ÖRVæBÆRÆ—F–vR76R&W6öÇfVBö6Æ÷6V@¢ÒF&–f–6F–öâ†fVGW&RV6öæöÖ–2ÖVæv–æRÂ÷&FW'2æRf—BVRÆ6öç6öÖÖW"¢ÒÖL:—&–Æ—6F–öâÂ6öç6W'fF–öâWBL:–Ì:–6†&vVÖVçBFW2f7GW&W2†fVGW&RFö7VÖVçG2²÷&FW'2æRf÷W&æ—BVRÎ(	œ:—l:–æVÖVçB6öæf—&Ü:’WBÆW2Föæì:–W26÷W&6R¢ÒVævvVÖVçBf÷W&æ—76WW"¢7,:–F–öâÂ6öæf—&ÖF–öâÂ,:–6WF–öâWBæçVÆF–öâBwVâ&öâFR6öÖÖæFR†fVGW&RW&6†6–ærÂ66–æL:–RBv÷&FW'2RÆ÷BóãBÂ##bÓrÓ"’(	B÷&FW'2L:–6ÆVæ6†RÆ7–æ6‡&öæ—6F–öâBvæçVÆF–öâf–Ât’–çFW&æRW&6†6–ærÂ6ç25ÂF—&V7B7W"W&6†6Uö÷&FW'0 ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WB6†ævVÖVçBFRÆÖ6†–æRFR7FGWB÷RGR66†VÖ÷&FW%÷&VfW&Væ6RFö—BWG&RfÆ–FR"ÆR&÷&–WF—&RFR÷&FW"×7FGW2ÖÖ6†–æRæ§0 ¢¢¤–çf&–çG2¢¢ ¢Ò¶ö&¦V7Bö&¦V7EĞ¢ÒæçVÆF–öâÆ–'&RWBRfçB÷&FW&VB‡Ææ6†W"#F‚’²6öÖÖæFRfW&ÖRFW2÷&FW&VB(	BFVÖæFRvÆÆWBÖöæÇ’Vç7V—FR„Dô5E$”äUôäåTÄD”ôâ¢ÒÆR&FvR&VÖ&÷W'6&ÆRôfW&ÖRGR7V—f’U5BÆR6öçG&B¢–ÂæRF—B¦Ö—2WG&R6†÷6RVR6RVRÆR6öFRf—@¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢ÒG&ç6—F–öâFR7FGWBVæ—VVÖVçBf–÷&FW"×7FGW2ÖÖ6†–æRæ§0¢ÒæçVÆF–öâÆ–&W&RÆW26†G2f÷W&æ—76WW'2Æ–W2Fç2ÆÖVÖRG&ç67F–öâf–W&6†6–æp ¢¢¤÷vç2¢¢¢7W7Fö×5ö†—7F÷'–ÂF—7WFW6Â÷&FW%ö6†V6¶÷WEö–FV×÷FVæ7–Â÷&FW%ö6öÖÖVçG6Â÷&FW%ö—FVÕö6÷7Eö–×WFF–öç6Â÷&FW%ö—FV×6Â÷&FW%÷7FGW5ö†—7F÷'–Â÷&FW'6Â&V6—–VçG6Â&VÆ•÷&WGW&åö6ö×Vç6F–öç6Â6×5öÆöv ¢¢¥w&—FW2†æ÷B÷væW"’¢¢¢66ç6‡w&—FW"Öæ÷BÖ÷væW"’Â6–væÇ6‡w&—FW"Öæ÷BÖ÷væW" ¢¢¤W‡÷6W2¢¢¢3–çFW&æÂ’‡2’Â#r…EE–çFW&f6R‡2¢ÒVæD÷&FW$æ÷FV‡6W'f–6W2ö÷&FW"Ö×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò&6¶f–ÆÅ&÷WF–ætf–VÆG6‡6W'f–6W2ö÷&FW"Ö×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Ò6†V6¶÷WD6'F‡V&Æ–2ö&÷WF—VRö§2ö"Ö6†V6¶÷WBæ§2’(	B&W6öÇfV@¢Òf–æÆ—¦U–6·W6öÆÆV7F–öæ‡6W'f–6W2ö÷&FW"Ö×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Òf÷&6U–ÖVçE7FGW4f÷%6–×VÆF–öæ‡6W'f–6W2÷–ÖVçB×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒÖ¶T–çWF‡V&Æ–2ö&÷WF—VRö§2ö"Ö6†V6¶÷WBæ§2’(	B&W6öÇfV@¢ÒÖ&´66…–DF‡6W'f–6W2ö÷&FW"Ö×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒÖ&´66…&VÖ–æFW%6VçF‡6W'f–6W2ö÷&FW"Ö×WFF–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒÖ&´f–ÆVF‡6W'f–6W2÷–ÖVçB×6W'f–6Ræ§2’(	B&W6öÇfV@¢ÒÖ&µ–F‡6W'f–6W2÷–ÖVçB×6W'f–6Ræ§2’(	B&W6öÇfV@¢Òòââã#FRÇW2Âfö—"dTEU$Uó3cæ§6öåğ ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â'W6–æW72×'VÆW2„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’Â7W7Fö×2„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFV6—6–öâ×6–væÇ2„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æ6–FVçBÖÖævVÖVçB„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆö6Â×7Fö6²„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÆ÷–ÇG’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖWFöæö×’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB’Âæ÷F–f–6F–öç2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂÆFf÷&ÒÖ÷2„DT4Ä$TEôäEôô%4U%dTB’ÂW&6†6–ær„DT4Ä$TEôäEôô%4U%dTB’Â&VgVæG2„DT4Ä$TEôäEôô%4U%dTB’Â6†&VBÖ6'B„DT4Ä$TEôäEôô%4U%dTB’ÂvÆÆWB„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢FÖ–âÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’Â7W7Fö×2„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æ6–FVçBÖÖævVÖVçB„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’Â–çfVçF÷'’„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÆ÷–ÇG’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ6öçG&öÂ×ÆæR„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB’Âæ÷F–f–6F–öç2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂÆFf÷&ÒÖ÷2„DT4Ä$TEôäEôô%4U%dTB’ÂW&6†6–ær„DT4Ä$TEôäEôô%4U%dTB’Â&V6öÖÖVæFF–öç2„DT4Ä$TEôäEôô%4U%dTB’Â&VgVæG2„DT4Ä$TEôäEôô%4U%dTB’Â6†&VBÖ6'B„DT4Ä$TEôäEôô%4U%dTB’ÂVç6öÆB×&W6öÇWF–öâ„DT4Ä$TEôäEôô%4U%dTB’ÂvÆÆWB„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùúEDTåD”ôâ(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢ƒ’ ¢ÒDT4Ä$TEôäõEôô%4U%dTF†Æ÷r’(	B6öçG&7Bæ6öç7VÖW2L:–6Æ&R&Ö&¶WBÖ6öçG&öÂ×ÆæR"(	BV7VæR&WWfRóR†æ’DT4Ä$TEôäEôô%4U%dTBÂæ’ô%4U%dTEõTäDT4Ä$TB ¢¢¤–×ÆVÖVçFF–öâ¢¢¢"f–6†–W"‡2’L:–6Æ,:’‡2’Â&÷WF—VS¢’f–6†–W"‡2¢Ò&÷WF—VR¢0¢Ò&÷WFW2¢¢Ò6W'f–6W2¢3 ¢ÒFW7G2¢cP¢ÒWF–Ç2¢ ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ&÷&FW'2%Õğ ¢22–ÖVçG0 ¢¢¤¶–æB¢¢¢'W6–æW72ÖfVGW&R+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢Væ6—76W"Vâ–VÖVçB†6'FRÂ•ÂÂÖö&–ÆRÖöæW’ÂW7V6W2R&WG&—B’WB6öæf—&ÖW"6öâWFBFRf6öâ–FV×÷FVçFRà ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò–çFVw&F–öâ7G&—RWB•Â†–çFVçBÂ6GW&RÂvV&†öö²ÂWfVæVÖVçG2¢ÒÖö&–ÆRÖöæW’×VÇF’×&÷f–FW""Ö&6Œ:’„÷&ævRÖöæW’4ÒÂÕDâÖôÖò4rÂ¶'F’´ÒfW'2ÕföÆô†öÆò¢Ò,:–6öæ6–Æ–F–öâ:—&–öF—VRFW2–VÖVçG2Öö&–ÆRÖöæW’VæF–ær6’6ÆÆ&6²W&GP¢Ò–VÖVçB66‚R&WG&—BWB&VÆæ6W266€¢Ò6öçG,;FÆR'F|:’FRF÷WFR6öæf—&ÖF–öâ66‚ÂfV2÷F–öâ'FVæ—&RFRF÷V&ÆR&ö&F–öâ"7FWW'2F—7F–æ7G0¢Ò6öæf—&ÖF–öâFR–VÖVçBWB–FV×÷FVæ6RvV&†öö²ö6ÆÆ&6°¢Òö÷WEò ¢Ò7&VF–öâFRÆ6öÖÖæFRVÆÆRÖÖVÖR†fVGW&R÷&FW'2¢Ò÷&6†W7G&F–öâGR6†V6¶÷WB&÷WF—VR‡&ö¦V7F–öâg&öçFVæBFR÷&FW'2¢Ò&VÖ&÷W'6VÖVçB†fVGW&R&VgVæG2ÂV’6öç6öÖÖR–ÖVçG2VâÆV7GW&R¢Ò7&VF—BvÆÆWB†fVGW&RvÆÆWBÖÆ÷–ÇG’ ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	BF÷WB6†ævVÖVçBFR&÷f–FW"Â6ÆÆ&6²ÂvV&†öö²÷RÆöv—VRB–FV×÷FVæ6R–VÖVçBFö—BWG&RfÆ–FR"ÆR&÷&œ:—F—&R–ÖVçG2à ¢¢¤–çf&–çG2¢¢ ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢ÒV7Vâ6V7&WBFR–VÖVçBVâGW"Fç2ÆR6öFP¢Ò¶ö&¦V7Bö&¦V7EĞ¢ÒVâ&÷f–FW"7F—l:’VâD"Ö—2æöâ6öæf–wW,:’'VçF–ÖR&W7FR–æF—7öæ–&ÆR†f–ÂÖ6Æ÷6VBÂV7VâfÆÆ&6²6–ÆVæ6–WW‚¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ¢Ò¶ö&¦V7Bö&¦V7EĞ ¢¢¤÷vç2¢¢¢66…ö6öÆÆV7F–öç6Â66…ö6öæf—&ÖF–öåö6öçG&öÇ6Â66…ö7W7FöG•öÆ÷76W6Â66…ö7W7FöG•÷&V6V—G6Â66…öFW÷6—EöÆÆö6F–öç6Â66…öFW÷6—G6ÂÖ&¶WEö66…öFW7F–æF–öç6ÂÖ&¶WE÷–ÖVçEö66÷VçG6ÂÖ&¶WE÷–ÖVçE÷&÷f–FW'6ÂÖö&–ÆUöÖöæW•÷G&ç67F–öç6Â—ÅöWfVçG5÷&ö6W76VFÂ7G&—UöWfVçG5÷&ö6W76VF  ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â#R…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â'W6–æW72×'VÆW2„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’Â–æ6–FVçBÖÖævVÖVçB„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÆ÷–ÇG’„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WB„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB’Âæ÷F–f–6F–öç2„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’ÂÆFf÷&ÒÖ÷2„DT4Ä$TEôäEôô%4U%dTB’ÂW&6†6–ær„DT4Ä$TEôäEôô%4U%dTB’Â&VgVæG2„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢FÖ–âÖF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂF6†&ö&B„DT4Ä$TEôäEôô%4U%dTB’ÂFV6—6–öâ×6–væÇ2„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖ6öçG&öÂ×ÆæR„DT4Ä$TEôäEôô%4U%dTB’ÂÖ&¶WBÖFVÆVvF–öâ„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â&VgVæG2„DT4Ä$TEôäEôô%4U%dTB ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢ƒ"f–6†–W"‡2’L:–6Æ,:’‡2’Â&÷WF—VS¢bf–6†–W"‡2¢Ò&÷WF—VR¢@¢ÒÖ–w&F–öç2¢ ¢Ò&÷WFW2¢p¢Ò67&—G2¢¢Ò6W'f–6W2¢#0¢ÒFW7G2¢3p ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ'–ÖVçG2%Õğ ¢22ÆFf÷&Ğ ¢¢¤¶–æB¢¢¢g&öçFVæB×G&ç7fW'6Â+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢–æg&7G'V7GW&RG&ç7fW'6ÆRF6†&ö&G2†WF‚ÖwV&BÂ6W'f–6Rv÷&¶W"Â6ö×÷6çG26öÆ—2'FvW2Â"f–WvW"’à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò§2ò¢Â7ræ§2(	BWF–Æ—F—&W2'FvW2†÷'2FÖ–âğ¢Òö÷WEò ¢ÒgVW2FÖ–â†6öç6öÖÖVçB6W2WF–Æ—F—&W2 ¢¢¤WF†÷&—G’¢¢¢F6†&ö&G2(	BF÷WB6†ævVÖVçBFRW&–ÖWG&RFR6RFöÖ–æRFö—BWG&R&VfÆWFR–6’à ¢¢¤–çf&–çG2¢¢ ¢ÒF÷WBf–6†–W"§2ò¢÷R7ræ§2†÷'2FÖ–âòFö—BWG&RFV6Æ&R–6 ¢¢¤÷vç2¢¢¢öV7VæUğ ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢öV7VæUğ¢¢¤6öç7VÖVB'’¢¢¢öV7VæUğ ¢¢¥&ö¦V7F–öç2¢¢¢öV7VæUğ ¢¢¥FV6†æ–6Â6öçFW‡B¢¢¢&–Ö—F—fRFWVæFVæ6–W2ÂFW7BÖöæÇ’Â6ö×÷6—F–öâ×&ö÷@ ¢¢¤&÷VæF'’†VÇF‚¢¢¢	ùú"„TÅD…’(	B7&÷72ÖfVGW&R–×÷'G3¢Â'VçF–ÖR7–6ÆW3¢ÂVæ6Æ76–f–VC¢ÂFV6Æ&VBÖæ÷BÖö'6W'fVC¢ ¢¢¤v÷fW&ææ6R†VÇF‚¢¢¢	ùú"„TÅD…’(	B÷'†âf–ÆW3¢ÂVç&W6öÇfVB–çFW&æÂ—3¢ÂFV6Æ&VBÖöæÇ’FW3¢ÂÖ&–wV÷W2÷væW'6†—¢ÂöçFöÆöw’v3¢ ¢¢¤vFR†VÇF‚¢¢¢	ùú"„TÅD…’(	BvFW3¢öV7VåòÂf–Ã¢Âv&ã¢  ¢¢¤&6†—FV7GW&ÂFV'B¢¢¢öV7VæUğ ¢¢¤–×ÆVÖVçFF–öâ¢¢¢Bf–6†–W"‡2’L:–6Æ,:’‡2¢Ò§2¢@ ¥ôL:—F–Ç26ö×ÆWG2†f–6†–W'2ÂF&ÆW2Â–çFW&f6W2’¢fö—"Fö72ôdTEU$Uó3cæ§6öâ(i"fVGW&W5¶–CÒ'ÆFf÷&Ò%Õğ ¢22ÆFf÷&ÒÖ÷0 ¢¢¤¶–æB¢¢¢FV6†æ–6Â×G&ç7fW'6Â+r¢¥7FGW2¢¢¢&öGV7F–öà ¢¢¥6W'f–6R¢¢¢W‡÷6W"Æ6çFRÆ–6F—fRÂÆ6öæf–wW&F–öâWBÆW2ÖöGVÆW27F–g2(	B–æg&7G'V7GW&RBvW‡Æö—FF–öâÂ2FR6W'f–6RÖWF–W"à ¢¢¥W&–ÖWFW"¢¢ ¢Òö–åò ¢Ò†VÇF‚6†V6²Â6öæf–wW&F–öâW‡÷6VRÂÆ—7FRFRÖöGVÆW27F–g2Â’Bv÷W&F–öç2–çFW&æP¢Òö÷WEò ¢ÒF÷WFRÆöv—VRÖWF–W"(	BÆFf÷&ÒÖ÷2âv2FR&VvÆRÖWF–W"&÷&P ¢¢¤WF†÷&—G’¢¢¢&6¶VæBÖ6÷&R(	B–æg&7G'V7GW&R'FvVRÂ6†ævVÖVçBfÆ–FR"ÂvWV—RÆFVf÷&ÖP ¢¢¤–çf&–çG2¢¢ ¢ÒÆW27W&f6W2FR6çL:’WBÖöæ—F÷&–ærâ|:–7&—fVçBV7VæRFöæì:–RÜ:—F–W ¢ÒÆR6–×VÆF÷":–7&—BFç2ÆW2F&ÆW2BvWG&W2fVGW&W2"FW6–vâFR6–×VÆF–öà¢ÒÆW2ÖöGVÆW2†f'&–72Âv&ÖVçEöÖöFVÇ2’6öçBÆW26WVÆW2F&ÆW2÷7<:–L:–W2"ÆFf÷&ÒÖ÷0 ¢¢¤÷vç2¢¢¢f'&–76Âv&ÖVçEöÖöFVÇ6 ¢¢¥w&—FW2†æ÷B÷væW"’¢¢¢æ÷F–f–6F–öåöÆöv‡w&—FW"Öæ÷BÖ÷væW"’Â&6VÅö—FV×6‡w&—FW"Öæ÷BÖ÷væW"’Â&6VÇ6‡w&—FW"Öæ÷BÖ÷væW"’Â66ç6‡w&—FW"Öæ÷BÖ÷væW" ¢¢¤W‡÷6W2¢¢¢–çFW&æÂ’‡2’Â32…EE–çFW&f6R‡2 ¢¢¤6öç7VÖW2¢¢¢WF‚„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’Â'W6–æW72×'VÆW2„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂFö7VÖVçG2„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æ6–FVçBÖÖævVÖVçB„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’ÂÆöv—7F–72„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’ÂW&6†6–ær„DT4Ä$TEôäEôô%4U%dTB’ÂvÆÆWB„DT4Ä$TEôäEôô%4U%dTB¢¢¤6öç7VÖVB'’¢¢¢WF‚Ö–FVçF—G’„DT4Ä$TEôäEôô%4U%dTB’ÂWF‚×76¶W’„DT4Ä$TEôäEôô%4U%dTB’Â6FÆör„DT4Ä$TEôäEôô%4U%dTB’ÂV6öæöÖ–2ÖVæv–æR„DT4Ä$TEôäEôô%4U%dTB’Â–æg&7G'V7GW&R„DT4Ä$TEôäEôô%4U%dTB’Âæ÷F–f–6F–öç2„DT4Ä$TEôäEôô%4U%dTB’Â÷&FW'2„DT4Ä$TEôäEôô%4U%dTB’Â–ÖVçG2„DT4Ä$TEôäEôô%4U%dTB’Â&÷f–FW'2×6W'f–6W2„DT4Ä$TEôäEôô%4U%dTB’Â&V6öÖÖVæFF–öç2„DT4Ä$TEôäEôô%4U%dTB’Â6†&VBÖ6'B„DT4Ä$TEôäEôô%4U%dTB’ÂvÆÆWB„DT4Ä$TEôäEôô%6Ú±î¸Â¸­yêë¢°k¢G§¦*^m«ëŒ+Š×®º+º$zzb¥âFRÂG&W76RV&Æ–72GR&VÆ—2²V7Vâ6V6öæBÖW76vRâW7B:–Ö—0 ¢¢¤÷vç2¢¢¢ÆW'G6Â6Æ–VçEöæ÷F–f–6F–öç6Âæ÷F–f–6F–öåöÆöv  ¢¢¤W‡÷6W2¢¢¢’–çFW&æÂ’‡2’Âb…EE–çFW&f6R‡2¢Ò'V–ÆE&VÆ”ÖW&Âòf÷&ÖE&VÆ•ö–çBòVæE&VÆ”Æö6F–öæ‡6W'f–6W2öæ÷F–f–6F–öç2÷&VÆ’ÖÆö6F–öâæ§2’(	B&W6öÇfV@¢Ò7&VFTÆW'F‡WF–Ç2öÆW'G2æ§2’(	B&W6öÇfV@¢ÒVÖ—D÷&FW$Ö–ÆW7FöæRòVÖ—DW†6WF–öæÂò&W6öÇfT÷&FW$Ö–ÆW7FöæW6‡6W'f–6W2ö6Æ–VçBÖæ÷F–f–6F–öâ×6W'f–6Ræ§2’(	B&W6öÇfV@¢Òæ÷F–g”Æ÷–ÇG”V&æVF‡6W'f–6W2öæ÷F–f–6F–öç2öÆ÷–ÇG’æ§2’(	B&W6öÇfV@¢Òæ÷F–g”÷&FW"¦‡6W'f–6W2öæ÷F–f–6F–öç2ö÷&FW"æ§2’(	B&W6öÇfV@¢Òæ÷F–g•&6VÂ¦‡6W'f–6W2öæ÷F–f–6F–öç2÷&6VÂæ§2’(	B&W6öÇfV@¢Òæ÷F–g•FW‡F‡6W'f–6W2öæ÷F–f