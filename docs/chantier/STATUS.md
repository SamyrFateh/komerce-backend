# Komerce Backend — État du chantier
> Mis à jour : 2026-05-23
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
| P0-RUNTIME | 🟠 PARTIAL propre | `npm test` ✅, Railway `/health` ✅, `/api/health` ✅. Dry-runs admin SKIP faute de JWT admin valide / `P0_ORDER_ID`. |
| GOD-FILES-0 | ▶️ Prochain | Audit des fichiers obèses restants avant découpage. Aucun patch métier sans plan d'extraction. |

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
admin order refund dry-run                   SKIP P0_ORDER_ID absent
collective ready_to_capture repair dry-run   PASS HTTP 200
collective stock reservations repair dry-run PASS HTTP 200

P0 runtime verdict: PARTIAL (1 skipped — refund uniquement)
```

---

## Pièges critiques à retenir

- `console.*` : F1 est clôturé. Les branches F1/logging restantes sont abandonnées et doivent être supprimées côté GitHub/local. Toute nouvelle occurrence hors fallback `utils/logger.js` doit être traitée comme régression.
- `utils/logger.js` : en test, ne pas réactiver `pino-pretty` sans fermer explicitement le worker, sinon Jest détecte un open handle.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- A4 : collisions 060/061 clarifiées — dette non bloquante ; ne pas renommer/supprimer de migration sans audit DB réel.
- H1 complet : `server.js` (206 lignes) délègue maintenant à `bootstrap/env.js`, `security.js`, `api-routes.js`, `html-routes.js`, `crons.js`, `startup-migrations.js`. Les webhooks Stripe raw restent explicitement avant `express.json`.
- Tests : `npm test` vert. Suite API intégration = skip propre sans env DB.
- 🟠 P0 PARTIAL : seul le dry-run refund est encore en SKIP — nécessite `P0_ORDER_ID` réel.
- Violation I-01 active : `routes/pickup-secret.js:286` — différée intentionnellement, à traiter en lot I-SWEEP-FINAL groupé. **Ne pas corriger à la volée.**

---

## Prochain lot recommandé

### GOD-FILES-0 — Audit des fichiers obèses restants

```text
Charge   : 0.5 session pour audit + classement
Risque   : faible tant qu'on ne modifie pas le code
Objectif : identifier, classer et prioriser les fichiers ≥ 800 lignes encore actifs
```

But : passer des refactos structurelles déjà terminées (`server.js`, bootstrap, logging) à un chantier maîtrisé sur les gros fichiers restants.

Règles :
- aucune modification métier dans GOD-FILES-0 ;
- pas de découpage avant cartographie du fichier ;
- pas de déplacement de logique sans tests ou garde-fous ;
- un god file = un plan d'extraction documenté avant patch ;
- commencer par les fichiers UI/front ou utilitaires à faible risque ;
- éviter paiements, commandes, scans, collectif sans lecture préalable de `CONTRACTS.md` + `ZONE_IMPACT.md`.

Livrable attendu :
- liste des fichiers ≥ 800 lignes ;
- classement par risque : faible / moyen / élevé ;
- premier candidat recommandé ;
- plan d'extraction du premier candidat, sans patch métier.

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
| GOD-FILES-0 | ▶️ Maintenant | Audit + classement des fichiers ≥ 800 lignes, sans patch métier |
| I-SWEEP-FINAL | Sécurité | Corriger `routes/pickup-secret.js:286` (violation I-01 active) — lot groupé, pas à la volée |
| P0-FULL | Conditionnelle | Fournir `P0_ORDER_ID` pour transformer dry-run refund SKIP → PASS |
| PRICE-1 | Conditionnelle | Uniquement si P0-FULL révèle un ajustement pricing/catalogue |

---

## Dette mesurée au 23 mai 2026

- **`server.js`** : 206 lignes — tout le refactoring H1 terminé. Seuls les webhooks Stripe raw et le bloc `listen/shutdown` restent en place (intentionnel).
- **`console.*`** : ✅ migration F1 terminée. Les seuls `console.*` tolérés sont dans le fallback interne de `utils/logger.js`.
- **Migrations** : collisions 060/061 connues, non bloquantes, préservées documentairement.
- **Tests** : 87 passés, 1 skipped propre — filet solide.
- **God files** : chantier suivant. Les fichiers ≥ 800 lignes doivent être recensés et classés avant tout patch.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.