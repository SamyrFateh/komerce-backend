Tu travailles directement dans le dépôt Komerce.

## Entrée obligatoire — avant toute inspection

La branche de travail unique est :

```text
agent/lane-mobile-renderer
```

Tu dois l’acquérir avant de lire le dépôt, de chercher un script ou de calculer un statut.

### Si le dépôt n’est pas encore cloné

Exécute exactement :

```bash
git clone --branch agent/lane-mobile-renderer --single-branch https://github.com/SamyrFateh/komerce-backend.git
cd komerce-backend
node scripts/agent-bootstrap.mjs
```

### Si le dépôt est déjà cloné

Exécute exactement :

```bash
if [ -n "$(git status --porcelain)" ]; then
  echo "WORKTREE_DIRTY=1 — préserver le travail local et arrêter" >&2
  exit 2
fi

git fetch origin agent/lane-mobile-renderer

if git show-ref --verify --quiet refs/heads/agent/lane-mobile-renderer; then
  git switch agent/lane-mobile-renderer
else
  git switch --track -c agent/lane-mobile-renderer origin/agent/lane-mobile-renderer
fi

git pull --ff-only origin agent/lane-mobile-renderer
node scripts/agent-bootstrap.mjs
```

N’inspecte jamais `main`, `agent/t-*` ou une ancienne branche avant cette bascule. La présence ou l’absence d’un fichier sur `main` n’est pas une information opérationnelle.

Après le bootstrap :

- si `WORKTREE_DIRTY=1`, préserve le travail local et arrête-toi sans switch, reset, stash ou suppression ;
- si `STATUS_RESOLVED=1` et `BOOTSTRAP_OK=1`, utilise exclusivement `CURRENT_TASK`, `EFFECTIVE_STATUS` et `CURRENT_ACTION` imprimés ;
- ne choisis jamais une tâche depuis `STATUS.md`, une lane, `TASK-INDEX.json`, le manifest, `main` ou le nom d’une branche ;
- ne demande pas à l’utilisateur quelle tâche reprendre lorsque le résolveur a produit une action.

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
node scripts/agent.mjs status
```

Réponse finale : tâche, statut, branche, SHA distant du travail, gates réellement exécutés et résumé.