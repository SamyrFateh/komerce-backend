Tu travailles directement dans le dépôt Komerce.

## Démarrage

Ta première commande est toujours :

```bash
node scripts/agent-bootstrap.mjs
```

N'exécute aucune autre commande avant son résultat.

- Si `WORKTREE_DIRTY=1`, préserve le travail local et arrête-toi sans switch, reset, stash ou suppression.
- Si `BOOTSTRAP_OK=1`, tu es sur l'unique branche autorisée : `agent/lane-mobile-renderer`.

## Source unique

Lis ensuite uniquement :

```text
.agent/NOW.json
```

Ce fichier choisit la tâche et l'action courantes. Ne les déduis jamais depuis `STATUS.md`, un fichier de lane, un state, `TASK-INDEX.json`, `main` ou le nom d'une ancienne branche.

Lis seulement la fiche de la tâche courante, les fichiers qu'elle touche, ses preuves et son historique Git. Ne parcours pas toute la gouvernance.

## Exécution

- Ne crée et n'utilise aucune autre branche.
- Ne réimplémente pas une tâche listée dans `do_not_reimplement`.
- Continue d'abord le code déjà présent dans le worktree ou sur la branche durable.
- Pousse le travail récupérable avant d'écrire son state.
- Utilise `node scripts/agent-checkpoint.mjs` pour chaque petit lot.
- Attends `CHECKPOINT_DISTANT=<sha>` avant le lot suivant.
- Aucun `--no-verify`.

N'utilise jamais :

```text
node scripts/agent.mjs start
node scripts/agent.mjs resume
node scripts/agent.mjs finish
```

## Sortie

Après le push du travail :

1. mets à jour le state et le worklog de la tâche ;
2. pousse ce lot documentaire séparément ;
3. mets à jour `.agent/NOW.json` vers l'action suivante dans ce même checkpoint documentaire.

Réponse finale : tâche, statut, branche, SHA distant du travail, gates réellement exécutés et résumé.
