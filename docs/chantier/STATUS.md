# Komerce Backend — État du chantier
> Mis à jour : 2026-05-24 (session après-midi)
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

## Invariants à garder en tête

| ID | Invariant |
|----|-----------|
| I-01 | Ne jamais modifier `orders.status` hors machine de statut |
| I-02 | Paiements Stripe/cash/wallet/shared cart/collectif → uniquement `pending → confirmed` |
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
- Tests : `npm test` vert. Suite API intégration = skip propre sans env DB.
- ✅ P0 FULL validé : tous les dry-runs passent, y compris refund avec `P0_ORDER_ID` réel.
- I-SWEEP-FINAL ✅ — Violation I-01 pickup-secret.js résolue. /pay-cash → confirmPaymentCycle → transitionOrderStatus. /collect → transitionOrderStatus(source='patch'). Aucun UPDATE orders SET status direct.
- SEC-1 ✅ — Maps in-memory pickup-secret.js migrées en DB (migration 070). Cron startPickupTokenCleanupCron toutes les 5 min dans bootstrap/crons.js.
- BUG-CIRC-DEP ✅ — `calcPrix` et `calcPrixTenue` n'existaient nulle part. utils/pricing.js et routes/pricing.js s'auto-importaient (dépendance circulaire). 3 fichiers patchés. Warnings Node.js supprimés au boot.
- `printTokens` Map (ligne 237 de pickup-secret.js) : toujours in-memory — tokens d'impression cash, TTL 2 min, volume très faible. À migrer en lot SEC-1b si passage multi-instance.

---

## Prochain lot recommandé

### GOD-FILES-1 — Extraction pricing-recommend + pricing-dashboard

```text
Charge   : 1 session
Risque   : moyen (20+ consommateurs de routes/pricing.js)
Objectif : descendre routes/pricing.js de 1310 → ~350 lignes
```

Plan d'extraction validé en GOD-FILES-0 :
- `services/pricing-recommend.js` ← /recommend + /recommend-batch (518 lignes sorties)
- `services/pricing-dashboard.js` ← /dashboard + /benchmarks + /benchmarks-gap (445 lignes sorties)

Prérequis : vérifier que `_applies()` et `_arrondiPsycho()` ne sont pas importés directement ailleurs (privés actuellement). Lire CONTRACTS.md avant de toucher aux exports.

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

### I-SWEEP-FINAL — Correction violation I-01 active (`routes/pickup-secret.js:286`)

```text
Charge   : 0.5 jour
Risque   : moyen (modifier orders.status en dehors de la machine)
Prérequis : lire CONTRACTS.md + order-status-machine.js avant de toucher
```

Cette dette reste importante, mais elle n'est pas le prochain lot si l'objectif immédiat est le chantier god files.

Contraintes :
- passer par `order-status-machine.js` pour toute transition de statut ;
- tracer dans `order_status_history` (I-04) ;
- `npm test` vert après.

---

## File d'attente

| Lot | Priorité | Note |
|-----|----------|------|
| GOD-FILES-1 | ▶️ Maintenant | Extraction pricing-recommend.js + pricing-dashboard.js depuis routes/pricing.js |
| R2 | Sécurité | POST /apply wallet sans guard order.status cancelled (15 min) |
| R4 | Sécurité | ALLOW_FLUSH distinct de ALLOW_SEED dans admin.js (5 min) |
| R7 | Sécurité | INSERT scans sans scan_code dans hub-dashboard (15 min) |
| SEC-2 | ✅ Fait | ADMIN_PASSWORD promu en REQUIRED_ENV dans bootstrap/env.js |
| SEC-3 | ✅ Fait | grep localStorage — clos, aucune exposition |
| P0-FULL | ✅ Fait | `P0_ORDER_ID` fourni — dry-run refund PASS. P0 entièrement validé. |
| PRICE-1 | Conditionnelle | Uniquement si P0-FULL révèle un ajustement pricing/catalogue |

---

## Dette mesurée au 23 mai 2026

- **`server.js`** : 206 lignes — tout le refactoring H1 terminé. Seuls les webhooks Stripe raw et le bloc `listen/shutdown` restent en place (intentionnel).
- **`console.*`** : ✅ migration F1 terminée. Les seuls `console.*` tolérés sont dans le fallback interne de `utils/logger.js`.
- **Migrations** : collisions 060/061 connues, non bloquantes, préservées documentairement.
- **Tests** : 87 passés, 1 skipped propre — filet solide.
- **God files** : GOD-FILES-0 terminé. pickup-secret.js : 1021 → 754 lignes. utils/pickup-receipt-html.js créé. routes/pricing.js et utils/pricing.js : dépendance circulaire supprimée, handlers réécrits.
- **Migration 070** : pickup_print_tokens + pickup_reveal_codes créées. SEC-1 clos côté REVEAL_CACHE. printTokens Map encore in-memory (faible volume, non bloquant).
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

### Verdicts audits routes (session 24 mai)

| Fichier | Verdict | Notes |
|---|---|---|
| routes/relay-dashboard.js | 🔴 À corriger | IDOR R1 — voir ci-dessus |
| routes/shared-cart.js | ✅ OK | I-07 ✅, idempotence ✅, délègue engine ✅ |
| routes/collective-workspaces.js | ✅ OK | Délègue services ✅, auth ✅ |
| routes/client-tracking.js | ✅ OK | Lecture seule ✅ |
| routes/client-account.js | 🟡 À surveiller | pickup_code exposition à vérifier (ND6) |
| routes/baskets.js | 🟡 À surveiller | Prix snapshotés sans TTL ni alerte de divergence |
| routes/orders/status.js | ✅ OK | 100% via transitionOrderStatus() ✅ |
| routes/relais.js | ✅ OK | Court, CRUD propre, mutations admin only ✅ |
| services/notification-service.js | 🟡 À surveiller | Pas de retry ni d'alerte sur échec (D4) |

### Ordre de traitement recommandé (mis à jour 24 mai 2026)

**Immédiat** : M1 (confirmer 068), M2 (appliquer 069 hors transaction), R2 (wallet guard), R4 (ALLOW_FLUSH), R7 (scan_code hub), GOD-FILES-1 (extraction pricing-recommend + pricing-dashboard).

**Sprint suivant** : R5, R6, D3 (plan scan_events), D4 (notification retry), ND2 (rates.js), ND5 (scan_code schema), ND6 (pickup_code client).

**Backlog** : R3 (lié M1), D2 (EXPLAIN), ND4 (cost-snapshot idempotence), ARCH-1/2/3.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.