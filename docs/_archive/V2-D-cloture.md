# V2-D — bibliothèque « Mes listes » (Amendement V2 §D)

**Statut : CLOS.**

## Backend

- Migration 127 : `shared_cart_saved_access` (user_id, shared_cart_id, saved_at ; FK cascade ; index unique (user_id, shared_cart_id) ; index (user_id, saved_at DESC)).
- `services/shared-cart-library.js` : `getSharedCartLibrary(userId)` (délègue « Créées par moi » à `listMySharedCarts`, requête dédiée pour « Partagées avec moi » avec agrégats et prénom organisateur) et `saveSharedCartForUser(userId, token)` (idempotent, refuse la sauvegarde d'une liste dont l'utilisateur est le créateur — `cannot_save_own_list`).
- `services/shared-cart-engine.js` : barrel étendu, expose `getSharedCartLibrary`/`saveSharedCartForUser`.
- `routes/shared-cart.js` : `GET /api/shared-carts/library` et `POST /api/shared-carts/save`, enregistrées avant `GET /:id` pour ne pas être capturées par le wildcard.
- Doctrine respectée : sauvegarde explicite, jamais implicite — ouvrir un lien reçu ne pose jamais de ligne dans `shared_cart_saved_access`.

## Frontend (boutique)

- `group/group-api.js` : `getSharedCartLibrary()`, `saveSharedCart(token)`.
- `group/group-side-cart.js` : surface canonique `library` généralisée au même titre que `shared-list` (`isSharedListSurfaceActive()` / `exitSharedListRenderMode()`) ; `renderLibraryInCart()` + `activateOwnerLibrary()` remplacent `activateOwnerMostRecentList()` (supprimée) ; bouton « ☆ Sauvegarder cette liste » côté destinataire (`saveActionHtml()` / `handleSaveList()`), jamais affiché au créateur.
- `b-store.js` : `state.libraryContext = { created: [], saved: [] }`.
- `b-nav.js` : les deux points d'entrée (`bus.on('nav:goto-group')` et `?tab=group`) appellent désormais `activateOwnerLibrary()`. `b-komerce.js` n'a rien à changer — il passe déjà par `bus.emit('nav:goto-group')`.
- CSS `shared-list-side-cart.css` : masquage `data-mode="library"` (desktop + drawer mobile, même mécanique que `shared-list`), `.k-library-section`, `.k-library-item`, `.k-shared-list-save-action`.

## Tests

