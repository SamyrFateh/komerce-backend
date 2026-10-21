# Komerce — Contrat de navigabilité (version finale pour Sonnet) — 2026-10-21

> **Provenance** : contrat d'implémentation rédigé par Opus (assistant IA) le 2026-10-21, transmis au propriétaire puis exécuté par lots (#2774 à #2783). Intégré au dépôt le 2026-10-21. Référence **complémentaire** de `KOMERCE_CARTOGRAPHIE_PROCESSUS_P1_P7.md`, qui reste la référence des processus.
> **Lecture** : les statuts PROVEN / À CORRIGER / BACKEND GAP datent de la rédaction ; l'état réel est celui de `main`. Les arbitrages du propriétaire (mocks validés, KPI pertinents, navigation directe sans passage obligé par une 360, décisions humaines explicites) priment.


Références de présentation : les 8 mocks récents (Pilotage, Commerce, Commandes, Opérations, Finance, Sourcing Live, Hub Live, Relais Live) dans `docs/visual-references/dashboards/` + `docs/contract/DASHBOARD_MOCK_TRACE_V1.md`. On conserve leurs blocs métier (KPI, graphiques, tableaux, panneaux latéraux, actions) ; on allège sans appauvrir. Couleurs/composants Komerce actuels (orange, neutres, sémantiques) — jamais de bleu dominant.

Statuts : **PROVEN** = existe dans le code · **À CORRIGER** = frontend seul · **BACKEND GAP** = extension serveur démontrée nécessaire.

## Arbitrages intégrés (définitifs)
- **Finance** : 3 KPI — CA encaissé · coûts directement imputables aux commandes (libellé fidèle à `cout_reel` : « Coûts constatés », jamais « engagés » sans contrat serveur) · marge réelle finalisée (jamais extrapolée aux commandes non finalisées). Écarts, complétude, coûts à établir : hors bloc central, accessibles par lien vers leurs espaces propriétaires. **Déjà implémenté dans PR #2774 (ouverte, CI rouge 2 checks) → la finaliser, ne pas refaire.**
- **Un indicateur peut apparaître sur plusieurs dashboards** s'il répond à une question différente, avec une source canonique unique (Commerce garde son CA).
- **Live** (Sourcing/Hub/Relais) gardent KPI de suivi, files, filtres, panneaux de détail.
- **Pilotage** reste une supervision transversale complète (mock), pas une page de boutons.
- **Pas de clic intermédiaire inutile** : lien direct workspace → workspace quand la route existe ; les fiches 360 servent à comprendre, pas de passage obligé.
- Contexte transporté quand applicable : `market`, `period`, objet, `simulation_scope`, `return_to`/`return_label`. Habilitations inchangées.

## 1. Matrice de navigation définitive
Routes réelles : `/admin/{pilotage,commerce,operations,finance,action-center,hub-live,relais-live,import-runtime}`, `/admin/workspaces/{catalog,pricing,purchasing,operations,shipping-customs,accounting,sourcing}`, 360 : `/admin/orders/:reference`, `/admin/products/:product_ref`, `/admin/clients/:phone`, `/admin/suppliers/:id`, `market-catalog.html?market=&product_ref=`. Mécanismes : `withReturnTo`, `withEntityReturnTo` (`navigation-policy-v4.js`), shell `?market=`.

