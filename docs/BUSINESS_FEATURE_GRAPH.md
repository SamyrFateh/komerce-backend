Warning: truncated output (original token count: 63155)
Total output lines: 2914

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
| backend | 36 | 36 | 716 | 716 | 0 |
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
- services: 87
- schemas: 5
- migrations: 26
- config: 1
- docs: 19
- routes: 7
- boutique: 39
- dash: 1
- tests: 210
- tables owned (lifecycle): 26 — `products`, `boutique_categories`, `boutique_subcategories`, `catalog_taxonomy_audit`, `catalog_field_overrides`, `catalog_terminology_reference`, `catalog_enrichment_runs`, `catalog_media`, `catalog_media_recovery_audit`, `product_skus`, `product_sku_media`, `product_variants`, `product_content_profile`, `product_content_sections`, `product_market_exposure`, `product_attributes`, `supplier_catalog_imports`, `supplier_catalog_sync_checkpoints`, `supplier_oauth_connections`, `catalog_field_sync_state`, `catalog_media_visual_fr_reviews`, `catalog_publication_decision_audit`, `catalog_product_sale_holds`, `catalog_product_quality_notes`, `catalog_stock_sync_state`, `supplier_catalog_import_rejections`
- tables written: 27
- interfaces exposed: 47
- internal APIs: 10
- dependencies (consumes): 18 — external-provider-contracts, sourcing, notifications, auth-identity, platform-ops, infrastructure, business-rules, economic-engine, customs, market-autonomy, market, sourcing, supplier-connectivity, purchasing, logistics, shared-cart, auth, orders
- consumers: 22 — auth-identity, customs, dashboard, documents, economic-engine, infrastructure, inventory, local-stock, logistics, market-autonomy, market-control-plane, market-delegation, market-operator-dashboard, orders, platform-ops, purchasing, recommendations, recommendations, shared-cart, sourcing, unsold-resolution, admin-dashboard

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
- services: 46
- routes: 28
- migrations: 2
- dash: 192
- tests: 213
- tables owned (lifecycle): 3 — `customs_shipment_holds`, `order_incidents`, `partners`
- tables written: 21
- interfaces exposed: 88
- internal APIs: 0
- dependencies (consumes): 27 — shared-cart, incident-management, orders, infrastructure, payments, refunds, logistics, inventory, local-stock, economic-engine, wallet, auth, auth-identity, market-delegation, customs, documents, notifications, purchasing, supplier-connectivity, external-provider-contracts, business-rules, decision-signals, market, market-delegation, sourcing, catalog, market-autonomy
- consumers: 9 — economic-engine, infrastructure, market-control-plane, market-delegation, market-operator-dashboard, orders, sourcing, admin-dashboard, decision-signals

### decision-signals _(piloting-capability)_

> Detecter et qualifier des signaux operationnels et economiques a partir des donnees canoni…57155 tokens truncated…auth | static-code | 2 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | catalog | data-read | 1 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | infrastructure | static-code | 2 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | market-delegation | static-code | 1 | **DECLARED_AND_OBSERVED** |
| unsold-resolution | orders | data-read | 1 | **DECLARED_AND_OBSERVED** |
| wallet | auth | static-code | 1 | **DECLARED_AND_OBSERVED** |
| wallet | auth-identity | static-code, data-read | 3 | **DECLARED_AND_OBSERVED** |
| wallet | documents | static-code | 4 | **DECLARED_AND_OBSERVED** |
| wallet | infrastructure | static-code | 8 | **DECLARED_AND_OBSERVED** |
| wallet | market | static-code | 1 | **DECLARED_AND_OBSERVED** |
| wallet | notifications | static-code | 1 | **OBSERVED_UNDECLARED** |
| wallet | orders | static-code, data-read | 5 | **DECLARED_AND_OBSERVED** |
| wallet | platform-ops | static-code | 2 | **DECLARED_AND_OBSERVED** |

### Observed undeclared dependencies

