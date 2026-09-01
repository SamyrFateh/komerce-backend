# LOT 4S — Costing Cutover Canonical

## Objectif

Retirer `CostingView` du parcours produit normal sans perdre ses besoins légitimes et sans réutiliser ses agrégats historiques non market-scopés.

La doctrine reste :

> Commerce explique ce qui se vend. Finance observe la vérité économique. Pricing simule et décide.

## Destination

- `/admin/costing` → `/admin/finance`
- `/admin/costing?legacy=1` → Legacy 1 pendant la fenêtre de rollback

Les fichiers et endpoints Legacy Costing ne sont pas supprimés dans ce lot.

## Besoins absorbés

### Finance

Déjà absorbés par LOT 4R :

- coût estimé ;
- coût réel ;
- marge estimée ;
- marge variable réelle ;
- marge consolidée ;
- qualité / complétude du costing ;
- variance estimé vs réel par commande ;
- coût réel par famille ;
- trajectoire financière.

LOT 4S ajoute :

- rentabilité par relais.

### Commerce

LOT 4S ajoute :

- rentabilité par produit.

### Pricing

Le Pricing Workspace conserve les besoins de décision :

- simulation ;
- coût cible / prix conseillé ;
- prix plancher ;
- stratégie concurrentielle ;
- recalibrage.

## Règle de marge réelle

Les anciennes routes Costing utilisaient des heuristiques historiques pour décider si une marge réelle pouvait être affichée.

Canonical n’en reprend aucune.

Une marge réelle / consolidée n’est affichée que pour les commandes dont le costing est `actual`, c’est-à-dire :

1. une imputation existe ;
2. tous les types de coûts réels attendus sont présents ;
3. les allocations utilisées sont `is_actual = TRUE`.

Les commandes `estimated`, `partial_real` ou `incomplete` peuvent contribuer au CA et aux métriques estimées, mais jamais à une marge présentée comme réelle.

## MarketScope

Toutes les projections nouvelles partent d’un ensemble d’`orders` filtré avec le `market_id` injecté par le serveur.

- aucun `market_id` navigateur ;
- aucune inférence depuis l’île ou le relais ;
- les coûts réels sont reliés aux commandes déjà scopées ;
- une vue globale reste réservée à l’autorité dashboard globale explicite.

## Pourquoi les endpoints Legacy ne sont pas réutilisés

`/api/admin/costing/products` et `/api/admin/costing/relais` ont été conçus avant la doctrine MarketScope Canonical. Certains sous-calculs historiques agrègent les coûts réels sans garantir la même frontière de période/marché que la population principale.

LOT 4S ne corrige pas ces endpoints pour les transformer en seconde API Canonical. Les besoins sont projetés directement dans les services Commerce et Finance existants, à partir de leurs filtres serveur autoritatifs.

## Frontend

Commerce expose `commerce.product-profitability` :

- produit ;
- catégorie ;
- commandes ;
- CA ;
- marge estimée ;
- marge réelle ;
- couverture du costing complet.

Finance expose `finance.relay-profitability` :

- relais ;
- commandes ;
- CA ;
- marge estimée ;
- marge réelle ;
- couverture du costing complet.

Une valeur réelle non prouvée est affichée `—`, jamais `0`.

## Preuves avant merge

- les requêtes Produit et Relais contiennent le scope marché serveur ;
- aucun identifiant marché interne ne ressort dans le payload ;
- `actual_orders = 0` implique une marge réelle `null` ;
- le frontend rend `null` en `—` ;
- Canonical n’appelle aucun `/api/admin/costing/**` ;
- `/admin/costing` redirige vers Finance ;
- `/admin/costing?legacy=1` sert Legacy 1 ;
- Backend, Dashboard Canonical et Feature-First gates restent verts.

## Hors périmètre

LOT 4S ne coupe pas :

- `/admin/economic` ;
- `/admin/pilotage-fin` ;
- `/admin/sales` ;
- `/admin/sante`.

Ces vues nécessitent encore un audit de couverture distinct.
