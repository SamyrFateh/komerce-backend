# Chantier carte-first executable

Branche : `governance/carte-first-executable`

## Objectif

Faire passer la gouvernance carte-first du niveau intention au niveau executable.

## Pose initiale

- `docs/INDEX.md` : point d'entree vivant.
- `.cursorrules` : redirection vers `AGENTS.md`, `docs/INDEX.md`, puis la carte.
- `AGENTS.md` : runbook carte-first.
- `scripts/docs-history-lint.js` : controle du bruit historique hors archive.
- `scripts/feature-card-schema-check.js` : schema minimal des cartes.
- `scripts/touched-files-feature-gate.js` : rattachement des fichiers touches aux cartes.
- `scripts/map-check.js` : agregateur de reconstruction.

## Prochaine couture

Ajouter les scripts npm correspondants dans `package.json`, puis les raccorder a la CI.
