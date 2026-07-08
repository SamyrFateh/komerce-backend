# DETTE TECHNIQUE — Komerce Monorepo
## État post-session Fable, 2026-07-08

> Ce document liste toute la dette technique restante après la mise en place
> du CRUD feature-first. Chaque item est classé par priorité et faisabilité.
> Les items marqués 🤖 sont directement exécutables par Sonnet sans décision
> humaine. Les items marqués 👤 nécessitent une décision produit/archi.

---

## P0 — BLOQUANT AVANT CRUD SUR LES FEATURES COMPLEXES

### D-01 · Sprint D — Consolider `parcels` (5 écrivains directs)
- **Tables :** `parcels` — customs, dashboard, logistics, payments, platform-ops
- **Action 🤖 :** Créer `transitionParcelStatus(client, parcelId, newStatus, opts)` dans un service logistics. Migrer les `UPDATE parcels SET status` de :
  - `services/customs-shipment-service.js` (customs_cleared_at — pas le status, juste un SET timestamp → hors scope)
  - `routes/hub-dashboard.js:458` (shipped_at + notes → logging, pas transition)
  - `services/scan-engine.js:357,406` (les vrais changements de statut)
  - `services/simulator/state-advancer.js:217,292` (simulation — à évaluer)
- **Risque :** Moyen. Les écritures `parcels.status` viennent de scan-engine et parcel-operations (déjà dans logistics). Les autres features écrivent des métadonnées (customs_cleared_at, shipped_at), pas le statut.
- **Impact :** 5 → 3 écrivains directs

### D-02 · Sprint E — Consolider `orders` (9 écrivains directs)
- **Tables :** `orders` — customs, dashboard, inventory, logistics, orders, payments, platform-ops, shared-cart, wallet-loyalty
- **Action 👤 :** Découper par type de mutation et migrer vers `order-service.js` / `transitionOrderStatus()`. Chantier le plus lourd du monorepo.
- **Sous-tâches concrètes 🤖 :**
  1. `services/payment-paypal.js:587` — `UPDATE orders SET status = 'refunded'` hors machine (exception documentée I-BACK-3). Migrer vers `transitionOrderStatus` après ajout de la transition `* → refunded` dans VALID_TRANSITIONS.
  2. `services/parcelOptimizationService.js:526` — `UPDATE orders SET computed_status`. Ce n'est pas `status` mais `computed_status` (champ calculé) → vérifier si c'est une vraie violation ou un champ séparé.
  3. `services/shared-cart-lifecycle.js:251` — `INSERT order_status_history` à la création de commande (t=0). Migrer vers `appendOrderHistoryNote()`.
  4. `routes/orders/create.js:353` — idem, INSERT initial.
  5. `routes/admin/system.js:394` — INSERT dans une purge admin dev-only.
- **Risque :** Élevé. Nécessite des tests croisés sur toutes les features.

---

## P1 — DETTE STRUCTURELLE (à traiter dans les 2 prochains sprints)

### D-03 · 18 méthodes API mortes dans api-client.js (dashboard admin) — ✅ FAIT (2026-07-08)
> Traité par Sonnet : 18 fonctions + exports supprimés (792→746 lignes). Confirmé 0 appel réel
> via `gen-dashboards-360.js --check` (118→100 méthodes API, 0 régression), baseline figée
> (`--save`). Gates dashboards (quality/arch/feature-guard/registry/testkit) + Jest 38 suites /
> 972 tests : tout vert.

