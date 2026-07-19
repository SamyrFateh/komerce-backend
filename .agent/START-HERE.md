# START HERE — règle minimale

## Démarrage unique

Exécuter immédiatement :

```bash
node scripts/agent-bootstrap.mjs
```

Cette commande :

- refuse de toucher à un worktree contenant du travail local ;
- bascule automatiquement sur `agent/lane-mobile-renderer` lorsque le worktree est propre ;
- synchronise la branche en `--ff-only` ;
- vérifie que le HEAD local égale le HEAD distant ;
- calcule la tâche et l’action courantes depuis les states, l’historique et les refs distantes.

Aucun fichier ne contient une tâche courante écrite à la main.

## Statut opérationnel

Le résultat imprimé par `agent-bootstrap.mjs` est la seule décision opérationnelle :

```text
CURRENT_TASK=...
EFFECTIVE_STATUS=...
CURRENT_ACTION=...
STATUS_RESOLVED=1
```

Le résolveur distingue notamment :

- travail existant sur une mauvaise ref à rapatrier ;
- travail déjà poussé sur la branche durable mais state en retard ;
- tâche réellement en cours ;
- prochaine tâche READY dont les dépendances sont satisfaites.

`STATUS.md`, les fichiers de lane, `TASK-INDEX.json` et le manifest ne choisissent jamais la tâche. Ils servent seulement d’historique ou de configuration.

Une consigne humaine facultative peut exister dans `.agent/ADDITIONAL-INSTRUCTION.json`. Elle complète le statut calculé ; elle ne le remplace pas silencieusement.

## Lecture et exécution

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
```
