# START HERE — règle minimale

## 1. Démarrage unique

Exécuter immédiatement :

```bash
node scripts/agent-bootstrap.mjs
```

Cette commande :

- refuse de toucher à un worktree contenant du travail local ;
- bascule automatiquement sur `agent/lane-mobile-renderer` lorsque le worktree est propre ;
- synchronise la branche en `--ff-only` ;
- vérifie que le HEAD local égale `origin/agent/lane-mobile-renderer` ;
- affiche la tâche et l'action depuis `.agent/NOW.json`.

Aucune autre branche n'est autorisée pour ce chantier.

## 2. Source opérationnelle unique

Après le bootstrap, lire uniquement :

```text
.agent/NOW.json
```

Ce fichier décide exclusivement :

- la branche ;
- la tâche courante ;
- l'action immédiate ;
- les tâches à ne pas réimplémenter ;
- la prochaine tâche.

`MANIFEST.json`, `STATUS.md`, les fichiers de lane, les states et `TASK-INDEX.json` ne choisissent jamais la branche ni la tâche courante. Ils servent seulement de configuration, d'historique ou de preuve.

## 3. Lecture de la tâche

Lire ensuite seulement :

1. `.agent/tasks/<tâche>.md` pour le périmètre ;
2. les fichiers source déjà présents ;
3. les preuves existantes ;
4. l'historique Git de cette tâche.

Ne pas lire tout le dossier `.agent` avant de commencer.

## 4. Sauvegarde

Ordre obligatoire :

```text
travail récupérable → commit → push confirmé
métadonnées         → commit → push confirmé
```

Utiliser `scripts/agent-checkpoint.mjs` pour les checkpoints.

Ne jamais utiliser :

```text
node scripts/agent.mjs start
node scripts/agent.mjs resume
node scripts/agent.mjs finish
```

## 5. État actuel

La seule version à suivre est celle imprimée par :

```bash
node scripts/agent-bootstrap.mjs
```
