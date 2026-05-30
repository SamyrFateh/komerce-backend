# Backend — Register de correctifs (audit indépendant)

> **Rôle** : register chirurgical des bugs backend vérifiés *contre le code réel* (pas contre les claims), avec fichier + ligne + correctif prêt à appliquer.
> **Statut** : ACTIF — mis à jour à chaque PR qui ferme une ligne.
> **Hiérarchie** : subordonné à `STATUS.md` (master chantier) et aux invariants `I-01→I-10`. En cas de contradiction avec un « ✅ Fait » de `STATUS.md`, **ce fichier documente l'écart vérifié** — corriger le code OU corriger le claim, jamais ignorer.
> **Méthode** : analyse statique du code (lecture fichiers + grep) **+ vérification contre le schéma DB réel** (`pg_dump` PostgreSQL 18.4, 95 tables — fourni 30/05). ⚠️ **Pas** de run Jest ni de requête sur DB live — les sévérités runtime restent à confirmer en exécution.
> Créé : 30 mai 2026 — périmètre audité : OTP, panier partagé/groupe, refacto boutique, câblage `server.js`, migrations, schéma DB.

---

## 0. Tableau de bord (cocher en PR)

| ID | Finding | Fichier owner | Sévérité | Statut |
|----|---------|---------------|----------|--------|
| B1 | Notifs WhatsApp panier groupe 100 % muettes (mauvais `require`) | `routes/shared-cart.js` | 🔴 Bloquant | ✅ 2026-05-30 |
| B2 | Route `PUT /api/shared-carts/:id/items` déclarée 2× — handler riche masqué | `server.js` | 🔴 Bloquant | ✅ 2026-05-30 |
| W1 | Anti-pattern Pino `log.x('msg:', err.message)` — 109 occurrences (≠ claim A-BE-10) | transverse | 🟠 | ✅ 2026-05-30 |
| W2 | `normalizePhone` non unifié — OTP force `+269`, bypass `utils/phone.js` | `routes/otp.js` | 🟠 | ✅ 2026-05-30 |
| W3 | Session OTP invisible à `client-account.js` (cookie + clé payload ≠) | `routes/client-account.js` | 🟠 | ✅ 2026-05-30 |
| W4 | `public/boutique/node_modules` (45 Mo) servi statiquement + fichiers hors-scope | `server.js` / build | 🟠 | ☐ |
| W5 | Collision migration `071_` (2 fichiers) non documentée | `migrations/` | 🟠 | ✅ 2026-05-30 |
| I1 | Fonction money morte non exportée `confirmContributionFromStripe` (piège ré-export) | `services/shared-cart-engine.js` | 🟢 | ☐ |
| I2 | Deux systèmes de migration (numérotés ⇄ inline startup) à numéros qui se chevauchent | `migrations/` + `bootstrap/` | 🟢 | ☐ |
| S1 | **TROIS systèmes de panier-groupe coexistent** en DB + code actif (`baskets`/`cart_shares`, `shared_carts`, `collective_workspaces`) | architecture | 🟠 | ✅ 2026-05-30 |
| ZG-1 | **`sendSMS()` appelé par 6 fichiers mais silencieusement mort** (`smsClient = null`) — notifications critiques jamais envoyées | 6 fichiers | 🔴 Bloquant | ✅ 2026-05-30 |
| ZG-2 | **Order + Parcel APIs v1 + v2 montées simultanément** — surface fragmentée, front doit appeler les deux | `bootstrap/api-routes.js` | 🟠 | ☐ |
| ZG-3 | **`repair-collective-*.js` toujours monté** après démontage du système C (collective_workspaces) | `bootstrap/api-routes.js` | 🟠 | ✅ 2026-05-30 |
| ZG-4 | **`dashboardRouter` monté sur 3 paths différents** (`/api/admin/pilotage`, `/api/admin/stats`, `/api/dashboard`) | `bootstrap/api-routes.js` | 🟢 | ✅ 2026-05-30 |

> Légende : ☐ à faire · ⏳ en cours · ✅ fait (dater + n° PR). Toute ligne ✅ → entrée datée en §4 Journal.

---

## B1 — Notifications WhatsApp du panier groupe : 100 % muettes

**Vérifié** :
- `routes/shared-cart.js:51` → `const { sendTemplateWhatsApp } = require('./meta-whatsapp');`
- `routes/meta-whatsapp.js:76` → `module.exports = router;` — **n'exporte PAS** `sendTemplateWhatsApp`.
- Le vrai sender existe dans `services/whatsapp-meta.js` (défini `:17`, exporté `:60-61`). Les noms de fichiers sont inversés ; ce service n'est importé par personne.

Donc `sendTemplateWhatsApp` est **`undefined`**, appelé à `routes/shared-cart.js:553` (création S3-02, route active `/from-cart-items`), `:695` (ouverture règlement S3-01, active) et `:798` (items S2-06). Les trois appels sont dans des `try/catch` best-effort → **aucun 500, mais toute notification échoue en silence**. Symptôme prod : le panier groupe « marche » mais aucun participant ne reçoit de WhatsApp.

**Correctif** — `routes/shared-cart.js:51` :
```js
const { sendTemplateWhatsApp } = require('../services/whatsapp-meta');
```
La signature (`{ to, templateName, lang, components }`) et la valeur de retour correspondent déjà aux call sites → un seul changement de chemin suffit.

**Validation** : déclencher S3-02 (création depuis panier) → vérifier l'appel API Meta réellement émis (log réseau / réponse). Tester aussi S3-01 (`:695`). Lié à **B2** pour le call site `:798`.

---

## B2 — `PUT /api/shared-carts/:id/items` déclarée deux fois → handler riche masqué

**Vérifié** :
- `server.js:140-148` : `app.put('/api/shared-carts/:id/items', authenticate, …)` inline → délègue à `sharedCartItemsService.updateOpenSharedCartItems` **sans aucune notification**.
- `server.js:150` : `app.use('/api/shared-carts', sharedCart.router);` — monté **après**.

Express prend la **première** route qui matche → l'inline gagne, et le handler complet du router (S2-06, avec notifications WhatsApp aux participants à `routes/shared-cart.js:798`) est **du code mort**.

**Correctif** — supprimer le bloc inline `server.js:140-148` (la ligne `:139` webhook Stripe et `:150` mount router restent). Le handler du router reprend la main.

**⚠️ Dépendance** : B2 rend le call site `:798` atteignable ; la notif n'y partira que si **B1 est aussi corrigé**. Faire B1 + B2 dans la même PR.

**Validation** : `PUT /api/shared-carts/:id/items` sur un panier ouvert → re-pricing serveur appliqué (déjà OK, cf. zone GOOD) **et** notification participant émise.

---

## W1 — Anti-pattern logger Pino (perte du détail d'erreur)

**Vérifié** : ~109 occurrences de `log.x('… :', err.message)` (2ᵉ argument string silencieusement ignoré par la config Pino du projet → le détail d'erreur est perdu). Présent dans routes / services / bootstrap / utils / middleware, dont **`routes/otp.js:234,366`** et **tout `bootstrap/startup-migrations.js`**.

**Écart claim** : contredit `STATUS.md` A-BE-10 « 0 occurrence restante » et l'esprit de `F1B_NOTIFICATION_LOGGER_CODEMOD.md` / `LOGGER_GUIDELINES.md`. (À l'inverse, **F1-FULL « 0 `console.*` » est VRAI** — crédit donné, ne pas régresser.)

**Correctif** — pattern unique conforme à `LOGGER_GUIDELINES.md` :
```js
// avant
log.error('paiement échoué :', err.message);
// après (objet en 1er, message en 2e — Pino sérialise err)
log.error({ err }, 'paiement échoué');
```
Codemod ciblé puis relancer l'audit qui prétendait 0 occurrence (réconcilier le compteur de A-BE-10).

