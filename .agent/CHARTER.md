# CHARTER — Constitution permanente des agents

Version : 1.0
Statut : immuable pendant un chantier, sauf décision formelle enregistrée dans `decisions/`.

## 1. Source de vérité

Le code, les tâches, les états, les décisions et les preuves présents dans le paquet
de chantier sont la source de vérité.

Une conversation d’agent ne constitue jamais une source de vérité durable.

## 2. Lecture obligatoire

Avant toute modification, l’agent lit dans cet ordre :

1. `.agent/CHARTER.md`
2. `.agent/CHANTIER.md`
3. `.agent/MANIFEST.json`
4. `.agent/tasks/<TASK_ID>.md`
5. `.agent/state/<TASK_ID>.json`
6. les décisions ADR référencées par la tâche

## 3. Attribution

L’agent doit réclamer une tâche avec `agent-start.ps1`.

Il est interdit de travailler sur :

- une tâche non `READY` ;
- une tâche déjà réclamée par un autre agent ;
- une tâche dont les dépendances ne sont pas `DONE` ;
- un périmètre non défini.

## 4. Périmètre

Chaque tâche déclare :

- les fichiers autorisés ;
- les fichiers explicitement interdits ;
- les composants ou features concernés ;
- les critères d’acceptation ;
- les gates obligatoires.

Toute extension de périmètre impose :

- soit la création d’une sous-tâche ;
- soit le passage de la tâche à `BLOCKED` ;
- soit une décision ADR validée.

## 5. Feature-First

Toute tâche doit être rattachée à au moins un `feature_id`.

Une modification sans rattachement fonctionnel, architectural ou de gouvernance
explicite est interdite.

## 6. Atomicité

Une tâche doit produire un résultat vérifiable et réversible.

Un commit ou un paquet de changements ne doit pas mélanger plusieurs objectifs
indépendants.

## 7. Tests et gates

L’agent exécute les gates déclarées dans la tâche.

Un gate non exécuté doit être marqué `NOT_RUN` avec une justification précise.
Un gate en échec interdit le passage direct à `DONE`.

## 8. Preuves

Les preuves sont déposées dans `.agent/evidence/<TASK_ID>/`.

Exemples :

- captures avant/après ;
- logs ;
- résultats de tests ;
- sortie de commandes ;
- rapport de contrôle ;
- fichier patch.

## 9. Handoff

Avant de s’arrêter, l’agent produit un handoff dans
`.agent/handoffs/<TASK_ID>.md`.

Le handoff indique au minimum :

- ce qui a été fait ;
- ce qui n’a pas été fait ;
- les fichiers modifiés ;
- les tests exécutés ;
- les hypothèses ;
- les risques ;
- la prochaine action exacte ;
- l’état Git ou l’inventaire de fichiers.

## 10. Fin de fenêtre

L’agent cesse de commencer de nouvelles tâches lorsqu’il estime avoir consommé
environ 80 % de sa fenêtre de travail.

Il utilise le temps restant pour :

- stabiliser l’état ;
- enregistrer les preuves ;
- mettre à jour le handoff ;
- terminer proprement ou bloquer la tâche.

## 11. Revue

L’agent exécutant ne peut pas déclarer seul une tâche sensible `DONE`.

La tâche passe d’abord à `REVIEW`, puis un reviewer l’approuve ou la rejette.

## 12. Travail parallèle

Deux tâches actives ne doivent pas modifier les mêmes fichiers, sauf coordination
explicite par dépendance ou décision ADR.

Chaque agent parallèle travaille depuis le même `base_package_id`.

## 13. Interdictions

Il est interdit de :

- supprimer ou contourner la gouvernance ;
- réécrire l’historique du chantier sans décision ;
- masquer un test en échec ;
- déclarer une tâche terminée sans preuves ;
- modifier un fichier hors périmètre sans le signaler ;
- transférer la responsabilité au prochain agent sans handoff exploitable ;
- laisser une tâche indéfiniment en `IN_PROGRESS`.

## 14. Priorité

En cas de conflit :

1. sécurité et intégrité des données ;
2. décisions ADR validées ;
3. CHARTER ;
4. CHANTIER ;
5. tâche ;
6. préférence locale de l’agent.


## 15. Livraison structurée

L’agent ne livre jamais des fichiers à copier-coller depuis sa réponse.

Après avoir terminé ou bloqué sa tâche, il produit un bundle avec
`agent-export-delivery.ps1` et remet ce ZIP à l’utilisateur.

Le repo principal applique le bundle uniquement avec
`agent-import-delivery.ps1`. L’extraction manuelle par-dessus le repo est interdite.

## 16. Validation locale

Les gates exécutés dans la copie de l’agent constituent une preuve, mais pas
l’autorisation de commit.

Après import, le repo principal exécute `agent-validate-delivery.ps1`.
Une tâche importée ne peut être approuvée que si la validation locale est `PASS`.

## 17. Traçabilité de livraison

Le ZIP brut est archivé localement. Le record léger, le patch, le handoff, les
preuves et l’état sont versionnés avec le code.

Aucun fichier livré ne doit exister uniquement dans une conversation ou un dossier
temporaire non référencé.
