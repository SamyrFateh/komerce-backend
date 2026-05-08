# 🎯 KOMERCE — Roadmap Pilote (autonomie + délégation Sonnet)

> **Pour qui** : vous, propriétaire, en mode pilote.
> **Comment l'utiliser** : ce doc reste ouvert. Pour chaque chantier, vous ouvrez une fenêtre Sonnet 4.6 séparée, vous copiez-collez le prompt, vous suivez. Quand le chantier est fini, vous cochez ici et passez au suivant.
> **Principe** : un chantier = une conversation Sonnet. Vous ne mélangez jamais.
> **Date de génération** : 8 mai 2026 — basé sur l'audit code-réel.

---

## 📋 Sommaire des chantiers

| # | Chantier | Priorité | Effort | Statut |
|---|---|:-:|:-:|:-:|
| **1** | Migration 068 — Simplification couture | 🔴 P0 | 2h30 | ⬜ |
| **2** | Backup pg_dump quotidien + procédure restore testée | 🔴 P0 | 1j | ⬜ |
| **3** | Reset factory prod + audit données test | 🔴 P0 | 0.5j | ⬜ |
| **4** | Sentry activation | 🟠 P1 | 1h | ⬜ |
| **5** | Cash relais — guard cash_ref_code | 🟠 P1 | 2h | ⬜ |
| **6** | Mot de passe admin + tournage secrets | 🟠 P1 | 0.5j | ⬜ |
| **7** | Refonte Desktop Frontend | 🟡 P1 | 2-3j | ⬜ |
| **8** | Panier collectif — pivot cash uniquement | 🟡 P1 | 1-2j | ⬜ |
| **9** | Page Sur-mesure & Modules (backend + frontend) | 🟢 P2 | 1-2j | ⬜ |
| **10** | Ménage docs (56 → 22 fichiers) | 🟢 P2 | 1j | ⬜ |
| **11** | Mise à jour ROADMAP_KOMERCE.md (réalité code) | 🟢 P2 | 1h | ⬜ |

**Ordre suggéré pour aller en prod le plus vite** : 1 → 3 → 2 → 6 → 4 → 5 → soft launch → 7/8/9/10/11 en parallèle.

**Mais c'est flexible** — si vous avez 2h libres et envie de faire le chantier 4 avant le 3, allez-y. Aucun ne dépend strictement du précédent (sauf 2 qui doit précéder 3 dans la même journée pour la sécurité).

---

## 🛠️ Comment utiliser un prompt Sonnet

Pour chaque chantier ci-dessous, vous trouvez :

1. **Le contexte** : ce que vous (Opus) savez et que Sonnet ne saura pas
2. **Le prompt à coller** : un bloc auto-suffisant
3. **Les fichiers à attacher** : ce que vous joignez à la conversation Sonnet
4. **Le critère de fin** : comment savoir que c'est fini
5. **Le retour ici** : ce que vous reportez dans cette roadmap

**Discipline** : Sonnet exécute. Si Sonnet vous propose des choix architecturaux, vous le ramenez à Opus (cette conversation). Si Sonnet débogue ou code, laissez-le faire.

---

# 🔴 CHANTIER 1 — Migration 068 (Simplification couture)

**Durée** : 2h30 · **Bloque** : non · **Bloqué par** : rien · **P0**

## Contexte

Le code actuel modélise la couture comme un atelier en ligne (catalogue de tissus + modèles à composer + accessoires + mètres). Votre métier réel : Komerce sélectionne des modèles avec un couturier, les met en catalogue sous une marque maison, le client choisit un modèle et donne ses mensurations. Plus simple, plus crédible.

La prod est vide → on peut réécrire proprement, pas migrer des données.

Le doc complet est dans `COUTURE_SIMPLIFICATION.md` (livré par Opus). Sonnet va l'appliquer.

## Prompt à coller dans Sonnet

```
Tu es un dev sénior. Tu vas appliquer une simplification du modèle couture sur le backend Komerce. 
Le doc COUTURE_SIMPLIFICATION.md décrit exactement quoi faire — diff par diff. 
La prod est vide, on peut faire la migration directement.

Ta mission, dans cet ordre exact :

1. Crée le fichier `migrations/068_couture_simplification.sql` avec le SQL exact du doc (section 1 fin).
2. Mets à jour `db/schema.sql` pour refléter le nouvel état (colonnes ajoutées sur products et order_items, anciennes colonnes module_* et confection_* supprimées, tables fabrics et garment_models supprimées).
3. Applique le diff sur `routes/orders/create.js` (section 2 du doc).
4. Applique le diff sur `routes/modules.js` (section 3) : supprime les endpoints /fabrics, /models, et simplifie l'endpoint /price.
5. Applique le diff sur `routes/orders/detail.js` (section 4).
6. Mets à jour `validators/index.js` pour orders.create — remplace les anciens champs module_* par module_size, module_measurements (JSONB), module_instructions au niveau item.
7. Adapte `tests/integration/api.test.js` pour les nouveaux champs.
8. Ajoute la migration 068 dans `scripts/fix-schema.js` pour exécution automatique au boot.

Règles strictes :
- Tu commits après CHAQUE étape (1 commit par étape, message en français court)
- Tu ne touches à AUCUN autre fichier
- Tu ne modifies AUCUN invariant : R1 (state machine SSOT) reste intacte
- Si tu hésites sur une décision architecturale → tu t'arrêtes et tu me demandes
- Si un test échoue après tes changements → tu fixes le test pour qu'il reflète le nouveau modèle, mais tu n'inventes pas de logique métier non décrite dans le doc

Démarre par l'étape 1.
```