- `dashboard` → `loyalty` (canaux: static-code)
- `dashboard` → `platform` (canaux: static-code)
- `infrastructure` → `auth-passkey` (canaux: static-code)
- `infrastructure` → `business-rules` (canaux: static-code)
- `infrastructure` → `decision-signals` (canaux: static-code)
- `infrastructure` → `documents` (canaux: static-code)
- `infrastructure` → `incident-management` (canaux: static-code)
- `infrastructure` → `local-stock` (canaux: static-code)
- `infrastructure` → `loyalty` (canaux: static-code)
- `infrastructure` → `market-control-plane` (canaux: static-code)
- `infrastructure` → `providers-services` (canaux: static-code)
- `infrastructure` → `purchasing` (canaux: static-code)
- `infrastructure` → `settlement` (canaux: static-code)
- `infrastructure` → `sourcing` (canaux: static-code)
- `infrastructure` → `unsold-resolution` (canaux: static-code)
- `inventory` → `payments` (canaux: static-code)
- `logistics` → `dashboard` (canaux: static-code)
- `logistics` → `economic-engine` (canaux: static-code)
- `loyalty` → `logistics` (canaux: static-code)
- `market` → `customs` (canaux: static-code)
- `market` → `dashboard` (canaux: static-code)
- `market` → `market-delegation` (canaux: static-code)
- `market` → `orders` (canaux: static-code)
- `market-autonomy` → `market-control-plane` (canaux: static-code)
- `market-delegation` → `market-operator-dashboard` (canaux: static-code)
- `platform-ops` → `auth-passkey` (canaux: static-code)
- `platform-ops` → `notifications` (canaux: static-code)
- `platform-ops` → `payments` (canaux: static-code)
- `platform-ops` → `providers-services` (canaux: static-code)
- `platform-ops` → `recommendations` (canaux: static-code)
- `platform-ops` → `shared-cart` (canaux: static-code)
- `purchasing` → `decision-signals` (canaux: static-code)
- `purchasing` → `refunds` (canaux: static-code)
- `refunds` → `auth` (canaux: static-code)
- `supplier-connectivity` → `purchasing` (canaux: static-code)
- `wallet` → `notifications` (canaux: static-code)

### Declared without observed evidence (canal A/D uniquement — ne signifie pas "dépendance inexistante")

- `external-provider-contracts` → `infrastructure` (déclaré : `infrastructure — runtime Node et primitives techniques uniquement ; aucune vérité métier externe n est déléguée à infrastructure`)
- `market-autonomy` → `market-delegation` (déclaré : `market-delegation — memberships, capabilities team.*, provider.manage, cash_control.policy.manage et acceptation d’invitation ; l’UI n’invente aucune autorité`)
- `market-autonomy` → `auth-identity` (déclaré : `auth-identity — création optionnelle d’un compte client depuis le lien d’invitation avant acceptation explicite`)
- `market-control-plane` → `providers-services` (déclaré : `providers-services (fournisseurs de paiement du marché lus)`)
- `market-operator-dashboard` → `auth` (déclaré : `auth (authenticate, requireRole + capabilities market-scoped)`)
- `market-operator-dashboard` → `dashboard` (déclaré : `dashboard (admin-dashboard-market routes, admin-context, canonical navigation/app.js, operations workspace, admin-finance-accounting-workspace — projection Finance pays et actions explicitement déléguées, jamais autorité globale implicite)`)
- `market-operator-dashboard` → `orders` (déclaré : `orders (commandes et order_items market-scoped)`)
- `market-operator-dashboard` → `logistics` (déclaré : `logistics (Hub/Relais, expéditions, douane et primitives de suivi market-scoped)`)
- `orders` → `market-control-plane` (déclaré : `market-control-plane (destination relais actif : marché de rattachement et disponibilité du relais validés au checkout ; attestation transporteur non requise)`)
- `admin-dashboard` → `sourcing` (déclaré : `sourcing`)

### Transversal topology (consumer = local-manifest frontend-transversal, hors ontology gap)

- `boutique-manifest:boutique` → orders (static-code), platform-ops (static-code), shared-cart (static-code)

### Local-manifest dependencies without canonical consumer (ontology gap, KNOWN_DEBT)

- none

### Ambiguous owners / providers (jamais collapsés arbitrairement)

- none

### Interface consumer unresolved (canal D)

- dash:`SourcingScannerView` (endpoint /api/admin/sourcing/catalogs) — INTERFACE-CONSUMER-FILE-UNRESOLVED
- dash:`SourcingScannerView` (endpoint /api/admin/sourcing/candidates) — INTERFACE-CONSUMER-FILE-UNRESOLVED
- dash:`SourcingScannerView` (endpoint /api/admin/customs-categories) — INTERFACE-CONSUMER-FILE-UNRESOLVED
- dash:`SourcingScannerView` (endpoint /api/admin/sourcing/catalogs/import) — INTERFACE-CONSUMER-FILE-UNRESOLVED
- dash:`SourcingView` (endpoint /api/admin/sourcing/synthesis) — INTERFACE-CONSUMER-FILE-UNRESOLVED
- dash:`SourcingView` (endpoint /api/admin/sourcing/analysis) — INTERFACE-CONSUMER-FILE-UNRESOLVED

