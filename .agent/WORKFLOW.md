# Workflow GitHub — branche durable intégrée

## Référence obligatoire

Lire `.agent/START-HERE.md` puis `.agent/CHECKPOINT-PROTOCOL.md` en premier.

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

## Petit lot et sauvegarde distante

Un petit lot ne se termine pas au commit local. Il se termine uniquement lorsque le push
est confirmé sur la branche distante.

Pour chaque unité cohérente :

```bash
node scripts/agent-checkpoint.mjs \
  --message "type(t-xxx): résultat atomique" \
  -- chemin/du/fichier-1 chemin/du/fichier-2
```

La commande doit afficher :

```text
CHECKPOINT_DISTANT=<sha>
```

Le lot suivant ne commence qu’après cette confirmation.

Règles :

- maximum recommandé de trois fichiers source par lot ;
- un groupe d’artefacts générés par une même commande peut former un lot distinct ;
- aucun deuxième commit local avant le push du premier ;
- checkpoint distant avant tests longs, captures, builds risqués, arbitrage et réponse finale ;
- aucun `--no-verify` sauf dérogation reviewer explicitement documentée.

## Rejet de push ou divergence

Au premier écart entre `HEAD` et `origin/agent/lane-mobile-renderer`, ou au premier rejet
`non-fast-forward` :

1. arrêter les modifications ;
2. conserver les commits et fichiers locaux ;
3. ne pas merge, rebase, cherry-pick, reset, stash ou force-push automatiquement ;
4. afficher les SHA local/distant, les dix derniers commits et la divergence ;
5. demander une réconciliation explicite.

## Runtime

Les commandes `start`, `resume` et `finish` de `scripts/agent.mjs` sont interdites dans le
mode intégré. `scripts/agent-checkpoint.mjs` est la commande autorisée pour sauvegarder un
lot.

Aucun helper ne doit dériver une branche depuis `parallel_lane`.

## Fin de tâche

Respecter la règle de sortie du fichier `.agent/tasks/T-XXX.md` : généralement
`IN_PROGRESS → REVIEW`, jamais directement `DONE` sans décision reviewer documentée.

Mettre à jour state, worklog, audit et STATUS dans un checkpoint documentaire distant.

## Campagne visuelle

Chromium local doit être détecté avant de déclarer une capture impossible. Ne pas tenter
de téléchargement réseau non autorisé et ne fabriquer aucune preuve.

## Livraison

- une branche durable intégrée ;
- checkpoints distants petits et fréquents ;
- aucune PR intermédiaire ;
- une seule PR finale vers `main`.
