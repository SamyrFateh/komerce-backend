# Komerce Backend — État du chantier
> Mis à jour : **2026-06-08** (SUIVI_IMPLEMENTATION_PANIER_PARTAGE v4.1 intégré · Sprint 1 ✅ · Sprint 2 partiel ⏳ · Sprint 3 ✅ · **BUG-S2-05 ✅ · TX-02 ✅ · BUG-C5/C6/C7 faux positifs ✅ · S2-06 ✅** · BE-A/B/C/D annulés 🚫 · DOC-INT-1/2/3/4 ☐ · REFACTO-SCAN-ENGINE ✅ · DOC-SYNC-BOUTIQUE-FIRST ✅ · GOD-FILES-2/3/4 ✅ · deleteOrderCascade dédupliquée ✅ · COLLECTIVE-CLEANUP ✅ · B-CSS-1 ✅ · B-HTML-1 ✅ · B-MODAL-MOCK ✅ · AUDIT-BE-2026-05-26 intégré · A-BE-04 ✅ · A-BE-18 ✅ · A-BE-16 ✅ · A-BE-05 ✅ · **A-BE-03 ✅ · A-BE-09 ✅ · BASKETS-1 ✅ · A-BE-15 ✅ · A-BE-10 ✅ · SEC-1b ✅** · N4-072-migration ✅ · N4-câblage ✅)
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`
> **Ce fichier est la PREMIÈRE chose à ouvrir au début de chaque session.**

---

## Point d'entrée obligatoire

Lire dans cet ordre avant toute modification :

1. `docs/chantier/STATUS.md` — état du jour et prochain lot réel
2. **Socle architectural (4 documents canoniques)** :
   - `docs/CARTOGRAPHY_360.md` — quoi existe (domaines, surfaces, points de vérité)
   - `docs/ZONE_IMPACT.md` — quoi protéger (10 invariants + checklist)
   - `docs/SCHEMA.md` — quoi est vrai en base (93 tables, 14 ENUMs, 31 triggers) — confirmé par dump Railway 26 mai 2026
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

## Panier partagé v4.1 — Suivi implémentation

> Source : `SUIVI_IMPLEMENTATION_PANIER_PARTAGE.md` (27 mai 2026) — intégré dans STATUS.md.
> Légende : ✅ Fait · ⏳ En cours · ☐ À faire · 🚫 Annulé

### Invariants panier partagé (à respecter dans toutes les PRs)

1. **Webhook Stripe = source de vérité.** Ne jamais incrémenter `contributed_kmf` sans webhook confirmé.
2. **Aucun paiement participant sans `settlement_open = true`.** Guard dans `assertCanAcceptParticipantPaymentByToken()`.
3. **La commande ferme naît uniquement à `POST /:id/finalize`.** Aucune PR ne réintroduit la création automatique.
4. **Les erreurs WhatsApp ne bloquent jamais la route principale.** Toujours post-commit, best-effort.
5. **Aucune surface ne sort l'utilisateur de la boutique durablement.** Pages externes ramènent toujours vers la boutique.
6. **Les tokens publics ne révèlent pas les téléphones complets.** `maskPhone()` reste appliqué partout.
7. **La modification d'articles ne peut intervenir qu'en phase ouverte.** `PUT /:id/items` bloque avec 409 si `settlement_open = true` ou statut fermé.

### Sprint 1 — Parcours contributeur

| ID | Description | Fichiers principaux | Statut |
|---|---|---|---|
| S1-01 | Page success → confirmation + retour boutique | `shared-cart-success.html` | ✅ |
| S1-02 | Page cancel → retour panier | `shared-cart-cancel.html` | ✅ |
| S1-03a | Détecter la phase depuis `metadata.settlement_open` | `shared-cart-public.html` | ✅ |
| S1-03b | Phase ouverte — formulaire engagement sans email | `shared-cart-public.html` | ✅ |
| S1-03c | Phase règlement — lookup téléphone + Stripe | `shared-cart-public.html` | ✅ |
| S1-03d | CTA boutique en bas de page (toutes phases) | `shared-cart-public.html` | ✅ |
| S1-03e | Messages statuts fermés (`converted_to_order`, `expired`, `cancelled`) | `shared-cart-public.html` | ✅ |
| S1-04 | Minimum engagement 2 500 KMF | `shared-cart-commitment-service.js` | ✅ |
| TX-01 | Erreur `settlement_not_open` lisible | `shared-cart-public.html` | ✅ |
| TX-02 | Montant moyen suggéré — page publique | `shared-cart-public.html` | ✅ |
| TX-02 | Montant moyen suggéré — onglet Groupe | `b-group-view.js` | ✅ |

**Notes S1** : Email absent du formulaire d'engagement (phase ouverte) ✅ — présent uniquement à l'étape paiement (phase règlement) avec libellé "pour votre reçu" ✅.

#### Tests Sprint 1 (à passer)

- `[S1-01-T1]` URL valide → message confirmation + bouton boutique ☐
- `[S1-01-T2]` URL sans token → message erreur + bouton boutique ☐
- `[S1-02-T1]` URL avec token → bouton retour `/cart/shared/:token` ☐
- `[S1-02-T2]` URL sans token → bouton retour `/boutique` ☐
- `[S1-03-T1]` Phase ouverte → formulaire engagement, pas de Stripe ☐
- `[S1-03-T2]` Phase règlement → formulaire paiement avec lookup téléphone ☐
- `[S1-03-T3]` `POST /commitments` sans email → 201 OK ☐
- `[S1-03-T4]` Paiement sans settlement → 409 → message lisible ☐
- `[S1-03-T5]` Panier `converted_to_order` → message clôture + bouton boutique ☐
- `[S1-03-T6]` CTA boutique visible dans toutes les phases ☐
- `[S1-04-T1]` `POST /commitments` avec `amount_kmf: 1000` → 400 `amount_too_low` ☐
- `[S1-04-T2]` `POST /commitments` avec `amount_kmf: 2500` → 201 OK ☐

### Sprint 2 — Actions créateur dans la boutique

| ID | Description | Fichiers principaux | Statut |
|---|---|---|---|
| S2-01 | Bouton "Annuler le panier" dans l'onglet Groupe | `b-group-view.js` | ✅ |
| S2-02 | Finalisation avec gap — "je couvre le reste" | `b-group-view.js` | ✅ |
| S2-03 | Durée règlement choisie (24h / 48h / 7j, défaut 48h) | `b-group-view.js` | ✅ |
| S2-04 | Expiration règlement affichée (rouge si < 6h) | `b-group-view.js` | ✅ |
| S2-05 | Raccourci "Voir le groupe actif" dans la modale "Payer en groupe" | `b-share-cart.js` | ✅ |
| S2-06 | Modification des articles du panier par le créateur → mise à jour participants | `routes/shared-cart.js`, `b-group-view.js`, `shared-cart-public.html` | ✅ |

**✅ S2-06 implémenté (2026-05-27)** — Flux complet :
- `routes/shared-cart.js` : import `shared-cart-items-service`, route `PUT /:id/items` (authenticate, guard 409 via service, notification WhatsApp post-commit best-effort aux participants en `pending/confirmed/locked_for_settlement`)
- `b-group-view.js` : bouton "✏️ Modifier les articles" dans `renderCreatorActions` (branche `!settlementOpen` uniquement) + handler `#k-group-edit-items` dans `bindCreatorActions` → lit `state.cart`, confirme avec nouveau total estimé, appelle `window.K.request PUT /api/shared-carts/:id/items`, puis `refreshView`
- `shared-cart-public.html` : `adaptApiShape` expose `items_updated_at` depuis `metadata.open_phase_items_updated_at` ; `render()` affiche le bandeau `#sc-items-updated-banner` (phase ouverte uniquement) avec date de mise à jour, nouveau total, CTA "Réviser mon engagement →" scroll vers le formulaire

