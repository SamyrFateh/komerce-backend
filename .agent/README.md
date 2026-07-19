# Gouvernance agents — Chantier PDP intégré

## Instruction unique

> Lire d’abord `.agent/START-HERE.md`, synchroniser le worktree sur
> `origin/agent/lane-mobile-renderer`, puis exécuter uniquement l’action courante indiquée
> par la lane et les states de cette ref.

## Source de vérité

La branche durable unique du chantier est :

```text
agent/lane-mobile-renderer
```

`main` reste volontairement en retard jusqu’à la PR finale. Les labels de lane sont des
classifications de sujet, pas des branches séparées dans cette exécution.

Ne jamais déterminer l’avancement depuis :

- les states de `main` ;
- un worktree non synchronisé ;
- les compteurs de `.agent/TASK-INDEX.json` ;
- l’ordre numérique des tâches sans consulter `.agent/EXECUTION_MAP.md`.

## Parcours obligatoire

```text
START-HERE
→ fetch origin
→ vérification du worktree
→ switch/pull agent/lane-mobile-renderer
→ MANIFEST
→ CHECKPOINT-PROTOCOL
→ EXECUTION_MAP
→ lane state
→ STATUS
→ state de la tâche courante
→ tâche / worklog / arbitrage / preuves
→ petit lot cohérent
→ commit + push immédiat
→ vérification du SHA distant
→ lot suivant uniquement après CHECKPOINT_DISTANT
```

## Checkpoints anti-perte

La norme complète est `.agent/CHECKPOINT-PROTOCOL.md`.

Un checkpoint signifie obligatoirement :

```text
commit atomique + push immédiat + SHA distant confirmé
```

Utiliser :

```bash
node scripts/agent-checkpoint.mjs \
  --message "type(t-xxx): résultat atomique" \
  -- chemin/du/fichier-1 chemin/du/fichier-2
```

Un commit local seul n’est pas une sauvegarde. Il est interdit d’accumuler plusieurs
commits locaux avant un push groupé ou de commencer un second lot avant l’affichage de
`CHECKPOINT_DISTANT=<sha>`.

Créer un checkpoint distant avant toute commande longue, génération de captures,
opération risquée, arbitrage, pause ou réponse finale.

Au premier `non-fast-forward`, arrêter sans merge, rebase, cherry-pick, reset, stash ou
force-push automatique.

## État opérationnel

La lane intégrée indique la tâche à reprendre et la prochaine nouvelle implémentation.
Une tâche `DONE` ou `REVIEW` sur la ref autoritative ne doit jamais être recréée.
Une tâche `BLOCKED` pour preuve visuelle doit être reprise dès qu’un navigateur compatible
est disponible, sans rouvrir le code fonctionnel sauf défaut réel.

## Runtime

Les commandes `start`, `resume` et `finish` de `scripts/agent.mjs` restent interdites dans
le mode intégré. Les changements de state sont explicites et chaque lot est sauvegardé avec
`scripts/agent-checkpoint.mjs`.

Les commandes de diagnostic sans mutation peuvent être utilisées uniquement après le
préflight et après vérification de leur sortie.

## Interdictions

- pousser un checkpoint sur `main` ;
- créer une branche par tâche ou par label de lane ;
- recommencer une tâche déjà terminée ;
- accumuler des commits locaux non poussés ;
- commencer un lot avec un checkpoint précédent non confirmé à distance ;
- reset ou suppression en présence de modifications locales inconnues ;
- fabriquer une capture ou une preuve ;
- utiliser `TASK-INDEX.json` comme tableau d’avancement.

## Livraison

Checkpoints distants petits et fréquents, une seule PR finale depuis
`agent/lane-mobile-renderer` vers `main`.