| # | Source | Élément | Route | Paramètres | Cible | Retour | Autorité | Statut |
|---|---|---|---|---|---|---|---|---|
| 1 | Pilotage | signal Finance | `/admin/finance` | market, period, simulation_scope | Finance | return_to pilotage (+query) | finance.read | À CORRIGER (lien sans contexte) |
| 2 | Pilotage | signal Opérations / coûts | `/admin/operations` | idem | Opérations | idem | operations.read | À CORRIGER (cible corrigée dans #2774, contexte manquant) |
| 3 | Pilotage | ligne alerte entité | 360 de l'entité | return_to | 360 | return_to avec query | capability 360 | PROVEN (`withEntityReturnTo`) ; À CORRIGER : query perdue |
| 4 | Tous dashboards | période | même écran | `?period=7|30|90` | — | — | — | À CORRIGER (period non lu depuis l'URL) |
| 5 | Commerce | produit (top 5, catégories) | `/admin/products/:product_ref` | return_to | Produit 360 | return_to | catalog.read | À CORRIGER |
| 6 | Commerce | ouvrir l'Atelier | `/admin/workspaces/pricing?product_ref=` | product_ref | Atelier (focus produit) | return_to | pricing.decide | PROVEN |
| 7 | Commerce | catalogue pays | `market-catalog.html?market=&product_ref=` | market, product_ref | Catalogue pays | — | catalog.expose | PROVEN |
| 8 | Commerce / Commandes | commande | `/admin/orders/:reference` | return_to | Commande 360 | return_to | operations.read | À CORRIGER si absent (vérifier écran Commandes) |
| 9 | Opérations | ligne commande / exception | `/admin/orders/:reference` | return_to | Commande 360 | return_to | operations.read | PROVEN |
| 10 | Opérations | phase de la synthèse (6 phases #2771) | `/admin/operations` | `stage` | liste filtrée (même payload) | — | operations.read | À CORRIGER (`stage` non lu) ; si comptes absents → BACKEND GAP, s'arrêter |
| 11 | Opérations | lot / colis | `/admin/workspaces/shipping-customs` | — | Expéditions & Douane | return_to | operations | À CORRIGER (vérifier param de sélection ; sinon lien simple) |
| 12 | Hub Live / Relais Live | référence commande | `/admin/orders/:reference` | return_to (`view`,`tab`,`list` conservés) | Commande 360 | return_to | operations.read | À CORRIGER |
| 13 | Sourcing Live (import-runtime) | produit | `/admin/products/:product_ref` | return_to (f_* conservés) | Produit 360 | return_to | admin | PROVEN |
| 14 | Expéditions & Douane | commande / colis | `/admin/orders/:reference` | return_to | Commande 360 | return_to | operations.read | À CORRIGER |
| 15 | Achats | fournisseur | `/admin/suppliers/:id` | return_to | Fournisseur 360 | return_to | admin | À CORRIGER |
| 16 | Commande 360 | bon de commande | `/admin/workspaces/purchasing?po=` | po | Achats (PO sélectionné) | return_to | admin | PROVEN |
| 17 | Commande 360 | produit / client | `/admin/products/:ref`, `/admin/clients/:phone` | return_to | 360 | return_to | — | PROVEN |
| 18 | Commande 360 | section Coûts & écarts | ancre `#couts` | — | — | — | finance.read | BACKEND GAP : étendre `services/order-360.js` en réutilisant `computeOrderCostVariance` + `describeOrderCosts` (lecture seule) |
| 19 | Finance | KPI coûts / marge (aide) | `/admin/orders/:reference#couts` via liste existante ; rapprochements → `/admin/workspaces/accounting` | simulation_scope, return_to | Commande 360 / Comptabilité | return_to | finance.read | À CORRIGER après #2774 et lot 5 |
| 20 | Finance | paiement fournisseur à revoir | `/admin/workspaces/purchasing?po=` | po | Achats | return_to | admin | PROVEN |
| 21 | Raffinerie / Catalogue | produit prêt → prix | `/admin/workspaces/pricing?product_ref=&market=` | product_ref, market | Atelier (focus) | return_to | pricing.decide | À CORRIGER (lien direct « Continuer → ») |
| 22 | Atelier des prix | prix LOCAL_ACTIVE → exposition | `market-catalog.html?market=&product_ref=` | idem | Catalogue pays | — | catalog.expose | À CORRIGER (lien direct) |
| 23 | Sourcing / Import | produit gardé → raffinage | `/admin/workspaces/catalog?view=refinery&product_ref=` | view, product_ref | Raffinerie (présélection) | return_to | catalog | À CORRIGER (lien direct ; params PROVEN) |
| 24 | Produit 360 | fil P1 par marché | étapes → routes 21–23 | product_ref, market | workspace de l'étape | return_to | capability étape | Vérifier payload `services/product-360.js` (statut prix/exposition par marché) ; absent → BACKEND GAP (lire `product_market_price_drafts`, `product_market_exposure`) |
| 25 | Commande 360 | fil P2 | `status` + `status_history` | — | — | — | — | À CORRIGER (données présentes) |
| 26 | Action Center | ligne | 360 avec retour | market, severity | 360 | return_to | — | PROVEN |

## 2. Adaptations minimales par écran
- **Pilotage** : conserver tous les blocs du mock (signaux, alertes, tour de contrôle, tendances). Ajouter le contexte aux liens (1–3). Aucune duplication de calcul.
- **Commerce** : conserver KPI (dont CA, même source), funnel, top produits/catégories. Ajouter liens produit/commande (5, 8). Graphiques temporels / ventilation marchés : BACKEND GAP existant (#2772) — ne pas simuler.
- **Commandes** : conserver liste/filtres/panneau ; vérifier lien Commande 360 avec retour et contexte (8).
- **Opérations** : conserver synthèse 6 phases + tour de contrôle 9 étapes ; ajouter filtre `stage` (10), liens lot (11).
- **Finance** : finaliser #2774 (3 KPI, libellé « Coûts constatés »). Liens vers espaces propriétaires (19). Rien d'extrapolé.
- **Sourcing Live / Hub Live / Relais Live** : anatomie inchangée (KPI, files, filtres, panneaux). Références cliquables avec retour qui restaure la vue (12, 13). Pas de stock/seuil/délai fictif.
- **Workspaces P1** : liens directs « Continuer → » (21–23), sans passage par la 360.
- **Commande 360** : fil P2 (25) + section Coûts (18).
- **Produit 360** : fil P1 par marché (24).
- **Encadré « À quoi sert cet écran »** (`app.js` `mountPurposeBox`) : replié par défaut.

## 3. Lots ordonnés (une PR par lot)
Chaque lot : contrat attendu → audit code + PR ouvertes → fichiers → changements minimaux → tests → `pr:preflight` vert → PR → CI verte → merge → déploiement vérifié (`/health/version`) → recette desktop + mobile (liens, filtres, retour) → écarts.

| Lot | Contenu | Fichiers principaux | Acceptation |
|---|---|---|---|
| **0** | Finaliser **#2774** : corriger les 2 checks rouges, recette Finance 3 KPI + Pilotage | branche `feat/dashboard-finance-simplification-audit-20261021` | CI verte ; 3 KPI ; « Coûts constatés » ; marge finalisée seule ; aucun lien cassé vers `#finance-incomplete-costs`/`#finance-variances` |
| **1** | Contexte : `withContext(path,{market,period,simulation_scope})` + lecture `period` URL ; `return_to` avec query | `navigation-policy-v4.js`, `finance.js`, `commerce.js`, `operations.js`, `pilotage.js` | changer période/marché → cliquer → revenir : contexte identique ; scope invalide ignoré |
| **2** | Pilotage + Commerce + Commandes : liens 1–3, 5, 8 | `pilotage-decision.js`, `commerce-decision.js`, écran Commandes | chaque href porte le contexte ; E2E Pilotage → Finance → retour |
| **3** | Exécution : 12, 14, 15 | `hub-live.js`, `relay-live.js`, `shipping-customs-workspace*.js`, `purchasing-workspace.js` | retour restaure `view/tab/list` ; aucune mutation touchée |
| **4** | Workspaces P1 directs : 21–23 | `catalog-workspace*.js`, `pricing-workspace*.js`, `sourcing-workspace*.js`, `import-runtime.js` | produit présélectionné à l'arrivée ; habilitation respectée (lien masqué sans capability) |
| **5** | Commande 360 : fil P2 + section Coûts (backend gap 18) ; Finance pointe vers `#couts` | `services/order-360.js`, `public/.../order-360.js`, `finance-decision.js` | RCT1-E1 : marge 4 765 identique ; section invisible sans finance.read |
| **6** | Produit 360 : fil P1 (vérifier payload, étendre si absent) | `services/product-360.js`, `product-360.js` | P4 : CM actif 20 000 XAF, KM sans prix ; « Continuer → » ouvre l'étape |
| **7** | Opérations : `stage` (10), liens lot (11) | `operations-decision.js` | comptes = payload ; aucun recalcul ; sinon s'arrêter (BACKEND GAP) |
| **8** | Encadré d'aide replié | `app.js` | fermé par défaut partout |

Non-régression à chaque lot touchant Finance/coûts : E1 4 765, G 1 850, consolidé 6 615 ; RCT1 étiqueté, jamais mêlé au réel.
Hors vague (décision humaine) : KPI « coûts engagés » (contrat serveur à définir) ; état « marché à configurer » (mock à valider) ; tarif transport CM (20 087 XAF incluant 65 KMF/kg global).
