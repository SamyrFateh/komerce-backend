# D-13 — nettoyage migration dupliquée (PAS un renommage)

## Ce qui a été trouvé (change la donne du doc de dette initial)
`migrations/2026_cost_benchmarks.sql` était byte-identique à
`migrations/090_cost_benchmarks.sql`. Cause réelle : `docs/chantier/STATUS.md`
(item GOV-08) montre que ce fichier a déjà été renommé 2026_ → 090_ le
2026-06-24 — mais l'ancien fichier n'a jamais été supprimé après coup.
Le renommer une 2e fois vers 103_ (comme le suggérait le doc de dette,
qui n'avait pas cette info) aurait recréé le problème que la doctrine de
gouvernance (`governance/migration-slot-exemptions.json`) interdit
explicitement de faire sans plan dédié.

## Action effectuée (nettoyage, pas renommage)
- Supprimé `migrations/2026_cost_benchmarks.sql` (résidu dupliqué, jamais
  nettoyé après le rename de juin — contenu 100% identique à 090_, donc
  aucune perte).
- Retiré la référence dans `features/economic-engine.feature.js` (liste
  des migrations de la feature economic-engine).
- Retiré la même référence dans `tests/unit/economic-engine.feature.js`
  (copie orpheline/moins à jour du fichier ci-dessus — à noter : encore
  un doublon architecture, pas traité ici, hors scope).
- Retiré l'entrée `"2026_cost_benchmarks.sql"` de
  `governance/migration-hashes.json`.
- **Fichier migration lui-même NON inclus dans ce zip** — l'action est une
  suppression, il n'y a rien à copier. Pense à supprimer manuellement
  `migrations/2026_cost_benchmarks.sql` sur ta machine après avoir appliqué
  les 3 fichiers ci-dessous.

## Validation
- `node scripts/feature-guard.js --strict` : 18 slices, 0 erreur.
- `node scripts/audit-backend-arch.js` : Aucune violation (les 4 collisions
  014/072/073/+1 restent, ce sont D-05, hors scope, déjà connues).
- Suite complète : 5703/5738 (exactement les 13 échecs D-16 pré-existants,
  aucune régression).

## Fichiers à merger
- features/economic-engine.feature.js
- tests/unit/economic-engine.feature.js
- governance/migration-hashes.json

## À supprimer manuellement
- migrations/2026_cost_benchmarks.sql
