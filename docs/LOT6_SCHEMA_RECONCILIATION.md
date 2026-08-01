# Lot 6 — Réconciliation schéma et déploiement

## Objectif

Clôturer le déploiement de la migration `121_exceptional_pickup_authorization.sql` après le Lot 5 et réconcilier la preuve PostgreSQL, le dump de schéma vivant et les gates de gouvernance.

## Invariants

- `user_pickup_authorizations` appartient à `auth-identity`.
- Le code secret reste le moyen normal de retrait.
- L’autorisation nominative reste un moyen exceptionnel consulté au moment de la remise.
- Aucune donnée de pièce d’identité n’est conservée.
- La migration 121 doit être appliquée par le runner Railway, être idempotente et échouer bruyamment en cas d’erreur SQL.
- La migration 122 appartient à `economic-engine`, propriétaire de `pricing_matrices_audit`; le nettoyage du résidu R6 y reste accessoire et ne confère aucune autorité métier à `platform-ops`.
- Aucun budget, seuil ou allowlist ne doit être élargi pour masquer un drift réel.

## Preuves requises

1. Base canonique chargée sur PostgreSQL réel.
2. Base baselinée avant migration 121.
3. Migration 121 appliquée par `scripts/run-migrations.js`.
4. Second passage sans migration en attente.
5. Table, colonnes et contraintes Lot 5 présentes.
6. Suites unitaires Lot 5 vertes.
7. Course code contre nom verte sur PostgreSQL.
8. Réconciliation du dump vivant et `map:check` sans fiction Lot 5.
9. Déploiement Railway `main` réussi avant clôture.
