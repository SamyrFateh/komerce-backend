# Admin Canonical

Ce répertoire est la seule cible de nouveau développement pour l'admin Komerce.

## Frontière

- `../admin-legacy/**` : Legacy 0, deprecated.
- `../admin/**` : Legacy 1, runtime historique encore servi, maintenance corrective uniquement.
- `./**` : génération canonical.

Le code canonical ne doit importer ni référencer du JavaScript, du CSS ou des vues des deux générations legacy.

Les anciennes vues restent des témoins fonctionnels : leurs besoins légitimes sont réexprimés à partir des API, agrégateurs et services canoniques.

Route de construction : `/admin-next`.

Les routes `/admin/*` ne basculent vers ce runtime qu'après preuve explicite de remplacement.

## Primitives V1 — LOT 2A-CANON

La liste est volontairement fermée :

- `UIState`
- `FilterBar`
- `Section`
- `MetricStrip`
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

Le futur LOT 2C-CANON devra donc assembler les sources de Pilotage avant d'appeler le renderer ; il ne devra pas créer un shell ou un renderer parallèle.