## Fichiers à attacher

- `COUTURE_SIMPLIFICATION.md` (le doc complet livré par Opus)
- L'arborescence `routes/`, `services/`, `db/`, `migrations/`, `validators/`, `scripts/`, `tests/`

## Critère de fin

- ✅ La migration tourne sans erreur sur ta base locale
- ✅ Les tests passent (`npm test`)
- ✅ Tu peux créer une commande couture avec module_measurements et la voir dans `routes/orders/detail.js`
- ✅ 8 commits propres dans la branche `chore/068-couture-simplification`

## Retour ici

Cocher chantier 1 ✅ · Note : commit hash de la PR pour traçabilité

---

# 🔴 CHANTIER 2 — Backup pg_dump quotidien + restore testé

**Durée** : 1j · **Bloque** : 3 · **Bloqué par** : rien · **P0 strict**

## Contexte

Supabase fait des backups automatiques (point-in-time recovery, 7-30j selon plan), mais aucune procédure de restauration n'a jamais été testée par vous. Single point of failure. Avant la prod, il faut : (a) un pg_dump quotidien indépendant, (b) une procédure de restore documentée et **testée** sur staging.

## Prompt à coller dans Sonnet

```
Tu es un dev DevOps. Tu vas mettre en place un backup PostgreSQL quotidien pour Komerce, indépendant de Supabase, et tester la procédure de restauration.

Architecture cible :
- Source : DATABASE_URL (Supabase PostgreSQL)
- Cible : un stockage externe (S3, Cloudflare R2, ou GitHub Releases privées — au choix de l'utilisateur)
- Fréquence : quotidien à 03:00 UTC
- Rétention : 30 jours
- Cron : GitHub Actions (gratuit, simple)

Tâches :

1. Crée `scripts/backup-prod.sh` qui :
   - Lit DATABASE_URL depuis l'env
   - Lance pg_dump --format=custom --no-owner --no-acl
   - Compresse en .gz
   - Upload sur le storage cible (param --storage)
   - Affiche un résumé : taille, durée, chemin distant
   - Logue dans /var/log/komerce-backup.log si présent

2. Crée `.github/workflows/backup-prod.yml` qui :
   - S'exécute à 03:00 UTC tous les jours
   - Utilise les secrets DATABASE_URL et STORAGE_CREDENTIALS du repo
   - Notifie sur échec via webhook (Slack/Discord/email — au choix utilisateur)
   - Conserve les 30 derniers .gz sur le storage, supprime les plus anciens

3. Crée `scripts/restore-from-backup.sh` qui :
   - Liste les backups disponibles
   - Demande confirmation interactive avant de restaurer
   - Restaure dans une base TEMPORAIRE pour test (pas la prod)
   - Affiche un rapport : nb tables, nb commandes, nb users, etc.

4. Crée `docs/RESTORE_PROCEDURE.md` qui documente pas-à-pas :
   - Comment exécuter un restore en cas d'incident
   - Comment vérifier l'intégrité après restore
   - Quels tests fonctionnels lancer post-restore
   - Qui contacter (placeholders pour le user à remplir)

5. **TEST RÉEL** : tu lances le backup, tu fais le restore sur une base de test, tu valides que tout est intact. Tu rapportes le rapport.

Règles :
- Demande à l'utilisateur le storage cible (S3 / R2 / GitHub Releases) AVANT de coder
- Tu utilises pg_dump 16+ (compatible Supabase)
- Aucun secret en dur dans le code, tout via env
- Le script restore EST TESTÉ avant de fermer le ticket
- Tu commits étape par étape

Démarre par demander le choix du storage.
```

## Fichiers à attacher

- L'arborescence `scripts/` et `.github/`
- Le `package.json`

## Critère de fin

- ✅ `scripts/backup-prod.sh` produit un .gz lisible
- ✅ `scripts/restore-from-backup.sh` restaure ce .gz dans une base de test
- ✅ Les COUNT par table sont identiques avant/après
- ✅ Le workflow GitHub Actions est vert sur 1 run manuel
- ✅ `docs/RESTORE_PROCEDURE.md` existe

## Retour ici

Cocher chantier 2 ✅ · Note : le storage choisi (S3 / R2 / autre) pour cohérence future

---

# 🔴 CHANTIER 3 — Reset factory prod + audit données test