- Backend ciblé V2-D : 70/70 verts (`shared-cart-library.test.js`, `shared-cart-engine.test.js`, `shared-cart-creator-route.test.js`).
- Backend suite complète : 5981/6007 verts (hors 26 échecs, tous des tests d'intégration/invariants nécessitant Postgres, indisponible dans cet environnement — sans rapport avec V2-D).
- Boutique suite complète (`npm run test:unit`) : 1761/1762 verts. Seul échec : `css-guard-compact-line.test.js`, dette pré-existante sans lien avec V2-D (aucun fichier CSS partagé touché hors `shared-list-side-cart.css`).
- Résidus `activateOwnerMostRecentList` : aucun dans le code exécuté (`b-nav.js`, `group-side-cart.js`, `b-nav.test.js`, `group-side-cart.test.js`). Restent uniquement des mentions documentaires (« remplace X ») et le fichier orphelin `public/tests/unit/group-side-cart.test.js` (pointe vers un `public/js/group/` inexistant, jamais exécuté par aucun script npm — dette pré-existante hors V2-D, non touchée).

## Gate registre backend (correction post-livraison)

`feature:registry` remontait un `DOMAIN-MISMATCH` bloquant : `services/shared-cart-library.js` (`@domain shared-cart`) absent du manifest `features/shared-cart.feature.js`. Corrigé :
- `files.services` : ajout de `shared-cart-library.js`.
- `files.migrations` : ajout de `127_shared_cart_saved_access.sql`.
- `files.tests` : ajout de `shared-cart-library.test.js`.
- `db.tables` : ajout de `shared_cart_saved_access: RW`.
- `contract.exposes` : ajout de `GET /api/shared-carts/library` et `POST /api/shared-carts/save`.

`arch:gate` (drift SCHEMA.md ↔ DB live) bloquait ensuite sur `shared_cart_saved_access` (`[HORS-LISTE]`, migration 127 pas encore déployée en live) — même situation que `user_pickup_authorizations`/migration 121. Ajouté à `scripts/arch-debt-budget.json::knownDriftAllowlist` avec note explicite ; auto-élaguée par `arch-reconcile.js` dès que la migration tourne en prod et que le dump live est rafraîchi.

`feature:registry` (exit 0, 4 orphelins CI pré-existants sans rapport), `feature:registry-doc` (1 erreur pré-existante sur `business-rules.feature.js`, sans rapport avec `shared-cart`), et le drift `arch:gate` (0 fiction hors liste) sont désormais conformes. Le seul échec restant d'`arch:gate` (`check-schema-resurrection.js`) porte sur des tables `collective_*`/`order_status` ressuscitées hors bande par les migrations 124/125/126 — antérieur à V2-D, aucune mention de `shared_cart_saved_access`, hors périmètre de ce lot.

## Gate contrat OpenAPI / Boutique 360 (correction post-livraison)

`boutique:360:check` bloquait ensuite : `/api/shared-carts/library` et `/api/shared-carts/save` remontés comme « endpoint hors contrat » — `group-api.js` les appelle mais ils étaient absents de `docs/contract/openapi.json`. Cause : le contrat était stale (encore l'ancien domaine V4.1 — `contributions`, `estimations`, `awaiting-choice`, `finalize`, `stripe/webhook`, tous déjà supprimés du code lors de la réécriture Boutique First). Régénéré via `npm run contract:generate` plutôt que figer les deux endpoints un par un : le diff résultant (17 chemins retirés, 5 ajoutés) ne contient que des routes déjà mortes côté code (domaine V4.1 shared-cart + `event-workspaces`, tables `collective_workspace_*` droppées migration 126) et des routes déjà présentes côté code mais jamais synchronisées (`/api/pickup/exceptional-pickup/*` — migration 121, `PATCH /:id/items/:itemId`), en plus des deux endpoints §D. `docs/BOUTIQUE_360.md`/`.json` régénérés à la suite. `boutique:360:check` : conforme, aucune anomalie hors baseline. Suite complète backend re-vérifiée après régénération : 5981/6007 (mêmes 26 échecs Postgres, aucune régression).

## Gate meta-graphe (correction post-livraison, hors périmètre V2-D)

`meta:graph:check` bloquait sur une couture fantôme : `/api/admin/dashboard/event-workspaces` (front dashboards → endpoint absent du contrat). Root cause, sans rapport avec V2-D : reliquat de l'ancien « panier événement collectif » démonté par la migration 126 (`collective_workspace_*`). Preuves de code mort convergentes avant suppression :
- `KmcApi.getEventWorkspaces` n'existe pas dans `public/dashboards/admin/js/api-client.js` (appel qui aurait toujours levé une exception à l'exécution).
- `EventWorkspacesView.js` porte `@used-by: none` et n'est référencée par aucun routeur/nav dashboards (script `<script>` chargé mais jamais invoqué).
- Aucune route backend `event-workspaces` nulle part dans `routes/`.
- Le contrat OpenAPI stale (avant régénération de ce tour) contenait encore ce chemin fantôme, ce qui masquait le problème depuis longtemps — la régénération l'a fait ressortir en toute légitimité, ce n'est pas une régression introduite par V2-D.

Action : suppression structurelle plutôt que `--save` (qui aurait figé un appel réellement cassé) :
- `public/dashboards/admin/js/views/EventWorkspacesView.js` et son test `public/dashboards/tests/unit/EventWorkspacesView.test.js` archivés dans `.agent/_archive/event-workspaces-decommission/`.
- Balise `<script>` retirée de `public/dashboards/admin/index.html`.
- Entrée retirée de `public/dashboards/features/admin-dashboard.feature.js`.
- `public/tests/unit/EventWorkspacesView.test.js` (arborescence `public/` orpheline, jamais exécutée) laissé en l'état, cohérent avec la dette déjà actée.

Vérifications : suite dashboards complète 38/38 suites, 953/953 tests verts après suppression. `dashboards:360:check`, `boutique:360:check`, `meta:graph:check`, `feature:registry` : tous conformes (`meta:graph` : 87 endpoints, 0 fantôme). `docs/DASHBOARDS_360.md/.json` et `docs/META_GRAPH.md/.json` régénérés.

## Audits natifs (boutique)

`check:imports`, `check:important`, `check:css-guard`, `check:css-specificity-guard`, `audit:arch`, `audit:gate` : tous conformes, aucune hausse hors baseline.

## Dette résiduelle notée, non traitée

- `group-state.js::pickOwnerCart` : orpheline côté appelants (plus utilisée par `group-side-cart.js`), mais toujours exportée et couverte par ses propres tests (`group-state.test.js`) — aucun gate d'audit ne la signale comme code mort.
- `group-api.js::getOwnerSharedCarts` : idem, toujours exportée et testée (`group-api.test.js`), plus appelée depuis `group-side-cart.js` (remplacée par `getSharedCartLibrary`).
- Décision : laissées en l'état plutôt que supprimées à l'aveugle — à statuer lors d'un futur lot de nettoyage dédié, avec grep de contrôle sur l'ensemble du monorepo (pas seulement boutique) avant suppression.

## Réserve

La fermeture porte sur le périmètre V2-D (bibliothèque « Mes listes »). Elle ne couvre pas V2-C (images snapshot) ni V2-E (checkout snapshot read-only), qui restent à traiter séparément selon la feuille de route.
