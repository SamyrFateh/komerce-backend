# Audit — Abstractions d'intégration et architecture globale Komerce (V1)

> Base auditée : `main` @ `a13d87fe5` (merge #1699) + PR #1700 ouverte (`refs/pull/1700/head`).
> Méthode : lecture du code réel, du schéma (`docs/db/railway-live-schema.sql`), des manifestes `features/*.feature.js`, des tests et du registre `governance/external-provider-registry.json`. Aucune modification de code. Aucune donnée réelle touchée.
> Chaîne recherchée par domaine : **sources → adapter → contrat canonique → décision owner → effet autorisé → état persisté → preuve.**

---

## 0. Verdict en une page

| Domaine | Verdict | En une phrase |
|---|---|---|
| A. Catalog & Sourcing | `PARTIAL` | Le modèle d'observation persisté existe déjà (`sourcing_observations` + provenance) ; la PR #1700 ajoute une enveloppe utile mais **sans consommateur** et avec un **contrat de capacités qui chevauche Purchasing**. |
| B. Supplier Connectivity & Purchasing | `ALREADY_COVERED` | GAP-1 → GAP-7 mergés (#1596 → #1608) ; registre, readiness, gate, boundary d'exécution et de confirmation branchés sur le chemin réel. Seule dette : en-têtes périmés. |
| C. Payments, Refunds, Settlement | `ALREADY_COVERED` **+ 1 divergence démontrée** | Point d'entrée unique `confirmPaymentCycle` utilisé par Stripe/PayPal/Mobile Money/cash/checkout-wallet — **sauf** `POST /api/wallet/apply`, qui peut marquer une commande `paid` sans cycle stock. |
| D. Logistics, Inventory, Local Stock | `NOT_NEEDED` (contrat transporteur) | Aucune source transporteur externe n'existe ; la seule entrée d'événements colis est le moteur de scans, déjà owner. |
| E. Notifications | `PARTIAL` | `notification_log` trace l'envoi ; le webhook Meta **reçoit** les statuts de livraison mais les jette, et journalise le corps brut (données personnelles). |
| F. Moteur économique & prix marché | `NOT_NEEDED` | Toutes les entrées de coût sont manuelles et mono-owner ; snapshot de coût par commande ; aucune réécriture de prix engagé. |
| G. Services & offres locales | `NOT_NEEDED` | Cycle de vie manuel avec owner dédié ; aucune source externe continue à ingérer. |

**Conclusion structurante** : Komerce n'a **pas** besoin d'une nouvelle abstraction transverse. Le bon niveau existe presque partout. Il y a **une faille réelle à corriger** (wallet), **deux raccordements** (PR #1700 vers l'owner Sourcing, statuts WhatsApp) et **un recadrage** (périmètre du contrat de capacités de #1700).

---

## 1. État de départ vérifié

| Élément | Constat |
|---|---|
| PR #1699 | **Mergée** dans `main` (`a13d87fe5`) : 6 fichiers, dont `services/sourcing-candidate-import-service.js`, `services/supplier-catalog-scanner.js` et un test réel `sourcing-candidate-stock-zero-real-db.test.js`. Le zéro explicite fournisseur est désormais distinct de l'inconnu. |
| PR #1700 | **Ouverte**, 6 fichiers : `services/catalog-change-intake.js`, `services/catalog-provider-capability-contract.js`, doctrine `DOCTRINE_CATALOG_CHANGE_INTAKE.md`, 2 tests unitaires, `features/catalog.feature.js`. **Aucun consommateur** (`@used-by: future catalog change application owner`). |
| `external-provider-contracts` | Manifeste transverse sain : ne possède ni table, ni side effect, ni adapter ; vocabulaire `KNOWN/DERIVED/UNKNOWN`, étapes P0→P4, fail-closed. Bon modèle à ne pas étendre. |
| `supplier-connectivity` | Créé par GAP-7 (#1608), sans table ni capability spéculative. |
| `services/suppliers/execution-adapter-registry.js` | Composition root unique (`allegro`, `aliexpress`), consommé par `purchasing-trigger-service.js` et `purchasing-admin-service.js`. **Son en-tête dit encore que GAP-4 reste à faire — c'est faux**, GAP-4A/4B est mergé (#1601). |
| `services/mobile-money/registry.js` | Registre technique (`orange_money`, `mtn_momo`, `kartapay`) ; la DB choisit le provider par marché. Sain. |

### Registre des preuves provider (`governance/external-provider-registry.json`)

| Niveau | Providers |
|---|---|
| **P4** | `allegro`, `stripe` |
| **P3** | `ebay` |
| `UNQUALIFIED` | tout le reste (21 providers), dont `paypal`, les 3 Mobile Money, `meta-whatsapp`, `authkey`, `cloudinary` |

**Dérives du registre constatées :**
- `paypal` est `UNQUALIFIED` alors que la PR #1698 vient d'**archiver une preuve P1** Sandbox (create/readback) et que `tests/unit/paypal-sandbox-order-contract-proof.test.js` existe → le registre n'a pas été mis à jour.
- `brevo` est déclaré consommé par `notifications`, mais **aucun code n'y fait référence** (0 occurrence `brevo`/`sendinblue` dans `services/` et `routes/`).
- `twilio` et `africas-talking` n'ont **aucun consommateur** déclaré.

---

## 2. Matrice d'audit par domaine

### A. Catalog & Sourcing — `PARTIAL`

| Rubrique | Constat |
|---|---|
| Sources & providers | Connecteurs `services/suppliers/connectors/` : `allegro`, `ebay`, `aliexpress` (+ connected), `cj`, `noon`, `csv`, `json`, `manual`. |
| Contrat canonique existant | **Découverte/import** : `normalized-product.js` (produit complet), `source-product-normalizer.js`. **Observation persistée** : `sourcing_observations` (`observed_at`, `normalized`, `field_provenance`, `raw_fragment`) + `sourcing_observation_evidence`. **Capacités persistées par source** : `sourcing_source_provides` (`catalog/offers/units`), `sourcing_source_execution_modes` (`human/api`). |
| Owner métier | `sourcing` (observation, candidats) ; `catalog` (publication, produit visible). |
| Points d'entrée | `catalog-import-orchestrator.js` (via `routes/sourcing-scanner.js`), `sourcing-candidate-import-service.js`, `scripts/cj-full-catalog-sync.js` (checkpoint). |
| Effets & écritures | Candidats et observations ; promotion vers produit/SKU via `services/catalog-promotion/`. |
| Preuves existantes | Allegro P4, eBay P3 ; tests shadow (`sourcing-shadow-stock-replay-proof`, `sourcing-continuity-allegro-stock-delta-proof`, `sourcing-shadow-quantity-trial`) ; #1699 (zéro explicite) en base réelle. |
| **Divergence démontrée** | 1) PR #1700 : **enveloppe sans consommateur** — risque de contrat mort. 2) Son `CAPABILITIES` inclut `purchase`, `atomic_reservation`, `stock_write` : la capacité d'achat est **déjà** exprimée par `supplier-fulfillment-adapter-contract.js` (`placeOrder` + `buildOrderPayload`), consommé par 4 frontières GAP → **deuxième source de vérité**. 3) Les couches grossières de `sourcing_source_provides` ne sont pas réconciliées avec les capacités fines de #1700. |
| Ce qui n'est **pas** une divergence | `normalized-product.js` vs `catalog-change-intake.js` : l'un normalise un **produit complet** (découverte), l'autre des **faits partiels** de maintenance — rôles différents, pas un doublon. |
| Action minimale | Recadrer #1700 **avant merge** : (a) retirer `purchase`, `atomic_reservation`, `stock_write`, `price_write`, `content_write`, `publication_write` du contrat de capacités (les capacités d'écriture/exécution restent dans Purchasing / Catalog) ; (b) désigner comme **premier consommateur** l'owner d'observation Sourcing (`sourcing_observations` porte déjà `observed_at` + provenance), pas une nouvelle table ; (c) documenter la correspondance `sourcing_source_provides.layer` ↔ capacités de lecture. |

### B. Supplier Connectivity & Purchasing — `ALREADY_COVERED`

| Rubrique | Constat |
|---|---|
| Chaîne réelle | identité (`supplier-order-identity.js`) → autorité provider (`provider-authority.js`, GAP-1) → readiness (`supplier-fulfillment-readiness.js`, GAP-3) → registre (GAP-2) → gate unité canonique + boundary d'exécution (`canonical-unit-purchasing-gate.js`, `procurement-execution-boundary.js`, GAP-4A/4B) → preuve d'exécution → réconciliation → confirmation (`purchase-order-confirmation-boundary.js`, `allegro-purchase-reconciliation.js`, GAP-5) → isolation d'environnement (GAP-6). |
| Distinction observation / disponibilité / réservation / commande acceptée | Présente : `sourcing-shadow-quantity-trial.js` distingue `OBSERVED_QUANTITY_ONLY` / `OBSERVED_SUFFICIENT` / `UNKNOWN` ; la confirmation passe par une boundary de preuve, jamais déduite d'un 2xx. Aucun adapter n'expose `placeOrder` (fait du domaine, pas une lacune). |
| Divergence démontrée | Aucune fonctionnelle. **Dette documentaire** : l'en-tête de `execution-adapter-registry.js` décrit GAP-4 comme futur. |
| Action minimale | Corriger l'en-tête (1 fichier, zéro risque). |

### C. Payments, Refunds, Settlement — `ALREADY_COVERED` + 1 divergence

| Rubrique | Constat |
|---|---|
| Sources | Stripe, PayPal, Mobile Money (3 adapters), cash (relais, pickup), wallet. |
| Contrat canonique existant | `services/order-payment-confirmation.js` (`@role payment-to-stock-single-entry`, doctrine `confirmPaymentCycle_unique`, `stock_for_update`, `cash_rollback_vs_stripe_alert`). **Seuls 2 fichiers écrivent réellement `payment_status`** : `payment-service.js` (markPaid/markRefunded/markFailed, gardés par `payment-status-validator`) et `order-status-machine.js`. |
| Traitement "payé mais stock bloqué" | Stripe/PayPal/Mobile Money : COMMIT + alerte (argent déjà encaissé) ; cash : rollback. Tous les appelants gèrent `stockBlocked` (8 à 10 références chacun). |
| **Divergence démontrée** | `POST /api/wallet/apply` → `wallet-service.applyToOrder()` : si le wallet couvre le reste, appelle **directement** `markPaid()` puis la route `COMMIT` — **sans `confirmPaymentCycle`** : ni décrément de stock `FOR UPDATE`, ni transition `confirmed`, ni contrôle `stockBlocked`, ni facture. Le chemin checkout (`order-checkout-persistence.js:253`, `source: 'wallet_full_payment'`) le fait correctement. Aucun processus de rattrapage n'existe (0 requête sur `payment_status='paid' AND status='pending'`). Le test existant (`wallet-service.test.js:459`) valide `markPaid` sans vérifier le cycle. |
| Action minimale | Faire passer le cas « wallet couvre 100 % » de `applyToOrder` par **le même** `confirmPaymentCycle` que le checkout (cf. §4). |

### D. Logistics, Inventory, Local Stock — `NOT_NEEDED` (contrat transporteur)

| Rubrique | Constat |
|---|---|
| Sources | Scans terrain uniquement (`routes/parcel-api-v2/scans.js`, workspaces opérations et douane). **Aucune intégration transporteur externe** (0 occurrence DHL/Aramex/17track/AfterShip/webhook carrier). |
| Owner | `services/scan-engine.js` (`processScan`), `parcel-mutation-service.js`, `parcel-operations.js`. |
| Écritures directes vérifiées | `routes/parcels.js` (`last_weight_at`), `routes/carriers.js` (champs douane), `parcel-security.js` (`external_code`) : **aucune n'écrit le statut** — pas de contournement du moteur. |
| Divergence | Aucune pour le contrat de traduction transporteur : **il n'existe aucune source à traduire**. Le créer maintenant serait une abstraction spéculative. |
| À noter (hors périmètre de ce verdict) | Deux tables d'incidents coexistent : `incidents` (moteur de scans, réconciliation, alert-engine — 8 services) et `order_incidents` (signalement terrain relais/hub, order-360 — 7 fichiers). Usage cohérent aujourd'hui, mais frontière non documentée. |

### E. Notifications — `PARTIAL`

| Rubrique | Constat |
|---|---|
| Sources / canaux | WhatsApp (Meta), OTP (AuthKey), in-app. Brevo déclaré mais non utilisé. |
| Contrat existant | `services/notifications/notification-service.js` (orchestrateur, doctrines `notification_non_bloquante`, `fallback_trace`) ; `internals.js#logNotification` écrit `notification_log` (`channel`, `event`, `status`, `detail`). |
| **Divergence démontrée** | `routes/meta-whatsapp.js` `POST /webhook/meta-whatsapp` : signature vérifiée, puis `// Ici plus tard: status sent/delivered/read/failed, mapping wamid -> order_ref` → **les statuts de livraison sont reçus puis ignorés**. Komerce ne peut donc jamais prouver qu'un client a reçu un message (le principe « accusé technique ≠ livraison » est respecté par défaut, mais la preuve n'est jamais captée). |
| **Point de confidentialité** | Le même handler fait `log.info(JSON.stringify(body))` : **numéros et contenus de messages clients dans les logs**. |
| Bug secondaire | `services/simulator/state-advancer.js:127` insère dans `notification_log (order_id, message, …)` — **colonnes inexistantes** (le schéma a `order_ref`, `detail`). |
| Action minimale | 1) Remplacer le log du corps brut par un log borné (type d'événement, `wamid`, statut). 2) Plus tard : conserver le `wamid` retourné à l'envoi dans `notification_log.detail` et mettre à jour le statut depuis le webhook. Pas de nouveau moteur. |

### F. Moteur économique & prix marché — `NOT_NEEDED`

| Rubrique | Constat |
|---|---|
| Entrées de coût | Toutes **manuelles et mono-owner** : `cost-component-admin-service.js`, `cost-component-market-service.js`, `market-delegation-structure-event-service.js` / `pricing-period-structure.js` (événements de structure), `exchange_rates` via `pricing-rates.js` (aucun provider FX externe). |
| Invariants | `order-cost-snapshot.js` fige les imputations à la commande ; **aucune requête ne réécrit le prix d'une ligne de commande engagée** (0 `UPDATE order_items SET … price`). Doctrine N1/N2/N3 et prix `LOCAL_ACTIVE` déjà prouvées. |
| Divergence | Aucune : un « contrat canonique de changement de coût » n'aurait qu'une seule source par type. |
| Point de vigilance futur | Le coût d'achat fournisseur (`purchase_price`, fait de #1700) n'alimente aujourd'hui que `pricing-output.js`. Si #1700 est raccordé, la propagation vers le moteur économique devra passer par une **proposition**, jamais par une réécriture de prix. |

### G. Services & offres locales — `NOT_NEEDED`

| Rubrique | Constat |
|---|---|
| Owner | `providers-services` : `provider-status-mutation-service.js` (doctrines `lifecycle_owner_write_boundary`, `provider_market_is_immutable`), `market-delegation-local-offer-service.js`, `market-delegation-provider-service.js`. |
| Sources | Uniquement manuelles (admin, manager pays). Aucun flux externe de tarifs/disponibilités. |
| Conclusion | Le patron Catalog Change Intake n'a **aucune source à absorber** ici. Le réutiliser forcerait une prestation dans une forme de SKU fournisseur. À réévaluer le jour où un partenaire local exposera une API ou un fichier récurrent. |

---

## 3. Revue d'architecture du repo complet

### 3.1 Structure mesurée

| Zone | Fichiers `.js` | Lignes |
|---|---:|---:|
| `services/` | 314 | 80 215 |
| `routes/` | 128 | 27 004 |
| `middleware/` | 22 | 2 140 |
| `scripts/` | 236 | 57 864 |
| `features/` (manifestes) | 35 | 8 584 |
| `public/dashboards/` | 197 | 76 184 |
| `public/boutique/` | 459 | 102 719 |
| `tests/` | 912 | 162 901 |
| `bootstrap/` + `utils/` + `config/` | 38 | ~7 000 |

35 features ; 229 migrations SQL numérotées dans `migrations/` ; ratio tests/production ≈ 0,9 ; couverture CI mesurée à 86,8 % (session précédente).

### 3.2 Ce qui est solide

- **Gouvernance exécutable, pas déclarative** : `feature-audit --strict`, `feature-guard --strict`, registre ciblé, `arch-header-sql-check` (cliquet `@db-read/@db-write` vs SQL réel), `contract-check` (592 routes, 48 réponses `UNKNOWN` en dette documentée), budget zéro des dashboards Canonical. Ces gates ont attrapé de vrais défauts pendant la session (table non déclarée, script jamais classé backend, workflow orphelin).
- **Points d'entrée uniques là où l'argent et le stock bougent** : `confirmPaymentCycle`, `markPaid/markRefunded` gardés, `processScan`, machines à états strictes protégées jusqu'en base (triggers `market_settlements`).
- **Séparation contrat / adapter / décision** déjà appliquée en Purchasing (GAP-1 → GAP-7) et formalisée par `external-provider-contracts`.
- **Tests contre PostgreSQL réel** pour les chemins critiques (`tests/integration/*-real-db.test.js`).

### 3.3 Dettes structurelles constatées (par gravité)

| # | Dette | Preuve | Gravité |
|---|---|---|---|
| 1 | Chemin wallet contournant `confirmPaymentCycle` | §2.C | **Haute** (stock/argent) |
| 2 | Corps brut du webhook WhatsApp journalisé | `routes/meta-whatsapp.js` | **Haute** (données personnelles) |
| 3 | Registre des preuves provider désynchronisé | `paypal` `UNQUALIFIED` malgré #1698 ; `brevo` sans code | Moyenne |
| 4 | Commentaires d'architecture périmés | en-tête `execution-adapter-registry.js` | Faible, mais trompe les agents |
| 5 | Monkey-patching de `mount()` dans les dashboards | 6 fichiers `originalMount` / `.mount = async function` ; `MetricStrip` détourné globalement sur 3 pages | Moyenne (fragilité, a déjà causé des bugs silencieux) |
| 6 | Valeur fantôme `'cash_relay'` hors enum `payment_mode` | 1 occurrence JS | Faible (inoffensive en JS, casse tout SQL qui la caste) |
| 7 | Deux tables d'incidents sans frontière écrite | `incidents` vs `order_incidents` | Faible aujourd'hui, risque de dérive |
| 8 | Deux arbres de migrations | `db/migrations/` (12 fichiers anciens, `004_…`) jamais lus par `ci-migrate.js` qui ne lit que `migrations/` | Faible (confusion) |
| 9 | Doctrine dispersée | `docs/doctrine/` (77), `docs_doctrine/` (4), `governance/` (18), 9 `.md` à la racine | Faible (coût de lecture pour les agents) |
| 10 | Fichiers errants à la racine / non suivis | `tmp-concurrency-proof.js`, `audit-backend-arch.js`, `public/boutique/check-sourcing.js` (non suivi) | Faible |
| 11 | Insert simulateur vers colonnes inexistantes | `simulator/state-advancer.js:127` | Faible (hors prod) |

### 3.4 Sur « feature-first » à l'échelle du repo

Le principe tient bien sur le **backend** (propriété de tables, tests rattachés, endpoints non revendiqués deux fois). Il se traduit moins littéralement sur les **couches d'agrégation** (dashboards, workspaces) : l'équipe l'a compensé par une gouvernance dédiée (budget zéro Canonical) plutôt que par la propriété unique — c'est le bon choix. Le risque réel n'est pas le modèle, c'est la **dérive des métadonnées** (en-têtes, registre provider) qui sont précisément ce que les agents lisent en premier.

---

## 4. Plan d'attaque ordonné par dépendances

| Ordre | Chantier | Type | Preuve possible |
|---|---|---|---|
| 1 | **Wallet → `confirmPaymentCycle`** | Correction ciblée | Mock (unitaire) + **PostgreSQL jetable** (intégration réelle). Aucun provider externe. |
| 2 | **Webhook WhatsApp : log borné** | Correction ciblée | Unitaire (supertest + signature). |
| 3 | **Registre provider : resynchroniser** (`paypal` → P1, `brevo` retiré ou marqué sans consommateur) + en-tête `execution-adapter-registry.js` | Correction documentaire | `external-provider-boundary-scan` doit rester vert. |
| 4 | **Recadrer PR #1700** : capacités de lecture uniquement ; premier consommateur = owner d'observation Sourcing | Raccordement d'un contrat existant | Unitaire sur le normaliseur ; intégration sur `sourcing_observations` en base jetable ; **Sandbox Allegro** pour un changement réel (déjà P4). |
| 5 | **Statuts de livraison WhatsApp** : `wamid` à l'envoi, mise à jour depuis le webhook | Raccordement | Unitaire + base jetable ; la preuve de livraison réelle exige un **vrai numéro de test Meta** (preuve externe P1/P2). |
| 6 | Frontière écrite `incidents` / `order_incidents` | Documentation | Aucune. |
| 7 | Remplacer le monkey-patching des dashboards par un point d'extension déclaré | Refactor | Tests canonical existants + vérification navigateur. |

Rien dans ce plan ne crée de moteur central, de bus d'événements global, de writer transversal ni de branche spécifique provider dans le cœur métier.

---

## 5. Première tranche recommandée

**Faire passer `POST /api/wallet/apply` par le cycle canonique de confirmation quand le wallet couvre 100 % de la commande.**

- **Pourquoi celle-ci** : seule divergence démontrée touchant simultanément l'argent et le stock ; petite ; sans provider externe ; entièrement prouvable en local.
- **Fichiers impactés** : `services/wallet-service.js` (branche `remainingToPay <= 0` de `applyToOrder`) ; `tests/unit/wallet-service.test.js` (adapter l'assertion existante ligne ~459) ; nouveau `tests/integration/wallet-apply-full-payment-real-db.test.js`.
- **Principe** : réutiliser **exactement** l'appel déjà en place dans `order-checkout-persistence.js:253` (`confirmPaymentCycle`, même transaction, `source` dédié), et reprendre **son** traitement de `stockBlocked` pour le wallet — ne rien inventer. Le débit wallet étant dans la même transaction, un blocage stock peut être annulé proprement par le `ROLLBACK` déjà présent dans la route.
- **Réversibilité** : un seul point de branchement ; revert trivial.
- **Critères d'acceptation** :
  1. Wallet partiel (`remaining > 0`) : comportement strictement inchangé.
  2. Wallet couvrant 100 %, stock suffisant : `payment_status='paid'`, stock décrémenté une seule fois, statut commande identique à celui produit par le checkout wallet complet.
  3. Wallet couvrant 100 %, stock insuffisant : aucune commande `paid` sans stock ; le débit wallet n'est pas persisté ; comportement aligné sur le checkout.
  4. Rejeu idempotent (`checkout_${orderId}`) : aucun double débit, aucun double décrément.
  5. Aucun autre writer de `payment_status` introduit.
- **Tests réellement nécessaires** : 1 unitaire (branche appelée avec la bonne transaction) + 3 cas en PostgreSQL jetable (stock suffisant, stock insuffisant, rejeu). Pas d'E2E, pas de Golden : le défaut est élémentaire et entièrement local.
