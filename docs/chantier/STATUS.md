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
| P0 | 🟠 PARTIAL | Rapport `docs/chantier/VALIDATION_STAGING_2026-05-19.md` créé puis enrichi. Env critique présent et boot Railway PASS sur logs. `npm test`, `/health` et flows HTTP staging restent à exécuter. |
| P0-HELPER | ✅ Fait | PR #413 mergée. Ajout `scripts/p0-runtime-check.js`, commande `npm run test:p0` et doc `docs/chantier/P0_RUNTIME_CHECK.md` pour exécuter P0 runtime de façon reproductible. |

---

## Pièges critiques à retenir

- `console.log` : environ 365 occurrences ; F1 est un gros lot, pas un petit nettoyage.
- `routes/parcels.js` et `routes/orders/parcels.js` sont deux fichiers distincts : ne pas supprimer comme doublon.
- Les collisions de migrations SQL ne bloquent pas le boot actuel : le runner actif ne parcourt pas automatiquement les fichiers SQL.
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

### P0-RUNTIME — Exécuter la validation staging réelle

```text
Branche   : test/backend-P0-runtime-validation
Charge    : 0.5-1 jour
Risque    : faible — observation uniquement
Prérequis : rapport P0 PARTIAL + P0-HELPER terminés
```

Objectif : passer P0 de PARTIAL à PASS ou FAIL en exécutant réellement :

```bash
npm run test:p0
P0_BASE_URL=<url-railway> npm run test:p0
P0_BASE_URL=<url-railway> P0_ADMIN_TOKEN=<jwt-admin> npm run test:p0
```

Ne pas lancer PRICE-1, A4, F1A ou H1 avant verdict runtime PASS ou correction ciblée si FAIL.

---

## File d'attente après P0 runtime

Ordre recommandé (voir `PROMPTS_KIT_POST_CRITIQUE.md` pour les prompts) :

| Lot | Priorité | Note |
|-----|----------|------|
| PRICE-1 | Conditionnelle | Uniquement si P0 révèle un ajustement pricing/catalogue |
| A4 | Prudence | Audit collisions migrations 060/061 (collisions confirmées dans `migrations/`) |
| F1A | Haute mais découpé | Logger pilote sur 1 domaine (pas les 436 occurrences d'un coup) |
| H1 plan | Stratégique | Plan de refacto `server.js` (1 200 l. + 96 blocs DDL inline) avant tout code |
| H1A | Petit lot isolé | Extraction manifest routes hors de `server.js` |
| B3 REFAC-dashboard | Lourd | `routes/dashboard.js` 2 614 l. → `routes/dashboard/{...}` |
| B2 REFAC-pricing | Lourd | `services/pricing-engine.js` 1 483 l. → `services/pricing/{...}` |
| H3 | Hygiène | Déplacer `chantier/garde-fous/audit-backend-arch.js` vers `scripts/` |

### Dette mesurée au 19 mai 2026 (référence)

- **19 god-objects ≥ 800 lignes** : aucun découpé pendant le cycle critique (volontaire, sécurité métier d'abord).
- **`server.js`** : 1 200 lignes, 96 blocs DDL inline.
- **`console.*`** : 436 occurrences dans `routes/` + `services/` (a augmenté depuis l'audit initial — F1 reste prioritaire).
- **Migrations** : collisions 060/061 confirmées dans `migrations/` ; runner actuel n'exécute pas automatiquement les `.sql`, donc pas bloquant mais à clarifier.
- **Tests** : couverture ~2,5 %, filet de sécurité I-SWEEP OK mais extension utile après refacto.

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.
