# CHARTER — Chantier PDP intégré

Version : 3.5 intégrée — checkpoints distants  
Statut : norme active du chantier.

## 1. Première lecture

`.agent/START-HERE.md` est la première source obligatoire. Aucun state local ne doit être
interprété avant synchronisation sur la ref autoritative.

`.agent/CHECKPOINT-PROTOCOL.md` est la norme obligatoire de sauvegarde et de concurrence.

## 2. Source de vérité

La branche durable unique est :

```text
agent/lane-mobile-renderer
```

La ref distante autoritative est `origin/agent/lane-mobile-renderer`.

`main` reste volontairement en retard jusqu’à la PR finale. Les labels de lane restent
des classifications de sujet et ne déterminent plus une branche distincte.

## 3. Lecture avant action

L’agent doit :

1. fetcher `origin` ;
2. vérifier le worktree ;
3. synchroniser la branche durable ;
4. lire MANIFEST, CHECKPOINT-PROTOCOL, EXECUTION_MAP, lane state et STATUS ;
5. lire ensuite seulement le state de la tâche courante.

`TASK-INDEX.json` est un catalogue statique, jamais une preuve de statut ou de prochaine
tâche.

## 4. Authentification et sécurité Git

Le secret ne doit jamais être affiché, versionné, journalisé ou placé dans une URL.
En présence de modifications locales inconnues, aucun reset, stash automatique,
suppression ou changement de branche n’est autorisé.

## 5. Branche et continuité

Toutes les tâches restantes, leurs corrections, tests, preuves et arbitrages restent sur
la branche durable unique. Une tâche, un label de lane ou un changement de vague ne crée
jamais une nouvelle branche.

Il est permis et attendu de modifier plusieurs fois les mêmes fichiers. L’historique utile
est protégé par des checkpoints distants atomiques.

## 6. Checkpoint distant obligatoire

Après chaque unité cohérente, l’agent utilise :

```bash
node scripts/agent-checkpoint.mjs \
  --message "type(t-xxx): résultat atomique" \
  -- chemin/du/fichier-1 chemin/du/fichier-2
```

Un checkpoint est valide uniquement lorsque la commande affiche :

```text
CHECKPOINT_DISTANT=<sha>
```

Un commit local seul n’est pas une sauvegarde. Il est interdit :

- d’accumuler plusieurs commits locaux avant un push ;
- de commencer le lot suivant avant confirmation du SHA distant ;
- de laisser plus de cinq minutes de travail cohérent sans checkpoint distant ;
- de répondre à l’utilisateur avec du travail local non poussé.

L’agent crée également un checkpoint distant avant une commande longue, une capture, une
opération risquée, un arbitrage, une pause ou une réponse finale.

Maximum recommandé : trois fichiers source par lot. Les artefacts générés par une même
commande peuvent former un groupe indivisible distinct.

Aucun checkpoint de travail n’est poussé sur `main`.

## 7. Concurrence Git

Au premier écart local/distant ou rejet `non-fast-forward`, l’agent s’arrête. Il conserve
tout le travail local et n’effectue automatiquement aucun merge, rebase, cherry-pick,
reset, stash ou force-push.

La réconciliation doit être explicitement décidée après affichage des SHA, des commits
locaux et de la divergence.

## 8. Séquençage

L’ordre opérationnel est défini dans `.agent/EXECUTION_MAP.md` et reflété dans
`.agent/lanes/LANE-MOBILE-RENDERER.json`.

Une tâche fonctionnellement rouge bloque la séquence. Une tâche bloquée uniquement par
une preuve visuelle peut laisser avancer les implémentations indépendantes selon la carte
d’exécution, mais elle doit être reprise dès que l’environnement requis devient
disponible.

## 9. Statuts et revue

La règle de sortie propre à chaque tâche fait foi. Sauf décision reviewer explicitement
documentée, une tâche terminée par l’agent passe à `REVIEW`, jamais directement à `DONE`.

Une tâche `DONE` ou `REVIEW` sur la ref autoritative ne doit jamais être recommencée.

## 10. Runtime

Les commandes `start`, `resume` et `finish` de `scripts/agent.mjs` sont interdites dans le
mode intégré tant qu’elles ne respectent pas `MANIFEST.execution_branch`.

`scripts/agent-checkpoint.mjs` est la commande autorisée pour sauvegarder et pousser un
lot. Il est interdit de dériver une branche depuis `parallel_lane` ou de sélectionner une
tâche depuis un checkout de `main`.

## 11. Périmètre

À un instant donné, l’agent respecte le périmètre de la tâche active. Une extension hors
périmètre exige un arbitrage documenté. Les bundles générés sont modifiés uniquement via
les commandes officielles.

## 12. Preuves

Aucune preuve ne peut être inventée. Avant de déclarer un navigateur indisponible,
l’agent vérifie les binaires locaux et caches Puppeteer/Playwright autorisés. Un échec
environnemental doit être documenté précisément.

## 13. Arbitrage

L’agent demande une décision uniquement pour une contradiction de spécifications, un
changement produit, API, données, architecture, sécurité, périmètre ou action
irréversible. Tout travail courant doit être confirmé à distance avant la question.

## 14. Livraison

Une seule PR finale est ouverte depuis `agent/lane-mobile-renderer` vers `main` lorsque le
chantier est entièrement prêt.

## 15. Réponse finale

La réponse contient uniquement :

```text
Tâche:
Statut:
Branche:
Dernier commit:
PR:
Gates:
Résumé:
```
