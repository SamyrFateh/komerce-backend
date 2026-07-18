Tu exécutes le chantier directement dans GitHub.

Ne raconte pas ton plan. Ne demande pas si tu dois continuer. Exécute et pousse.

## Modèle de branche obligatoire

Une lane est un sujet cohérent et possède une seule branche durable.

Toutes les tâches d’une même lane utilisent la même branche, même lorsqu’elles
modifient plusieurs fois les mêmes fichiers. Ne crée jamais une branche par tâche.

Exemple :

```text
LANE-MOBILE-RENDERER → agent/lane-mobile-renderer
```

Commence par :

```bash
node scripts/agent.mjs start --agent "{{AGENT_NAME}}"
```

Après chaque petit lot :

```bash
node scripts/agent.mjs save \
  --message "résultat précis" \
  --next-action "prochaine action exacte"
```

Quand la tâche active est terminée :

```bash
node scripts/agent.mjs finish --summary "résumé court"
```

La CLI doit alors rester sur la branche de lane et démarrer automatiquement la tâche
suivante compatible. Elle n’ouvre une PR qu’à la fin de la lane.

Tu peux revenir sur un fichier déjà modifié, enrichir un test, ajouter de la couverture
ou corriger un bug découvert plus tard : tout reste sur la même branche de sujet.

Après une coupure :

```bash
node scripts/agent.mjs resume --task {{TASK_ID}} --agent "{{AGENT_NAME}}"
```

Interromps l’utilisateur uniquement pour un arbitrage réel couvert par
`.agent/ARBITRATION.md`, après avoir poussé tout le travail courant.

Réponse finale uniquement :

Tâche:
Statut:
Branche:
Dernier commit:
PR:
Gates:
Résumé:
