# 🚀 Komerce — Roadmap Go-Live (version unifiée & consolidée)

> **Version** : 1.0 — consolidée le 8 mai 2026
> **Source de vérité** : audit code v10.6.1 du 8 mai 2026
> **Remplace** : ROADMAP_PILOTE_KOMERCE.md + fragments dans AUDIT_KOMERCE_FINAL.md
> **Principe** : le code fait foi, pas les anciens docs.

---

## 🟢 Ce qui est déjà solide — ne pas retoucher

L'audit code du 8 mai révèle que **beaucoup plus est fait que ce que les docs laissaient croire**.
Ces points sont fermés, classés, ne demandent aucune action.

| Sujet | État réel | Source |
|---|---|---|
| **Sécurité #71** Injection SQL | ✅ Toutes les requêtes paramétrées `$1, $2…` | AUDIT §Sécurité |
| **Sécurité #72** JWT secret faible | ✅ Fallback supprimé, crash au boot si absent | AUDIT §Sécurité |
| **Sécurité #73** Reset password admin | ✅ Guard `authenticate + requireRole(['admin'])` partout | AUDIT §Sécurité |
| **Sécurité #74** CORS trop permissif | ✅ Whitelist `FRONTEND_URL + ALLOWED_ORIGINS` | AUDIT §Sécurité |
| **Sécurité #75** Rate limiting admin | ✅ 6 limiters spécialisés appliqués | AUDIT §Sécurité |
| **Sécurité #76** POST /admin/reset en prod | ✅ Désactivé sauf `ALLOW_SEED=true` | AUDIT §Sécurité |
| **V-01** UPDATE direct dans logistics.js | ✅ Aucun UPDATE orders SET status hors state machine | AUDIT §Architecture |
| **State machine SSOT** | ✅ `order-status-machine.js` — seul chemin, 100 % | AUDIT §Architecture |
| **Doctrine économique** | ✅ 4 prix, health_status, market_confidence implémentés | AUDIT §Architecture |
| **5 expériences d'achat** | ✅ Direct, M10, gift, workspace, modules — opérationnelles | SYNOPTIQUE §3 |
| **Observabilité** | ✅ Pino structuré, Request-ID, 6 rate-limiters, error-handler centralisé | AUDIT §Infrastructure |
| **Tests existants** | ✅ 2 811 lignes — state machine, wallet, validators, E2E shell | AUDIT §Tests |

> **Maturité estimée** : **75–80 %**. Le Go-Live est à 3–5 jours de hardening sérieux, pas 5–7.

---

## 📋 Vue globale des chantiers

| # | Chantier | Priorité | Effort | Bloqué par | Statut |
|---|---|:-:|:-:|:-:|:-:|
| **C1** | Migration 068 — Simplification couture | 🔴 P0 | 2h30 | — | ⬜ |
| **C2** | Backup pg_dump quotidien + restore testé | 🔴 P0 | 1j | — | ⬜ |
| **C3** | Reset factory prod + audit données test | 🔴 P0 | 0.5j | C2 d'abord | ⬜ |
| **C4** | Sentry activation | 🟠 P1 | 1h | — | ⬜ |
| **C5** | Cash relais — guard cash_ref_code | 🟠 P1 | 2h | — | ⬜ |
| **C6** | Mot de passe admin + rotation secrets | 🟠 P1 | 0.5j | C2 | ⬜ |
| **C7-bis** | Mobile boutique — bugs + améliorations | 🟠 P1 | 1.5j | C6 | ⬜ |
| ☁️ | **— SOFT LAUNCH —** | | | C1→C7-bis | |
| **C7** | Refonte Desktop Frontend | 🟡 P1 post-launch | 2–3j | — | ⬜ |
| **C8** | Panier collectif — pivot cash uniquement | 🟡 P1 post-launch | 1–2j | — | ⬜ |
| **C9** | Page Sur-mesure & Modules (backend + frontend) | 🟢 P2 | 1–2j | C1 | ⬜ |
| **C10** | Ménage docs (56 → 22 fichiers) | 🟢 P2 | 1j | — | ⬜ |
| **C11** | Mise à jour ROADMAP_KOMERCE.md (métriques réels) | 🟢 P2 | 1h | — | ⬜ |

**Ordre Go-Live** : `C1 → C3 → C2 → C6 → C4 → C5 → C7-bis → Soft Launch → C7 / C8 / C9 / C10 / C11`

> **Nota** : C7-bis (mobile) est passé **avant** le soft launch par rapport à la roadmap initiale. Justification : le trafic diaspora arrive majoritairement par WhatsApp → mobile. C7 desktop peut attendre l'après-launch.

---

## 🗓️ Sprint 1 — Hardening (3–5 jours)

```
Jour 1 matin  ── C1  : migration 068 couture — vérification Supabase + migration + fix-schema.js
Jour 1 apm    ── C3  : audit base prod, identification données test (lecture seule d'abord)
Jour 2        ── C2  : pg_dump quotidien + stockage externe + script restore + TEST réel
Jour 3 matin  ── C4  : Sentry installé, DSN en env, erreur test envoyée
Jour 3 apm    ── C6  : audit env vars + rotation secrets + nouveau mot de passe admin
Jour 4        ── C5  : guard cash_ref_code + 3 essais → 429 + tests unitaires
Jour 5        ── C7-bis : bugs mobile (ghost gauche) + 3 améliorations clés + tests iOS/Android
```

---

## 🔴 C1 — Migration 068 Simplification couture

**Durée** : 2h30 · **P0** · **Bloque** : C9 (sur-mesure)

### Contexte

Le modèle couture actuel simule un atelier en ligne (tissus + modèles à composer). Le vrai métier : Komerce sélectionne des modèles avec ses couturiers partenaires, les met en catalogue sous sa marque maison, le client choisit et donne ses mensurations. La prod est vide → on réécrit proprement.

L'audit code révèle un bug supplémentaire : les colonnes `module_type`, `module_fabric_id`, `module_fabric_type`, `module_size`, `module_retouche`, `module_qty_meters`, `module_accessories` sur `orders` et `order_items` n'existent dans **aucune migration ni dans `db/schema.sql`** — elles ont été ajoutées manuellement sur Supabase. La migration 068 règle ça proprement.

**Spec complète** : `COUTURE_SIMPLIFICATION.md`

### Ce que fait la migration 068

- Ajoute 5 colonnes sur `products` : `is_komerce_made`, `available_sizes`, `size_guide_extra`, `confection_partner_id`, `confection_delay_days`
- Ajoute 3 colonnes sur `order_items` : `module_size`, `module_measurements`, `module_instructions`
- Supprime les anciennes colonnes `module_type`, `module_fabric_id`, etc. sur `orders` et `order_items`
- Supprime les tables `fabrics` et `garment_models` (aucune donnée en prod)
- Idempotente — `ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS`

### Prompt Sonnet (à coller tel quel)

```
Tu es un dev sénior. Tu vas appliquer une simplification du modèle couture sur le backend Komerce.
Le doc COUTURE_SIMPLIFICATION.md décrit exactement quoi faire — diff par diff.
La prod est vide, on peut faire la migration directement.

Ta mission, dans cet ordre exact :

1. Crée migrations/068_couture_simplification.sql avec le SQL exact du doc §1 fin.
2. Mets à jour db/schema.sql pour refléter le nouvel état (colonnes ajoutées sur products et order_items,
   anciennes colonnes module_* et confection_* supprimées, tables fabrics et garment_models supprimées).
3. Applique le diff sur routes/orders/create.js (doc §2).
4. Applique le diff sur routes/modules.js (doc §3) : supprime /fabrics, /models, simplifie /price.
5. Applique le diff sur routes/orders/detail.js (doc §4).
6. Mets à jour validators/index.js pour orders.create — remplace les anciens champs module_* par
   module_size, module_measurements (JSONB), module_instructions au niveau item.
7. Adapte tests/integration/api.test.js pour les nouveaux champs.
8. Ajoute la migration 068 dans scripts/fix-schema.js pour exécution automatique au boot.

Règles strictes :
- Tu commits après CHAQUE étape (1 commit par étape, message en français court)
- Tu ne touches à AUCUN autre fichier
- Tu ne modifies AUCUN invariant : R1 (state machine SSOT) reste intacte
- Si tu hésites sur une décision architecturale → tu t'arrêtes et tu demandes
- Si un test échoue → tu fixes le test pour refléter le nouveau modèle, sans inventer de logique métier

Démarre par l'étape 1.
```

**Fichiers à attacher** : `COUTURE_SIMPLIFICATION.md` + arborescence `routes/`, `services/`, `db/`, `migrations/`, `validators/`, `scripts/`, `tests/`

### Critères de fin

- ✅ Migration tourne sans erreur en local
- ✅ `npm test` passe
- ✅ Commande couture avec `module_measurements` créable et visible dans detail.js
- ✅ 8 commits propres dans la branche `chore/068-couture-simplification`

---

## 🔴 C2 — Backup pg_dump quotidien + restore testé

**Durée** : 1j · **P0 strict** · **Bloque** : C3, C6

### Contexte

Supabase fait des backups automatiques (7–30j selon plan), mais aucune procédure de restauration n'a jamais été testée. Single point of failure. Ce chantier installe un pg_dump quotidien indépendant et **teste vraiment** la restauration avant le Go-Live.

### Prompt Sonnet

```
Tu es un dev DevOps. Tu vas mettre en place un backup PostgreSQL quotidien pour Komerce,
indépendant de Supabase, et tester la procédure de restauration.

Architecture cible :
- Source : DATABASE_URL (Supabase PostgreSQL)
- Cible : stockage externe (S3, Cloudflare R2, ou GitHub Releases privées — demande d'abord)
- Fréquence : quotidien à 03:00 UTC
- Rétention : 30 jours
- Cron : GitHub Actions (gratuit, simple)

Tâches :

1. Crée scripts/backup-prod.sh qui :
   - Lit DATABASE_URL depuis l'env
   - Lance pg_dump --format=custom --no-owner --no-acl
   - Compresse en .gz
   - Upload sur le storage cible
   - Affiche résumé : taille, durée, chemin distant
   - Logue dans /var/log/komerce-backup.log si présent

2. Crée .github/workflows/backup-prod.yml qui :
   - S'exécute à 03:00 UTC tous les jours
   - Utilise les secrets DATABASE_URL et STORAGE_CREDENTIALS
   - Notifie en cas d'échec (webhook Slack/Discord/email — demande le préféré)
   - Conserve les 30 derniers .gz, supprime les plus anciens

3. Crée scripts/restore-from-backup.sh qui :
   - Liste les backups disponibles
   - Demande confirmation interactive avant de restaurer
   - Restaure dans une base TEMPORAIRE (pas la prod)
   - Affiche un rapport : nb tables, nb commandes, nb users

4. Crée docs/RESTORE_PROCEDURE.md avec le pas-à-pas complet :
   - Commandes exactes pour un restore en urgence
   - Vérification d'intégrité post-restore
   - Tests fonctionnels à lancer
   - Contacts (placeholders à remplir)

5. TEST RÉEL : lance le backup, fais le restore sur base de test, valide que tout est intact.

Règles :
- Demande le storage cible AVANT de coder
- pg_dump 16+ (compatible Supabase)
- Aucun secret en dur dans le code
- Le script restore EST TESTÉ avant de fermer le ticket
- Commits étape par étape

Démarre par demander le choix du storage.
```