- **Fichier :** `public/dashboards/admin/js/api-client.js`
- **Méthodes :** `createEconomicCharge`, `createLoyaltyReward`, `createLoyaltySkip`, `deleteCostBenchmark`, `getCostBenchmarks`, `getLoyaltyHistory`, `getLoyaltyPending`, `getParcelAlerts`, `getParcelCritical`, `getParcelKpis`, `getPricingCompetitors`, `redistributeEconomic`, `sourcingBulkRail`, `updateCustomsShipment`, `updateEconomicCharge`, `updateEconomicVariable`, `updateFinanceConfig`, `upsertCostBenchmark`
- **Action 🤖 :** Pour chaque méthode, vérifier qu'aucune vue admin ne l'appelle (grep dans `public/dashboards/admin/js/views/`). Si confirmé mort, supprimer la fonction et son export. Puis `node scripts/gen-dashboards-360.js --save` pour figer la nouvelle baseline.
- **Risque :** Faible (code mort = pas d'impact fonctionnel).

### D-04 · 1 violation doctrine dashboards 360 — ✅ FAIT (2026-07-08)
> Traité par Sonnet : `views/SourcingScannerView.js` faisait un `fetch('/api/admin/customs-categories')`
> brut. Aucun wrapper KmcApi n'existait pour cet endpoint → ajouté `getCustomsCategories(params)`
> dans `api-client.js` (même pattern que `getCustomsShipments`), remplacé l'appel dans la vue,
> et mis à jour `tests/unit/SourcingScannerView.test.js` (mock `KmcApi.getCustomsCategories` au
> lieu de `global.fetch`). `gen-dashboards-360.js --check` : 0 violation doctrine restante,
> baseline figée. `npm run check:all` : 38 suites / 972 tests verts.

- **Détail :** Voir `docs/DASHBOARDS_360.md` §3 — un appel direct `fetch()` au lieu de passer par `KmcApi`.
- **Action 🤖 :** Identifier le fichier, remplacer le `fetch()` par l'appel `KmcApi` équivalent. Puis `--save`.

### D-05 · 4 collisions de numéros de migration
- **Collisions :** 014 (2 fichiers), 072 (2 fichiers), 073 (2 fichiers), + 1 autre
- **Action 👤 :** Documenter dans `migrations/GAPS.md` si pas déjà fait (les migrations sont déjà appliquées en prod — on ne peut pas renuméroter). Aucun risque fonctionnel. Les futures migrations utilisent des numéros > 102.

### D-06 · 12 endpoints avec contrat UNKNOWN (schéma de réponse non prouvé)
- **Fichier :** `docs/contract/openapi.json`
- **Action 🤖 :** Pour chaque endpoint UNKNOWN, écrire un test d'intégration qui appelle la route et asserte sur la forme de la réponse (`.body`). Puis `npm run contract:generate` pour remplacer UNKNOWN par le schéma réel extrait.
- **Endpoints :** Lister avec `grep -c "UNKNOWN" docs/contract/openapi.json`, puis ouvrir le fichier pour les identifier.

### D-07 · 28 avertissements code-quality (non bloquants)
- **Action 🤖 :** Lancer `node scripts/code-quality-gate.js --strict 2>&1 | grep "⚠"` pour lister. Typiquement : `var` au lieu de `const/let`, `console.log` restants, SQL interpolé sur des whitelists (confirmé safe mais le scanner le signale).
- **Risque :** Nul (non bloquant, informatif).

---

## P2 — DETTE CONNUE À PLANIFIER

### D-08 · shared-cart rate-limit manquant (audit sécurité §5) — ✅ FAIT (2026-07-08)
> Traité par Sonnet : **correction du chemin** — le doc visait `routes/shared-cart.js` mais
> `POST /api/shares` et `POST /api/shares/:token/contributions` vivent en réalité dans
> `routes/shares.js` (monté sur `/api/shares` via `bootstrap/api-routes.js`), fichier distinct
> de `routes/shared-cart.js` (monté sur `/api/shared-carts`). Ajouté `sharedCartLimiter`
> (15 min / 30 req, même fabrique `createLimiter` que les autres limiters) dans
> `middleware/rate-limit.js`, appliqué en middleware inline sur les 2 routes POST concernées
> (scope précis, pas de sur-large sur le GET public ni le PATCH admin). Mise à jour du mock
> logger dans `tests/unit/shares-route.test.js` (manquait `forModule`, requis transitivement
> par le nouveau require de `middleware/rate-limit.js`). Validé : 25/25 tests shares-route,
> 8/8 rate-limit.test.js, suite complète 5703/5738 (13 échecs pré-existants et sans rapport
> dans `catalog-enrichment-extended.test.js`, à investiguer séparément — probable fixture
> incomplète, lié à D-10 schema drift).

- **Routes :** `POST /api/shares` et `POST /api/shares/:token/contributions`
- **Problème :** Couvertes uniquement par le `globalLimiter` (500 req/15min/IP). Pas de limiteur dédié comme `authLimiter`. Vecteur potentiel de spam de paniers partagés.
- **Action 🤖 :** Ajouter un `rateLimiter({ windowMs: 15*60*1000, max: 30 })` sur ces 2 routes dans `routes/shared-cart.js`.
- **Risque :** Faible (pas d'exploit connu, mais surface d'attaque ouverte).

### D-09 · 2 features en staging (pas encore `production`)
- **Features :** `inventory`, `recommendations`
- **Action 👤 :** Valider fonctionnellement, puis passer `status: 'production'` dans le manifest quand prêt. Pas de changement de code, juste un signal de maturité.

### D-10 · 1 schema drift — migration 100 pas encore déployée sur Railway
- **Détail :** `products.enrichment_confidence` et la table `catalog_enrichment_runs` sont dans le code mais la migration 100 n'est pas encore appliquée en prod Railway.
- **Action 👤 :** Déployer la migration `100_catalog_enrichment_runs.sql` sur Railway prod. Puis `npm run db:snapshot` + `npm run arch:reconcile -- --write`.
- **Impact :** La raffinerie catalogue ne fonctionnera pas en prod tant que cette migration n'est pas appliquée.

### D-11 · 59 contrats dashboards non prouvés (informatif)
- **Détail :** 59 méthodes API dans les vues admin dont le contrat de réponse n'est pas asserté par un test.
- **Action 🤖 :** Progressive — à chaque ticket touchant un dashboard, ajouter le test de contrat pour les méthodes utilisées par la vue modifiée.
- **Risque :** Nul (informatif, le 360 les signale mais ne bloque pas).

### D-12 · 1 endpoint fantôme dans le méta-graphe — ✅ FAIT (2026-07-08)
> Traité par Sonnet : confirmé que le vrai endpoint est `POST /api/v2/parcels/:ref/scan`
> (`event_type`/`notes`), pas `/api/v2/scan`. Corrigé `hubShip`, `relaisReceive`,
> `relaisCollect` dans `api-client.js` (dashboards) pour appeler la bonne route avec le
> bon payload. Nettoyé un bloc TODO obsolète en fin de `HubRelaisView.js` qui documentait
> encore le mauvais endpoint (les 7 fonctions étaient déjà mergées dans `api-client.js`).
> `gen-meta-graph.js` : 0 fantôme (était 1). Suite dashboards : 38/38 suites, 972/972 tests.
- **Détail :** Un front (boutique ou dashboard) appelle un endpoint absent du contrat OpenAPI.
- **Action 🤖 :** `cat docs/META_GRAPH.md | grep "fantôme"` pour identifier, puis soit ajouter la route au contrat, soit corriger l'appel frontend.

---

## P3 — DETTE COSMÉTIQUE / HYGIÈNE

### D-13 · `2026_cost_benchmarks.sql` — convention de nommage
- **Problème :** Migration nommée avec une année (2026) au lieu d'un numéro séquentiel (103, 104…). Le `migrationNum()` du feature-guard ignore maintenant les numéros > 999, donc ça ne casse rien, mais c'est une exception de convention.
- **Action 🤖 :** Renommer en `103_cost_benchmarks.sql`, mettre à jour la référence dans `features/economic-engine.feature.js`, et si déjà appliquée en prod, ajouter une entrée dans `governance/migration-slot-exemptions.json`.

### D-14 · `routes/admin/system.js:110` — SQL interpolé (whitelist) — ✅ FAIT (2026-07-08)
> Traité par Sonnet : le scanner concerné n'est pas `code-quality-gate.js` (sa règle
> N2-SQL-INJECTION ne matche que `req/params/body/query`) mais `audit-backend-arch.js`
> (invariant I-BACK-8, `node scripts/audit-backend-arch.js`). Ajouté le commentaire
> `// arch-safe: whitelist literal` documentant que `tbl` vient exclusivement de
> `CLEAN_TABLES_ALLOWLIST` (tableau littéral, re-vérifié par le garde AUD-07), et ajouté
> une entrée dans `ALLOWED_RAW_SQL_PATTERNS` du scanner pour exclure formellement ce
> pattern. Avant : 1 avertissement I-BACK-8. Après : 0 — audit passe en
> "✅ Aucune violation. Architecture conforme." (les 7 avertissements restants sont
> de la dette déjà connue : tailles de fichiers, D-05 collisions migrations, etc.).
> `tests/unit/admin-system.test.js` + `tests/unit/system.test.js` : 57/57 verts.

- **Détail :** Un identifiant SQL (nom de table) est interpolé, mais la source est une whitelist littérale dans le code. Le scanner le signale mais c'est confirmé safe.
- **Action 🤖 :** Ajouter un commentaire `// arch-safe: whitelist literal` pour documenter la décision et potentiellement exclure du scanner.

### D-15 · Méta-graphe — 10 tables lues par 2 fronts
- **Détail :** 10 tables DB sont lues à la fois par la boutique et le dashboard (via des endpoints différents). C'est normal (catalogue lu par la boutique ET l'admin) mais à documenter.
- **Action 🤖 :** Aucune correction, juste un constat. Documenter dans `MULTI_WRITER_TABLES.md` si pertinent.

---

### D-16 · `tests/unit/catalog-enrichment-fixtures.js` vide → 13 échecs dans `catalog-enrichment-extended.test.js`
- **Détail :** Le fichier `tests/unit/catalog-enrichment-fixtures.js` fait **0 octet** (confirmé vide directement dans `backend.zip`, pas un artefact d'extraction). Le fichier de test importe `{ PRODUCTS, ENRICHED_OUTPUTS, TEST_GLOSSARY, TEST_CATEGORIES, TEST_OVERRIDES }` depuis ce module — tous `undefined`, d'où les 13 échecs (`Cannot read properties of undefined (reading 'powerBank')`, etc.) dans `catalog-enrichment-extended.test.js`.
- **Correction précédemment supposée liée à D-10 (schema drift) :** infirmé — ce n'est pas un problème de schéma/migration, c'est un fichier de fixtures perdu/non commité.
- **Action 👤/🤖 :** Retrouver ou reconstruire `tests/unit/catalog-enrichment-fixtures.js` (5 exports : `PRODUCTS` avec au moins `powerBank`, `abaya`, `parfum`, `electronique`, `sansDonneeSource` ; `ENRICHED_OUTPUTS.powerBank` ; `TEST_GLOSSARY` ; `TEST_CATEGORIES` ; `TEST_OVERRIDES` avec `validDescription`/`sqlInjection`). Nécessite probablement une décision humaine si l'historique git ne l'a pas (à vérifier côté Samjean avant que Sonnet ne réinvente les fixtures).
- **Risque :** Nul pour la prod (fixtures de test uniquement), mais bloque la couverture réelle de `services/catalog-enrichment.js` sur ces 13 cas.

---

## RÉCAP POUR SONNET — Par ordre d'exécution recommandé

| # | Item | Effort | Type |
|---|---|---|---|
| 1 | D-03 | 30 min | 🤖 Supprimer 18 méthodes API mortes + save baseline |
| 2 | D-04 | 15 min | 🤖 Corriger 1 violation doctrine (fetch → KmcApi) |
| 3 | D-08 | 15 min | 🤖 Ajouter rate-limiter sur shared-cart POST |
| 4 | D-14 | 5 min | 🤖 Commenter le SQL interpolé whitelist |
| 5 | D-12 | 15 min | 🤖 Résoudre 1 endpoint fantôme méta-graphe |
| 6 | D-07 | 1h | 🤖 Traiter les 28 warnings code-quality |
| 7 | D-13 | 15 min | 🤖 Renommer migration 2026_ en 103_ |
| 8 | D-06 | 2h | 🤖 Écrire les tests de contrat pour 12 endpoints UNKNOWN |
| 9 | D-01 | 2h | 🤖 Sprint D — consolider parcels via transitionParcelStatus |
| 10 | D-02 | 4h+ | 👤 Sprint E — consolider orders (décisions archi requises) |
| 11 | D-16 | 30 min–2h | 👤/🤖 Retrouver/reconstruire `catalog-enrichment-fixtures.js` (13 tests cassés) |

**Convention pour Sonnet :** après chaque modification, lancer `bash .git/hooks/pre-commit` pour vérifier que toutes les gates passent. Si un `--save` ou `--write` est mentionné, le lancer pour figer la nouvelle baseline.
