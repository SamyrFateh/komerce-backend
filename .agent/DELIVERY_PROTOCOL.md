# Livraison — branche durable par lane

## Livraison primaire

Une lane est livrée lorsque :

- sa branche durable `agent/<lane-slug>` contient toutes ses tâches terminées ;
- chaque tâche possède ses commits, worklogs, preuves et gates ;
- le handoff global de lane est versionné ;
- une seule PR couvre le sujet complet.

Le chat ne transporte pas les fichiers. Aucun ZIP de livraison et aucun script
PowerShell ne font partie du protocole actif.

## Tâches intermédiaires

Une tâche dont les gates passent est marquée `DONE` dans la branche de lane. Elle ne
crée ni nouvelle branche ni PR individuelle. La tâche suivante de la même lane reprend
immédiatement les fichiers existants.

## Résultat attendu en fin de lane

```text
Tâche     : T-006
Statut    : REVIEW
Branche   : agent/lane-mobile-renderer
Commit    : <sha>
PR        : <url ou non créée>
Gates     : PASS/PASS
Résumé    : lane mobile renderer complète
```

## Coupure

La branche distante de lane suffit pour reprendre. Aucun accès au container ou à la
conversation précédente n’est nécessaire.

## Merge

La revue porte sur le diff complet de la lane. Après validation humaine, la PR unique
est mergée dans `main`.
