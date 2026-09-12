# Étape 5 — Audit rôles / scope / market_id — komerce-backend

Diagnostic uniquement. Aucun code modifié. Base : `main` (commit local à `2c19ff2f4`, post-merge PR #1449).

Sources normatives lues intégralement avant l'audit :
`features/dashboard.feature.js`, `docs/doctrine/ADMIN_INTERNAL_PORTAL_DOCTRINE.md`,
`docs/doctrine/DOCTRINE_ADMIN_DASHBOARDS.md`, `docs/contract/DASHBOARD_MARKET_SCOPE_2C.md`,
`docs/contract/ACTION_CENTER_4G.md`, `docs/contract/CLIENT_INDEX_4I.md`,
`docs/admin-nav-capability-map.md`, `public/dashboards/canonical/js/navigation.js`,
`middleware/require-market-scope.js`, `middleware/require-dashboard-global-authority.js`,
`services/market-delegation-service.js` + les routeurs de chaque surface.

## 0. Écart majeur trouvé — CORRIGÉ

**Statut : corrigé** (branche `audit/step5-role-scope-market-id`, commit suivant celui de
ce rapport). `requireDashboardGlobalAuthority` est désormais appliqué après `requireAdmin`
sur les 5 routes de `routes/admin-dashboard.js` (`/control-tower`, `/costing`, `/logistics`,
`/unified`, `POST /cache/clear`). Deux tests ajoutés dans `tests/unit/admin-dashboard.test.js`
(describe `admin-dashboard — autorité globale explicite`) prouvent : un `admin` sans grant
actif dans `dashboard_global_access_grants` reçoit désormais 403
`dashboard_global_access_denied` sur les 5 routes ; un `admin` avec grant actif continue de
recevoir 200. Les tests existants restaient verts avant correctif uniquement parce que leur
mock générique de `db.query` renvoie des lignes non vides pour toute requête, y compris
celle du grant — un `AUDIT_GAP` en soi, maintenant fermé par les deux nouveaux tests qui
distinguent explicitement la requête `dashboard_global_access_grants` du reste.

Le texte ci-dessous décrit le constat original (avant correctif), conservé pour traçabilité.

**CROSS_MARKET_BUG confirmé et prouvé statiquement + par lecture des tests existants.**

Le contrat `docs/contract/DASHBOARD_MARKET_SCOPE_2C.md` (ligne 113) affirme :

> « Les agrégats globaux historiques `/api/admin/dashboard/*` (`control-tower`,
> `costing`, `logistics`, `unified`, `cache/clear`) traversent
> `requireDashboardGlobalAuthority` avant d'atteindre leur routeur. »

Ce n'est **pas** ce que fait le code.

- `routes/admin-dashboard.js` monte `GET /unified`, `GET /control-tower`, `GET /costing`,
  `GET /logistics`, `POST /cache/clear` avec **seulement** `authenticate, requireAdmin`
  (`requireAdmin` =
  `requireRole(['admin'])`, `middleware/auth.js:123` — un simple contrôle de rôle scalaire,
  sans aucune requête vers `dashboard_global_access_grants`).
- `requireDashboardGlobalAuthority` (`middleware/require-dashboard-global-authority.js`) porte
  lui-même dans son header `@used-by routes/admin-dashboard-market.js` — **pas**
  `admin-dashboard.js`. Confirmé par grep : la chaîne `requireDashboardGlobalAuthority`
  n'apparaît nulle part dans `routes/admin-dashboard.js`.
- Le frontend Canonical appelle réellement cette route non protégée :
  `public/dashboards/canonical/js/pilotage.js:28` —
  `const GLOBAL_ENDPOINT = '/api/admin/dashboard/unified';` — utilisée en mode `global`.
- `routes/admin-dashboard-market.js`, lui, fait bien les choses pour les nouvelles routes
  Canonical : `/commerce`, `/operations`, `/finance` (global, sans `:marketCode`) sont
  montées après `router.use(authenticate, requireAdmin, requireDashboardGlobalAuthority)`
  (lignes 224-228) — cohérent avec le contrat.

**Conséquence concrète** : un utilisateur `role='admin'` qui, selon la doctrine, devrait
rester enfermé sur un seul marché (aucun grant actif dans `dashboard_global_access_grants`,
seulement des lignes dans `operator_market_scopes`) obtient quand même les 17 KPIs
consolidés tous marchés via `GET /api/admin/dashboard/unified` — alors que le même admin
reçoit correctement un 403 sur `GET /api/admin/dashboard/commerce` (route jumelle, même
notion de "global"). C'est exactement l'invariant que `DASHBOARD_MARKET_SCOPE_2C.md`
(section « Bootstrap legacy ») dit vouloir garantir, et qu'il ne garantit pas sur ce chemin.

- **Preuve tests** : `tests/unit/admin-dashboard.test.js` teste `/control-tower`, `/costing`,
  `/unified`, `/cache/clear` en mockant seulement `role: 'admin'` — aucun mock de
  `dashboard_global_access_grants`, aucune assertion 403 sans grant. Le test valide donc le
  comportement actuel (non protégé), pas l'invariant doctrinal.
- **Idem** : `requireDashboardGlobalAuthority` est testé isolément
  (`tests/unit/require-dashboard-global-authority.test.js`), jamais en intégration sur ces
  quatre routes précises.

Classement : `CROSS_MARKET_BUG` (comportement) + `AUDIT_GAP` (aucun test n'aurait
détecté la régression si le guard avait un jour existé puis été retiré) + divergence
doc/code sur `DASHBOARD_MARKET_SCOPE_2C.md` elle-même (la doctrine décrit un état qui
n'a jamais été implémenté sur ce fichier legacy, ou l'a été puis perdu — à investiguer via
`git log -p -- routes/admin-dashboard.js` si l'historique exact importe).

**Correctif minimal (non appliqué dans cette passe)** : ajouter
`requireDashboardGlobalAuthority` après `requireAdmin` sur les 5 routes de
`routes/admin-dashboard.js` (`/control-tower`, `/costing`, `/logistics`, `/unified`,
`POST /cache/clear`),
puis un test d'intégration miroir de celui qui existe déjà pour
`admin-dashboard-market.js` (admin avec scope marché seul → 403 sur ces 4 routes).

## 1. Matrice — Pilotage / Dashboard

Source UI : `navigation.js` domaine `dashboard` (visible à tous rôles, y compris `support`,
via le fallback défense-en-profondeur `domainIsVisible`). Source backend :
`routes/admin-dashboard-market.js`, `routes/admin-dashboard.js`.

| Rôle | UI visible | Endpoint réel | Guard | Scope | Résultat attendu | Observé | Statut |
|---|---|---|---|---|---|---|---|
| admin | oui | `GET /context` | `requireCanonicalContextRole` (admin, mo, agent_hub, agent_relais, agent_transitaire, finance) | — | contexte résolu | conforme | ALREADY_PROVEN (test: `dashboard-admin-context.test.js`) |
| admin (grant global) | oui | `GET /unified` | `requireAdmin` **seul** | prétendu global-grant, réel = rôle seul | 200 uniquement si grant | 200 pour tout admin, avec ou sans grant | **CROSS_MARKET_BUG** (§0) |
| admin (sans grant, 1 marché) | oui | `GET /unified/market/:code` | `requireMarketDashboardReadRole` + `requireDashboardMarketRead` (`requireMarketScope` ou grant global) | market | 403 hors marché autorisé, 200 dans le marché | conforme, prouvé | ALREADY_PROVEN (`admin-dashboard-market.test.js`) |
| market_operator | oui | `GET /unified/market/:code` | idem | market (`operator_market_scopes`) | 200 marché autorisé, 403 marché B | conforme | ALREADY_PROVEN + test isolation CM/CG (`admin-dashboard-market.test.js`) |
| market_operator | — | `GET /unified`, `/control-tower`, `/costing`, `/logistics` (global) | `requireAdmin` | — | 403 (rôle non admin) | 403 correct — **mais uniquement parce que le rôle est filtré, pas parce que la notion de grant existe sur cette route** | ALREADY_PROVEN pour ce rôle précis ; le trou ne touche que les comptes `role='admin'` sans grant |
| finance, agent_hub, agent_relais, agent_transitaire | oui (onglet Dashboard) | `GET /context` OK, mais `GET /unified*` | `requireMarketDashboardReadRole` = admin/mo uniquement | — | contexte OK, données KPI refusées | conforme, prouvé par doc §1 capability map + code | ALREADY_PROVEN — comportement intentionnel (« les autres rôles autorisés au contexte ne gagnent aucun droit Dashboard ») |
| sourcing, support | oui (onglet Dashboard, fallback défense-en-profondeur) | `GET /context` | `requireCanonicalContextRole` **exclut** sourcing et support | — | 403 sur le contexte lui-même | à vérifier : `sourcing` et `support` ne sont pas dans la liste de `requireCanonicalContextRole` (admin, market_operator, agent_hub, agent_relais, agent_transitaire, finance) | **UI_VISIBILITY_GAP potentiel** — nav affiche l'onglet Dashboard à `sourcing`/`support` (car `domainIsVisible` retourne toujours `true` pour ce domaine), mais le contexte serveur leur refusera même la résolution de base. Non un 403 caché malveillant (le mock accepte ce fallback comme « défense en profondeur »), mais à confirmer que l'UI gère bien un 403 sur `/context` sans écran cassé. Zéro test trouvé qui simule `sourcing`/`support` contre `/context` |

## 2. Commerce / Commandes

| Rôle | UI visible | Endpoint | Guard | Scope | Statut |
|---|---|---|---|---|---|
| admin, market_operator | oui | `GET /commerce/market/:code` | `requireMarketDashboardReadRole` + market scope | market | ALREADY_PROVEN (`admin-dashboard-commerce-route.test.js`) |
| admin (grant global) | oui | `GET /commerce` (global) | `requireAdmin + requireDashboardGlobalAuthority` (`router.use` ligne 224 de `admin-dashboard-market.js`) | global explicite | ALREADY_PROVEN — bien câblé, contrairement à `/unified` legacy |
| autres rôles | non (pas dans `DOMAINS.orders.roles`) | — | — | — | ALREADY_PROVEN par absence : cohérent avec le guard serveur |

## 3. Atelier économique (Pricing Workspace)

`routes/admin-pricing-workspace.js`.

| Rôle | UI visible | Endpoint | Guard | Scope | Statut |
|---|---|---|---|---|---|
| admin, market_operator | oui | `*/market/:marketCode/*` | `router.use('/market/:marketCode', ..., requireRole(['admin','market_operator']), rejectBrowserAuthority, resolveRequestedMarket, attachAuthorizedMarkets, requireMarketPricingAccess)` | market, avec `rejectBrowserAuthority` anti client-supplied | ALREADY_PROVEN (`admin-pricing-workspace-market-route.test.js`) |
| admin uniquement | non exposé en nav (accessible par lien direct workspace) | `/structure-events` (scope GROUP) | `router.use(authenticate, requireRole(['admin']), requirePricingGlobalAuthority, rejectBrowserAuthority)` | global (GROUP, jamais un marché) | ALREADY_PROVEN, commentaire de code explicite : « Un market_operator ne peut jamais tomber sur ces routes car le guard de rôle est admin-only » |
| finance, sourcing, agents | non | — | — | — | conforme au guard serveur (admin/mo uniquement) |
| — | — | `/market/{code}/strategy` (17 routes CONTRACT_GAP documentées, PR #1449) | code mort confirmé (§ session précédente) : `mount()` ne rend jamais `renderStrategy` en mode marché | n/a | ALREADY_PROVEN inoffensif — DEAD_CODE, pas un bug vivant (voir historique PR #1449) |

## 4. Catalogue

Deux surfaces distinctes derrière le même onglet nav, selon rôle (`navigation.js::hrefFor`) :

| Rôle | UI → route | Endpoint réel | Guard | Scope | Statut |
|---|---|---|---|---|---|
| admin | `/admin/workspaces/catalog` | `routes/admin-catalog-workspace.js` | `guard = [authenticate, requireRole(['admin']), requireCatalogGlobalAuthority]` | global | ALREADY_PROVEN |
| market_operator | `/dashboards/canonical/market-catalog.html` (redirection spéciale dans `hrefFor()`, PAS le même endpoint) | `routes/market-delegation-catalog.js` → `GET/PUT .../catalog/exposure*` | `authenticate` + capability `resolveAuthorization(..., requiredCapability)` via `services/market-delegation-service.js` | market + capability (assignment ceiling) | ALREADY_PROVEN — bon exemple de séparation correcte : le nav ne pointe PAS market_operator vers la route admin-only, il le redirige vers la surface capability-scopée. Aucune divergence trouvée |
| autres rôles | non visible | — | — | — | conforme |

## 5. Marchés

Même mécanique de redirection par rôle que Catalogue :

| Rôle | UI → route | Endpoint | Guard | Statut |
|---|---|---|---|---|
| admin | `/dashboards/canonical/access.html` | `/api/admin/users?role=market_operator`, `/api/admin/dashboard/context` | gestion utilisateurs (admin only — à reconfirmer, doc le note déjà comme non vérifié) | **AUDIT_GAP** hérité de la doc elle-même (« à confirmer si la route existe encore ») — non retracé dans cette passe, priorité basse |
| market_operator | `/dashboards/canonical/market-autonomy.html` | `admin-pricing-workspace.js` `/market/:code/*` (même famille que §3) | `requireRole(['admin','market_operator'])` + market scope | ALREADY_PROVEN (même guard que Atelier économique) |

## 6. Opérations (Vue d'ensemble + Hub/Relais + Sourcing)

| Rôle | UI visible | Endpoint | Guard | Scope | Statut |
|---|---|---|---|---|---|
| admin, market_operator | oui (Vue d'ensemble) | `GET /operations/market/:code`, `GET /operations` (global) | market : `requireMarketDashboardReadRole`+scope ; global : `requireAdmin+requireDashboardGlobalAuthority` | market / global explicite | ALREADY_PROVEN |
| admin, agent_hub, agent_relais, market_operator | oui (Hub/Relais workspace) | `admin-operations-workspace.js` | `requireWorkspaceReadRole = requireRole(['admin','agent_hub','agent_relais','market_operator'])`, actions séparées : `requireHubWorkspaceAction=requireRole(['admin','agent_hub'])`, `requireRelayWorkspaceAction=requireRole(['admin','agent_relais'])` | market scope + fallback grant global (`hasDashboardGlobalAuthority`) | ALREADY_PROVEN (`admin-operations-workspace-route.test.js`) — bonne séparation lecture/mutation par capability de rôle (Hub ne peut pas déclencher une action Relais et vice-versa) |
| admin, sourcing | oui (Sourcing, onglet séparé) | `admin-sourcing-workspace.js` | `guard=[authenticate, requireRole(['admin','sourcing']), requireSourcingGlobalAuthority]` | global (pas de market scope — cohérent, sourcing n'est pas scindé par marché dans la doctrine actuelle) | ALREADY_PROVEN |
| agent_transitaire | non (pas dans les rôles operations-workspace) | — | — | — | conforme — transitaire est scindé vers Expéditions & Douane, pas Operations |

## 7. Expéditions & Douane

| Rôle | UI visible | Endpoint | Guard | Scope | Statut |
|---|---|---|---|---|---|
| admin, agent_hub, agent_transitaire, market_operator | oui | `admin-shipping-customs-workspace.js` | `requireWorkspaceReadRole=requireRole(['admin','agent_hub','agent_transitaire','market_operator'])` ; actions : `requireTransitAction=requireRole(['admin','agent_hub','agent_transitaire'])`, `requireCustomsAction=requireRole(['admin'])` (douane = admin only, cohérent avec `routes/admin-customs-categories.js` = autorité douane dédiée) | market scope + fallback grant global | ALREADY_PROVEN (`admin-shipping-customs-workspace-route.test.js`) |
| agent_relais | non | — | — | — | conforme (Relais n'a pas ce métier) |

## 8. Finance / Comptabilité

| Rôle | UI visible | Endpoint | Guard | Scope | Statut |
|---|---|---|---|---|---|
| admin, market_operator | oui (Vue d'ensemble Finance) | `GET /finance/market/:code`, `GET /finance` (global) | idem §2/§6 (market ou grant global explicite) | market / global | ALREADY_PROVEN |
| admin, finance, agent_relais, market_operator | oui (Comptabilité workspace) | `admin-finance-accounting-workspace.js` | `requireWorkspaceReadRole=requireRole(['admin','finance','agent_relais','market_operator'])` ; `requireDepositAction=requireRole(['admin','agent_relais'])` (encaissement point de collecte, cohérent doctrine II-5b) ; `requireVerificationAction=requireRole(['admin'])` | market scope + fallback grant global | ALREADY_PROVEN (`admin-finance-accounting-workspace-route.test.js`) |
| sourcing, agent_hub, agent_transitaire | non | — | — | — | conforme |

## 9. Action Center

Doctrine explicite : **global/central uniquement**, jamais market-scoped, tant que `signals`
ne porte pas de `market_id` (`ACTION_CENTER_4G.md`).

| Rôle | UI visible | Endpoint | Guard | Scope | Statut |
|---|---|---|---|---|---|
| admin, market_operator | oui (drill depuis Pilotage) | `GET /api/admin/action-center` (lecture) | `router.use(authenticate, rejectBrowserAuthority)` puis actions `requireRole(['admin','market_operator'])` sur acknowledge/snooze/resolve (lignes 152-186) | — | à vérifier : le doc dit « pas de sélecteur marché » et « central/global », mais le code autorise `market_operator` à faire des actions (acknowledge/snooze/resolve) sans aucune notion de marché — cohérent avec « pas de dimension marché sur `signals` » mais surprenant que `market_operator` (rôle vertical pays) ait ce droit global identique à `admin`. **Pas un bug** au sens strict (aucune fuite cross-market puisqu'il n'y a pas de marché), mais un écart doctrine/produit à faire trancher : un `market_operator` peut acquitter un signal qui concerne un autre marché que le sien |
| toute route de génération/hard-delete | — | `router.use(requireRole(['admin']), requireDecisionSignalGlobalAuthority)` (ligne 197) | admin + grant explicite | global | ALREADY_PROVEN — bien câblé, conforme au contrat |

Classement de l'écart `market_operator` ci-dessus : **AUDIT_GAP** (pas de test qui isole ce
comportement, pas de décision produit explicite tranchée dans le contrat) plutôt que
`CROSS_MARKET_BUG` — car Action Center est délibérément hors dimension marché à ce stade.

## 10. Client Index / Client 360 / Order 360 / Product 360

| Surface | Rôle | Endpoint | Guard | Scope | Statut |
|---|---|---|---|---|---|
| Client Index | admin | `GET /clients` (global) | `authenticate, requireAdmin, rejectClientMarketIdentity, requireDashboardGlobalAuthority` | global explicite | ALREADY_PROVEN — bien câblé (contrairement à `/unified` legacy) |
| Client Index | admin | `GET /clients/market/:code` | `requireAdmin` + `requireClientIndexMarketRead` (market scope ou grant global) | market | ALREADY_PROVEN |
| Client Index | market_operator | — | route montée `requireAdmin` uniquement — **market_operator n'a pas accès à Client Index**, contrairement à Commerce/Pilotage | — | conforme au contrat `CLIENT_INDEX_4I.md` (silencieux sur ce rôle, mais code = admin only) — à confirmer que c'est voulu, la doctrine générale classe pourtant Client Index comme destination de Commerce, accessible à `market_operator` ailleurs |
| Client 360 | admin | `resolveClient` | `hasDashboardGlobalAuthority` OU `operator_market_scopes` non vide ; sinon 403 `client_market_scope_required` | mode auto (global/market) | ALREADY_PROVEN — fail-closed correct, y compris pour un `admin` sans aucun scope ni grant |
| Order 360 / Product 360 | admin | — | `requireAdmin` + market scope conditionnel (`hasDashboardGlobalAuthority`) | mode auto | ALREADY_PROVEN (tests dédiés existants), non re-vérifié ligne à ligne dans cette passe — même pattern que Client 360 |

## 11. Marché — capability registry (market-delegation-team / catalog / cash-control)

Ces trois routeurs n'utilisent **aucun** `requireRole` — l'autorisation est 100%
capability-based via `services/market-delegation-service.js::resolveAuthorization` :

```
marketCode → assignment ACTIVE (market_operating_assignments)
           → membership active de l'utilisateur (assignment_memberships)
           → capability requise ∈ membership_capabilities ?
           → capability toujours ∈ assignment_capability_ceiling (non revoked) ?
```

- Fail-closed à chaque étage : pas de membership → 403 `MARKET_MEMBERSHIP_REQUIRED` ;
  capability absente → 403 `MARKET_CAPABILITY_REQUIRED` ; capability hors ceiling → 403
  `MARKET_CAPABILITY_OUTSIDE_CEILING`.
- `rejectMarketId()` refuse explicitement tout `market_id`/`marketId` envoyé dans le body.
- Conforme point 6 de la doctrine (« une mutation spécialisée doit être autorisée par la
  capability exacte requise ») — c'est le seul mécanisme de tout le repo qui matérialise
  vraiment ce point-là, plutôt que de simuler via un rôle.

Statut : **ALREADY_PROVEN** dans sa conception. Non re-testé ligne à ligne pour chaque
capability individuelle dans cette passe (nécessiterait Postgres — voir §12).

## 12. Tests négatifs demandés — état réel

| Test négatif demandé | État |
|---|---|
| market_operator A ne lit pas market B | **Prouvé statiquement + par tests** pour Pilotage/Commerce/Opérations/Finance market-scoped (isolation CM/CG dans `admin-dashboard-market.test.js` et équivalents workspace) |
| market_operator A ne mute pas market B | **Prouvé** pour Pricing Workspace (`requireMarketPricingAccess`) et market-delegation (ceiling par assignment). **Vérifié dans cette passe pour Operations/Shipping-Customs/Accounting** : dans les trois fichiers, le guard `requireWorkspaceMarketAccess` (même fonction, même `requireMarketScope` fail-closed que celui déjà prouvé par le test GET CM/CG) est monté soit au niveau `router.use('/market/:marketCode', ...)` (Shipping-Customs, Finance-Accounting — s'applique donc mécaniquement à toutes les routes POST de mutation en plus du GET), soit répété explicitement sur chaque route POST avec la même fonction (Operations, ex. `mark-ordered`, `distribution/run`). Aucune route de mutation ne contourne ce guard dans les trois fichiers — vérifié par lecture exhaustive des déclarations `router.post` de chacun. La preuve GET CM/CG existante généralise donc structurellement aux mutations, sans qu'un test POST CM/CG séparé soit strictement nécessaire pour établir la garantie (il resterait utile comme filet anti-régression si quelqu'un retire le guard d'une route future) |
| `market_id` injecté ne change jamais l'autorité | **Prouvé** : `rejectClientMarketId`/`rejectClientMarketIdentity`/`rejectMarketId` présents et testés sur Dashboard, Client Index, Pricing (`rejectBrowserAuthority`), market-delegation |
| rôle sans capability spécialisée ne peut pas muter | **Prouvé** pour market-delegation (capability + ceiling) et pour Operations (Hub vs Relais actions séparées par rôle) |
| admin global ne perd pas son autorité globale | **Prouvé** sur les routes Canonical (`admin-dashboard-market.js`, Client Index, Client 360) ; **PAS prouvé, et en fait FAUX** sur les 5 routes legacy `admin-dashboard.js` (§0) |
| route market-scoped n'accepte pas silencieusement le global | Prouvé — `requireMarketScope` exige toujours un `targetMarketId` résolu serveur, jamais un mode global implicite |
| route globale ne mélange pas les données market-scoped | Vrai pour Canonical, **faux** pour `/unified` `/control-tower` `/costing` `/logistics` legacy (§0) qui agrègent nativement tous marchés sans jamais filtrer |
| aucun lien visible n'aboutit à un 403 attendu par design | Cas limite trouvé : `sourcing`/`support` voient l'onglet Dashboard (fallback défense-en-profondeur de `navigation.js`) mais `requireCanonicalContextRole` ne les inclut pas — **à vérifier en staging/browser**, pas testable statiquement (dépend du comportement JS au 403) |

## 13. Ce qui est prouvé statiquement (code lu, pas exécuté)

Toute la cartographie des guards ci-dessus (sections 1 à 11), le contenu de
`navigation.js`, la logique de `resolveAuthorization`, `requireMarketScope`,
`requireDashboardGlobalAuthority`.

## 14. Ce qui est prouvé par tests (exécutés dans ce sandbox, sans DB réelle — mocks Jest)

14 suites / 116 tests exécutés dans cette session (§ liste en tête de fichier `git log`
de cette session) — tous verts, sur les routes Dashboard/Pricing/Operations/
Shipping-Customs/Finance/Client Index/Client 360/Order 360/Product 360. Ces tests
utilisent des mocks de `db.query` (pas de Postgres réel) : ils prouvent le câblage des
guards et la forme des réponses, pas le comportement contre un vrai jeu de données
`operator_market_scopes` / `dashboard_global_access_grants` / `market_operating_assignments`.

## 15. Ce qui nécessite PostgreSQL (non vérifiable dans ce sandbox)

- Tout scénario d'intégration avec de vraies lignes `operator_market_scopes`,
  `dashboard_global_access_grants`, `market_operating_assignments`,
  `assignment_memberships`, `membership_capabilities`, `assignment_capability_ceiling`.
- La reproduction en conditions réelles du bug §0 (appeler `/unified` avec un vrai
  compte admin scopé à un seul marché et vérifier qu'il reçoit bien les données des
  autres marchés).
- Toute vérification de cohérence des `capability_registry` / `ceiling_template_capabilities`
  réellement peuplées en DB (le code de `market-delegation-service.js` suppose leur
  existence mais je n'ai pas de Postgres pour vérifier le contenu réel des tables).

## 16. Ce qui nécessite staging / navigateur

- Le comportement UI exact quand `sourcing`/`support` chargent `/admin/pilotage` et que
  `GET /context` renvoie 403 (écran d'erreur ? redirection ? faux vide silencieux ?).
- Le rendu réel du sélecteur de marché (`createMarketControl`) et son interaction avec
  `requireMarket` par surface — non exécutable hors navigateur.
- Toute vérification visuelle que la navigation ne montre jamais un lien qui 403.

## 17. Récapitulatif des classements

| Statut | Nombre de constats |
|---|---|
| `CROSS_MARKET_BUG` | 1 (majeur) — §0, `/unified` `/control-tower` `/costing` `/logistics` `/cache/clear` legacy |
| `AUDIT_GAP` | 3 — le bug §0 lui-même (aucun test ne l'aurait attrapé), Action Center `market_operator` sans dimension marché (§9), Marchés → gestion utilisateurs admin non retracée (§5) |
| `UI_VISIBILITY_GAP` (à confirmer, pas certain) | 1 — onglet Dashboard visible par `sourcing`/`support` alors que `requireCanonicalContextRole` les exclut (§1) |
| `ALREADY_PROVEN` | la majorité des surfaces (Commerce, Pricing, Catalogue, Marchés/market-autonomy, Opérations, Expéditions & Douane, Finance/Comptabilité, Client 360/Order 360/Product 360, market-delegation) |
| `BACKEND_GUARD_GAP` / `CAPABILITY_GAP` / `FALSE_POSITIVE` | aucun trouvé en dehors de §0 dans le périmètre couvert |

## 18. Hors périmètre de cette passe (non audité)

- Sourcing workspace : lecture faite (guard vu), pas de relecture fine des tests
  négatifs par capability interne.
- Settings (`admin-rules.js`, `admin-pricing-matrices.js`) : confirmés admin-only,
  cohérent avec la doctrine (« Paramètres... réservé à l'autorité globale ») — pas de
  scope marché à vérifier ici par construction.
- Le détail fin des `DRILL_ROLE_MAP` par dashboard (Commerce/Opérations/Finance) —
  `docs/admin-nav-capability-map.md` §8 signale un test pré-existant en échec
  (`canonical-dashboard-drills.test.js`, à propos de `FINANCE_SCHEMA.drill` contenant
  `pricing-workspace`). **Vérifié dans cette passe : ce test passe actuellement** (5/5,
  exécuté dans ce sandbox) — soit il a été corrigé depuis la rédaction de la doc, soit la
  doc elle-même est obsolète sur ce point précis. Classé `FALSE_POSITIVE` de la doc, pas
  du code : ne pas répéter cette affirmation sans la revérifier au moment voulu.
