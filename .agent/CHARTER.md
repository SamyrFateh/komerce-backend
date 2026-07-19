# CHARTER — Chantier PDP intégré

Version : 3.6 intégrée — travail distant avant métadonnées  
Statut : norme active du chantier.

## 1. Première lecture

`.agent/START-HERE.md` est la première source obligatoire. Aucun state local ne doit être
interprété avant synchronisation sur la ref autoritative.

`.agent/CHECKPOINT-PROTOCOL.md` est la norme obligatoire de sauvegarde, de récupération et
de concurrence.

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
5. lire le state de la tâche courante ;
6. inspecter l’historique Git, les diffs, les tests et les preuves distants avant de conclure
   qu’un travail est absent.

`TASK-INDEX.json` est un catalogue statique, jamais une preuve de statut ou de prochaine
tâche.

Un state peut être en retard après une interruption. Il décrit le travail ; il ne remplace
pas la preuve du travail réellement poussé.

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

## 6. Doctrine de récupération

Ce qu’un agent suivant ne peut pas reconstruire doit être poussé en premier :

1. code source ;
2. tests ;
3. artefacts générés ;
4. preuves réelles.

Les métadonnées viennent ensuite :

1. state ;
2. worklog ;
3. audit ;
4. STATUS et lane state.

Un agent suivant peut relire un diff et reconstruire un state manquant. Il ne peut pas
récupérer du code resté uniquement dans la sandbox précédente.

L’ordre de preuve en cas de contradiction est :

1. branche distante et historique Git ;
2. source et tests distants ;
3. preuves et artefacts distants ;
4. résultats de gates ;
5. state et tableaux de pilotage.

## 7. Checkpoint distant obligatoire

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

Le travail se livre en deux checkpoints distincts :

```text
travail récupérable poussé et confirmé
→ puis seulement métadonnées référant ce SHA
```

Un commit local seul n’est pas une sauvegarde. Il est interdit :

- d’accumuler plusieurs commits locaux avant un push ;
- de commencer le lot suivant avant confirmation du SHA distant ;
- d’écrire le state de sortie avant le push du travail correspondant ;
- de laisser plus de cinq minutes de travail cohérent sans checkpoint distant ;
- de répondre à l’utilisateur avec du travail local non poussé.

L’agent crée également un checkpoint distant avant une commande longue, une capture, une
opération risquée, un arbitrage, une pause ou une réponse finale.

Maximum recommandé : trois fichiers source par lot. Les artefacts générés par une même
commande peuvent former un groupe indivisible distinct.

Aucun checkpoint de travail n’est poussé sur `main`.

## 8. Concurrence Git

Au premier écart local/distant ou rejet `non-fast-forward`, l’agent s’arrête. Il conserve
tout le travail local et n’effectue automatiquement aucun merge, rebase, cherry-pick,
reset, stash ou force-push.

La réconciliation doit être explicitement décidée après affichage des SHA, des commits
locaux et de la divergence.

## 9. Séquençage

L’ordre opérationnel est défini dans `.agent/EXECUTION_MAP.md` et reflété dans
`.agent/lanes/LANE-MOBILE-RENDERER.json`.

Une tâche fonctionnellement rouge bloque la séquence. Une tâche bloquée uniquement par
une preuve visuelle peut laisser avancer les implémentations indépendantes selon la carte
d’exécution, mais elle doit être reprise dès que l’environnement requis devient
disponible.

## 10. Statuts et revue

La règle de sortie propre à chaque tâche fait foi. Sauf décision reviewer explicitement
documentée, une tâche terminée par l’agent passe à `REVIEW`, jamais directement à `DONE`.

Une tâche `DONE` ou `REVIEW` sur la ref autoritative ne doit jamais être recommencée.
Du travail déjà présent à distance ne doit pas être recréé parce que son state est resté en
retard ; seul le checkpoint documentaire manquant doit être terminé.

## 11. Runtime

Les commandes `start`, `resume` et `finish` de `scripts/agent.mjs` sont interdites dans le
mode intégré tant qu’elles ne respectent pas `MANIFEST.execution_branch`.

`scripts/agent-checkpoint.mjs` est la commande autorisée pour sauvegarder et pousser un
lot. Il est interdit de dériver une branche depuis `parallel_lane` ou de sélectionner une
tâche depuis un checkout de `main`.

## 12. Périmètre

À un instant donné, l’agent respecte le périmètre de la tâche active. Une extension hors
périmètre exige un arbitrage documenté. Les bundles générés sont modifiés uniquement via
les commandes officielles.

## 13. Preuves

Aucune preuve ne peut être inventée. Avant de déclarer un navigateur indisponible,
l’agent vérifie les binaires locaux et caches Puppeteer/Playwright autorisés. Un échec
environnemental doit être documenté précisément.

## 14. Arbitrage

L’agent demande une décision uniquement pour une contradiction de spécifications, un
changement produit, API, données, architecture, sécurité, périmètre ou action
irréversible. Tout travail courant doit être confirmé à distance avant la question.

## 15. Livraison

Une seule PR finale est ouverte depuis `agent/lane-mobile-renderer` vers `main` lorsque le
chantier est entièrement prêt.

## 16. Réponse finale

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