### Dynamic dependencies non résolues statiquement (limitation du modèle, jamais inventées)

- scope `backend` : 30 appel(s) — ex. `tests/unit/modal-mobile-canonical.test.js`: `CSS_BUNDLES_PATH`, `tests/unit/canonical-purchasing-workspace-boundary.test.js`: `path.join(ROOT, WORKSPACE`, `tests/unit/canonical-pricing-atelier-views.test.js`: `path.join(CANONICAL, 'js', 'pricing-atelier-views.js'`
- scope `boutique` : 1 appel(s) — ex. `public/boutique/tests/unit/modal-cart-sku-guard.test.js`: `bundleConfigPath`

## O6 — Dependency Disposition

> Couche de qualification/décision au-dessus des paires O5 `OBSERVED_UNDECLARED`. O6 classifie et gouverne la dette ; **O6 ne remédie pas** encore les coutures cross-feature. Détail par paire : `docs/O6_INVENTORY.md`. Enforcement : `npm run business-graph:disposition-check`.

Composition-root owners (dérivés de l'ownership des fichiers wiring, pas du nom) : `infrastructure`, `platform-ops`.

### Summary by family

| Family | N | Policy |
|---|---|---|
| PROJECTION | 0 | projection-dependency-policy |
| COMPOSITION_ROOT_WIRING | 18 | application-wiring-not-consumption |
| NON_RUNTIME_TEST | 18 | non-runtime-evidence |
| TECHNICAL_PRIMITIVE | 0 | technical-dependency-policy |
| BUSINESS_TRANSVERSAL_SERVICE | 0 | business-dependency-declare-candidate |
| CROSS_FEATURE_DIRECT_IMPORT | 0 | boundary-remediation-required |
| BUSINESS_FEATURE_INTERFACE | 0 | business-dependency-declare-candidate |
| PILOTING_CAPABILITY | 0 | piloting-capability-dependency |
| UNCLASSIFIED | 0 | _(bloquant si > 0)_ |
| **TOTAL** | **36** | |

### Projection dependencies

Vues Dash → endpoint backend. Jamais dans un `contract.consumes` backend.

- _none_

### Composition root wiring

Bootstrap/cron/error-handler qui montent ou déclenchent une feature. Pas une consommation de service.

- `infrastructure` → `auth-passkey` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `business-rules` — import-mixed, RUNTIME_ONLY
- `infrastructure` → `decision-signals` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `documents` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `incident-management` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `local-stock` — business-file-import, RUNTIME_AND_TEST
- `infrastructure` → `loyalty` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `market-control-plane` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `providers-services` — business-file-import, RUNTIME_AND_TEST
- `infrastructure` → `purchasing` — business-file-import, MIXED
- `infrastructure` → `settlement` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `sourcing` — business-file-import, RUNTIME_ONLY
- `infrastructure` → `unsold-resolution` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `auth-passkey` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `notifications` — business-file-import, RUNTIME_AND_TEST
- `platform-ops` → `providers-services` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `recommendations` — business-file-import, RUNTIME_ONLY
- `platform-ops` → `shared-cart` — business-file-import, RUNTIME_AND_TEST

### Non-runtime test evidence

Preuves 100 % tests/. Visible mais hors dette de contrat runtime.

- `dashboard` → `loyalty` — business-file-import, TEST_ONLY
- `dashboard` → `platform` — business-file-import, TEST_ONLY
- `inventory` → `payments` — business-file-import, TEST_ONLY
- `logistics` → `dashboard` — business-file-import, TEST_ONLY
- `logistics` → `economic-engine` — business-file-import, TEST_ONLY
- `loyalty` → `logistics` — business-file-import, TEST_ONLY
- `market-autonomy` → `market-control-plane` — business-file-import, TEST_ONLY
- `market-delegation` → `market-operator-dashboard` — business-file-import, TEST_ONLY
- `market` → `customs` — business-file-import, TEST_ONLY
- `market` → `dashboard` — business-file-import, TEST_ONLY
- `market` → `market-delegation` — business-file-import, TEST_ONLY
- `market` → `orders` — business-file-import, TEST_ONLY
- `platform-ops` → `payments` — business-file-import, TEST_ONLY
- `purchasing` → `decision-signals` — business-file-import, TEST_ONLY
- `purchasing` → `refunds` — business-file-import, TEST_ONLY
- `refunds` → `auth` — technical-primitive, TEST_ONLY
- `supplier-connectivity` → `purchasing` — business-file-import, TEST_ONLY
- `wallet` → `notifications` — technical-primitive, TEST_ONLY

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

