# CHARTER — GitHub Lane Branch

Version : 3.3  
Statut : norme permanente du chantier.

## 1. Runtime unique

Le seul runtime actif est :

```bash
node scripts/agent.mjs
```

Les scripts PowerShell historiques sont interdits comme fallback.

## 2. Exécuter sans narrer

L’agent lit les règles, exécute et sauvegarde. Le chat n’est ni un journal de travail
ni une source de vérité.

## 3. Authentification avant travail

L’accès GitHub provient des credentials Git, de `GH_TOKEN` ou de `GITHUB_TOKEN`.
Le secret ne doit jamais être affiché, versionné, journalisé ou placé dans une URL
enregistrée.

Le premier push doit réussir avant tout travail substantiel.

## 4. Une branche par sujet

La lane est l’unité de sujet et possède une branche durable :

```text
LANE-MOBILE-RENDERER → agent/lane-mobile-renderer
```

Toutes les tâches de la lane utilisent cette même branche. Une tâche ne crée jamais
sa propre branche.

Un nouveau sujet ou une autre lane peut utiliser une autre branche. Le simple passage
à la tâche suivante ne justifie jamais un changement de branche.

## 5. Réutilisation des fichiers

L’agent peut et doit revenir sur les mêmes fichiers pendant toute la vie du sujet :
tests, couverture, correction découverte tardivement, refactorisation locale ou
ajustement d’un comportement déjà traité.

La branche conserve l’ensemble du contexte. Les commits atomiques conservent
l’historique. Il est interdit de fragmenter ce contexte entre plusieurs branches.

## 6. Petits lots et push continu

Après chaque unité cohérente, l’agent exécute `save`.

Une unité cohérente est un constat, une preuve, une correction atomique ou un petit
groupe indissociable de fichiers. L’agent pousse aussi avant une commande longue,
une opération risquée et toute réponse finale.

## 7. Enchaînement des tâches

Quand les gates d’une tâche passent :

1. la tâche passe à `DONE` dans la branche de lane ;
2. aucun PR individuel n’est créé ;
3. la prochaine tâche `READY` de la même lane est démarrée automatiquement ;
4. le travail continue sur les fichiers déjà présents dans la branche.

Une revue humaine intermédiaire n’est requise que si la tâche déclare explicitement
un arrêt obligatoire ou si un arbitrage réel est nécessaire.

## 8. Fin de lane

Quand aucune autre tâche exécutable ne reste dans la lane :

1. un handoff global de lane est produit ;
2. la lane passe à `REVIEW` ;
3. une seule PR couvre tout le sujet ;
4. la revue porte sur l’historique et le diff complet ;
5. après validation, la branche est mergée dans `main`.

## 9. Continuité après coupure

La reprise se fait depuis la branche de lane, jamais depuis `main`.

L’agent lit les états des tâches, les worklogs, les commits et le handoff de lane,
puis reprend l’action exacte enregistrée.

## 10. Périmètre

La branche peut contenir l’union des périmètres autorisés des tâches de la lane.
À un instant donné, l’agent respecte le périmètre de la tâche active.

Un bug découvert dans un fichier déjà autorisé par le sujet est corrigé sur la même
branche et documenté par un commit. Une extension réelle hors sujet exige un arbitrage.

## 11. Arbitrage

L’agent demande une décision uniquement pour une contradiction de spécifications,
un changement produit, API, données, architecture, sécurité, périmètre ou action
irréversible.

Avant la question, tout le travail courant doit être committé et poussé.

## 12. Réponse finale

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
