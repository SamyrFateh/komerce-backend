# Admin Canonical

Ce répertoire est la seule cible de nouveau développement pour l'admin Komerce.

## Frontière

- `../admin-legacy/**` : Legacy 0, deprecated.
- `../admin/**` : Legacy 1, rollback et capacités non encore reconstruites uniquement.
- `./**` : génération Canonical, runtime courant des quatre dashboards.

Le code Canonical ne doit importer ni référencer du JavaScript, du CSS ou des vues des deux générations legacy.

Les anciennes vues restent des témoins fonctionnels : leurs besoins légitimes sont réexprimés à partir des API, agrégateurs et services canoniques.

## LOT 2-CUTOVER — routes stables

Les quatre dashboards prouvés sont désormais servis par les URLs admin stables :

- `/admin` et `/admin/pilotage` → Pilotage Canonical ;
- `/admin/commerce` → Commerce Canonical ;
- `/admin/operations` → Opérations Canonical ;
- `/admin/finance` → Finance Canonical ;
- `/admin/demo` → cockpit commande staging.

Les aliases `/admin-next/**` et `/admin/pilotage-v2` restent disponibles pendant la fenêtre de cutover.

Le cutover est **additif** : les anciennes capacités qui n'ont pas encore d'équivalent Workspace / Entity 360 / Action Center continuent d'être servies par Legacy 1 sur leurs URLs historiques. Elles ne sont ni supprimées ni masquées.

Pilotage est la seule URL qui entrait directement en collision avec Legacy 1. Son rollback immédiat est donc :

`/admin/pilotage?legacy=1`

Le serveur conserve le pathname `/admin/pilotage`, ce qui permet au routeur SPA Legacy 1 de retrouver exactement `PilotageView` sans modifier son code.

Contrat de cutover : `docs/contract/DASHBOARD_CUTOVER_2.md`.

## Primitives V1 — LOT 2A-CANON

La liste est volontairement fermée :

- `UIState`
- `FilterBar`
- `Section`
- `MetricStrip/KPI`
- `AlertPanel`
- `DataTable`
- `ChartPanel`

Elles vivent dans `js/primitives.js` et restent purement présentationnelles : aucune API, aucun calcul métier, aucun store métier parallèle. `ChartPanel` fournit seulement un slot de rendu ; le choix d'un moteur graphique relève du caller et des besoins réels.

## DashboardSchema V1 — LOT 2B-CANON

Le contrat est figé dans `js/dashboard-schema.js`. Un dashboard peut déclarer uniquement :

- `id`, `title`, `description` ;
- `filters` : des descripteurs de filtres présentationnels ;
- `metrics` : une `source` canonique + une liste `pick` de métriques ;
- `alerts` : une `source` canonique ;
- `sections` : uniquement `type: "chart"` ou `type: "table"`, avec `source` obligatoire ;
- `drill` : des destinations explicites `{ id, label, href }`.

Les fonctions sont interdites dans le schema. Les types de sections sont fermés. Les blocs data-bound déclarent toujours une source au format `domaine.nom`.

Le schema choisit, ordonne et présente ; il ne calcule aucune vérité métier.

## Renderer V1 — LOT 2B-CANON

`js/dashboard-renderer.js` est volontairement synchrone et sans accès réseau. Il reçoit :

1. un `DashboardSchema` valide ;
2. `context.data`, dictionnaire de données déjà résolues indexé par `source` ;
3. éventuellement `filters`, `onFilterChange` et `renderChart`.

Le renderer ne contient ni `fetch`, ni endpoint API, ni moteur graphique. Il délègue le DOM aux primitives V1 et rend les zones dans l'ordre canonique :

`FilterBar → MetricStrip → AlertPanel → Sections → Drill`.

## AdminContext + MarketScope — prérequis LOT 2C-CANON

`js/admin-context.js` formalise la projection UI d'une autorité déjà résolue par le serveur. Il ne lit ni query string, ni stockage local, ni endpoint et ne déduit jamais un scope depuis le rôle.

- `mode: global` : Komerce central peut agréger tous les marchés ou sélectionner une vue pays ;
- `mode: market` : un partenaire reste enfermé dans les marchés fournis par le serveur ;
- `allowedMarkets` : ensemble de navigation autorisé, jamais une liste fabriquée par le client ;
- `capabilities` : adaptation fonctionnelle de l'interface, jamais remplacement de l'autorisation backend.

Chaque source market-scoped applique `requireMarketScope` côté serveur avant agrégation. Le filtre pays du `DashboardSchema` n'est qu'un contrôle de présentation.

Contrat complet : `docs/contract/DASHBOARD_MARKET_SCOPE_2C.md`.