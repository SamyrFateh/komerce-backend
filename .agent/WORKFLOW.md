# Workflow GitHub — branche durable intégrée

## Référence obligatoire

Lire `.agent/START-HERE.md` en premier.

Toutes les tâches restantes du chantier s’exécutent sur :

```text
agent/lane-mobile-renderer
```

Les labels de lane sont des classifications. Ils ne doivent jamais être transformés en
noms de branches. `main` n’est pas une source d’avancement avant la PR finale.

## Démarrage de session

```bash
git fetch origin --prune
git status --short
git switch agent/lane-mobile-renderer
git pull --ff-only origin agent/lane-mobile-renderer
```

En présence de modifications locales, ne pas changer de branche et ne pas effectuer de
reset ou de stash automatique.

Après synchronisation, lire l’ordre obligatoire indiqué dans `START-HERE.md`.

## Sélection de la tâche

La tâche courante vient de :

1. `MANIFEST.current_operational_task` ;
2. `lanes/LANE-MOBILE-RENDERER.json.current_task` et `next_action` ;
3. `EXECUTION_MAP.md` ;
4. le state correspondant.

`TASK-INDEX.json` est un catalogue statique et ne sert jamais à choisir une tâche.

Une tâche `DONE` ou `REVIEW` ne doit pas être recommencée. Une tâche `BLOCKED` dont la
condition environnementale est levée doit être reprise avant de créer une nouvelle
implémentation lorsqu’elle est désignée comme action courante.

## Petit lot

Après chaque unité cohérente :

```bash
git add <fichiers du lot>
git commit -m "message atomique"
git push origin agent/lane-mobile-renderer
```

Les helpers runtime ne peuvent être utilisés qu’après synchronisation et seulement s’ils
respectent explicitement `MANIFEST.execution_branch`. Aucun helper ne doit dériver une
branche depuis `parallel_lane`.

## Fin de tâche

Respecter la règle de sortie du fichier `.agent/tasks/T-XXX.md` : généralement
`IN_PROGRESS → REVIEW`, jamais directement `DONE` sans décision reviewer documentée.

Mettre à jour state, worklog, audit et STATUS dans le même checkpoint documentaire.

## Campagne visuelle

Chromium local doit être détecté avant de déclarer une capture impossible. Ne pas tenter
de téléchargement réseau non autorisé et ne fabriquer aucune preuve.

## Livraison

- une branche durable intégrée ;
- petits commits et pushs réguliers ;
- aucune PR intermédiaire ;
- une seule PR finale vers `main`.
