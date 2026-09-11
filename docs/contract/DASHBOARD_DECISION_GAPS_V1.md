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

## Hub / Relais

| Information cible | Statut | Motif |
|---|---|---|
| Collectes en retard | `BACKEND_GAP` | la file `relay.to_collect` indique les colis disponibles à remettre, mais aucun SLA / seuil de retard canonique n'est fourni |
| Hubs en tension | `BACKEND_GAP` | les tailles de files existent, mais aucune capacité nominale ni seuil de tension n'est défini |
| Relais à approvisionner | `BACKEND_GAP` | le payload ne fournit pas de seuil de stock / besoin de réapprovisionnement par relais |
| Cash à sécuriser | `BACKEND_GAP` | `relay.cash_pending` expose les paiements cash à encaisser, pas un indicateur canonique de risque ou d'exposition cash |
| Cash à encaisser | `PROVEN` | résumé serveur `relay_cash_pending` + file `relay.cash_pending` |
| Commandes à lancer | `PROVEN` | résumé serveur `hub_to_order` + file `hub.to_order` |
| Commandes à répartir | `PROVEN` | résumé serveur `hub_unassigned` + `distribution.unassigned` |
| Colis à expédier | `PROVEN` | résumé serveur `hub_to_ship` + file `hub.to_ship` |
| Colis à réceptionner | `PROVEN` | résumé serveur `relay_to_receive` + file `relay.to_receive` |
| Colis disponibles relais / à remettre | `PROVEN` | résumé serveur `relay_to_collect` + file `relay.to_collect` |
| Inventaire à affecter | `PROVEN` | résumé serveur `inventory_to_assign` + `inventory.items` |
| Taux de collecte | `BACKEND_GAP` | aucune base de calcul / période de référence n'est fournie par ce Workspace |
| Commandes prêtes | `BACKEND_GAP` | les files décrivent des actions précises, pas une notion générique « prête » |
| Relais actifs | `BACKEND_GAP` | aucune collection / métrique de relais actifs dans le payload Workspace |
| Incidents terrain | `BACKEND_GAP` | aucune collection d'incidents dédiée dans le payload Workspace |
| Cartes Hub / Relais / Inventaire | `PROJECTABLE` | regroupement visuel des compteurs serveur, sans agrégat métier ni scoring supplémentaire |
| Decision strip | `PROJECTABLE` | sélection des files non vides dans l'ordre serveur/UI existant ; aucun score de priorité n'est calculé |
| Actions terrain | `PROVEN` | mutations existantes réutilisent les autorités métier : state machine commande, distribution, scan engine, paiement et inventaire |
| Scope / qualité | `PROVEN` | `data_quality.scope_enforced`, `scope_mode=market` et `action_context=single_market_only` |

## Expéditions & Douane

