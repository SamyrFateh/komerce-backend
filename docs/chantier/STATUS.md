# Komerce Backend — État du chantier
> Mis à jour : 2026-05-25 (go-live readiness — panier partagé boutique-first)
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`
> **Ce fichier est la PREMIÈRE chose à ouvrir au début de chaque session.**

---

## Point d'entrée obligatoire

Lire dans cet ordre avant toute modification :

1. `docs/chantier/STATUS.md` — état du jour et prochain lot réel
2. **Socle architectural (4 documents canoniques)** :
   - `docs/CARTOGRAPHY_360.md` — quoi existe (domaines, surfaces, points de vérité)
   - `docs/ZONE_IMPACT.md` — quoi protéger (10 invariants + checklist)
   - `docs/SCHEMA.md` — quoi est vrai en base (91 tables, 14 ENUMs, triggers)
   - `docs/CONTRACTS.md` — qui appelle quoi (contrats services critiques)
3. `docs/BACKEND_AUDIT_CORRECTIONS.md` — corrections post-lecture code, fait foi contre l'audit initial
4. `docs/BACKEND_GOLIVE_ROADMAP.md` — détail complet des lots
5. `docs/BACKEND_AUDIT_SESSIONS_PLAN.md` — sessions d'audit approfondies

---

## Doctrine produit active — panier partagé boutique-first

Doctrine validée :

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Le modèle actif est le **panier partagé dans la boutique** :

```txt
/boutique
→ panier boutique
→ partager / payer ensemble
→ /cart/shared/:token
→ contributions Stripe
→ fully_funded
→ finalisation commande
```

Le modèle legacy `collective workspace / panier événement collectif` est déclassé depuis la PR #486 :

- `/event/*` et `/workspace/*` redirigent vers `/boutique` ;
- `/api/collective-workspaces` et `/api/collective-payments` retournent `410 collective_workspace_disabled` ;
- `collective-payment-orchestrator` est un tombstone/no-op ;
- les tables/migrations `collective_*` restent conservées temporairement, sans suppression DB destructive.

Règle produit : ne pas réintroduire un workspace parallèle. Toute évolution doit rester une capacité naturelle du panier boutique.

---

## Invariants à garder en tête

| ID | Invariant |
|----|-----------|
| I-01 | Ne jamais modifier `orders.status` hors machine de statut |
| I-02 | Paiements Stripe/cash/wallet/shared cart → uniquement `pending → confirmed`. Le collectif legacy est tombstone et ne doit plus créer de flux paiement actif. |
| I-03 | Transitions scan/système : forward-only + idempotentes |
| I-04 | Toute transition effective → trace dans `order_status_history` |
| I-05 | Wallet : pas de suppression — créditer, débiter, contre-passer |
| I-06 | Annulation → restaurer stock ET wallet appliqué |
| I-07 | Webhooks Stripe : body brut avant `express.json` |
| I-08 | Pricing : lire les composantes DB, jamais de coefficient dur |
| I-09 | Colis = unité opérationnelle autonome |
| I-10 | Codes retrait et preuves de collecte = éléments de confiance |

---

## État réel confirmé sur `main`

| Lot | État | Notes |
|-----|------|-------|
| INIT-0 | ✅ Fait | Référentiels lus en session |
| DOC-0 | ✅ Fait | `CARTOGRAPHY_360.md` et `ZONE_IMPACT.md` déjà à jour |
| SOCLE-1 | ✅ Fait | Socle architectural à 4 docs gravé |
| SOCLE-2 | ✅ Fait | CARTOGRAPHY aligné sur les 9 tables manquantes |
| SOCLE-3 | ✅ Fait | `server.js` documenté comme point névralgique |
| H-SYNC | ✅ Fait | Synchronisation roadmap ↔ STATUS |
| A1 | ✅ Fait | Fichier fantôme supprimé |
| A3 | ✅ Fait | Script groupe paiement déplacé en manuel |
| A4 | ✅ Fait | Collisions 060/061 reconnues comme dette réelle mais non bloquante. Aucun renommage/suppression. |
| A5 | ✅ Fait | `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ajouté |
| A6 | ✅ Fait | Issue #387 créée |
| A7 | ✅ Fait | Docs parasites archivées ; `AGENTS.md` corrigé |
| D0 | ✅ Fait avec hotfix | Fallback QR supprimé ; démarrage Railway restauré |
| D1-D8 | ✅ Fait | Audits sécurité, env, rate limit, CORS, Helmet/CSP documentés |
| G1-G5 | ✅ Fait | Audits flows cash, Stripe, collectif, annulation, sourcing/catalogue documentés |
| I-SWEEP-0 à I-SWEEP-6C | ✅ Fait | Corrections critiques cash, QR, Stripe, purchasing, collectif, refund, pricing, publication/stock mergées |
| TEST-1A | ✅ Fait | PR #409 mergée. Filet Jest sans DB réelle |
| TEST-1B | ✅ Fait | Commit `28aae996`. Tests Jest avec mocks DB transactionnels |
| TEST-DEBT | ✅ Fait | `npm test` vert : 7 suites, 87 tests passés, 1 skipped propre |
| DOC-CLEANUP-1 | ✅ Fait | Doublons chantier archivés ; `chantier/README.md` corrigé |
| H1 plan | ✅ Fait | `docs/chantier/PLAN_H1_REFACTO_SERVER.md` ajouté |
| H1A-0 | ✅ Fait | PR #417. `bootstrap/api-routes.js` créé |
| H1A-1 | ✅ Fait | PR #418. `scripts/h1a-wire-api-routes.js` + doc codemod |
| H1A-2 | ✅ Fait | PR #427. `server.js` câblé via `bootstrap/api-routes.js` |
| H1A-2-FIX | ✅ Fait | PR #426. `sharedCart` conservé dans `server.js` |
| H1B | ✅ Fait | PR #443. `bootstrap/html-routes.js` câblé dans `server.js` |
| H1C-PREP | ✅ Fait | PR #441. `bootstrap/security.js` + codemod créés |
| H1C | ✅ Fait | PR #448. `applySecurity(app)` câblé dans `server.js` |
| H1D-PREP | ✅ Fait | PR #442. `bootstrap/crons.js` + codemod créés |
| H1D | ✅ Fait | PR #449. `startOperationalCrons` câblé dans `server.js` |
| H1E | ✅ Fait | PR #451. Validation env extraite dans `bootstrap/env.js` |
| H1F | ✅ Fait | PR #454. `runStartupMigrations` câblé dans `bootstrap/startup-migrations.js` |
| H2 | ✅ Fait | `server.js` lifecycle (listen/shutdown/crash guards) finalisé |
| H3 | ✅ Fait | `audit-backend-arch.js` déplacé de `docs/chantier/garde-fous/` → `scripts/` |
| F1B | ✅ Fait | `notification-service.js` migré vers logger structuré |
| F1-FULL | ✅ Fait | Migration `console.*` → logger structuré clôturée. Les seuls `console.*` tolérés sont le fallback interne de `utils/logger.js` quand `pino` est indisponible. Toute nouvelle occurrence hors fallback logger = régression. |
| F1-TEST-FIX | ✅ Fait | Commit `f6aca040`. `pino-pretty` désactivé en `NODE_ENV=test`; fallback logger réparé. `npm test` vert sans worker Jest ouvert. |
| P0-HELPER | ✅ Fait | PR #413 + #436. `npm run test:p0` reproductible |
| P0-RUNTIME | ✅ Fait | `npm test` ✅, Railway `/health` ✅, `/api/health` ✅. Dry-run refund validé avec `P0_ORDER_ID` réel. Tous les checks P0 passent. |
| P0-SHARED-CART | ✅ Fait | Panier partagé boutique actif : création depuis panier, téléphone créateur invité, `/mine`, sidebar/bannière/onglet Groupe, finalisation `fully_funded`, refund queue admin, `mark-refunded` manuel avec audit. |
| WORKSPACE-DECOMMISSION | ✅ Fait | PR #486 mergée. `collective workspace` legacy : pages `/event/*` et `/workspace/*` redirigées vers `/boutique`, API collective en `410`, orchestrateur no-op. |
| DOC-SYNC-BOUTIQUE-FIRST | 🔄 En cours | Alignement `STATUS.md` + docs boutique unifiées pour go-live ready. Pas de doc satellite. |
| I-SWEEP-FINAL | ✅ Fait | Violation I-01 pickup-secret.js résolue (I-SWEEP-1 mergé). /pay-cash → confirmPaymentCycle → transitionOrderStatus. /collect → transitionOrderStatus(source='patch'). Aucun UPDATE orders SET status direct. |
| SEC-1 | ✅ Fait | Rate-limit brute-force en DB depuis migration 049. Migration 070 appliquée : printTokens → pickup_print_tokens (TTL 2 min), REVEAL_CACHE → pickup_reveal_codes (TTL 30 min). Cron startPickupTokenCleanupCron câblé dans bootstrap/crons.js. Multi-instance safe. |
| GOD-FILES-0 | ✅ Fait | Cartographie + extractions : buildReceiptHTML → utils/pickup-receipt-html.js (−264 lignes), REVEAL_CACHE Map → table pickup_reveal_codes DB. pickup-secret.js : 1021 → 754 lignes. |
| BUG-CIRC-DEP | ✅ Fait | Dépendance circulaire calcPrix/calcPrixTenue supprimée. utils/pricing.js et routes/pricing.js s'auto-importaient (import fantôme ligne 13). routes/modules.js idem. Les 3 fichiers patchés : import supprimé, handlers /calculate et /couture réécrits via pricingEngine.recommend(). |
| GOD-FILES-1 | ✅ Fait | routes/pricing.js : 1318 → 283 lignes. services/pricing-recommend.js + services/pricing-dashboard.js créés. utils/pricing-cache.js créé. admin-pricing-matrices.js : import corrigé (TypeError silencieux supprimé). |
| BUG-LOG-STARTUP | ✅ Fait | `bootstrap/startup-migrations.js` : import `log` manquant ajouté. `bootstrap/server-lifecycle.js` : convention Pino corrigée (`{ err }` comme objet contexte). Migration 028/029 désimbriquées. |
| BUG-LOG-ENV | ✅ Fait | `bootstrap/env.js` : import `log` manquant ajouté (même bug que startup-migrations). |
| SEC-2 | ✅ Fait | `ADMIN_PASSWORD` promu de `recommendedEnv` → `requiredEnv` dans `bootstrap/env.js`. Bloquant au démarrage. |
| SEC-3 | ✅ Fait | grep localStorage — aucun `setItem` JWT en localStorage. Boutique déjà sur cookies httpOnly. Clos. |
| R1 | ✅ Fait | IDOR `GET /orders/:id` dans `routes/relay-dashboard.js` — guard scope relais ajouté (403 + log warn). Même pattern que `assertOrderBelongsToRelais` sur tous les POST. |

---

## Résultat de validation du 23 mai 2026

### `npm test` après patch logger

```text
Test Suites: 1 skipped, 7 passed, 7 of 8 total
Tests:       1 skipped, 87 passed, 88 total
Snapshots:   0 total
Time:        1.062 s
Ran all test suites.
```

La suite API intégration est volontairement skipped si `DATABASE_URL` est absent.

### `npm run test:p0` avec Railway (post-H1 complet)

```text
npm test                                     PASS
GET /health                                  PASS HTTP 200
GET /api/health                              PASS HTTP 200
admin order refund dry-run                   PASS HTTP 200
collective ready_to_capture repair dry-run   PASS HTTP 200
collective stock reservations repair dry-run PASS HTTP 200

P0 runtime verdict: PASS (tous les checks validés)
```

> Note 2026-05-25 : les lignes `collective ready_to_capture` et `collective stock reservations` sont historiques. Depuis PR #486, le runtime collectif est désactivé/tombstone. Les prochains tests go-live doivent cibler `/api/shared-carts/*`, `/cart/shared/:token`, la refund queue et `mark-refunded`.

---

## Pièges critiques à retenir

- `console.*` : F1 est clôturé. Les branches F1/logging restantes sont abandonnées et doivent être supprimées côté GitHub/local. Toute nouvelle occurrence hors fallback `utils/logger.js` doit être traitée comme régression.
- `log` non importé : pattern récurrent — `startup-migrations.js` ET `env.js` avaient le même bug (ReferenceError silencieux avalé par le catch global). Tout nouveau fichier bootstrap doit avoir `const log = require('../utils/logger').child({ module: '...' })` en ligne 3.
- Pino calling convention : `log.error('msg:', err.message)` → le second string arg est silencieusement ignoré. Toujours passer `log.error({ err }, 'message')` pour sérialiser l'erreur complète.
- IDOR relay-dashboard : GET /orders/:id n'avait pas de scope guard. Les POST (incident/comment/escalate/client-absent) étaient protégés via `assertOrderBelongsToRelais` mais pas le GET. Pattern à vérifier sur tout nouvel endpoint de lecture.
- `utils/logger.js` : en test, ne pas réactiver `pino-pretty` sans fermer explicitement le worker, sinon Jest détecte un open handle.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- A4 : collisions 060/061 clarifiées — dette non bloquante ; ne pas renommer/supprimer de migration sans audit DB réel.
- H1 complet : `server.js` (206 lignes) délègue maintenant à `bootstrap/env.js`, `security.js`, `api-routes.js`, `html-routes.js`, `crons.js`, `startup-migrations.js`. Les webhooks Stripe raw restent explicitement avant `express.json`.
- I-07 / webhooks Stripe : ne jamais déplacer les raw body parsers derrière `express.json`. Cela concerne les webhooks paiement classiques et shared-carts. Le webhook collectif legacy peut rester monté techniquement mais il ne doit plus traiter de paiement produit actif.
- Tests : `npm test` vert. Suite API intégration = skip propre sans env DB.
- ✅ P0 FULL validé : tous les dry-runs passent, y compris refund avec `P0_ORDER_ID` réel.
- I-SWEEP-FINAL ✅ — Violation I-01 pickup-secret.js résolue. /pay-cash → confirmPaymentCycle → transitionOrderStatus. /collect → transitionOrderStatus(source='patch'). Aucun UPDATE orders SET status direct.
- SEC-1 ✅ — Maps in-memory pickup-secret.js migrées en DB (migration 070). Cron startPickupTokenCleanupCron toutes les 5 min dans bootstrap/crons.js.
- Tokens pickup : `pickup_print_tokens` TTL 2 min et `pickup_reveal_codes` TTL 30 min sont DB-backed. `printTokens` Map reste in-memory, TTL 2 min, faible volume ; à migrer en SEC-1b si passage multi-instance strict.
- SEC-3 ✅ — aucun `setItem` JWT en localStorage. Boutique sur cookies httpOnly. Toute réintroduction de JWT localStorage est une régression go-live.
- BUG-CIRC-DEP ✅ — `calcPrix` et `calcPrixTenue` n'existaient nulle part. utils/pricing.js et routes/pricing.js s'auto-importaient (dépendance circulaire). 3 fichiers patchés. Warnings Node.js supprimés au boot.

---

## Prochain lot recommandé

### DOC-SYNC-BOUTIQUE-FIRST — Alignement docs go-live

```text
Charge   : 1 courte session
Risque   : faible si diff relu
Objectif : docs canoniques alignées avec le runtime boutique-first avant go-live ready
```

À faire dans les documents unifiés existants, sans doc satellite :

- `docs/chantier/STATUS.md` — état chantier et garde-fous sécurité/tokens ;
- `public/boutique/docs/BOUTIQUE_SOURCE_OF_TRUTH.md` — owner actif `b-share-cart.js`, legacy `b-group-cart-flow.js` ;
- `public/boutique/docs/CARTOGRAPHY_360_BOUTIQUE.md` — `/event/*` et `/workspace/*` legacy redirigés vers `/boutique`.

### Rappel : actions manuelles DB en attente

```bash
# M1 — supprimer la migration 068 cassée et appliquer la bonne
rm migrations/068_check_balance_non_negative.sql
psql $DATABASE_URL -f migrations/068_wallets_check_balance.sql

# M2 — hors transaction (CREATE INDEX CONCURRENTLY interdit dans BEGIN)
psql $DATABASE_URL -f migrations/069_analytical_indexes.sql
```

---

## Dette sécurité séparée

### Tokens / sessions / secrets à garder visibles avant go-live

```text
Charge   : 0.5 jour si durcissement multi-instance strict
Risque   : moyen si oublié avant scale-out
Prérequis : lire CONTRACTS.md + pickup-secret.js + bootstrap/crons.js
```

Points à ne pas perdre :

- pickup reveal/print token DB-backed depuis migration 070 ;
- `printTokens` Map encore in-memory, TTL court, faible volume ;
- aucun JWT en localStorage ;
- `ADMIN_PASSWORD` required au boot ;
- rate-limits globaux/admin/auth/cash/scan/order actifs ;
- webhooks Stripe raw body avant `express.json`.

### I-SWEEP-FINAL — Correction violation I-01 active (`routes/pickup-secret.js:286`)

Statut : ✅ résolu.

---

## File d'attente

| Lot | Priorité | Note |
|-----|----------|------|
| DOC-SYNC-BOUTIQUE-FIRST | ▶️ Maintenant | Alignement des docs canoniques sur panier partagé boutique-first / workspace tombstone |
| GO-LIVE-CHECK | Ensuite | Rejouer `npm test`, `/health`, `/api/health`, shared-cart create/contribute/finalize/refund-queue/mark-refunded |
| M1 | Manuel DB | Confirmer/supprimer migration 068 cassée, appliquer 068_wallets_check_balance.sql |
| M2 | Manuel DB | Appliquer migration 069 hors transaction |
| SEC-1b | Conditionnel scale-out | Migrer le reliquat `printTokens` Map si multi-instance strict |
| PRICE-1 | Conditionnelle | Uniquement si go-live checks révèlent un ajustement pricing/catalogue |

---

## Dette mesurée au 25 mai 2026

- **`server.js`** : refactoring H1 terminé. Webhooks Stripe raw toujours explicitement avant `express.json`.
- **`console.*`** : ✅ migration F1 terminée. Les seuls `console.*` tolérés sont dans le fallback interne de `utils/logger.js`.
- **Migrations** : collisions 060/061 connues, non bloquantes, préservées documentairement. M1/M2 manuels encore à confirmer.
- **Tests** : 87 passés, 1 skipped propre dans la dernière validation connue — filet solide mais à rejouer avant go-live.
- **Panier partagé** : modèle actif boutique-first. Backend financier sécurisé par webhook Stripe, anti-surfinancement, refund queue, mark-refunded manuel avec audit.
- **Collective workspace** : runtime désactivé/tombstone depuis PR #486. Ne plus construire de nouvelle fonctionnalité dessus.
- **Migration 070** : pickup_print_tokens + pickup_reveal_codes créées. SEC-1 clos côté REVEAL_CACHE. `printTokens` Map encore in-memory, faible volume, non bloquant court terme.
- **calcPrix/calcPrixTenue** : fonctions fantômes supprimées. 3 fichiers patchés (utils/pricing.js, routes/pricing.js, routes/modules.js). Warnings circular dependency éliminés au boot.
- **Routing init error** : message vide au boot — ensureRoutingColumns absorbe ses propres erreurs en interne, le log Railway est un artefact bénin (function ne throw pas). Non bloquant.

---


---

## Traçage dette technique résiduelle (DETTE_TECHNIQUE_RESIDUELLE.md — 2026-05-24)

### Findings de l'analyse ANALYSE_BACKEND_KOMERCE (session 24 mai)

| # | Finding | Statut | Notes |
|---|---|---|---|
| N1 | GET /relay/dashboard filtre relais_id | ✅ Corrigé | relay-dashboard.js lignes 98–99, 124–128, 174–176 |
| N2 | Dual userCache Maps auth.js / auth-guest.js | ✅ Corrigé | utils/user-cache.js créé |
| N3 | invalidateChargesCache() manquant après update orders_per_month | ✅ Corrigé | economic-engine.js lignes 569–574 |
| N4 | JWT stateless 90j, pas de révocation | ⏳ Dette architecturale connue | Non bloquant go-live |
| M1 | Migration 068 double — 068_check_balance_non_negative.sql cassé | ❓ À confirmer | Supprimer le fichier cassé, appliquer 068_wallets_check_balance.sql manuellement |
| M2 | Migration 069 — CREATE INDEX CONCURRENTLY hors transaction | ❓ À confirmer | Appliquer manuellement : `psql $DATABASE_URL -f migrations/069_analytical_indexes.sql` |
| I-01 | Violation pickup-secret.js | ✅ Résolu | I-SWEEP-FINAL mergé |
| SEC-1 | Rate-limit pickup in-memory | ✅ Résolu | Migration 070 + cron bootstrap/crons.js |
| SEC-2 | ADMIN_PASSWORD en dur dans startup-migrations | ✅ Fait | Promu en REQUIRED_ENV dans bootstrap/env.js |
| SEC-3 | JWT localStorage pages HTML legacy | ✅ Fait | Aucun setItem JWT. Boutique sur cookies httpOnly. Clos. |
| ARCH-1 | core.zip 8,5 Mo dans le repo | ✅ Fait | |
| ARCH-2 | Gaps numérotation migrations | ✅ Fait | migrations/GAPS.md créé |
| ARCH-3 | Fichier orphelin utils/_parcelSync-v2.ORPHAN.js | ✅ Fait | Fichier supprimé |
| BUG-CIRC-DEP | calcPrix/calcPrixTenue dépendance circulaire | ✅ Résolu | 3 fichiers patchés (utils/pricing.js, routes/pricing.js, routes/modules.js) |

### Risques résiduels (DETTE_TECHNIQUE_RESIDUELLE.md)

| # | Item | Fichier | Sévérité | Effort | Statut |
|---|---|---|---|---|---|
| R1 | IDOR inter-relais — incidents/comments/escalades sans scope relais_id | relay-dashboard.js | 🔴 Haute | 1h | ✅ Fait — guard ajouté dans GET /orders/:id (403 + log warn) |
| R2 | POST /apply wallet sans guard order.status cancelled | wallet.js | 🟡 Moyenne | 15 min | ✅ Fait — BLOCKED_STATUSES guard (cancelled/refunded/collected) présent |
| R3 | Contrainte DB CHECK (balance_kmf >= 0) manquante | Migration 068 | 🟡 Moyenne | 10 min | ❓ M1 lié — à confirmer |
| R4 | ALLOW_FLUSH distinct de ALLOW_SEED dans admin.js | admin.js | 🟡 Moyenne | 5 min | ✅ Fait — ALLOW_FLUSH distinct de ALLOW_SEED, hint Railway ajouté |
| R5 | confirmed→ordered non-fatal sans alerte dans payment-confirmation | order-payment-confirmation.js | 🟡 Moyenne | 20 min | ✅ Fait — _alertNotificationFailure + INSERT alerts sur rejet confirmed→ordered |
| R6 | DELETE+INSERT non atomique dans allocateMonthlyFixedCosts | cost-allocation.js | 🟡 Moyenne | 1h | ✅ Fait — DELETE + INSERT dans BEGIN/COMMIT, provision_risque_pct depuis finance_config |
| R7 | INSERT scans sans scan_code dans hub-dashboard | hub-dashboard.js | 🟡 Moyenne | 15 min | ✅ Fait — scan_code synthétique généré pour scans hub automatiques |
| D1 | Rétention economic_snapshots | Cron | 🟢 Faible | 30 min | ✅ Résolu — startSnapshotRetentionCron dans bootstrap/crons.js (90 jours, toutes les 24h) |
| D2 | Index DB manquants sur requêtes analytiques lourdes | DB | 🟡 Moyenne | 2-4h | ❓ Migration 069 à appliquer hors transaction (M2) |
| D3 | Deux tables scan coexistent (scans + scan_events) sans plan migration | Architecture | 🟡 Moyenne | Planning | ✅ Fait |
| D4 | notification-service : pas de retry ni d'alerte sur échec envoi | notification-service.js | 🟡 Moyenne | 2h | ✅ Fait |
| ND1 | Audit middleware/auth.js et auth-guest.js | — | 🟡 Moyenne | 1h | ✅ Audité — N2 corrigé, userCache unifié |
| ND2 | Audit utils/rates.js (cache TTL, fallbacks) | — | 🟡 Moyenne | 30 min | ✅ Fait |
| ND3 | Audit utils/eco-bridge.js (SSOT v6.7, invalidation cache) | — | 🟡 Moyenne | 30 min | ✅ N3 corrigé — invalidateChargesCache() présent |
| ND4 | Audit services/order-cost-snapshot.js (idempotence) | — | 🟢 Faible | 30 min | ✅ Fait |
| ND5 | Vérification schema scans.scan_code NOT NULL | DB migrations | 🟡 Moyenne | 15 min | ✅ Fait |
| ND6 | Exposition pickup_code dans endpoints client (client-account.js) | client-account.js | 🟡 Moyenne | 30 min | ✅ Fait |

### Verdicts audits routes (session 25 mai)

| Fichier | Verdict | Notes |
|---|---|---|
| routes/relay-dashboard.js | ✅ Corrigé | R1 clos — guard scope relais sur GET /orders/:id |
| routes/shared-cart.js | ✅ OK | I-07 ✅, idempotence ✅, délègue engine ✅, modèle actif panier partagé boutique-first |
| routes/collective-workspaces.js | ✅ Tombstone | Legacy déclassé depuis PR #486 : répond `410 collective_workspace_disabled`, ne délègue plus aux services métier |
| services/collective-payment-orchestrator.js | ✅ Tombstone | No-op : pas de cron, pas de PaymentIntent collectif, webhooks ignorés |
| routes/client-tracking.js | ✅ OK | Lecture seule ✅ |
| routes/client-account.js | ✅ OK | ND6 clos — exposition pickup_code traitée |
| routes/baskets.js | 🟡 À surveiller | Prix snapshotés sans TTL ni alerte de divergence |
| routes/orders/status.js | ✅ OK | 100% via transitionOrderStatus() ✅ |
| routes/relais.js | ✅ OK | Court, CRUD propre, mutations admin only ✅ |
| services/notification-service.js | ✅ Corrigé | D4 clos — retry/alerte traité dans dette résiduelle |

### Ordre de traitement recommandé (mis à jour 25 mai 2026)

**Immédiat** : DOC-SYNC-BOUTIQUE-FIRST puis GO-LIVE-CHECK.

**Avant go-live** : M1 (confirmer 068), M2 (appliquer 069 hors transaction), rejouer `npm test`, `/health`, `/api/health`, et le flux shared-cart complet.

**Conditionnel scale-out** : SEC-1b si on veut supprimer le dernier reliquat in-memory `printTokens` avant multi-instance strict.

**Backlog** : R3 (lié M1), D2 (EXPLAIN), ND4 (cost-snapshot idempotence), ARCH-1/2/3, PRICE-1 conditionnel.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.
