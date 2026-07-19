# STATUS — historique uniquement

Ce fichier ne décide plus :

- de la branche ;
- de la tâche courante ;
- de la prochaine action.

La commande de démarrage unique est :

```bash
node scripts/agent-bootstrap.mjs
```

Le statut opérationnel est calculé à chaque démarrage par `scripts/agent-resolve-status.mjs` depuis les states, l’historique et les refs distantes.

Pour l’historique détaillé, consulter les states, worklogs, audits et preuves de chaque tâche.
