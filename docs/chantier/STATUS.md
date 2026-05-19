# Komerce Backend — État du chantier
> Mis à jour : 2026-05-19
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
| A6 | ✅ Fait | Issue #387 créée |
| D0 | ✅ Fait avec hotfix | Fallback QR supprimé ; démarrage Railway restauré |
| D1 | ✅ Fait | Audit couverture auth admin documenté |
| D2 | ✅ Fait | Audit webhooks Stripe/idempotence documenté |
| D3 | ✅ Fait | Audit `auth-guest.js` documenté |
| D4 | ✅ Fait | Audit QR / pickup-secret documenté |
| D5 | ✅ Fait partiel | Audit env documenté ; `.env.example` à reprendre localement |
| D6 | ✅ Fait | Audit rate limiting documenté |
| D7 | ✅ Fait | Audit CORS production documenté |
| D8 | ✅ Fait | Audit Helmet/CSP production documenté |
| G1 | ✅ Fait | Audit flow cash → retrait documenté |
| G2 | ✅ Fait | Audit flow Stripe → préparation hub documenté |
| G3 | ✅ Fait | Audit flow collectif → contributions → commande documenté |
| G4 | ✅ Fait | Audit annulation après paiement documenté |
| G5 | ✅ Fait | Audit sourcing → produit → mise en vente documenté |
| I-SWEEP-0 | ✅ Fait | Checklist créée |
| I-SWEEP-1 | ✅ Fait | `/api/pickup/pay-cash/:orderId` passe par `confirmPaymentCycle(...)` |
| I-SWEEP-2 | ✅ Fait | `verify-qr` synchronise order/scan/parcels dans une transaction |
| I-SWEEP-3A | ✅ Fait | Stripe intent idempotent par commande |
| I-SWEEP-3B | ✅ Fait | `triggerPurchasing` idempotent par `order_id + product_supplier_id` |
| I-SWEEP-3C | ✅ Fait | Repair ordered sans PO existant ; réception PO transactionnelle ajoutée |
| I-SWEEP-4A | ✅ Fait | PR #402 mergée. Repair admin dry-run `POST /api/admin/collective/repair-ready-to-capture` pour sessions collectives `ready_to_capture` anciennes sans order liée. |
| I-SWEEP-4B | ✅ Fait | PR #403 mergée. Repair admin dry-run `POST /api/admin/collective/repair-stock-reservations` : consomme les réservations des workspaces avec order et libère/expire celles des sessions/workspaces terminés sans order. |
| I-SWEEP-5A | ✅ Fait | PR #404 mergée. Lors d'une annulation commande, les `purchase_orders` `pending/notified` sont annulées automatiquement ; les POs fournisseur déjà engagées créent une alerte opérationnelle. |
| I-SWEEP-5B | ✅ Fait | PR #405 mergée. Endpoint admin dry-run `POST /api/admin/orders/:orderId/refund` : refund Stripe via service idempotent existant, cash manuel par défaut avec alerte, option wallet credit explicite, puis `cancelled → refunded` après remboursement exécuté. |
| I-SWEEP-6A | ✅ Fait | PR #406 mergée. `price_history` est alimenté lors de la création produit (`product_create`) et lors des changements directs `PUT /api/products/:id` sur `price_kmf` (`product_update`). |
| I-SWEEP-6B | ✅ Fait | PR #407 mergée. `PUT /api/pricing/apply-price/:product_id` et `PUT /api/pricing/apply-all` passent par un service audité avec survival recalculé serveur et `price_history` par item. |
| I-SWEEP-6C | ✅ Fait | PR #408 mergée. Garde de publication catalogue ajoutée et audit minimal des changements de stock via `alerts` source `product_stock_audit`. |
| TEST-1A | ✅ Fait | PR #409 mergée. Filet Jest sans DB réelle : tests statiques d'invariants I-SWEEP/G1-G5 + tests de comportement sur helpers publication/prix/stock. |
| TEST-1B | ✅ Fait | Commit `28aae996` sur main. Tests Jest avec mocks DB transactionnels : cash pickup commit/rollback et réception PO commit/rollback. |
| A5 | ✅ Fait | `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ajouté |
| A7 | ✅ Fait | Docs parasites archivées ; `AGENTS.md` corrigé |
| DOC-CLEANUP-1 | ✅ Fait | Doublons `chantier/CARTOGRAPHY_360.md` et `chantier/ZONE_IMPACT.md` archivés ; `chantier/README.md` corrigé (audits à la racine, pas dans `audits/`) ; `PROMPTS_KIT_POST_CRITIQUE.md` complété par C1 (MAJ socle) et C2 (régénération SCHEMA). |
| H1 plan | ✅ Fait | Document `docs/chantier/PLAN_H1_REFACTO_SERVER.md` ajouté. Code non commencé. Première PR recommandée : H1A extraction du manifest routes API uniquement, sans toucher aux webhooks raw, parsers, crons, HTML routes ni migrations inline. |
| H1A-0 | ✅ Fait | PR #417 mergée. Ajout `bootstrap/api-routes.js` avec `mountApiRoutesBeforeStripeOwnedBlocks(app)` et `mountApiRoutesAfterStripeOwnedBlocks(app)`. Aucun impact runtime : `server.js` non câblé. |
| H1A-1 | ✅ Fait | PR #418 mergée. Ajout `scripts/h1a-wire-api-routes.js` + doc `docs/chantier/H1A_SERVER_WIRING_CODEMOD.md`. Codemod prêt pour appliquer localement le câblage `server.js` avec garde-fous. |
| P0 | 🟠 PARTIAL | Rapport `docs/chantier/VALIDATION_STAGING_2026-05-19.md` créé puis enrichi. Env critique présent et boot Railway PASS sur logs. `npm test`, `/health` et flows HTTP staging restent à exécuter. |
| P0-HELPER | ✅ Fait | PR #413 mergée. Ajout `scripts/p0-runtime-check.js`, commande `npm run test:p0` et doc `docs/chantier/P0_RUNTIME_CHECK.md` pour exécuter P0 runtime de façon reproductible. |

---

## Pièges critiques à retenir

- `console.log` : environ 365 occurrences ; F1 est un gros lot, pas un petit nettoyage.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- ✅ A4 : collisions 060/061 clarifiées. Dette réelle, non bloquante au boot actuel ; ne pas renommer/supprimer de migration déjà mergée sans audit DB réel.
- ✅ H1 plan : `server.js` doit être découpé en PRs petites ; ne pas déplacer les webhooks raw sous `express.json`, ne pas mélanger routes API, HTML, crons et migrations inline.
- ✅ H1A-0/H1A-1 : manifest + codemod prêts. `server.js` n'est pas encore câblé ; appliquer le codemod localement puis tester avant PR H1A-2.
- Tests : TEST-1A/1B posent un filet Jest sans DB réelle ; un futur E2E Railway/staging peut compléter.
- 🟠 P0 est PARTIAL : `npm test`, `/health`, `/api/health` et flows curl staging restent à exécuter dans un environnement runtime réel. Utiliser `npm run test:p0`.
- ✅ `pay-cash` corrigé par I-SWEEP-1.
- ✅ QR verify/parcels corrigé par I-SWEEP-2.
- ✅ Stripe intent idempotent par I-SWEEP-3A.
- ✅ Purchasing replay corrigé par I-SWEEP-3B.
- ✅ Purchasing repair/réception amélioré par I-SWEEP-3C.
- ✅ Collectif `ready_to_capture` : repair admin ajouté par I-SWEEP-4A.
- ✅ Collectif réservations stock : repair admin ajouté par I-SWEEP-4B.
- ✅ Annulation ↔ purchase_orders : synchronisation ajoutée par I-SWEEP-5A.
- ✅ Refund doctrine : endpoint admin explicite ajouté par I-SWEEP-5B ; `cancelled` reste métier, `refunded` devient financier après action explicite.
- ✅ Prix catalogue manuel : audit `price_history` ajouté par I-SWEEP-6A.
- ✅ Pricing apply : `apply-price/apply-all` audités avec survival serveur par I-SWEEP-6B.
- ✅ Catalogue/stock : garde publication + audit stock minimal ajoutés par I-SWEEP-6C.
- 🟠 Collectif restant : transition `ordered` collective post-commit reste non fatale ; à couvrir par test/alerte si nécessaire.

---

## Prochain lot recommandé

### H1A-2 — Appliquer le câblage `server.js` via codemod local

```text
Branche   : refactor/backend-H1A-wire-server
Charge    : 0.5 jour
Risque    : moyen — ordre des routes à préserver strictement
Prérequis : H1A-0 + H1A-1 terminés
```

Objectif : exécuter localement le codemod, vérifier le diff, lancer les tests, puis ouvrir une PR contenant uniquement le diff `server.js` généré.

Commandes :

```bash
node scripts/h1a-wire-api-routes.js --check
node scripts/h1a-wire-api-routes.js --write
git diff -- server.js
npm test
npm run test:p0
```

Hors scope H1A-2 : webhooks raw Stripe, `express.json`, routes HTML, static serving, crons, migrations inline, listen/shutdown.

---

## File d'attente après H1A-2

Ordre recommandé (voir `PROMPTS_KIT_POST_CRITIQUE.md` et `PLAN_H1_REFACTO_SERVER.md`) :

| Lot | Priorité | Note |
|-----|----------|------|
| P0-RUNTIME | Haute | Exécuter `npm run test:p0` hors GitHub dès que possible |
| PRICE-1 | Conditionnelle | Uniquement si P0 révèle un ajustement pricing/catalogue |
| F1A | Haute mais découpé | Logger pilote sur 1 domaine (pas les 436 occurrences d'un coup) |
| H1B | Moyen | Extraire routes HTML / SPA fallback après H1A |
| H1C | Moyen | Extraire security/middleware après H1A/H1B |
| H1D | Moyen | Extraire crons |
| H1E | Moyen | Extraire env validation |
| H1F | Prudence | Plan séparé migrations inline, pas de suppression sans audit DB |
| H3 | Hygiène | Déplacer `chantier/garde-fous/audit-backend-arch.js` vers `scripts/` |

### Dette mesurée au 19 mai 2026 (référence)

- **19 god-objects ≥ 800 lignes** : aucun découpé pendant le cycle critique (volontaire, sécurité métier d'abord).
- **`server.js`** : 1 200 lignes, 96 blocs DDL inline.
- **`console.*`** : 436 occurrences dans `routes/` + `services/` (a augmenté depuis l'audit initial — F1 reste prioritaire).
- **Migrations** : collisions 060/061 clarifiées par A4 ; runner actuel n'exécute pas automatiquement les `.sql`, donc pas bloquant mais à préserver documentairement.
- **Tests** : couverture ~2,5 %, filet de sécurité I-SWEEP OK mais extension utile après refacto.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.
