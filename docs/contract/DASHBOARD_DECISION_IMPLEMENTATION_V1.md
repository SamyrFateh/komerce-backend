# Dashboard Decision Visual V1 — Implémentation

> Statut : **LOT V1.1 — fondation + Pilotage**  
> Référence produit : `docs/doctrine/DASHBOARD_DECISION_VISUAL_DOCTRINE_V1.md` (PR documentaire #1341)  
> Principe : **un coup d’œil → comprendre l’état → voir le problème → décider → entrer dans le détail**.

## Périmètre de ce lot

Ce lot ne cherche pas à fabriquer immédiatement toutes les informations visibles dans les mocks. Il met en place le langage visuel partagé et migre `Pilotage` uniquement avec des données déjà prouvées par son payload serveur.

### Primitives livrées

- `DecisionStrip`
- `SummaryCards`
- `FlowStrip`
- `ProgressCards`
- `Funnel`
- `RankedList`
- `PriorityList`
- `InfoList`
- `TrustFooter`

Ces primitives sont **présentation-only** : aucun fetch, aucun accès DB, aucun recompute de vérité métier.

## Pilotage — matrice de preuve

| Bloc visuel | Information | Source serveur | Scope | Représentation | CTA | Statut |
|---|---|---|---|---|---|---|
| Bandeau décision | Critiques ouvertes | `kpis_global.alertes_critiques` | global / market serveur | `DecisionStrip` | ancre alertes | `PROVEN` |
| Bandeau décision | Points d’attention | `system_alerts` niveau warning | global / market serveur | `DecisionStrip` | ancre alertes | `PROJECTABLE` |
| Bandeau décision | Problèmes costing | KPI incomplet présent dans `view_blocks[].kpis_summary` | global / market serveur | `DecisionStrip` | aucun si destination non prouvée | `PROJECTABLE` |
| Bandeau décision | Décisions aujourd’hui | aucune source dédiée actuelle | — | — | — | `BACKEND_GAP` |
| KPI | CA encaissé | `kpis_global.ca_encaisse` | global / market serveur | `MetricStrip` | — | `PROVEN` |
| KPI | Commandes actives | `kpis_global.cmds_actives` | global / market serveur | `MetricStrip` | — | `PROVEN` |
| KPI | Marge consolidée | `kpis_global.marge_consolidee` | global / market serveur | `MetricStrip` | — | `PROVEN` |
| KPI | Alertes critiques | `kpis_global.alertes_critiques` | global / market serveur | `MetricStrip` | — | `PROVEN` |
| KPI | Complétude coûts | `kpis_global.taux_completude_couts` | global / market serveur | `MetricStrip` | — | `PROVEN` |
| Vues | Blocs de décision | `view_blocks` | global / market serveur | `SummaryCards` | différé si route non canonique | `PROJECTABLE` |
| Boucle | chaîne économique | `economic_flow.stages` | global / market serveur | `FlowStrip` | différé si route non canonique | `PROVEN` |
| Alertes | signaux transverses | `system_alerts` | global / market serveur | `AlertPanel` | destination existante projetée par Pilotage | `PROVEN` |
| Principes | principes non négociables | `principles` | identique payload | `InfoList` | — | `PROVEN` |
| Confiance | fraîcheur / warnings / scope | `data_quality` + `scope` | serveur | `TrustFooter` | — | `PROVEN` |

## Garde-fous

- le payload market-scoped reste choisi par `AdminContext` et l’endpoint serveur existant ;
- aucun `market_id` n’est fabriqué côté navigateur ;
- le nouveau rendu réutilise le fetch et les projections canoniques de `pilotage.js` ;
- aucun chiffre illustratif des mocks n’est codé ;
- un bloc dont la donnée n’existe pas reste un gap explicite au lieu d’être simulé ;
- `dashboard-schema.js` et le renderer V1 restent inchangés dans ce lot afin de préserver les écrans non migrés.

## Suites prévues

1. Commerce — funnel, pertes, classement, alertes, arbitrages.
2. Opérations overview — summary workspaces, signaux, friction, priorités.
3. Finance — trajectoire, coûts incomplets, rapprochement, alertes.
4. Workspaces Hub/Relais, Expéditions & Douane, Sourcing.
5. Catalogue pays, Commandes, Marchés.
6. Atelier économique : réutiliser les primitives là où elles améliorent le cockpit sans casser sa doctrine économique spécialisée.

Chaque migration doit compléter sa propre matrice `bloc → source → scope → représentation → CTA → statut` avant d’exposer une information nouvelle.
