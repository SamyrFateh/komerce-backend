# Komerce Backend — État du chantier
> Mis à jour : 2026-05-21
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
| A4 | ✅ Fait | Audit `docs/chantier/AUDIT_MIGRATIONS_060_061.md`. Collisions 060/061 reconnues comme dette réelle mais non bloquante : le runner actif ne parcourt pas automatiquement les SQL. Aucun renommage/suppression de migration. |
| A5 | ✅ Fait | `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ajouté |
| A6 | ✅ Fait | Issue #387 créée |
| A7 | ✅ Fait | Docs parasites archivées ; `AGENTS.md` corrigé |
| D0 | ✅ Fait avec hotfix | Fallback QR supprimé ; démarrage Railway restauré |
| D1-D8 | ✅ Fait | Audits sécurité, env, rate limit, CORS, Helmet/CSP documentés |
| G1-G5 | ✅ Fait | Audits flows cash, Stripe, collectif, annulation, sourcing/catalogue documentés |
| I-SWEEP-0 à I-SWEEP-6C | ✅ Fait | Corrections critiques cash, QR, Stripe, purchasing, collectif, refund, pricing, publication/stock mergées |
| TEST-1A | ✅ Fait | PR #409 mergée. Filet Jest sans DB réelle : invariants I-SWEEP/G1-G5 + helpers publication/prix/stock |
| TEST-1B | ✅ Fait | Commit `28aae996` sur main. Tests Jest avec mocks DB transactionnels : cash pickup commit/rollback et réception PO commit/rollback |
| TEST-DEBT | ✅ Fait | `npm test` vert : 7 suites passées, 1 suite intégration API skip propre sans `DATABASE_URL`; 87 tests passés, 1 skipped |
| DOC-CLEANUP-1 | ✅ Fait | Doublons chantier archivés ; `chantier/README.md` corrigé ; `PROMPTS_KIT_POST_CRITIQUE.md` complété |
| H1 plan | ✅ Fait | `docs/chantier/PLAN_H1_REFACTO_SERVER.md` ajouté |
| H1A-0 | ✅ Fait | PR #417 mergée. Ajout `bootstrap/api-routes.js` |
| H1A-1 | ✅ Fait | PR #418 mergée. Ajout `scripts/h1a-wire-api-routes.js` + doc codemod |
| H1A-2 | ✅ Fait | PR #427 mergée. `server.js` câblé via `bootstrap/api-routes.js`, sans déplacer webhooks raw, `express.json`, HTML routes, crons, migrations inline ni listen/shutdown |
| H1A-2-FIX | ✅ Fait | PR #426 mergée. Le codemod conserve `sharedCart` dans `server.js` |
| H1B | ✅ Fait | PR #443 mergée. `server.js` câble `bootstrap/html-routes.js` via `mountHtmlRoutes(app, __dirname)` ; bloc HTML/SPA fallback extrait sans toucher webhooks raw, API routes, crons, migrations inline ni listen/shutdown. Validation post-merge : `npm test` PASS, P0 runtime PARTIAL propre. |
| H1C-PREP | ✅ Fait | PR #441 mergée. Ajout `bootstrap/security.js`, `scripts/h1c-wire-security.js` et doc H1C ; pas encore câblé dans `server.js`. |
| H1D-PREP | ✅ Fait | PR #442 mergée. Ajout `bootstrap/crons.js`, `scripts/h1d-wire-crons.js` et doc H1D ; pas encore câblé dans `server.js`. |
| P0-HELPER | ✅ Fait | PR #413 + PR #436. `npm run test:p0` reproductible ; 401/403 admin dry-runs classés SKIP explicite si JWT admin invalide |
| P0-RUNTIME | 🟠 PARTIAL propre | `npm test` ✅, Railway `/health` ✅, Railway `/api/health` ✅. Dry-runs admin collectifs SKIP en 401 car JWT admin valide requis. Refund dry-run SKIP sans `P0_ORDER_ID`. |

---

## Résultat de validation du 21 mai 2026

### `npm test`

```text
Test Suites: 1 skipped, 7 passed, 7 of 8 total
Tests:       1 skipped, 87 passed, 88 total
```

La suite API intégration est volontairement skipped si `DATABASE_URL` est absent, afin d'éviter d'importer `server.js` et son garde runtime `process.exit(1)`. Elle reste exécutable avec un vrai environnement DB/JWT.

### `npm run test:p0` avec Railway après H1B

```text
npm test                                     PASS
GET /health                                  PASS HTTP 200
GET /api/health                              PASS HTTP 200
admin order refund dry-run                   SKIP P0_ORDER_ID absent
collective ready_to_capture repair dry-run   SKIP HTTP 401 — JWT admin valide requis
collective stock reservations repair dry-run SKIP HTTP 401 — JWT admin valide requis

