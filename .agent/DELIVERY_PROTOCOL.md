# Livraison — GitHub Direct

## Livraison primaire

Une tâche est livrée lorsque :

- sa branche `agent/t-xxx` est poussée ;
- son dernier commit contient l’état final ;
- les preuves et le handoff sont versionnés ;
- les gates sont enregistrés ;
- une PR brouillon existe lorsque `gh` est disponible.

Le chat ne transporte pas les fichiers. Aucun ZIP de livraison et aucun script PowerShell ne font partie du protocole actif.

## Résultat attendu de l’agent

```text
Tâche     : T-001
Statut    : REVIEW
Branche   : agent/t-001
Commit    : <sha>
PR        : <url ou non créée>
Gates     : PASS/PASS
Résumé    : ...
```

## Coupure

La branche distante suffit pour reprendre. Aucun accès au `/mnt` précédent n’est
nécessaire.

## Merge

L’agent ne merge pas sa propre PR. Le reviewer contrôle la PR, les gates et le diff.
Après merge, `approve` ferme l’état de gouvernance sur `main`.
