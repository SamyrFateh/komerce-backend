# Authentification GitHub

L’agent utilise uniquement un accès fourni dans son environnement : credentials Git, `GH_TOKEN` ou `GITHUB_TOKEN`.

La commande `node scripts/agent.mjs start --agent "nom"` valide l’écriture par un premier push avant tout travail substantiel.

Le secret ne doit jamais être affiché, écrit dans le repo, inclus dans une URL enregistrée, un log, un worklog, une preuve ou un commit.
