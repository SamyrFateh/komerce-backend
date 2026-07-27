# Nettoyage du dépôt

**Statut : CLOS pour le runtime agent et les artefacts manifestement obsolètes.**

## Supprimé

- `.agent/tasks/`
- `.agent/state/`
- `.agent/worklogs/`
- `.agent/handoffs/`
- `.agent/lanes/`
- `.agent/prompts/`
- `.agent/evidence/`
- `.agent/arbitrations/`
- `.agent/decisions/`
- `.agent/deliveries/`
- `.agent/sources/`
- `.agent/SOURCES.json`
- `public/boutique/coverage/`
- `PROMPT_AUDIT_PREGOLIVE.md`

## Conservé

- `.agent/README.md`
- `.agent/LEDGER.md`
- `.agent/paliers/`

L'historique utile reste récupérable par Git. `.gitignore` bloque la réintroduction des anciens artefacts et du coverage.
