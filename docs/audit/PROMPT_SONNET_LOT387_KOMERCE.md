# Prompt opérationnel — Sonnet : lot #387 « Dette avouée + intégrité colis » (Komerce)

> Copier-coller à Sonnet (Claude Code / agent repo).
> Objectif : clore la dette que le code avoue lui-même (ticket **#387**, présent à 3 endroits) + corriger les écritures multi-étapes sans transaction. Le point stockage est un **bloqueur go-live** : sur Railway, les images produits uploadées disparaissent à chaque redéploiement.

---

## RÔLE

Tu es ingénieur backend senior sur Komerce. Lot correctif ciblé : tu fermes des trous identifiés, tu ne refactores pas autour. Conservateur : chaque correctif est minimal, testé, réversible.

## CONTEXTE À LIRE D'ABORD

- `docs/ZONE_IMPACT.md` (invariants, notamment I-09 : le colis est une unité autonome).
- `middleware/upload.js` (lis son en-tête : il documente lui-même le problème).
- `services/auto-parcel.js`, `services/inventory-service.js`, `routes/orders/detail.js`, `utils/parcelSync.js`.

## CONSTATS DÉJÀ VÉRIFIÉS PAR L'ARCHITECTE (point de départ factuel)

1. **Uploads éphémères (🔴 bloqueur).** `middleware/upload.js` : multer `diskStorage` → `public/uploads/products/`, avec l'aveu en commentaire : *« Railway : le filesystem est éphémère. Les images survivent aux restarts mais PAS aux redéploiements. TODO #387 : Migrer vers un stockage objet persistant avant la prod. »* Consommé par `routes/products.js`. Le bon réflexe sécurité existe déjà (`validateMagicBytes`, extensions whitelist, 5 Mo max, noms crypto-aléatoires) — **à préserver tel quel**.
2. **Écritures sans transaction.** `auto-parcel.js` : `INSERT INTO parcels` (l.~140) puis `INSERT INTO parcel_items` (l.~173/182) en requêtes séparées sans BEGIN/COMMIT → crash entre les deux = **colis vide orphelin** (viole l'esprit I-09). Aussi : `DELETE FROM parcels` (l.~354/368) — vérifier que les items liés sont gérés (CASCADE ou delete explicite, dans la même transaction). `inventory-service.js` : séquence UPDATE inventory_items / INSERT parcel_items / UPDATE orders (l.~72–168) sans transaction.
3. **Soft-auth manquant.** `routes/orders/detail.js` l.63 : *« TODO #387 : Ajouter un middleware soft-auth pour peupler `req.user` sans bloquer les accès publics. »*
4. **Alerte sync absente.** `utils/parcelSync.js` l.224 : *« PATCH P2-10 / TODO #387 : alerte 'elevated' si la sync parcel échoue. »* (l'`alert-engine`/table `incidents` existe déjà — s'y brancher.)
5. *(Mineur, optionnel)* `services/monitoring.js` lance `setInterval(checkAlerts, 60000)` **au require** : effet de bord au chargement, actif aussi en test. Gater comme les crons de `bootstrap/crons.js`.

## GARDE-FOUS ABSOLUS

1. **Préserver la sécurité d'upload existante** : magic bytes, whitelist d'extensions, taille max, noms aléatoires. La migration de stockage ne doit en retirer aucune.
2. **URLs d'images stables** : la migration ne doit pas casser les URLs déjà en DB. Prévois la compatibilité (redirection ou rétention du chemin `/uploads/products/...` devant le nouveau backend de stockage) **et** un script de migration des fichiers existants.
3. **Transactions = mêmes connexions** : utilise `pool.connect()` + `BEGIN/COMMIT/ROLLBACK` sur **le même client** pour toutes les requêtes du bloc (pattern déjà utilisé par les 21 services transactionnels du repo — copie ce pattern, n'en invente pas un).
4. **Soft-auth ≠ auth obligatoire** : le middleware peuple `req.user` si un token valide est présent, **ne bloque jamais** sinon. Aucune route publique ne doit devenir 401.
5. **Aucun changement du contrat HTTP** des routes touchées (mêmes chemins, mêmes formes de réponse).
6. **`REQUIRED_ENV` fail-fast** : si le stockage objet exige des variables, elles entrent dans `REQUIRED_ENV` (prod) — pas de fallback silencieux vers le disque en prod.

## MISSION — sous-lots, dans l'ordre

### F1 — Stockage objet pour les uploads (le bloqueur)
- Propose la cible (je tranche) : **Cloudflare R2** (S3-compatible, egress gratuit — pertinent vu le trafic images boutique), **S3**, ou en minimal un **volume persistant Railway** (solution pansement, à n'accepter que comme étape).
- Implémente derrière une **interface de stockage** (`putObject/getUrl/delete`) pour ne pas coupler multer au provider ; en local/dev, fallback disque autorisé.
- Migre les fichiers existants (script one-shot) et garantis la compatibilité des URLs en DB (garde-fou 2).
- Tests : upload OK (magic bytes toujours actifs), URL servie OK, redéploiement simulé (suppression du dossier local) → images toujours servies.

### F2 — Transactions sur les écritures multi-étapes
- `auto-parcel.js` : englobe création parcel + items (et les DELETE avec leurs items) dans une transaction sur le même client. Rollback testé : si l'INSERT items échoue, **aucun parcel vide ne reste**.
- `inventory-service.js` : même traitement pour les séquences UPDATE/INSERT/UPDATE qui doivent être atomiques (réception → affectation colis → compteurs commande).
- Copie le pattern transactionnel existant du repo (21 services le font déjà) pour rester homogène.

### F3 — Middleware soft-auth (`orders/detail`)
- Crée `middleware/soft-auth.js` : décode le JWT s'il est présent et valide → `req.user` ; sinon continue sans erreur. Branche-le sur `routes/orders/detail.js` (et uniquement là pour ce lot).
- Tests : accès public inchangé (200 sans token), accès authentifié enrichi (`req.user` peuplé), token invalide → traité comme public, jamais 401.

### F4 — Alerte sync parcel
- Dans `utils/parcelSync.js`, au point marqué (l.~224) : en cas d'échec de sync, créer un incident `elevated` via le mécanisme existant (`alert-engine`/table `incidents`), best-effort (l'alerte ne doit jamais faire échouer l'appelant).

### F5 — (optionnel) Gating de `monitoring.js`
- Démarre l'intervalle via `bootstrap/crons.js` (ou gate `NODE_ENV !== 'test'` + export d'une fonction `start/stop`), au lieu de l'effet de bord au require.

## MÉTHODE

1. **F1 d'abord** (bloqueur go-live), puis F2 (intégrité), puis F3/F4 (rapides), F5 si le temps.
2. Plan court par sous-lot (fichiers, risque, test) → mon OK → diff minimal.
3. **Un test par correctif** (cf. critères) ; `npm test` vert.
4. **Doc-sync** : `CARTOGRAPHY_360.md` (stockage objet = nouvelle dépendance externe, variables env), `STATUS.md` (ticket #387 clos), et retire les TODO #387 du code une fois traités.

## CRITÈRES D'ACCEPTATION

- Un redéploiement ne fait plus perdre **aucune** image produit (testé) ; sécurité d'upload intacte ; URLs existantes toujours valides.
- Crash simulé au milieu de la création d'un colis → **zéro** parcel orphelin en base (rollback prouvé par test).
- `orders/detail` : public inchangé, authentifié enrichi, jamais de 401 introduit.
- Échec de sync parcel → incident `elevated` créé, appelant jamais cassé.
- Plus aucun `TODO #387` dans le code.

## ANTI-OBJECTIFS

- Pas de refonte du système d'upload (juste le backend de stockage).
- Pas de transaction « globale » géante autour de logique métier longue — uniquement les blocs d'écriture atomiques identifiés.
- Pas de soft-auth généralisé à toutes les routes (uniquement `orders/detail` dans ce lot).
- Pas de nouveau système d'alerting — on se branche sur `incidents`/`alert-engine` existant.

---

### Mini-prompts prêts à tirer

**F1** — « Lance F1. Lis `middleware/upload.js` et `routes/products.js`, propose la cible de stockage (R2 vs S3 vs volume Railway) avec tradeoffs et le plan de migration des fichiers + compatibilité des URLs en DB. Stop avant d'implémenter. »

**F2** — « Lance F2. Montre le pattern transactionnel déjà utilisé par les services du repo, puis applique-le à `auto-parcel.js` (création parcel+items, deletes) et `inventory-service.js` (réception→affectation→compteurs). Prouve par un test qu'un échec au milieu ne laisse aucun parcel orphelin. »

**F3+F4** — « Lance F3 et F4. Crée `middleware/soft-auth.js` (peuple `req.user` sans jamais bloquer), branche-le sur `orders/detail`, et ajoute l'incident `elevated` best-effort dans `parcelSync` au point marqué. Tests : public 200 sans token, token invalide ≠ 401, échec sync → incident créé sans casser l'appelant. »