**Validation** : grep `grep -rnE "log\.(error|warn|info)\([^,]+,\s*[a-zA-Z].*\.message" --include=*.js` → 0 résultat ; et un log d'erreur réel contient bien la stack.

---

## W2 — `normalizePhone` non unifié (OTP force `+269`)

**Vérifié** : `routes/otp.js:30-37` embarque son **propre** normalisateur qui force l'indicatif `+269`, court-circuitant `utils/phone.js`. Le front, lui, défaute souvent à `+33`. Conséquence : `findUserByPhone` (`otp.js:65`) ne retrouve pas un user créé via une autre surface → **doublons d'utilisateurs** / lookups ratés, puis `createLightweightUser`.

**Écart claim** : contredit A-BE-04 (« normalisation téléphone unifiée »).

**⚠️ Aggravé par le schéma DB (vérifié)** : `users.phone` porte une contrainte **`UNIQUE` (`users_phone_key`)**. Donc la divergence de normalisation n'est pas qu'un risque de doublon « best-effort » : si un user signé `+33XXXXXXXXX` (ou sans indicatif) se reconnecte via OTP qui force `+269XXXXXXX`, le lookup `findUserByPhone` échoue **puis** `createLightweightUser` tente un INSERT qui peut **violer la contrainte UNIQUE** (erreur 500/contrainte) ou créer un compte fantôme inaccessible. De plus la table `users` a **trois autres colonnes téléphone** (`phone` text, `phone_payer varchar(20)`, `phone_beneficiary varchar(20)`) → 4 représentations possibles d'un même numéro. La normalisation DOIT être unique et appliquée avant tout lookup ET tout insert.

**Correctif** — remplacer le normaliseur local par `require('../utils/phone')` et n'appliquer `+269` que comme défaut *explicite* si aucun indicatif fourni, en accord avec le front. Vérifier que création et lookup passent par la **même** fonction, et que `phone_payer`/`phone_beneficiary` sont normalisés au même format.

**Validation** : même numéro saisi `0XXXXXXX`, `+269XXXXXXX`, `269XXXXXXX` → un seul user, retrouvé à chaque login OTP.

---

## W3 — Session OTP invisible à `routes/client-account.js`

**Vérifié** : l'OTP pose les cookies `kmrc_jwt` + `kmrc_client` et signe un payload `{ id, … }`. Mais `routes/client-account.js` lit le cookie **`komerce_client`** (≠ `kmrc_client`) et **`decoded.userId`** (≠ `id`). Double désalignement → un user authentifié par OTP est « déconnecté » côté compte client. (Il existe en plus une 4ᵉ voie d'auth parallèle, magic-link — `users.magic_token` / `magic_token_expires_at` confirmés au schéma.)

