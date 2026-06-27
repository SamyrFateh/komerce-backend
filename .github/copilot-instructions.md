# Komerce — Instructions GitHub Copilot

## Porte d'entrée obligatoire

Avant toute modification :

1. Lire `AGENTS.md`.
2. Lire `docs/INDEX.md`.
3. Lire la carte `features/<feature>.feature.js` ou le transversal concerné.

Ne pas commencer depuis un audit, un rapport daté, un prompt historique, un `_LIVE.md`, un `MEMO_*` ou une sortie générée.

## Protocole carte-first

- Identifier la feature ou le transversal.
- Qualifier l'opération : Create, Read, Update, Delete/Archive/Deprecate.
- Vérifier `service`, `perimeter.in`, `perimeter.out`, `authority`, `contract`, `invariants`, `tests` ou `verification`.
- Modifier uniquement dans le périmètre déclaré.
- Mettre à jour la carte si l'intention change.
- Lancer `npm run carte-first:check` puis les gates applicables.

## Gates utiles

- `npm run feature:registry`
- `npm run feature:cards`
- `npm run feature:touched`
- `npm run docs:history-lint`
- `npm run feature:check`
- `npm run arch:gate`
- `npm run map:check`

## Boutique

Si `public/boutique/**` est touché, lire `public/boutique/README.md` et la carte de feature parente.

## Règles absolues

- Pas de nouveau fichier source sans header ou owner.
- Pas de fichier applicatif modifié hors carte ou transversal déclaré.
- Pas de sortie générée éditée comme source de vérité.
- Pas de document historique ajouté hors `archive/`.
- Vérifier les claims contre le code réel.