P0 runtime verdict: PARTIAL (3 skipped)
```

Conclusion : le runtime est sain. Le `PARTIAL` restant n'est pas une panne ; il manque seulement un vrai JWT admin et, pour le refund dry-run, un `P0_ORDER_ID` testable.

---

## Pièges critiques à retenir

- `console.log` : environ 365+ occurrences ; F1 est un gros lot, pas un petit nettoyage.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- ✅ A4 : collisions 060/061 clarifiées. Dette réelle, non bloquante au boot actuel ; ne pas renommer/supprimer de migration déjà mergée sans audit DB réel.
- ✅ H1A : manifest + câblage `server.js` réalisés. Les webhooks raw Stripe restent explicitement avant `express.json`; les blocs Stripe-owned partagés/collectifs restent dans `server.js`.
- ✅ H1B : routes HTML/SPA fallback extraites dans `bootstrap/html-routes.js` et câblées dans `server.js`.
- ✅ Tests : `npm test` est vert. La suite API intégration est un skip propre sans env DB.
- 🟠 P0 est PARTIAL propre : health Railway OK, admin dry-runs protégés mais non exécutés faute de JWT admin valide / `P0_ORDER_ID`.
- ✅ Routes admin collectives : exposées via `routes/admin-collective-repairs.js` et montées dans `bootstrap/api-routes.js`.
- ✅ Refund doctrine : endpoint admin explicite ; `cancelled` reste métier, `refunded` devient financier après action explicite.
- 🟠 Collectif restant : transition `ordered` collective post-commit reste non fatale ; à couvrir par test/alerte si nécessaire.

---

## Prochain lot recommandé

### H1C — Câbler l'extraction security/CORS/Helmet hors `server.js`

```text
Branche   : refactor/H1C-wire-security
Charge    : 0.5 jour
Risque    : moyen
Prérequis : H1A + H1B terminés, npm test vert, P0 runtime PARTIAL propre
```

Objectif : poursuivre la découpe progressive de `server.js` en câblant le module `bootstrap/security.js` déjà préparé.

Contraintes :

- Ne pas déplacer les webhooks Stripe raw.
- Ne pas déplacer `express.json`.
- Ne pas déplacer les routes API.
- Ne pas déplacer les routes HTML H1B.
- Ne pas déplacer les crons.
- Ne pas déplacer les migrations inline.
- Ne pas modifier la logique business.
- Utiliser `scripts/h1c-wire-security.js` avec diff contrôlé.

Validation attendue :

```bash
node scripts/h1c-wire-security.js --check
node scripts/h1c-wire-security.js --write
git diff -- server.js
npm test
npm run test:p0
```

---

## File d'attente après H1C

| Lot | Priorité | Note |
|-----|----------|------|
| H1D | Moyen | Câbler extraction crons après H1C |
| H1E | Moyen | Extraire env validation |
| H1F | Prudence | Plan séparé migrations inline, pas de suppression sans audit DB |
| P0-FULL | Conditionnelle | Fournir JWT admin valide + `P0_ORDER_ID` pour transformer P0 PARTIAL en PASS complet |
| PRICE-1 | Conditionnelle | Uniquement si P0 révèle un ajustement pricing/catalogue |
| F1 suite logging | Haute mais découpé | Continuer migration logger par domaines, notamment `notification-service.js` via codemod |
| H3 | Hygiène | Déplacer `chantier/garde-fous/audit-backend-arch.js` vers `scripts/` |

### Dette mesurée au 21 mai 2026 — référence

- **19 god-objects ≥ 800 lignes** : découpe commencée par H1A/H1B mais non généralisée.
- **`server.js`** : routes API et routes HTML/SPA fallback externalisées ; security/CORS/Helmet, crons, migrations inline et listen/shutdown restent encore dans le fichier.
- **`console.*`** : dette logging toujours présente ; F1 reste prioritaire mais doit rester découpé.
- **Migrations** : collisions 060/061 clarifiées par A4 ; runner actuel n'exécute pas automatiquement les `.sql`, donc pas bloquant mais à préserver documentairement.
- **Tests** : filet I-SWEEP OK et `npm test` vert ; suite API intégration complète à jouer uniquement avec env DB/JWT.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.