**Fichiers à attacher** : arborescence `scripts/` et `.github/` + `package.json`

### Critères de fin

- ✅ `scripts/backup-prod.sh` produit un .gz lisible
- ✅ `scripts/restore-from-backup.sh` restaure ce .gz dans une base de test
- ✅ COUNT par table identique avant/après
- ✅ Workflow GitHub Actions vert sur 1 run manuel
- ✅ `docs/RESTORE_PROCEDURE.md` existe

---

## 🔴 C3 — Reset factory prod + audit données test

**Durée** : 0.5j · **P0** · **Bloqué par** : C2 (backup vérifié d'abord !) · **Bloque** : Go-Live

### Contexte

La base contient probablement des commandes E2E (références K85AJL4 et autres), des comptes admin/dev, des produits seed AliExpress. Avant le launch, faire le tri.

⚠️ **Ne jamais lancer sans avoir le backup de C2 vérifié et testé.**

### Prompt Sonnet

```
Tu es un dev senior. Tu vas auditer la base de données de production Komerce et préparer
un reset factory propre. Un backup vérifié existe déjà. Tu peux travailler en confiance.

Tâches :

1. Connecte-toi à la prod (DATABASE_URL) en LECTURE SEULE d'abord.
   Génère un rapport audit-prod.md :
   - Nombre d'enregistrements par table (orders, users, products, baskets, etc.)
   - Liste des enregistrements à l'allure "test" :
     * emails @test.com, @komerce.km, @dev.com
     * commandes avec référence contenant "TEST" ou "K85"
     * users avec role='admin' ou nom de dev
     * produits is_active=false
   - Toute donnée qui paraît être un seed ou un test

2. Présente le rapport. ATTENDS décision explicite sur quoi purger.

3. Une fois la décision prise, crée scripts/reset-factory-prod.sql :
   - Transaction unique avec BEGIN/COMMIT
   - Supprime les enregistrements identifiés (CASCADE bien géré)
   - Resets des séquences si nécessaire
   - Garde : 1 admin (l'utilisateur précisera son email), relais, transporteurs, config
   - Option DRY-RUN (ROLLBACK final)

4. Lance le DRY-RUN. Présente le diff. Si l'utilisateur confirme, exécute vraiment.

5. Génère audit-prod-post.md avec les nouveaux comptes par table.

Règles :
- Tu te connectes en lecture seule pour l'étape 1
- Tu ne lances RIEN qui modifie la base sans "oui je confirme" explicite
- Tu vérifies que le backup du chantier C2 est < 1h avant tout DELETE

Démarre par l'audit lecture seule.
```

**Fichiers à attacher** : arborescence `db/` et `scripts/`

### Critères de fin

- ✅ `audit-prod.md` rendu et validé
- ✅ `scripts/reset-factory-prod.sql` exécuté avec succès
- ✅ `audit-prod-post.md` confirme l'état attendu
- ✅ Smoke test : créer un user, voir le catalogue → OK

---

## 🟠 C4 — Sentry activation

**Durée** : 1h · **P1** · **Bloqué par** : rien

### Contexte

Le code est **déjà prêt** (`services/monitoring.js:53` fait `require('@sentry/node')` si `SENTRY_DSN` est en env). Il manque uniquement : `npm install @sentry/node`, la DSN en env Railway, un test.

### Prompt Sonnet

```
Tu vas activer Sentry sur le backend Komerce. Le code est déjà prêt — juste l'installer.

1. npm install @sentry/node@latest --save (vérifie compat Node 20)
2. Lis services/monitoring.js pour repérer le require dynamique et vérifier que ça marchera
3. Demande à l'utilisateur de fournir un SENTRY_DSN (compte gratuit sentry.io si pas déjà fait)
4. Ajoute SENTRY_DSN dans .env.example avec un commentaire
5. Laisse SENTRY_DSN OPTIONNEL — si absent, le serveur démarre normalement (ne pas ajouter dans REQUIRED_ENV)
6. Démarre le serveur localement avec un faux DSN, vérifie qu'il ne crashe pas
7. Déclenche une erreur intentionnelle via une route admin de test, vérifie qu'elle arrive sur Sentry
8. Documente en 1 paragraphe dans README.md

Règles :
- Sentry reste optionnel (dev sans DSN = OK)
- Pas de PII envoyé à Sentry par défaut
- Le release Sentry = git SHA court automatique

Démarre par étape 1.
```

**Fichiers à attacher** : `services/monitoring.js` + `package.json`

### Critères de fin

- ✅ Erreur de test visible dans le dashboard Sentry
- ✅ Serveur démarre sans SENTRY_DSN (compat dev)

---

## 🟠 C5 — Cash relais : guard cash_ref_code

**Durée** : 2h · **P1** · **Bloqué par** : rien

### Contexte

Faille documentée dans `ZONE_IMPACT.md` chaîne 4 : l'agent qui valide un paiement cash (`→ ordered`) saisit un code 6 chiffres mais le backend ne re-vérifie pas strictement que ce code correspond à la bonne commande.

### Prompt Sonnet

```
Tu vas ajouter un guard backend strict pour la validation cash_ref_code dans Komerce.

Contexte :
- Client cash → reçoit un code 6 chiffres (cash_ref_code).
- L'agent du relais saisit ce code pour confirmer le paiement.
- Aujourd'hui le backend ne vérifie pas que le code saisi == cash_ref_code de la commande.
- Doc de référence : ZONE_IMPACT.md chaîne 4.

Tâches :

1. Identifie l'endpoint qui valide le cash
   (probablement routes/orders/order-api-v2.js ou routes/orders/admin-actions.js
   — cherche les transitions vers 'ordered' avec source='cash_relais').

2. Ajoute un guard strict :
   - Le payload doit contenir cash_ref_code
   - Lecture du cash_ref_code stocké en base sur l'order
   - Comparaison stricte (===), pas de tolérance majuscule/espace
   - Si différent → 400 avec message explicite ("Code invalide pour cette commande")
   - Trace dans order_status_history la tentative ratée (pour audit)

3. Compteur d'échecs : 3 échecs consécutifs → blocage 5 min
   (utilise rate-limit.js comme pattern, ou table cash_validation_attempts)

4. Test unitaire dans tests/unit/ qui valide :
   - bon code → 200
   - mauvais code → 400
   - 3 mauvais codes → 429

5. Mets à jour ZONE_IMPACT.md chaîne 4 : marque le TODO comme résolu.

Règles :
- Tu ne touches pas à la state machine
- Tu n'utilises que des SELECT/UPDATE, pas de transition directe de statut
- Commits étape par étape

Démarre par l'identification de l'endpoint exact.
```

**Fichiers à attacher** : `docs/ZONE_IMPACT.md` + `routes/orders/` + `services/order-status-machine.js`

### Critères de fin

- ✅ Test : mauvais code → 400
- ✅ Test : 3 essais → 429
- ✅ `ZONE_IMPACT.md` à jour

---

## 🟠 C6 — Mot de passe admin + rotation secrets

**Durée** : 0.5j · **P1** · **Bloqué par** : C2 (savoir qu'on a un backup) · **Bloque** : Go-Live

### Contexte

Avant le launch, vérifier toutes les env vars critiques et tourner les secrets qui ont pu être exposés (commits passés, screenshots, logs partagés…).

### Prompt Sonnet

```
Tu vas auditer et durcir tous les secrets de la prod Komerce.

1. Liste exhaustive des env vars utilisées dans le code :
   - grep "process.env." dans tout le projet
   - Catégorise : critique (secrets) / config (URLs) / feature flag
   - Génère audit-secrets.md

2. Pour chaque secret critique, vérifie son entropie :
   - JWT_SECRET → 64+ caractères aléatoires
   - ADMIN_PASSWORD → changé depuis le seed initial
   - STRIPE_SECRET_KEY → en mode sk_live_ (pas sk_test_)
   - DATABASE_URL → pointe prod, pas staging
   - WID_OTP, WID_MAGIC_LINK, RESEND_API_KEY, AT_API_KEY…

3. Pour chaque secret à tourner, génère un nouveau (cryptographiquement aléatoire)
   et propose le plan de rotation :
   - Mettre à jour Railway env vars
   - Redéployer (zero-downtime ou maintenance window)
   - Vérifier post-deploy

4. Mot de passe admin :
   - Génère un mot de passe fort (24 chars, mixte)
   - Mets à jour via mécanisme ADMIN_PASSWORD env
   - Force rotation à la prochaine connexion (flag must_change_password si existant)

5. Vérifie .env.example : tous les secrets listés ? Aucune valeur réelle dedans ?

6. Vérifie .gitignore : .env ignoré ? Aucun .env committé dans l'historique ?
   (git log --all --full-history -- .env)

Règles :
- Jamais un secret en clair dans un fichier qui sera committé
- Vérifier que la rotation a réussi (login admin OK) avant de marquer terminé

Démarre par le grep.
```

**Fichiers à attacher** : `.env.example` + `server.js` + `scripts/fix-schema.js`

### Critères de fin

- ✅ `audit-secrets.md` complet
- ✅ Tous les secrets critiques tournés en prod
- ✅ Login admin avec nouveau mot de passe OK

---

## 🟠 C7-bis — Boutique Mobile : bugs + améliorations

**Durée** : 1.5j · **P1** · **Bloqué par** : C6 · **Bloque** : Soft Launch
**Avant le soft launch** — le trafic diaspora arrive majoritairement par WhatsApp → mobile.

**Spec complète** : `MOBILE_BOUTIQUE_AUDIT.md` (référence) et `MOBILE_BOUTIQUE_FIXES.md` (version concise)

### Contexte

Le pager mobile (`b-pager.js`) a un infinite scroll à droite fonctionnel mais pas de ghost gauche : swiper depuis "Tout" vers la gauche ne reboucle pas. L'audit identifie aussi 4 bugs secondaires et 8 améliorations UX ("Temu-like") dont 3 sont prioritaires pour la conversion diaspora.

### Architecture technique

- Frontend : ES modules natifs, pas de framework, pas de bundler
- Pattern `b-*.js` dans `public/boutique/js/`
- Bus d'événements : `b-bus.js` · State : `b-store.js` · Tokens : `tokens.css`
- Breakpoint desktop : ≥ 900px

### Ordre d'exécution (3 parties)

**PARTIE A — Ghost gauche (PRIORITÉ ABSOLUE, 4h)**

Le fix implique 3 modifications dans `b-pager.js` :

1. `_setupInfiniteLoop` : ajouter création ghost gauche (clone de la dernière catégorie) + décalage scroll initial d'une page (avec double `requestAnimationFrame` pour mesurabilité) + désactivation scroll-snap temporaire pour iOS Safari
2. `_setupScrollSync` : étendre la détection pour distinguer `ghostType === 'left'` de `ghostType === 'right'`
3. `_ghostTeleport` : refactorer pour accepter un paramètre `direction` ('left' | 'right') et gérer les deux cas

Diffs exacts disponibles dans `MOBILE_BOUTIQUE_AUDIT.md §A.3`.

**PARTIE B — Autres bugs (2h, certains à valider avant)**

| Bug | Action |
|---|---|
| **B.1** `_recalcPagerVars` trop souvent | Mesurer la fréquence d'abord, debounce 100ms si > 3/s |
| **B.2** Re-création ghosts pendant téléportation | Appliquer le diff (check `currentPage?.dataset.ghost` avant de rebuild) |
| **B.3** Bounce vertical → page suivante trop sensible | Valider avec l'utilisateur avant de toucher (3 options dans le doc) |
| **B.4** SW reset "nuclear" en haut de index.html | Tracer l'origine via `git blame` — supprimer seulement si incident résolu > 30j |

**PARTIE C — 3 améliorations clés (4–6h, certaines à valider)**

| Amélioration | Priorité | Effort | Action |
|---|---|---|---|
| **C.7** Bloc "Comment ça marche" avant checkout | P0 conversion | 2–3h | Modale 4 étapes visuelles + localStorage `kmrc_seen_howto` |
| **C.6** Rail "Récemment consultés" | P1 rétention | 1–2h | `b-recently-viewed.js`, localStorage max 8 items, rail entre hero et grille |
| **C.3** Renommer "Pour vous…" → "Sur-mesure" | P1 clarté | 5 min | Édition `index.html` ligne 215 |
| **C.5** Badge "Plus que N disponibles" si stock ≤ 5 | P1 | 1h | Modifier `render-product-card.js`, badge orange `--coral` |
| **C.2** Hero mobile trop haut | À valider | — | Mesurer en DevTools mobile 375×667, agir seulement si 0 produit visible |
| **C.8** Filtres rapides recherche | Reporté V2 | — | Documenter dans roadmap post-launch |

### Prompt Sonnet (à coller tel quel)

```
Tu es un dev frontend expérimenté. Tu vas appliquer des corrections et améliorations
sur la boutique mobile Komerce.
Le doc MOBILE_BOUTIQUE_AUDIT.md décrit chaque correction précisément avec les diffs exacts.

CONTEXTE TECHNIQUE :
- Frontend : ES modules natifs (pas de framework), pas de bundler
- Pattern b-*.js dans public/boutique/js/
- Bus d'événements : public/boutique/js/b-bus.js
- State : public/boutique/js/b-store.js
- Le pager mobile est public/boutique/js/b-pager.js (550 lignes)
- Tokens CSS : public/boutique/css/tokens.css

CONTRAINTES STRICTES :
- Tu n'introduis AUCUN framework (pas de React/Vue/Svelte)
- Tu n'introduis AUCUN bundler (pas de Vite/Webpack)
- Tu n'introduis AUCUNE dépendance npm
- Tu utilises UNIQUEMENT les tokens de tokens.css pour les couleurs
- Tu testes APRÈS CHAQUE fix sur (a) Chrome DevTools mobile (b) vrai device si possible
- Tu commits après chaque fix (1 fix = 1 commit)

ORDRE D'EXÉCUTION :

═══ PARTIE A — Bug ghost gauche (PRIORITÉ ABSOLUE) ═══

1. Lis intégralement public/boutique/js/b-pager.js
2. Applique les 3 modifications exactes du §A.3 de MOBILE_BOUTIQUE_AUDIT.md :
   - Modification 1 : _setupInfiniteLoop (ghost gauche + décalage scroll initial)
   - Modification 2 : _setupScrollSync (détection ghostType 'left' / 'right')
   - Modification 3 : _ghostTeleport (paramètre direction)
3. Teste sur Chrome DevTools mobile (375×667) : valider les 6 points du §A.3 fin
4. Teste sur vrai iPhone si possible (critique pour Safari iOS + scroll-snap)
5. Commit : "fix(mobile): bidirectional infinite scroll on category pager"

═══ PARTIE B — Autres bugs ═══

6. Fix B.2 (re-création ghosts pendant téléportation) — applique le diff §B.2
   Commit : "fix(mobile): preserve scroll position when ghosts are recreated"

7. B.1 (debounce _recalcPagerVars) — MESURER D'ABORD :
   - Ajoute console.count dans la fonction, scrolle 30 secondes
   - Si > 3 fois/seconde : applique le debounce 100ms
   - Sinon : documente "B.1 vérifié OK" et passe au suivant

8. B.4 (SW reset nuclear) — DEMANDE D'ABORD au user si c'est encore nécessaire,
   trace via git blame, propose suppression seulement si incident résolu > 30j

9. B.3 (bounce vertical) — DEMANDE AU USER sa préférence avant de modifier

═══ PARTIE C — Améliorations conversion ═══

10. C.3 Renommer "Pour vous…" → "Sur-mesure" dans index.html
    Commit : "ux(mobile): rename 'Pour vous' chip to 'Sur-mesure'"

11. C.6 Rail "Récemment consultés" — crée b-recently-viewed.js
    Hook : à chaque ouverture modal produit → product_id en tête de localStorage
    'kmrc_recently_viewed' (max 8, dédup par id). Rail horizontal masqué si vide.
    Commit : "feat(mobile): add recently-viewed products rail"

12. C.7 Bloc "Comment ça marche" avant checkout
    Modale ou page /comment-ca-marche, 4 étapes visuelles :
    Paiement EUR → Code SMS → Retrait cash relais → Confirmation WhatsApp.
    Trigger : 1ère arrivée checkout (localStorage 'kmrc_seen_howto').
    Commit : "feat(checkout): explain cash-relais flow before purchase"

13. C.5 Badge "Plus que N disponibles" si stock ∈ [1, 5]
    Modifie render-product-card.js, badge orange (--coral).
    Commit : "feat(catalog): show low-stock urgency badge"

RÈGLES DE COMMUNICATION :
- À chaque commit, fais un résumé en 2 lignes
- Toutes les 30 min : "résumé de ce qui est fait jusqu'ici"
- Si tu hésites sur une décision UX → tu t'arrêtes et tu demandes
- Si un test échoue sur iOS Safari mais marche sur Chrome → tu stoppes et tu signales

Démarre par lire b-pager.js intégralement. Confirme quand c'est fait.
```

**Fichiers à attacher** : `MOBILE_BOUTIQUE_AUDIT.md` + `public/boutique/js/b-pager.js` + `b-catalog.js` + `b-mini-cart.js` + `main.js` + `render/render-product-card.js` + `css/tokens.css` + `css/products.css` + `css/layout.css` + `index.html`

### Critères de fin

- ✅ Swipe gauche depuis "Tout" → dernière catégorie, pas de flash visible
- ✅ Swipe droite depuis dernière catégorie → "Tout" avec reshuffle (existant non cassé)
- ✅ Chip "Sur-mesure" renommée correctement
- ✅ Rail "Récemment consultés" fonctionnel après 3 visites de produit
- ✅ Modale "Comment ça marche" affichée à la 1ère arrivée checkout
- ✅ Badge "Plus que N disponibles" sur stock ≤ 5
- ✅ Tests sur 3 environnements : Chrome DevTools mobile + iPhone réel + Android
- ✅ Commits propres sur branche `feature/mobile-audit-may-2026`

---

## ☁️ SOFT LAUNCH

Après C1 → C3 → C2 → C6 → C4 → C5 → C7-bis.

**Protocole** :
- Annonce diaspora limitée (200–500 personnes ciblées via WhatsApp)
- Monitoring Sentry + Pino actif, équipe en astreinte
- Daily standup pour traiter les remontées
- Pas de nouvelle feature — on observe et on fixe
- Durée avant public launch : 2 semaines sans incident bloquant

---

## 🟡 C7 — Refonte Desktop Frontend *(post-launch)*

**Durée** : 2–3j · **P1 post-launch** · **Bloqué par** : Soft Launch

### Contexte

Le frontend boutique (`public/boutique/`) est à ~80 % fonctionnel sur mobile, mais l'expérience desktop manque de finition. L'architecture est propre (29 fichiers JS modulaires, bus d'événements, state centralisé). Un effort `b-desktop-upgrade.js` (685 lignes) est déjà commencé.

### Livrables attendus

1. **Layout desktop deux colonnes** — sidebar catégories (sticky, 240px max) + grille produits (3–4 colonnes)
2. **Mega-menu navigation** — panneau slide à droite au hover sur une catégorie, 200ms delay, fermeture Escape
3. **Drawer panier desktop** — slide-in à droite, permanent si ≥ 1200px
4. **Footer riche** — 4 colonnes, newsletter signup UI, mentions légales
5. **Modale produit améliorée** — thumbnails, zoom au hover, specs accordéon, trust badges, sous-total dynamique

### Prompt Sonnet

Le prompt complet est dans `ROADMAP_PILOTE_KOMERCE.md §Chantier 7`. Contraintes strictes : pas de framework, pas de bundler, uniquement les tokens de `tokens.css`, tout passe par le bus, aucune régression mobile.

**Fichiers à attacher** : `public/boutique/js/` (arborescence complète) + `public/boutique/css/` + `index.html`

### Critères de fin

- ✅ Layout deux colonnes fonctionnel ≥ 900px
- ✅ Mega-menu opérationnel
- ✅ Drawer panier desktop
- ✅ Footer complet
- ✅ Modale produit améliorée
- ✅ Zéro régression sur mobile < 900px

---

## 🟡 C8 — Panier collectif : pivot cash uniquement *(post-launch)*

**Durée** : 1–2j · **P1 post-launch** · **Bloqué par** : Soft Launch

### Contexte

Le workspace collectif supporte actuellement Stripe EUR et cash. Pour simplifier l'expérience et la gestion côté opérateurs, pivoter vers **cash uniquement** pour la V1 : les cousins se cotisent localement, un référent paie au relais avec le code collectif.

### Prompt Sonnet

Le prompt complet est dans `ROADMAP_PILOTE_KOMERCE.md §Chantier 8`. Points clés : désactiver Stripe pour les workspaces collectifs, mettre à jour l'UI "cotisation", adapter les notifications (pas de webhook Stripe), s'assurer que la machine à états reste cohérente.

### Critères de fin

- ✅ Workspace collectif → paiement cash uniquement (Stripe désactivé pour ce tunnel)
- ✅ Notifications WhatsApp adaptées
- ✅ Tests E2E complets du tunnel collectif

---

## 🟢 C9 — Page Sur-mesure & Modules *(post-launch)*

**Durée** : 1j backend + 1j frontend · **P2** · **Bloqué par** : C1 (couture simplifiée)

**Spec complète** : `SPEC_SUR_MESURE_PAGE.md`

### Contexte

Nouvelle page boutique `/sur-mesure-et-modules` présentant les 4 modules spécialisés (couture, lunettes, construction, cosmétiques) + la catégorie "Sur-mesure léger" du catalogue. Statuts visibles, liste d'attente pour les modules à venir.

### Livrables backend

1. **Migration `069_module_waitlist.sql`** *(renommée depuis 066 dans la spec — la migration 068 prend couture)*
   - Table `module_waitlist` (id, module_type, user_id, email, phone, note, source, notified_at, created_at)
   - Contrainte : au moins email OU phone OU user_id
   - Index uniques partiels : `(module_type, email) WHERE email IS NOT NULL`

2. **Extraction de `services/modules-registry.js`** depuis `routes/modules.js` (pour import partagé)

3. **Route `routes/sur-mesure.js`** avec 3 endpoints :
   - `GET /api/sur-mesure/overview` → agrégation modules + suggestions + sur-mesure léger
   - `POST /api/sur-mesure/waitlist` → inscription (idempotente : 2e inscription = 200 `already_subscribed`)
   - `GET /api/sur-mesure/waitlist/stats` → admin uniquement, compteurs par module

4. **Validator `surMesure.subscribeWaitlist`** dans `validators/index.js`

5. **1 ligne dans `server.js`** : `app.use('/api/sur-mesure', surMesureRouter)`

6. **Tests** : `tests/integration/sur-mesure.test.js` (squelette complet dans la spec §9)

### Prompt Sonnet

```
Tu vas implémenter le backend de la page "Sur-mesure & Modules" pour Komerce.
Le doc SPEC_SUR_MESURE_PAGE.md contient tout : migration SQL complète, validator Joi,
route complète (200 lignes), format JSON de réponse, squelette de tests.

Points d'attention :
- La migration s'appelle 069_module_waitlist.sql (pas 066 comme dans la spec — 068 est pris par la couture)
- Extraire MODULES_REGISTRY dans services/modules-registry.js avant de coder la route
- L'inscription waitlist est idempotente : 2e inscription même (module, email) → 200 already_subscribed
- L'endpoint overview est en lecture seule — blast radius faible, aucun invariant touché

Tâches dans l'ordre :
1. Extraire MODULES_REGISTRY dans services/modules-registry.js
2. Mettre à jour routes/modules.js pour importer le registre
3. Créer migrations/069_module_waitlist.sql (SQL complet dans la spec §4)
4. Ajouter schéma surMesure dans validators/index.js (spec §5)
5. Créer routes/sur-mesure.js (spec §6 complète)
6. Ajouter 1 ligne dans server.js
7. Créer tests/integration/sur-mesure.test.js
8. Ajouter 069 dans scripts/fix-schema.js

Respecte les invariants R1-R7. Tu commites par étape.
```

**Fichiers à attacher** : `SPEC_SUR_MESURE_PAGE.md` + arborescence `routes/`, `services/`, `migrations/`, `validators/`, `tests/`

### Critères de fin

- ✅ `GET /api/sur-mesure/overview` retourne 4 modules avec statut et CTA
- ✅ Inscription waitlist fonctionne et est idempotente
- ✅ Stats admin derrière auth
- ✅ Tests d'intégration passent

---

## 🟢 C10 — Ménage docs *(post-launch)*

**Durée** : 1j · **P2** · **Bloqué par** : rien

### Contexte

56 fichiers dans `docs/` → cible 22 vivants + `_archive/`. Plan détaillé dans `MENAGE_DOCS_PLAN.md`. Exécution mécanique : git mv, git rm, mises à jour de chiffres.

### Prompt Sonnet

```
Tu vas exécuter le ménage des docs Komerce. Le plan complet est dans MENAGE_DOCS_PLAN.md.

1. Crée la branche chore/docs-cleanup-may-2026
2. Crée les dossiers _archive/ avec sous-dossiers (audits-2026/, plans-acheves/, tasklet-bootstrap/)
3. Pour chaque fichier "ARCHIVER" : git mv vers son dossier d'archive
4. Pour chaque fichier "SUPPRIMER" : git rm
5. Pour chaque fichier "METTRE À JOUR" : applique les corrections listées dans le plan
6. Génère ARCHITECTURE_LIVE.md via un script Node :
   - Compte routes, services, endpoints, tables, invariants
   - Date du jour
   - Exécutable via npm run docs:architecture
7. Vérifie qu'aucun lien cassé ne reste (grep récursif sur chemins anciens)
8. Mets à jour README.md et GOVERNANCE.md pour refléter la nouvelle structure
9. Commits par lot logique (1 commit = 1 catégorie d'action : archive / rm / update)

Règles :
- Tu ne supprimes RIEN qui n'est pas dans la liste explicite
- Tu vérifies les liens cassés avant de fermer

Démarre par étape 1.
```

**Fichiers à attacher** : `MENAGE_DOCS_PLAN.md` + arborescence `docs/`

### Critères de fin

- ✅ `docs/` contient ~22 fichiers vivants + `_archive/` + `adr/`
- ✅ Aucun lien cassé
- ✅ `npm run docs:architecture` génère `ARCHITECTURE_LIVE.md`

---

## 🟢 C11 — ROADMAP_KOMERCE.md à jour *(post-launch)*

**Durée** : 1h · **P2** · **Bloqué par** : rien

### Contexte

La roadmap actuelle présente les 6 critiques sécurité comme ouvertes (elles sont fermées), compte 19 routes au lieu de 67, 130 endpoints au lieu de 461.

### Prompt Sonnet

```
Tu vas mettre à jour docs/ROADMAP_KOMERCE.md pour refléter la réalité du code.
Source de vérité : AUDIT_KOMERCE_FINAL.md — état réel vérifié ligne par ligne.

Changements à appliquer :

1. Métriques en haut :
   - 20+ routes → 67 routes
   - ~135 endpoints → 461 endpoints
   - 31+ tables → 51 migrations (52 après C1 et C9)
   - Date de dernière vérification : 8 mai 2026

2. Section sécurité :
   - Les 6 critiques #71-76 passent en ✅ RÉSOLUES (cf. tableau dans AUDIT_KOMERCE_FINAL.md)
   - V-01 logistics passe en ✅ RÉSOLUE

3. Section Go-Live :
   - 6.6 JWT_SECRET → ✅ (boot crash si absent)
   - 6.9 Monitoring → 🟡 (Pino + monitoring.js OK, Sentry à activer = C4)
   - Ajoute 6.11 Migration de rattrapage couture (C1) ✅ si fait
   - Marque les autres avec leur statut réel

4. Section documentation :
   - Ajoute le lien vers SYNOPTIQUE_KOMERCE.md
   - Note ARCHITECTURE_LIVE.md autogénéré
   - Liste les docs archivées

5. Date de mise à jour : 8 mai 2026, version 10.6.2

Règles :
- Tu n'inventes RIEN. Tu ne corriges QUE ce qui est dans AUDIT_KOMERCE_FINAL.md.
- Tu gardes le ton et la structure existants.
```

**Fichiers à attacher** : `AUDIT_KOMERCE_FINAL.md` + `docs/ROADMAP_KOMERCE.md`

### Critères de fin

- ✅ Plus aucune mention "6 critiques ouvertes"
- ✅ Métriques alignées
- ✅ Date à jour

---

## 📅 Vue Sprint

### Sprint 1 — Hardening (3–5 jours) → Soft Launch

| Jour | Chantier | Effort |
|---|---|---|
| J1 matin | C1 Migration 068 couture | 2h30 |
| J1 apm | C3 Audit base prod (lecture seule) | 2–3h |
| J2 | C2 Backup + restore testé | 1j |
| J3 matin | C4 Sentry | 1h |
| J3 apm | C6 Secrets + admin pwd | 4h |
| J4 | C5 Guard cash_ref_code + tests | 2–3h |
| J5 | C7-bis Mobile bugs + améliorations | 1.5j |

### Sprint 2 — Soft Launch (2 semaines)

- Annonce ciblée 200–500 personnes
- Monitoring Sentry actif
- Aucune nouvelle feature, on observe et on fixe

### Sprint 3 — Post-Launch (1–3 semaines)

| Priorité | Chantier | Effort |
|---|---|---|
| P1 | C7 Desktop frontend | 2–3j |
| P1 | C8 Panier collectif cash | 1–2j |
| P2 | C9 Page Sur-mesure | 2j |
| P2 | C10 Ménage docs | 1j |
| P2 | C11 ROADMAP à jour | 1h |

### Sprint 4 — Public Launch

Quand 2 semaines de soft launch sans incident bloquant → campagne marketing, ouverture grand public.

---

## 📝 Discipline de pilotage

### Une conversation Sonnet par chantier

Vous fermez la fenêtre quand le chantier est coché. Pas de conversation Sonnet à rallonge.

### Sonnet exécute, Opus arbitre

Si Sonnet hésite sur une décision architecturale → vous revenez ici (Opus). Si Sonnet débogue ou code → laissez-le faire. Toutes les 30 min, demandez : *"résume ce que tu as fait jusqu'ici"*.

### Si un chantier dérape

| Symptôme | Cause probable | Solution |
|---|---|---|
| Sonnet pose 10 questions avant de coder | Prompt trop ouvert | Reprenez le prompt de cette roadmap |
| Sonnet réécrit hors scope | Pas assez de contraintes | Ajoutez "RÈGLES STRICTES : tu ne touches pas à X" |
| Sonnet hallucine un fichier | Pas attaché les bons fichiers | Re-vérifiez la liste "Fichiers à attacher" |
| Sonnet propose une refacto monstrueuse | Trop de zèle | "Fais STRICTEMENT ce qui est demandé, pas plus" |
| Chantier dépasse 50 % du temps estimé | Sous-estimation ou scope creep | Revenez à Opus pour rediagnostiquer |

### Quand revenir vers Opus

- Décision architecturale imprévue
- Chantier qui déborde (> 50 % au-delà de l'estimé)
- Après le soft launch, pour la prochaine vague
- Découverte d'un risque absent de cet audit

---

## ✅ Suivi d'avancement

| # | Chantier | Date début | Date fin | Notes |
|---|---|---|---|---|
| C1 | Migration 068 couture | | | commit hash : |
| C2 | Backup + restore | | | storage choisi : |
| C3 | Reset factory prod | | | records purgés : |
| C4 | Sentry | | | projet Sentry : |
| C5 | Guard cash_ref_code | | | |
| C6 | Secrets + admin pwd | | | |
| C7-bis | Mobile boutique | | | branche : feature/mobile-audit-may-2026 |
| ☁️ | **SOFT LAUNCH** | | | nb users invités : |
| C7 | Desktop frontend | | | |
| C8 | Panier collectif cash | | | |
| C9 | Page Sur-mesure | | | migration 069 |
| C10 | Ménage docs | | | |
| C11 | ROADMAP à jour | | | |
| 🚀 | **PUBLIC LAUNCH** | | | |

---

## 🗂️ Index des specs de référence

| Document | Utilité | Chantier lié |
|---|---|---|
| `AUDIT_KOMERCE_FINAL.md` | Source de vérité — état réel du code au 8 mai 2026 | Tous |
| `SYNOPTIQUE_KOMERCE.md` | Vue d'ensemble — 4 unités éco, 5 expériences, machine à états | Référence |
| `COUTURE_SIMPLIFICATION.md` | Spec complète migration 068 (SQL + diffs) | C1 |
| `SPEC_SUR_MESURE_PAGE.md` | Spec backend page sur-mesure (migration 069, route, validator, tests) | C9 |
| `MOBILE_BOUTIQUE_AUDIT.md` | Audit complet mobile (bugs + améliorations, diffs exacts) | C7-bis |
| `MOBILE_BOUTIQUE_FIXES.md` | Version concise bugs-only | C7-bis (référence secondaire) |
| `ROADMAP_PILOTE_KOMERCE.md` | Roadmap initiale (prompts Sonnet C7, C8, C10, C11 complets) | C7, C8, C10, C11 |

---

*Roadmap consolidée le 8 mai 2026 — code v10.6.1 — 67 routes · 461 endpoints · 52 migrations · 2 811 lignes de tests*
