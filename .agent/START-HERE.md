# START HERE — entrée unique du chantier

## 1. Branche avant toute lecture

La branche de travail unique est :

```text
agent/lane-mobile-renderer
```

Un agent ne doit jamais inspecter `main`, exécuter l’ancien runtime ou rechercher les fichiers du chantier avant d’avoir acquis cette branche.

### Nouveau clone

```bash
git clone --branch agent/lane-mobile-renderer --single-branch https://github.com/SamyrFateh/komerce-backend.git
cd komerce-backend
node scripts/agent-bootstrap.mjs
```

### Clone existant et worktree propre

```bash
git fetch origin agent/lane-mobile-renderer

if git show-ref --verify --quiet refs/heads/agent/lane-mobile-renderer; then
  git switch agent/lane-mobile-renderer
else
  git switch --track -c agent/lane-mobile-renderer origin/agent/lane-mobile-renderer
fi

git pull --ff-only origin agent/lane-mobile-renderer
node scripts/agent-bootstrap.mjs
```

Si `git status --porcelain` n’est pas vide, préserver le travail local et s’arrêter. Aucun switch, reset, stash ou nettoyage automatique.

La présence ou l’absence d’un fichier sur `main` n’a aucune valeur opérationnelle. `main` est volontairement en retard jusqu’à la PR finale.

## 2. Statut calculé

Le résultat imprimé par `agent-bootstrap.mjs` est la seule décision opérationnelle :

```text
CURRENT_TASK=...
EFFECTIVE_STATUS=...
CURRENT_ACTION=...
STATUS_RESOLVED=1
BOOTSTRAP_OK=1
```

Le résolveur distingue notamment :

- travail existant sur une mauvaise ref à rapatrier ;
- travail déjà poussé sur la branche durable mais state en retard ;
- tâche réellement en cours ;
- prochaine tâche READY dont les dépendances sont satisfaites.

Aucun fichier ne contient une tâche courante écrite à la main.

`STATUS.md`, les fichiers de lane, `TASK-INDEX.json` et le manifest ne choisissent jamais la tâche. Ils servent seulement d’historique ou de configuration.

Une consigne humaine facultative peut exister dans `.agent/ADDITIONAL-INSTRUCTION.json`. Elle complète le statut calculé ; elle ne le remplace pas silencieusement.

## 3. Lecture et exécution

Après le bootstrap, lire seulement la fiche, le state, les preuves, les fichiers et l’historique de `CURRENT_TASK`.

Ordre de sauvegarde :

```text
travail récupérable → commit → push confirmé
métadonnées         → commit → push confirmé
```

Utiliser `node scripts/agent-checkpoint.mjs` pour chaque checkpoint.

Ne jamais utiliser :

```text
node scripts/agent.mjs start
node scripts/agent.mjs resume
node scripts/agent.mjs finish
node scripts/agent.mjs status
```