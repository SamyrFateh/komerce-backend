# START HERE — Chantier PDP intégré

Ce fichier est la première source à lire avant toute commande, toute analyse de tâche ou toute modification.

## 1. Source de vérité distante

La branche d’exécution unique du chantier est :

```text
agent/lane-mobile-renderer
```

La ref autoritative est :

```text
origin/agent/lane-mobile-renderer
```

`main` est volontairement en retard jusqu’à la PR finale. Il est interdit d’utiliser les fichiers `.agent/state/**`, `.agent/STATUS.md`, `.agent/TASK-INDEX.json` ou le code de `main` pour déterminer l’avancement courant.

Les labels `LANE-META`, `LANE-DESKTOP-VISUAL`, etc. sont uniquement des classifications de sujet. Ils ne créent pas de branches séparées dans cette exécution intégrée.

## 2. Préflight obligatoire

Avant de lire les states locaux :

```bash
git fetch origin --prune
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/agent/lane-mobile-renderer
```

Si le worktree est propre :

```bash
git switch agent/lane-mobile-renderer
git pull --ff-only origin agent/lane-mobile-renderer
```

Si la branche locale n’existe pas :

```bash
git switch --track -c agent/lane-mobile-renderer origin/agent/lane-mobile-renderer
```

Si le worktree n’est pas propre, ne pas changer de branche, ne pas reset, ne rien supprimer : afficher les modifications et s’arrêter.

## 3. Ordre de lecture obligatoire

Après synchronisation sur la branche durable, lire dans cet ordre :

1. `.agent/START-HERE.md`
2. `.agent/MANIFEST.json`
3. `.agent/CHECKPOINT-PROTOCOL.md`
4. `.agent/EXECUTION_MAP.md`
5. `.agent/lanes/LANE-MOBILE-RENDERER.json`
6. `.agent/STATUS.md`
7. le ou les fichiers `.agent/state/T-XXX.json` cités par la lane
8. les tâches, worklogs, arbitrages et preuves correspondants

`.agent/TASK-INDEX.json` est un catalogue statique. Ses compteurs et son ordre initial ne sont jamais une preuve d’avancement.

## 4. État opérationnel courant

- `T-001` à `T-016` : terminées.
- `T-017` et `T-018` : en revue.
- `T-023` : travail fonctionnel terminé ; reprendre maintenant la génération des deux captures EMPTY/FILLED avec le Chromium local, puis passer en revue.
- prochaine nouvelle implémentation après ce déblocage : `T-019`.

Ne jamais recommencer une tâche marquée `DONE` ou `REVIEW` sur la ref autoritative.

## 5. Garde-fou runtime

Les commandes suivantes de `scripts/agent.mjs` sont temporairement interdites dans cette exécution intégrée :

```text
start
resume
finish
```

Ce runtime legacy sélectionne encore une branche depuis `parallel_lane` et peut relire les states de `main`. Il ne doit pas être utilisé pour choisir, reprendre ou clôturer une tâche tant qu’il n’a pas été refactorisé pour respecter `MANIFEST.execution_branch`.

Après le préflight, les changements de state sont faits explicitement dans les fichiers autoritatifs, puis sauvegardés par le protocole de checkpoint distant.

## 6. Checkpoint distant obligatoire

Un checkpoint signifie obligatoirement :

```text
petit lot cohérent → commit atomique → push immédiat → SHA distant confirmé
```

Utiliser pour chaque lot :

```bash
node scripts/agent-checkpoint.mjs \
  --message "type(t-xxx): résultat atomique" \
  -- chemin/du/fichier-1 chemin/du/fichier-2
```

Le lot suivant ne commence qu’après :

```text
CHECKPOINT_DISTANT=<sha>
```

Il est interdit :

- d’accumuler plusieurs commits locaux avant un push groupé ;
- de commencer un second lot avec un commit local non confirmé sur `origin` ;
- de répondre à l’utilisateur avant d’avoir poussé le travail courant ;
- de lancer une commande longue ou risquée sans checkpoint distant préalable.

Au premier `non-fast-forward` ou écart local/distant : arrêter immédiatement. Aucun merge, rebase, cherry-pick, reset, stash ou force-push automatique. Appliquer `.agent/CHECKPOINT-PROTOCOL.md`.

## 7. Livraison

- checkpoints distants petits et fréquents sur `agent/lane-mobile-renderer` ;
- aucun checkpoint sur `main` ;
- aucune branche par tâche ou par label de lane ;
- aucune preuve visuelle fabriquée ;
- une seule PR finale vers `main`.
