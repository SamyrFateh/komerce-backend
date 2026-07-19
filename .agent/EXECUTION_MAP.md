# EXECUTION MAP — PDP Komerce

## Entrée obligatoire

Lire `.agent/START-HERE.md` avant toute autre source. La ref autoritative est :

```text
origin/agent/lane-mobile-renderer
```

`main` est volontairement en retard jusqu’à la PR finale. Les identifiants de lane sont
des classifications de sujet, pas des branches séparées.

## Branche active

Toutes les tâches restantes s’exécutent séquentiellement sur :

```text
agent/lane-mobile-renderer
```

Aucune nouvelle branche par tâche ou par lane ne doit être créée. Aucun checkpoint de
travail ne doit être poussé sur `main`.

## État acquis

- `T-001` à `T-016` : `DONE`.
- `T-017` : `REVIEW`, preuves série desktop et fallback présentes.
- `T-018` : `REVIEW`, hero 4:3 borné et scénario contenu long vérifiés.
- `T-023` : code et gates terminés ; état `BLOCKED` uniquement pour les deux captures
  EMPTY/FILLED.
- Chromium/Puppeteer local est désormais détecté : le blocage environnemental de T-023
  est levable.

## Action courante

```text
T-023 — produire desktop-actions-empty.png et desktop-actions-filled.png
      — vérifier absence de layout shift
      — BLOCKED → REVIEW si conforme
      — pousser le checkpoint
```

Ne modifier le code fonctionnel T-023 qu’en présence d’un défaut visuel réel.

## Prochaine implémentation

```text
T-019
  → T-020
  → T-021
  → T-022
  → T-024
  → T-025
  → T-026
  → T-027
```

Règles :

1. chaque tâche part du HEAD distant courant de `agent/lane-mobile-renderer` ;
2. un seul agent travaille sur la branche à la fois ;
3. petits commits et pushs réguliers ;
4. un gate fonctionnel rouge bloque la séquence ;
5. une preuve visuelle manquante ne peut être ni simulée ni fabriquée ;
6. une tâche `DONE` ou `REVIEW` ne doit jamais être recréée ;
7. `.agent/TASK-INDEX.json` ne sert jamais à sélectionner la tâche suivante.

## Finitions dépendantes

```text
T-028 → T-029
```

- `T-028` exige notamment `T-023`, `T-024`, `T-026` et `T-027` clôturées.
- `T-029` exige notamment `T-018`, `T-019`, `T-021`, `T-022`, `T-025` et `T-027` clôturées.

## Validation finale

```text
T-030
```

`T-030` démarre uniquement lorsque `T-001` à `T-029` sont toutes `DONE`.

## Statuts et revue

- Les tâches passent à `REVIEW`, jamais directement à `DONE`, sauf décision reviewer
  explicitement documentée.
- Une seule PR finale sera ouverte depuis `agent/lane-mobile-renderer` vers `main`.

## Garde-fou runtime

Les commandes legacy suivantes sont interdites dans l’exécution intégrée :

```text
node scripts/agent.mjs start
node scripts/agent.mjs resume
node scripts/agent.mjs finish
```

Elles dérivent encore une branche depuis `parallel_lane`. Les changements de state sont
faits explicitement sur la branche durable tant que le runtime n’est pas refactorisé.

## Interdictions

- créer une branche distincte pour une nouvelle tâche ;
- pousser un checkpoint directement sur `main` ;
- démarrer deux tâches simultanément ;
- contourner un gate fonctionnel rouge ;
- fabriquer une preuve visuelle ;
- utiliser les states de `main` comme source d’avancement ;
- démarrer `T-028` avant la clôture de `T-023`.
