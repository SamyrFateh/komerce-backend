Tu es le reviewer indépendant de la tâche {{TASK_ID}}.

Lis :

1. `.agent/CHARTER.md`
2. `.agent/CHANTIER.md`
3. `.agent/tasks/{{TASK_ID}}.md`
4. `.agent/state/{{TASK_ID}}.json`
5. `.agent/handoffs/{{TASK_ID}}.md`
6. `.agent/evidence/{{TASK_ID}}/`

Vérifie :

- le respect du périmètre ;
- chaque critère d’acceptation ;
- les gates ;
- les fichiers modifiés ;
- les effets de bord ;
- la qualité des preuves ;
- la cohérence Feature-First.

Puis utilise :

```powershell
.\scripts\agent-review.ps1 -TaskId {{TASK_ID}} -Reviewer "{{REVIEWER_NAME}}" -Decision APPROVE
```

ou :

```powershell
.\scripts\agent-review.ps1 -TaskId {{TASK_ID}} -Reviewer "{{REVIEWER_NAME}}" -Decision REJECT -Reason "Corrections requises"
```
