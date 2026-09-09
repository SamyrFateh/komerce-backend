# Market Delegation — P0 green

Date: 2026-09-09

Le chemin critique 0A → 0B → 0C est vert en CI avant ouverture du lot 1A.

- Registre : 42 capabilities, dont 31 `DELEGATION`.
- Baseline autonomie P0 : 15 / 31 `LIVE`.
- `cash_control.policy.manage` appartient à la délégation partenaire ; `execution.cash.confirm` reste une capability terrain.
- `market_operating_assignments` impose au plus un assignment `ACTIVE` par Market ID.
- Les grants membres restent sous le ceiling ; une réduction du ceiling est refusée tant que des grants actifs dépasseraient le nouveau plafond.
- `operator_market_scopes` reste le read model de compatibilité et sa persistance reste possédée par la feature `market`.
- `require-market-scope.js` n'a pas été modifié.
- Les nouvelles tables 193/194 et la colonne 195 restent `intended_migration_schema` / `schema-pending` tant qu'elles ne sont pas confirmées live Railway.

CI de référence : PR enforcement run #1394, succès.
