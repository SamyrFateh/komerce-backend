# EXECUTION MAP — PDP Komerce

## Règle active du chantier

Les identifiants de lane restent des classifications de sujet. Sur décision explicite de
Samyr, l’exécution intégrée du chantier PDP se poursuit toutefois sur une seule branche
durable :

```text
agent/lane-mobile-renderer
```

Aucune nouvelle branche par tâche ou par lane ne doit être créée. `main` ne reçoit pas de
checkpoint de travail : elle ne sera ciblée qu’au moment de l’intégration finale par PR.

Les tâches sont exécutées séquentiellement sur cette branche, avec de petits commits et des
pushs réguliers. Les dépendances déclarées dans les fichiers `T-*.json` restent les dépendances
fonctionnelles ; le présent document fixe l’ordre opérationnel.

## État acquis

- `T-001` à `T-016` : `DONE`.
- `T-023` : implémentation et gates automatisés terminés, statut `BLOCKED` uniquement pour
  les captures desktop EMPTY/FILLED indisponibles sans Chromium.

## Séquençage opérationnel en vigueur

### Phase A — implémentation et gates automatisés

```text
T-017
  → T-018
  → T-019
  → T-020
  → T-021
  → T-022
  → T-024
  → T-025
  → T-026
  → T-027
```

Règles :

1. Chaque tâche démarre sur `agent/lane-mobile-renderer` depuis le HEAD distant courant.
2. Un seul agent travaille sur la branche à la fois.
3. Le code, les tests et les gates automatisés doivent être terminés avant la tâche suivante.
4. Une tâche avec un gate fonctionnel rouge bloque la séquence.
5. Lorsque la seule preuve manquante est une capture impossible faute de navigateur, la
   tâche passe en `BLOCKED` avec un `blocking_reason` exclusivement visuel. Ce blocage
   n’empêche pas de poursuivre la Phase A.
6. Aucun artefact visuel ne doit être simulé ou fabriqué.

### Phase B — campagne visuelle groupée

Dès qu’un environnement avec Chromium est disponible :

1. produire d’abord les captures manquantes de `T-023` ;
2. produire ensuite les preuves visuelles manquantes de `T-017` à `T-022`, puis `T-024` à
   `T-027`, dans cet ordre ;
3. vérifier chaque critère aux viewports demandés ;
4. faire passer chaque tâche de `BLOCKED` à `REVIEW`, puis à `DONE` après revue humaine ;
5. ne rouvrir le code fonctionnel qu’en présence d’un défaut visible réel.

### Phase C — finitions dépendantes

La phase suivante ne démarre qu’après clôture des dépendances visuelles requises :

```text
T-028 → T-029
```

- `T-028` exige notamment `T-023`, `T-024`, `T-026` et `T-027` clôturées.
- `T-029` exige notamment `T-018`, `T-019`, `T-021`, `T-022`, `T-025` et `T-027` clôturées.

### Phase D — validation finale

```text
T-030
```

`T-030` démarre uniquement lorsque `T-001` à `T-029` sont toutes `DONE`. Elle porte la
campagne finale sur six viewports, six états produit et l’ensemble des gates.

## Revue et livraison

- Les tâches passent à `REVIEW`, jamais directement à `DONE`, sauf décision explicite du
  reviewer déjà documentée.
- Les blocages purement visuels sont regroupés pour une campagne Chromium dédiée.
- Une seule PR finale sera ouverte depuis `agent/lane-mobile-renderer` vers `main` à la fin
  du chantier.

## Interdictions

- créer une branche distincte pour une nouvelle tâche ;
- pousser un checkpoint directement sur `main` ;
- démarrer deux tâches simultanément sur la branche ;
- contourner un gate fonctionnel rouge ;
- fabriquer une preuve visuelle ;
- démarrer `T-028` avant la clôture de `T-023`.
