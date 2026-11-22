# Business Feature Graph â€” Komerce (Lot O3)

> GÃ©nÃ©rÃ© par `scripts/business-graph-gen.js`. Ne pas Ã©diter Ã  la main.
> Source d'autoritÃ© : FEATURE_DOCTRINE > APP_FEATURE_REGISTRY > features/*.feature.js > ce document.
> VÃ©rifiÃ© par `node scripts/business-graph-gen.js --check` (`npm run business-graph:check`).

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

## Big Map â€” couverture cross-scope (Lot O4)

SynthÃ¨se de couverture par scope et identitÃ©s mÃ©tier cross-scope. Voir mission O4 Â§13.

> **Note de terminologie (Lot O4-2, point 9)** â€” "cross-repo" dans les livrables O4 prÃ©cÃ©dents dÃ©signait en rÃ©alitÃ© un franchissement de **scope** (frontiÃ¨re de gouvernance : manifests/registre/autoritÃ© propres Ã  backend, dash, boutique), pas nÃ©cessairement un franchissement d'**arbre** sÃ©parÃ©. Le tableau ci-dessous constate la relation rÃ©elle par scope, dÃ©rivÃ©e uniquement des chemins configurÃ©s (dÃ©terministe, indÃ©pendante de la prÃ©sence de `.git`). Tant qu'une ligne n'affiche pas `external-path-scope`, "cross-repo" doit se lire "cross-scope" â€” un franchissement de frontiÃ¨re de gouvernance Ã  l'intÃ©rieur du mÃªme arbre.

### Topologie des scopes (relation de chemin constatÃ©e)

| Scope | Chemin montÃ© | Relation constatÃ©e | Sous ROOT ? |
|---|---|---|---|
| backend | `.` | `self` | â€” |
| dash | `public` | `same-tree-scope` | oui |
| boutique | `public/boutique` | `same-tree-scope` | oui |

_"cross-repo" ailleurs dans ce document = cross-scope (frontiÃ¨re de gouvernance), sauf si relation="external-path-scope" ci-dessus pour le scope concernÃ©._

### Par dÃ©pÃ´t

| DÃ©pÃ´t | Manifests dÃ©couverts | Manifests connectÃ©s | NÅ“uds techniques | Owned | Orphelins |
|---|---|---|---|---|---|
| backend | 36 | 36 | 720 | 720 | 0 |
| dash | 3 | 3 | N/A | N/A | N/A |
| boutique | 16 | 16 | 106 | 106 | 0 |

_dash_ : pas de Technical Architecture Graph propre au dÃ©pÃ´t dash dans ce pipeline â€” non scannÃ© par arch:gen backend, couverture non mesurable ici (SCOPE, pas un gap)

### IdentitÃ©s canoniques

- **Cross-repo features** (11) : `auth-identity`, `auth-passkey`, `catalog`, `notifications`, `orders`, `payments`, `platform-ops`, `providers-services`, `recommendations`, `shared-cart`, `wallet`
- **Single-repo features** (29) : `admin-dashboard`, `auth`, `business-rules`, `customs`, `dashboard`, `decision-signals`, `documents`, `economic-engine`, `external-provider-contracts`, `incident-management`, `infrastructure`, `inventory`, `legacy-control-tower`, `local-stock`, `logistics`, `loyalty`, `market`, `market-autonomy`, `market-control-plane`, `market-delegation`, `market-operator-dashboard`, `platform`, `purchasing`, `refunds`, `settlement`, `sourcing`, `supplier-connectivity`, `unsold-resolution`, `wallet-loyalty`
- **Unmapped local manifests** (0) : â€”

### Ontology gaps

- **tracking-no-canonical-owner** (manifest boutique `tracking`)
  - constat : boutique/features/tracking.feature.js dÃ©crit un service d'analytics/tracking Ã©vÃ©nementiel UI (suivi parcours, Ã©vÃ©nements). Aucune feature backend ou dash canonique ne reprÃ©sente ce service : vÃ©rifiÃ© explicitement contre logistics (tracking colis physique â€” identitÃ© mÃ©tier diffÃ©rente malgrÃ© le nom proche), infrastructure (middlewares/bootstrap transverses), notifications (Ã©mission de messages sortants, pas de collecte d'Ã©vÃ©nements) et platform-ops (santÃ© applicative). C'est un cas E pur (mission O4 Â§3) : vÃ©ritable ONTOLOGY GAP, pas une erreur de nommage Ã  corriger par une fusion.
  - dÃ©cision actuelle : canonicalFeature reste null. sliceKind fixÃ© Ã  'frontend-transversal' Ã  titre PROVISOIRE â€” seule valeur du enum ALLOWED_SLICE_KINDS permettant d'Ã©viter que ce manifeste retombe en BOUTIQUE-MANIFEST-UNGOVERNED, sans pour autant inventer une business feature. Ce n'est pas un vrai transversal multi-feature comme le manifeste `boutique` gÃ©nÃ©rique ou `platform` cÃ´tÃ© dash â€” c'est un classement de repli documentÃ©.
  - question ouverte : Faut-il crÃ©er une feature 'analytics' dÃ©diÃ©e cÃ´tÃ© backend/dash (si un service de collecte Ã©quivalent existe ou est prÃ©vu cÃ´tÃ© serveur), ou rattacher ce manifeste Ã  une feature existante par proximitÃ© fonctionnelle (ex. platform-ops) ? DÃ©cision produit non tranchÃ©e par O4.

## Feature â†’ implÃ©mentation

### admin-dashboard _(projection)_

> Tableau de bord admin SPA multi-vues.

- js: 38
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 11 â€” catalog, customs, dashboard, decision-signals, documents, economic-engine, inventory, logistics, orders, payments, sourcing
- consumers: 0

### auth _(technical-transversal)_

> Fournir les gardes transverses d'authentification et de vÃ©rification d'identitÃ© (middlewares JWT/session/rÃ´les) consommÃ©es par toutes les autres features.

- middleware: 7
- utils: 4
- tests: 16
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 6
- dependencies (consumes): 3 â€” auth-identity, infrastructure, notifications
- consumers: 27 â€” auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, documents, economic-engine, infrastructure, inventory, logistics, loyalty, market-control-plane, market-delegation, market-operator-dashboard, notifications, orders, payments, platform-ops, providers-services, purchasing, settlement, shared-cart, sourcing, unsold-resolution, wallet, decision-signals

### auth-identity _(business-feature)_

> Authentifier un utilisateur et gÃ©rer son identitÃ© active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposÃ©es.

- scripts: 1
- services: 7
- routes: 4
- boutique: 3
- utils: 2
- migrations: 4
- tests: 15
- tables owned (lifecycle): 5 â€” `revoked_tokens`, `users`, `otp_codes`, `credential_action_tokens`, `user_pickup_authorizations`
- tables written: 5
- interfaces exposed: 28
- internal APIs: 13
- dependencies (consumes): 11 â€” orders, loyalty, logistics, catalog, platform-ops, infrastructure, auth, auth-passkey, notifications, wallet, documents
- consumers: 20 â€” auth, auth-passkey, business-rules, catalog, dashboard, documents, economic-engine, infrastructure, logistics, loyalty, market-autonomy, market-delegation, notifications, orders, payments, platform-ops, providers-services, settlement, shared-cart, wallet

### auth-passkey _(business-feature)_

> GÃ©rer le cycle de vie Passkey Komerce : enrÃ´lement, login nominal, mÃ©tadonnÃ©es sÃ»res et rÃ©vocation explicite des authentificateurs du compte (AUTH-2â†’7).

- services: 3
- routes: 1
- migrations: 2
- tests: 8
- tables owned (lifecycle): 2 â€” `webauthn_credentials`, `webauthn_challenges`
- tables written: 2
- interfaces exposed: 8
- internal APIs: 0
- dependencies (consumes): 4 â€” auth, auth-identity, infrastructure, platform-ops
- consumers: 1 â€” auth-identity

### business-rules _(business-transversal)_

> Detenir le referentiel des regles metier parametrables, versionner chaque changement, et servir a toute feature la valeur en vigueur avec un repli garanti sur la valeur codee en dur.

- utils: 1
- routes: 1
- tests: 3
- tables owned (lifecycle): 2 â€” `business_rules`, `business_rules_history`
- tables written: 2
- interfaces exposed: 5
- internal APIs: 4
- dependencies (consumes): 3 â€” auth-identity, auth, infrastructure
- consumers: 8 â€” catalog, dashboard, economic-engine, logistics, orders, payments, platform-ops, decision-signals

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
- tables owned (lifecycle): 26 â€” `products`, `boutique_categories`, `boutique_subcategories`, `catalog_taxonomy_audit`, `catalog_field_overrides`, `catalog_terminology_reference`, `catalog_enrichment_runs`, `catalog_media`, `catalog_media_recovery_audit`, `product_skus`, `product_sku_media`, `product_variants`, `product_content_profile`, `product_content_sections`, `product_market_exposure`, `product_attributes`, `supplier_catalog_imports`, `supplier_catalog_sync_checkpoints`, `supplier_oauth_connections`, `catalog_field_sync_state`, `catalog_media_visual_fr_reviews`, `catalog_publication_decision_audit`, `catalog_product_sale_holds`, `catalog_product_quality_notes`, `catalog_stock_sync_state`, `supplier_catalog_import_rejections`
- tables written: 27
- interfaces exposed: 47
- internal APIs: 10
- dependencies (consumes): 18 â€” external-provider-contracts, sourcing, notifications, auth-identity, platform-ops, infrastructure, business-rules, economic-engine, customs, market-autonomy, market, sourcing, supplier-connectivity, purchasing, logistics, shared-cart, auth, orders
- consumers: 22 â€” auth-identity, customs, dashboard, documents, economic-engine, infrastructure, inventory, local-stock, logistics, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, orders, platform-ops, purchasing, recommendations, recommendations, shared-cart, sourcing, unsold-resolution, admin-dashboard

### customs _(business-feature)_

> Classer et declarer un colis douanierement ; la declaration est le pivot, jamais une optimisation.

- services: 5
- routes: 3
- migrations: 8
- dash: 2
- tests: 17
- tables owned (lifecycle): 5 â€” `customs_categories`, `customs_shipment_parcels`, `customs_shipments`, `customs_shipment_fees`, `customs_shipment_parcel_events`
- tables written: 6
- interfaces exposed: 20
- internal APIs: 0
- dependencies (consumes): 8 â€” catalog, orders, logistics, infrastructure, documents, auth, economic-engine, market
- consumers: 9 â€” catalog, dashboard, documents, economic-engine, infrastructure, logistics, orders, sourcing, admin-dashboard

### dashboard _(business-transversal)_

> Exposer les agrÃ©gats de pilotage et porter un portail interne Canonical unifiÃ© accessible depuis /admin, dont la navigation et les workspaces sont adaptÃ©s au rÃ´le, aux scopes marchÃ© et aux capabilities rÃ©solus cÃ´tÃ© serveur, sans rÃ©utiliser les deux gÃ©nÃ©rations historiques de dashboards.

- middleware: 1
- services: 47
- routes: 29
- migrations: 3
- dash: 195
- tests: 213
- tables owned (lifecycle): 3 â€” `customs_shipment_holds`, `order_incidents`, `partners`
- tables written: 21
- interfaces exposed: 89
- internal APIs: 0
- dependencies (consumes): 27 â€” shared-cart, incident-management, orders, infrastructure, payments, refunds, logistics, inventory, local-stock, economic-engine, wallet, auth, auth-identity, market-delegation, customs, documents, notifications, purchasing, supplier-connectivity, external-provider-contracts, business-rules, decision-signals, market, market-delegation, sourcing, catalog, market-autonomy
- consumers: 9 â€” economic-engine, infrastructure, market-control-plane, market-delegation, market-operator-dashboard, orders, sourcing, admin-dashboard, decision-signals

### decision-signals _(piloting-capability)_

> Detecter et qualifier des signaux operationnels et economiques a partir des donnees canoniques, puis porter leur cycle de vie global ou Market ID sans muter la verite metier source.

- middleware: 1
- services: 9
- routes: 2
- migrations: 2
- tests: 15
- tables owned (lifecycle): 1 â€” `signals`
- tables written: 1
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 9 â€” auth, infrastructure, logistics, purchasing, business-rules, market-delegation, payments, economic-engine, dashboard
- consumers: 5 â€” dashboard, incident-management, market-control-plane, orders, admin-dashboard

### documents _(business-transversal)_

> Generer et conserver un PDF officiel privÃ© (facture, remboursement, wallet, retrait, douane) aprÃ¨s Ã©vÃ©nement confirmÃ© ; exposer au client authentifiÃ© uniquement ses factures et remboursements essentiels.

- services: 9
- routes: 3
- migrations: 7
- utils: 5
- tests: 18
- tables owned (lifecycle): 2 â€” `invoices`, `transaction_documents`
- tables written: 2
- interfaces exposed: 9
- internal APIs: 0
- dependencies (consumes): 9 â€” logistics, catalog, auth, infrastructure, orders, customs, wallet, refunds, auth-identity
- consumers: 11 â€” auth-identity, customs, dashboard, logistics, orders, payments, platform-ops, purchasing, refunds, wallet, admin-dashboard

### economic-engine _(business-feature)_

> Calculer les frontiÃ¨res Ã©conomiques, la contribution et la couverture ; le marchÃ© borne le possible et le responsable autorisÃ© dÃ©cide le prix.

- utils: 3
- middleware: 1
- services: 56
- routes: 13
- migrations: 34
- dash: 6
- tests: 106
- tables owned (lifecycle): 31 â€” `order_item_real_cost_allocations`, `exchange_rates`, `charges`, `competitor_prices`, `cost_benchmarks`, `cost_component_events`, `cost_component_market_override_events`, `cost_component_market_overrides`, `cost_components`, `economic_risk_cost_events`, `economic_risk_watermark_events`, `economic_snapshots`, `economic_structure_cost_events`, `finance_config`, `international_n1_reconciliations`, `financial_movements`, `financial_movement_documents`, `market_price_observations`, `market_price_observation_events`, `price_history`, `pricing_category_dims`, `pricing_category_taxes`, `pricing_components`, `pricing_matrices_audit`, `pricing_market_decision_policy_events`, `pricing_maturity_disposition_events`, `pricing_strategies`, `pricing_strategy_history`, `risk_provisions`, `market_cost_attributions`, `order_cost_entry_events`
- tables written: 32
- interfaces exposed: 110
- internal APIs: 2
- dependencies (consumes): 16 â€” local-stock, refunds, platform-ops, customs, business-rules, auth-identity, market, market-autonomy, market-delegation, infrastructure, logistics, catalog, auth, dashboard, orders, loyalty
- consumers: 15 â€” catalog, customs, dashboard, infrastructure, loyalty, market-autonomy, market-control-plane, market-delegation, orders, platform-ops, purchasing, refunds, sourcing, admin-dashboard, decision-signals

### external-provider-contracts _(technical-transversal)_