| Information cible | Statut | Motif |
|---|---|---|
| Colis bloqués | `BACKEND_GAP` | le Workspace expose les statuts `shipped` / `in_transit`, mais aucun signal canonique de blocage |
| Dossiers douane à traiter | `PROJECTABLE` | `customs_pending` et `customs_candidates` décrivent des files d'action distinctes ; aucune priorité supplémentaire n'est calculée |
| Transit au-delà du seuil | `BACKEND_GAP` | `shipped_at` existe sur les colis, mais aucun SLA / seuil canonique n'est fourni |
| Documents expirants | `BACKEND_GAP` | aucun contrat documentaire / date d'expiration dans le payload Workspace |
| Colis à mettre en transit | `PROVEN` | résumé `transit_ready` + `transit.ready`, limité aux colis `shipped` |
| Colis en transit | `PROVEN` | résumé `transit_active` + `transit.in_transit` |
| Colis à rattacher douane | `PROVEN` | résumé `customs_candidates` + `customs.candidates`, colis sans expédition douane active |
| Douane à déclarer | `PROVEN` | résumé `customs_pending`, expéditions actives au statut `pending` |
| Douane déclarée | `PROVEN` | résumé `customs_declared`, expéditions actives au statut `declared` |
| Expéditions en cours | `BACKEND_GAP` | aucune métrique canonique unique ne fusionne transit et dossiers douane sans changer la sémantique |
| Dossiers douane ouverts | `BACKEND_GAP` | le contrat distingue `pending`, `declared`, actif/inactif ; pas de statut canonique générique « ouvert » |
| Délai moyen | `BACKEND_GAP` | dates présentes, mais aucun délai agrégé canonique fourni par le serveur |
| Coûts logistiques | `PROVEN` au niveau dossier | `customs.shipments` expose `freight_kmf`, `customs_paid_kmf` et `cif_value_kmf`, sans agrégat decision-first inventé |
| Taux conformité documents | `BACKEND_GAP` | aucune mesure de conformité documentaire dans le contrat Workspace |
| Flux international Transit / Douane | `PROJECTABLE` | regroupement visuel des compteurs serveur sans faire croire à un funnel de cohorte |
| Arrivées à venir | `BACKEND_GAP` | aucune ETA / date d'arrivée prévue fournie |
| Cas douane prioritaires | `BACKEND_GAP` | aucune sévérité ni règle de priorité douane dans le payload |
| Historique transit | `PROVEN` | `transit.history`, événements `transit_confirmed` appliqués |
| Alertes documentaires | `BACKEND_GAP` | aucune collection d'alertes documents |
| Actions transit / douane | `PROVEN` | mutations déléguées au scan engine et au service canonique des expéditions douane |
| Garde de rôles | `PROVEN` | transit exécutable par `admin`, `agent_hub`, `agent_transitaire`; supervision pays sans geste terrain spécialisé |

## Finance

| Information cible | Statut | Motif |
|---|---|---|
| Paiements en attente | `PROVEN` | KPI `paiements_en_attente` |
| Coûts incomplets | `PROVEN` | KPI `cmds_cout_incomplet` + complétude des coûts |
| Variances élevées | `BACKEND_GAP` | `costing_orders.variance_kmf` existe, mais aucun seuil canonique de matérialité / gravité n'est fourni |
| Variances observées | `PROJECTABLE` | sélection pure des commandes dont `variance_kmf` est non nulle, sans qualifier l'écart d'« élevé » |
| Remboursements à suivre | `BACKEND_GAP` | les données actuelles exposent des remboursements finalisés / agrégés, pas un état d'action « à suivre » |
| Remboursements période | `PROVEN` | KPI `remboursements` + `refunds.count` / `refunds.recent` quand présents |
| CA encaissé | `PROVEN` | KPI `ca_encaisse` |
| Coût réel | `PROVEN` | KPI `cout_reel` |
| Marge consolidée | `PROVEN` sous réserve de couverture | KPI `marge_consolidee`; la complétude doit rester visible pour ne pas surinterpréter la marge réelle |
| Complétude des coûts | `PROVEN` | KPI `taux_completude_couts` et data quality du costing |
| Encaissements non rapprochés | `BACKEND_GAP` | aucun état de rapprochement canonique ; `paiements_en_attente` n'est pas un substitut |
| Trajectoire financière | `PROVEN` | collection `trend` |
| Commandes au costing incomplet | `PROJECTABLE` | `costing_orders.cost_status` et couverture disponibles ; aucune action métier n'est inventée |
| Mix de paiement | `PROVEN` | collection `payment_mix` |
| Rentabilité relais | `PROVEN` avec garde de couverture | `relay_profitability`; marge réelle explicitement inconnue lorsque le costing ne permet pas de la calculer |
| Alertes Finance dédiées | `BACKEND_GAP` | aucune collection d'alertes Finance dédiée ; seuls les warnings KPI / data quality peuvent être projetés |
| Workspaces autorisés | `PROVEN` | `FINANCE_SCHEMA.drill` filtré par rôle |
| Fraîcheur / qualité | `PROVEN` quand champs présents | `data_quality` |

## Lots suivants

Les gaps Sourcing, Catalogue pays, Commandes, Marchés et Atelier économique seront remplis avant migration de chaque surface, à partir de leurs payloads réels.
