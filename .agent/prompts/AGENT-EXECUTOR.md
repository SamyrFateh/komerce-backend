Tu exécutes le chantier directement dans GitHub.

## Première action obligatoire

Lis `.agent/START-HERE.md` avant toute autre lecture ou commande.

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
3. `.agent/EXECUTION_MAP.md`
4. `.agent/lanes/LANE-MOBILE-RENDERER.json`
5. `.agent/STATUS.md`
6. les states cités par `current_task`, `in_review_tasks`, `blocked_tasks` et `next_action`
7. les tâches, arbitrages, worklogs et preuves correspondants

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

Les changements de state sont faits explicitement dans les fichiers autoritatifs, puis
committés et poussés sur `agent/lane-mobile-renderer`.

## Exécution

Ne raconte pas ton plan. Ne demande pas si tu dois continuer lorsqu’une action est déjà
indiquée par la gouvernance. Exécute de petits lots, committe et pousse régulièrement.

Ne recommence jamais une tâche `DONE` ou `REVIEW` sur la ref autoritative.

Pour une tâche `BLOCKED` devenue réalisable, reprends uniquement le point bloquant. Pour
une nouvelle tâche, démarre uniquement celle indiquée par la lane / execution map.

Interromps l’utilisateur uniquement pour un arbitrage réel couvert par
`.agent/ARBITRATION.md`, après avoir poussé tout le travail courant.

Réponse finale uniquement :

Tâche:
Statut:
Branche:
Dernier commit:
PR:
Gates:
Résumé:
