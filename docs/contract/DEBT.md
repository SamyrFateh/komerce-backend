# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **761**
- Réponses 200 `UNKNOWN` : **80**

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
| 17 | `GET /api/admin/markets/{marketCode}/transport-sale-rates` | `routes/admin-market-control-plane.js` |
| 18 | `PUT /api/admin/markets/{marketCode}/transport-sale-rates/{rateKey}` | `routes/admin-market-control-plane.js` |
| 19 | `POST /api/admin/orders/{id}/items/{itemId}/refund-reservations` | `routes/admin/orders.js` |
| 20 | `POST /api/admin/orders/{id}/items/{itemId}/refund-reservations/{reservationId}/execute` | `routes/admin/orders.js` |
| 21 | `POST /api/admin/orders/{id}/items/{itemId}/refund-reservations/{reservationId}/reconcile` | `routes/admin/orders.js` |
| 22 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/control` | `routes/admin-finance-accounting-workspace.js` |
| 23 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/receipt` | `routes/admin-finance-accounting-workspace.js` |
| 24 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/{depositRef}/reversal` | `routes/admin-finance-accounting-workspace.js` |
| 25 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/losses` | `routes/admin-finance-accounting-workspace.js` |
| 26 | `POST /api/admin/workspaces/accounting/market/{marketCode}/custody/losses/{lossId}/reversal` | `routes/admin-finance-accounting-workspace.js` |
| 27 | `GET /api/admin/workspaces/accounting/market/{marketCode}/journal/{view}(summary|movements|documents|reconciliation)` | `routes/admin-finance-accounting-workspace.js` |
| 28 | `POST /api/admin/workspaces/catalog/products/{productRef}/classify` | `routes/admin-catalog-workspace.js` |
| 29 | `GET /api/admin/workspaces/catalog/products/{productRef}/quality` | `routes/admin-catalog-workspace.js` |
| 30 | `POST /api/admin/workspaces/catalog/products/{productRef}/quality/{action}` | `routes/admin-catalog-workspace.js` |
| 31 | `POST /api/admin/workspaces/catalog/products/{productRef}/recover-source-media` | `routes/admin-catalog-workspace.js` |
| 32 | `POST /api/admin/workspaces/catalog/refinery/{productRef}/prepare-fr` | `routes/admin-catalog-workspace.js` |
| 33 | `POST /api/admin/workspaces/operations/market/{marketCode}/bags` | `routes/admin-operations-workspace.js` |
| 34 | `POST /api/admin/workspaces/operations/market/{marketCode}/bags/{unitId}/close` | `routes/admin-operations-workspace.js` |
| 35 | `POST /api/admin/workspaces/operations/market/{marketCode}/bags/{unitId}/deposit` | `routes/admin-operations-workspace.js` |
| 36 | `POST /api/admin/workspaces/operations/market/{marketCode}/boxes` | `routes/admin-operations-workspace.js` |
| 37 | `POST /api/admin/workspaces/operations/market/{marketCode}/boxes/{unitId}/advance` | `routes/admin-operations-workspace.js` |
| 38 | `POST /api/admin/workspaces/operations/market/{marketCode}/boxes/{unitId}/bags` | `routes/admin-operations-workspace.js` |
| 39 | `POST /api/admin/workspaces/operations/market/{marketCode}/boxes/{unitId}/detach` | `routes/admin-operations-workspace.js` |
| 40 | `POST /api/admin/workspaces/operations/market/{marketCode}/boxes/{unitId}/fill` | `routes/admin-operations-workspace.js` |
| 41 | `POST /api/admin/workspaces/operations/market/{marketCode}/orders/{reference}/distribute` | `routes/admin-operations-workspace.js` |
| 42 | `GET /api/admin/workspaces/operations/market/{marketCode}/relay-shipments` | `routes/admin-operations-workspace.js` |
| 43 | `GET /api/admin/workspaces/operations/market/{marketCode}/relay-shipments/{reference}/bags/{bagRef}` | `routes/admin-operations-workspace.js` |
| 44 | `POST /api/admin/workspaces/operations/market/{marketCode}/relay-shipments/{reference}/receive` | `routes/admin-operations-workspace.js` |
| 45 | `GET /api/admin/workspaces/operations/market/{marketCode}/supply/physical-code` | `routes/admin-operations-workspace.js` |
| 46 | `POST /api/admin/workspaces/pricing/market/{marketCode}/decision-policy/preview` | `routes/admin-pricing-workspace.js` |
| 47 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/forecast-preview` | `routes/admin-pricing-workspace.js` |
| 48 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/change-active` | `routes/admin-pricing-workspace.js` |
| 49 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/price-preview` | `routes/admin-pricing-workspace.js` |
| 50 | `POST /api/admin/workspaces/pricing/market/{marketCode}/structure-charges` | `routes/admin-pricing-workspace.js` |
| 51 | `PATCH /api/admin/workspaces/pricing/market/{marketCode}/structure-charges/{chargeId}/description` | `routes/admin-pricing-workspace.js` |
| 52 | `GET /api/admin/workspaces/shipping-customs/market/{marketCode}/international` | `routes/admin-shipping-customs-workspace.js` |
| 53 | `GET /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}` | `routes/admin-shipping-customs-workspace.js` |
| 54 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/costs` | `routes/admin-shipping-customs-workspace.js` |
| 55 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/customs-amount` | `routes/admin-shipping-customs-workspace.js` |
| 56 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/freight` | `routes/admin-shipping-customs-workspace.js` |
| 57 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/link-customs` | `routes/admin-shipping-customs-workspace.js` |
| 58 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/reconcile-costs` | `routes/admin-shipping-customs-workspace.js` |
| 59 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/tracking` | `routes/admin-shipping-customs-workspace.js` |
| 60 | `POST /api/admin/workspaces/shipping-customs/market/{marketCode}/international/{reference}/transition` | `routes/admin-shipping-customs-workspace.js` |
| 61 | `GET /api/admin/workspaces/sourcing/candidates/{candidateRef}/boutique-category-options` | `routes/admin-sourcing-workspace.js` |
| 62 | `GET /api/admin/workspaces/sourcing/candidates/{candidateRef}/category-options` | `routes/admin-sourcing-workspace.js` |
| 63 | `POST /api/admin/workspaces/sourcing/candidates/{candidateRef}/confirm-boutique-category` | `routes/admin-sourcing-workspace.js` |
| 64 | `POST /api/admin/workspaces/sourcing/candidates/{candidateRef}/resolve-category` | `routes/admin-sourcing-workspace.js` |
| 65 | `GET /api/hub-dash/dubai` | `routes/hub-dashboard.js` |
| 66 | `POST /api/hub-dash/parcels/{id}/reassign-item` | `routes/hub-dashboard.js` |
| 67 | `GET /api/hub/physical-codes/resolve` | `routes/hub.js` |
| 68 | `GET /api/market-delegation/catalog/authorized-markets` | `routes/market-delegation-catalog.js` |
| 69 | `GET /api/market-delegation/markets/{marketCode}/cash-custody` | `routes/market-delegation-cash-control.js` |
| 70 | `POST /api/market-delegation/markets/{marketCode}/cash-custody/destinations` | `routes/market-delegation-cash-control.js` |
| 71 | `POST /api/market-delegation/markets/{marketCode}/cash-custody/destinations/{destinationId}/{verb}` | `routes/market-delegation-cash-control.js` |
| 72 | `GET /api/market-delegation/markets/{marketCode}/network/relais-agents` | `routes/market-delegation-network.js` |
| 73 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/agents` | `routes/market-delegation-network.js` |
| 74 | `GET /api/purchasing/authorizations/grants` | `routes/purchasing.js` |
| 75 | `POST /api/purchasing/authorizations/grants` | `routes/purchasing.js` |
| 76 | `POST /api/purchasing/authorizations/grants/{grant_id}/revoke` | `routes/purchasing.js` |
| 77 | `POST /api/purchasing/lines/{id}/change-supplier` | `routes/purchasing.js` |
| 78 | `POST /api/purchasing/po/{po_id}/authorize-commitment` | `routes/purchasing.js` |
| 79 | `POST /api/purchasing/po/{po_id}/authorize-payment` | `routes/purchasing.js` |
| 80 | `GET /api/scans/hub/receivable` | `routes/scans.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

