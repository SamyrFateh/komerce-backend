# Runtime historique déprécié

Les fichiers suivants peuvent encore exister dans l’historique du dépôt, mais ne font plus partie de la gouvernance active :

- `scripts/agent-*.ps1`
- `scripts/AgentGovernance.psm1`
- les bundles ZIP inbox/outbox
- les imports et exports de livraisons locales

Le seul runtime canonique est :

```bash
node scripts/agent.mjs
```

Un agent ne doit pas rechercher, exécuter ou adapter les scripts PowerShell historiques.
