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

## Commerce

| Information cible | Statut | Motif |
|---|---|---|
| Ruptures sur best-sellers | `BACKEND_GAP` | le payload Commerce ne fournit pas de signal de stock / disponibilité |
| Prix à recalibrer | `BACKEND_GAP` | aucune recommandation pricing dans le payload Commerce |
| Conversions sous cible | `BACKEND_GAP` | aucun KPI de conversion ni cible commerciale canonique |
| Décisions commerciales aujourd'hui | `BACKEND_GAP` | aucune projection canonique d'actions prioritaires |
| CA encaissé | `PROVEN` | KPI `ca_encaisse` |
| Panier moyen | `PROVEN` | KPI `panier_moyen` |
| Taux de conversion | `BACKEND_GAP` | absent du contrat Commerce actuel |
| Commandes perdues | `PROVEN` | `funnel.lost`, valeur serveur projetée sans recalcul |
| Produits actifs vendus | `BACKEND_GAP` | `top_products` est un classement, pas un décompte exhaustif des produits vendus |
| Catégories classées | `PROVEN` | `categories`, ordre fourni par le backend |
| Top produits | `PROVEN` | `top_products`, ordre fourni par le backend |
| Produits en croissance | `BACKEND_GAP` | aucune série / variation produit prouvée dans le payload |
| Canaux de vente | `BACKEND_GAP` | aucune ventilation par canal |
| Funnel commercial | `PROVEN` | `funnel.steps` avec comptes et pourcentages serveur |
| Arbitrage rentabilité produit | `PROJECTABLE` | `product_profitability` expose couverture des coûts et marge réelle ; aucune recommandation métier n'est inventée |
| Alertes commerciales dédiées | `BACKEND_GAP` | pas de collection d'alertes Commerce dédiée |
| Priorités commerciales | `BACKEND_GAP` | pas de source canonique de priorisation |
| Fraîcheur / qualité | `PROVEN` quand champs présents | `data_quality` et warnings KPI |

## Opérations overview

| Information cible | Statut | Motif |
|---|---|---|
| Incidents critiques | `PROJECTABLE` | comptage pur des `signals` de sévérité `critical` / `urgent` |
| Points d'attention | `PROJECTABLE` | comptage pur des `signals` de sévérité `warning` |
| Cash à sécuriser | `BACKEND_GAP` | `paiements_en_attente` donne un nombre d'éléments, pas une exposition cash fiable |
| Décisions terrain aujourd'hui | `BACKEND_GAP` | aucune projection canonique d'actions prioritaires |
| Commandes prêtes | `BACKEND_GAP` | `cmds_aujourdhui` et `active_orders` ne prouvent pas un état « prêt » |
| Colis en transit | `PROVEN` | KPI `colis_transit` |
| Dossiers douane ouverts | `BACKEND_GAP` | absent du payload overview Operations actuel |
| Relais actifs | `BACKEND_GAP` | `disponibles_relais` mesure des disponibilités, pas le nombre de relais actifs |
| Taux de service réseau | `BACKEND_GAP` | `taux_collecte_relais` et `taux_completude_scans` sont des KPI distincts |
| Cartes workspaces / flux | `PROJECTABLE` | regroupement de KPI existants sans calcul métier |
| Qualité d'exécution réseau | `PROVEN` | `taux_completude_scans` et `taux_collecte_relais` |
| Signaux opérationnels | `PROVEN` | collection `signals` |
| File d'exécution | `PROVEN` | `active_orders`, ordre serveur conservé |
| Frictions / retards critiques | `PROVEN` | `critical_delays` et KPI `retards_critiques` |
| Workspaces autorisés | `PROVEN` | `OPERATIONS_SCHEMA.drill` filtré par les rôles existants |
| Priorités terrain | `BACKEND_GAP` | aucune source canonique de priorisation ; l'UI conserve seulement l'ordre backend existant |
| Fraîcheur / qualité | `PROVEN` quand champs présents | `data_quality` |

## Lots suivants

Les gaps Finance, Hub/Relais, Expéditions & Douane, Sourcing, Catalogue pays, Commandes, Marchés et Atelier économique seront remplis avant migration de chaque surface, à partir de leurs payloads réels.
