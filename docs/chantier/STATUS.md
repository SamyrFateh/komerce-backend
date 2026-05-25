# Komerce Backend — État du chantier
> Mis à jour : **2026-05-25** (analyse code pré go-live complète — M1 + M2 confirmés en prod)
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

- `/event/*` et `/workspace/*` redirigent vers `/boutique` (confirmé dans `bootstrap/html-routes.js`) ;
- `/api/collective-workspaces` et `/api/collective-payments` retournent `410 collective_workspace_disabled` (confirmé dans `routes/collective-workspaces.js`) ;
- `collective-payment-orchestrator` est un tombstone/no-op (confirmé dans `services/collective-payment-orchestrator.js`) ;
- `b-group-cart-flow.js` est un stub vide DEPRECATED (14 lignes, confirmé) ;
- `b-share-cart.js` est l'owner exclusif du flow partage panier créateur (447 lignes, actif) ;
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

## ✅ CHECKLIST GO-LIVE — État réel confirmé par analyse code (25 mai 2026)

### Bloc A — Architecture & Migrations

- [x] **A1** — Fichier fantôme supprimé
- [x] **A3** — Script groupe paiement déplacé en manuel
- [x] **A4** — Collisions 060/061 documentées comme dette non bloquante (`migrations/GAPS.md`) — `060.sql` / `060_add_pending_at_confirmed_at.sql` et `061.sql` / `061_boutique_categories.sql` coexistent. **Ne pas renommer/supprimer.**
- [x] **A5** — `docs/chantier/MIGRATIONS_FOLDERS_A5.md` ajouté
- [x] **A6** — Issue #387 créée
- [x] **A7** — Docs parasites archivées ; `AGENTS.md` corrigé
- [x] **M1** — ✅ Confirmé : `068_check_balance_non_negative.sql` absent du dossier. `068_wallets_check_balance.sql` appliquée sur Railway. Contrainte `CHECK (balance_kmf >= 0)` active en prod.
- [x] **M2** — ✅ Confirmé : `069_analytical_indexes.sql` appliquée manuellement hors transaction sur Railway. Index analytiques actifs.

### Bloc D — Sécurité & Démarrage

- [x] **D0** — Fallback QR supprimé ; démarrage Railway restauré
- [x] **D1–D8** — Audits sécurité, env, rate limit, CORS, Helmet/CSP documentés
- [x] **BUG-LOG-STARTUP** — `bootstrap/startup-migrations.js` : import `log` présent ligne 3 ✅ (vérifié)
- [x] **BUG-LOG-ENV** — `bootstrap/env.js` : import `log` présent ligne 3 ✅ (vérifié)
- [x] **SEC-1** — pickup tokens en DB depuis migration 070 (`pickup_print_tokens` TTL 2 min, `pickup_reveal_codes` TTL 30 min). Cron `startPickupTokenCleanupCron` câblé dans `bootstrap/crons.js` ✅ (vérifié lignes 112–122)
- [x] **SEC-2** — `ADMIN_PASSWORD` dans `requiredEnv` (ligne 16 de `bootstrap/env.js`) ✅ — bloquant au démarrage
- [x] **SEC-3** — Zéro `localStorage.setItem` JWT. Boutique sur cookies httpOnly ✅ (vérifié grep routes/)
- [ ] **SEC-1b** — ⚠️ `printTokens` Map encore in-memory dans `routes/pickup-secret.js` (ligne 237). TTL court, faible volume. **Non bloquant court terme, conditionnel scale-out multi-instance strict.**

### Bloc G — Flows métier

- [x] **G1–G5** — Audits flows cash, Stripe, collectif, annulation, sourcing/catalogue documentés
- [x] **I-SWEEP-0 à I-SWEEP-6C** — Corrections critiques cash, QR, Stripe, purchasing, collectif, refund, pricing, publication/stock mergées
- [x] **I-SWEEP-FINAL** — Violation I-01 `pickup-secret.js` résolue ✅. Confirmé par grep : zéro `UPDATE orders SET status` direct dans le fichier. `/pay-cash` → `confirmPaymentCycle` → `transitionOrderStatus`. `/collect` → `transitionOrderStatus(source='patch')`.

### Bloc H — Refactoring server.js

