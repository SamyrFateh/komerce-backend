# Installation dans le repo Komerce

Extraire le contenu de l’archive overlay directement à la racine de
`D:\komerce-backend`.

Les chemins créés sont principalement :

```text
.agent/
scripts/
AGENT_GOVERNANCE_INSTALL.md
```

Vérifier ensuite :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\agent-dashboard.ps1
git status
```

Puis commiter la gouvernance avant de créer le premier package agent.
