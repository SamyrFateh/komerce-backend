# Authentification GitHub

L’agent utilise uniquement un accès fourni dans son environnement : credentials Git,
`GH_TOKEN` ou `GITHUB_TOKEN`.

La validation d’accès se fait sans mutation de branche :

```bash
git ls-remote origin HEAD
git fetch origin --prune
git ls-remote --exit-code --heads origin agent/lane-mobile-renderer
```

Ensuite, appliquer le préflight de `.agent/START-HERE.md`.

Ne pas utiliser `node scripts/agent.mjs start` pour valider l’accès : cette commande est
legacy et peut encore dériver une branche depuis `parallel_lane`.

Le secret ne doit jamais être affiché, écrit dans le repo, inclus dans une URL enregistrée,
un log, un worklog, une preuve ou un commit.
