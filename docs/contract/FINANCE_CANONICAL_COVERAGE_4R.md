# LOT 4R — Finance Canonical · couverture économique et costing

**Statut :** couverture additive avant cutover des témoins économiques Legacy.  
**Date :** 2026-09.

## Mission

Faire de `/admin/finance` la surface d’observation de la vérité financière constatée, sans recopier `EconomicView`, `CostingView` ou `PilotageFinView` et sans consommer le moteur économique global depuis une vue market-scoped.

La séparation reste :

> Finance observe le réel et les écarts. Pricing simule et décide. Comptabilité agit sur le cash.

## Sources autorisées

Finance Canonical consomme uniquement des sources capables de respecter `orders.market_id` :

- `orders` ;
- `refunds` reliés à `orders` ;
- `order_item_cost_imputations` ;
- `order_item_real_cost_allocations` ;
- les métriques partagées de `services/dashboard-metrics/**`.

Les formules de coût et de marge ne sont pas réimplémentées dans le frontend. Les KPI `cout_estime`, `cout_reel`, `marge_estimee`, `marge_variable_reelle` et `marge_consolidee` viennent des autorités de métriques existantes.

## Moteur économique global explicitement exclu

`services/economic-engine-queries.js` travaille aujourd’hui sur des sources globales (`finance_config`, `charges`, `economic_snapshots`). De plus, `buildExecutiveSummary()` appelle `redistribute('executive_view')`, qui peut créer un snapshot.

LOT 4R interdit donc dans Finance Canonical :

- `buildExecutiveSummary()` ;
- `redistribute()` ;
- `getHistory()` sur `economic_snapshots` ;
- `getCharges()` global ;
- `getVariables()` global.

Une vue opérateur pays ne reçoit jamais ces données par simple filtrage navigateur.

## Nouveaux blocs Finance

### Trajectoire financière

Agrégation de la période autorisée :

- commandes payées ;
- CA encaissé ;
- allocations de coût réel ;
- marge consolidée uniquement sur commandes `cost_status = actual` ;
- taux de couverture du coût.

Granularité fermée côté serveur :

- 7 jours → jour ;
- 30 jours → semaine ;
- 90 jours → mois.

Aucune granularité SQL n’est fournie par le navigateur.

### Vérité du costing

Présente côte à côte les KPI déjà canoniques :

- coût estimé ;
- coût réel ;
- marge estimée ;
- marge variable réelle ;
- marge consolidée ;
- complétude / avertissement de donnée.

### Variances récentes

Pour les commandes du périmètre :

- vente ;
- coût estimé ;
- coût réel ;
- variance réel − estimé ;
- `cost_status` ;
- marge réelle uniquement quand le coût est complet.

Le statut est déterminé depuis la présence de l’imputation et les catégories de coût réelles attendues déjà figées dans `dashboard-metrics/_helpers`.

### Coût réel par famille

Agrège uniquement `order_item_real_cost_allocations.is_actual = TRUE`, reliées à des commandes du MarketScope courant.

## Répartition des anciens besoins

| Besoin Legacy | Destination cible |
|---|---|
| coût estimé / réel / variance / qualité | Finance |
| marges estimée / variable / consolidée | Finance |
| trajectoire financière constatée | Finance |
| répartition coût réel | Finance |
| prix conseillé / plancher / simulation | Pricing Workspace |
| stratégie / concurrence | Pricing Workspace |
| composants de coût éditables | Pricing Workspace |
| rapprochement cash / dépôts / factures | Accounting Workspace |
| modèle global `charges` / `finance_config` | à traiter comme variables business globales, pas à injecter dans un marché |

## Condition de cutover Costing

`/admin/costing` ne peut converger qu’après preuve que :

1. ses besoins de lecture légitimes sont présents dans Finance ou Pricing ;
2. ses actions de recalibrage/allocation ont une destination canonique explicite ;
3. aucun besoin n’exige un accès global non autorisé dans une vue marché ;
4. le rollback `?legacy=1` reste disponible pendant la fenêtre de bascule.

LOT 4R ne réalise pas encore ce cutover : il construit la couverture nécessaire.
