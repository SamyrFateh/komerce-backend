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

Elles vivent dans `js/primitives.js` et restent purement présentationnelles : aucune API, aucun calcul métier, aucun store métier parallèle. `ChartPanel` fournit seulement un slot de rendu ; le choix d'un moteur graphique relève du renderer et des besoins réels.

`DashboardSchema` et le renderer minimal appartiennent au LOT 2B-CANON et ne sont pas anticipés ici.