**Durée** : 0.5j · **Bloque** : Go-Live · **Bloqué par** : 2 (backup d'abord !) · **P0**

## Contexte

La base contient probablement des données de tests E2E (commandes K85AJL4 et autres), des comptes admin/dev, des produits seed AliExpress (466 produits dans seed-products-v2.json). Avant le launch, il faut faire le tri.

⚠️ **Ne lance JAMAIS ce chantier sans avoir le backup du chantier 2 vérifié et testé.**

## Prompt à coller dans Sonnet

```
Tu es un dev senior. Tu vas auditer la base de données de production Komerce et préparer un reset factory propre. 
ATTENTION : un backup vérifié existe déjà. Tu peux travailler en confiance.

Tâches :

1. Connecte-toi à la prod (DATABASE_URL) en lecture seule d'abord. Génère un rapport `audit-prod.md` :
   - Nombre d'enregistrements par table (orders, users, products, baskets, etc.)
   - Liste des users avec role='admin' ou email contenant 'test', '@komerce.km' (les comptes systèmes)
   - Liste des commandes avec reference contenant 'TEST' ou 'K85'
   - Liste des produits avec is_active=false
   - Toute donnée qui paraît être un seed ou un test

2. Présente le rapport à l'utilisateur. ATTENDS sa décision sur QUOI purger.

3. Une fois la décision prise, crée `scripts/reset-factory-prod.sql` :
   - Une transaction qui :
     - Supprime les enregistrements identifiés (CASCADE bien géré)
     - Reset les séquences (référence commandes, etc.)
     - Garde au minimum : 1 admin (que l'utilisateur précisera), les relais, les transporteurs, la config
   - Avec un BEGIN/COMMIT et une option de DRY-RUN

4. Tourne le DRY-RUN, présente le diff. Si OK utilisateur, exécute pour de vrai.

5. Génère un rapport post-reset : `audit-prod-post.md` avec les nouveaux comptes.

Règles :
- Tu te connectes en lecture seule pour l'étape 1
- Tu ne lances RIEN qui modifie la base sans confirmation explicite "oui je confirme"
- Tu utilises des transactions avec ROLLBACK possible
- Tu vérifies que le backup du chantier 2 est < 1h avant tout DELETE

Démarre par l'audit lecture seule.
```

## Fichiers à attacher

- Le rapport audit du chantier 2
- L'arborescence `db/` et `scripts/`

## Critère de fin

- ✅ `audit-prod.md` rendu et validé par vous
- ✅ `scripts/reset-factory-prod.sql` exécuté avec succès
- ✅ `audit-prod-post.md` confirme l'état attendu
- ✅ La boutique tourne toujours (smoke test : créer un user, voir le catalogue)

## Retour ici

Cocher chantier 3 ✅ · Note : combien de records purgés au total

---

# 🟠 CHANTIER 4 — Sentry activation

**Durée** : 1h · **Bloque** : non · **Bloqué par** : rien · **P1**

## Contexte

Le code est déjà prêt à recevoir Sentry (`services/monitoring.js` ligne 53 fait `require('@sentry/node')` si `SENTRY_DSN` est en env). Il manque juste : l'install npm, la config Sentry, le test.

## Prompt à coller dans Sonnet

```
Tu vas activer Sentry sur le backend Komerce. Le code est déjà prêt — il faut juste l'installer.

Tâches :

1. `npm install @sentry/node@latest --save` (vérifie compat Node 20)
2. Vérifie que `services/monitoring.js` détecte bien la lib (lis le fichier, repère le require dynamique)
3. Demande à l'utilisateur de fournir un SENTRY_DSN (création gratuite sur sentry.io si pas déjà fait)
4. Ajoute SENTRY_DSN dans `.env.example` avec un commentaire
5. Ajoute SENTRY_DSN dans la liste REQUIRED_ENV de server.js — non, attends : laisse-le optionnel pour ne pas casser dev
6. Teste : démarre le serveur localement avec un faux SENTRY_DSN, vérifie qu'il ne crash pas
7. Teste : déclenche une erreur intentionnelle via une route admin de test, vérifie qu'elle apparaît sur Sentry
8. Documente dans README.md la config Sentry (1 paragraphe)

Règles :
- Sentry doit rester OPTIONNEL — si SENTRY_DSN absent, le serveur démarre normalement
- Pas de PII (Personally Identifiable Info) envoyée à Sentry par défaut
- Le `release` Sentry = git SHA court automatique

Démarre par étape 1.
```

## Fichiers à attacher

- `services/monitoring.js`
- `package.json`

## Critère de fin

- ✅ Une erreur de test apparaît dans le dashboard Sentry de l'utilisateur
- ✅ Le serveur démarre sans SENTRY_DSN (compat dev)

## Retour ici

Cocher chantier 4 ✅

---

# 🟠 CHANTIER 5 — Cash relais : guard cash_ref_code

**Durée** : 2h · **Bloque** : non · **Bloqué par** : rien · **P1**

## Contexte

Aujourd'hui, quand un agent relais valide un paiement cash (transition vers `ordered`), il saisit le code 6 chiffres mais le backend ne re-vérifie pas strictement que ce code correspond bien à la commande qu'il valide. Faille documentée dans ZONE_IMPACT.md chaîne 4.

## Prompt à coller dans Sonnet

```
Tu vas ajouter un guard backend strict pour la validation cash_ref_code dans Komerce.

Contexte :
- Quand un client paye en cash chez un relais, il reçoit un code 6 chiffres (cash_ref_code).
- L'agent du relais saisit ce code dans son interface pour confirmer le paiement.
- Aujourd'hui le backend ne vérifie pas assez strictement que le code saisi == cash_ref_code de la commande.
- Doc de référence : ZONE_IMPACT.md chaîne 4.

Tâches :

1. Identifie l'endpoint qui valide le cash. Probablement dans routes/orders/order-api-v2.js ou routes/orders/admin-actions.js — cherche les transitions vers 'ordered' avec source='cash_relais'.

2. Ajoute un guard strict :
   - Le payload doit contenir `cash_ref_code`
   - On va lire le `cash_ref_code` stocké en base sur l'order
   - Comparaison stricte (===), pas de tolérance majuscule/espace
   - Si différent → 400 avec message explicite ("Code invalide pour cette commande")
   - Trace dans order_status_history la tentative ratée (pour audit)

3. Ajoute un compteur d'échecs : 3 échecs consécutifs → blocage 5 min (utilise rate-limit.js comme pattern, ou une table simple `cash_validation_attempts`)

4. Test unitaire dans tests/unit/ qui valide :
   - bon code → 200
   - mauvais code → 400
   - 3 mauvais codes → 429

5. Mise à jour ZONE_IMPACT.md chaîne 4 : marque le TODO comme résolu, retire l'item du backlog.

Règles :
- Tu ne touches pas à la state machine
- Tu utilises uniquement des UPDATE/SELECT, pas de transition directe
- Tu commits étape par étape

Démarre par l'identification de l'endpoint exact.
```

## Fichiers à attacher

- `docs/ZONE_IMPACT.md`
- `routes/orders/`
- `services/order-status-machine.js`

## Critère de fin

- ✅ Test passant : mauvais code → 400
- ✅ Test passant : 3 essais → 429
- ✅ ZONE_IMPACT.md à jour

## Retour ici

Cocher chantier 5 ✅

---

# 🟠 CHANTIER 6 — Mot de passe admin + tournage secrets

**Durée** : 0.5j · **Bloque** : Go-Live · **Bloqué par** : 2 · **P1**

## Contexte

Avant le launch, vérifier toutes les env vars critiques et tourner les secrets qui ont pu être exposés (commits passés, screenshots, logs partagés…).

## Prompt à coller dans Sonnet

```
Tu vas auditer et durcir tous les secrets de la prod Komerce.

Tâches :

1. Liste exhaustive des env vars utilisées dans le code :
   - Grep `process.env.` dans tout le projet
   - Catégorise : critique (secrets), config (URLs), feature flag
   - Génère `audit-secrets.md`

2. Pour chaque secret critique, vérifie son entropie :
   - JWT_SECRET → doit faire 64+ caractères aléatoires
   - ADMIN_PASSWORD → doit avoir été changé depuis le seed
   - STRIPE_SECRET_KEY → doit être en mode 'sk_live_' (pas sk_test_)
   - DATABASE_URL → doit pointer prod, pas staging
   - WID_OTP, WID_MAGIC_LINK, RESEND_API_KEY, AT_API_KEY...

3. Pour chaque secret à tourner, génère un nouveau (cryptographiquement aléatoire) et propose le plan de rotation :
   - Mettre à jour Railway env vars
   - Redéployer (zero-downtime ou maintenance window)
   - Vérifier post-deploy

4. Mot de passe admin :
   - Génère un mot de passe fort (24 chars, mixte)
   - Mets à jour via fix-schema.js mécanisme (ADMIN_PASSWORD env)
   - Force la rotation à la prochaine connexion (flag must_change_password)

5. Vérifie .env.example : tous les secrets sont listés ? Aucune valeur réelle dedans ?

6. Vérifie .gitignore : .env est bien ignoré ? Aucun .env committé dans l'historique ? (git log --all --full-history -- .env)

Règles :
- Tu ne stockes JAMAIS un secret en clair dans un fichier qui sera commit
- Tu utilises un canal sécurisé pour transmettre les nouveaux secrets à l'utilisateur (clipboard temporaire, gestionnaire de mot de passe)
- Tu vérifies que la rotation a réussi avant de marquer terminé

Démarre par étape 1, le grep.
```

## Fichiers à attacher

- `.env.example`
- `server.js` (pour REQUIRED_ENV)
- `scripts/fix-schema.js`

## Critère de fin

- ✅ `audit-secrets.md` complet
- ✅ Tous les secrets critiques tournés en prod
- ✅ Login admin avec nouveau mot de passe OK

## Retour ici

Cocher chantier 6 ✅

---

# 🟡 CHANTIER 7 — Refonte Desktop Frontend

**Durée** : 2-3j · **Bloque** : non · **Bloqué par** : rien · **P1**

## Contexte

Le frontend boutique (`public/boutique/`) est à 80 % fonctionnel sur mobile, mais incomplet sur desktop. L'architecture est propre :

- 29 fichiers JS modulaires (pattern `b-*.js`)
- Bus d'événements (`b-bus.js`)
- State centralisé (`b-store.js`)
- Tokens CSS (`tokens.css`)
- Un effort `b-desktop-upgrade.js` (685 lignes) déjà commencé pour l'expérience desktop "Temu-style"

Points de douleur concrets que vous avez identifiés :
- L'expérience desktop n'est pas pleinement aboutie
- Pas de vraie navigation mega-menu
- Pas de layout deux colonnes (catégories + grille)
- Pas de footer riche
- Le mini-cart desktop pourrait être un drawer latéral plutôt qu'un overlay mobile

## Prompt à coller dans Sonnet

```
Tu es un dev frontend senior. Tu vas finaliser la refonte desktop de la boutique Komerce.

CONTEXTE TECHNIQUE :
- Frontend : ES modules natifs (pas de framework), pas de bundler
- 29 fichiers JS dans public/boutique/js/, pattern b-*.js
- 13 fichiers CSS dans public/boutique/css/, dont tokens.css (palette canonique)
- Bus d'événements : public/boutique/js/b-bus.js
- State : public/boutique/js/b-store.js
- Le desktop est géré dans b-desktop-upgrade.js (déjà 685 lignes commencées)
- Le breakpoint desktop est ≥ 900px (vérifie dans b-scroll-owner.js -> isDesktop())

CONTRAINTES STRICTES :
- Tu n'introduis AUCUN framework (pas de React, Vue, Svelte)
- Tu n'introduis AUCUN bundler (pas de Vite, Webpack)
- Tu utilises UNIQUEMENT les tokens de tokens.css pour les couleurs (--ocean, --coral, --sand, --text, etc.)
- Tu respectes le pattern b-*.js : 1 fichier = 1 responsabilité
- Tu passes par le bus pour communiquer entre modules
- Tu ne casses RIEN sur mobile (< 900px) — chaque ajout doit être no-op sur mobile

LIVRABLES ATTENDUS :

1. **Layout desktop deux colonnes**
   - Colonne gauche : sidebar catégories (sticky, max-width 240px)
   - Colonne droite : grille produits (responsive, 3-4 colonnes selon largeur)
   - Le hero devient un bandeau plus discret, pas pleine largeur

2. **Mega-menu navigation**
   - Au hover sur une catégorie de la sidebar : panneau qui slide à droite avec sous-catégories + produits suggérés
   - 200ms de delay pour éviter les déclenchements accidentels
   - Fermeture sur clic extérieur ou Escape

3. **Drawer panier desktop**
   - À droite, slide-in animation
   - Permanent visible si le viewport est ≥ 1200px (au choix utilisateur, à toggler)
   - Sinon ouvrable via le pill cart en haut à droite

4. **Footer riche**
   - 4 colonnes : À propos, Catégories, Aide, Suivez-nous
   - Newsletter signup (juste UI, pas l'intégration backend pour l'instant)
   - Mentions légales, CGV, etc. (placeholders)

5. **Modale produit améliorée**
   - Image principale + thumbnails (3-4)
   - Zoom au hover (lens, pas modale par-dessus)
   - Specs accordéon en bas
   - Trust badges (livraison relais, paiement cash, stock garanti)
   - Sous-total dynamique selon quantité
   - Bouton "Ajouter au panier" sticky en bas

DEMANDES À ME FAIRE AVANT DE CODER :
- Le viewport cible : 1280px / 1440px / 1920px
- Préférence pour le drawer panier permanent ≥ 1200px : oui ou non
- La densité de la grille : 3 colonnes max ou 4 colonnes max
- Tu peux poser d'autres questions UX avant de commencer

PROCESSUS :
- Tu codes en branches features/desktop-XX, 1 PR par livrable
- Tu commits petit, souvent (toutes les 30 min)
- Tu testes sur Chrome, Firefox, Safari (mac)
- Tu vérifies que le mobile (375px) reste impeccable après chaque commit

Démarre par poser tes questions UX. Ne code rien tant que tu n'as pas mes réponses.
```

## Fichiers à attacher

- L'arborescence `public/boutique/`
- `public/boutique/js/b-bus.js`
- `public/boutique/js/b-store.js`
- `public/boutique/js/b-desktop-upgrade.js` (déjà 685 lignes, cohabite)
- `public/boutique/css/tokens.css`
- `public/boutique/css/desktop-upgrade.css`
- Une capture d'écran de l'état actuel desktop si possible

## Critère de fin

- ✅ Layout deux colonnes opérationnel sur 1280px/1440px/1920px
- ✅ Mega-menu fluide
- ✅ Drawer panier desktop
- ✅ Footer riche
- ✅ Modale produit type Temu/MyTheresa
- ✅ Mobile 375px non régressé (test côte à côte)

## Retour ici

Cocher chantier 7 ✅ · Note : si vous avez ajouté de nouveaux fichiers JS/CSS, mentionnez-les pour le ménage docs

---

# 🟡 CHANTIER 8 — Panier collectif : pivot cash uniquement

**Durée** : 1-2j · **Bloque** : non · **Bloqué par** : 1 (pour cohérence) · **P1**

## Contexte

Le panier collectif actuel utilise Stripe en mode `manual capture` (préautorisation, débit collectif). C'est sophistiqué mais ne colle pas à votre métier réel : la diaspora se cotise en cash, l'organisateur récolte chez la famille puis paye en une fois Komerce, ou chaque contributeur paye chez un agent.

**Décision prise** : on simplifie à un modèle 100 % cash. **Trois sous-décisions** que VOUS devez trancher avant de lancer ce chantier (ne lancez pas ce chantier tant que vous n'avez pas répondu) :

| Décision | Options | Note |
|---|---|---|
| Qui collecte ? | (A) organisateur seul / (B) chaque contributeur paye agent / (C) mixte au choix de l'orga | Vote Opus : (A) le plus simple |
| Quand le panier est complet ? | (α) sur engagement verbal à 100 % / (β) sur cash physiquement reçu | Vote Opus : (β) le plus sûr |
| Désistement ? | (i) délai 7j strict / (ii) seuil 80 % avec orga complète / (iii) laisser à l'orga | Vote Opus : (i) clair |

**Une fois vos 3 votes faits, vous remplissez le prompt ci-dessous et le passez à Sonnet.**

## Prompt à coller dans Sonnet (à compléter)

```
Tu es un dev sénior. Tu vas pivoter le panier collectif Komerce d'un modèle Stripe vers un modèle 100% cash.

CONTEXTE :
- Backend : services/collective-workspace-engine.js (965 lignes), services/collective-payment-orchestrator.js (942 lignes)
- Frontend : public/boutique/js/event-*.js (4 fichiers)
- HTML maquette refonte : voir le fichier event-collective.html attaché (refonte UX déjà bien avancée par le user)
- Maquette ne contient PAS Stripe — tout cash.

DÉCISIONS MÉTIER (du user) :
- Collecte : [REMPLIR : A / B / C — voir tableau roadmap]
- Validation panier : [REMPLIR : α / β]
- Désistement : [REMPLIR : i / ii / iii]

TÂCHES :

1. Audit du code Stripe dans collective-* :
   - Identifie les appels Stripe (paymentIntent, capture, refund...)
   - Liste les endpoints API qui en dépendent
   - Génère audit-collective-stripe.md

2. Adaptation backend :
   - Supprime les appels Stripe du engine et de l'orchestrator
   - Remplace par un flux cash : engagement → confirmation cash agent (ou organisateur) → quand 100% → la commande passe en mode cash_relais classique
   - Ajoute une table contribution_payments (si pas déjà là) : id, contribution_id, amount, paid_at, paid_by_agent_id, payment_method='cash'
   - Adapte les transitions du collective-workspace-engine selon les décisions A/B/C, α/β, i/ii/iii
   - Webhooks Stripe collective → supprime ou désactive

3. Adaptation frontend :
   - Remplace event-pay.js (vue carte Stripe) par event-pay-cash.js (vue code de versement / engagement)
   - Aligne le visuel sur la maquette HTML attachée (palette violet, hero, cards)
   - Le bouton "Confirmer" génère un cash_ref_code (6 chiffres) que le contributeur présente à un agent
   - Si décision (A) : pas de cash_ref_code par contributeur, juste l'engagement, l'orga collecte hors-Komerce et paye en une fois
   - Mets à jour event-create.js, event-manage.js, event-public.js pour refléter le flux cash

4. Notifications :
   - WhatsApp à chaque engagement
   - WhatsApp quand le panier est complet (à l'organisateur)
   - WhatsApp quand la commande est lancée (à tous les contributeurs)
   - WhatsApp à J+3, J+5, J+7 si le panier n'est pas complet (rappel)

5. Tests :
   - Update tests E2E robustesse-v6.sh pour le scénario cash
   - Test unitaire pour les transitions du collective-engine

6. Doc :
   - Update docs/collective-workspaces-v1.md pour refléter le pivot cash
   - Note dans le changelog du repo

RÈGLES :
- La maquette HTML attachée est ta référence visuelle, pas négociable sur la palette
- Tu ne casses RIEN du panier classique (cart simple ou panier partagé M10) — uniquement le collective-workspace
- Tu commits étape par étape
- Tu poses des questions si une transition d'état n'est pas claire selon les décisions

Démarre par étape 1, l'audit Stripe.
```

## Fichiers à attacher

- Le HTML de la maquette (vous me l'avez montré dans Opus)
- `services/collective-workspace-engine.js`
- `services/collective-payment-orchestrator.js`
- `public/boutique/js/event-create.js`
- `public/boutique/js/event-manage.js`
- `public/boutique/js/event-public.js`
- `public/boutique/js/event-pay.js`
- `public/boutique/css/event.css`
- `docs/collective-workspaces-v1.md`

## Critère de fin

- ✅ Plus d'appel Stripe dans collective-*
- ✅ Frontend aligné maquette (visuel violet identité collectif)
- ✅ Tests E2E passent
- ✅ Doc à jour

## Retour ici

Cocher chantier 8 ✅

---

# 🟢 CHANTIER 9 — Page Sur-mesure & Modules

**Durée** : 1-2j · **Bloque** : non · **Bloqué par** : 1 · **P2**

## Contexte

Spec backend déjà rédigée par Opus dans `SPEC_SUR_MESURE_PAGE.md`. Endpoint `/api/sur-mesure/overview`, table `module_waitlist`, etc. Le frontend est à faire en plus.

## Prompt à coller dans Sonnet

```
Tu vas implémenter la page « Sur-mesure & Modules » pour Komerce. La spec backend complète est dans SPEC_SUR_MESURE_PAGE.md.

ATTENTION : la spec a été rédigée AVANT le pivot couture du chantier 1. Adapte-la pour refléter le nouveau modèle :
- Le module couture utilise désormais module_size, module_measurements, module_instructions (pas plus fabric_id)
- La carte couture sur la page mentionne "modèles confectionnés sous notre marque maison" (pas "tissu au choix")
- Le sur-mesure léger (catégorie 'Sur-mesure' du catalogue) reste comme prévu

TÂCHES :

1. Backend (suit la spec, mais adaptée) :
   - Migration 066_module_waitlist.sql
   - routes/sur-mesure.js avec /overview, /waitlist, /waitlist/stats
   - validators surMesure
   - Branchement dans server.js
   - services/modules-registry.js extrait
   - Tests intégration

2. Frontend :
   - Nouvelle page b-sur-mesure.js (sur le modèle de b-favs.js ou b-tracking.js)
   - Vue "page de garde" avec 5 cartes (4 modules + sur-mesure léger)
   - Statuts visibles (available / coming_soon / on_quote)
   - Formulaire waitlist en modale (pour coming_soon)
   - Cross-suggestions catalogue dans chaque carte
   - Lien dans la sidebar/nav vers cette page
   - Style aligné tokens.css (palette Komerce)

3. Tests :
   - Tests intégration backend
   - Test smoke frontend (manual)

Règles :
- Tu lis bien SPEC_SUR_MESURE_PAGE.md avant de commencer
- Tu adaptes les références au module couture pour le nouveau modèle (chantier 1)
- Tu commits étape par étape

Démarre par confirmer que tu as bien lu la spec et noté l'adaptation couture.
```

## Fichiers à attacher

- `SPEC_SUR_MESURE_PAGE.md` (livré par Opus)
- `COUTURE_SIMPLIFICATION.md` (livré par Opus)
- L'arborescence `public/boutique/`, `routes/`, `services/`

## Critère de fin

- ✅ La page `/sur-mesure-et-modules` est accessible et fonctionnelle
- ✅ Inscription waitlist marche
- ✅ Stats admin marchent
- ✅ Module couture aligné nouveau modèle

## Retour ici

Cocher chantier 9 ✅

---

# 🟢 CHANTIER 10 — Ménage docs

**Durée** : 1j · **Bloque** : non · **Bloqué par** : rien · **P2**

## Contexte

Plan complet déjà écrit par Opus dans `MENAGE_DOCS_PLAN.md`. 56 docs → 22 vivants. Exécution mécanique pure : git mv, git rm, mises à jour de chiffres.

## Prompt à coller dans Sonnet

```
Tu vas exécuter le ménage des docs Komerce. Le plan complet est dans MENAGE_DOCS_PLAN.md.

C'est de l'exécution mécanique :

1. Crée la branche `chore/docs-cleanup-may-2026`
2. Crée les dossiers _archive/ avec ses sous-dossiers (audits-2026/, plans-acheves/, tasklet-bootstrap/)
3. Pour chaque fichier listé en "ARCHIVER" : git mv vers son dossier d'archive
4. Pour chaque fichier listé en "SUPPRIMER" : git rm
5. Pour chaque fichier listé en "METTRE À JOUR" : applique les corrections de chiffres et de version listées dans le plan
6. Crée les 3 fichiers neufs si pas déjà fait : SYNOPTIQUE_KOMERCE.md (déjà livré par Opus), ARCHITECTURE_LIVE.md (à autogénérer), MODULE_COLUMNS_FIX.md (à supprimer en fait, la migration 068 a réglé le sujet)
7. Vérifie qu'aucun lien cassé ne reste : grep récursif sur les chemins anciens
8. Mets à jour README.md et GOVERNANCE.md pour refléter la nouvelle structure
9. Commit en plusieurs étapes propres
10. PR avec checklist

Pour ARCHITECTURE_LIVE.md : c'est un doc autogénéré qui dit la vérité du code. Génère-le avec un script Node simple qui :
- Compte les routes (ls routes/)
- Compte les services (ls services/)
- Compte les endpoints (grep router.method)
- Compte les tables (grep CREATE TABLE)
- Liste les invariants R1-R7 depuis ZONE_IMPACT.md
- Date du jour
- À regénérer au besoin via npm run docs:architecture

Règles :
- Tu commits par lot logique (1 commit par catégorie d'action : archive, rm, update)
- Tu ne supprimes RIEN qui n'est pas dans la liste explicite
- Tu vérifies les liens cassés avant de fermer

Démarre par étape 1.
```

## Fichiers à attacher

- `MENAGE_DOCS_PLAN.md` (livré par Opus)
- L'arborescence `docs/`

## Critère de fin

- ✅ docs/ contient ~22 fichiers vivants + _archive/ + adr/
- ✅ Aucun lien cassé
- ✅ Script `npm run docs:architecture` génère ARCHITECTURE_LIVE.md

## Retour ici

Cocher chantier 10 ✅

---

# 🟢 CHANTIER 11 — ROADMAP_KOMERCE.md à jour

**Durée** : 1h · **Bloque** : non · **Bloqué par** : rien · **P2**

## Contexte

La roadmap actuelle dit que les 6 critiques sécurité sont ouvertes alors qu'elles sont fermées. Elle compte 19 routes au lieu de 67, 130 endpoints au lieu de 461. À aligner sur la réalité du code.

## Prompt à coller dans Sonnet

```
Tu vas mettre à jour docs/ROADMAP_KOMERCE.md pour refléter la réalité du code.

Source de vérité : AUDIT_KOMERCE_FINAL.md (livré par Opus) — il contient l'état réel vérifié ligne par ligne.

Changements à appliquer :

1. Métriques en haut du doc :
   - 20+ routes → 67 routes
   - ~135 endpoints → 461 endpoints
   - 31+ tables → 51 migrations
   - Date de dernière vérification : 8 mai 2026

2. Section sécurité :
   - Les 6 critiques #71-76 passent en ✅ RÉSOLUES (cf. tableau dans AUDIT_KOMERCE_FINAL.md §"Ce qui est solide")
   - V-01 logistics passe en ✅ RÉSOLUE

3. Section Vague 1 :
   - Note les éléments déjà faits (la plupart des sécurité)
   - Garde les éléments restants

4. Section Go-Live (P4 6.x) :
   - 6.6 JWT_SECRET → ✅ (boot crash si absent)
   - 6.9 Monitoring → 🟡 (Pino + monitoring.js OK, Sentry à activer = chantier 4)
   - Ajoute 6.11 Migration de rattrapage couture (chantier 1)
   - Marque les autres avec leur statut réel

5. Section "Documentation à mettre à jour" :
   - Ajoute le lien vers SYNOPTIQUE_KOMERCE.md
   - Note ARCHITECTURE_LIVE.md autogénéré
   - Liste les docs archivées

6. Date de mise à jour : 8 mai 2026, version 10.6.2

Règles :
- Tu n'inventes RIEN. Tu ne corriges QUE ce qui est explicitement dans AUDIT_KOMERCE_FINAL.md
- Tu gardes le ton et la structure existants de la roadmap
- Tu commits propre

C'est juste de l'édition. Démarre.
```

## Fichiers à attacher

- `AUDIT_KOMERCE_FINAL.md` (livré par Opus)
- `docs/ROADMAP_KOMERCE.md`

## Critère de fin

- ✅ Plus aucune mention "6 critiques ouvertes"
- ✅ Métriques alignées
- ✅ Date à jour

## Retour ici

Cocher chantier 11 ✅

---

# 📒 Notes opérationnelles

## Discipline de pilote

Vous tenez le gouvernail. Quelques règles qui marchent en pratique :

1. **Une fenêtre Sonnet par chantier**. Vous fermez la fenêtre quand le chantier est cocher. Pas de conversation Sonnet à rallonge.
2. **Si Sonnet hésite, vous revenez à Opus** (cette conversation). N'essayez pas de pousser Sonnet à arbitrer — il sur-réfléchit, dépense des tokens, et conclut souvent moins bien qu'Opus.
3. **Vous gardez les commits Sonnet**. Pas de squash. Vous voulez voir la trace du raisonnement.
4. **Toutes les 30 min, vous demandez à Sonnet "résume ce que tu as fait jusqu'ici"**. Ça vous évite de découvrir 3h plus tard qu'il a pris une mauvaise direction.
5. **Si un chantier dérape (>50 % au-delà de l'estimé)** → revenez à Opus pour rediagnostiquer.

## Si vous bloquez

Symptômes courants quand on délègue à Sonnet :

| Symptôme | Cause probable | Solution |
|---|---|---|
| Sonnet pose 10 questions avant de coder | Prompt trop ouvert | Reprenez le prompt de cette roadmap, plus précis |
| Sonnet réécrit des trucs hors scope | Pas assez de contraintes "tu ne touches pas à X" | Ajoutez un §RÈGLES STRICTES en haut du prompt |
| Sonnet hallucine un fichier qui n'existe pas | Pas attaché les bons fichiers | Re-vérifiez la liste "Fichiers à attacher" |
| Sonnet propose une refacto monstrueuse | Trop de zèle | Coupez : "non, fais STRICTEMENT ce qui est demandé, pas plus" |
| Sonnet est lent | Trop de fichiers en context | Splittez le chantier en sous-tâches |

## Quand revenir vers Opus

Vous me sollicitez (Opus) quand :

- Une décision architecturale apparaît (qu'on n'avait pas prévue)
- Un chantier déborde (plus de 50 % au-delà de l'estimé)
- Vous avez fini la roadmap et voulez la prochaine vague (post-launch)
- Vous découvrez un risque qui n'était pas dans l'audit

Vous ne me sollicitez PAS pour :

- Du débuggage (Sonnet sait)
- Réécrire un prompt (vous savez maintenant)
- Demander si "ça marche" (Sonnet teste)

---

# ✅ Suivi

| # | Chantier | Date début | Date fin | Notes |
|---|---|---|---|---|
| 1 | Migration 068 couture | | | |
| 2 | Backup + restore | | | |
| 3 | Reset factory prod | | | |
| 4 | Sentry | | | |
| 5 | Cash relais guard | | | |
| 6 | Secrets + admin pwd | | | |
| 7 | Desktop frontend | | | |
| 8 | Panier collectif cash | | | |
| 9 | Page Sur-mesure | | | |
| 10 | Ménage docs | | | |
| 11 | ROADMAP à jour | | | |

**Date Go-Live cible** : à fixer après chantier 6.
