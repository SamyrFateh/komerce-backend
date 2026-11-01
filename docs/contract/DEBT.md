# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **714**
- Réponses 200 `UNKNOWN` : **49**

| # | Opération | Source route |
|---:|---|---|
| 1 | `POST /api/admin/catalog/approval-queue/{id}/media/{mediaId}/visual-fr-review` | `routes/admin/catalog-approval.js` |
| 2 | `GET /api/admin/catalog/approval-queue/{id}/visual-fr-proof` | `routes/admin/catalog-approval.js` |
| 3 | `GET /api/admin/costing/orders/{id}/real-margin-shadow` | `routes/admin-costing.js` |
| 4 | `POST /api/admin/costing/orders/{orderId}/manual-costs` | `routes/admin-costing.js` |
| 5 | `POST /api/admin/costing/orders/{orderId}/manual-costs/{costType}/correct` | `routes/admin-costing.js` |
| 6 | `POST /api/admin/costing/orders/{orderId}/simulation-scope` | `routes/admin-costing.js` |
| 7 | `GET /api/admin/costing/real-margin-shadow` | `routes/admin-costing.js` |
| 8 | `GET /api/admin/customs-shipments/{id}/fees` | `routes/admin-customs-shipments.js` |
| 9 | `POST /api/admin/customs-shipments/{id}/fees` | `routes/admin-customs-shipments.js` |
| 10 | `GET /api/admin/entities/golden-upstream` | `routes/admin-order-360.js` |
| 11 | `GET /api/admin/entities/orders/{orderReference}/golden-evidence` | `routes/admin-order-360.js` |
| 12 | `GET /api/admin/finance-config/fx-observations` | `routes/admin-finance-config.js` |
| 13 | `POST /api/admin/finance-config/fx-observations` | `routes/admin-finance-config.js` |
| 14 | `POST /api/admin/finance-config/fx-observations/{id}/approve` | `routes/admin-finance-config.js` |
| 15 | `POST /api/admin/markets/{marketCode}/delivery-attestations` | `routes/admin-market-control-plane.js` |
| 16 | `POST /api/admin/markets/{marketCode}/delivery-attestations/{attestationId}/revoke` | `routes/admin-market-control-plane.js` |
| 17 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/control` | `routes/admin-finance-accounting-workspace.js` |
| 18 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/receipt` | `routes/admin-finance-accounting-workspace.js` |
| 19 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/reversal` | `routes/admin-finance-accounting-workspace.js` |
| 20 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/losses` | `routes/admin-finance-accounting-workspace.js` |
| 21 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/losses/{lossId}/reversal` | `routes/admin-finance-accounting-workspace.js` |
| 22 | `POST /api/admin/workspaces/catalog/products/{productRef}/classify` | `routes/admin-catalog-workspace.js` |
| 23 | `POST /api/admin/workspaces/catalog/products/{productRef}/recover-source-media` | `routes/admin-catalog-workspace.js` |
| 24 | `POST /api/admin/workspaces/catalog/refinery/{productRef}/prepare-fr` | `routes/admin-catalog-workspace.js` |
| 25 | `POST /api/admin/workspaces/pricing/market/{marketCode}/decision-policy/preview` | `routes/admin-pricing-workspace.js` |
| 26 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/change-active` | `routes/admin-pricing-workspace.js` |
| 27 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/price-preview` | `routes/admin-pricing-workspace.js` |
| 28 | `POST /api/admin/workspaces/pricing/market/{marketCode}/structure-charges` | `routes/admin-pricing-workspace.js` |
| 29 | `PATCH /api/admin/workspaces/pricing/market/{marketCode}/structure-charges/{chargeId}/description` | `routes/admin-pricing-workspace.js` |
| 30 | `GET /api/admin/workspaces/shipping-customs/market/{marketCode}/international` | `routes/admin-shipping-customs-workspace.js` |
| 31 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international` | `routes/admin-shipping-customs-workspace.js` |
| 32 | `GET /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}` | `routes/admin-shipping-customs-workspace.js` |
| 33 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/costs` | `routes/admin-shipping-customs-workspace.js` |
| 34 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/freight` | `routes/admin-shipping-customs-workspace.js` |
| 35 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/link-customs` | `routes/admin-shipping-customs-workspace.js` |
| 36 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/reconcile-n1` | `routes/admin-shipping-customs-workspace.js` |
| 37 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/tracking` | `routes/admin-shipping-customs-workspace.js` |
| 38 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/transition` | `routes/admin-shipping-customs-workspace.js` |
| 39 | `GET /api/admin/workspaces/sourcing/candidates/{candidateRef}/boutique-category-options` | `routes/admin-sourcing-workspace.js` |
| 40 | `GET /api/admin/workspaces/sourcing/candidates/{candidateRef}/category-options` | `routes/admin-sourcing-workspace.js` |
| 41 | `POST /api/admin/workspaces/sourcing/candidates/{candidateRef}/confirm-boutique-category` | `routes/admin-sourcing-workspace.js` |
| 42 | `POST /api/admin/workspaces/sourcing/candidates/{candidateRef}/resolve-category` | `routes/admin-sourcing-workspace.js` |
| 43 | `GET /api/hub-dash/dubai` | `routes/hub-dashboard.js` |
| 44 | `POST /api/hub-dash/parcels/{id}/reassign-item` | `routes/hub-dashboard.js` |
| 45 | `GET /api/market-delegation/catalog/authorized-markets` | `routes/market-delegation-catalog.js` |
| 46 | `GET /api/market-delegation/markets/{marketCode}/cash-custody` | `routes/market-delegation-cash-control.js` |
| 47 | `POST /api/market-delegation/markets/{marketCode}/cash-custody/destinations` | `routes/market-delegation-cash-control.js` |
| 48 | `POST /api/market-delegation/markets/{marketCode}/cash-custody/destinations/{destinationId}/{verb}` | `routes/market-delegation-cash-control.js` |
| 49 | `GET /api/scans/hub/receivable` | `routes/scans.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

