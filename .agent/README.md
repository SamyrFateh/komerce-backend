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
→ EXECUTION_MAP
→ lane state
→ STATUS
→ state de la tâche courante
→ tâche / worklog / arbitrage / preuves
→ petit lot
→ commit + push sur la branche durable
```

## État opérationnel

La lane intégrée indique la tâche à reprendre et la prochaine nouvelle implémentation.
Une tâche `DONE` ou `REVIEW` sur la ref autoritative ne doit jamais être recréée.
Une tâche `BLOCKED` pour preuve visuelle doit être reprise dès qu’un navigateur compatible
est disponible, sans rouvrir le code fonctionnel sauf défaut réel.

## Runtime

Ne jamais lancer `node scripts/agent.mjs start` avant le préflight de
`.agent/START-HERE.md`.

Après synchronisation :

```bash
node scripts/agent.mjs status
```

Les commandes `save`, `block`, `resume` et `arbitrate` s’utilisent uniquement sur la
branche durable et pour la tâche explicitement identifiée par la gouvernance courante.

## Interdictions

- pousser un checkpoint sur `main` ;
- créer une branche par tâche ou par label de lane ;
- recommencer une tâche déjà terminée ;
- reset ou suppression en présence de modifications locales inconnues ;
- fabriquer une capture ou une preuve ;
- utiliser `TASK-INDEX.json` comme tableau d’avancement.

## Livraison

Petits commits, pushs réguliers, une seule PR finale depuis
`agent/lane-mobile-renderer` vers `main`.
