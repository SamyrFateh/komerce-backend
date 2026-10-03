# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **636**
- Réponses 200 `UNKNOWN` : **22**

| # | Opération | Source route |
|---:|---|---|
| 1 | `POST /api/admin/workspaces/catalog/approval/{productRef}/prepare-fr` | `routes/admin-catalog-workspace.js` |
| 2 | `GET /api/admin/workspaces/sourcing/import-passages` | `routes/admin-sourcing-workspace.js` |
| 3 | `GET /api/admin/workspaces/sourcing/import-runs/{runRef}/population` | `routes/admin-sourcing-workspace.js` |
| 4 | `POST /api/admin/workspaces/sourcing/sources` | `routes/admin-sourcing-workspace.js` |
| 5 | `PATCH /api/admin/workspaces/sourcing/sources/{sourceRef}` | `routes/admin-sourcing-workspace.js` |
| 6 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/archive` | `routes/admin-sourcing-workspace.js` |
| 7 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/capabilities/{capability}` | `routes/admin-sourcing-workspace.js` |
| 8 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/credentials` | `routes/admin-sourcing-workspace.js` |
| 9 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/credentials/revoke` | `routes/admin-sourcing-workspace.js` |
| 10 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/credentials/rotate` | `routes/admin-sourcing-workspace.js` |
| 11 | `GET /api/admin/workspaces/sourcing/sources/{sourceRef}/credentials/status` | `routes/admin-sourcing-workspace.js` |
| 12 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/credentials/test` | `routes/admin-sourcing-workspace.js` |
| 13 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/prepare` | `routes/admin-sourcing-workspace.js` |
| 14 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/restore` | `routes/admin-sourcing-workspace.js` |
| 15 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/test-connection` | `routes/admin-sourcing-workspace.js` |
| 16 | `GET /api/admin/workspaces/sourcing/sources/catalog` | `routes/admin-sourcing-workspace.js` |
| 17 | `POST /api/admin/workspaces/sourcing/sources/requests` | `routes/admin-sourcing-workspace.js` |
| 18 | `DELETE /api/admin/workspaces/sourcing/sources/requests/{requestRef}` | `routes/admin-sourcing-workspace.js` |
| 19 | `PATCH /api/admin/workspaces/sourcing/sources/requests/{requestRef}` | `routes/admin-sourcing-workspace.js` |
| 20 | `GET /api/market-delegation/markets/{marketCode}/clients` | `routes/market-delegation-client.js` |
| 21 | `GET /api/market-delegation/markets/{marketCode}/clients/{clientPhone}` | `routes/market-delegation-client.js` |
| 22 | `GET /api/market-delegation/markets/{marketCode}/config` | `routes/market-delegation-market-config.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

