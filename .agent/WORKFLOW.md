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

## Sélection et reprise de la tâche

La tâche courante vient de :

1. `MANIFEST.current_operational_task` ;
2. `lanes/LANE-MOBILE-RENDERER.json.current_task` et `next_action` ;
3. `EXECUTION_MAP.md` ;
4. le state correspondant ;
5. l’historique Git et les diffs distants lorsque le state semble en retard.

`TASK-INDEX.json` est un catalogue statique et ne sert jamais à choisir une tâche.

Une tâche `DONE` ou `REVIEW` ne doit pas être recommencée. Du code ou des preuves déjà
présents à distance ne doivent pas être recréés parce que le state est resté `READY` ou
`IN_PROGRESS` après une coupure.

## Checkpoints en deux phases

### 1. Travail récupérable

Pousser immédiatement chaque petite unité de :

- code source ;
- test ;
- artefact généré ;
- preuve réelle.

```bash
node scripts/agent-checkpoint.mjs \
  --message "type(t-xxx): résultat atomique" \
  -- chemin/du/fichier-1 chemin/du/fichier-2
```

La commande doit afficher :

```text
CHECKPOINT_DISTANT=<sha_travail>
```

### 2. Métadonnées

Seulement après le push confirmé du travail correspondant :

- mettre à jour state, worklog, audit et STATUS ;
- référencer le SHA de travail déjà distant ;
- créer un checkpoint documentaire séparé ;
- vérifier son SHA distant.

Un agent suivant peut reconstruire les métadonnées depuis les commits. Il ne peut pas
récupérer un fichier resté dans la sandbox précédente.

Règles :

- maximum recommandé de trois fichiers source par lot ;
- un groupe d’artefacts générés par une même commande peut former un lot distinct ;
- aucun deuxième commit local avant le push du premier ;
- aucun state de sortie avant le push du travail ;
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

Le code, les tests et les preuves doivent déjà être poussés. Mettre ensuite à jour state,
worklog, audit et STATUS dans un checkpoint documentaire distant séparé.

## Campagne visuelle

Chromium local doit être détecté avant de déclarer une capture impossible. Ne pas tenter
de téléchargement réseau non autorisé et ne fabriquer aucune preuve.

## Livraison

- une branche durable intégrée ;
- travail récupérable poussé avant son statut ;
- checkpoints distants petits et fréquents ;
- aucune PR intermédiaire ;
- une seule PR finale vers `main`.