# CHARTER — Chantier PDP intégré

Version : 3.4 intégrée  
Statut : norme active du chantier.

## 1. Première lecture

`.agent/START-HERE.md` est la première source obligatoire. Aucun state local ne doit être
interprété avant synchronisation sur la ref autoritative.

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
4. lire MANIFEST, EXECUTION_MAP, lane state et STATUS ;
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

Il est permis et attendu de modifier plusieurs fois les mêmes fichiers. Les commits
atomiques conservent l’historique.

## 6. Petits lots et push continu

Après chaque unité cohérente, l’agent committe et pousse sur
`agent/lane-mobile-renderer`. Il pousse aussi avant une opération risquée ou une réponse
finale.

Aucun checkpoint de travail n’est poussé sur `main`.

## 7. Séquençage

L’ordre opérationnel est défini dans `.agent/EXECUTION_MAP.md` et reflété dans
`.agent/lanes/LANE-MOBILE-RENDERER.json`.

Une tâche fonctionnellement rouge bloque la séquence. Une tâche bloquée uniquement par
une preuve visuelle peut laisser avancer les implémentations indépendantes selon la carte
d’exécution, mais elle doit être reprise dès que l’environnement requis devient
disponible.

## 8. Statuts et revue

La règle de sortie propre à chaque tâche fait foi. Sauf décision reviewer explicitement
documentée, une tâche terminée par l’agent passe à `REVIEW`, jamais directement à `DONE`.

Une tâche `DONE` ou `REVIEW` sur la ref autoritative ne doit jamais être recommencée.

## 9. Runtime

Un helper runtime ne peut être utilisé qu’après le préflight et seulement s’il respecte
`MANIFEST.execution_branch`. Il est interdit de dériver une branche depuis
`parallel_lane` ou de sélectionner une tâche depuis un checkout de `main`.

## 10. Périmètre

À un instant donné, l’agent respecte le périmètre de la tâche active. Une extension hors
périmètre exige un arbitrage documenté. Les bundles générés sont modifiés uniquement via
les commandes officielles.

## 11. Preuves

Aucune preuve ne peut être inventée. Avant de déclarer un navigateur indisponible,
l’agent vérifie les binaires locaux et caches Puppeteer/Playwright autorisés. Un échec
environnemental doit être documenté précisément.

## 12. Arbitrage

L’agent demande une décision uniquement pour une contradiction de spécifications, un
changement produit, API, données, architecture, sécurité, périmètre ou action
irréversible. Tout travail courant doit être committé et poussé avant la question.

## 13. Livraison

Une seule PR finale est ouverte depuis `agent/lane-mobile-renderer` vers `main` lorsque le
chantier est entièrement prêt.

## 14. Réponse finale

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