> Qualifier, prouver et publier ce qum«ëŒ+Š×ž®º+º$zzb¥æR¶öÖW&6RWWB,:–VÆÆVÖVçB7&ö—&RBVâ7—7L:†ÖRW‡FW&æRfçBRVæRfVGW&RÜ:—F–W"æR2V–R7W"6öâ6öçG&Bà ¢Ò6W'f–6W3¢¢Ò67&—G3¢`¢Òv÷&¶fÆ÷w3¢p¢Ò6öæf–s¢ ¢ÒFW7G3¢€¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢ ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢(	B–æg&7G'V7GW&P¢Ò6öç7VÖW'3¢B(	B6FÆörÂF6†&ö&BÂW&6†6–ærÂ7WÆ–W"Ö6öææV7F—f—G ¢222–æ6–FVçBÖÖævVÖVçBò†'W6–æW72×G&ç7fW'6Â•ð £âL:—FV7FW"ÂVÆ–f–W"WB,:—6÷VG&RÆW2:–6'G2VçG&RÂ|:—FBGFVæGRWBÂ|:—FB,:–VÂBwVæR÷:—&F–öâÂfV2–×7B6Æ–VçBG&:v&ÆRà ¢Ò6W'f–6W3¢P¢ÒFW7G3¢€¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢(	B–æ6–FVçG6 ¢ÒF&ÆW2w&—GFVã¢¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢p¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢B(	B÷&FW'2Â–æg&7G'V7GW&RÂÆöv—7F–72ÂFV6—6–öâ×6–væÇ0¢Ò6öç7VÖW'3¢r(	BF6†&ö&BÂÆöv—7F–72Âæ÷F–f–6F–öç2Â÷&FW'2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2ÂW&6†6–æp ¢222–æg&7G'V7GW&Rò‡FV6†æ–6ÂÖf÷VæFF–öâ•ð £â–æg&7G'V7GW&RG&ç7fW'6ÆR6öç6öÖÜ:–R"F÷WFW2ÆW2fVGW&W2¢Ö–FFÆWv&RæöâÖWF‚†W'&÷"Ö†æFÆW"Â&FRÖÆ–Ö—BÂ&WVW7BÖ–BÂWÆöBÂfÆ–FFR’ÂWF–Æ—F—&W2'F|:—2†ÆövvW"Â†öæRÂ&FW2Â&VfW&Væ6RÂ'VÆW2’Â&'&VÂFRfÆ–FF–öâ¦ö’ÂWB&ö÷G7G&Æ–6F–b„W‡&W72Â&÷WFW2Â7&öç2ÂVçbÂ<:–7W&—L:’ÂÖ–w&F–öç27F'GW’à ¢Ò6W'f–6W3¢0¢ÒÖ–FFÆWv&S¢p¢ÒWF–Ç3¢P¢ÒfÆ–FF÷'3¢¢Ò&ö÷G7G&¢¢ÒÖ–w&F–öç3¢¢Ò67&—G3¢@¢ÒFö73¢c¢Ò6“¢#`¢Ò76WG3¢30¢ÒF#¢`¢Ò&÷WFW3¢¢Ò6öæf–s¢ ¢ÒFW7G3¢p¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢2(	B66†VÖöÖ–w&F–öç6Â÷WF&÷…öWfVçG6Â‡—6–6Åö÷WF6öÖU÷&V6V—G6 ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢@¢Ò–çFW&æÂ—3¢¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢r(	BÖ&¶WBÂWF‚ÂWF‚Ö–FVçF—G’Â6FÆörÂ7W7Fö×2ÂF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÂ–çfVçF÷'’ÂÆöv—7F–72ÂÖ&¶WBÖFVÆVvF–öâÂæ÷F–f–6F–öç2ÂÆFf÷&ÒÖ÷2Â÷&FW'2Â–ÖVçG2Â&V6öÖÖVæFF–öç2Â6†&VBÖ6'BÂvÆÆW@¢Ò6öç7VÖW'3¢3B(	BWF‚ÂWF‚Ö–FVçF—G’ÂWF‚×76¶W’Â'W6–æW72×'VÆW2Â6FÆörÂ7W7Fö×2ÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂW‡FW&æÂ×&÷f–FW"Ö6öçG&7G2Â–æ6–FVçBÖÖævVÖVçBÂ–çfVçF÷'’ÂÆö6Â×7Fö6²ÂÆöv—7F–72ÂÆ÷–ÇG’ÂÖ&¶WBÂÖ&¶WBÖWFöæö×’ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&BÂæ÷F–f–6F–öç2Â÷&FW'2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2Â&÷f–FW'2×6W'f–6W2ÂW&6†6–ærÂ&V6öÖÖVæFF–öç2Â&VgVæG2Â6WGFÆVÖVçBÂ6†&VBÖ6'BÂ6÷W&6–ærÂVç6öÆB×&W6öÇWF–öâÂvÆÆWBÂFV6—6–öâ×6–væÇ0 ¢222–çfVçF÷'’ò†'W6–æW72ÖfVGW&R•ð £â,:–6WF–öææW"ÂffV7FW"WBF—7F6†W"ÆW2'F–6ÆW2R‡V"à ¢Ò6W'f–6W3¢¢Ò&÷WFW3¢¢ÒF6ƒ¢¢ÒFW7G3¢0¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢(	B–çfVçF÷'•ö—FV×6 ¢ÒF&ÆW2w&—GFVã¢¢Ò–çFW&f6W2W‡÷6VC¢€¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢R(	B÷&FW'2Â6FÆörÂÆöv—7F–72Â–æg&7G'V7GW&RÂWF€¢Ò6öç7VÖW'3¢2(	BF6†&ö&BÂ–æg&7G'V7GW&RÂFÖ–âÖF6†&ö&@ ¢222ÆVv7’Ö6öçG&öÂ×F÷vW"ò†FW&V6FVB•ð £âæ6–Vâ6öçG&öÂF÷vW"(	BFW&V6FVBà ¢Ò§3¢3p¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢ ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢ ¢Ò6öç7VÖW'3¢  ¢222Æö6Â×7Fö6²ò†'W6–æW72ÖfVGW&R•ð £â÷'FW"ÆR7Fö6²‡—6—VRfVæF&ÆRÆö6ÂÂ6Æ7VÆW"ÆF—7öæ–&–Æ—L:’æWGFRFW2ÆÆö6F–öç27F—fW2Â&ö¦WFW"VæRF—7öæ–&–Æ—L:’V&Æ—VRÖ–æ–ÖÆRWBVævvW"ö6öç6öÖÖW"öÆ–,:—&W"6R7Fö6²Fç2ÆR7–6ÆR6öÖÖæFRà ¢Ò6W'f–6W3¢0¢Ò&÷WFW3¢¢ÒFW7G3¢P¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢"(	BÆö6Å÷7Fö6¶ÂÆö6Å÷7Fö6µöÆÆö6F–öç6 ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢`¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢B(	B6FÆörÂÖ&¶WBÂÆöv—7F–72Â–æg&7G'V7GW&P¢Ò6öç7VÖW'3¢r(	BF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72ÂÖ&¶WBÖFVÆVvF–öâÂ÷&FW'2Â&÷f–FW'2×6W'f–6W2Â&V6öÖÖVæFF–öç0 ¢222Æöv—7F–72ò†'W6–æW72ÖfVGW&R•ð £âf—&RG&ç6—FW"Vâ6öÆ—2GR66â–æ—F–ÂR&WG&—Bf–æÂÂfV2G&6¶–ær6Æ–VçBWBG&ç7÷'FWW"à ¢ÒÖ–FFÆWv&S¢¢ÒÖ–w&F–öç3¢P¢ÒFö73¢p¢ÒWF–Ç3¢0¢Ò6W'f–6W3¢C¢Ò&÷WFW3¢€¢Ò&÷WF—VS¢¢ÒF6ƒ¢ ¢ÒFW7G3¢“0¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢#b(	B&6VÇ6Â&VÆ—6Â&6VÅö—FV×6Â‡V%÷‡—6–6Å÷Væ—E÷Æ6VÖVçG6Â‡V%÷‡—6–6Å÷Væ—G6Â‡V%÷W&6†6UöÆÆö6F–öç6Â66åöWfVçG6Â66ç6Â–6·W÷&–çE÷Fö¶Vç6Â–6·W÷&WfVÅö6öFW6Â&VÆ•÷&öGV7E÷&WGW&å÷&V6V—G6Â6'&–W'6Â‡V%ö7W7FöG•öWfVçG6Â‡V%ö&÷…ö&w6Â–çFW&æF–öæÅ÷6†—ÖVçEö6†&vW6Â–çFW&æF–öæÅ÷6†—ÖVçEöWfVçG6Â–çFW&æF–öæÅ÷6†—ÖVçEö‡V%÷Væ—G6Â–çFW&æF–öæÅ÷6†—ÖVçE÷&VÆ•÷&V6V—G6Â–çFW&æF–öæÅ÷6†—ÖVçG6ÂÖ&¶WE÷G&ç7÷'E÷6ÆU÷&FW6Â&6VÅöWfVçG6Â–6·Wö6öÆÆV7Eöf–ÇW&W6Â–6·Wö6öFUövVæW&F–öç6Â–6·W÷fW&–g•öGFV×G6Â&öGV7E÷6·U÷‡—6–6Åö6öFW6Â6†—ÖVçG6 ¢ÒF&ÆW2w&—GFVã¢#€¢Ò–çFW&f6W2W‡÷6VC¢s€¢Ò–çFW&æÂ—3¢3 ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢r(	B7W7Fö×2ÂFö7VÖVçG2Â–æ6–FVçBÖÖævVÖVçBÂ–æg&7G'V7GW&RÂ'W6–æW72×'VÆW2Â÷&FW'2ÂÆö6Â×7Fö6²ÂWF‚ÂWF‚Ö–FVçF—G’Â6FÆörÂæ÷F–f–6F–öç2Â–ÖVçG2Â&VgVæG2ÂW&6†6–ærÂÆ÷–ÇG’ÂÖ&¶WBÂÖ&¶WBÖFVÆVvF–öà¢Ò6öç7VÖW'3¢#"(	BWF‚Ö–FVçF—G’Â6FÆörÂ7W7Fö×2ÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂ–æ6–FVçBÖÖævVÖVçBÂ–æg&7G'V7GW&RÂ–çfVçF÷'’ÂÆö6Â×7Fö6²ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&BÂæ÷F–f–6F–öç2Â÷&FW'2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2ÂW&6†6–ærÂ&V6öÖÖVæFF–öç2Â&VgVæG2ÂFÖ–âÖF6†&ö&BÂFV6—6–öâ×6–væÇ0 ¢222Æ÷–ÇG’ò†'W6–æW72ÖfVGW&R•ð £â6Æ7VÆW"WBÖ–çFVæ—"ÆR7FGWBFRf–FVÆ—FRBwVâ6Æ–VçB‡Æ–W"²6ö×FWW"w&÷2æ–W"’WB6W2&V6ö×Vç6W2à ¢Ò6W'f–6W3¢¢Ò&÷WFW3¢ ¢ÒFW7G3¢`¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢"(	BÆ÷–ÇG•÷F–W'6ÂÆ÷–ÇG•÷&Wv&G6 ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢b(	B÷&FW'2ÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂWF‚Âæ÷F–f–6F–öç2ÂWF‚Ö–FVçF—G¢Ò6öç7VÖW'3¢R(	BWF‚Ö–FVçF—G’ÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72Â÷&FW'2Â–ÖVçG0 ¢222Ö&¶WBò†'W6–æW72ÖfVGW&R•ð £â÷'FW"ÆR,:–l:—&VçF–VÂFW2Ö&6Œ:—2÷WfW'G2‡—2ÂFWf—6R’WBÂv†—7F÷&—VRBv6<:‡2FW2÷:—&FWW'2:VâÖ&6Œ:’(	B¦Ö—2ÆR6WGFÆVÖVçBæ’ÂvGG&–'WF–öâ:–6öæöÖ—VRÂV’&W7FVçBVæR&–Ö—F—fR<:—,:–RWBF–fl:—,:–Rà ¢Ò67&—G3¢0¢ÒÖ–w&F–öç3¢P¢Ò6W'f–6W3¢¢ÒFW7G3¢3 ¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢R(	BÖ&¶WG6Â÷W&F÷%öÖ&¶WE÷66÷W6Â7W'&Væ7•÷&—F–W6Âg…÷&FUöö'6W'fF–öç6Âg…÷V&Æ–5÷&VfW&Væ6U÷V÷FW6 ¢ÒF&ÆW2w&—GFVã¢P¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢"(	B–æg&7G'V7GW&RÂæ÷F–f–6F–öç0¢Ò6öç7VÖW'3¢‚(	B6FÆörÂ7W7Fö×2ÂF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂÆö6Â×7Fö6²ÂÆöv—7F–72ÂÖ&¶WBÖWFöæö×’ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&BÂ÷&FW'2Â–ÖVçG2Â&÷f–FW'2×6W'f–6W2Â&V6öÖÖVæFF–öç2Â&VgVæG2Â6WGFÆVÖVçBÂvÆÆW@ ¢222Ö&¶WBÖWFöæö×’ò†'W6–æW72ÖfVGW&R•ð £âW&ÖWGG&R:Vâ&W7öç6&ÆR—2W‡Æ–6—FVÖVçB66÷:’ÖævW"FRL:–6–FW"Vâ&—‚Æö6ÂÂN(	–Vâfö—"Î(	––×7B:–6öæöÖ—VRÂV—2FRÎ(	–7F—fW"6ç2&ö&F–öâ6VçG&ÆRÆ÷'7VRÆW2vFW2WF÷&—6VçBÆ÷6—F–öâ²Äô4Åô5D•dRFWf–VçBÆ÷'2Æ6WVÆRl:—&—L:’Æö6ÆR6öç6öÖÖ&ÆR"ÆR'W–W"F‚à ¢Ò6W'f–6W3¢@¢ÒÖ–w&F–öç3¢0¢ÒF6ƒ¢#P¢ÒFW7G3¢¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢"(	B&öGV7EöÖ&¶WE÷&–6UöG&gG6Â&öGV7EöÖ&¶WE÷&–6UöG&gEöWfVçG6 ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢b(	BÖ&¶WBÂV6öæöÖ–2ÖVæv–æRÂ6FÆörÂ–æg&7G'V7GW&RÂÖ&¶WBÖFVÆVvF–öâÂWF‚Ö–FVçF—G¢Ò6öç7VÖW'3¢‚(	B6FÆörÂF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&BÂ÷&FW'2Â&V6öÖÖVæFF–öç2Â6†&VBÖ6'@ ¢222Ö&¶WBÖ6öçG&öÂ×ÆæRò†'W6–æW72ÖfVGW&R•ð £âÖöçG&W":Î(	–FÖ–æ—7G&F–öâ6VçG&ÆRÂ÷W"6†VRÖ&6Œ:’ÂÎ(	œ:—FB,:–VÂFR6Ö—6RVâW‡Æö—FF–öâWBÆÆ—7FRW‡Æ–6—FRFW2:–6'G2Â6ç2&–Vâ:–7&—&Ræ’L:–6–FW"N(	–WF÷&—6F–öâà ¢Ò67&—G3¢ ¢Ò6W'f–6W3¢@¢Ò&÷WFW3¢¢ÒFW7G3¢ ¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢(	BÖ&¶WEöFVÆ—fW'•öGFW7FF–öç6 ¢ÒF&ÆW2w&—GFVã¢¢Ò–çFW&f6W2W‡÷6VC¢p¢Ò–çFW&æÂ—3¢¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢2(	B÷&FW'2ÂÖ&¶WBÂÖ&¶WBÖFVÆVvF–öâÂ&÷f–FW'2×6W'f–6W2Â–ÖVçG2ÂÆöv—7F–72ÂF6†&ö&BÂ6FÆörÂFV6—6–öâ×6–væÇ2ÂV6öæöÖ–2ÖVæv–æRÂ6÷W&6–ærÂWF‚Â–æg&7G'V7GW&P¢Ò6öç7VÖW'3¢(	B÷&FW'0 ¢222Ö&¶WBÖFVÆVvF–öâò†'W6–æW72ÖfVGW&R•ð £âL:–Ì:–wVW"FRf:vöâW‡Æ–6—FRÂVF—F&ÆRWB,:—fö6&ÆRÎ(	–WF÷&—L:’N(	–W‡Æö—FF–öâN(	—VâÖ&¶WB”B:Vâ÷:—&FWW"&–æ6—ÂWB:6öâ:—V—RÂF÷WBVâ,:—6W'fçBÆW2g&öçFœ:‡&W2u$õUFR¶öÖW&6Rà ¢ÒÖ–w&F–öç3¢#0¢Ò6öæf–s¢¢ÒÖ–FFÆWv&S¢@¢Ò6W'f–6W3¢¢Ò&÷WFW3¢P¢ÒFW7G3¢S ¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢(	BÖ&¶WEö÷W&F–æuö76–væÖVçG6Â76–væÖVçEöÖVÖ&W'6†—6ÂÖVÖ&W'6†—ö6&–Æ—F–W6Â76–væÖVçEö6&–Æ—G•ö6V–Æ–ævÂÖ&¶WEö66…ö6öçG&öÅ÷öÆ–6–W6Â6&–Æ—G•÷&Vv—7G'–Â6V–Æ–æu÷FV×ÆFW6Â6V–Æ–æu÷FV×ÆFUö6&–Æ—F–W6ÂÖ&¶WEöFVÆVvF–öåöVF—FÂÖ&¶WE÷FVÕö–çf—FF–öç6 ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢30¢Ò–çFW&æÂ—3¢3P¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢B(	BÆö6Â×7Fö6²ÂÖ&¶WBÂWF‚ÂWF‚Ö–FVçF—G’Â–æg&7G'V7GW&RÂÆöv—7F–72Â6FÆörÂ&÷f–FW'2×6W'f–6W2Â÷&FW'2Â6WGFÆVÖVçBÂV6öæöÖ–2ÖVæv–æRÂÖ&¶WBÖWFöæö×’ÂF6†&ö&BÂ–ÖVçG0¢Ò6öç7VÖW'3¢2(	BF6†&ö&BÂF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂÆöv—7F–72ÂÖ&¶WBÖWFöæö×’ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&BÂ÷&FW'2Â–ÖVçG2Â6WGFÆVÖVçBÂVç6öÆB×&W6öÇWF–öâÂFV6—6–öâ×6–væÇ0 ¢222Ö&¶WBÖ÷W&F÷"ÖF6†&ö&Bò‡Væ6Æ76–f–VB•ð £âW&ÖWGG&R:Vâ÷:—&FWW"—2†Ö&¶WEö÷W&F÷"’FR6R6öææV7FW"RF6†&ö&B6æöæ–6ÂÂFRL:–6–FW"WBW‡Æö—FW"6öâÖ&6Œ:’¢µ—2Â6öÖÖæFW2Â6FÆöwVR—2Â&–6–ærÆö6ÂÂ,:—6VR‡V"õ&VÆ—2ÂF÷VæRÂW‡:–F—F–öç2WBf–ææ6R—2(	B6ç2¦Ö—2fö—"ÆW2Föæì:–W2BwVâWG&RÖ&6Œ:’æ’&V6Wfö—"WFöÖF—VVÖVçBÆW2vW7FW2‡—6—VW2÷RWF÷&—L:—2vÆö&ÆW2FW2,;FÆW27:–6–Æ—<:—2à ¢Ò67&—G3¢ ¢ÒFW7G3¢0¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢ ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢’(	BÖ&¶WBÂWF‚ÂF6†&ö&BÂ6FÆörÂÖ&¶WBÖWFöæö×’Â÷&FW'2ÂÆöv—7F–72ÂÖ&¶WBÖFVÆVvF–öâÂ–æg&7G'V7GW&P¢Ò6öç7VÖW'3¢  ¢222æ÷F–f–6F–öç2ò†'W6–æW72×G&ç7fW'6Â•ð £â&ö¦WFW"VæR–æf÷&ÖF–öâW76VçF–VÆÆRFç2ÂÆ–6F–öâfV27V—GFVÖVçB&÷&œ:—F—&R²6öç6W'fW"ÆW26æW‚6÷'FçG2†—7F÷&—VW2<:—,:—2WB&W7BÖVff÷'Bà ¢ÒFW7G3¢#0¢ÒÖ–w&F–öç3¢`¢ÒWF–Ç3¢ ¢Ò6W'f–6W3¢@¢Ò&÷WFW3¢@¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢2(	B6Æ–VçEöæ÷F–f–6F–öç6ÂÆW'G6Âæ÷F–f–6F–öåöÆöv ¢ÒF&ÆW2w&—GFVã¢0¢Ò–çFW&f6W2W‡÷6VC¢`¢Ò–çFW&æÂ—3¢¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢r(	B÷&FW'2ÂÆöv—7F–72ÂWF‚Ö–FVçF—G’Â–æ6–FVçBÖÖævVÖVçBÂÆFf÷&ÒÖ÷2Â–æg&7G'V7GW&RÂWF€¢Ò6öç7VÖW'3¢2(	BWF‚ÂWF‚Ö–FVçF—G’Â6FÆörÂF6†&ö&BÂ–æg&7G'V7GW&RÂÆöv—7F–72ÂÆ÷–ÇG’ÂÖ&¶WBÂ÷&FW'2Â–ÖVçG2ÂW&6†6–ærÂ&VgVæG2Â6†&VBÖ6'@ ¢222÷&FW'2ò†'W6–æW72ÖfVGW&R•ð £âf—&RW†—7FW"VæR6öÖÖæFRÂFRÆ7&VF–öâR7FGWBf–æÂÂfV2Vâ6÷WBf–wW&RWBVæR&VfW&Væ6RÆ—6–&ÆRà ¢ÒWF–Ç3¢¢Ò6W'f–6W3¢3 ¢Ò&÷WFW3¢¢Ò&÷WF—VS¢0¢ÒFW7G3¢cP¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢(	B÷&FW%ö—FV×6Â÷&FW'6ÂF—7WFW6Â÷&FW%ö6öÖÖVçG6Â÷&FW%ö—FVÕö6÷7Eö–×WFF–öç6Â÷&FW%÷7FGW5ö†—7F÷'–Â&V6—–VçG6Â6×5öÆövÂ7W7Fö×5ö†—7F÷'–Â&VÆ•÷&WGW&åö6ö×Vç6F–öç6Â÷&FW%ö6†V6¶÷WEö–FV×÷FVæ7– ¢ÒF&ÆW2w&—GFVã¢0¢Ò–çFW&f6W2W‡÷6VC¢#p¢Ò–çFW&æÂ—3¢3 ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢#R(	BF6†&ö&BÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂÆFf÷&ÒÖ÷2Â–æg&7G'V7GW&RÂFV6—6–öâ×6–væÇ2Â–æ6–FVçBÖÖævVÖVçBÂ'W6–æW72×'VÆW2ÂvÆÆWBÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72Â6FÆörÂÖ&¶WBÖWFöæö×’ÂÆö6Â×7Fö6²ÂÖ&¶WBÂW&6†6–ærÂÆ÷–ÇG’Â–ÖVçG2ÂWF‚ÂWF‚Ö–FVçF—G’Â7W7Fö×2ÂFö7VÖVçG2Âæ÷F–f–6F–öç2Â&VgVæG2Â6†&VBÖ6'@¢Ò6öç7VÖW'3¢#B(	BWF‚Ö–FVçF—G’Â6FÆörÂ7W7Fö×2ÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂ–æ6–FVçBÖÖævVÖVçBÂ–æg&7G'V7GW&RÂ–çfVçF÷'’ÂÆöv—7F–72ÂÆ÷–ÇG’ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ÷W&F÷"ÖF6†&ö&BÂæ÷F–f–6F–öç2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2ÂW&6†6–ærÂ&V6öÖÖVæFF–öç2Â&VgVæG2Â6†&VBÖ6'BÂVç6öÆB×&W6öÇWF–öâÂvÆÆWBÂFÖ–âÖF6†&ö&@ ¢222–ÖVçG2ò†'W6–æW72ÖfVGW&R•ð £âVæ6—76W"Vâ–VÖVçB†6'FRÂ•ÂÂÖö&–ÆRÖöæW’ÂW7V6W2R&WG&—B’WB6öæf—&ÖW"6öâWFBFRf6öâ–FV×÷FVçFRà ¢Ò67&—G3¢¢Ò6W'f–6W3¢#0¢Ò&÷WFW3¢p¢ÒÖ–w&F–öç3¢ ¢Ò&÷WF—VS¢@¢ÒFW7G3¢3p¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢"(	BÖ&¶WE÷–ÖVçE÷&÷f–FW'6Â66…ö6öÆÆV7F–öç6Â66…öFW÷6—EöÆÆö6F–öç6Â66…öFW÷6—G6ÂÖ&¶WEö66…öFW7F–æF–öç6Â66…ö6öæf—&ÖF–öåö6öçG&öÇ6ÂÖö&–ÆUöÖöæW•÷G&ç67F–öç6Â—ÅöWfVçG5÷&ö6W76VFÂ7G&—UöWfVçG5÷&ö6W76VFÂ66…ö7W7FöG•öÆ÷76W6Â66…ö7W7FöG•÷&V6V—G6ÂÖ&¶WE÷–ÖVçEö66÷VçG6 ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢#P¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢R(	BWF‚Ö–FVçF—G’Â–æ6–FVçBÖÖævVÖVçBÂ–æg&7G'V7GW&RÂÆFf÷&ÒÖ÷2ÂWF‚Â&VgVæG2ÂFö7VÖVçG2Âæ÷F–f–6F–öç2Â'W6–æW72×'VÆW2Â÷&FW'2ÂÖ&¶WBÂÆöv—7F–72ÂÆ÷–ÇG’ÂW&6†6–ærÂÖ&¶WBÖFVÆVvF–öà¢Ò6öç7VÖW'3¢’(	BF6†&ö&BÂ–æg&7G'V7GW&RÂÆöv—7F–72ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂ÷&FW'2Â&VgVæG2ÂFÖ–âÖF6†&ö&BÂFV6—6–öâ×6–væÇ0 ¢222ÆFf÷&Òò†g&öçFVæB×G&ç7fW'6Â•ð £â–æg&7G'V7GW&RG&ç7fW'6ÆRF6†&ö&G2†WF‚ÖwV&BÂ6W'f–6Rv÷&¶W"Â6ö×÷6çG26öÆ—2'FvW2Â"f–WvW"’à ¢Ò§3¢@¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢ ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢ ¢Ò6öç7VÖW'3¢  ¢222ÆFf÷&ÒÖ÷2ò‡FV6†æ–6Â×G&ç7fW'6Â•ð £âW‡÷6W"Æ6çFRÆ–6F—fRÂÆ6öæf–wW&F–öâWBÆW2ÖöGVÆW27F–g2(	B–æg&7G'V7GW&RBvW‡Æö—FF–öâÂ2FR6W'f–6RÖWF–W"à ¢ÒÖ–FFÆWv&S¢ ¢Ò6ö×÷6—F–öå&ö÷G3¢0¢Ò6W'f–6W3¢`¢Ò&÷WFW3¢P¢Ò&÷WF—VS¢`¢ÒFW7G3¢#0¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢"(	Bf'&–76Âv&ÖVçEöÖöFVÇ6 ¢ÒF&ÆW2w&—GFVã¢`¢Ò–çFW&f6W2W‡÷6VC¢30¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢"(	BFö7VÖVçG2Â–æ6–FVçBÖÖævVÖVçBÂW&6†6–ærÂ6FÆörÂWF‚Ö–FVçF—G’Â–æg&7G'V7GW&RÂ'W6–æW72×'VÆW2ÂWF‚ÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72Â÷&FW'2ÂvÆÆW@¢Ò6öç7VÖW'3¢"(	BWF‚Ö–FVçF—G’ÂWF‚×76¶W’Â6FÆörÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂæ÷F–f–6F–öç2Â÷&FW'2Â–ÖVçG2Â&÷f–FW'2×6W'f–6W2Â&V6öÖÖVæFF–öç2Â6†&VBÖ6'BÂvÆÆW@ ¢222&÷f–FW'2×6W'f–6W2ò†'W6–æW72ÖfVGW&R•ð £â÷'FW"Î(	––FVçF—L:’N(	—Vâ&÷f–FW"F–W'2Â6W26W'f–6W2WBöfg&W2‡—6—VW2ÂÆWW"W‡÷6&–Æ—L:’ÂÆWW"æöÒV&Æ–2Ö–æ–ÖÂÂÆWW'2Ü:–F–2V&Æ–72÷F–öææVÇ2WBÆR7–6ÆR6öçFW‡GVÆ—<:’FRFVÖæFR÷&VÂâÆ6–&ÆR6W'f–6Uö–B„õ"‡—6–6ÅööffW%ö–B÷'FRF÷V¦÷W'2ÆR&÷÷26öæçR²ÆR6Æ–VçB6†ö—6—B&WVW7B÷R6ÆÆ&6²â÷W"Vâ6W'f–6RW‡Æ–6—FVÖVçB6ö×F–&ÆRv†G4ÂÆR6W'fWW"WWB&VÖWGG&RVâ†æFöfbFR6öçfW'6F–öâ,:‡27,:–F–öâFRÂ–çV—'’Â6ç2V&Æ–W"ÆRçVÜ:—&òFç2ÆRL:—F–ÂâV7Vâ–VÖVçBÂ6WGFÆVÖVçBÂ6ÆVæG&–W"7G'V7GW,:’÷R÷&FW"¶öÖW&6Rî(	–W7B7,:œ:’"6WGFR–çFW&7F–öâà ¢Ò6W'f–6W3¢@¢Ò&÷WFW3¢¢Ò&÷WF—VS¢ ¢Ò6“¢¢Ò67&—G3¢ ¢ÒÖ–w&F–öç3¢0¢ÒFW7G3¢p¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢B(	B&÷f–FW'6Â6W'f–6W6Â‡—6–6ÅööffW'6Â–çV—&–W6 ¢ÒF&ÆW2w&—GFVã¢@¢Ò–çFW&f6W2W‡÷6VC¢0¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢r(	BWF‚ÂWF‚Ö–FVçF—G’ÂÆFf÷&ÒÖ÷2ÂÖ&¶WBÂÆö6Â×7Fö6²Â&V6öÖÖVæFF–öç2Â–æg&7G'V7GW&P¢Ò6öç7VÖW'3¢2(	BÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂ&V6öÖÖVæFF–öç0 ¢222W&6†6–ærò†'W6–æW72ÖfVGW&R•ð £âG&ç6f÷&ÖW"Vâ&W6ö–âBv&÷f—6–öææVÖVçBÚ±î¸Â¸­yêë¢°k¢G§¦*^m«ëŒ+Š×ž®º+º$zzb¥æ—77RBwVæR6öÖÖæFRVâVævvVÖVçBf÷W&æ—76WW"G&:v&ÆR†&öâFR6öÖÖæFR’ÂV—26öç7FFW"6,:–6WF–öâà ¢Ò6W'f–6W3¢S0¢Ò&÷WFW3¢¢ÒÖ–w&F–öç3¢p¢Ò67&—G3¢@¢ÒFW7G3¢“ ¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢R(	B7WÆ–W'6ÂW&6†6UöÆ–æW6ÂW&6†6Uö÷&FW'6Â&öGV7E÷7WÆ–W'6ÂW&6†6Uö÷&FW%öWF†÷&—¦F–öç6Â‡V%öWF†÷&—¦F–öåöw&çG6Â7WÆ–W%öW†V7WF–öå÷–ÖVçG6Â7WÆ–W%÷–ÖVçE÷6WGFÆVÖVçG6ÂÖçVÅ÷W&6†6UöW†V7WF–öç6ÂW&6†6U÷f&–æ6UöFV6—6–öç6Â7WÆ–W%öW†V7WF–öåöWfVçG6Â7WÆ–W%öW†V7WF–öåögVÆf–ÆÆÖVçG6Â7WÆ–W%öW†V7WF–öåö÷&FW%öÆ–æW6Â7WÆ–W%öW†V7WF–öåö÷&FW'6Â7WÆ–W%öW†V7WF–öå÷–ÖVçE÷&öög6 ¢ÒF&ÆW2w&—GFVã¢P¢Ò–çFW&f6W2W‡÷6VC¢#¢Ò–çFW&æÂ—3¢@¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢"(	BFö7VÖVçG2Â7WÆ–W"Ö6öææV7F—f—G’ÂW‡FW&æÂ×&÷f–FW"Ö6öçG&7G2Â6÷W&6–ærÂ6FÆörÂ–æg&7G'V7GW&RÂ÷&FW'2ÂWF‚ÂV6öæöÖ–2ÖVæv–æRÂæ÷F–f–6F–öç2Â–æ6–FVçBÖÖævVÖVçBÂÆöv—7F–70¢Ò6öç7VÖW'3¢‚(	B6FÆörÂF6†&ö&BÂÆöv—7F–72Â÷&FW'2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2Â6÷W&6–ærÂFV6—6–öâ×6–væÇ0 ¢222&V6öÖÖVæFF–öç2ò†'W6–æW72ÖfVGW&R•ð £â6Æ76W"WB7Vv|:—&W"FW2&öGV—G2&÷WF—VR6VÆöâVâÖ÷FWW"FR&æ¶–ærL:–Fœ:’â6ö×÷6RW76’VâÜ:–Öö—&RVâ&–ÂF—66÷fW'’Æö6ÂÖ—‡FR„F—66÷fW'”6&B(	B&öGV7B¶öÖW&6RÂ&öGV—B‡—6—VRF–W'2Â6W'f–6RF–W'2’WB÷'FR6öÆ—F—VR:–F—F÷&–ÆRN(	–7F—fF–öâ6W'fWW"Â6ç2¦Ö—2÷7<:–FW"æ’6ÆöæW"ÆW2Föæì:–W26÷W&6W2à ¢Ò67&—G3¢¢Ò6W'f–6W3¢0¢Ò&÷WFW3¢¢ÒFW7G3¢P¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢ ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢(	B6FÆörÂ6FÆörÂÖ&¶WBÖWFöæö×’ÂÆFf÷&ÒÖ÷2Â–æg&7G'V7GW&RÂÆöv—7F–72Â÷&FW'2ÂÖ&¶WBÂÆö6Â×7Fö6²Â&÷f–FW'2×6W'f–6W0¢Ò6öç7VÖW'3¢2(	B–æg&7G'V7GW&RÂ&÷f–FW'2×6W'f–6W2Â6†&VBÖ6'@ ¢222&VgVæG2ò†'W6–æW72×G&ç7fW'6Â•ð £â&VÖ&÷W'6W"Vâ6Æ–VçBFRf6öâG&6&ÆRWB6ç2F÷V&ÆR&VÖ&÷W'6VÖVçBÂVVÂVR6ö—BÆRfÇW‚VÆçBà ¢ÒWF–Ç3¢0¢ÒÖ–w&F–öç3¢0¢Ò6W'f–6W3¢ ¢ÒFW7G3¢#P¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢r(	B&VgVæG6Â&VgVæEöW†V7WF–öåö–çFVçG6Â÷&FW%ö—FVÕ÷&VgVæE÷&W6W'fF–öç6ÂÆö6Åö—FVÕ÷&VgVæE÷&W6W'fF–öç6ÂÆö6Åö66…÷&VgVæEöWF†÷&—¦F–öç6ÂÆö6Åö66…÷&VgVæE÷–÷WG6ÂÆö6ÅöÖö&–ÆU÷&VgVæEö†æFöfg6 ¢ÒF&ÆW2w&—GFVã¢p¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢’(	BÖ&¶WBÂ–æg&7G'V7GW&RÂ÷&FW'2ÂÆöv—7F–72Â–ÖVçG2ÂvÆÆWBÂFö7VÖVçG2Âæ÷F–f–6F–öç2ÂV6öæöÖ–2ÖVæv–æP¢Ò6öç7VÖW'3¢b(	BF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72Â÷&FW'2Â–ÖVçG0 ¢2226WGFÆVÖVçBò†'W6–æW72ÖfVGW&R•ð £âG&6W"FR&÷WBVâ&÷WBÆR,:†vÆVÖVçBL;²:Vâ÷:—&FWW"—2¢$TE’GFW7L:’6VçG&ÆVÖVçBÂ$UTU5DTB"ÆR—2Â”B6VçG&ÆVÖVçBÂ$T4T•dTB"ÆR—2à ¢ÒÖ–w&F–öç3¢¢Ò6W'f–6W3¢¢Ò&÷WFW3¢¢ÒFW7G3¢@¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢"(	BÖ&¶WE÷6WGFÆVÖVçG6ÂÖ&¶WE÷6WGFÆVÖVçEöWfVçG6 ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢0¢Ò–çFW&æÂ—3¢P¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢R(	BÖ&¶WBÂÖ&¶WBÖFVÆVvF–öâÂWF‚ÂWF‚Ö–FVçF—G’Â–æg&7G'V7GW&P¢Ò6öç7VÖW'3¢(	BÖ&¶WBÖFVÆVvF–öà ¢2226†&VBÖ6'Bò†'W6–æW72ÖfVGW&R•ð £âW&ÖWGG&R:Vâ7,:–FWW"FRV&Æ–W"VæRÆ—7FR–Ö×V&ÆR"Æ–VâV&Æ–2²6†VR6†WFWW"<:–ÆV7F–öææRVæR÷RÇW6–WW'2Æ–væW2F—7öæ–&ÆW2Â76R"ÆR,:–6—GVÆF–bV—2ÆR6†V6¶÷WB6æöæ—VR6ç2Ü:–ÆævW"6öâæ–W"W'6öææVÂ²ÆÆ—7FR6RfW&ÖRWFöÖF—VVÖVçBÆ÷'7VR6FW&æœ:‡&RÆ–væRW7B,:–6ÆÜ:–Rà ¢Ò6W'f–6W3¢¢Ò&÷WFW3¢@¢ÒÖ–w&F–öç3¢# ¢ÒFW7G3¢€¢Ò&÷WF—VS¢ ¢ÒF6ƒ¢¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢r(	B&6¶WEö—FV×6Â&6¶WG6Â6'E÷6†&W6Â6†&VEö6'EöWfVçG6Â6†&VEö6'Eö—FV×6Â6†&VEö6'E÷6fVEö66W76Â6†&VEö6'G6 ¢ÒF&ÆW2w&—GFVã¢p¢Ò–çFW&f6W2W‡÷6VC¢`¢Ò–çFW&æÂ—3¢0¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢’(	B&V6öÖÖVæFF–öç2ÂÆFf÷&ÒÖ÷2Â–æg&7G'V7GW&RÂ÷&FW'2Â6FÆörÂÖ&¶WBÖWFöæö×’Âæ÷F–f–6F–öç2ÂWF‚ÂWF‚Ö–FVçF—G¢Ò6öç7VÖW'3¢B(	B6FÆörÂF6†&ö&BÂ–æg&7G'V7GW&RÂ÷&FW'0 ¢2226÷W&6–ærò†'W6–æW72ÖfVGW&R•ð £â–FVçF–f–W"ÂVÆ–f–W"WB&&—G&W"FW2÷÷'GVæ—L:—2f÷W&æ—76WW"÷R&öGV—B‡66â&–6–ærÂL:–6—6–öâv&FW"÷vF6†Æ—7B÷&V¦WFW"’fçBÆWW"VçG,:–RFç2ÆR6FÆöwVRà ¢ÒÖ–FFÆWv&S¢¢ÒÖ–w&F–öç3¢P¢Ò67&—G3¢€¢Ò6W'f–6W3¢3@¢Ò&÷WFW3¢ ¢ÒFW7G3¢Sp¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢‚(	B6÷W&6–æuö6æF–FFW6Â–×÷'E÷'VçF–ÖU÷'Vç6Â6÷W&6–æuö6æF–FFUöWfVçG6Â6÷W&6–æu÷6÷W&6W6Â6÷W&6–æu÷&÷f–FW%ö6öçG&öÅöWfVçG6Â6÷W&6–æu÷6÷W&6U÷&÷f–FW6Â6÷W&6–æuö6GW&W6Â6÷W&6–æuöö'6W'fF–öç6Â6÷W&6–æuöö'6W'fF–öåöWf–FVæ6VÂ6÷W&6–æuö6æöæ–6ÅöVçF—F–W6Â6÷W&6–æuö6æöæ–6ÅöVçF—G•÷&Vg6Â6÷W&6–æuöÖF6…÷&÷÷6Ç6Â6÷W&6–æu÷&W6öÇWF–öåöFV6—6–öç6Â6÷W&6–æu÷&W6öÇWF–öåö&–æF–æw6Â–×÷'E÷'VçF–ÖUö—FVÕöWfVçG6Â&÷f–FW%ö7&VFVçF–Ç6Â6÷W&6–æu÷6÷W&6U÷&WVW7G6Â7WÆ–W%ö6öÖÖW&6–Åö6FVv÷'•öÖ–æw6 ¢ÒF&ÆW2w&—GFVã¢€¢Ò–çFW&f6W2W‡÷6VC¢3 ¢Ò–çFW&æÂ—3¢#@¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢r(	B–æg&7G'V7GW&RÂ6FÆörÂW&6†6–ærÂV6öæöÖ–2ÖVæv–æRÂ7W7Fö×2ÂWF‚ÂF6†&ö&@¢Ò6öç7VÖW'3¢b(	B6FÆörÂ6FÆörÂF6†&ö&BÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂW&6†6–ærÂFÖ–âÖF6†&ö&@ ¢2227WÆ–W"Ö6öææV7F—f—G’ò†–çFVw&F–öâÖFFW"•ð £âW&ÖWGG&R:¶öÖW&6RB67VV–ÆÆ—"Vâf÷W&æ—76WW""VæRWF÷&—L:’Væ—VRB–FVçF—L:’&÷f–FW"ÂVæR7WÆ–W"÷&FW"–FVçF—G’÷VRWBVæR,:—6öÇWF–öâBFFW"f–ÂÖ6Æ÷6VBÂ6ç2L:—Æ6W"ÆW2L:–6—6–öç2Ü:—F–W"FW2fVGW&W26öç6öÖÖG&–6W2à ¢Ò6W'f–6W3¢@¢ÒFW7G3¢P¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢ ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢(	BW‡FW&æÂ×&÷f–FW"Ö6öçG&7G0¢Ò6öç7VÖW'3¢2(	B6FÆörÂF6†&ö&BÂW&6†6–æp ¢222Vç6öÆB×&W6öÇWF–öâò†'W6–æW72ÖfVGW&R•ð £âv&FW"ÆW26öÆ—2æöâ&WF—,:—26÷W2&W7öç6&–Æ—L:’GR&VÆ—2²ÆÆ—V–FF–öââvW7BWF÷&—<:–RRv,:‡26Ì;GGW&R‡—6—VRÂ§W&–F—VRWBf–ææ6œ:‡&R6W'F–fœ:–Rà ¢ÒÖ–w&F–öç3¢ ¢Ò&÷WFW3¢¢ÒF6ƒ¢0¢ÒFW7G3¢@¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢(	BVç6öÆEö—FV×6 ¢ÒF&ÆW2w&—GFVã¢¢Ò–çFW&f6W2W‡÷6VC¢p¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢R(	B÷&FW'2Â6FÆörÂWF‚ÂÖ&¶WBÖFVÆVvF–öâÂ–æg&7G'V7GW&P¢Ò6öç7VÖW'3¢  ¢222vÆÆWBò†'W6–æW72ÖfVGW&R•ð £âFVæ—"Vâ6öÆFR6Æ–VçBWB6öâ†—7F÷&—VRFR7&VF—BöFV&—BÂfV2Æ–6F–öâW†7FVÖVçBVæRfö—2à ¢Ò6W'f–6W3¢¢Ò&÷WFW3¢¢ÒÖ–w&F–öç3¢ ¢Ò&÷WF—VS¢ ¢ÒFW7G3¢`¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢B(	BvÆÆWE÷G&ç67F–öç6ÂvÆÆWG6ÂvÆÆWEö6öç7V×F–öç6ÂvÆÆWEö7&VF—EöÆ÷G6 ¢ÒF&ÆW2w&—GFVã¢@¢Ò–çFW&f6W2W‡÷6VC¢¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢r(	BÖ&¶WBÂ÷&FW'2ÂÆFf÷&ÒÖ÷2Â–æg&7G'V7GW&RÂWF‚ÂFö7VÖVçG2ÂWF‚Ö–FVçF—G¢Ò6öç7VÖW'3¢r(	BWF‚Ö–FVçF—G’ÂF6†&ö&BÂFö7VÖVçG2Â–æg&7G'V7GW&RÂ÷&FW'2ÂÆFf÷&ÒÖ÷2Â&VgVæG0 ¢222vÆÆWBÖÆ÷–ÇG’ò†FW&V6FVB•ð £âL8•,8”4œ8’(	B66–æL:’RÆ÷Bóã"ƒ##bÓrÓ"’VâfVGW&W2÷vÆÆWBæfVGW&Ræ§2WBfVGW&W2öÆ÷–ÇG’æfVGW&Ræ§2âæR&VæBÇW2V7Vâ6W'f–6R&÷&Rà ¢ÒF&ÆW2÷væVB†Æ–fV7–6ÆR“¢ ¢ÒF&ÆW2w&—GFVã¢ ¢Ò–çFW&f6W2W‡÷6VC¢ ¢Ò–çFW&æÂ—3¢ ¢ÒFWVæFVæ6–W2†6öç7VÖW2“¢ ¢Ò6öç7VÖW'3¢  ¢22F&ÆR÷væW'6†—  §ÂF&ÆRÂÆ–fV7–6ÆR÷væW"Â,:—6öÇWF–öâÂw&—FW'2Â&VFW'2À§ÂÒÒ×ÂÒÒ×ÂÒÒ×ÂÒÒ×ÂÒÒ×À§ÂÆW'G6Âæ÷F–f–6F–öç6ÂFV6Æ&VB×F&ÆRÖ÷væW"Âæ÷F–f–6F–öç2Â(	BÀ§Â76–væÖVçEö6&–Æ—G•ö6V–Æ–ævÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§Â76–væÖVçEöÖVÖ&W'6†—6ÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§Â&6¶WEö—FV×6Â6†&VBÖ6'FÂ×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂ6†&VBÖ6'BÂ(	BÀ§Â&6¶WG6Â6†&VBÖ6'FÂ×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂ6†&VBÖ6'BÂ(	BÀ§Â&÷WF—VUö6FVv÷&–W6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â&÷WF—VU÷7V&6FVv÷&–W6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â'W6–æW75÷'VÆW6Â'W6–æW72×'VÆW6Â6–ævÆR×w&—FW"Â'W6–æW72×'VÆW2ÂF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72À§Â'W6–æW75÷'VÆW5ö†—7F÷'–Â'W6–æW72×'VÆW6Â6–ævÆR×w&—FW"Â'W6–æW72×'VÆW2ÂF6†&ö&BÀ§Â6&–Æ—G•÷&Vv—7G'–ÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂ(	BÀ§Â6'&–W'6ÂÆöv—7F–76Â6–ævÆR×w&—FW"ÂÆöv—7F–72ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§Â6'E÷6†&W6Â6†&VBÖ6'FÂFV6Æ&VB×F&ÆRÖ÷væW"Â6†&VBÖ6'BÂ(	BÀ§Â66…ö6öÆÆV7F–öç6Â–ÖVçG6Â6–ævÆR×w&—FW"Â–ÖVçG2Â(	BÀ§Â66…ö6öæf—&ÖF–öåö6öçG&öÇ6Â–ÖVçG6Â6–ævÆR×w&—FW"Â–ÖVçG2Â(	BÀ§Â66…ö7W7FöG•öÆ÷76W6Â–ÖVçG6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â–ÖVçG2Â(	BÀ§Â66…ö7W7FöG•÷&V6V—G6Â–ÖVçG6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â–ÖVçG2Â(	BÀ§Â66…öFW÷6—EöÆÆö6F–öç6Â–ÖVçG6Â6–ævÆR×w&—FW"Â–ÖVçG2Â(	BÀ§Â66…öFW÷6—G6Â–ÖVçG6Â6–ævÆR×w&—FW"Â–ÖVçG2Â(	BÀ§Â6FÆöuöVç&–6†ÖVçE÷'Vç6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â6FÆöuöW†6ÇW6–öç6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂ6FÆörÀ§Â6FÆöuöf–VÆEö÷fW'&–FW6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â6FÆöuöf–VÆE÷7–æ5÷7FFVÂ6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ(	BÀ§Â6FÆöuövÆö&Åö66W75öw&çG6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§Â6FÆöuövÆ÷76'–ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂ6FÆörÀ§Â6FÆöuöÖVF–Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂF6†&ö&BÂ6÷W&6–ærÀ§Â6FÆöuöÖVF–÷&V6÷fW'•öVF—FÂ6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ(	BÀ§Â6FÆöuöÖVF–÷f—7VÅög%÷&Wf–Ww6Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ(	BÀ§Â6FÆöu÷&öGV7E÷VÆ—G•öæ÷FW6Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ(	BÀ§Â6FÆöu÷&öGV7E÷6ÆUö†öÆG6Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ(	BÀ§Â6FÆöu÷V&Æ–6F–öåöFV6—6–öåöVF—FÂ6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ(	BÀ§Â6FÆöu÷7Fö6µ÷7–æ5÷7FFVÂ6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ(	BÀ§Â6FÆöu÷F†öæö×•öVF—FÂ6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â6FÆöu÷FW&Ö–æöÆöw•÷&VfW&Væ6VÂ6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â6V–Æ–æu÷FV×ÆFUö6&–Æ—F–W6ÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂ(	BÀ§Â6V–Æ–æu÷FV×ÆFW6ÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂ(	BÀ§Â6†&vW6ÂV6öæöÖ–2ÖVæv–æVÂ×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂ(	BÀ§Â6Æ–VçEöæ÷F–f–6F–öç6Âæ÷F–f–6F–öç6Â6–ævÆR×w&—FW"Âæ÷F–f–6F–öç2ÂF6†&ö&BÀ§Â6ö×WF—F÷%÷&–6W6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â6÷7Eö&Væ6†Ö&·6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â6÷7Eö6ö×öæVçEöWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â6÷7Eö6ö×öæVçEöÖ&¶WEö÷fW'&–FUöWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â6÷7Eö6ö×öæVçEöÖ&¶WEö÷fW'&–FW6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â6÷7Eö6ö×öæVçG6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â7&VFVçF–Åö7F–öå÷Fö¶Vç6ÂWF‚Ö–FVçF—G–Â6–ævÆR×w&—FW"ÂWF‚Ö–FVçF—G’Â(	BÀ§Â7W'&Væ7•÷&—F–W6ÂÖ&¶WFÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÂÖ&¶WBÖWFöæö×’À§Â7W7Fö×5ö6FVv÷&–W6Â7W7Fö×6Â6–ævÆR×w&—FW"Â7W7Fö×2ÂV6öæöÖ–2ÖVæv–æRÀ§Â7W7Fö×5öVffV7F—fU÷&FW6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂ7W7Fö×2ÂF6†&ö&BÀ§Â7W7Fö×5ö†—7F÷'–Â÷&FW'6Â6–ævÆR×w&—FW"Â÷&FW'2Â(	BÀ§Â7W7Fö×5÷6†—ÖVçEöfVW6Â7W7Fö×6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â7W7Fö×2Â(	BÀ§Â7W7Fö×5÷6†—ÖVçEö†öÆG6ÂF6†&ö&FÂ6–ævÆR×w&—FW"ÂF6†&ö&BÂ(	BÀ§Â7W7Fö×5÷6†—ÖVçE÷&6VÅöWfVçG6Â7W7Fö×6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â7W7Fö×2Â(	BÀ§Â7W7Fö×5÷6†—ÖVçE÷&6VÇ6Â7W7Fö×6Â6–ævÆR×w&—FW"Â7W7Fö×2ÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÀ§Â7W7Fö×5÷6†—ÖVçG6Â7W7Fö×6Â6–ævÆR×w&—FW"Â7W7Fö×2ÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72À§ÂF6†&ö&EövÆö&Åö66W75öw&çG6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§ÂFV6—6–öå÷6–væÅövÆö&Åö66W75öw&çG6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§ÂF—7WFW6Â÷&FW'6Â6–ævÆR×w&—FW"Â÷&FW'2Â6FÆörÂÖ&¶WBÖFVÆVvF–öâÀ§ÂV6öæöÖ–5÷&—6µö6÷7EöWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§ÂV6öæöÖ–5÷&—6µ÷vFW&Ö&µöWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§ÂV6öæöÖ–5÷6æ6†÷G6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂ(	BÀ§ÂV6öæöÖ–5÷7G'V7GW&Uö6÷7EöWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂÖ&¶WBÖFVÆVvF–öâÀ§ÂV6öæöÖ–5÷f&–&ÆW6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂV6öæöÖ–2ÖVæv–æRÀ§ÂW†6†ævU÷&FW6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂF6†&ö&BÀ§Âf'&–76ÂÆFf÷&ÒÖ÷6Â6–ævÆR×w&—FW"ÂÆFf÷&ÒÖ÷2ÂV6öæöÖ–2ÖVæv–æRÀ§Âf–ææ6Uö6öæf–vÂV6öæöÖ–2ÖVæv–æVÂ×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂV6öæöÖ–2ÖVæv–æRÂ–æg&7G'V7GW&RÂÆ÷–ÇG’À§Âf–ææ6–ÅöÖ÷fVÖVçEöFö7VÖVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Âf–ææ6–ÅöÖ÷fVÖVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Âg…÷V&Æ–5÷&VfW&Væ6U÷V÷FW6ÂÖ&¶WFÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÂ(	BÀ§Âg…÷&FUöö'6W'fF–öç6ÂÖ&¶WFÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÂ(	BÀ§Âv&ÖVçEöÖöFVÇ6ÂÆFf÷&ÒÖ÷6Â6–ævÆR×w&—FW"ÂÆFf÷&ÒÖ÷2ÂV6öæöÖ–2ÖVæv–æRÀ§Â‡V%öWF†÷&—¦F–öåöw&çG6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂÆöv—7F–72À§Â‡V%ö&÷…ö&w6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â‡V%ö7W7FöG•öWfVçG6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â‡V%÷‡—6–6Å÷Væ—E÷Æ6VÖVçG6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72ÂF6†&ö&BÀ§Â‡V%÷‡—6–6Å÷Væ—G6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72ÂF6†&ö&BÀ§Â‡V%÷W&6†6UöÆÆö6F–öç6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72ÂF6†&ö&BÀ§Â–×÷'E÷'VçF–ÖUö—FVÕöWfVçG6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â–×÷'E÷'VçF–ÖU÷'Vç6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ6FÆörÂF6†&ö&BÀ§Â–æ6–FVçG6Â–æ6–FVçBÖÖævVÖVçFÂFV6Æ&VB×F&ÆRÖ÷væW"Â–æ6–FVçBÖÖævVÖVçBÂF6†&ö&BÂÆöv—7F–72Âæ÷F–f–6F–öç2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2À§Â–çV—&–W6Â&÷f–FW'2×6W'f–6W6Â6–ævÆR×w&—FW"Â&÷f–FW'2×6W'f–6W2Â(	BÀ§Â–çFW&æF–öæÅöã÷&V6öæ6–Æ–F–öç6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â–çFW&æF–öæÅ÷6†—ÖVçEö6†&vW6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â–çFW&æF–öæÅ÷6†—ÖVçEöWfVçG6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â–çFW&æF–öæÅ÷6†—ÖVçEö‡V%÷Væ—G6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â–çFW&æF–öæÅ÷6†—ÖVçE÷&VÆ•÷&V6V—G6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â&VgVæG2À§Â–çFW&æF–öæÅ÷6†—ÖVçG6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â–çfVçF÷'•ö—FV×6Â–çfVçF÷'–Â6–ævÆR×w&—FW"Â–çfVçF÷'’Â(	BÀ§Â–çfö–6W6ÂFö7VÖVçG6Â×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂFö7VÖVçG2ÂWF‚Ö–FVçF—G’ÂÆöv—7F–72ÂÆFf÷&ÒÖ÷2À§ÂÆö6Åö66…÷&VgVæEöWF†÷&—¦F–öç6Â&VgVæG6Â6–ævÆR×w&—FW"Â&VgVæG2ÆÚ±î¸Â¸­yêë¢°k¢G§¦*^ â€” |
| `local_cash_refund_payouts` | `refunds` | single-writer | refunds | â€” |
| `local_item_refund_reservations` | `refunds` | single-writer | refunds | â€” |
| `local_mobile_refund_handoffs` | `refunds` | single-writer | refunds | â€” |
| `local_stock` | `local-stock` | single-writer | local-stock | logistics |
| `local_stock_allocations` | `local-stock` | single-writer | local-stock | logistics |
| `loyalty_rewards` | `loyalty` | single-writer | loyalty | â€” |
| `loyalty_tiers` | `loyalty` | single-writer | loyalty | auth-identity |
| `manual_purchase_executions` | `purchasing` | declared-table-owner | purchasing | â€” |
| `market_cash_control_policies` | `market-delegation` | declared-table-owner | market-delegation | market-control-plane, payments |
| `market_cash_destinations` | `payments` | single-writer | payments | â€” |
| `market_cost_attributions` | `economic-engine` | declared-table-owner | economic-engine | â€” |
| `market_delegation_audit` | `market-delegation` | declared-table-owner | market-delegation | â€” |
| `market_delivery_attestations` | `market-control-plane` | single-writer | market-control-plane | â€” |
| `market_operating_assignments` | `market-delegation` | declared-table-owner | market-delegation | market-control-plane, payments, settlement |
| `market_payment_accounts` | `payments` | declared-table-owner | payments | â€” |
| `market_payment_providers` | `payments` | declared-table-owner | payments | market-control-plane |
| `market_price_observation_events` | `economic-engine` | declared-table-owner | economic-engine | â€” |
| `market_price_observations` | `economic-engine` | declared-table-owner | economic-engine | â€” |
| `market_settlement_events` | `settlement` | declared-table-owner | settlement | â€” |
| `market_settlements` | `settlement` | declared-table-owner | settlement | market-delegation |
| `market_team_invitations` | `market-delegation` | declared-table-owner | market-delegation | â€” |
| `market_transport_sale_rates` | `logistics` | declared-table-owner | logistics | â€” |
| `markets` | `market` | declared-table-owner | market | catalog, dashboard, local-stock, market-autonomy, market-control-plane, market-delegation, providers-services, recommendations, settlement |
| `membership_capabilities` | `market-delegation` | declared-table-owner | market-delegation | market-control-plane |
| `mobile_money_transactions` | `payments` | single-writer | payments | â€” |
| `notification_log` | `notifications` | declared-table-owner | notifications, platform-ops | â€” |
| `operator_market_scopes` | `market` | declared-table-owner | market | market-delegation |
| `order_checkout_idempotency` | `orders` | declared-table-owner | orders | â€” |
| `order_comments` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | â€” |
| `order_cost_entry_events` | `economic-engine` | declared-table-owner | economic-engine | â€” |
| `order_incidents` | `dashboard` | single-writer | dashboard | â€” |
| `order_item_cost_imputations` | `orders` | single-writer | orders | dashboard, economic-engine |
| `order_item_real_cost_allocations` | `economic-engine` | declared-table-owner | customs, economic-engine | dashboard |
| `order_item_refund_reservations` | `refunds` | single-writer | refunds | â€” |
| `order_items` | `orders` | declared-table-owner | dashboard, logistics, orders | auth-identity, catalog, customs, documents, economic-engine, inventory, payments, platform-ops, purchasing, recommendations, refunds, shared-cart |
| `order_status_history` | `orders` | multi-writer-resolved-by-classification-signal | dashboard, orders | â€” |
| `orders` | `orders` | declared-table-owner | dashboard, economic-engine, orders | auth-identity, catalog, customs, documents, incident-management, inventory, logistics, loyalty, market-control-plane, notifications, payments, platform-ops, purchasing, recommendations, refunds, shared-cart, unsold-resolution, wallet |
| `otp_codes` | `auth-identity` | single-writer | auth-identity | â€” |
| `outbox_events` | `infrastructure` | single-writer | infrastructure | â€” |
| `parcel_events` | `logistics` | decm«ëŒ+Š×ž®º+º$zzb¥æ¶WBÖFVÆVvF–öâÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ–ÖVçG2À§ÂÖ&¶WEö66…öFW7F–æF–öç6Â–ÖVçG6Â6–ævÆR×w&—FW"Â–ÖVçG2Â(	BÀ§ÂÖ&¶WEö6÷7EöGG&–'WF–öç6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§ÂÖ&¶WEöFVÆVvF–öåöVF—FÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂ(	BÀ§ÂÖ&¶WEöFVÆ—fW'•öGFW7FF–öç6ÂÖ&¶WBÖ6öçG&öÂ×ÆæVÂ6–ævÆR×w&—FW"ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ(	BÀ§ÂÖ&¶WEö÷W&F–æuö76–væÖVçG6ÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ–ÖVçG2Â6WGFÆVÖVçBÀ§ÂÖ&¶WE÷–ÖVçEö66÷VçG6Â–ÖVçG6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â–ÖVçG2Â(	BÀ§ÂÖ&¶WE÷–ÖVçE÷&÷f–FW'6Â–ÖVçG6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â–ÖVçG2ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§ÂÖ&¶WE÷&–6Uöö'6W'fF–öåöWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§ÂÖ&¶WE÷&–6Uöö'6W'fF–öç6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§ÂÖ&¶WE÷6WGFÆVÖVçEöWfVçG6Â6WGFÆVÖVçFÂFV6Æ&VB×F&ÆRÖ÷væW"Â6WGFÆVÖVçBÂ(	BÀ§ÂÖ&¶WE÷6WGFÆVÖVçG6Â6WGFÆVÖVçFÂFV6Æ&VB×F&ÆRÖ÷væW"Â6WGFÆVÖVçBÂÖ&¶WBÖFVÆVvF–öâÀ§ÂÖ&¶WE÷FVÕö–çf—FF–öç6ÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂ(	BÀ§ÂÖ&¶WE÷G&ç7÷'E÷6ÆU÷&FW6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§ÂÖ&¶WG6ÂÖ&¶WFÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÂ6FÆörÂF6†&ö&BÂÆö6Â×7Fö6²ÂÖ&¶WBÖWFöæö×’ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂ&÷f–FW'2×6W'f–6W2Â&V6öÖÖVæFF–öç2Â6WGFÆVÖVçBÀ§ÂÖVÖ&W'6†—ö6&–Æ—F–W6ÂÖ&¶WBÖFVÆVvF–öæÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖFVÆVvF–öâÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§ÂÖö&–ÆUöÖöæW•÷G&ç67F–öç6Â–ÖVçG6Â6–ævÆR×w&—FW"Â–ÖVçG2Â(	BÀ§Âæ÷F–f–6F–öåöÆövÂæ÷F–f–6F–öç6ÂFV6Æ&VB×F&ÆRÖ÷væW"Âæ÷F–f–6F–öç2ÂÆFf÷&ÒÖ÷2Â(	BÀ§Â÷W&F÷%öÖ&¶WE÷66÷W6ÂÖ&¶WFÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÂÖ&¶WBÖFVÆVvF–öâÀ§Â÷&FW%ö6†V6¶÷WEö–FV×÷FVæ7–Â÷&FW'6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â÷&FW'2Â(	BÀ§Â÷&FW%ö6öÖÖVçG6Â÷&FW'6Â×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂ÷&FW'2Â(	BÀ§Â÷&FW%ö6÷7EöVçG'•öWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â÷&FW%ö–æ6–FVçG6ÂF6†&ö&FÂ6–ævÆR×w&—FW"ÂF6†&ö&BÂ(	BÀ§Â÷&FW%ö—FVÕö6÷7Eö–×WFF–öç6Â÷&FW'6Â6–ævÆR×w&—FW"Â÷&FW'2ÂF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÀ§Â÷&FW%ö—FVÕ÷&VÅö6÷7EöÆÆö6F–öç6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"Â7W7Fö×2ÂV6öæöÖ–2ÖVæv–æRÂF6†&ö&BÀ§Â÷&FW%ö—FVÕ÷&VgVæE÷&W6W'fF–öç6Â&VgVæG6Â6–ævÆR×w&—FW"Â&VgVæG2Â(	BÀ§Â÷&FW%ö—FV×6Â÷&FW'6ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂF6†&ö&BÂÆöv—7F–72Â÷&FW'2ÂWF‚Ö–FVçF—G’Â6FÆörÂ7W7Fö×2ÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂ–çfVçF÷'’Â–ÖVçG2ÂÆFf÷&ÒÖ÷2ÂW&6†6–ærÂ&V6öÖÖVæFF–öç2Â&VgVæG2Â6†&VBÖ6'BÀ§Â÷&FW%÷7FGW5ö†—7F÷'–Â÷&FW'6Â×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂ÷&FW'2Â(	BÀ§Â÷&FW'6Â÷&FW'6ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂF6†&ö&BÂV6öæöÖ–2ÖVæv–æRÂ÷&FW'2ÂWF‚Ö–FVçF—G’Â6FÆörÂ7W7Fö×2ÂFö7VÖVçG2Â–æ6–FVçBÖÖævVÖVçBÂ–çfVçF÷'’ÂÆöv—7F–72ÂÆ÷–ÇG’ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂæ÷F–f–6F–öç2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2ÂW&6†6–ærÂ&V6öÖÖVæFF–öç2Â&VgVæG2Â6†&VBÖ6'BÂVç6öÆB×&W6öÇWF–öâÂvÆÆWBÀ§Â÷Gö6öFW6ÂWF‚Ö–FVçF—G–Â6–ævÆR×w&—FW"ÂWF‚Ö–FVçF—G’Â(	BÀ§Â÷WF&÷…öWfVçG6Â–æg&7G'V7GW&VÂ6–ævÆR×w&—FW"Â–æg&7G'V7GW&RÂ(	BÀ§Â&6VÅöWfVçG6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â&6VÅö—FV×6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂF6†&ö&BÂÆöv—7F–72ÂÆFf÷&ÒÖ÷2Â7W7Fö×2ÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂ–çfVçF÷'’Â÷&FW'2Â–ÖVçG2À§Â&6VÇ6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂF6†&ö&BÂÆöv—7F–72ÂÆFf÷&ÒÖ÷2ÂWF‚Ö–FVçF—G’Â7W7Fö×2ÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂ–æ6–FVçBÖÖævVÖVçBÂ–çfVçF÷'’Âæ÷F–f–6F–öç2Â÷&FW'2Â–ÖVçG2Â&V6öÖÖVæFF–öç2À§Â'FæW'6ÂF6†&ö&FÂ6–ævÆR×w&—FW"ÂF6†&ö&BÂ(	BÀ§Â—ÅöWfVçG5÷&ö6W76VFÂ–ÖVçG6Â6–ævÆR×w&—FW"Â–ÖVçG2Â(	BÀ§Â‡—6–6ÅööffW'6Â&÷f–FW'2×6W'f–6W6Â6–ævÆR×w&—FW"Â&÷f–FW'2×6W'f–6W2ÂÖ&¶WBÖFVÆVvF–öâÀ§Â‡—6–6Åö÷WF6öÖU÷&V6V—G6Â–æg&7G'V7GW&VÂ6–ævÆR×w&—FW"Â–æg&7G'V7GW&RÂ(	BÀ§Â–6·Wö6öFUövVæW&F–öç6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â–6·Wö6öÆÆV7Eöf–ÇW&W6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â–6·W÷&–çE÷Fö¶Vç6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"Â–æg&7G'V7GW&RÂÆöv—7F–72Â(	BÀ§Â–6·W÷&WfVÅö6öFW6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"Â–æg&7G'V7GW&RÂÆöv—7F–72Â(	BÀ§Â–6·W÷fW&–g•öGFV×G6ÂÆöv—7F–76Â6–ævÆR×w&—FW"ÂÆöv—7F–72Â(	BÀ§Â&–6Uö†—7F÷'–ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&–6–æuö&Væ6†Ö&·6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂV6öæöÖ–2ÖVæv–æRÀ§Â&–6–æuö6FVv÷'•öF–×6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&–6–æuö6FVv÷'•÷F†W6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&–6–æuö6ö×öæVçG6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&–6–æuövÆö&Åö66W75öw&çG6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂV6öæöÖ–2ÖVæv–æRÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§Â&–6–æuöÖ&¶WEöFV6—6–öå÷öÆ–7•öWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&–6–æuöÖG&–6W5öVF—FÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&–6–æuöÖGW&—G•öF—7÷6—F–öåöWfVçG6ÂV6öæöÖ–2ÖVæv–æVÂFV6Æ&VB×F&ÆRÖ÷væW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&–6–æu÷7G&FVv–W6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&–6–æu÷7G&FVw•ö†—7F÷'–ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â&öGV7EöGG&–'WFW6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â&öGV7Eö6öçFVçE÷&öf–ÆVÂ6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â&öGV7Eö6öçFVçE÷6V7F–öç6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â&öGV7EöÖ&¶WEöW‡÷7W&VÂ6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂF6†&ö&BÂÖ&¶WBÖFVÆVvF–öâÀ§Â&öGV7EöÖ&¶WE÷&–6UöG&gEöWfVçG6ÂÖ&¶WBÖWFöæö×–ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖWFöæö×’Â(	BÀ§Â&öGV7EöÖ&¶WE÷&–6UöG&gG6ÂÖ&¶WBÖWFöæö×–ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÖ&¶WBÖWFöæö×’Â6FÆörÂF6†&ö&BÂÖ&¶WBÖFVÆVvF–öâÀ§Â&öGV7E÷6·UöÖVF–Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ6÷W&6–ærÀ§Â&öGV7E÷6·U÷‡—6–6Åö6öFW6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â&öGV7E÷6·W6Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂÖ&¶WBÖWFöæö×’ÂW&6†6–ærÂ6÷W&6–ærÀ§Â&öGV7E÷7WÆ–W'6ÂW&6†6–ævÂ6–ævÆR×w&—FW"ÂW&6†6–ærÂÆöv—7F–72À§Â&öGV7E÷f&–çG6Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72ÂÖ&¶WBÖWFöæö×’Â÷&FW'2Â6÷W&6–ærÀ§Â&öGV7G6Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂF6†&ö&BÂÆöv—7F–72ÂWF‚Ö–FVçF—G’Â7W7Fö×2ÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂ–çfVçF÷'’ÂÆö6Â×7Fö6²ÂÖ&¶WBÖWFöæö×’ÂÖ&¶WBÖFVÆVvF–öâÂ÷&FW'2ÂÆFf÷&ÒÖ÷2ÂW&6†6–ærÂ&V6öÖÖVæFF–öç2Â6†&VBÖ6'BÂ6÷W&6–ærÂVç6öÆB×&W6öÇWF–öâÀ§Â&÷f–FW%ö7&VFVçF–Ç6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â&÷f–FW'6Â&÷f–FW'2×6W'f–6W6Â6–ævÆR×w&—FW"Â&÷f–FW'2×6W'f–6W2ÂÖ&¶WBÖFVÆVvF–öâÀ§ÂW&6†6UöÆ–æW6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂF6†&ö&BÀ§ÂW&6†6Uö÷&FW%öWF†÷&—¦F–öç6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂÆöv—7F–72À§ÂW&6†6Uö÷&FW'6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂF6†&ö&BÂÆöv—7F–72À§ÂW&6†6U÷f&–æ6UöFV6—6–öç6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂ(	BÀ§Â&V6—–VçG6Â÷&FW'6Â×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂ÷&FW'2ÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72Âæ÷F–f–6F–öç2À§Â&VgVæEöW†V7WF–öåö–çFVçG6Â&VgVæG6Â6–ævÆR×w&—FW"Â&VgVæG2Â(	BÀ§Â&VgVæG6Â&VgVæG6Â6–ævÆR×w&—FW"Â&VgVæG2ÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂ÷&FW'2À§Â&VÆ—6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂF6†&ö&BÂÆöv—7F–72ÂWF‚Ö–FVçF—G’ÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂÆö6Â×7Fö6²ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂÖ&¶WBÖFVÆVvF–öâÂæ÷F–f–6F–öç2Â÷&FW'2ÂÆFf÷&ÒÖ÷2ÂW&6†6–ærÀ§Â&VÆ•÷&öGV7E÷&WGW&å÷&V6V—G6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â(	BÀ§Â&VÆ•÷&WGW&åö6ö×Vç6F–öç6Â÷&FW'6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â÷&FW'2Â(	BÀ§Â&Wfö¶VE÷Fö¶Vç6ÂWF‚Ö–FVçF—G–ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂWF‚Ö–FVçF—G’Â–æg&7G'V7GW&RÂWF‚À§Â&—6µ÷&÷f—6–öç6ÂV6öæöÖ–2ÖVæv–æVÂ6–ævÆR×w&—FW"ÂV6öæöÖ–2ÖVæv–æRÂ(	BÀ§Â66åöWfVçG6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂF6†&ö&BÂÆöv—7F–72Â–æ6–FVçBÖÖævVÖVçBÂæ÷F–f–6F–öç2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2À§Â66ç6ÂÆöv—7F–76ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂÆöv—7F–72Â÷&FW'2ÂÆFf÷&ÒÖ÷2ÂF6†&ö&BÀ§Â66†VÖöÖ–w&F–öç6Â–æg&7G'V7GW&VÂ6–ævÆR×w&—FW"Â–æg&7G'V7GW&RÂ(	BÀ§Â6W'f–6W6Â&÷f–FW'2×6W'f–6W6Â6–ævÆR×w&—FW"Â&÷f–FW'2×6W'f–6W2ÂÖ&¶WBÖFVÆVvF–öâÀ§Â6†&VEö6'EöWfVçG6Â6†&VBÖ6'FÂ6–ævÆR×w&—FW"Â6†&VBÖ6'BÂ(	BÀ§Â6†&VEö6'Eö—FV×6Â6†&VBÖ6'FÂ6–ævÆR×w&—FW"Â6†&VBÖ6'BÂ(	BÀ§Â6†&VEö6'E÷6fVEö66W76Â6†&VBÖ6'FÂ6–ævÆR×w&—FW"Â6†&VBÖ6'BÂ(	BÀ§Â6†&VEö6'G6Â6†&VBÖ6'FÂ6–ævÆR×w&—FW"Â6†&VBÖ6'BÂ(	BÀ§Â6†—ÖVçG6ÂÆöv—7F–76Â6–ævÆR×w&—FW"ÂÆöv—7F–72Â(	BÀ§Â6–væÇ6ÂFV6—6–öâ×6–væÇ6ÂFV6Æ&VB×F&ÆRÖ÷væW"Â÷&FW'2ÂFV6—6–öâ×6–væÇ2ÂF6†&ö&BÀ§Â6×5öÆövÂ÷&FW'6Â×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂ÷&FW'2Â(	BÀ§Â6÷W&6–æuö6æF–FFUöWfVçG6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æuö6æF–FFW6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ6÷W&6–ærÂF6†&ö&BÀ§Â6÷W&6–æuö6æöæ–6ÅöVçF—F–W6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æuö6æöæ–6ÅöVçF—G•÷&Vg6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æuö6GW&W6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æuövÆö&Åö66W75öw&çG6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂÖ&¶WBÖ6öçG&öÂ×ÆæRÀ§Â6÷W&6–æuöÖF6…÷&÷÷6Ç6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æuöö'6W'fF–öåöWf–FVæ6VÂ6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æuöö'6W'fF–öç6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æu÷&÷f–FW%ö6öçG&öÅöWfVçG6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æu÷&W6öÇWF–öåö&–æF–æw6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æu÷&W6öÇWF–öåöFV6—6–öç6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æu÷6÷W&6U÷&÷f–FW6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æu÷6÷W&6U÷&WVW7G6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â6÷W&6–æu÷6÷W&6W6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â7F÷&Uö7&VF—G6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂV6öæöÖ–2ÖVæv–æRÀ§Â7G&—UöWfVçG5÷&ö6W76VFÂ–ÖVçG6Â6–ævÆR×w&—FW"Â–ÖVçG2Â(	BÀ§Â7WÆ–W%ö6FÆöuö–×÷'E÷&V¦V7F–öç6Â6FÆövÂFV6Æ&VB×F&ÆRÖ÷væW"Â6FÆörÂ(	BÀ§Â7WÆ–W%ö6FÆöuö–×÷'G6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ6÷W&6–ærÀ§Â7WÆ–W%ö6FÆöu÷7–æ5ö6†V6·ö–çG6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â7WÆ–W%ö6öÖÖW&6–Åö6FVv÷'•öÖ–æw6Â6÷W&6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"Â6÷W&6–ærÂ(	BÀ§Â7WÆ–W%öW†V7WF–öåöWfVçG6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂ(	BÀ§Â7WÆ–W%öW†V7WF–öåögVÆf–ÆÆÖVçG6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂ(	BÀ§Â7WÆ–W%öW†V7WF–öåö÷&FW%öÆ–æW6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂ(	BÀ§Â7WÆ–W%öW†V7WF–öåö÷&FW'6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂ(	BÀ§Â7WÆ–W%öW†V7WF–öå÷–ÖVçE÷&öög6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂ(	BÀ§Â7WÆ–W%öW†V7WF–öå÷–ÖVçG6ÂW&6†6–ævÂFV6Æ&VB×F&ÆRÖ÷væW"ÂW&6†6–ærÂ(	BÀ§Â7WÆ–W%ööWF…ö6öææV7F–öç6Â6FÆövÂ6–ævÆR×w&—FW"Â6FÆörÂ(	BÀ§Â7WÆ–W%÷–ÖVçE÷6WGFÆVÖVçG6ÂW&6†6–ævÂ6–ævÆR×w&—FW"ÂW&6†6–ærÂ(	BÀ§Â7WÆ–W'6ÂW&6†6–ævÂ6–ævÆR×w&—FW"ÂW&6†6–ærÂ6FÆörÂ6÷W&6–ærÀ§Â7WÆ–W'5÷7FG6ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂF6†&ö&BÀ§ÂG&ç67F–öåöFö7VÖVçG6ÂFö7VÖVçG6Â6–ævÆR×w&—FW"ÂFö7VÖVçG2ÂF6†&ö&BÀ§ÂVç6öÆEö—FV×6ÂVç6öÆB×&W6öÇWF–öæÂ6–ævÆR×w&—FW"ÂVç6öÆB×&W6öÇWF–öâÂ(	BÀ§ÂW6W%÷–6·WöWF†÷&—¦F–öç6ÂWF‚Ö–FVçF—G–Â6–ævÆR×w&—FW"ÂWF‚Ö–FVçF—G’Â(	BÀ§ÂW6W'6ÂWF‚Ö–FVçF—G–ÂFV6Æ&VB×F&ÆRÖ÷væW"ÂWF‚Ö–FVçF—G’Â–æg&7G'V7GW&RÂWF‚ÂWF‚×76¶W’Â'W6–æW72×'VÆW2ÂF6†&ö&BÂFö7VÖVçG2ÂV6öæöÖ–2ÖVæv–æRÂÆöv—7F–72ÂÆ÷–ÇG’ÂÖ&¶WBÖFVÆVvF–öâÂæ÷F–f–6F–öç2Â÷&FW'2Â–ÖVçG2ÂÆFf÷&ÒÖ÷2Â6WGFÆVÖVçBÂ6†&VBÖ6'BÂvÆÆWBÀ§ÂeöÆ÷–ÇG•÷7VÖÖ'–ÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂÆ÷–ÇG’À§Âe÷Vç6öÆE÷—VÆ–æVÂöÖ&–w\:µòÂæòÖFV6Æ&VB×w&—FW"Â(	BÂVç6öÆB×&W6öÇWF–öâÀ§ÂvÆÆWEö6öç7V×F–öç6ÂvÆÆWFÂ×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂvÆÆWBÂ(	BÀ§ÂvÆÆWEö7&VF—EöÆ÷G6ÂvÆÆWFÂ×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂvÆÆWBÂ(	BÀ§ÂvÆÆWE÷G&ç67F–öç6ÂvÆÆWFÂ×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂvÆÆWBÂFö7VÖVçG2À§ÂvÆÆWG6ÂvÆÆWFÂ×VÇF’×w&—FW"×&W6öÇfVBÖ'’Ö6Æ76–f–6F–öâ×6–væÂÂF6†&ö&BÂvÆÆWBÂFö7VÖVçG2Â&VgVæG2À§ÂvV&WF†åö6†ÆÆVævW6ÂWF‚×76¶W–Â6–ævÆR×w&—FW"ÂWF‚×76¶W’Â(	BÀ§ÂvV&WF†åö7&VFVçF–Ç6ÂWF‚×76¶W–Â6–ævÆR×w&—FW"ÂWF‚×76¶W’Â(	BÀ ¢22–çFW&f6R÷væW'6†—  ¢222&÷WFW2†6öçG&7BæW‡÷6W2 §Â&÷WFRÂfVGW&RÂ,:—6öÇWF–öâFV6†æ—VRÀ§ÂÒÒ×ÂÒÒ×ÂÒÒ×À§Âõ5Bö’öWF‚ö÷G÷&WVW7FÂWF‚Ö–FVçF—G’Â&÷WFW2ö÷Gæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚ö÷G÷fW&–g–ÂWF‚Ö–FVçF—G’Â&÷WFW2ö÷Gæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚ö÷G÷FW7B×&W6WFÂWF‚Ö–FVçF—G’Â&÷WFW2ö÷Gæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚öFÖ–â×&W6WFÂWF‚Ö–FVçF—G’Â&÷WFW2öWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚öWFò×&Vv—7FW&ÂWF‚Ö–FVçF—G’Â&÷WFW2öWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚öwVW7BÖ6†V6¶÷WFÂWF‚Ö–FVçF—G’Â&÷WFW2öWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öWF‚ö–çfö–6W6ÂWF‚Ö–FVçF—G’Â&÷WFW2ö6Æ–VçBÖWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚öÆöv–æÂWF‚Ö–FVçF—G’Â&÷WFW2öWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚öÆöv÷WFÂWF‚Ö–FVçF—G’Â&÷WFW2öWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚öÖv–2ÖÆ–æ¶ÂWF‚Ö–FVçF—G’Â&÷WFW2ö6Æ–VçBÖWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öWF‚öÖv–2ÖÆ–æ²÷fÆ–FFVÂWF‚Ö–FVçF—G’Â&÷WFW2ö6Æ–VçBÖWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öWF‚öÖVÂWF‚Ö–FVçF—G’Â&÷WFW2öWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öWF‚öÖVÂWF‚Ö–FVçF—G’Â&÷WFW2öWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öWF‚ö÷&FW'6ÂWF‚Ö–FVçF—G’Â&÷WFW2ö6Æ–VçBÖWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öWF‚÷&Vv—7FW&ÂWF‚Ö–FVçF—G’Â&÷WFW2öWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö6Æ–VçBö–çfö–6W6ÂWF‚Ö–FVçF—G’Â&÷WFW2ö6Æ–VçBÖWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö6Æ–VçBöÖv–2ÖÆ–æ¶ÂWF‚Ö–FVçF—G’Â&÷WFW2ö6Æ–VçBÖWF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö6ÆÚ±î¸Â¸­yêë¢°k¢G§¦*^}` | catalog | `routes/admin-boutique-categories.js` (resolved-owned) |
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
| `GET /api/admin/entities/clients/{id}` | dashboard | `routes/admin-client-360.js` (resolved-owned) |
| `GET /api/admin/entities/orders/{id}` | dashboard | `routes/admin-order-360.js` (resolved-owned) |
| `GET /api/admin/dashboard/reference/resolve` | dashboard | `routes/admin-dashboard-market.js` (resolved-owned) |
| `GET /api/admin/entities/products/{id}` | dashboard | `routes/admin-product-360.js` (resolved-owned) |
| `GET /api/admin/users/{id}/market-scopes` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `POST /api/admin/users/{id}/market-scopes` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `DELETE /api/admin/users/{id}/market-scopes/{id}` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `GET /api/admin/users/markets` | dashboard | `routes/admin/users.js` (resolved-owned) |
| `GET /api/admin/workspaces/accounting/market/{id}` | dashboard | `routes/admin-finance-accounting-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/accounting/market/{id}/deposits` | dashboard | `routes/admin-finance-accounting-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/accounting/market/{id}/deposits/{id}/dispute` | dashboard | `routes/admin-finance-accounting-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/accounting/market/{id}/deposits/{id}/verify` | dashboard | `routes/admin-finance-accounting-workspace.js` (resolved-owned) |
| `GET /api/admin/workspaces/operations/market/{id}` | dashboard | `routes/admin-operations-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/operations/market/{id}/distribution/run` | dashboard | `routes/admin-operations-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/operations/market/{id}/inventory/items/{id}/assign` | dashboard | `routes/admin-operations-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/operations/market/{id}/orders/{id}/confirm-cash` | dashboard | `routes/admin-operations-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/operations/market/{id}/parcels/{id}/collect` | dashboard | `routes/admin-operations-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/operations/market/{id}/parcels/{id}/ship` | dashboard | `routes/admin-operations-workspace.js` (resolved-owned) |
| `GET /api/admin/workspaces/shipping-customs/market/{id}` | dashboard | `routes/admin-shipping-customs-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/shipping-customs/market/{id}/customs/shipments` | dashboard | `routes/admin-shipping-customs-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/shipping-customs/market/{id}/customs/shipmm«ëŒ+Š×ž®º+º$zzb¥ç6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"ÖF6‚÷VWVVÂF6†&ö&BÂ&÷WFW2ö‡V"ÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"ÖF6‚÷fÆ–FFR÷¶–GÖÂF6†&ö&BÂ&÷WFW2ö‡V"ÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&VÆ’ö÷&FW'6ÂF6†&ö&BÂ&÷WFW2÷&VÆ’ÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&VÆ’ö÷&FW'2÷¶–GÖÂF6†&ö&BÂ&÷WFW2÷&VÆ’ÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂD4‚ö’÷&VÆ’ö÷&FW'2÷¶–GÒö6Æ–VçBÖ'6VçFÂF6†&ö&BÂ&÷WFW2÷&VÆ’ÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&VÆ’ö÷&FW'2÷¶–GÒö6öÖÖVçFÂF6†&ö&BÂ&÷WFW2÷&VÆ’ÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&VÆ’ö÷&FW'2÷¶–GÒöW66ÆFVÂF6†&ö&BÂ&÷WFW2÷&VÆ’ÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&VÆ’ö÷&FW'2÷¶–GÒö–æ6–FVçFÂF6†&ö&BÂ&÷WFW2÷&VÆ’ÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöVçF—F–W2ö6Æ–VçG2÷¶–GÖÂF6†&ö&BÂ&÷WFW2öFÖ–âÖ6Æ–VçBÓ3cæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöVçF—F–W2ö÷&FW'2÷¶–GÖÂF6†&ö&BÂ&÷WFW2öFÖ–âÖ÷&FW"Ó3cæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöF6†&ö&B÷&VfW&Væ6R÷&W6öÇfVÂF6†&ö&BÂ&÷WFW2öFÖ–âÖF6†&ö&BÖÖ&¶WBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöVçF—F–W2÷&öGV7G2÷¶–GÖÂF6†&ö&BÂ&÷WFW2öFÖ–â×&öGV7BÓ3cæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷W6W'2÷¶–GÒöÖ&¶WB×66÷W6ÂF6†&ö&BÂ&÷WFW2öFÖ–â÷W6W'2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷W6W'2÷¶–GÒöÖ&¶WB×66÷W6ÂF6†&ö&BÂ&÷WFW2öFÖ–â÷W6W'2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’öFÖ–â÷W6W'2÷¶–GÒöÖ&¶WB×66÷W2÷¶–GÖÂF6†&ö&BÂ&÷WFW2öFÖ–â÷W6W'2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷W6W'2öÖ&¶WG6ÂF6†&ö&BÂ&÷WFW2öFÖ–â÷W6W'2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2ö66÷VçF–æröÖ&¶WB÷¶–GÖÂF6†&ö&BÂ&÷WFW2öFÖ–âÖf–ææ6RÖ66÷VçF–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2ö66÷VçF–æröÖ&¶WB÷¶–GÒöFW÷6—G6ÂF6†&ö&BÂ&÷WFW2öFÖ–âÖf–ææ6RÖ66÷VçF–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2ö66÷VçF–æröÖ&¶WB÷¶–GÒöFW÷6—G2÷¶–GÒöF—7WFVÂF6†&ö&BÂ&÷WFW2öFÖ–âÖf–ææ6RÖ66÷VçF–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2ö66÷VçF–æröÖ&¶WB÷¶–GÒöFW÷6—G2÷¶–GÒ÷fW&–g–ÂF6†&ö&BÂ&÷WFW2öFÖ–âÖf–ææ6RÖ66÷VçF–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2ö÷W&F–öç2öÖ&¶WB÷¶–GÖÂF6†&ö&BÂ&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2ö÷W&F–öç2öÖ&¶WB÷¶–GÒöF—7G&–'WF–öâ÷'VæÂF6†&ö&BÂ&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2ö÷W&F–öç2öÖ&¶WB÷¶–GÒö–çfVçF÷'’ö—FV×2÷¶–GÒö76–væÂF6†&ö&BÂ&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2ö÷W&F–öç2öÖ&¶WB÷¶–GÒö÷&FW'2÷¶–GÒö6öæf—&ÒÖ66†ÂF6†&ö&BÂ&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2ö÷W&F–öç2öÖ&¶WB÷¶–GÒ÷&6VÇ2÷¶–GÒö6öÆÆV7FÂF6†&ö&BÂ&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2ö÷W&F–öç2öÖ&¶WB÷¶–GÒ÷&6VÇ2÷¶–GÒ÷6†—ÂF6†&ö&BÂ&÷WFW2öFÖ–âÖ÷W&F–öç2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷6†—–ærÖ7W7Fö×2öÖ&¶WB÷¶–GÖÂF6†&ö&BÂ&÷WFW2öFÖ–â×6†—–ærÖ7W7Fö×2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6†—–ærÖ7W7Fö×2öÖ&¶WB÷¶–GÒö7W7Fö×2÷6†—ÖVçG6ÂF6†&ö&BÂ&÷WFW2öFÖ–â×6†—–ærÖ7W7Fö×2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6†—–ærÖ7W7Fö×2öÖ&¶WB÷¶–GÒö7W7Fö×2÷6†—ÖVçG2÷¶–GÒö7F—fFVÂF6†&ö&BÂ&÷WFW2öFÖ–â×6†—–ærÖ7W7Fö×2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6†—–ærÖ7W7Fö×2öÖ&¶WB÷¶–GÒö7W7Fö×2÷6†—ÖVçG2÷¶–GÒöFV7F—fFVÂF6†&ö&BÂ&÷WFW2öFÖ–â×6†—–ærÖ7W7Fö×2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6†—–ærÖ7W7Fö×2öÖ&¶WB÷¶–GÒö7W7Fö×2÷6†—ÖVçG2÷¶–GÒöFV6Æ&VÂF6†&ö&BÂ&÷WFW2öFÖ–â×6†—–ærÖ7W7Fö×2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6†—–ærÖ7W7Fö×2öÖ&¶WB÷¶–GÒö7W7Fö×2÷6†—ÖVçG2÷¶–GÒ÷WFFVÂF6†&ö&BÂ&÷WFW2öFÖ–â×6†—–ærÖ7W7Fö×2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6†—–ærÖ7W7Fö×2öÖ&¶WB÷¶–GÒ÷&6VÇ2÷¶–GÒö6öæf—&Ò×G&ç6—FÂF6†&ö&BÂ&÷WFW2öFÖ–â×6†—–ærÖ7W7Fö×2×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöFö7VÖVçG6ÂFö7VÖVçG2Â&÷WFW2öFÖ–âöFö7VÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöFö7VÖVçG2÷7VÖÖ'–ÂFö7VÖVçG2Â&÷WFW2öFÖ–âöFö7VÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöFö7VÖVçG2÷¶–GÖÂFö7VÖVçG2Â&÷WFW2öFÖ–âöFö7VÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öWF‚öÖRöFö7VÖVçG6ÂFö7VÖVçG2Â&÷WFW2öFö7VÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öWF‚öÖRöFö7VÖVçG2÷¶–GÒöF÷væÆöFÂFö7VÖVçG2Â&÷WFW2öFö7VÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö–çfö–6W6ÂFö7VÖVçG2Â&÷WFW2ö–çfö–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö–çfö–6W2÷¶–GÖÂFö7VÖVçG2Â&÷WFW2ö–çfö–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö–çfö–6W2÷¶–GÒö§6öæÂFö7VÖVçG2Â&÷WFW2ö–çfö–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö–çfö–6W2÷¶–GÒöF÷væÆöFÂFö7VÖVçG2Â&÷WFW2ö–çfö–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&–6–ær÷&V6öÖÖVæFÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–ævÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ær÷6–×VÆFVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröfÆ÷vÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ær÷&öGV7G2÷¶–GÒöÇ’×&–6VÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–ær÷7G&FVw–ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ær÷7G&FVw’öÇ–ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ærö6ö×WF—F÷'6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ærö6ö×WF—F÷'2÷¶–GÒöFV7F—fFVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ærö6÷7BÖ6ö×öæVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ærö6÷7BÖ6ö×öæVçG2÷¶–GÒ÷WFFVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ærö6÷7BÖ6ö×öæVçG2÷¶–GÒ÷FövvÆVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒöFV6—6–öæÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒöFV6—6–öâ×öÆ–7’ö†—7F÷'–ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒöFV6—6–öâ×öÆ–7–ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒö6÷7BÖ6ö×öæVçG2÷¶–GÒ÷WFFVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒö6÷7BÖ6ö×öæVçG2÷¶–GÒ÷FövvÆVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒö6÷7BÖ6ö×öæVçG2÷¶–GÒ÷&W6WFÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒö6÷'&–F÷&ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷&–6RÖö'6W'fF–öç6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷&–6RÖö'6W'fF–öç2÷¶–GÒöFV7F—fFVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âö6÷7BÖ6ö×öæVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖ6÷7BÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âö6÷7BÖ6ö×öæVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖ6÷7BÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âö6÷7BÖ6ö×öæVçG2õöÖWFÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖ6÷7BÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’öFÖ–âö6÷7BÖ6ö×öæVçG2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖ6÷7BÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âö6÷7BÖ6ö×öæVçG2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖ6÷7BÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–âö6÷7BÖ6ö×öæVçG2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖ6÷7BÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âö6÷7BÖ6ö×öæVçG2÷¶–GÒ÷FövvÆVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖ6÷7BÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöV6öæöÖ–2ö6†&vW6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöV6öæöÖ–2ö6†&vW6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’öFÖ–âöV6öæöÖ–2ö6†&vW2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–âöV6öæöÖ–2ö6†&vW2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–âöV6öæöÖ–2ö6†&vW2÷¶–GÒ÷FövvÆVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöV6öæöÖ–2ö6ö†W&Væ6VÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöV6öæöÖ–2öW†V7WF—fVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöV6öæöÖ–2ö†—7F÷'–ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöV6öæöÖ–2÷&VF—7G&–'WFVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöV6öæöÖ–2÷f&–&ÆW6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–âöV6öæöÖ–2÷f&–&ÆW2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öV6öæöÖ–2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöf–ææ6RÖ6öæf–vÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖf–ææ6RÖ6öæf–ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–âöf–ææ6RÖ6öæf–vÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖf–ææ6RÖ6öæf–ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöf–ææ6RÖ6öæf–r÷66†VÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–âÖf–ææ6RÖ6öæf–ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöf–ææ6RöW‡÷'FÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öf–ææ6Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöf–ææ6R÷&W÷'FÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öf–ææ6Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöf–ææ6R÷7G&—R×&öög6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öf–ææ6Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöf–ææ6R÷7VÖÖ'–ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öf–ææ6Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷&–6–ærÖ6ö×öæVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷&–6–ærÖ6ö×öæVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’öFÖ–â÷&–6–ærÖ6ö×öæVçG2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷&–6–ærÖ6ö×öæVçG2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷&–6–ærÖ6ö×öæVçG2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷&–6–ærÖ6ö×öæVçG2÷¶–GÒ÷FövvÆVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖ6ö×öæVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷&–6–ærÖÖG&–6W2öF–×6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖÖG&–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷&–6–ærÖÖG&–6W2öF–×2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖÖG&–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷&–6–ærÖÖG&–6W2÷F†W6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖÖG&–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷&–6–ærÖÖG&–6W2÷F†W2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ærÖÖG&–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–æröæÇ—6—6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷6÷W&6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–æröæÇ—6—2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷6÷W&6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6÷W&6–ærö'VÆ²×&–ÆÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷6÷W&6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–ærö6öæf–vÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷6÷W&6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷6÷W&6–ær÷&öGV7G2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷6÷W&6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–ær÷&öGV7G2÷¶–GÒ÷f&–çG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷6÷W&6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷6÷W&6–ær÷&öGV7G2÷¶–GÒ÷f&–çG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷6÷W&6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–ær÷7–çF†W6—6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷6÷W&6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷&—6²×&÷f—6–öç6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&—6²×&÷f—6–öç2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷&—6²×&÷f—6–öç6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&—6²×&÷f—6–öç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’öFÖ–â÷&—6²×&÷f—6–öç2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&—6²×&÷f—6–öç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷&—6²×&÷f—6–öç2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&—6²×&÷f—6–öç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷&—6²×&÷f—6–öç2÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&—6²×&÷f—6–öç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷&—6²×&÷f—6–öç2÷¶–GÒ÷FövvÆVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&—6²×&÷f—6–öç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öF6†&ö&BöæçVÆF–öç2×&6VÇ6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öF6†&ö&BÖf–ææ6Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öF6†&ö&Böf–ææ6VÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öF6†&ö&BÖf–ææ6Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öF6†&ö&B÷–ÖVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öF6†&ö&BÖf–ææ6Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öF6†&ö&B÷6ÆW6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öF6†&ö&BÖf–ææ6Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’÷&–6–æröÇ’ÖÆÆÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’÷&–6–æröÇ’×&–6R÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&–6–ærö&Væ6†Ö&·6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’÷&–6–ærö&Væ6†Ö&·6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&–6–ærö&Væ6†Ö&·2ÖvÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’÷&–6–ærö&Væ6†Ö&·2÷¶–GÒ÷¶–GÖÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&–6–ærö6Æ7VÆFVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&–6–ærö6÷WGW&VÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&–6–æröF6†&ö&FÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&–6–æröfÆ÷vÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&–6–ær÷&FW6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’÷&–6–ær÷&FW6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&–6–ær÷&V6öÖÖVæBÖ&F6†ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&–6–ær÷7G&FVw–ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2÷&–6–ær×7G&FVw’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&–6–ær÷7G&FVw’öÇ–Â–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷&öGV7G2÷¶–GÒöÆö6Â×&–6VÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷&öGV7G2÷¶–GÒöÆö6Â×&–6Rö7F—fFVÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷&öGV7G2÷¶–GÒöÆö6Â×&–6Rö7F—fF–öâ×&Wf–WvÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷&öGV7G2÷¶–GÒöÆö6Â×&–6R÷&W6WFÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö–Ú±î¸Â¸­yêë¢°k¢G§¦*^m«ëŒ+Š×ž®º+º$zzb¥âöFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷6–×VÆFRÖ–×7FÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷7G'V7GW&RÖWfVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–æröÖ&¶WB÷¶–GÒ÷7G'V7GW&RÖWfVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ær÷6–×VÆFRÖ–×7FÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–ær÷7G'V7GW&RÖWfVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ær÷7G'V7GW&RÖWfVçG6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷&–6–ær÷7G'V7GW&RÖWfVçG2÷¶–GÒöGG&–'WF–öç6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ær÷7G'V7GW&RÖWfVçG2÷¶–GÒöGG&–'WF–öç6ÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ær÷7G'V7GW&RÖWfVçG2÷¶–GÒöGG&–'WF–öç2÷&WfW'6VÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷&–6–ær÷7G'V7GW&RÖWfVçG2÷¶–GÒöGG&–'WF–öç2ö6÷'&V7FÂV6öæöÖ–2ÖVæv–æRÂ&÷WFW2öFÖ–â×&–6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö†VÇF†Â–æg&7G'V7GW&RÂ6W'fW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷V&Æ–2ö6öæf–vÂ–æg&7G'V7GW&RÂ6W'fW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUB÷vV&†öö²öWF†¶W’×v†G6Â–æg&7G'V7GW&RÂ(	B†æ÷BÖ–âÖ÷Væ’Ö6öçG&7B’À§ÂtUBò¢æ‡FÖÆÂ–æg&7G'V7GW&RÂ(	B†æ÷BÖ–âÖ÷Væ’Ö6öçG&7B’À§ÂtUBö’ö‡V"ö–çfVçF÷'’ö'VffW&Â–çfVçF÷'’Â&÷WFW2ö–çfVçF÷'’Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"ö–çfVçF÷'’ö÷Vâ×&6VÇ6Â–çfVçF÷'’Â&÷WFW2ö–çfVçF÷'’Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"ö–çfVçF÷'’ö÷&FW"÷¶–GÒöF—7F6†Â–çfVçF÷'’Â&÷WFW2ö–çfVçF÷'’Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"ö–çfVçF÷'’÷&÷÷6Ç6Â–çfVçF÷'’Â&÷WFW2ö–çfVçF÷'’Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"ö–çfVçF÷'’÷&÷÷6RÖÆÆÂ–çfVçF÷'’Â&÷WFW2ö–çfVçF÷'’Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"ö–çfVçF÷'’÷&V6V—fVÂ–çfVçF÷'’Â&÷WFW2ö–çfVçF÷'’Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"ö–çfVçF÷'’÷66âÖ76–væÂ–çfVçF÷'’Â&÷WFW2ö–çfVçF÷'’Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"ö–çfVçF÷'’÷7FG6Â–çfVçF÷'’Â&÷WFW2ö–çfVçF÷'’Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆö6Â×7Fö6²öf–Æ&–Æ—G–ÂÆö6Â×7Fö6²Â&÷WFW2öÆö6Â×7Fö6²æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆö6Â×7Fö6²ö6†V6¶÷WB×&Wf–WvÂÆö6Â×7Fö6²Â&÷WFW2öÆö6Â×7Fö6²æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷c"÷&6VÇ2÷¶–GÒ÷66æÂÆöv—7F–72Â&÷WFW2÷&6VÂÖ’×c"÷66ç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷G&6¶–ær÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷G&6¶–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö6'&–W'6ÂÆöv—7F–72Â&÷WFW2ö6'&–W'2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö6'&–W'6ÂÆöv—7F–72Â&÷WFW2ö6'&–W'2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’ö6'&–W'2÷¶–GÖÂÆöv—7F–72Â&÷WFW2ö6'&–W'2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂD4‚ö’ö6'&–W'2÷¶–GÖÂÆöv—7F–72Â&÷WFW2ö6'&–W'2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂD4‚ö’ö6'&–W'2ö7W7Fö×2÷¶–GÖÂÆöv—7F–72Â&÷WFW2ö6'&–W'2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö6Æ–VçB÷G&6¶–ævÂÆöv—7F–72Â&÷WFW2ö6Æ–VçB×G&6¶–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"öWFòÖF—7G&–'WFVÂÆöv—7F–72Â&÷WFW2öWFòÖF—7G&–'WFRÖ’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"öWFòÖF—7G&–'WFVÂÆöv—7F–72Â&÷WFW2öWFòÖF—7G&–'WFRÖ’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"öWFòÖF—7G&–'WFRö6ÆVçWÂÆöv—7F–72Â&÷WFW2öWFòÖF—7G&–'WFRÖ’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"ö&F6‚×66æÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"÷6¶ÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"÷VæF–ævÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"÷†÷FöÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"÷66æÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"÷6VÆÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"÷6V&6†ÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"÷7FG2÷vVV¶ÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö‡V"÷FöF–ÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"÷föÇVÖVÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆöv—7F–72öÆ&VÇ2÷¶–GÖÂÆöv—7F–72Â&÷WFW2öÆöv—7F–72æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆöv—7F–72öÖæ–fW7B÷¶–GÖÂÆöv—7F–72Â&÷WFW2öÆöv—7F–72æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆöv—7F–72÷6†—ÖVçG6ÂÆöv—7F–72Â&÷WFW2öÆöv—7F–72æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÆöv—7F–72÷6†—ÖVçG6ÂÆöv—7F–72Â&÷WFW2öÆöv—7F–72æ§6‡&W6öÇfVBÖ÷væVB’À§ÂD4‚ö’öÆöv—7F–72÷6†—ÖVçG2÷¶–GÖÂÆöv—7F–72Â&÷WFW2öÆöv—7F–72æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&6VÇ2÷¶–GÒö—FV×6ÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’÷&6VÇ2÷¶–GÒö—FV×2÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂD4‚ö’÷&6VÇ2÷¶–GÒ÷7FGW6ÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&6VÇ2÷¶–GÒ÷fW&–g’×6VÆÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&6VÇ2÷¶–GÒ÷vV–v‡FÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&6VÇ2÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&6VÇ2÷¶–GÒöWfVçG6ÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&6VÇ2ö&ö÷G7G&÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&6VÇ2ö÷F–Ö—¦VÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–6·Wö6öÆÆV7B÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–6·W÷’Ö66‚÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–6·W÷&V6V—B÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–6·W÷&VvVæW&FR÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–6·W÷&WfVÂÖöæ6R÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–6·W÷7FGW2÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–6·W÷fW&–g’÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–6·WöW†6WF–öæÂ×–6·W÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–6·WöW†6WF–öæÂ×–6·W÷¶–GÒö6öÆÆV7FÂÆöv—7F–72Â&÷WFW2÷–6·W×6V7&WBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&VÆ—6ÂÆöv—7F–72Â&÷WFW2÷&VÆ—2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&VÆ—2÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷&VÆ—2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&VÆ—2÷V&Æ–6ÂÆöv—7F–72Â&÷WFW2÷&VÆ—2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷66ç6ÂÆöv—7F–72Â&÷WFW2÷66ç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷66ç2÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷66ç2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷66ç2ö6öÆÆV7FÂÆöv—7F–72Â&÷WFW2÷66ç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷66ç2ö‡V"÷VæF–ævÂÆöv—7F–72Â&÷WFW2÷66ç2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷66ç2ö‡V"÷&V6V—fVÂÆöv—7F–72Â&÷WFW2÷66ç2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷66ç2ö‡V"÷&V6öæ6–ÆVÂÆöv—7F–72Â&÷WFW2÷66ç2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷66ç2÷fW&–g’×&ÂÆöv—7F–72Â&÷WFW2÷66ç2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷G&6¶–ær÷¶–GÒ÷fW&–g’×–6·WÂÆöv—7F–72Â&÷WFW2÷G&6¶–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷G&ç6—FÂÆöv—7F–72Â&÷WFW2÷G&ç6—BÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷G&ç6—BÖF6†&ö&FÂÆöv—7F–72Â&÷WFW2÷G&ç6—BÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷G&ç6—BÖF6†&ö&B÷¶–GÒ÷G&ç6—FÂÆöv—7F–72Â&÷WFW2÷G&ç6—BÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷G&ç6—B÷¶–GÒ÷G&ç6—FÂÆöv—7F–72Â&÷WFW2÷G&ç6—BÖF6†&ö&Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷G&ç6—F—&Rö†—7F÷'–ÂÆöv—7F–72Â&÷WFW2÷G&ç6—F—&RÖ’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷G&ç6—F—&R÷&6VÇ6ÂÆöv—7F–72Â&÷WFW2÷G&ç6—F—&RÖ’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷G&ç6—F—&R÷6†—ÂÆöv—7F–72Â&÷WFW2÷G&ç6—F—&RÖ’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷G&ç6—F—&R÷7FG6ÂÆöv—7F–72Â&÷WFW2÷G&ç6—F—&RÖ’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ6ÂÆöv—7F–72Â&÷WFW2÷&6VÂÖ’×c"÷&VBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2÷¶–GÖÂÆöv—7F–72Â&÷WFW2÷&6VÂÖ’×c"÷&VBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2÷¶–GÒöÆ&VÆÂÆöv—7F–72Â&÷WFW2÷&6VÂÖÆ&VÂæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2÷¶–GÒ÷F–ÖVÆ–æVÂÆöv—7F–72Â&÷WFW2÷&6VÂÖ’×c"÷&VBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2öÆW'G6ÂÆöv—7F–72Â&÷WFW2÷&6VÂÖ’×c"÷&VBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2ö7&—F–6ÆÂÆöv—7F–72Â&÷WFW2÷&6VÂÖ’×c"÷&VBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2ö·—6ÂÆöv—7F–72Â&÷WFW2÷&6VÂÖ’×c"÷&VBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2÷&V6öæ6–Æ–F–öæÂÆöv—7F–72Â&÷WFW2÷&6VÂÖ’×c"÷&VBæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"öÖ÷fVÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"ö÷WF6öÖVÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"÷&WfÆ–FFVÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"÷G&ç6—F–öæÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö‡V"÷Væ—FÂÆöv—7F–72Â&÷WFW2ö‡V"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&6VÇ6ÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&6VÇ6ÂÆöv—7F–72Â&÷WFW2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆ÷–ÇG’÷F–W'6ÂÆ÷–ÇG’Â&÷WFW2öÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöÆ÷–ÇG’÷VæF–ævÂÆ÷–ÇG’Â&÷WFW2öFÖ–âÖÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöÆ÷–ÇG’ö†—7F÷'–ÂÆ÷–ÇG’Â&÷WFW2öFÖ–âÖÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöÆ÷–ÇG’÷&Wv&B÷¶–GÖÂÆ÷–ÇG’Â&÷WFW2öFÖ–âÖÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöÆ÷–ÇG’÷6¶—÷¶–GÖÂÆ÷–ÇG’Â&÷WFW2öFÖ–âÖÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöÆ÷–ÇG’÷7FG6ÂÆ÷–ÇG’Â&÷WFW2öFÖ–âÖÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆ÷–ÇG’öÖVÂÆ÷–ÇG’Â&÷WFW2öÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆ÷–ÇG’÷W6W'6ÂÆ÷–ÇG’Â&÷WFW2öÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÆ÷–ÇG’÷7FG6ÂÆ÷–ÇG’Â&÷WFW2öÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öÆ÷–ÇG’÷F–W'2÷¶–GÖÂÆ÷–ÇG’Â&÷WFW2öÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÆ÷–ÇG’÷&V6Æ7VÆFR÷¶–GÖÂÆ÷–ÇG’Â&÷WFW2öÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÆ÷–ÇG’÷&V6Æ7VÆFRÖÆÆÂÆ÷–ÇG’Â&÷WFW2öÆ÷–ÇG’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöÖ&¶WG6ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ&÷WFW2öFÖ–âÖÖ&¶WBÖ6öçG&öÂ×ÆæRæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöÖ&¶WG2÷¶–GÒöÆ–fV7–6ÆVÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ&÷WFW2öFÖ–âÖÖ&¶WBÖ6öçG&öÂ×ÆæRæ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–âöÖ&¶WG2÷¶–GÒ÷7F÷&Vg&öçFÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ&÷WFW2öFÖ–âÖÖ&¶WBÖ6öçG&öÂ×ÆæRæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöÖ&¶WG2÷¶–GÒ÷&W&÷f—6–öæÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ&÷WFW2öFÖ–âÖÖ&¶WBÖ6öçG&öÂ×ÆæRæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöÖ&¶WG6ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ&÷WFW2öFÖ–âÖÖ&¶WBÖ6öçG&öÂ×ÆæRæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöÖ&¶WG2ö6VçG&ÂÖWF†÷&—G–ÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ&÷WFW2öFÖ–âÖÖ&¶WBÖ6öçG&öÂ×ÆæRæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöÖ&¶WG2÷¶–GÒö6öçG&öÂ×ÆæVÂÖ&¶WBÖ6öçG&öÂ×ÆæRÂ&÷WFW2öFÖ–âÖÖ&¶WBÖ6öçG&öÂ×ÆæRæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒ÷FVÖÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×FVÒæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒ÷FVÒö–çf—FF–öç6ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×FVÒæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâ÷FVÒö–çf—FF–öç2÷¶–GÒö66WFÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×FVÒæ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒ÷FVÒ÷¶–GÒö6&–Æ—F–W6ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×FVÒæ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒ÷FVÒ÷¶–GÖÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×FVÒæ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒ÷FVÒö–çf—FF–öç2÷¶–GÖÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×FVÒæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒö66‚Ö6öçG&öÂ×öÆ–7–ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ66‚Ö6öçG&öÂæ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒö66‚Ö6öçG&öÂ×öÆ–7–ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ66‚Ö6öçG&öÂæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&VÆ—6ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&VÆ—6ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&VÆ—2÷¶–GÖÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&VÆ—2÷¶–GÒ÷7W7VæFÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&VÆ—2÷¶–GÒö7F—fFVÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖæWGv÷&²æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&÷f–FW'6ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&÷f–FW'6ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&÷f–FW'2÷¶–GÖÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&÷f–FW'2÷¶–GÒ÷7W7VæFÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöæWGv÷&²÷&÷f–FW'2÷¶–GÒö7F—fFVÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâ×&÷f–FW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒö6FÆöröW‡÷7W&VÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ6FÆöræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒö6FÆör÷&Wf–Wr÷¶–GÒ÷fÆ–FFVÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ6FÆöræ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒö6FÆöröW‡÷7W&R÷¶–GÖÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖ6FÆöræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöÆö6ÂÖöffW"÷6W'f–6W6ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖÆö6ÂÖöffW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöÆö6ÂÖöffW"÷6W'f–6W2÷¶–GÖÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖÆö6ÂÖöffW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöÆö6ÂÖöffW"÷‡—6–6ÂÖöffW'6ÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖÆö6ÂÖöffW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öÖ&¶WBÖFVÆVvF–öâöÖ&¶WG2÷¶–GÒöÆö6ÂÖöffW"÷‡—6–6ÂÖöffW'2÷¶–GÖÂÖ&¶WBÖFVÆVvF–öâÂ&÷WFW2öÖ&¶WBÖFVÆVvF–öâÖÆö6ÂÖöffW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖ&²Â÷&FW'2Â&÷WFW2ö÷&FW'2öÆ—7Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö÷&FW'2÷&WG&—B÷¶–GÖÂ÷&FW'2Â&÷WFW2ö÷&FW'2÷"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂD4‚ö’ö÷&FW'2÷7V"Ö÷&FW'2÷¶–GÒ÷7FGW6Â÷&FW'2Â&÷WFW2ö÷&FW'2÷&6VÇ2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"ö÷&FW'6Â÷&FW'2Â&÷WFW2ö÷&FW"Ö’×c"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"ö÷&FW'2÷¶–GÖÂ÷&FW'2Â&÷WFW2ö÷&FW"Ö’×c"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷c"ö÷&FW'2÷¶–GÒö6öæf—&ÒÖ66†Â÷&FW'2Â&÷WFW2ö÷&FW"Ö’×c"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷c"ö÷&FW'2÷¶–GÒö7&VFR×&6VÆÂ÷&FW'2Â&÷WFW2ö÷&FW"Ö’×c"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"ö÷&FW'2÷VæF–ærÖ66†Â÷&FW'2Â&÷WFW2ö÷&FW"Ö’×c"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"ö÷&FW'2÷&VG’Öf÷"×&6VÆÂ÷&FW'2Â&÷WFW2ö÷&FW"Ö’×c"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2÷7G&—Rö–çFVçFÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2÷—Â÷vV&†öö¶Â–ÖVçG2Â&÷WFW2÷–ÖVçG2×—Âæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2ö66‚ö6öæf—&ÖÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–ÖVçG2öÖö&–ÆRÖÖöæW’öf–Æ&–Æ—G–Â–ÖVçG2Â&÷WFW2÷–ÖVçG2ÖÖö&–ÆRÖÖöæW’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2öÖö&–ÆRÖÖöæW’ö–æ—F–FVÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2ÖÖö&–ÆRÖÖöæW’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–ÖVçG2öÖö&–ÆRÖÖöæW’÷G&ç67F–öç2÷¶–GÖÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2ÖÖö&–ÆRÖÖöæW’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2öÖö&–ÆRÖÖöæW’÷G&ç67F–öç2÷¶–GÒ÷&Vg&W6†Â–ÖVçG2Â&÷WFW2÷–ÖVçG2ÖÖö&–ÆRÖÖöæW’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2öÖö&–ÆRÖÖöæW’ö6ÆÆ&6²÷¶–GÒ÷¶–GÖÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2ÖÖö&–ÆRÖÖöæW’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2öÖö&–ÆRÖÖöæW’÷vV&†öö²÷¶–GÖÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2ÖÖö&–ÆRÖÖöæW’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–ÖVçG2öÖö&–ÆRÖÖöæW’öFÖ–â÷VæF–ævÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2ÖÖö&–ÆRÖÖöæW’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö66‚ö6öÆÆV7B÷¶–GÖÂ–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö66‚ö6öÆÆV7F–öç6Â–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö66‚öFW÷6—FÂ–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö66‚öFW÷6—G6Â–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö66‚öFW÷6—G2÷¶–GÒöF—7WFVÂ–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’ö66‚öFW÷6—G2÷¶–GÒ÷fW&–g–Â–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö66‚÷&V6öæ6–Æ–F–öæÂ–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö66‚÷&V6öæ6–Æ–F–öâövVçG6Â–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö66‚÷Væ6öÆÆV7FVFÂ–ÖVçG2Â&÷WFW2ö66‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–ÖVçG2ö6öæf–vÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2÷—Âö6GW&R÷¶–GÖÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2×—Âæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2÷—Âö7&VFRÖ÷&FW&Â–ÖVçG2Â&÷WFW2÷–ÖVçG2×—Âæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2÷—Â÷&VgVæB÷¶–GÖÂ–ÖVçG2Â&÷WFW2÷–ÖVçG2×—Âæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷–ÖVçG2÷&FW6Â–ÖVçG2Â&÷WFW2÷–ÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷–ÖVçG2÷7G&—R÷vV&†öö¶Â–ÖVçG2Â&÷WFW2÷–ÖVçG2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö†VÇF†ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö†VÇF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖöGVÆW6ÂÆFf÷&ÒÖ÷2Â&÷WFW2öÖöGVÆW2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6–×VÆF÷"ö6ÆVçWÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6–×VÆF÷"ö¦÷W&æÆÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6–×VÆF÷"÷7F'FÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6–×VÆF÷"÷7FGW6ÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6–×VÆF÷"÷7F÷ÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖöGVÆW2÷¶–GÖÂÆFf÷&ÒÖ÷2Â&÷WFW2öÖöGVÆW2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖöGVÆW2öf'&–76ÂÆFf÷&ÒÖ÷2Â&÷WFW2öÖöGVÆW2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖöGVÆW2öf'&–76ÂÆFf÷&ÒÖ÷2Â&÷WFW2öÖöGVÆW2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öÖöGVÆW2öÖöFVÇ6ÂÆFf÷&ÒÖ÷2Â&÷WFW2öÖöGVÆW2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖöGVÆW2öÖöFVÇ6ÂÆFf÷&ÒÖ÷2Â&÷WFW2öÖöGVÆW2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öÖöGVÆW2÷&–6VÂÆFf÷&ÒÖ÷2Â&÷WFW2öÖöGVÆW2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6–×VÆF÷"ö6ÆVçWÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷6–×VÆF÷"ö¦÷W&æÆÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6–×VÆF÷"÷7F'FÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷6–×VÆF÷"÷7FGW6ÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6–×VÆF÷"÷7F÷ÂÆFf÷&ÒÖ÷2Â&÷WFW2÷6–×VÆF÷"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"öÆW'G6ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷c"öÆW'G2÷¶–GÒö6¶æ÷vÆVFvVÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"övÆö&ÆÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"ö–æ6–FVçG6ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"ö–çfö–6W6ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2÷¶–GÒö÷&FW'6ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2÷¶–GÒ÷66ç6ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&6VÇ2÷¶–GÒöFWF–ÆÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&V6öæ6–Æ–F–öæÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷&V6öæ6–Æ–F–öâ÷7VÖÖ'–ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷c"÷66âÖWfVçG6ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö÷2Ö’æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö†VÇF‚öFWF–ÆVFÂÆFf÷&ÒÖ÷2Â&÷WFW2ö†VÇF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö†VÇF‚öÖWG&–76ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö†VÇF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö†VÇF‚÷&VG–ÂÆFf÷&ÒÖ÷2Â&÷WFW2ö†VÇF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö†VÇF‚÷fW'6–öæÂÆFf÷&ÒÖ÷2Â&÷WFW2ö†VÇF‚æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&÷f–FW'2×6W'f–6W2÷6W'f–6W2÷¶–GÖÂ&÷f–FW'2×6W'f–6W2Â&÷WFW2÷&÷f–FW'2×6W'f–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷&÷f–FW'2×6W'f–6W2÷‡—6–6ÂÖöffW'2÷¶–GÖÂ&÷f–FW'2×6W'f–6W2Â&÷WFW2÷&÷f–FW'2×6W'f–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷&÷f–FW'2×6W'f–6W2ö–çV—&–W6Â&÷f–FW'2×6W'f–6W2Â&÷WFW2÷&÷f–FW'2×6W'f–6W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷W&6†6–ævÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷W&6†6–ær÷7WÆ–W'6ÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷7WÆ–W'6ÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷7WÆ–W'2÷¶–GÒöÖÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’÷W&6†6–ær÷7WÆ–W'2÷¶–GÖÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷W&6†6–ærö÷&FW"÷¶–GÒö6ö×ÆWFVæW76ÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷W&6†6–ær÷¶–GÖÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷¶–GÒö6öæf—&ÖÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷¶–GÒ÷&V6V—fVÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’÷W&6†6–ær÷ò÷¶–GÖÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷W&6†6–ærö÷VâÖÆ–æW6ÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷W&6†6–ær÷ò÷¶–GÖÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷W&6†6–ær÷ò÷¶–GÒö6öÖÖ—FÖVçB×FfÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷ò÷&W&VÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷ò÷¶–GÒöFWF6†ÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷ò÷¶–GÒöF—66&FÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–æröÆ–æW2÷¶–GÒö6æ6VÆÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷ò÷¶–GÒ÷7V&Ö—FÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–ær÷ò÷¶–GÒö6öæf—&ÖÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–æröÆ–æW6ÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷W&6†6–æröÆ–æW2÷¶–GÒ÷6WGFÆVÂW&6†6–ærÂ&÷WFW2÷W&6†6–æræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’ö&÷WF—VR÷7VvvW7F–öç6Â&V6öÖÖVæFF–öç2Â&÷WFW2ö&÷WF—VR×7VvvW7F–öç2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–âöÖ&¶WB×6WGFÆVÖVçG2öÖ&¶WG2÷¶–GÒ÷6WGFÆVÖVçG6Â6WGFÆVÖVçBÂ&÷WFW2öFÖ–âÖÖ&¶WB×6WGFÆVÖVçBæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöÖ&¶WB×6WGFÆVÖVçG2öÖ&¶WG2÷¶–GÒ÷6WGFÆVÖVçG2÷&VG–Â6WGFÆVÖVçBÂ&÷WFW2öFÖ–âÖÖ&¶WB×6WGFÆVÖVçBæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–âöÖ&¶WB×6WGFÆVÖVçG2÷6WGFÆVÖVçG2÷¶–GÒ÷–FÂ6WGFÆVÖVçBÂ&÷WFW2öFÖ–âÖÖ&¶WB×6WGFÆVÖVçBæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷6†&VBÖ6'G2÷V&Æ–2÷¶–GÖÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6†&VBÖ6'G2ög&öÒÖ6'BÖ—FV×6Â6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6†&VBÖ6'G2ög&öÒÖ&6¶WFÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷6†&VBÖ6'G2öÖ–æVÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷6†&VBÖ6'G2öÆ–'&'–Â6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6†&VBÖ6'G2÷6fVÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂDTÄUDRö’÷6†&VBÖ6'G2÷6fVB÷¶–GÖÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'B×6fVBæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6†&W6Â6†&VBÖ6'BÂ&÷WFW2÷6†&W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷6†&W2÷¶–GÖÂ6†&VBÖ6'BÂ&÷WFW2÷6†&W2æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’÷6†&VBÖ6'G2÷¶–GÖÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6†&VBÖ6'G2÷¶–GÒö6Æ÷6VÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’÷6†&VBÖ6'G2÷¶–GÒö6æ6VÆÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6†&VBÖ6'G6Â6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6†&VBÖ6'G2÷¶–GÖÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6†&VBÖ6'G2÷¶–GÒöW‡—&VÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6†&VBÖ6'G2÷¶–GÒöæ÷FVÂ6†&VBÖ6'BÂ&÷WFW2÷6†&VBÖ6'Bæ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–ærö6öææV7F÷'6Â6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6÷W&6–ærö6FÆöw2ö–×÷'FÂ6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–ærö6FÆöw6Â6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–ærö6æF–FFW6Â6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷6÷W&6–ærö6æF–FFW2÷¶–GÖÂ6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂUBö’öFÖ–â÷6÷W&6–ærö6æF–FFW2÷¶–GÖÂ6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6÷W&6–ærö6æF–FFW2÷¶–GÒ÷66æÂ6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6÷W&6–ærö6æF–FFW2÷66âÖ&F6†Â6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6÷W&6–ærö6æF–FFW2÷¶–GÒö–×÷'B×&öGV7FÂ6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6÷W&6–ærö6æF–FFW2÷¶–GÒ÷&V¦V7FÂ6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷6÷W&6–ærö6æF–FFW2÷¶–GÒ÷vF6†Æ—7FÂ6÷W&6–ærÂ&÷WFW2÷6÷W&6–ær×66ææW"æ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷6÷W&6–ævÂ6÷W&6–ærÂ&÷WFW2öFÖ–â×6÷W&6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§ÂtUBö’öFÖ–â÷v÷&·76W2÷6÷W&6–ærö–×÷'BÖ6ö6·—FÂ6÷W&6–ærÂ&÷WFW2öFÖ–â×6÷W&6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6÷W&6–ærö–×÷'G6Â6÷W&6–ærÂ&÷WFW2öFÖ–â×6÷W&6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6÷W&6–ær÷6÷W&6W2÷¶–GÒö6FÆörÖ6†ævW2öö'6W'fVÂ6÷W&6–ærÂ&÷WFW2öFÖ–â×6÷W&6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6÷W&6–ær÷6÷W&6W2÷¶–GÒö6&–Æ—F–W2÷¶–GÖÂ6÷W&6–ærÂ&÷WFW2öFÖ–â×6÷W&6–ær×v÷&·76Ræ§6‡&W6öÇfVBÖ÷væVB’À§Âõ5Bö’öFÖ–â÷v÷&·76W2÷6÷W&6–ær÷&öGV7G2÷¶–GÒ÷WFFVÂ6÷VÚ±î¸Â¸­yêë¢°k¢G§¦*^ (resolved-owned) |
| `GET /api/admin/workspaces/sourcing` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `GET /api/admin/workspaces/sourcing/import-cockpit` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/imports` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/sources/{id}/catalog-changes/observe` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/sources/{id}/capabilities/{id}` | sourcing | `routes/admin-sourcing-workspace.js` (resolved-owned) |
| `POST /api/admin/workspaces/sourcing/products/{id}/update` | soum«ëŒ+Š×ž®º+º$zzb¥æÚ±î¸Â¸­yêë¢°k¢G§¦*^` | market-control-plane | documented-signature-no-file |
| `readinessFromGaps()` | `null` | market-control-plane | documented-signature-no-file |
| `provisionMarket()` | `null` | market-control-plane | documented-signature-no-file |
| `reprovisionMarket()` | `null` | market-control-plane | documented-signature-no-file |
| `setMarketLifecycle()` | `null` | market-control-plane | documented-signature-no-file |
| `central()` | `null` | market-control-plane | documented-signature-no-file |
| `overview()` | `null` | market-control-plane | documented-signature-no-file |
| `replaceCeiling` | `services/market-delegation-service.js` | market-delegation | resolved |
| `addMembership` | `services/market-delegation-service.js` | market-delegation | resolved |
| `grantMembershipCapabilities` | `services/market-delegation-service.js` | market-delegation | resolved |
| `replaceMembershipCapabilities` | `services/market-delegation-service.js` | market-delegation | resolved |
| `revokeMembership` | `services/market-delegation-service.js` | market-delegation | resolved |
| `resolveAuthorization` | `services/market-delegation-service.js` | market-delegation | resolved |
| `resolveActiveAssignmentByMarketCode` | `services/market-delegation-service.js` | market-delegation | resolved |
| `projectAssignment` | `services/market-scope-projector.js` | market-delegation | resolved |
| `projectionDrift` | `services/market-scope-projector.js` | market-delegation | resolved |
| `ensureOperatorMembership` | `services/market-operator-provisioning.js` | market-delegation | resolved |
| `grantOperatorScope` | `services/market-operator-provisioning.js` | market-delegation | resolved |
| `attachMarketDelegatedRoleFor` | `middleware/require-market-delegated-role.js` | market-delegation | resolved |
| `inviteTeamMember` | `services/market-delegation-team-service.js` | market-delegation | resolved |
| `acceptInvitation` | `services/market-delegation-team-service.js` | market-delegation | resolved |
| `readMarketCashPolicy` | `services/market-cash-control-policy-service.js` | market-delegation | resolved |
| `updateMarketCashPolicy` | `services/market-cash-control-policy-service.js` | market-delegation | resolved |
| `createRelais` | `services/market-delegation-network-service.js` | market-delegation | resolved |
| `updateRelais` | `services/market-delegation-network-service.js` | market-delegation | resolved |
| `setRelaisActive` | `services/market-delegation-network-service.js` | market-delegation | resolved |
| `createProvider` | `services/market-delegation-provider-service.js` | market-delegation | resolved |
| `updateProvider` | `services/market-delegation-provider-service.js` | market-delegation | resolved |
| `setProviderStatus` | `services/market-delegation-provider-service.js` | market-delegation | resolved |
| `listExposure` | `services/market-delegation-catalog-service.js` | market-delegation | resolved |
| `setExposure` | `services/market-delegation-catalog-service.js` | market-delegation | resolved |
| `listServices` | `services/market-delegation-local-offer-service.js` | market-delegation | resolved |
| `listPhysicalOffers` | `services/market-delegation-local-offer-service.js` | market-delegation | resolved |
| `setServiceExposure` | `services/market-delegation-local-offer-service.js` | market-delegation | resolved |
| `setPhysicalOfferExposure` | `services/market-delegation-local-offer-service.js` | market-delegation | resolved |
| `listDisputes` | `services/market-delegation-client-case-service.js` | market-delegation | resolved |
| `updateDisputeWorkflow` | `services/market-delegation-client-case-service.js` | market-delegation | resolved |
| `listSettlements` | `services/market-delegation-settlement-service.js` | market-delegation | resolved |
| `requestSettlement` | `services/market-delegation-settlement-service.js` | market-delegation | resolved |
| `confirmSettlementReceived` | `services/market-delegation-settlement-service.js` | market-delegation | resolved |
| `listStructureEvents` | `services/market-delegation-structure-event-service.js` | market-delegation | resolved |
| `recordStructureEvent` | `services/market-delegation-structure-event-service.js` | market-delegation | resolved |
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
| `resolveCanonicalSupplierMoney` | `services/purchasing-canonical-money.js` | purchasing | resolved |
| `evaluateSupplierFulfillmentReadiness` | `services/suppliers/supplier-fulfillment-readiness.js` | purchasing | resolved |
| `normalizeCapability` | `services/suppliers/shipping-capability-contract.js` | purchasing | resolved |
| `adaptShippingRate` | `services/suppliers/allegro-shipping-capability-adapter.js` | purchasing | resolved |
| `prepareCanonicalUnitPurchase` | `services/suppliers/canonical-unit-purchasing-gate.js` | purchasing | resolved |
| `compareLegacyCanonicalUnit` | `services/suppliers/canonical-unit-cutover-comparison.js` | purchasing | resolved |
| `reconcile` | `services/suppliers/allegro-purchase-reconciliation.js` | purchasing | resolved |
| `repairOrderedWithoutPurchaseOrders` | `services/repair-ordered-without-purchase-orders.js` | purchasing | resolved |
| `syncPurchaseOrdersOnOrderCancel` | `services/purchasing-cancel-service.js` | purchasing | resolved |
| `submitPurchaseOrder` | `services/purchasing-engagement-service.js` | purchasing | resolved |
| `confirmGroupedPurchaseOrder` | `services/purchasing-engagement-service.js` | purchasing | resolved |
| `settleLine` | `services/purchasing-engagement-service.js` | purchasing | resolved |
| `createManualLine` | `services/purchasing-engagement-service.js` | purchasing | resolved |
| `processRefund(orderOrCartId, reason)` | `null` | refunds | documented-signature-no-file |
| `createReadySettlement()` | `null` | settlement | documented-signature-no-file |
| `listForAssignment()` | `null` | settlement | documented-signature-no-file |
| `requestSettlement()` | `null` | settlement | documented-signature-no-file |
| `markPaid()` | `null` | settlement | documented-signature-no-file |
| `confirmReceived()` | `null` | settlement | documented-signature-no-file |
| `deleteUserBasketData` | `services/shared-cart-user-cleanup.js` | shared-cart | resolved |
| `markShareConvertedToOrder` | `services/cart-share-service.js` | shared-cart | resolved |
| `closeCompletedSharedCartForOrderItems` | `services/cart-share-service.js` | shared-cart | resolved |
| `certifyGateA` | `services/sourcing-certification-gate-a.js` | sourcing | resolved |
| `discoverAcquisitionPlan` | `services/suppliers/aliexpress-discovery.js` | sourcing | resolved |
| `upsertCandidateFromCatalogImport` | `services/sourcing-candidate-import-service.js` | sourcing | resolved |
| `archiveMissingCandidatesFromCatalogImport` | `services/sourcing-candidate-import-service.js` | sourcing | resolved |
| `recordCatalogImportObservationsShadow` | `services/sourcing-observation-shadow-service.js` | sourcing | resolved |
| `recordUnitStockChange` | `services/sourcing-catalog-change-observation.js` | sourcing | resolved |
| `proveExactCanonicalUnitForStockDelta` | `services/sourcing-catalog-change-unit-resolution-proof.js` | sourcing | resolved |
| `proveExactCatalogSkuForStockDelta` | `services/sourcing-catalog-change-sku-identity-proof.js` | sourcing | resolved |
| `resolveCaptureShadow` | `services/sourcing-shadow-resolution-service.js` | sourcing | resolved |
| `collectShadowProof` | `services/sourcing-shadow-proof-service.js` | sourcing | resolved |
| `collectGoldenE2E` | `services/sourcing-golden-e2e-service.js` | sourcing | resolved |
| `collectIntegrityAudit` | `services/sourcing-integrity-service.js` | sourcing | resolved |
| `buildHealthDashboard` | `services/sourcing-integrity-service.js` | sourcing | resolved |
| `buildFinalAuthoritySnapshot` | `services/sourcing-integrity-service.js` | sourcing | resolved |
| `collectCanonicalProductProjections` | `services/sourcing-canonical-product-projection.js` | sourcing | resolved |
| `collectCanonicalOfferProjectionById` | `services/sourcing-canonical-offer-projection.js` | sourcing | resolved |
| `collectCanonicalUnitProjectionById` | `services/sourcing-canonical-unit-projection.js` | sourcing | resolved |
| `resolveCanonicalUnitForProductSku` | `services/sourcing-canonical-unit-product-sku-resolution.js` | sourcing | resolved |
| `compareCanonicalOfferUnitWithLegacy` | `services/sourcing-canonical-offer-unit-comparison.js` | sourcing | resolved |
| `collectCanonicalProductProjectionById` | `services/sourcing-canonical-product-projection.js` | sourcing | resolved |
| `findCanonicalProductIdsForCatalogProduct` | `services/sourcing-catalog-product-linkage.js` | sourcing | resolved |
| `applyCanonicalSourceReadSeam` | `services/catalog-product-read-cutover-trial.js` | sourcing | resolved |
| `collectProductReadComparison` | `services/sourcing-product-read-comparison.js` | sourcing | resolved |
| `collectCatalogProductReadCutoverTrial` | `services/catalog-product-read-cutover-trial.js` | sourcing | resolved |
| `isSupportedProvider` | `services/suppliers/provider-authority.js` | supplier-connectivity | resolved |
| `normalizeProviderCode` | `services/suppliers/provider-authority.js` | supplier-connectivity | resolved |
| `remotePreflightRequirement` | `services/suppliers/provider-authority.js` | supplier-connectivity | resolved |
| `reconciliationRequirement` | `services/suppliers/provider-authority.js` | supplier-connectivity | resolved |
| `normalizeIdentity` | `services/suppliers/supplier-order-identity.js` | supplier-connectivity | resolved |
| `identitiesMatch` | `services/suppliers/supplier-order-identity.js` | supplier-connectivity | resolved |
| `resolveSupplierUnit` | `services/suppliers/supplier-order-identity.js` | supplier-connectivity | resolved |
| `validateAdapter` | `services/suppliers/supplier-fulfillment-adapter-contract.js` | supplier-connectivity | resolved |
| `validateExecutionAdapter` | `services/suppliers/supplier-fulfillment-adapter-contract.js` | supplier-connectivity | resolved |
| `validateReconciliationAdapter` | `services/suppliers/supplier-fulfillment-adapter-contract.js` | supplier-connectivity | resolved |

## Cross-feature dependencies

| Feature | consumes | RÃ©solu ? |
|---|---|---|
| auth | auth-identity (`auth-identity`) | âœ” |
| auth | infrastructure (`infrastructure`) | âœ” |
| auth | notifications (`notifications`) | âœ” |
| auth-identity | orders (`orders (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| auth-identity | loyalty (`loyalty (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| auth-identity | logistics (`logistics (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| auth-identity | catalog (`catalog (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| auth-identity | platform-ops (`platform-ops (monitoring/exploitation transverse observÃ© dans le code)`) | âœ” |
| auth-identity | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| auth-identity | auth (`auth (middleware/auth.js â€” garde authenticate/requireAdmin utilisÃ©e par routes/client-auth.js, routes/auth.js)`) | âœ” |
| auth-identity | auth-passkey (`auth-passkey (middleware/require-recent-auth.js â€” preuve rÃ©cente exigÃ©e par les mutations de sÃ©curitÃ© du profil)`) | âœ” |
| auth-identity | notifications (`notifications (services/notification-service.js â€” envoi OTP/alertes depuis routes/client-auth.js, routes/otp.js)`) | âœ” |
| auth-identity | wallet (`wallet (projection boutique account : b-komerce.js lit uniquement le solde canonique via GET /api/wallet)`) | âœ” |
| auth-identity | documents (`documents (projection boutique account : b-komerce.js liste et tÃ©lÃ©charge les factures et remboursements privÃ©s)`) | âœ” |
| auth-passkey | auth (`auth (middleware/auth.js â€” authenticate, utils/auth-cookie.js â€” setAuthCookie, utils/auth-session.js â€” signAuthToken, politique de session canonique AUTH-8)`) | âœ” |
| auth-passkey | auth-identity (`auth-identity (users â€” identitÃ© utilisateur canonique lue sans mutation)m«ëŒ+Š×ž®º+º$zzb¥æÚ±î¸Â¸­yêë¢°k¢G§¦*^ions (services/notification-service.js â€” envoi OTP/alertes depuis routes/client-auth.js, routes/otp.js)`) | âœ” |
| auth-identity | wallet (`wallet (projection boutique account : b-komerce.js lit uniquement le solde canonique via GET /api/wallet)`) | âœ” |
| auth-identity | documents (`documents (projection boutique account : b-komerce.js liste et tÃ©lÃ©charge les factures et remboursements privÃ©s)`) | âœ” |
| auth-passkey | auth (`auth (middleware/auth.js â€” authenticate, utils/auth-cookie.js â€” setAuthCookie, utils/auth-session.js â€” signAuthToken, politique de session canonique AUTH-8)`) | âœ” |
| auth-passkey | auth-identity (`auth-identity (users â€” identitÃ© utilisateur canonique lue sans mutation)market_scopes`) | âœ” |
| market-autonomy | economic-engine (`economic-engine â€” CDR, politique marchÃ© et gate de couverture`) | âœ” |
| market-autonomy | catalog (`catalog â€” products/SKU en lecture ; le prix global reste inchangÃ©`) | âœ” |
| market-autonomy | infrastructure (`infrastructure â€” db.js pour transaction et audit`) | âœ” |
| market-autonomy | market-delegation (`market-delegation â€” memberships, capabilities team.*, provider.manage, cash_control.policy.manage et acceptation dâ€™invitation ; lâ€™UI nâ€™invente aucune autoritÃ©`) | âœ” |
| market-autonomy | auth-identity (`auth-identity â€” crÃ©ation optionnelle dâ€™un compte client depuis le lien dâ€™invitation avant acceptation explicite`) | âœ” |
| market-control-plane | orders (`orders (commandes rÃ©elles collectÃ©es lues pour la base HISTORY de la preuve de livrabilitÃ© : simulation_scope IS NULL)`) | âœ” |
| market-control-plane | market (`market (markets comme rÃ©fÃ©rentiel lu)`) | âœ” |
| market-control-plane | market-delegation (`market-delegation (affectation, Ã©quipe, plafond, politique de caisse lus ; normalizeMarketCode)`) | âœ” |
| market-control-plane | providers-services (`providers-services (fournisseurs de paiement du marchÃ© lus)`) | âœ” |
| market-control-plane | payments (`payments (configuration initiale du provider paiement via le writer canonique market-payment-provider-config-service)`) | âœ” |
| market-control-plane | logistics (`logistics (relais lus)`) | âœ” |
| market-control-plane | dashboard (`dashboard (dashboard_global_access_grants et require-dashboard-global-authority : autorisation centrale explicite lue)`) | âœ” |
| market-control-plane | catalog (`catalog (catalog_global_access_grants et require-catalog-global-authority : autorisation centrale explicite lue)`) | âœ” |
| market-control-plane | decision-signals (`decision-signals (decision_signal_global_access_grants et son middleware : autorisation centrale explicite lue)`) | âœ” |
| market-control-plane | economic-engine (`economic-engine (pricing_global_access_grants et require-pricing-global-authority : autorisation centrale explicite lue)`) | âœ” |
| market-control-plane | sourcing (`sourcing (sourcing_global_access_grants et require-sourcing-global-authority : autorisation centrale explicite lue)`) | âœ” |
| market-control-plane | auth (`auth (garde des routes centrales)`) | âœ” |
| market-control-plane | infrastructure (`infrastructure (DB et bootstrap)`) | âœ” |
| market-delegation | local-stock (`local-stock`) | âœ” |
| market-delegation | market (`market`) | âœ” |
| market-delegation | auth (`auth`) | âœ” |
| market-delegation | auth-identity (`auth-identity`) | âœ” |
| market-delegation | infrastructure (`infrastructure`) | âœ” |
| market-delegation | logistics (`logistics`) | âœ” |
| market-delegation | catalog (`catalog`) | âœ” |
| market-delegation | providers-services (`providers-services`) | âœ” |
| market-delegation | orders (`orders`) | âœ” |
| market-delegation | settlement (`settlement`) | âœ” |
| market-delegation | economic-engine (`economic-engine`) | âœ” |
| market-delegation | market-autonomy (`market-autonomy`) | âœ” |
| market-delegation | dashboard (`dashboard`) | âœ” |
| market-delegation | payments (`payments`) | âœ” |
| market-operator-dashboard | market (`market (markets, Currency Boundary ; operator_market_scopes uniquement comme projection de compatibilitÃ© des surfaces non encore migrÃ©es)`) | âœ” |
| market-operator-dashboard | auth (`auth (authenticate, requireRole + capabilities market-scoped)`) | âœ” |
| market-operator-dashboard | dashboard (`dashboard (admin-dashboard-market routes, admin-context, canonical navigation/app.js, operations workspace, admin-finance-accounting-workspace â€” projection Finance pays et actions explicitement dÃ©lÃ©guÃ©es, jamais autoritÃ© globale implicite)`) | âœ” |
| market-operator-dashboard | catalog (`catalog (vÃ©ritÃ© globale en lecture si nÃ©cessaire + projection/configuration product_market_exposure via son service owner)`) | âœ” |
| market-operator-dashboard | market-autonomy (`market-autonomy (dÃ©cision locale DRAFT_PENDING_GATE via market-commercial-price-service ; aucun LOCAL_ACTIVE forcÃ©)`) | âœ” |
| market-operator-dashboard | orders (`orders (commandes et order_items market-scoped)`) | âœ” |
| market-operator-dashboard | logistics (`logistics (Hub/Relais, expÃ©ditions, douane et primitives de suivi market-scoped)`) | âœ” |
| market-operator-dashboard | market-delegation (`market-delegation (services/market-delegation-service.js + services/market-scope-projector.js â€” autoritÃ© canonique assignment/membership/capabilities et projectAssignment(), consommÃ©es par scripts/provision-market-operator.js pour ne plus jamais Ã©crire operator_market_scopes directement)`) | âœ” |
| market-operator-dashboard | infrastructure (`infrastructure (db.js â€” pool utilisÃ© par les scripts de provisioning et de seed staging)`) | âœ” |
| notifications | orders (`orders (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| notifications | logistics (`logistics (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| notifications | auth-identity (`auth-identity (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| notifications | incident-management (`incident-management (incident persistence via incident-write-service)`) | âœ” |
| notifications | platform-ops (`platform-ops (monitoring/exploitation transverse observÃ© dans le code)`) | âœ” |
| notifications | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| notifications | auth (`auth (FF-C1 2026-07-29 â€” garde de route et contexte dâ€™identitÃ© ; preuve: routes/notification-api.js -> middleware/auth.js ; routes/alerts.js -> middleware/auth.js)`) | âœ” |
| orders | dashboard (`dashboard (RCT1 canonical projection reuses dashboard-orders LIFECYCLE read-only contract; service dashboard-rct1-orders.js -> services/dashboard-orders.js)`) | âœ” |
| orders | market-control-plane (`market-control-plane (destination relais actif : marchÃ© de rattachement et disponibilitÃ© du relais validÃ©s au checkout ; attestation transporteur non requise)`) | âœ” |
| orders | market-delegation (`market-delegation (order-read-authorization.js consulte operations.read pour borner les dÃ©tails de commande au marchÃ© dÃ©lÃ©guÃ© ; aucune capability ou identitÃ© reÃ§ue du client nâ€™est une preuve)`) | âœ” |
| orders | platform-ops (`platform-ops (monitoring/exploitation transverse observÃ© dans le code)`) | âœ” |
| orders | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| orders | decision-signals (`decision-signals (sink durable Action Center pour le signal de clÃ´ture financiÃ¨re en attente des faits Ã©conomiques via signal-service)`) | âœ” |
| orders | incident-management (`incident-management (G6-CLEANUP : crÃ©ation gouvernÃ©e dâ€™un incident de quarantaine pour chaque unitÃ© physique conservÃ©e au Hub, via incident-write-service)`) | âœ” |
| orders | business-rules (`business-rules (FF-C1 2026-07-29 â€” lecture du rÃ©fÃ©rentiel de rÃ¨gles mÃ©tier ; preuve: routes/orders/create.js -> utils/rules.js ; routes/orders/qr.js -> utils/rules.js ; routes/orders/list.js -> utils/rules.js ; +1)`) | âœ” |
| orders | wallet (`wallet (application credit)`) | âœ” |
| orders | economic-engine (`economic-engine (cout figure a la commande)`) | âœ” |
| orders | logistics (`logistics (rattachement colis ; couverture physique de rÃ©ception : order-physical-coverage-service, gate C2 vers preparation)`) | âœ” |
| orders | catalog (`catalog (lecture produit)`) | âœ” |
| orders | market-autonomy (`market-autonomy (prix LOCAL_ACTIVE rÃ©solu depuis le market_id serveur du relais avant snapshot de commande)`) | âœ” |
| orders | local-stock (`local-stock (Vague 2 D2 â€” allocateForOrderItem Ã  la crÃ©ation de commande, consumeAllocationsForOrder/releaseAllocationsForOrder sur les transitions confirmed/cancelled ; preuve: routes/orders/create.js -> services/local-stock-service.js ; services/order-status-machine.js -> services/local-stock-service.js)`) | âœ” |
| orders | market (`market (F4 â€” le checkout vÃ©rifie lifecycle_status depuis relais.market_id serveur et refuse toute commande hors ACTIVE ; P3 â€” resolveDisplaySnapshot() rÃ©sout le contexte marchÃ© du client via utils/currency.js ; preuve: services/order-display-snapshot.js -> utils/currency.js)`) | âœ” |
| orders | purchasing (`purchasing (engagement fournisseur + sync annulation via syncPurchaseOrdersOnOrderCancel ; aucun SQL direct orders -> purchase_orders)`) | âœ” |
| orders | loyalty (`loyalty (remise palier au checkout + recalcul apres commande â€” services/loyalty-service.js getLoyaltyDiscount/recalculateLoyalty, O7.3 provider loyalty)`) | âœ” |
| orders | payments (`payments (marque un remboursement â€” services/payment-service.js markRefunded, O7.3 provider payments)`) | âœ” |
| orders | auth (`auth`) | âœ” |
| orders | auth-identity (`auth-identity (projection checkout boutique : identitÃ© client et tÃ©lÃ©phone)`) | âœ” |
| orders | customs (`customs`) | âœ” |
| orders | documents (`documents`) | âœ” |
| orders | notifications (`notifications (projection idempotente du retrait disponible)`) | âœ” |
| orders | refunds (`refunds`) | âœ” |
| orders | shared-cart (`shared-cart (projection frontend orders-client uniquement : consommation via shared-cart-surface-api.js / shared-cart-library-api.js ; aucun import direct des internes group/* ; cÃ´tÃ© backend, appelle services/cart-share-service.js markShareConvertedToOrder pour lier une commande Ã  un lien de partage â€” campagne WRITER-NOT-OWNER 2026-08, plus de SQL direct sur cart_shares)`) | âœ” |
| payments | auth-identity (`auth-identity (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| payments | incident-management (`incident-management (incident persistence via incident-write-service)`) | âœ” |
| payments | infrastructure (`infrastructure (DB, logger, Currency Boundary et bootstrap)`) | âœ” |
| payments | platform-ops (`platform-ops (monitoring et exploitation technique)`) | âœ” |
| payments | auth (`auth (garde de route et contexte identitÃ©)`) | âœ” |
| payments | refunds (`refunds (orchestration du remboursement)`) | âœ” |
| payments | documents (`documents (Ã©mission facture/reÃ§u)`) | âœ” |
| payments | notifications (`notifications (Ã©mission de message)`) | âœ” |
| payments | business-rules (`business-rules (lecture du rÃ©fÃ©rentiel de rÃ¨gles mÃ©tier)`) | âœ” |
| payments | orders (`orders (commande a payer et point d entrÃ©e unique payment -> stock)`) | âœ” |
| payments | market (`market (market_id et devise native du rail)`) | âœ” |
| payments | logistics (`logistics (generation du code retrait pickup au moment du paiement)`) | âœ” |
| payments | loyalty (`loyalty (recalcul de palier apres paiement confirme)`) | âœ” |
| payments | purchasing (`purchasing (verification/reapprovisionnement apres encaissement)`) | âœ” |
| payments | market-delegation (`market-delegation (politique de contrÃ´le cash du partenaire ; payments reste propriÃ©taire de la vÃ©ritÃ© dâ€™encaissement)`) | âœ” |
| platform-ops | documents (`documents (dÃ©pendance data cross-feature observÃ©e et gouvernÃ©e par O5)`) | âœ” |
| platform-ops | incident-management (`incident-management (incident persistence via incident-write-service)`) | âœ” |
| platform-ops | purchasing (`purchasing (client API transversal appelle le rÃ©fÃ©rentiel fournisseurs /api/purchasing/suppliers)`) | âœ” |
| platform-ops | catalog (`catalog (shell/client API transversal monte et appelle les surfaces catalogue sans en possÃ©der lâ€™Ã©tat)`) | âœ” |
| platform-ops | auth-identity (`auth-identity (client API transversal et shell identitÃ© consomment les endpoints auth)`) | âœ” |
| platform-ops | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| platform-ops | business-rules (`business-rules (FF-C1 2026-07-29 â€” lecture du rÃ©fÃ©rentiel de rÃ¨gles mÃ©tier ; preuve: roum«ëŒ+Š×ž®º+º$zzb¥æÚ±î¸Â¸­yêë¢°k¢G§¦*^tes/config.js -> utils/rules.js)`) | âœ” |
| platform-ops | auth (`auth (FF-C1 2026-07-29 â€” garde de route et contexte dâ€™identitÃ© ; preuve: routes/modules.js -> middleware/auth.js ; routes/health.js -> middleware/auth.js ; routes/ops-api.js -> middleware/auth.js ; +2)`) | âœ” |
| platform-ops | economic-engine (`economic-engine (calcul de prix ponctuel pour modules sur-mesure â€” services/pricing-engine.js recommend, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)`) | âœ” |
| platform-ops | logistics (`logistics (simulateur declenche une transition colis via transitionParcelStatus â€” services/parcel-operations.js, O7.1 OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED, boundary formalisee O7.3)`) | âœ” |
| platform-ops | orders (`orders (simulateur dÃ©lÃ¨gue statuts commande/paiement Ã  order-status-machine + payment-service ; le chaos payment reste non-production et owner-bound)`) | âœ” |
| platform-ops | wallet (`wallet (simulateur crÃ©dite les remboursements via wallet-service.credit ; aucun store_credits legacy direct)`) | âœ” |
| providers-services | auth (`auth â€” authenticateOrCreateGuest et session canonique cÃ´tÃ© serveur`) | âœ” |
| providers-services | auth-identity (`auth-identity â€” requireIdentity() cÃ´tÃ© Boutique avant mutation`) | âœ” |
| providers-services | platform-ops (`platform-ops â€” bus et showToast comme primitives UI transverses`) | âœ” |
| providers-services | market (`market â€” rÃ©fÃ©rentiel markets, rÃ©solution code -> id cÃ´tÃ© serveur`) | âœ” |
| providers-services | local-stock (`local-stock â€” dÃ©claration et exposition du stock local Product Komerce du seed Discovery staging via les primitives owner`) | âœ” |
| providers-services | recommendations (`recommendations â€” rÃ©utilise le tooling Discovery CJ pour construire les candidats staging ; recommendations reste propriÃ©taire de la sÃ©lection et de l ordre Ã©ditorial`) | âœ” |
| providers-services | infrastructure (`infrastructure â€” dÃ©pendance technique db.js et rÃ©solution KOMERCE_ENV`) | âœ” |
| purchasing | documents (`documents (rendu PDF interne du bon de commande validÃ©)`) | âœ” |
| purchasing | supplier-connectivity (`supplier-connectivity (autoritÃ© provider, Supplier Order Identity opaque et contrats adapter fail-closed)`) | âœ” |
| purchasing | external-provider-contracts (`external-provider-contracts (contrat transverse de preuve provider : Conversation + KNOWN/DERIVED/UNKNOWN + P0..P4 consommÃ© par les proofs Purchasing)`) | âœ” |
| purchasing | sourcing (`sourcing (resolveCanonicalUnitForProductSku â€” frontiÃ¨re canonique exacte, sans lecture directe des tables Resolution)`) | âœ” |
| purchasing | catalog (`catalog (contrat V2 sellable_units + Supplier Order Identity fournie par les connecteurs, client Allegro Sandbox bornÃ©)`) | âœ” |
| purchasing | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| purchasing | orders (`orders (lecture : order_items, orders â€” le besoin d'achat et l'intention d'annulation naissent d'une commande client)`) | âœ” |
| purchasing | auth (`auth (garde admin)`) | âœ” |
| purchasing | economic-engine (`economic-engine (A8 : rafraÃ®chissement transactionnel de la marge rÃ©elle canonique via canonical-margin-writer ; no-op si la rÃ¨gle CANONICAL_MARGIN_WRITER_ENABLED vaut 0)`) | âœ” |
| purchasing | notifications (`notifications (notification fournisseur WhatsApp, via services/notification-service.js)`) | âœ” |
| purchasing | incident-management (`incident-management (H1 : incident Â« rupture fournisseur Â» Ã  la clÃ´ture d'une ligne sans reliquat, via createSupplierShortageIncident du boundary incident-write-service)`) | âœ” |
| purchasing | logistics (`logistics (declenche scan preparation + notification client apres reception hub complete â€” services/scan-operations.js triggerScan3, O7.2 Cycle C)`) | âœ” |
| recommendations | catalog (`catalog (lecture produit)`) | âœ” |
| recommendations | catalog (`catalog â€” getExposure() pour aligner les Product cards sur product_market_exposure du marchÃ©`) | âœ” |
| recommendations | market-autonomy (`market-autonomy â€” resolveActiveProductMarketPricing() pour nâ€™exposer quâ€™un prix LOCAL_ACTIVE buyer-effective`) | âœ” |
| recommendations | platform-ops (`platform-ops (monitoring/exploitation transverse observÃ© dans le code)`) | âœ” |
| recommendations | infrastructure (`infrastructure (DB et composition root)`) | âœ” |
| recommendations | logistics (`logistics`) | âœ” |
| recommendations | orders (`orders (frontiÃ¨re frontend orders-client/cart-public-api.js consommÃ©e par b-modal-suggestions.js)`) | âœ” |
| recommendations | market (`market (rÃ©fÃ©rentiel markets â€” rÃ©solution code -> id cÃ´tÃ© serveur)`) | âœ” |
| recommendations | local-stock (`local-stock â€” isStockExposable() pour la carte product du rail Discovery`) | âœ” |
| recommendations | providers-services (`providers-services â€” isServiceExposable()/getService()/isPhysicalOfferExposable()/getPhysicalOffer() pour les cartes tierces`) | âœ” |
| refunds | market (`market (prorata SAV dans les devises figÃ©es via fx-authority)`) | âœ” |
| refunds | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| refunds | orders (`orders (commande source)`) | âœ” |
| refunds | logistics (`logistics (attestation physique du manquant au relais ; source incident immuable)`) | âœ” |
| refunds | payments (`payments (capture PSP, intention durable et rÃ©conciliation du remboursement en EUR)`) | âœ” |
| refunds | wallet (`wallet (credit)`) | âœ” |
| refunds | documents (`documents (reÃ§u)`) | âœ” |
| refunds | notifications (`notifications (alerte critique de rapprochement de remboursement PSP incertain)`) | âœ” |
| refunds | economic-engine (`economic-engine (A8 : rafraÃ®chissement transactionnel de la marge rÃ©elle canonique via canonical-margin-writer ; no-op si la rÃ¨gle CANONICAL_MARGIN_WRITER_ENABLED vaut 0)`) | âœ” |
| settlement | market (`market (markets.currency comme devise native du snapshot)`) | âœ” |
| settlement | market-delegation (`market-delegation (Market Operating Assignment comme principal payable et boundary consommatrice du lifecycle)`) | âœ” |
| settlement | auth (`auth (garde des routes centrales)`) | âœ” |
| settlement | auth-identity (`auth-identity (users comme identitÃ© des acteurs attestant/demandant/payant/recevant)`) | âœ” |
| settlement | infrastructure (`infrastructure (DB et bootstrap)`) | âœ” |
| shared-cart | recommendations (`recommendations (modal partagÃ© consomme suggestions via interface /api/boutique/suggestions)`) | âœ” |
| shared-cart | platform-ops (`platform-ops (monitoring/exploitation transverse observÃ© dans le code)`) | âœ” |
| shared-cart | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| shared-cart | orders (`orders (arbitrage de la rÃ©clamation via order_items.shared_cart_item_id â€” feature orders, migration 123)`) | âœ” |
| shared-cart | catalog (`catalog (lecture seule des produits)`) | âœ” |
| shared-cart | market-autonomy (`market-autonomy (prix LOCAL_ACTIVE du marchÃ© serveur lors de la crÃ©ation de liste ; aucune autoritÃ© marchÃ© navigateur)`) | âœ” |
| shared-cart | notifications (`notifications (Ã©mission uniquement â€” WhatsApp crÃ©ation de liste)`) | âœ” |
| shared-cart | auth (`auth`) | âœ” |
| shared-cart | auth-identity (`auth-identity (projection boutique : b-share-cart.js consomme identitÃ© et tÃ©lÃ©phone)`) | âœ” |
| sourcing | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| sourcing | catalog (`catalog (connecteurs fournisseur, catalog-import-orchestrator, catalog-enrichment, supplier-catalog-scanner pour le scan pricing, catalog-candidate-product-service pour crÃ©er le brouillon products, et catalog-promotion.js pour promouvoir normalized_source_contract V2 vers catalog_media/product_variants/product_skus/product_sku_media dans la transaction de POST .../import-product)`) | âœ” |
| sourcing | purchasing (`purchasing (rÃ©fÃ©rentiel de fournisseurs dâ€™approvisionnement ; Sourcing transmet lâ€™affectation Ã  la candidature sans crÃ©er ni modifier de PO)`) | âœ” |
| sourcing | economic-engine (`economic-engine (pricing-engine.loadGlobalConfig â€” config de scan)`) | âœ” |
| sourcing | customs (`customs (customs-dynamic-category-classifier : score des catÃ©gories actives pour suggestions Sourcing, lecture uniquement ; aucune clÃ© codÃ©e en dur)`) | âœ” |
| sourcing | auth (`auth`) | âœ” |
| sourcing | dashboard (`dashboard (registre partenaires partagÃ© via partner-admin-service ; 4E filtre strictement partner_type=sourcing)`) | âœ” |
| supplier-connectivity | external-provider-contracts (`external-provider-contracts (mÃ©thode transverse de qualification et de preuve P0â†’P4 avant dÃ©claration d une capability provider)`) | âœ” |
| unsold-resolution | orders (`orders (commande source de l'invendu)`) | âœ” |
| unsold-resolution | catalog (`catalog (produit concernÃ©)`) | âœ” |
| unsold-resolution | auth (`auth`) | âœ” |
| unsold-resolution | market-delegation (`market-delegation`) | âœ” |
| unsold-resolution | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| wallet | market (`market (2026-11-13 #3927 â€” conversion KMFâ†”devise du marchÃ© via la seule autoritÃ© fx-authority/currency_parities ; preuve: services/wallet-service.js -> services/fx-authority.js)`) | âœ” |
| wallet | orders (`orders (persistence via order-mutation-service ? LOT11)`) | âœ” |
| wallet | platform-ops (`platform-ops (monitoring/exploitation transverse observÃ© dans le code)`) | âœ” |
| wallet | infrastructure (`infrastructure (dÃ©pendance technique transversale observÃ©e : DB, logger, helpers ou bootstrap possÃ©dÃ©s par infrastructure)`) | âœ” |
| wallet | auth (`auth (FF-C1 2026-07-29 â€” garde de route et contexte dâ€™identitÃ© ; preuve: routes/wallet.js -> middleware/auth.js)`) | âœ” |
| wallet | documents (`documents (FF-C1 2026-07-29 â€” Ã©mission ou lecture documentaire ; preuve: services/wallet-service.js -> services/documents/wallet-receipt.js ; routes/wallet.js -> services/documents/wallet-receipt.js)`) | âœ” |
| wallet | auth-identity (`auth-identity (identification du client)`) | âœ” |
| admin-dashboard | catalog (`catalog`) | âœ” |
| admin-dashboard | customs (`customs`) | âœ” |
| admin-dashboard | dashboard (`dashboard`) | âœ” |
| admin-dashboard | decision-signals (`decision-signals`) | âœ” |
| admin-dashboard | documents (`documents`) | âœ” |
| admin-dashboard | economic-engine (`economic-engine`) | âœ” |
| admin-dashboard | inventory (`inventory`) | âœ” |
| admin-dashboard | logistics (`logistics`) | âœ” |
| admin-dashboard | orders (`orders`) | âœ” |
| admin-dashboard | payments (`payments`) | âœ” |
| admin-dashboard | sourcing (`sourcing`) | âœ” |
| decision-signals | auth (`auth (garde de route et contexte dâ€™identitÃ©)`) | âœ” |
| decision-signals | infrastructure (`infrastructure (acces DB et transaction partagÃ©e)`) | âœ” |
| decision-signals | logistics (`logistics (lecture ou orchestration logistique)`) | âœ” |
| decision-signals | purchasing (`purchasing (lecture de la population canonique supplier_payment_review ; aucune mutation du paiement fournisseur)`) | âœ” |
| decision-signals | business-rules (`business-rules (lecture du referentiel de regles metier)`) | âœ” |
| decision-signals | market-delegation (`market-delegation (resolution serveur du Market ID, capability dashboard.market.read / decision_signal.manage et audit des mutations pays)`) | âœ” |
| decision-signals | payments (`payments (services/cash-deposit-service.js â€” couverture cash canonique UNCOVERED_COLLECTIONS_CTE : seul un depot verifie couvre un encaissement ; lecture seule, aucune mutation de depot)`) | âœ” |
| decision-signals | economic-engine (`economic-engine (services/financial-journal-reporting.js â€” lecture seule de la rÃ©conciliation du journal financier pour le signal financial_journal_gap ; aucune Ã©criture du journal)`) | âœ” |
| decision-signals | dashboard (`dashboard (services/signal-simulation-scope.js â€” predicat reel/RCT1 partage : les signaux de commandes de simulation sont exclus de l'Action Center et du compteur radar ; lecture seule)`) | âœ” |

## Drifts

### ERROR (0)

- none

### DETTE / DRIFT ACTIONNABLE (6)

Seules INVALID_DECLARATION, ACTIONABLE_DRIFT et KNOWN_DEBT constituent de la dette gouvernance. Les topologies attendues et limites du gÃ©nÃ©rateur restent visibles sÃ©parÃ©ment et ne consomment aucun budget de dette.

- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ order_item_real_cost_allocations â€” table "order_item_real_cost_allocations" : lifecycle owner = economic-engine (db.tables "!"), mais aussi Ã©crite par customs
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ order_items â€” table "order_items" : lifecycle owner = orders (db.tables "!"), mais aussi Ã©crite par logistics
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ orders â€” table "orders" : lifecycle owner = orders (db.tables "!"), mais aussi Ã©crite par economic-engine
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ products â€” table "products" : lifecycle owner = catalog (db.tables "!"), mais aussi Ã©crite par logistics
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ signals â€” table "signals" : lifecycle owner = decision-signals (db.tables "!"), mais aussi Ã©crite par orders
- **[WRITER-NOT-OWNER]** _[KNOWN_DEBT]_ sourcing_candidates â€” table "sourcing_candidates" : lifecycle owner = sourcing (db.tables "!"), mais aussi Ã©crite par catalog

### TOPOLOGIE ATTENDUE â€” hors dette (47)

- **[DASH-MANIFEST-DUPLICATE-COPY]** admin-dashboard â€” "public/features/admin-dashboard.feature.js" est une copie dÃ©clarÃ©e de "public/dashboards/features/admin-dashboard.feature.js" (APP_FEATURE_REGISTRY.md) â€” non chargÃ©e comme nÅ“ud sÃ©parÃ©, rÃ©solue uniquement contre le canonique
- **[DASH-MANIFEST-DUPLICATE-COPY]** legacy-control-tower â€” "public/features/legacy-control-tower.feature.js" est une copie dÃ©clarÃ©e de "public/dashboards/features/legacy-control-tower.feature.js" (APP_FEATURE_REGISTRY.md) â€” non chargÃ©e comme nÅ“ud sÃ©parÃ©, rÃ©solue uniquement contre le canonique
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** dashboard -> loyalty â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "dashboard" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** dashboard -> platform â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "dashboard" vers "platform"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> autheatures/legacy-control-tower.feature.js" est une copie dÃ©clarÃ©e de "public/dashboards/features/legacy-control-tower.feature.js" (APP_FEATURE_REGISTRY.md) â€” non chargÃ©e comme nÅ“ud sÃ©parÃ©, rÃ©solue uniquement contre le canonique
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** dashboard -> loyalty â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "dashboard" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** dashboard -> platform â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "dashboard" vers "platform"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> auth-passkey â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "auth-passkey"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> business-rules â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 2 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "business-rules"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> decision-signals â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 4 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "decision-signals"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> documents â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 2 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "documents"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> incident-management â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "incident-management"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> local-stock â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 2 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "local-stock"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> loyalty â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 2 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "loyalty"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> market-control-plane â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "market-control-plane"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> providers-services â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 2 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "providers-services"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> purchasing â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 4 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "purchasing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> settlement â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "settlement"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> sourcing â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 2 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "sourcing"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** infrastructure -> unsold-resolution â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "infrastructure" vers "unsold-resolution"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** inventory -> payments â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 1 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "inventory" vers "payments"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** logistics -> dashboard â€” dÃ©pendance cross-feature observÃ©e (canal: static-code, 2 preuve(s)) sans contract.consumes dÃ©clarÃ© chez "logistics" vers "dashboard"
- **[OBSERVED-UNDECLARED-FEATURE-DEPENDENCY]** logistics -> economic-engine â€” dÃ©pendance cross-fem«ëŒ+Š×ž®º+º$zzb¥