**✅ BUG S2-05 résolu (2026-05-27)** — Race condition dans `b-share-cart.js` : `restoreSharedCartFromBackend()` (async, fire-and-forget) pouvait s'exécuter après un clic rapide sur "Payer en groupe" et effacer le `state.shareToken` chargé par `loadShareState()`.

Corrections apportées :
1. `_restorePromise` tracke la promesse de restauration dans `install()`
2. `startShareFlow()` `await _restorePromise` avant d'utiliser `state.shareToken`
3. Commentaire explicite dans `restoreSharedCartFromBackend` sur le cas 401/403

#### Tests Sprint 2 (à passer)

- `[S2-01-T1]` Sans contributions → annulation directe, retour onglet boutique ☐
- `[S2-01-T2]` Avec contributions payées → dialog avertissement avant appel ☐
- `[S2-02-T1]` `remaining_kmf > 0` → bouton "je couvre le reste" visible ☐
- `[S2-02-T2]` Créateur couvre → `POST /finalize` avec `accept_partial: true` ☐
- `[S2-03-T1]` Choix 24h → `metadata.settlement_window_hours === 24` ☐
- `[S2-03-T2]` Pas de choix → 48h par défaut ☐
- `[S2-04-T1]` 48h restantes → date affichée correctement ☐
- `[S2-04-T2]` 2h restantes → affichage en rouge ☐
- `[S2-05-T1]` Panier actif (`state.shareToken` non null) → modale propose deux options ☐
- `[S2-05-T2]` "Voir le groupe actif" → bascule onglet Groupe, pas de redirect ☐
- `[S2-06-T1]` Créateur phase ouverte → bouton "Modifier les articles" visible ☐
- `[S2-06-T2]` Créateur phase règlement ou fermée → bouton absent ☐
- `[S2-06-T3]` `PUT /:id/items` valide → 200 OK, articles mis à jour ☐
- `[S2-06-T4]` 3 participants avec téléphone → 3 notifications WhatsApp tentées ☐
- `[S2-06-T5]` Échec WhatsApp → route retourne 200, événement `shared_cart_items_updated` loggé ☐
- `[S2-06-T6]` Participant recharge `GET /public/:token` → nouveau total et nouvelle liste d'articles ☐
- `[S2-06-T7]` Bandeau "Le panier a été modifié" visible sur `shared-cart-public.html` après mise à jour ☐
- `[S2-06-T8]` CTA révision engagement → formulaire commitment pré-rempli avec nouveau total suggéré ☐

### Sprint 3 — Notifications et crons

| ID | Description | Fichiers principaux | Statut |
|---|---|---|---|
| S3-01 | Notification WhatsApp → ouverture règlement | `routes/shared-cart.js` → `/:id/open-settlement` | ✅ |
| S3-02 | Notification WhatsApp → création panier | `routes/shared-cart.js` → `POST /from-cart-items` | ✅ |
| S3-03 | Cron `not_honored` — vérifié, avec log structuré et événement | `bootstrap/crons.js` | ✅ |
| S3-04 | Cron expiration paniers — planifié toutes les 4h | `bootstrap/crons.js` | ✅ |

#### Tests Sprint 3 (à passer)

- `[S3-01-T1]` 3 engagements avec téléphone → 3 appels WhatsApp tentés ☐
- `[S3-01-T2]` Échec WhatsApp → route retourne 200, événement `settlement_notification_failed` loggé ☐
- `[S3-02-T1]` Création avec `tracking_phone` → message envoyé ☐
- `[S3-02-T2]` Sans téléphone → aucune erreur ☐
- `[S3-03-T1]` Engagement `locked_for_settlement` + fenêtre expirée → passe `not_honored` ☐
- `[S3-03-T2]` Deuxième run → 0 lignes (idempotent) ☐
- `[S3-04-T1]` Panier `active` expiré sans contribution → passe `expired` ☐

### Bugs frontend à vérifier (hors sprint)

| ID | Description | Fichier | Effort |
|---|---|---|---|
| BUG-C5 | Route auth utilisée dans le checkout — vérifier `/auto-register` | `b-checkout.js` | ✅ Faux positif — `/api/orders` direct, cookie auth |
| BUG-C6 | `payment_mode: 'card'` potentiellement invalide | `b-checkout.js` | ✅ Faux positif — valeurs : `cash_relais`, `mvola`, `stripe_eur` |
| BUG-C7 | URL appelée par `loadRelais()` — vérifier `/api/relais` | `b-nav.js` | ✅ Faux positif — `b-nav` → `/api/relais/public`, `b-checkout` → `/api/relais` |

### Backend PR doctrine — 🚫 Annulées

> Les PRs BE-A/B/C/D sont **annulées** — remplacées par l'approche tombstone (PR #486).
> `docs/backend/PANIER_COLLECTIF_BACKEND_DELTA.md` archivé (voir DOC-INT-1).

| ID | Description | Statut |
|---|---|---|
| BE-A | `markSessionReadyToOrder()` — remplacer auto-création commande | 🚫 Annulé |
| BE-B | `POST /api/collective-workspaces/:creatorToken/close` | 🚫 Annulé |
| BE-C | Table `collective_stock_reservations` | 🚫 Annulé |
| BE-D | Clarification statuts cash | 🚫 Annulé |

### Hors scope v4.1

| Item | Raison |
|---|---|
| Vue historique contributeur (`shared-cart-account.html`) | Sort l'utilisateur de la boutique. Reporté v4.2. |
| UI paiement cash participant | Confirmé par agent relais. Hors MVP. Reporté v4.2. |


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
- [x] **SEC-1b** — ✅ `printTokens` Map supprimée. INSERT/DELETE dans `pickup_print_tokens` (migration 070). Survivant aux redémarrages + multi-instance. (2026-05-26)

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
- [x] **R3** — ✅ Lié à M1. `068_wallets_check_balance.sql` confirmée appliquée sur Railway. Contrainte `CHECK (balance_kmf >= 0)` active en prod (§M1 ci-dessus).

### God files & refactoring

- [x] **GOD-FILES-0** — `buildReceiptHTML` extrait → `utils/pickup-receipt-html.js` (286 lignes) ✅. `pickup-secret.js` : 756 lignes. `REVEAL_CACHE` Map → table `pickup_reveal_codes` DB ✅.
- [x] **GOD-FILES-1** — `routes/pricing.js` : 283 lignes ✅ (1318 → 283). `services/pricing-recommend.js` (507 l) ✅. `services/pricing-dashboard.js` (382 l) ✅. `utils/pricing-cache.js` (41 l) ✅.
- [x] **ZOMBIE-1** ✅ — `utils/pricing.js` : **absent du repo** — confirmé par analyse du zip (2026-05-26). Fichier zombie déjà supprimé, aucune action requise.
- [x] **GOD-FILES-2** — `routes/dashboard-finance.js` : façade 48 l. SQL extrait vers `services/dashboard-finance-metrics.js` (1 046 l). ✅ Confirmé par analyse code (2026-05-26).
- [x] **GOD-FILES-3** — `routes/parcel-api-v2.js` : façade 3 l. Découpé en `parcel-api-v2/read.js` (699 l) + `helpers.js` (448 l) + `scans.js` (107 l). ✅ Confirmé par analyse code (2026-05-26).
- [x] **GOD-FILES-4** — `routes/admin.js` : façade 4 l. Découpé en `admin/index.js` + `orders.js` + `partners.js` + `users.js` + `system.js`. `deleteOrderCascade` dédupliquée → `admin/delete-order-cascade.js` (2026-05-26). ✅
- [x] **GOD-FILES-6** — `routes/hub-dashboard.js` : 1 020 → 619 lignes. Logique lecture extraite vers `services/hub-dashboard-queries.js`. Corrections : type `backorder`→`stock`, priority `medium`→`normal`, CHECK constraints alignées avec relay-dashboard. npm test vert.
- [x] **REFACTO-SCAN-ENGINE** ✅ — `services/scan-engine.js` : `processScan()` 311 → ~55 lignes. 4 sous-fonctions privées extraites : `_loadScanContext` (étapes 1-3), `_validateAndCatchup` (étapes 4-5, I-03 guards intacts, `parcelItems.splice()` PATCH P1-5 préservé), `_applyEvent` (étapes 6-9), `_finalizeAndLog` (étapes 10-12). Notifications post-commit (étape 14) et `logScanEventDirect` (catch) restent dans `processScan()`. `module.exports` inchangé. `tests/unit/scan-engine.test.js` créé : 7 cas, npm test vert.
- [x] **GOD-FILES-5-SOURCING** — `routes/sourcing-engine.js` : 960 → 386 lignes. Logique lecture (getAnalysis, getAnalysisById, getSynthesis, getConfig) extraite vers `services/sourcing-analysis.js`. Mutations (PUT products/:id, PUT products/:id/variants, POST bulk-rail) conservées dans la route. npm test vert.
- [x] **COLLECTIVE-CLEANUP** — `collective-close-order-service.js` et `collective-ready-to-order-orchestrator.js` tombstonés (2026-05-26). `collective-stock-reservation-service.js` conservé intact (utilisé par repair admin dry_run). `collective-workspace-engine` n'est plus importé que depuis ce seul service de maintenance.

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
- [x] **GAP B-DOC-1** ✅ — `public/boutique/docs/CARTOGRAPHY_360_BOUTIQUE.md` : §14 ajouté (2026-05-26) — redirections `/event/*` → `/boutique`, API `410`, tombstones. Confirmé par analyse code `bootstrap/html-routes.js` + `routes/collective-workspaces.js`.
- [x] **GAP B-DOC-2** ✅ — `public/boutique/docs/BOUTIQUE_DOCS_INDEX.md` : déjà à jour — `MODAL_DESKTOP_ARCHITECTURE.md` et `MODAL_MOBILE_ARCHITECTURE.md` présents en §1 et §5. Confirmé par lecture du fichier (2026-05-26). Aucune action requise.
- [x] **GAP B-SOT-1** ✅ — `BOUTIQUE_SOURCE_OF_TRUTH.md` passé en GEL v1.6 (2026-05-26) : 6 fichiers actifs ajoutés en §2B (b-share-phone-guard, b-group-view, b-group-banner, b-modal-approche-c-hybrid, b-pdp-curation-suggestions, b-home-premium-v1). 3 orphelins documentés : b-mobile-premium-v1 (aucun import), b-mobile-modal-v1 (CSS neutralisé + aucun import), b-modal-social-proof-mock (non importé — à supprimer avec les colonnes DB social proof).

## Résultat de validation du 23 mai 2026

### `npm test` après patch logger