**Schéma DB (confirme)** : `users.id` est de type `uuid` (`DEFAULT uuid_generate_v4()`). Le payload OTP `{id}` porte donc un uuid ; `client-account.js` qui lit `decoded.userId` obtient `undefined` (la clé n'existe pas), pas juste une valeur mal typée → la requête compte part avec un identifiant vide.

**Ce qui MARCHE (ne pas casser)** : le chemin d'auth principal lit bien `kmrc_jwt` — `middleware/auth.js:21`, `middleware/auth-guest.js:48,69`. L'OTP pose `kmrc_jwt` ✅. Le bug est circonscrit à `client-account.js`.

**Correctif** — aligner `client-account.js` sur le contrat OTP : lire cookie `kmrc_jwt` (ou `kmrc_client`) et `decoded.id`. Idéalement extraire la lecture de session dans un helper unique partagé par middleware + comptes (supprime la divergence de fond). Cartographier les 4 voies d'auth et n'en garder qu'un contrat de cookie/clé.

**Validation** : login OTP → `GET` espace compte client renvoie le bon user sans relogin.

---

## W4 — `node_modules` boutique (45 Mo) servi statiquement + fichiers hors-scope

**Vérifié** : `public/boutique/node_modules` (≈2523 fichiers, dont `playwright-core`) est exposé par le static serving. Sont aussi livrés `public/boutique/test-modal-view-model.html` et `shared-cart-account.html` (déclarés hors-scope).

**Correctif** — exclure `node_modules` du static (ou déplacer les devDeps boutique hors de `public/`), et retirer les `.html` de test du bundle livré. Ajouter une règle de build/`.gitignore`/static-ignore pour empêcher la récidive.

**Validation** : `GET /boutique/node_modules/...` → 404 ; poids du déploiement réduit.

---

## W5 — Collision de migration `071_` non documentée

**Vérifié** : `migrations/071_relay_dashboard_tables.sql` **et** `migrations/071_shared_cart_commitments.sql` partagent le numéro `071`. Les deux sont idempotents, mais l'**ordre d'application est ambigu** et la collision n'est **pas** dans `migrations/GAPS.md` — viole la règle A4 du projet. Connexe : `AUDIT_MIGRATIONS_060_061.md`, `MIGRATIONS_FOLDERS_A5.md`.

**Correctif** — renuméroter l'un des deux (`072_…`) ou documenter explicitement l'ordre dans `GAPS.md` + figer une règle « un numéro = un fichier ». Vérifier qu'aucun environnement n'a déjà appliqué l'ancien numéro avant de renommer.

**Validation** : `ls migrations/ | sort` → aucun préfixe numérique dupliqué ; `GAPS.md` à jour.

---

## I1 / I2 — Info (dette, à planifier)

**I1** — `services/shared-cart-engine.js:654` définit encore `confirmContributionFromStripe` (~480 l, version **non sûre**, sans les garanties FOR UPDATE / anti-overfunding) **non exportée**. Risque = « piège de ré-export » : un futur `module.exports` la rendrait active à la place de la version sûre. → Supprimer la fonction morte, ou la marquer `@deprecated` + test qui interdit son export.

**I2** — Deux systèmes de migration coexistent : `migrations/*.sql` numérotés **et** le bloc inline `bootstrap/startup-migrations.js` (« Migration 023-052 ») avec des numéros qui se chevauchent sémantiquement. → Documenter la frontière (qui possède quelle plage) ou converger vers un seul système.

---

## S1 — Trois systèmes de panier-groupe coexistent (révélé par le schéma)

**Vérifié (DB + code actif)** — le schéma contient **trois familles de tables** pour ce qui est, côté produit, « le panier partagé / groupe », et **les trois sont câblées** dans des routes/services actifs :

| Système | Tables | Modèle | Fichiers actifs |
|---------|--------|--------|-----------------|
| **A — legacy partage** | `baskets`, `basket_items`, `cart_shares`, `cart_contributions` | panier en table + partage par token, contributions en jsonb/lignes | `routes/baskets.js`, `routes/shares.js`, `routes/orders/create.js`, `routes/admin/*` (6 fichiers) |
| **B — shared_carts (audité)** | `shared_carts`, `shared_cart_items`, `shared_cart_contributions`, `shared_cart_commitments`, `shared_cart_events` | machine à états riche (15 statuts), garde financière Stripe sûre, idempotence | `routes/shared-cart.js`, `services/shared-cart-*.js` (11 fichiers) |
| **C — collective_workspaces** | `collective_workspaces`, `collective_workspace_items/events/contributions`, `collective_payment_sessions/tokens`, `collective_stock_reservations` | « workspace » événementiel, orchestrateur de paiement + réservation stock | `routes/collective-workspaces.js`, `services/collective-*.js` (10 fichiers) |

**Pourquoi c'est un finding 🟠 (pas juste info)** :
- **Risque de cohérence** : un même besoin produit servi par 3 schémas → des bugs comme B1/B2 (notifs muettes, handler masqué) sont **multipliés par le nombre de systèmes** ; un correctif appliqué à l'un ne couvre pas les autres.
- **Charge mentale / dette** : 27 fichiers au total se répartissent sur 3 modèles de données qui se recouvrent fonctionnellement. La doc (`STATUS.md`, SOT) ne dit pas clairement lequel est **canonique** ni lesquels sont **legacy à éteindre**.
- **Stock & argent** : seul C réserve du stock (`collective_stock_reservations`) et seul B a la garde financière Stripe vérifiée sûre. Si un flux produit passe par A ou C en croyant bénéficier des garanties de B, l'hypothèse est fausse.

**Action demandée (pas un correctif unitaire — décision d'architecture)** :
1. Statuer **lequel est canonique** (probablement B `shared_carts` : c'est le seul avec garde financière + idempotence vérifiées).
2. Marquer A et/ou C **legacy** ou **usage distinct documenté** (si C = « cagnotte événement » vs B = « panier partagé », l'écrire noir sur blanc dans `BOUTIQUE_SOURCE_OF_TRUTH.md` et `CARTOGRAPHY_360.md`).
3. Geler une règle : aucune nouvelle feature panier-groupe hors du système canonique.

**Ne rien supprimer sans audit d'usage runtime** : les trois ont des routes actives ; une extinction se fait par dépréciation tracée, pas par suppression sèche.

---

## SCHÉMA — Vérifications confirmées (renforcent l'audit)

Confrontation des hypothèses de l'audit statique au `pg_dump` réel (PostgreSQL 18.4, 95 tables) :

- **`otp_codes` existe et matche `routes/otp.js`** ✅ — colonnes `phone varchar(20)`, `code text`, `expires_at`, `attempts`, `verified`, `purpose`, `consumed_at`. Index `idx_otp_phone`, `idx_otp_phone_purpose_created`, `idx_otp_expires`. **Confirme** : pas un bloquant « table manquante ». PK sur `id` (serial), **pas** de unicité sur `phone` ici (normal — historique de codes).
- **`stripe_events_processed` existe** ✅ — PK `stripe_event_id`. **Confirme** l'idempotence webhook côté app *et* l'appuie au niveau DB.
- **`shared_cart_contributions.stripe_session_id` est `UNIQUE`** (`shared_cart_contributions_stripe_session_id_key`) ✅✅ — **protection anti-double-charge au niveau DB**, pas seulement applicative. Renforce fortement le verdict « garde financière SÛRE ».
- **Contraintes CHECK money sur `shared_carts`** ✅ — `contributed_kmf >= 0`, `remaining_kmf >= 0`, `total_kmf_snapshot > 0`, `split_mode IN ('free','equal')`. La DB refuse un état financier négatif → backstop de l'anti-overfunding applicatif.
- **Intégrité FK du chemin argent** ✅ — `shared_cart_contributions → shared_carts` en `ON DELETE RESTRICT` (impossible de supprimer un panier porteur d'argent) ; `shared_carts.beneficiary_user_id → users` en `RESTRICT` ; `items`/`events`/`commitments → shared_carts` en `CASCADE` ; `shared_cart_items.product_id → products` en `SET NULL` (cohérent avec le drop silencieux de produits inactifs noté en zone GOOD). Modèle sain : les lignes porteuses d'argent sont protégées, les éphémères cascadent.
- **Machine à états réellement complexe** — `shared_cart_status` = **15 valeurs** (`draft → active → partially_funded → … → closed_for_settlement → settlement_in_progress → ready_to_finalize`), `shared_cart_commitment_status` = 9, `shared_cart_contribution_status` = 5. **Implication** : B1 (notifs muettes) et B2 (handler masqué) sont d'autant plus impactants — les transitions d'état arrivent mais les participants ne sont **jamais** notifiés. Priorité B1+B2 confirmée.
- **`users.phone` est `UNIQUE`** — voir W2 (aggravation).
- **`users.id` est `uuid`** — voir W3 (le mismatch `decoded.userId` donne `undefined`).
- **`collective_payment_tokens.stripe_payment_intent_id` est `UNIQUE`** ✅ — le système C a aussi une dédup Stripe au niveau DB (bon point pour C, mais ne lui donne pas la garde FOR UPDATE / anti-overfunding de B).

---

## 3. Zone VÉRIFIÉE-BONNE (ne pas casser en corrigeant le reste)

- **Garde financière Stripe** : `services/shared-cart-financial-guard.js:91` `confirmContributionFromStripeSafely` — `FOR UPDATE` sur contribution puis cart, **idempotent** (`status==='paid'` → no-op), **anti-overfunding** (montant > restant → `markPaidButNotCounted` + `requires_manual_refund`). Le webhook (`routes/shared-cart.js` `stripeWebhookHandler`) utilise **uniquement** cette garde sûre, avec vérif de signature + idempotence `stripe_events_processed` + filtre metadata. ✅
- **I-07 respecté** : `server.js:69` monte `express.raw` pour le webhook Stripe **avant** `express.json` (`:72`). ✅ Si vous touchez `server.js` (B2), ne pas déplacer ce raw.
- **Table `otp_codes`** : créée au démarrage (`bootstrap/startup-migrations.js`, « Migration 025 ») ; colonnes alignées avec `routes/otp.js` → **pas** un bloquant table-manquante. ✅
- **Re-pricing serveur** : `services/shared-cart-items-service.js` ne fait jamais confiance au prix client, lock du cart, bloque paid/settled. ⚠️ note mineure : il *drop silencieusement* les produits inactifs / prix 0 (`:127,:134`) — à surfacer côté UX si besoin, mais pas un bug de sécurité.

---

## 4. Journal (ajouter une ligne datée à chaque ✅)

| Date | ID | PR | Note |
|------|----|----|------|
| 2026-05-30 | — | — | Création du register (audit backend indépendant). B1/B2/W1-W5/I1/I2 ouverts ; zone GOOD figée. |
| 2026-05-30 | S1 | — | Passe schéma DB (`pg_dump` 95 tables) : S1 ajouté (3 systèmes panier-groupe) ; W2 aggravé (UNIQUE `users.phone`) ; W3 confirmé (`users.id` uuid) ; zone GOOD renforcée (UNIQUE `stripe_session_id`, CHECK money, FK RESTRICT). |
| 2026-05-30 | S1 | — | Consolidation : C (collective_workspaces) démonté de server.js + raw webhook supprimé. A (baskets.js) tombstoné 410. Cookie `kmrc_client` supprimé de otp.js — cookie canonique unique `kmrc_jwt`. `client-account.js` documenté dead code (non monté). GAPS.md : doctrine deux systèmes de migration ajoutée. |
| 2026-05-30 | ZG-1 | — | Migration `sendSMS` → `notification-service.notifyText` dans 6 fichiers (payments, scans, orders/parcels, logistics, verify-qr-collection, purchasing-trigger). `notifyText()` ajouté à notification-service (callAuthKeyText + logNotification). Doublons dans payments.js supprimés. |
| 2026-05-30 | ZG-3 | — | `adminCollectiveRepairsRouter` et son mount `/api/admin/collective` supprimés de bootstrap/api-routes.js. |
| 2026-05-30 | ZG-4 | — | `/api/admin/pilotage` + `/api/admin/stats` supprimés — path canonique unique : `/api/dashboard`. |

---

## 5. Règle de mise à jour

Quand une ligne du §0 passe ✅ : (1) cocher le tableau, (2) Journal §4 (date + PR), (3) **réconcilier `STATUS.md`** si la ligne contredisait un claim (A-BE-04, A-BE-10…) — corriger le claim dans la même PR pour que `STATUS.md` redevienne fiable.
