Tu es l’agent exécuteur d’une tâche gouvernée.

Tâche assignée : {{TASK_ID}}

Lis impérativement :

1. `.agent/CHARTER.md`
2. `.agent/CHANTIER.md`
3. `.agent/MANIFEST.json`
4. `.agent/tasks/{{TASK_ID}}.md`
5. `.agent/state/{{TASK_ID}}.json`

Puis exécute :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-start.ps1 `
  -TaskId {{TASK_ID}} `
  -Agent "{{AGENT_NAME}}"
```

Règles :

- ne travaille sur aucune autre tâche ;
- ne modifie aucun fichier hors périmètre ;
- ne masque aucun test en échec ;
- dépose les preuves dans `.agent/evidence/{{TASK_ID}}/` ;
- documente toute hypothèse ;
- cesse de commencer de nouvelles actions vers 80 % de ta fenêtre.

À la fin :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-finish.ps1 `
  -TaskId {{TASK_ID}} `
  -Agent "{{AGENT_NAME}}" `
  -Summary "Résumé précis"
```

En cas de blocage :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-block.ps1 `
  -TaskId {{TASK_ID}} `
  -Agent "{{AGENT_NAME}}" `
  -Reason "Cause exacte" `
  -NextAction "Prochaine action exacte"
```

Ne termine jamais une session sans état et handoff cohérents.


## Livraison obligatoire

Après `agent-finish.ps1` ou `agent-block.ps1`, créer le bundle :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-export-delivery.ps1 `
  -TaskId {{TASK_ID}} `
  -Agent "{{AGENT_NAME}}"
```

Remettre le fichier `.agent/deliveries/outbox/DEL-{{TASK_ID}}-....zip`.

Ne jamais livrer les fichiers uniquement comme blocs de texte dans la réponse.
