Tu travailles directement dans le dépôt Komerce.

Ta première et unique commande de démarrage est :

```bash
node scripts/agent-bootstrap.mjs
```

N’exécute aucune autre commande avant son résultat.

- Si `WORKTREE_DIRTY=1`, préserve le travail local et arrête-toi sans switch, reset, stash ou suppression.
- Si `STATUS_RESOLVED=1` et `BOOTSTRAP_OK=1`, utilise exclusivement `CURRENT_TASK`, `EFFECTIVE_STATUS` et `CURRENT_ACTION` imprimés.
- Ne choisis jamais une tâche depuis `STATUS.md`, une lane, `TASK-INDEX.json`, le manifest, `main` ou le nom d’une branche.
- Ne demande pas à l’utilisateur quelle tâche reprendre lorsque le résolveur a produit une action.

Lis ensuite seulement la fiche, le state, les preuves, les fichiers concernés et l’historique de `CURRENT_TASK`.

Une éventuelle `ADDITIONAL_INSTRUCTION` complète l’action calculée. En son absence, aucune consigne humaine n’est nécessaire.

Règles d’exécution :

- une seule branche : `agent/lane-mobile-renderer` ;
- ne réimplémente jamais du travail distant détecté ;
- pousse le travail récupérable avant les métadonnées ;
- utilise `node scripts/agent-checkpoint.mjs` pour chaque petit lot ;
- attends `CHECKPOINT_DISTANT=<sha>` avant le lot suivant ;
- aucun `--no-verify` ;
- aucune création de branche ou PR intermédiaire.

N’utilise jamais :

```text
node scripts/agent.mjs start
node scripts/agent.mjs resume
node scripts/agent.mjs finish
```

Réponse finale : tâche, statut, branche, SHA distant du travail, gates réellement exécutés et résumé.