- [x] **H1 plan** — `docs/chantier/PLAN_H1_REFACTO_SERVER.md` ajouté
- [x] **H1A-0** — PR #417. `bootstrap/api-routes.js` créé ✅ (vérifié : fichier présent)
- [x] **H1A-1** — PR #418. `scripts/h1a-wire-api-routes.js` + doc codemod
- [x] **H1A-2** — PR #427. `server.js` câblé via `bootstrap/api-routes.js`
- [x] **H1A-2-FIX** — PR #426. `sharedCart` conservé dans `server.js`
- [x] **H1B** — PR #443. `bootstrap/html-routes.js` câblé ✅ (vérifié : redirections event/workspace présentes)
- [x] **H1C-PREP** — PR #441. `bootstrap/security.js` créé
- [x] **H1C** — PR #448. `applySecurity(app)` câblé dans `server.js`
- [x] **H1D-PREP** — PR #442. `bootstrap/crons.js` créé
- [x] **H1D** — PR #449. `startOperationalCrons` câblé dans `server.js`
- [x] **H1E** — PR #451. `loadAndValidateEnv()` extrait dans `bootstrap/env.js`
- [x] **H1F** — PR #454. `runStartupMigrations` câblé dans `bootstrap/startup-migrations.js`
- [x] **H2** — `server.js` lifecycle (listen/shutdown/crash guards) finalisé dans `bootstrap/server-lifecycle.js`
- [x] **H3** — `audit-backend-arch.js` déplacé → `scripts/`
- [x] **server.js final** — 209 lignes ✅. Délègue à `bootstrap/env.js`, `security.js`, `api-routes.js`, `html-routes.js`, `crons.js`, `startup-migrations.js`, `server-lifecycle.js`. Webhooks Stripe raw explicitement avant `express.json`.

### Bloc F — Logger

- [x] **F1B** — `notification-service.js` migré vers logger structuré
- [x] **F1-FULL** — Migration `console.*` → logger structuré clôturée ✅. Vérifié : 0 occurrence `console.log/error/warn/info` dans `routes/`, `services/`, `bootstrap/`. Seul le fallback interne `utils/logger.js` (lignes 84–97) conserve des `console.*` légitimes.
- [x] **F1-TEST-FIX** — `pino-pretty` désactivé en `NODE_ENV=test` ; fallback logger réparé.

### Bloc Tests

- [x] **TEST-1A** — PR #409 mergée. Filet Jest sans DB réelle
- [x] **TEST-1B** — Commit `28aae996`. Tests Jest avec mocks DB transactionnels
- [x] **TEST-DEBT** — `npm test` vert : 7 suites, 87 tests passés, 1 skipped propre
- [x] **P0-HELPER** — PR #413 + #436. `npm run test:p0` reproductible
- [x] **P0-RUNTIME** — `npm test` ✅, `/health` ✅, `/api/health` ✅. Dry-run refund validé.
- [x] **P0-SHARED-CART** — Panier partagé boutique actif : création depuis panier, `/api/shared-cart/from-cart-items` ✅ (route confirmée ligne 292), `/api/admin/shared-carts/refund-queue` ✅ (ligne 473). `fully_funded`, refund queue admin, `mark-refunded` manuel avec audit.

### Bugs structurels

- [x] **BUG-CIRC-DEP** — Dépendance circulaire supprimée ✅. Vérifié : `utils/pricing.js` et `routes/pricing.js` (283 lignes) importent `pricingEngine` depuis `services/pricing-engine.js` — plus d'auto-import. `routes/modules.js` : `calcPrixTenue` commentée ligne 318, `pricingEngine` requis inline ligne 322.
- [x] **R1** — IDOR `GET /api/relay/orders/:id` : `assertOrderBelongsToRelais` appelée ligne 432 ✅ (vérifié). Guard 403 + log warn si relais_id ne correspond pas.
- [x] **R2** — Wallet guard `BLOCKED_STATUSES` (cancelled/refunded/collected) présent ✅
- [x] **R4** — `ALLOW_FLUSH` distinct de `ALLOW_SEED` dans `admin.js` ✅
- [x] **R5** — `_alertNotificationFailure` + INSERT alerts sur rejet `confirmed→ordered` ✅
- [x] **R6** — DELETE + INSERT dans BEGIN/COMMIT dans `cost-allocation.js` ✅
- [x] **R7** — `scan_code` synthétique généré pour scans hub automatiques ✅
- [ ] **R3** — ❓ Lié à M1. Contrainte DB `CHECK (balance_kmf >= 0)` non confirmée. Dépend de la vérification que `068_wallets_check_balance.sql` est bien appliquée sur Railway.

### God files & refactoring

- [x] **GOD-FILES-0** — `buildReceiptHTML` extrait → `utils/pickup-receipt-html.js` (286 lignes) ✅. `pickup-secret.js` : 756 lignes. `REVEAL_CACHE` Map → table `pickup_reveal_codes` DB ✅.
- [x] **GOD-FILES-1** — `routes/pricing.js` : 283 lignes ✅ (1318 → 283). `services/pricing-recommend.js` (507 l) ✅. `services/pricing-dashboard.js` (382 l) ✅. `utils/pricing-cache.js` (41 l) ✅.
- [ ] **ZOMBIE-1** — ❌ `utils/pricing.js` : **1 330 lignes — fichier zombie confirmé**. Ancien `routes/pricing.js` d'avant GOD-FILES-1. Exporte un router Express, n'est importé nulle part. `routes/pricing.js` (283 l) est le seul actif monté dans `bootstrap/api-routes.js`. **À supprimer sans risque.**
- [ ] **GOD-FILES-2** — `routes/dashboard-finance.js` : 1 218 lignes, 4 routes. `GET /payments` = 627 lignes SQL inline. Extraire vers `services/dashboard-finance-service.js`.
- [ ] **GOD-FILES-3** — `routes/parcel-api-v2.js` : 1 295 lignes, 8 routes. `syncParcelToOrders` (236 l) inline. Extraire vers `services/parcel-sync-service.js`.
- [ ] **GOD-FILES-4** — `routes/admin.js` : 1 210 lignes, 20 routes. Lot **B4 planifié** dans `BACKEND_GOLIVE_ROADMAP.md`. Découper en `routes/admin-orders.js`, `routes/admin-partners.js`, etc.
- [x] **GOD-FILES-6** — `routes/hub-dashboard.js` : 1 020 → 619 lignes. Logique lecture extraite vers `services/hub-dashboard-queries.js`. Corrections : type `backorder`→`stock`, priority `medium`→`normal`, CHECK constraints alignées avec relay-dashboard. npm test vert.
- [x] **GOD-FILES-5-SOURCING** — `routes/sourcing-engine.js` : 960 → 386 lignes. Logique lecture (getAnalysis, getAnalysisById, getSynthesis, getConfig) extraite vers `services/sourcing-analysis.js`. Mutations (PUT products/:id, PUT products/:id/variants, POST bulk-rail) conservées dans la route. npm test vert.
- [ ] **COLLECTIVE-CLEANUP** — `services/collective-workspace-engine.js` (965 l) encore importé par `collective-close-order-service.js`, `collective-stock-reservation-service.js`, `collective-ready-to-order-orchestrator.js`, eux-mêmes appelés depuis `middleware/auth.js` et `routes/admin-collective-repairs.js`. Le tombstone PR #486 a désactivé les routes mais **pas nettoyé la chaîne de services**. Non bloquant go-live.

### Workspace decommission

- [x] **WORKSPACE-DECOMMISSION** — PR #486 ✅. Vérifié dans le code :
  - `bootstrap/html-routes.js` : `/event/create`, `/event/manage/:creatorToken`, `/event/w/:publicToken`, `/event/pay/:paymentToken`, `/event/:creatorToken/manage`, `/workspace/:publicToken` → tous `redirectToBoutique()`
  - `routes/collective-workspaces.js` : répond `410 collective_workspace_disabled` sur toutes les routes
  - `services/collective-payment-orchestrator.js` : tombstone no-op confirmé
  - `b-group-cart-flow.js` : stub 14 lignes, DEPRECATED PR-1

### Documentation socle

- [x] **SOCLE-1** — Socle architectural à 4 docs gravé
- [x] **SOCLE-2** — CARTOGRAPHY aligné sur les 9 tables manquantes
- [x] **SOCLE-3** — `server.js` documenté comme point névralgique
- [x] **H-SYNC** — Synchronisation roadmap ↔ STATUS
- [x] **DOC-CLEANUP-1** — Doublons chantier archivés ; `chantier/README.md` corrigé
- [x] **N2** — `utils/user-cache.js` créé (44 lignes) ✅ — cache partagé entre `auth.js` et `auth-guest.js`. `invalidateUserCache()` propagé aux deux middlewares.
- [x] **N3** — `invalidateChargesCache()` présent dans `services/economic-engine.js` ✅

### DOC-SYNC-BOUTIQUE-FIRST — Alignement docs boutique

