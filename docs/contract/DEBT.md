# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **678**
- Réponses 200 `UNKNOWN` : **22**

| # | Opération | Source route |
|---:|---|---|
| 1 | `POST /api/admin/catalog/approval-queue/{id}/media/{mediaId}/visual-fr-review` | `routes/admin/catalog-approval.js` |
| 2 | `GET /api/admin/catalog/approval-queue/{id}/visual-fr-proof` | `routes/admin/catalog-approval.js` |
| 3 | `GET /api/admin/costing/orders/{id}/real-margin-shadow` | `routes/admin-costing.js` |
| 4 | `GET /api/admin/costing/products/margin-steering` | `routes/admin-costing.js` |
| 5 | `GET /api/admin/costing/real-margin-shadow` | `routes/admin-costing.js` |
| 6 | `GET /api/admin/customs-shipments/{id}/fees` | `routes/admin-customs-shipments.js` |
| 7 | `POST /api/admin/customs-shipments/{id}/fees` | `routes/admin-customs-shipments.js` |
| 8 | `POST /api/admin/entities/golden-create` | `routes/admin-order-360.js` |
| 9 | `GET /api/admin/entities/golden-upstream` | `routes/admin-order-360.js` |
| 10 | `POST /api/admin/entities/orders/{orderReference}/golden-advance` | `routes/admin-order-360.js` |
| 11 | `GET /api/admin/entities/orders/{orderReference}/golden-evidence` | `routes/admin-order-360.js` |
| 12 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/control` | `routes/admin-finance-accounting-workspace.js` |
| 13 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/receipt` | `routes/admin-finance-accounting-workspace.js` |
| 14 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/reversal` | `routes/admin-finance-accounting-workspace.js` |
| 15 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/losses` | `routes/admin-finance-accounting-workspace.js` |
| 16 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/losses/{lossId}/reversal` | `routes/admin-finance-accounting-workspace.js` |
| 17 | `GET /api/admin/workspaces/sourcing/candidates/{candidateRef}/category-options` | `routes/admin-sourcing-workspace.js` |
| 18 | `POST /api/admin/workspaces/sourcing/candidates/{candidateRef}/resolve-category` | `routes/admin-sourcing-workspace.js` |
| 19 | `POST /api/hub-dash/parcels/{id}/reassign-item` | `routes/hub-dashboard.js` |
| 20 | `GET /api/market-delegation/markets/{marketCode}/cash-custody` | `routes/market-delegation-cash-control.js` |
| 21 | `POST /api/market-delegation/markets/{marketCode}/cash-custody/destinations` | `routes/market-delegation-cash-control.js` |
| 22 | `POST /api/market-delegation/markets/{marketCode}/cash-custody/destinations/{destinationId}/{verb}` | `routes/market-delegation-cash-control.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

