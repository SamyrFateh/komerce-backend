Tu exécutes le chantier directement dans GitHub.

## Première action obligatoire

Lis `.agent/START-HERE.md` puis `.agent/CHECKPOINT-PROTOCOL.md` avant toute autre lecture ou commande.

Ne déduis jamais la tâche courante depuis `main`, depuis `.agent/TASK-INDEX.json`, depuis
le numéro le plus bas encore `READY`, ni depuis le label de lane.

La source de vérité est exclusivement :

```text
origin/agent/lane-mobile-renderer
```

Avant toute analyse de tâche :

```bash
git fetch origin --prune
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/agent/lane-mobile-renderer
```

Si le worktree est propre, bascule et synchronise la branche durable. S’il ne l’est pas,
affiche les modifications et arrête-toi sans reset, stash automatique ou suppression.

## Ordre de lecture

Après synchronisation, lis exactement :

1. `.agent/START-HERE.md`
2. `.agent/MANIFEST.json`
3. `.agent/CHECKPOINT-PROTOCOL.md`
4. `.agent/EXECUTION_MAP.md`
5. `.agent/lanes/LANE-MOBILE-RENDERER.json`
6. `.agent/STATUS.md`
7. les states cités par `current_task`, `in_review_tasks`, `blocked_tasks` et `next_action`
8. les tâches, arbitrages, worklogs et preuves correspondants

Les labels de lane sont des classifications. Toutes les tâches restantes s’exécutent sur
`agent/lane-mobile-renderer`. Ne crée aucune autre branche et ne pousse rien sur `main`.

## Garde-fou runtime

N’utilise pas les commandes suivantes de `scripts/agent.mjs` :

```text
start
resume
finish
```

Elles sont legacy et peuvent encore dériver une branche depuis `parallel_lane`. Ne les
utilise pas pour choisir, reprendre ou clôturer une tâche dans cette exécution intégrée.

Les changements de state sont faits explicitement dans les fichiers autoritatifs.

## Exécution par checkpoints distants

Ne raconte pas ton plan. Ne demande pas si tu dois continuer lorsqu’une action est déjà
indiquée par la gouvernance.

Travaille par une seule petite unité cohérente à la fois. À la fin de chaque unité, utilise
obligatoirement :

```bash
node scripts/agent-checkpoint.mjs \
  --message "type(t-xxx): résultat atomique" \
  -- chemin/du/fichier-1 chemin/du/fichier-2
```

Ne commence jamais le lot suivant avant l’affichage de :

```text
CHECKPOINT_DISTANT=<sha>
```

Un commit local seul n’est pas une sauvegarde. Il est interdit :

- d’enchaîner plusieurs commits locaux avant un push groupé ;
- de continuer après un push non confirmé ;
- de répondre à l’utilisateur avec des modifications ou commits locaux non poussés ;
- de lancer tests longs, captures, builds risqués ou arbitrage avant un checkpoint distant.

Maximum recommandé : trois fichiers source par lot. Un groupe indivisible d’artefacts
générés peut former un checkpoint séparé.

Au premier `non-fast-forward` ou écart local/distant : arrête immédiatement. Ne merge,
rebase, cherry-pick, reset, stash ou force-push rien automatiquement. Affiche les SHA et la
divergence, puis demande une réconciliation explicite.

Ne recommence jamais une tâche `DONE` ou `REVIEW` sur la ref autoritative.

Pour une tâche `BLOCKED` devenue réalisable, reprends uniquement le point bloquant. Pour
une nouvelle tâche, démarre uniquement celle indiquée par la lane / execution map.

Interromps l’utilisateur uniquement pour un arbitrage réel couvert par
`.agent/ARBITRATION.md`, après confirmation distante de tout le travail courant.

Réponse finale uniquement après checkpoint distant confirmé :

Tâche:
Statut:
Branche:
Dernier commit:
PR:
Gates:
Résumé:
