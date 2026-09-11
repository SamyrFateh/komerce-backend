# Dashboard Decision Visual V1 — gaps d'implémentation

Cette liste sépare les informations promises par les mocks des données effectivement disponibles. Elle doit diminuer au fil des lots ; elle ne doit jamais être masquée par des valeurs synthétiques.

## Pilotage

| Information cible | Statut | Motif |
|---|---|---|
| Critiques ouvertes | `PROVEN` | KPI `alertes_critiques` + `system_alerts` |
| Points d'attention | `PROJECTABLE` | signaux warning disponibles ; projection pure |
| Problèmes costing | `PROJECTABLE` | KPI d'incomplétude présent dans les blocs économiques selon payload |
| Décisions à prendre aujourd'hui | `BACKEND_GAP` | aucune projection canonique dédiée aujourd'hui |
| KPI principaux | `PROVEN` | `kpis_global` |
| Cartes de vues | `PROVEN` / `PROJECTABLE` | `view_blocks`; destinations à valider avant CTA |
| Boucle économique | `PROVEN` | `economic_flow.stages` |
| Alertes transverses | `PROVEN` | `system_alerts` |
| Principes non négociables | `PROVEN` | `principles` |
| Fraîcheur / qualité | `PROVEN` quand champs présents | `data_quality` |

## Lots suivants

Les gaps Commerce, Opérations, Finance, Hub/Relais, Expéditions & Douane, Sourcing, Catalogue pays, Commandes, Marchés et Atelier économique seront remplis avant migration de chaque surface, à partir de leurs payloads réels.