```text
Test Suites: 1 skipped, 11 passed, 11 of 12 total
Tests:       1 skipped, 125 passed, 126 total
Snapshots:   0 total
Time:        ~1.1 s
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
- **Pino calling convention** : `log.error('msg:', err.message)` → second arg silencieusement ignoré. Toujours `log.error({ err }, 'message')`. ✅ A-BE-10 clos — 0 occurrence restante (2026-05-26).
- **IDOR relay-dashboard** : GET /orders/:id maintenant protégé. Pattern `assertOrderBelongsToRelais` à répliquer sur tout nouvel endpoint de lecture relais.
- **`utils/logger.js` en test** : ne pas réactiver `pino-pretty` sans fermer le worker, sinon Jest détecte un open handle.
- **`routes/parcels.js` vs `routes/orders/parcels.js`** : deux fichiers distincts, ne pas supprimer comme doublon.
- **A4** : collisions 060/061 = dette non bloquante documentée. Ne pas renommer/supprimer de migration sans audit DB réel.
- **H1 complet** : `server.js` (209 lignes) délègue aux 7 modules bootstrap. Webhooks Stripe raw explicitement avant `express.json`.
- **I-07 / webhooks Stripe** : ne jamais déplacer les raw body parsers derrière `express.json`. Webhook collectif legacy peut rester monté techniquement mais ne doit plus traiter de paiement actif.
- **SEC-1b** : ✅ RÉSOLU — `printTokens` Map supprimée de `pickup-secret.js`. Tokens d'impression persistés dans `pickup_print_tokens` DB (migration 070). Multi-instance safe.
- **`sourcing-analysis.js`** : service extrait (GOD-FILES-5). Les helpers `loadSourcingConfig`, `getSales30d`, `analyzeProduct` sont aussi exportés pour usage dans `PUT /products/:id` de la route. Ne pas les déplacer sans adapter la route.
- **`baskets.js`** : ✅ BASKETS-1 résolu — alerte divergence prix implémentée (`snapshot_price_kmf` vs `current_price_kmf`, `log.warn` structuré, `price_changed` par item, `price_divergence` au niveau panier).
- **N4** : JWT révocation — **migration 072 ✅** (`revoked_tokens` + index), **câblage applicatif ⏳**. Reste à faire : (1) `jti` uuid dans `generateToken` de `auth-guest.js`, (2) check `revoked_tokens` dans `authenticate` de `auth.js`, (3) INSERT `revoked_tokens` au logout dans `routes/auth.js`, (4) `startJwtRevocationCleanupCron` dans `bootstrap/crons.js`. Non bloquant go-live (token 90j, mono-user actuellement).
- **`b-group-cart-flow.js`** : stub 14 lignes DEPRECATED PR-1. À supprimer lors du nettoyage `event/*.html`.
- **`PUT /:id/items` (S2-06)** : uniquement en phase ouverte (`settlement_open = false`, statut `active`). Ne jamais appeler `updateOpenSharedCartItems` en phase règlement ou fermée — guard 409 obligatoire. Notifications WhatsApp post-commit uniquement, never blocking.
- **`k-modal-open`** (boutique) : classe CSS legacy dead code dans `cart.css` — alias de `body.modal-open` pour `.k-wa-fab`. Le JS pose `modal-open`, jamais `k-modal-open`. À nettoyer dans une PR CSS dédiée.
- **BUG checkout boutique** : si `checkoutCart()` pose `body.cart-open` et que le modal de commande est mal positionné, les cartes catalogue sont `pointer-events: none` sans sortie visible. À surveiller en test manuel go-live.

---

## 🎯 Prochain lot recommandé

### 1. PANIER-V4.1 — Compléter l'implémentation (▶️ Maintenant)

```text
Priorité immédiate — Tests à passer avant go-live :
[ ] Tous les [S1-xx-Tx] — Sprint 1 parcours contributeur
[ ] Tous les [S2-xx-Tx] — Sprint 2 actions créateur (inclus S2-06)
[ ] Tous les [S3-xx-Tx] — Sprint 3 notifications et crons

Complété en session 2026-05-27 :
[x] BUG S2-05 — Race condition b-share-cart.js résolue
[x] TX-02 — Montant moyen suggéré (b-group-view.js + shared-cart-public.html)
[x] BUG-C5/C6/C7 — Faux positifs confirmés
[x] S2-06 — Modification articles panier par créateur (PUT /:id/items, b-group-view.js, bandeau participant)
```

### 2. GO-LIVE-CHECK (Après PANIER-V4.1 — 1 session)

```text
[ ] Rejouer npm test → doit rester vert (125 passés)
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
| PANIER-V4.1 | ✅ Fait | BUG S2-05 ✅ · TX-02 ✅ · BUG-C5/C6/C7 faux positifs ✅ · S2-06 ✅ — Tests à passer avant go-live |
| GO-LIVE-CHECK | ▶️ Maintenant | Rejouer tests + flux shared-cart complet + vérifs prod |
| B-SOT-AUDIT | Ensuite | ✅ Résolu — b-mobile-premium-v1 et b-mobile-modal-v1 confirmés orphelins, documentés dans SOT v1.6 |
| DOC-SYNC-BOUTIQUE-FIRST | ✅ Fait | B-DOC-1 ✅ (§14 ajouté CARTOGRAPHY_360_BOUTIQUE) · B-DOC-2 ✅ (déjà à jour) · B-SOT-1 ✅ (SOT v1.6, 6 actifs + 3 orphelins) |
| ZOMBIE-1 | ✅ Fait | `utils/pricing.js` absent du repo — déjà supprimé, confirmé par analyse code |
| COLLECTIVE-CLEANUP | ✅ Fait | close-order + ready-to-order tombstonés (2026-05-26). stock-reservation conservé (repair admin). |
| GOD-FILES-2 | ✅ Fait | `routes/dashboard-finance.js` façade 48 l — `services/dashboard-finance-metrics.js` (1 046 l). Confirmé 2026-05-26. |
| GOD-FILES-3 | ✅ Fait | `routes/parcel-api-v2.js` façade 3 l — découpé en read/helpers/scans. Confirmé 2026-05-26. |
| GOD-FILES-4 | ✅ Fait | `routes/admin.js` façade 4 l — découpé en 5 sous-routes. `deleteOrderCascade` dédupliquée → `delete-order-cascade.js`. 2026-05-26. |
| GOD-FILES-6 | ✅ Fait | `routes/hub-dashboard.js` 619 l (était 1 020). `services/hub-dashboard-queries.js` créé. |
| REFACTO-SCAN-ENGINE | ✅ Fait | `services/scan-engine.js` : `processScan()` ~55 l (était 311). 4 sous-fonctions privées. `tests/unit/scan-engine.test.js` : 7 cas. npm test vert. |
| B-MODAL-MOCK | Post go-live | Supprimer `b-modal-social-proof-mock.js` quand colonnes DB social proof prêtes |
| SEC-1b | ✅ Fait | `printTokens` Map → `pickup_print_tokens` DB (migration 070). Multi-instance safe. (2026-05-26) |
| BOUTIQUE-CSS-CLEANUP | Faible | Dead CSS `k-modal-open` dans `cart.css`. 2 hex `event.css` → tokens. |
| BOUTIQUE-HTML-CLEANUP | Faible | Supprimer import `b-group-cart-flow.js` depuis `event/*.html` + stub file |
| BOUTIQUE-PERF | Faible | Ajouter `<source type="image/webp">` dans `<picture>` hero `index.html` |
| PRICE-1 | Conditionnel | Uniquement si go-live checks révèlent un ajustement pricing/catalogue |
| BASKETS-TTL | ✅ Fait | BASKETS-1 — Alerte divergence prix snapshot vs catalogue implémentée dans routes/baskets.js (2026-05-26). |

---

## Dette mesurée au 25 mai 2026 (post-analyse code complète)

### Backend

- **`server.js`** : 209 lignes ✅. Refactoring H1 terminé. Webhooks Stripe raw toujours avant `express.json`.
- **`console.*`** : ✅ migration F1 terminée. 0 occurrence dans `routes/`, `services/`, `bootstrap/`. Seul fallback `utils/logger.js` autorisé.
- **Migrations** : collisions 060/061 documentées, non bloquantes. M1 + M2 confirmés en prod ✅.
- **Tests** : 125 passés, 1 skipped propre — filet solide, à rejouer avant go-live.
- **Panier partagé** : modèle actif boutique-first. Backend financier sécurisé (webhook Stripe, anti-surfinancement, refund queue, mark-refunded avec audit).
- **Collective workspace** : routes désactivées/tombstone depuis PR #486. Mais **chaîne de services non nettoyée** : `collective-workspace-engine.js` (965 l) encore importé par 3 services, eux-mêmes appelés depuis `auth.js` et `admin-collective-repairs.js`. Dette post-tombstone à planifier (COLLECTIVE-CLEANUP).
- **Tokens pickup** : `pickup_print_tokens` + `pickup_reveal_codes` DB-backed (migrations 070). `printTokens` Map supprimée ✅ (SEC-1b). Multi-instance safe.
- **Dépendances circulaires** : supprimées ✅. Zéro warning au boot.
- **IDOR relay-dashboard** : GET /orders/:id protégé ✅.
- **JWT stateless** : dette architecturale N4 — migration 072 ✅. Câblage applicatif (`jti` + révocation DB + cron) à faire. Non bloquant go-live.
- **`baskets.js`** : ✅ BASKETS-1 — alerte divergence prix snapshot/catalogue implémentée (2026-05-26).
- **God files** : tous résolus ✅ — `dashboard-finance.js` (façade 48 l), `parcel-api-v2.js` (façade 3 l + sous-dossier), `admin.js` (façade 4 l + 5 sous-routes), `hub-dashboard.js` (619 l). `utils/pricing.js` ZOMBIE supprimé ✅.
- **`services/scan-engine.js`** : refactorisé ✅ — `processScan()` 55 lignes, 4 sous-fonctions privées, `module.exports` inchangé. `tests/unit/scan-engine.test.js` : 7 cas. npm test vert.

### Boutique frontend

- **Chantier modal** : **CLÔTURÉ** ✅ (5/5 PR livrées : M1→M2→M5→M3→M4). 10/10 classes contractuelles lues par le CSS. `!important` : 12 total, 2 légitimes dans `modal.css`.
- **CSS** : 0 orphelin, 2 hex hardcodés restants dans `event.css` (hors périmètre principal). `npm run audit:arch` → 0 violation.
- **Panier partagé boutique** : `b-share-cart.js` (447 l) owner exclusif. `b-group-cart-flow.js` stub DEPRECATED. `b-share-phone-guard.js` wired dans `main.js`. Flows A→B→C→D opérationnels.
- **Legacy event** : `event/` HTML autonomes existent encore dans `public/boutique/`. Routes serveur redirigent mais pages HTML statiques non supprimées. Nettoyage progressif post go-live.
- **Dead CSS** : `k-modal-open` dans `cart.css` — alias jamais posé par le JS, à supprimer.
- **`BOUTIQUE_SOURCE_OF_TRUTH.md`** : GEL v1.6 ✅ — 6 fichiers actifs ajoutés §2B, 3 orphelins documentés (b-mobile-premium-v1, b-mobile-modal-v1, b-modal-social-proof-mock).
- **`CARTOGRAPHY_360_BOUTIQUE.md`** : §14 ajouté ✅ — routes serveur legacy désactivées (PR #486), redirections 302, API 410, tombstones.
- **`BOUTIQUE_DOCS_INDEX.md`** : ✅ déjà à jour — MODAL_DESKTOP/MOBILE_ARCHITECTURE.md présents.

---

## Traçage dette technique résiduelle

### Findings de l'analyse ANALYSE_BACKEND_KOMERCE

| # | Finding | Statut | Notes |
|---|---|---|---|
| N1 | GET /relay/dashboard filtre relais_id | ✅ Corrigé | relay-dashboard.js — guard sur GET /orders/:id (ligne 432) |
| N2 | Dual userCache Maps auth.js / auth-guest.js | ✅ Corrigé | utils/user-cache.js créé (44 lignes), partagé |
| N3 | invalidateChargesCache() manquant après update orders_per_month | ✅ Corrigé | economic-engine.js lignes 569–574 |
| N4 | JWT stateless 90j, révocation complète | ✅ Fait — 2026-06-08 | migration 072 ✅, `jti` uuid ✅, `isTokenRevoked()` dans `authenticate` ✅, INSERT `revoked_tokens` au logout ✅, cron cleanup ✅. |
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
| B-CSS-1 | Dead CSS `k-modal-open` dans cart.css | boutique/css/cart.css | 🟢 Faible | 5 min | ✅ Fait — sélecteur supprimé (2026-05-26). |
| B-CSS-2 | 2 hex hardcodés dans event.css | boutique/css/event.css | 🟢 Faible | 15 min | ✅ Faux positif — variables CSS (--ev-border-soft, --ev-text-soft) via var(). Confirmé 2026-05-26. |
| B-HTML-1 | b-group-cart-flow.js stub à supprimer de event/*.html | boutique/event/ | 🟢 Faible | 15 min | ✅ Fait — import supprimé de b-cart-product-open-style.js + fichier stub supprimé (2026-05-26). |
| B-PERF-1 | `<source type="image/webp">` manquant dans hero | boutique/index.html | 🟠 Moyenne | 15 min | ✅ Faux positif — <picture> avec 2 sources responsive déjà en place. Confirmé 2026-05-26. |
| B-DOC-1 | CARTOGRAPHY_360_BOUTIQUE ne documente pas les redirections PR #486 | boutique/docs/ | 🟡 Moyenne | 20 min | ✅ Fait — §14 ajouté (2026-05-26). |
| B-DOC-2 | BOUTIQUE_DOCS_INDEX ne liste pas MODAL_DESKTOP/MOBILE_ARCHITECTURE.md | boutique/docs/ | 🟢 Faible | 5 min | ✅ Faux positif — déjà présents §1 et §5. Confirmé 2026-05-26. |
| B-SOT-1 | 6 fichiers actifs absents du BOUTIQUE_SOURCE_OF_TRUTH.md | boutique/docs/BOUTIQUE_SOURCE_OF_TRUTH.md | 🟠 Moyenne | 30 min | ✅ Fait — SOT v1.6, 6 fichiers ajoutés §2B. Confirmé 2026-05-26. |
| B-SOT-2 | 2 fichiers à statut incertain absents du SOT | boutique/js/ | 🟡 Moyenne | 15 min | ✅ Fait — confirmés orphelins, documentés SOT v1.6. |
| B-MODAL-MOCK | b-modal-social-proof-mock.js marqué TEMPORAIRE dans son header | boutique/js/ | 🟢 Faible | 5 min | ✅ Fait — fichier supprimé (2026-05-26). |
| ZOMBIE-1 | utils/pricing.js — router Express 1 330 l sans import, jamais monté | utils/pricing.js | 🔴 Haute | 2 min | ✅ Fait — fichier absent du repo, confirmé 2026-05-26 |
| GOD-FILES-2 | routes/dashboard-finance.js façade 48 l — metrics en service | routes/ | 🟡 Moyenne | 2h | ✅ Fait — confirmé 2026-05-26 |
| GOD-FILES-3 | routes/parcel-api-v2.js façade 3 l — découpé read/helpers/scans | routes/ | 🟡 Moyenne | 2h | ✅ Fait — confirmé 2026-05-26 |
| GOD-FILES-4 | routes/admin.js façade 4 l — 5 sous-routes + deleteOrderCascade dédupliquée | routes/ | 🟡 Moyenne | 3h | ✅ Fait — 2026-05-26 |
| GOD-FILES-6 | routes/hub-dashboard.js — logique lecture extraite | routes/ | 🟡 Moyenne | 2h | ✅ Fait — services/hub-dashboard-queries.js |
| COLLECTIVE-CLEANUP | collective-workspace-engine.js encore importé par 3 services actifs post-tombstone | services/ | 🟡 Moyenne | 1h | ✅ Fait — close-order + ready-to-order tombstonés (2026-05-26). stock-reservation conservé (repair admin dry_run). |
| BASKETS-1 | Prix snapshotés sans TTL ni alerte divergence | routes/baskets.js | 🟡 Moyenne | 1h | ✅ Fait — alias snapshot_price_kmf/current_price_kmf, log.warn structuré, price_changed par item, price_divergence au niveau panier. (2026-05-26) |

### Verdicts audits routes (session 25 mai — confirmés par analyse code)

| Fichier | Verdict | Notes |
|---|---|---|
| routes/relay-dashboard.js | ✅ Corrigé | R1 clos — assertOrderBelongsToRelais ligne 432 |
| routes/shared-cart.js | ✅ OK | I-07 ✅, idempotence ✅, délègue engine ✅, modèle actif panier partagé boutique-first. 560 lignes. |
| routes/collective-workspaces.js | ✅ Tombstone | Legacy déclassé : répond `410 collective_workspace_disabled` |
| services/collective-payment-orchestrator.js | ✅ Tombstone | No-op confirmé |
| routes/client-tracking.js | ✅ OK | Lecture seule |
| routes/client-account.js | ✅ OK | ND6 clos |
| routes/baskets.js | ✅ Fait | BASKETS-1 — divergence snapshot/catalogue détectée + log.warn + price_changed par item. (2026-05-26) |
| routes/orders/status.js | ✅ OK | 100% via transitionOrderStatus() |
| routes/relais.js | ✅ OK | Court, CRUD propre, mutations admin only |
| services/notification-service.js | ✅ Corrigé | D4 clos |
| routes/pricing.js | ✅ Fait | 283 lignes (GOD-FILES-1). Import pricingEngine/pricingRecommend/pricingDashboard. Zéro coefficient dur. |
| routes/pickup-secret.js | ✅ Fait | 756 lignes (GOD-FILES-0). Zéro UPDATE direct. buildReceiptHTML extrait. REVEAL_CACHE en DB. printTokens Map supprimée ✅ (SEC-1b, 2026-05-26). |
| bootstrap/html-routes.js | ✅ OK | /event/* et /workspace/* → redirectToBoutique() confirmé |

### Ordre de traitement recommandé (25 mai 2026)

**Immédiat** : DOC-SYNC-BOUTIQUE-FIRST (2 gaps B-DOC-1 + B-DOC-2), puis GO-LIVE-CHECK.

**Avant go-live** : rejouer `npm test`, `/health`, `/api/health`, et le flux shared-cart complet en prod.

**Conditionnel** : N4 câblage applicatif (JWT révocation complète) — migration 072 ✅, reste : jti + auth.js + logout + cron. Non bloquant go-live.

**Backlog post go-live** : N4 câblage JWT révocation (jti + auth.js + logout + cron).

---

---

## Audit backend consolidé — 2026-05-26

> Source : audit ChatGPT (5 passes) + vérification croisée code réel par Claude (2026-05-26).
> Périmètre : shared-cart, wallet, purchasing, paiements Stripe, refunds, relay-dashboard, tests, migrations, CONTRACTS.md.
> Verdict global : backend non cassé, corrections ciblées avant ouverture large.

### Findings vérifiés et confirmés

| ID | Zone | Fichier(s) | Sévérité | Statut | Verdict code |
|---|---|---|---|---|---|
| A-BE-01 / A-BE-08 | shared-cart | `services/shared-cart-engine.js` | 🔴 Haute | ✅ Fait 2026-05-26 | `confirmContributionFromStripe` retirée de `module.exports`. Fonction conservée en interne. grep anti-régression dans le commentaire. |
| A-BE-13 | purchasing | `routes/purchasing.js` | 🔴 Haute | ✅ Fait 2026-05-26 | `DELETE /po/:po_id` bloque désormais `['received','partially_received','hub_received']`. Réponse 409 avec `current_status`. |
| A-BE-02 | docs / machine statut | `docs/CONTRACTS.md`, `services/order-status-machine.js` | 🟠 Haute | ✅ Fait 2026-05-26 | CONTRACTS.md aligné sur `newStatus` avec note de correction datée. |
| A-BE-11 | paiements Stripe | `routes/payments.js` | 🟠 Haute | ✅ Fait 2026-05-26 | Réutilisation `stripe_payment_id` existant si état réutilisable. Idempotency key stable `order_pi_${order.id}` sur création. |
| A-BE-03 | collective legacy | `server.js` | 🟠 Moyenne | ✅ Fait 2026-05-26 | `startExpirationCron` supprimé de server.js. Tombstone commenté. Routes collective conservées (répondent 410). |
| A-BE-18 | migrations / runtime | `routes/relay-dashboard.js` | 🟠 Moyenne | ✅ Fait 2026-05-26 | `ensureRelayTables()` (42 l DDL runtime) retirée de la route. `migrations/071_relay_dashboard_tables.sql` créé (idempotent IF NOT EXISTS). **Confirmé appliqué sur Railway** : `order_incidents` + `order_comments` présentes dans le dump du 26 mai 2026. |
| A-BE-04 | auth guest / téléphone | `middleware/auth-guest.js` | 🟠 Moyenne | ✅ Fait 2026-05-26 | `utils/phone.js` créé (57 l) — `normalizePhone(raw, defaultCountry)` unifie logique back conservatrice + règles +33/+269 du front. `auth-guest.js` importe depuis `utils/phone`, fonction locale supprimée. |
| A-BE-16 | tests | `tests/unit/`, `tests/integration/` | 🟡 Moyenne | ✅ Fait 2026-05-26 | `tests/unit/shared-cart-financial-guard.test.js` (11 cas) + `tests/unit/shared-cart-refund-queue.test.js` (10 cas) créés. npm test : 125 passés, 1 skipped. |
| A-BE-14 | purchasing | `routes/purchasing.js` | 🟠 Moyenne | ✅ Fait 2026-05-26 | `POST /:order_id/confirm` vérifie le statut courant avant UPDATE. Retourne 409 si hors `['pending','notified']`. |
| A-BE-06 | refunds | `services/refund-service.js` | 🟡 Moyenne | ✅ Fait 2026-05-26 | `processRefundWithFallback` aligné sur modèle `pending → completed`. INSERT en pending avant Stripe. ON CONFLICT DO NOTHING + UPDATE final. |
| A-BE-07 | docs | `docs/CONTRACTS.md` | 🟡 Moyenne | ✅ Fait 2026-05-26 | CONTRACTS.md §2 : collective legacy biffé + section "Legacy tombstone — ne pas étendre" ajoutée. |
| A-BE-05 | architecture | `routes/purchasing.js` | 🟠 Moyenne | ✅ Fait 2026-05-26 | `services/purchasing-trigger-service.js` + `purchasing-receive-service.js` extraits. `routes/purchasing.js` : 841→413 lignes. 11 tests unitaires ajoutés. |
| A-BE-09 | shared-cart refund | `services/shared-cart-refund-queue.js` | 🟡 Moyenne | ✅ Fait 2026-05-26 | tests/unit/shared-cart-lifecycle.test.js : 9 cas cancelSharedCart + expireOldCarts. npm test vert 145. |
| A-BE-10 | observabilité | routes / services divers | 🟢 Faible | ✅ Fait 2026-05-26 | 0 appel non structuré restant. 55 occurrences migrées → `log.error({ err }, 'msg')`. |
| A-BE-15 | scans / parcels | `routes/scans.js` | 🟠 Moyenne | ✅ Fait 2026-05-26 | safeSyncScanToParcels déplacé avant COMMIT dans QR path + client passé → atomique. Route collect déjà dans transaction. |

### Findings nuancés ou corrigés par le code réel

| ID | Verdict | Détail |
|---|---|---|
| A-BE-12 | ✅ Corrigé (2026-05-26) | `FOR UPDATE` + `reversed_at IS NULL` ajoutés sur le SELECT initial dans `removeFromOrder()` (wallet.js lignes 283-293). Race condition concurrente fermée. |
| A-BE-17 | ✅ Faux positif — déjà résolu | STATUS.md §M1 et §M2 cochés ✅ avec confirmation en prod. Migrations appliquées manuellement sur Railway, contrainte `CHECK (balance_kmf >= 0)` et index analytiques actifs. |

### Ordre de correction recommandé (issu de l'audit)

```
P0 — Avant ouverture large :
  ✅ A-BE-01/08 — Export confirmContributionFromStripe supprimé + grep anti-régression (2026-05-26)
  ✅ A-BE-13    — Annulation PO bloquée pour ['received','partially_received','hub_received'] (2026-05-26)
  ✅ A-BE-14    — Confirmation manuelle PO limitée à ['pending','notified'], 409 sinon (2026-05-26)
  ✅ A-BE-11    — Réutilisation stripe_payment_id + idempotency key order_pi_${order.id} (2026-05-26)
  ✅ A-BE-02    — CONTRACTS.md aligné sur newStatus (2026-05-26)

P1 — Avant ouverture large :
  ✅ A-BE-12    — FOR UPDATE + filtre reversed_at IS NULL sur SELECT dans removeFromOrder() (2026-05-26)
  ✅ A-BE-06    — processRefundWithFallback aligné sur modèle pending → completed (2026-05-26)
  ✅ A-BE-07    — CONTRACTS.md : collectif legacy biffé + section tombstone ajoutée (2026-05-26)
  ✅ A-BE-03    — startExpirationCron supprimé de server.js (tombstone no-op). Routes 410 conservées (collective-workspaces.js). (2026-05-26)
  ✅ A-BE-04    — utils/phone.js créé + auth-guest.js mis à jour (2026-05-26)
  ✅ A-BE-18    — ensureRelayTables() retiré → migrations/071_relay_dashboard_tables.sql (2026-05-26). À appliquer sur Railway.
  ✅ A-BE-16    — shared-cart-financial-guard.test.js (11 cas) + shared-cart-refund-queue.test.js (10 cas). 125 passés.

P2 — Backlog post go-live :
  ✅ A-BE-05    — services/purchasing-trigger-service.js + purchasing-receive-service.js extraits. routes/purchasing.js : 841→413 lignes. 11 tests unitaires ajoutés. 2026-05-26
  ✅ A-BE-09    — tests/unit/shared-cart-lifecycle.test.js créé : 9 cas (cancelSharedCart 7 + expireOldCarts 2). npm test vert 145. (2026-05-26)
  ✅ A-BE-10    — 0 occurrence `log.error/warn('msg:', err.message)` dans routes/ services/ utils/. Migration automatique → `log.error({ err }, 'msg')`. (2026-05-26)
  ✅ A-BE-15    — safeSyncScanToParcels déplacé AVANT COMMIT dans QR path (verify-token), client passé → atomique. Route collect déjà correcte. (2026-05-26)
```

---

## Dette — DOC-INTEGRITY (27 mai 2026)

> Objectif : rendre les sources de vérité mécaniquement contraignantes, pas seulement déclaratives.
> Constat déclencheur : `docs/audit/FRONTEND_AUDIT.md` (4 avril) a pollué plusieurs sessions d'analyse car rien ne signale visuellement qu'il est périmé. L'architecture a changé depuis sans que la doc soit archivée ou bandeautée.

---

### DOC-INT-1 — Bandeaux d'archive sur les docs périmées ☐

**Problème** : les docs obsolètes sont indiscernables des docs actives à la lecture.

**Action** : ajouter en tête de chaque doc non active le bandeau suivant :

```markdown
> ⚠️ **ARCHIVÉ — ne pas utiliser comme référence.**
> Ce document date du [DATE] et ne reflète plus le code actuel.
> Source de vérité active : `docs/chantier/STATUS.md` + socle 4 docs (`AGENTS.md` §1).
```

**Fichiers à traiter en priorité** :

| Fichier | Raison |
|---|---|
| `docs/audit/FRONTEND_AUDIT.md` | Architecture refactorisée en ES modules depuis avril 2026 |
| `docs/audit/batch_2.md` à `batch_6.md` | Sessions d'audit intégrées dans STATUS.md |
| `docs/specs/collective-workspaces-v1.md` | Modèle collectif legacy tombstone depuis PR #486 |
| `docs/specs/event-flow-v2.md` | Idem — flows event désactivés |
| `docs/backend/PANIER_COLLECTIF_BACKEND_DELTA.md` | Remplacé par approche tombstone — PRs BE-A/B/C/D annulées |
| `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` | Vérifier alignement avec BOUTIQUE_SOURCE_OF_TRUTH v1.6 |

**Effort** : ~30 min. Aucun risque. Faire dans une PR dédiée `docs/archive-sweep-1`.

---

### DOC-INT-2 — Script `npm run check:socle` ☐

**Problème** : les règles de `AGENTS.md` §3 (mettre à jour le socle dans la même PR) sont honneur system — aucune vérification automatique.

**Action** : créer `scripts/check-socle.js` qui vérifie mécaniquement :

```
1. Chaque fichier dans routes/ est référencé dans CARTOGRAPHY_360.md
2. Chaque migration *.sql dans migrations/ est mentionnée dans SCHEMA.md
3. STATUS.md a été modifié dans les 7 derniers jours (alerte si non)
4. Aucun fichier .md dans docs/ (hors _archive/) ne date de plus de 60 jours
   sans être listé dans un INDEX explicite
```

**Usage** : `npm run check:socle` — sortie lisible, exit 1 si violations.

**Effort** : ~2h. Priorité après go-live.

---

### DOC-INT-3 — CI bloquante sur divergence socle ☐

**Problème** : une PR peut modifier `routes/` sans toucher `CARTOGRAPHY_360.md` et merger sans friction.

**Action** : ajouter `.github/workflows/socle-check.yml` :

```yaml
# Sur chaque PR : si routes/ ou migrations/ modifiés,
# vérifier que les docs socle correspondantes le sont aussi.
# Bloquant (required check).
```

**Règles de blocage** :

| Fichiers modifiés dans la PR | Doc socle requise |
|---|---|
| `routes/**` | `docs/CARTOGRAPHY_360.md` |
| `migrations/*.sql` | `docs/SCHEMA.md` |
| `services/*` (export modifié) | `docs/CONTRACTS.md` |
| `public/boutique/**` | `public/boutique/docs/BOUTIQUE_SOURCE_OF_TRUTH.md` |
| `docs/chantier/STATUS.md` absent | Bloquant systématique |

**Effort** : ~3h. Priorité après go-live + DOC-INT-2.

---

### DOC-INT-4 — `docs/INDEX.md` — registre exhaustif des docs actives ☐

**Problème** : il n'existe pas de liste exhaustive des docs actives. Impossible de savoir en un coup d'œil ce qui fait foi vs ce qui est historique.

**Action** : créer `docs/INDEX.md` avec trois sections :

```
## Sources de vérité (ne jamais contredire)
## Docs actives (à maintenir)
## Archive (informationnel uniquement — ne pas citer comme référence)
```

Règle associée dans `AGENTS.md` : tout nouveau fichier `.md` créé dans `docs/` doit être ajouté à `INDEX.md` dans la même PR (actif ou archive).

**Effort** : ~1h. Peut se faire en même temps que DOC-INT-1.

---

### Ordre d'exécution recommandé

```
1. DOC-INT-1  — Bandeaux archive         (~30 min, zéro risque, impact immédiat)
2. DOC-INT-4  — docs/INDEX.md            (~1h, en parallèle ou après DOC-INT-1)
3. DOC-INT-2  — npm run check:socle      (~2h, après go-live)
4. DOC-INT-3  — CI bloquante             (~3h, après DOC-INT-2 opérationnel)
```

---

## Règle de fin de session

Avant de terminer une session avec commit ou PR : mettre à jour ce fichier, vérifier le prochain lot, et vérifier `AGENTS.md` si un document socle bouge.

---

## Sprint FRESH — 2026-06-08

Audit sécurité/qualité frontend + backend. 33 findings, 33 traités.

### Findings traités

| Finding | Axe | Action | Statut |
|---|---|---|---|
| FRESH-001 | qualité | Mojibake UTF-8→cp1252→UTF-8 corrigé dans tout le backend | ✅ |
| FRESH-002 | qualité | BOM UTF-8 strippé — 22 fichiers | ✅ |
| FRESH-003 | technique | 3 fichiers orphelins `routes_orders_*.js` supprimés (~1156 lignes) | ✅ |
| FRESH-020 | technique | `parcel-security.js` DDL inline rendu idempotent (`IF NOT EXISTS`) | ✅ |
| FRESH-022 | infra | Migrations 072/073 en collision renommées 072a/073a, doublons supprimés | ✅ |
| FRESH-030 | sécurité | CSP `bootstrap/security.js` : `unsafe-inline` → `strict-dynamic` dans `scriptSrc` | ✅ |
| FRESH-032 | sécurité | OTP cooldown 45 s → 300 s (5 min) | ✅ |
| FRESH-040 | technique | `utils/email.js` : 4 appels `log.info(template)` → pino-safe | ✅ |
| FRESH-041 | technique | `server.js` : `req.query` brut → log structuré (PII) | ✅ |
| FRESH-050 | documentation | STATUS.md mis à jour (ce fichier) | ✅ |
| FRESH-060 | sécurité | `participant_token` localStorage — TTL 24h + format structuré, legacy-compatible | ✅ |
| FRESH-061 | sécurité | `escHtml()` ajouté dans `b-utils.js` — utilitaire XSS centralisé | ✅ |
| FRESH-080 | documentation | Webhook WhatsApp documenté dans `CARTOGRAPHY_360.md` | ✅ |
| FRESH-103 | fiabilité | `notification-service.js` — 6 tests unitaires (`tests/unit/notification-service.test.js`) | ✅ |
| FRESH-104 | sécurité | `ProductsView.js` — 2 `err.message` dans `innerHTML` → `textContent` | ✅ |
| FRESH-105 | doctrine | `/control-tower.html` → redirect 301 vers `/admin/pilotage` (`ADMIN_LEGACY_ENABLED=1` pour rollback) | ✅ |
| FRESH-106 | fiabilité | `b-checkout.js` — 18 tests unitaires fonctions pures (`tests/unit/b-checkout-pure.test.js`) | ✅ |
| FRESH-108 | fiabilité | Migration 076 — bloc déduplication préventive ajouté avant `CREATE UNIQUE INDEX` | ✅ |
| FRESH-109 | documentation | STATUS.md synchronisé (N4-câblage ✅, date 2026-06-08) | ✅ |