- [x] `public/boutique/docs/BOUTIQUE_SOURCE_OF_TRUTH.md` — GEL v1.5 ✅. `b-share-cart.js` owner exclusif §2B. `b-group-cart-flow.js` DEPRECATED. PR-1 documentée.
- [x] `b-share-phone-guard.js` wired dans `main.js` ligne 5 + 16 ✅
- [ ] **GAP B-DOC-1** — `public/boutique/docs/CARTOGRAPHY_360_BOUTIQUE.md` ne mentionne pas les redirections serveur `/event/*` → `/boutique` (PR #486) ni le tombstone API collectif (`410`). ⚠️ À corriger.
- [ ] **GAP B-DOC-2** — `public/boutique/docs/BOUTIQUE_DOCS_INDEX.md` ne liste pas `MODAL_DESKTOP_ARCHITECTURE.md` et `MODAL_MOBILE_ARCHITECTURE.md`. ⚠️ À corriger.
- [ ] **GAP B-SOT-1** — 9 fichiers JS actifs ou présents **absents du `BOUTIQUE_SOURCE_OF_TRUTH.md`** (GEL v1.5 incomplet) :

| Fichier | Lignes | Statut | Action |
|---|---|---|---|
| `b-share-phone-guard.js` | 301 | ✅ Actif — `setupSharePhoneGuard()` dans `main.js` | Ajouter au SOT §2B |
| `b-group-view.js` | 463 | ✅ Actif — owner onglet groupe panier partagé, importé depuis `boutique.js` | Ajouter au SOT §2B |
| `b-group-banner.js` | 225 | ✅ Actif — import auto `boutique.js` ligne 80 | Ajouter au SOT §2B |
| `b-modal-approche-c-hybrid.js` | 564 | ✅ Actif — `setupApprocheCHybridPdp()` dans `main.js` | Ajouter au SOT §2B |
| `b-pdp-curation-suggestions.js` | 283 | ✅ Actif — `setupPdpCurationSuggestions()` dans `main.js` | Ajouter au SOT §2B |
| `b-home-premium-v1.js` | 292 | ✅ Actif — `setupHomePremiumV1()` dans `main.js` | Ajouter au SOT §2B |
| `b-mobile-premium-v1.js` | 449 | ⚠️ Non vu dans `main.js` — à vérifier si importé depuis `boutique.js` ou orphelin | Auditer |
| `b-mobile-modal-v1.js` | 110 | ⚠️ CSS neutralisé après régression (noté dans le header du fichier) — potentiellement orphelin | Auditer / supprimer |
| `b-modal-social-proof-mock.js` | 156 | ❌ **TEMPORAIRE** — header indique `⚠️ À SUPPRIMER quand la DB aura les colonnes social proof` | Supprimer quand colonnes DB prêtes |

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
collective ready_to_capture repair dry-run   PASS HTTP 200  ← historique (tombstone depuis PR #486)
collective stock reservations repair dry-run PASS HTTP 200  ← historique (tombstone depuis PR #486)

P0 runtime verdict: PASS (tous les checks validés)
```

> **À rejouer avant go-live** : les vérifications P0 doivent cibler `/api/shared-carts/*`, `/cart/shared/:token`, la refund queue et `mark-refunded`. Les lignes `collective` ci-dessus sont des artefacts historiques — le runtime collectif est désactivé.

---

## 🚨 Pièges critiques à retenir

- **`console.*`** : F1 clôturé. Seuls les `console.*` du fallback interne `utils/logger.js` (lignes 84–97) sont tolérés. Toute nouvelle occurrence hors ce fallback = régression.
- **`log` non importé** : pattern `const log = require('../utils/logger').child({ module: '...' })` en ligne 3 est obligatoire dans tout nouveau fichier bootstrap. `startup-migrations.js` et `env.js` ont le même pattern — vérifier les prochains ajouts.
- **Pino calling convention** : `log.error('msg:', err.message)` → second arg silencieusement ignoré. Toujours `log.error({ err }, 'message')`.
- **IDOR relay-dashboard** : GET /orders/:id maintenant protégé. Pattern `assertOrderBelongsToRelais` à répliquer sur tout nouvel endpoint de lecture relais.
- **`utils/logger.js` en test** : ne pas réactiver `pino-pretty` sans fermer le worker, sinon Jest détecte un open handle.
- **`routes/parcels.js` vs `routes/orders/parcels.js`** : deux fichiers distincts, ne pas supprimer comme doublon.
- **A4** : collisions 060/061 = dette non bloquante documentée. Ne pas renommer/supprimer de migration sans audit DB réel.
- **H1 complet** : `server.js` (209 lignes) délègue aux 7 modules bootstrap. Webhooks Stripe raw explicitement avant `express.json`.
- **I-07 / webhooks Stripe** : ne jamais déplacer les raw body parsers derrière `express.json`. Webhook collectif legacy peut rester monté techniquement mais ne doit plus traiter de paiement actif.
- **SEC-1b** : `printTokens` Map encore in-memory (`routes/pickup-secret.js` ligne 237). Non bloquant go-live mono-instance. Conditionnel scale-out.
- **`sourcing-analysis.js`** : service extrait (GOD-FILES-5). Les helpers `loadSourcingConfig`, `getSales30d`, `analyzeProduct` sont aussi exportés pour usage dans `PUT /products/:id` de la route. Ne pas les déplacer sans adapter la route.
- **`baskets.js`** : prix snapshotés à l'ajout sans TTL ni alerte de divergence. Si le prix d'un produit change entre l'ajout au panier et le paiement, le snapshot est stale. Non bloquant go-live mais à surveiller en cas de mise à jour prix catalogue fréquente.
- **N4** : JWT stateless 90j sans révocation = dette architecturale connue, non bloquant go-live.
- **`b-group-cart-flow.js`** : stub 14 lignes DEPRECATED PR-1. À supprimer lors du nettoyage `event/*.html`.
- **`k-modal-open`** (boutique) : classe CSS legacy dead code dans `cart.css` — alias de `body.modal-open` pour `.k-wa-fab`. Le JS pose `modal-open`, jamais `k-modal-open`. À nettoyer dans une PR CSS dédiée.
- **BUG checkout boutique** : si `checkoutCart()` pose `body.cart-open` et que le modal de commande est mal positionné, les cartes catalogue sont `pointer-events: none` sans sortie visible. À surveiller en test manuel go-live.

---

## 🎯 Prochain lot recommandé

### 1. DOC-SYNC-BOUTIQUE-FIRST (✅ partiellement fait — 2 gaps à fermer)

**Priorité : ▶️ Maintenant — 30 min**

Deux actions restantes dans les docs existants (pas de doc satellite) :

```text
[ ] public/boutique/docs/CARTOGRAPHY_360_BOUTIQUE.md
    → Ajouter section "Routes serveur legacy désactivées (PR #486)"
    → Documenter : /event/* → redirect 302 /boutique
    → Documenter : /workspace/:token → redirect 302 /boutique
    → Documenter : /api/collective-workspaces → 410 collective_workspace_disabled
    → Documenter : services/collective-payment-orchestrator.js = tombstone no-op

[ ] public/boutique/docs/BOUTIQUE_DOCS_INDEX.md
    → Ajouter MODAL_DESKTOP_ARCHITECTURE.md et MODAL_MOBILE_ARCHITECTURE.md à l'index
```

### 2. GO-LIVE-CHECK (Ensuite — 1 session)

```text
[ ] Rejouer npm test → doit rester vert (87 passés)
[ ] GET /health → HTTP 200
[ ] GET /api/health → HTTP 200
[ ] Flow shared-cart complet :
    [ ] POST /api/shared-cart/from-cart-items (création depuis panier)
    [ ] GET  /cart/shared/:token (page publique)
    [ ] POST /api/shared-cart/:token/contribute (contribution Stripe)
    [ ] Vérifier fully_funded trigger
    [ ] GET  /api/admin/shared-carts/refund-queue
    [ ] POST /api/admin/shared-carts/:id/mark-refunded
[ ] Vérifier que /event/* et /workspace/* redirigent bien vers /boutique en prod
[ ] Vérifier que /api/collective-workspaces retourne 410 en prod
```

---

## File d'attente

| Lot | Priorité | Note |
|-----|----------|------|
| DOC-SYNC-BOUTIQUE-FIRST | ▶️ Maintenant | B-DOC-1 + B-DOC-2 + B-SOT-1 (9 fichiers absents du SOT boutique) |
| ZOMBIE-1 | ▶️ Maintenant | Supprimer `utils/pricing.js` (1 330 l, zombie sans import) — zéro risque |
| GO-LIVE-CHECK | Ensuite | Rejouer tests + flux shared-cart complet + vérifs prod |
| B-SOT-AUDIT | Ensuite | Auditer `b-mobile-premium-v1.js` + `b-mobile-modal-v1.js` (chargés ou orphelins ?) |
| COLLECTIVE-CLEANUP | Post go-live | Nettoyer la chaîne de services collective-workspace-engine (tombstone incomplet) |
| GOD-FILES-2 | Post go-live | `routes/dashboard-finance.js` 1 218 l — extraire SQL `/payments` en service |
| GOD-FILES-3 | Post go-live | `routes/parcel-api-v2.js` 1 295 l — extraire `syncParcelToOrders` |
| GOD-FILES-4 | Post go-live | `routes/admin.js` 1 210 l — lot B4 planifié dans BACKEND_GOLIVE_ROADMAP.md |
| GOD-FILES-6 | ✅ Fait | `routes/hub-dashboard.js` 619 l (était 1 020). `services/hub-dashboard-queries.js` créé. |
| B-MODAL-MOCK | Post go-live | Supprimer `b-modal-social-proof-mock.js` quand colonnes DB social proof prêtes |
| SEC-1b | Conditionnel scale-out | Migrer `printTokens` Map in-memory si multi-instance strict |
| BOUTIQUE-CSS-CLEANUP | Faible | Dead CSS `k-modal-open` dans `cart.css`. 2 hex `event.css` → tokens. |
| BOUTIQUE-HTML-CLEANUP | Faible | Supprimer import `b-group-cart-flow.js` depuis `event/*.html` + stub file |
| BOUTIQUE-PERF | Faible | Ajouter `<source type="image/webp">` dans `<picture>` hero `index.html` |
| PRICE-1 | Conditionnel | Uniquement si go-live checks révèlent un ajustement pricing/catalogue |
| BASKETS-TTL | Backlog | Alerte divergence prix snapshot vs catalogue. Non bloquant go-live. |

---

## Dette mesurée au 25 mai 2026 (post-analyse code complète)

### Backend

- **`server.js`** : 209 lignes ✅. Refactoring H1 terminé. Webhooks Stripe raw toujours avant `express.json`.
- **`console.*`** : ✅ migration F1 terminée. 0 occurrence dans `routes/`, `services/`, `bootstrap/`. Seul fallback `utils/logger.js` autorisé.
- **Migrations** : collisions 060/061 documentées, non bloquantes. M1 + M2 confirmés en prod ✅.
- **Tests** : 87 passés, 1 skipped propre — filet solide, à rejouer avant go-live.
- **Panier partagé** : modèle actif boutique-first. Backend financier sécurisé (webhook Stripe, anti-surfinancement, refund queue, mark-refunded avec audit).
- **Collective workspace** : routes désactivées/tombstone depuis PR #486. Mais **chaîne de services non nettoyée** : `collective-workspace-engine.js` (965 l) encore importé par 3 services, eux-mêmes appelés depuis `auth.js` et `admin-collective-repairs.js`. Dette post-tombstone à planifier (COLLECTIVE-CLEANUP).
- **Tokens pickup** : `pickup_print_tokens` + `pickup_reveal_codes` DB-backed (migration 070). `printTokens` Map encore in-memory, TTL 2 min, faible volume — non bloquant mono-instance.
- **Dépendances circulaires** : supprimées ✅. Zéro warning au boot.
- **IDOR relay-dashboard** : GET /orders/:id protégé ✅.
- **JWT stateless** : dette architecturale N4 connue. Non bloquant go-live.
- **`baskets.js`** : prix snapshotés sans TTL/alerte de divergence — à surveiller.
- **`utils/pricing.js`** : **ZOMBIE** — 1 330 lignes, router Express non monté, aucun import. À supprimer (ZOMBIE-1).
- **God files restants** : `routes/dashboard-finance.js` (1 218 l), `routes/parcel-api-v2.js` (1 295 l), `routes/admin.js` (1 210 l, lot B4 planifié), `routes/hub-dashboard.js` (1 020 l). Backlog post go-live.

### Boutique frontend

- **Chantier modal** : **CLÔTURÉ** ✅ (5/5 PR livrées : M1→M2→M5→M3→M4). 10/10 classes contractuelles lues par le CSS. `!important` : 12 total, 2 légitimes dans `modal.css`.
- **CSS** : 0 orphelin, 2 hex hardcodés restants dans `event.css` (hors périmètre principal). `npm run audit:arch` → 0 violation.
- **Panier partagé boutique** : `b-share-cart.js` (447 l) owner exclusif. `b-group-cart-flow.js` stub DEPRECATED. `b-share-phone-guard.js` wired dans `main.js`. Flows A→B→C→D opérationnels.
- **Legacy event** : `event/` HTML autonomes existent encore dans `public/boutique/`. Routes serveur redirigent mais pages HTML statiques non supprimées. Nettoyage progressif post go-live.
- **Dead CSS** : `k-modal-open` dans `cart.css` — alias jamais posé par le JS, à supprimer.
- **`BOUTIQUE_SOURCE_OF_TRUTH.md`** : GEL v1.5 — **incomplet** : 6 fichiers actifs + 3 fichiers à statut incertain absents du SOT (voir B-SOT-1 dans la checklist).
- **`CARTOGRAPHY_360_BOUTIQUE.md`** : gap confirmé — ne documente pas les redirections serveur PR #486. ⚠️ À corriger (B-DOC-1).
- **`BOUTIQUE_DOCS_INDEX.md`** : gap confirmé — ne liste pas `MODAL_DESKTOP_ARCHITECTURE.md` et `MODAL_MOBILE_ARCHITECTURE.md`. ⚠️ À corriger (B-DOC-2).

---

## Traçage dette technique résiduelle

### Findings de l'analyse ANALYSE_BACKEND_KOMERCE

| # | Finding | Statut | Notes |
|---|---|---|---|
| N1 | GET /relay/dashboard filtre relais_id | ✅ Corrigé | relay-dashboard.js — guard sur GET /orders/:id (ligne 432) |
| N2 | Dual userCache Maps auth.js / auth-guest.js | ✅ Corrigé | utils/user-cache.js créé (44 lignes), partagé |
| N3 | invalidateChargesCache() manquant après update orders_per_month | ✅ Corrigé | economic-engine.js lignes 569–574 |
| N4 | JWT stateless 90j, pas de révocation | ⏳ Dette architecturale connue | Non bloquant go-live |
| M1 | Migration 068 double — 068_check_balance_non_negative.sql cassé | ✅ Confirmé | Fichier cassé absent. 068_wallets_check_balance.sql appliquée et confirmée en prod. |
| M2 | Migration 069 — CREATE INDEX CONCURRENTLY hors transaction | ✅ Confirmé | Appliquée manuellement sur Railway. Index analytiques actifs. |
| I-01 | Violation pickup-secret.js | ✅ Résolu | I-SWEEP-FINAL — 0 UPDATE direct confirmé par analyse code |
| SEC-1 | Rate-limit pickup in-memory | ✅ Résolu | Migration 070 + cron bootstrap/crons.js (lignes 112–122) |
| SEC-2 | ADMIN_PASSWORD en dur | ✅ Fait | Promu requiredEnv bootstrap/env.js ligne 16 |
| SEC-3 | JWT localStorage pages HTML legacy | ✅ Fait | 0 setItem JWT. Boutique sur cookies httpOnly. |
| ARCH-1 | core.zip dans le repo | ✅ Fait | |
| ARCH-2 | Gaps numérotation migrations | ✅ Fait | migrations/GAPS.md créé |
| ARCH-3 | Fichier orphelin utils/_parcelSync-v2.ORPHAN.js | ✅ Fait | Fichier supprimé |
| BUG-CIRC-DEP | calcPrix/calcPrixTenue dépendance circulaire | ✅ Résolu | 3 fichiers patchés — confirmé par analyse imports |

### Risques résiduels

| # | Item | Fichier | Sévérité | Effort | Statut |
|---|---|---|---|---|---|
| R1 | IDOR inter-relais — GET /orders/:id | relay-dashboard.js | 🔴 Haute | 1h | ✅ Fait — assertOrderBelongsToRelais ligne 432 |
| R2 | POST /apply wallet sans guard order.status cancelled | wallet.js | 🟡 Moyenne | 15 min | ✅ Fait — BLOCKED_STATUSES guard présent |
| R3 | Contrainte DB CHECK (balance_kmf >= 0) manquante | Migration 068 | 🟡 Moyenne | 10 min | ✅ Résolu — M1 confirmé, contrainte active en prod |
| R4 | ALLOW_FLUSH distinct de ALLOW_SEED dans admin.js | admin.js | 🟡 Moyenne | 5 min | ✅ Fait |
| R5 | confirmed→ordered non-fatal sans alerte | order-payment-confirmation.js | 🟡 Moyenne | 20 min | ✅ Fait |
| R6 | DELETE+INSERT non atomique dans allocateMonthlyFixedCosts | cost-allocation.js | 🟡 Moyenne | 1h | ✅ Fait |
| R7 | INSERT scans sans scan_code dans hub-dashboard | hub-dashboard.js | 🟡 Moyenne | 15 min | ✅ Fait |
| D1 | Rétention economic_snapshots | Cron | 🟢 Faible | 30 min | ✅ Résolu — startSnapshotRetentionCron dans bootstrap/crons.js |
| D2 | Index DB manquants sur requêtes analytiques lourdes | DB | 🟡 Moyenne | 2-4h | ✅ Résolu — M2 confirmé, migration 069 appliquée hors transaction |
| D3 | Deux tables scan coexistent (scans + scan_events) | Architecture | 🟡 Moyenne | Planning | ✅ Fait |
| D4 | notification-service : pas de retry | notification-service.js | 🟡 Moyenne | 2h | ✅ Fait |
| ND1 | Audit middleware auth.js + auth-guest.js | — | 🟡 Moyenne | 1h | ✅ Audité — N2 corrigé |
| ND2 | Audit utils/rates.js | — | 🟡 Moyenne | 30 min | ✅ Fait |
| ND3 | Audit utils/eco-bridge.js | — | 🟡 Moyenne | 30 min | ✅ N3 corrigé |
| ND4 | Audit services/order-cost-snapshot.js (idempotence) | — | 🟢 Faible | 30 min | ✅ Fait |
| ND5 | Vérification schema scans.scan_code NOT NULL | DB migrations | 🟡 Moyenne | 15 min | ✅ Fait |
| ND6 | Exposition pickup_code dans endpoints client | client-account.js | 🟡 Moyenne | 30 min | ✅ Fait |
| B-CSS-1 | Dead CSS `k-modal-open` dans cart.css | boutique/css/cart.css | 🟢 Faible | 5 min | ⏳ Backlog nettoyage |
| B-CSS-2 | 2 hex hardcodés dans event.css | boutique/css/event.css | 🟢 Faible | 15 min | ⏳ Hors périmètre principal |
| B-HTML-1 | b-group-cart-flow.js stub à supprimer de event/*.html | boutique/event/ | 🟢 Faible | 15 min | ⏳ Post go-live |
| B-PERF-1 | `<source type="image/webp">` manquant dans hero | boutique/index.html | 🟠 Moyenne | 15 min | ⏳ P1 boutique |
| B-DOC-1 | CARTOGRAPHY_360_BOUTIQUE ne documente pas les redirections PR #486 | boutique/docs/ | 🟡 Moyenne | 20 min | ❌ **GAP CONFIRMÉ — À corriger** |
| B-DOC-2 | BOUTIQUE_DOCS_INDEX ne liste pas MODAL_DESKTOP/MOBILE_ARCHITECTURE.md | boutique/docs/ | 🟢 Faible | 5 min | ❌ **GAP CONFIRMÉ — À corriger** |
| B-SOT-1 | 6 fichiers actifs absents du BOUTIQUE_SOURCE_OF_TRUTH.md | boutique/docs/BOUTIQUE_SOURCE_OF_TRUTH.md | 🟠 Moyenne | 30 min | ❌ **GAP CONFIRMÉ** — b-share-phone-guard, b-group-view, b-group-banner, b-modal-approche-c-hybrid, b-pdp-curation-suggestions, b-home-premium-v1 |
| B-SOT-2 | 2 fichiers à statut incertain absents du SOT | boutique/js/ | 🟡 Moyenne | 15 min | ⏳ À auditer — b-mobile-premium-v1.js, b-mobile-modal-v1.js (orphelins ?) |
| B-MODAL-MOCK | b-modal-social-proof-mock.js marqué TEMPORAIRE dans son header | boutique/js/ | 🟢 Faible | 5 min | ⏳ Supprimer quand colonnes DB social proof prêtes |
| ZOMBIE-1 | utils/pricing.js — router Express 1 330 l sans import, jamais monté | utils/pricing.js | 🔴 Haute | 2 min | ❌ **À supprimer sans risque** |
| GOD-FILES-2 | routes/dashboard-finance.js 1 218 l — GET /payments = 627 l SQL inline | routes/ | 🟡 Moyenne | 2h | ⏳ Post go-live |
| GOD-FILES-3 | routes/parcel-api-v2.js 1 295 l — syncParcelToOrders inline | routes/ | 🟡 Moyenne | 2h | ⏳ Post go-live |
| GOD-FILES-4 | routes/admin.js 1 210 l — lot B4 planifié dans BACKEND_GOLIVE_ROADMAP | routes/ | 🟡 Moyenne | 3h | ⏳ Post go-live |
| GOD-FILES-6 | routes/hub-dashboard.js — logique lecture extraite | routes/ | 🟡 Moyenne | 2h | ✅ Fait — services/hub-dashboard-queries.js |
| COLLECTIVE-CLEANUP | collective-workspace-engine.js encore importé par 3 services actifs post-tombstone | services/ | 🟡 Moyenne | 1h | ⏳ Post go-live |
| BASKETS-1 | Prix snapshotés sans TTL ni alerte divergence | routes/baskets.js | 🟡 Moyenne | 1h | ⏳ À surveiller post go-live |

### Verdicts audits routes (session 25 mai — confirmés par analyse code)

| Fichier | Verdict | Notes |
|---|---|---|
| routes/relay-dashboard.js | ✅ Corrigé | R1 clos — assertOrderBelongsToRelais ligne 432 |
| routes/shared-cart.js | ✅ OK | I-07 ✅, idempotence ✅, délègue engine ✅, modèle actif panier partagé boutique-first. 560 lignes. |
| routes/collective-workspaces.js | ✅ Tombstone | Legacy déclassé : répond `410 collective_workspace_disabled` |
| services/collective-payment-orchestrator.js | ✅ Tombstone | No-op confirmé |
| routes/client-tracking.js | ✅ OK | Lecture seule |
| routes/client-account.js | ✅ OK | ND6 clos |
| routes/baskets.js | 🟡 À surveiller | Prix snapshotés sans TTL ni alerte de divergence |
| routes/orders/status.js | ✅ OK | 100% via transitionOrderStatus() |
| routes/relais.js | ✅ OK | Court, CRUD propre, mutations admin only |
| services/notification-service.js | ✅ Corrigé | D4 clos |
| routes/pricing.js | ✅ Fait | 283 lignes (GOD-FILES-1). Import pricingEngine/pricingRecommend/pricingDashboard. Zéro coefficient dur. |
| routes/pickup-secret.js | ✅ Fait | 756 lignes (GOD-FILES-0). Zéro UPDATE direct. buildReceiptHTML extrait. REVEAL_CACHE en DB. printTokens Map encore in-memory (SEC-1b). |
| bootstrap/html-routes.js | ✅ OK | /event/* et /workspace/* → redirectToBoutique() confirmé |

### Ordre de traitement recommandé (25 mai 2026)

**Immédiat** : DOC-SYNC-BOUTIQUE-FIRST (2 gaps B-DOC-1 + B-DOC-2), puis GO-LIVE-CHECK.

**Avant go-live** : rejouer `npm test`, `/health`, `/api/health`, et le flux shared-cart complet en prod.

**Conditionnel scale-out** : SEC-1b si multi-instance strict avant `printTokens` Map.

**Backlog post go-live** : B-CSS-1/2 (dead CSS, hex event.css), B-HTML-1 (nettoyage b-group-cart-flow), B-PERF-1 (WebP hero), BASKETS-1 (alerte divergence prix), N4 (JWT révocation).

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.
