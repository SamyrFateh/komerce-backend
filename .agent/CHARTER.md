# CHARTER — GitHub Continuous Push

Version : 3.2  
Statut : norme permanente du chantier.

## 1. Runtime unique

Le runtime canonique est exclusivement :

```bash
node scripts/agent.mjs
```

Les scripts PowerShell historiques sont dépréciés et ne doivent jamais être recherchés, exécutés ou utilisés comme fallback.

## 2. Exécuter, ne pas narrer

L’agent ne commente pas son plan et ne transforme pas la conversation en journal de
travail. Il lit les règles, exécute et sauvegarde sur GitHub.

Les informations de continuité sont écrites dans `.agent/`, dans les commits et dans
la PR, pas dans le chat.

## 3. Authentification avant travail

Avant toute modification substantielle, l’agent utilise le token ou l’identifiant
GitHub fourni dans son environnement.

La commande `start` doit réussir son premier push. Ce push constitue la preuve
d’accès en écriture. En cas d’échec, aucun travail ne commence.

Le token ne doit jamais être affiché, enregistré dans le repo, ajouté à un log,
placé dans une preuve ou inclus dans un message de commit.

## 4. Une tâche, une branche distante

Chaque tâche s’exécute sur :

```text
agent/t-001
```

Il est interdit de travailler directement sur `main`.

## 5. Premier push immédiat

`start` :

1. vérifie l’accès à `origin` ;
2. contrôle les sources obligatoires ;
3. crée la branche depuis `origin/main` ;
4. crée l’état et le worklog ;
5. committe et pousse immédiatement.

Aucune analyse longue ne précède ce premier push.

## 6. Petits lots obligatoires

Après chaque unité cohérente, l’agent exécute `save`.

Une unité cohérente est, par ordre de préférence :

- un constat vérifié ;
- une preuve produite ;
- une correction atomique ;
- un petit groupe indissociable de fichiers ;
- au maximum trois fichiers source lorsque le découpage est possible.

L’agent pousse également avant :

- un test ou une commande longue ;
- une refactorisation risquée ;
- l’ouverture d’un nouvel axe d’analyse ;
- toute réponse finale.

Dix minutes sans push constituent une anomalie de procédure, pas une cible à
atteindre.

## 7. Continuité

La continuité repose sur cinq éléments versionnés :

| Élément | Fonction |
|---|---|
| `state/T-XXX.json` | état machine courant |
| `worklogs/T-XXX.md` | chronologie de reprise |
| commits atomiques | code et preuves sauvegardés |
| `handoffs/T-XXX.md` | synthèse de sortie |
| PR brouillon | revue humaine |

Un dossier `/mnt` et une conversation sont temporaires et non fiables.

## 8. Reprise

Après une coupure, l’agent suivant clone le repo et utilise `resume`.

Il lit en priorité :

1. l’état ;
2. le worklog ;
3. les derniers commits ;
4. le handoff s’il existe ;
5. la tâche.

Il reprend l’action suivante enregistrée et ne recommence pas le travail déjà poussé.

## 9. Périmètre

Chaque checkpoint vérifie les fichiers modifiés. L’agent ne modifie que :

- le périmètre autorisé de la tâche ;
- les sorties générées déclarées ;
- les fichiers de gouvernance propres à la tâche.

## 10. Gates et livraison

`finish` exécute les gates, écrit les preuves, le handoff et le dernier worklog, puis
pousse l’ensemble avant d’essayer d’ouvrir la PR.

L’agent termine en `REVIEW` ou `BLOCKED`, jamais directement en `DONE`.

## 11. Réponse finale

La réponse finale ne contient que :

```text
Tâche:
Statut:
Branche:
Dernier commit:
PR:
Gates:
Résumé:
```

Aucun commentaire supplémentaire n’est autorisé.

## 12. Exception d’arbitrage

Le mode silencieux cesse uniquement lorsqu’une décision répond aux critères de
`.agent/ARBITRATION.md`.

L’agent ne demande jamais un arbitrage avant d’avoir poussé :

- le code ou les preuves déjà produits ;
- l’état `AWAITING_DECISION` ;
- le worklog ;
- la fiche d’arbitrage.

Une difficulté technique ordinaire n’autorise pas une question. L’agent utilise les
conventions du repo et les fallbacks disponibles.

Après décision, la branche existante est reprise. Il est interdit de recommencer la
tâche depuis `main`.
