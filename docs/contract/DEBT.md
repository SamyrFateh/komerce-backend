# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **514**
- Réponses 200 `UNKNOWN` : **28**

| # | Opération | Source route |
|---:|---|---|
| 1 | `GET /api/admin/demo/orders/{orderId}/timeline` | `routes/admin/demo-order-flow.js` |
| 2 | `GET /api/admin/entities/clients` | `routes/admin-client-index.js` |
| 3 | `GET /api/admin/entities/clients/market/{marketCode}` | `routes/admin-client-index.js` |
| 4 | `GET /api/admin/workspaces/pricing/market/{marketCode}` | `routes/admin-pricing-workspace.js` |
| 5 | `POST /api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/reset` | `routes/admin-pricing-workspace.js` |
| 6 | `POST /api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/toggle` | `routes/admin-pricing-workspace.js` |
| 7 | `POST /api/admin/workspaces/pricing/market/{marketCode}/cost-components/{key}/update` | `routes/admin-pricing-workspace.js` |
| 8 | `GET /api/auth/me/documents` | `routes/documents.js` |
| 9 | `GET /api/auth/me/documents/{id}/download` | `routes/documents.js` |
| 10 | `GET /api/auth/me/notifications` | `routes/client-notifications.js` |
| 11 | `POST /api/auth/me/notifications/{id}/ack` | `routes/client-notifications.js` |
| 12 | `DELETE /api/auth/me/pickup-authorization` | `routes/auth.js` |
| 13 | `GET /api/auth/me/pickup-authorization` | `routes/auth.js` |
| 14 | `PUT /api/auth/me/pickup-authorization` | `routes/auth.js` |
| 15 | `GET /api/local-stock/availability` | `routes/local-stock.js` |
| 16 | `GET /api/pickup/exceptional-pickup/{orderId}` | `routes/pickup-secret.js` |
| 17 | `POST /api/pickup/exceptional-pickup/{orderId}/collect` | `routes/pickup-secret.js` |
| 18 | `GET /api/products/{id}/detail` | `routes/catalog-product-detail.js` |
| 19 | `GET /api/products/{id}/skus` | `routes/products.js` |
| 20 | `POST /api/products/{id}/skus` | `routes/products.js` |
| 21 | `DELETE /api/products/{id}/skus/{skuId}` | `routes/products.js` |
| 22 | `GET /api/products/{id}/skus/readiness` | `routes/products.js` |
| 23 | `POST /api/providers-services/inquiries` | `routes/providers-services.js` |
| 24 | `GET /api/providers-services/physical-offers/{id}` | `routes/providers-services.js` |
| 25 | `GET /api/providers-services/services/{id}` | `routes/providers-services.js` |
| 26 | `GET /api/shared-carts/library` | `routes/shared-cart.js` |
| 27 | `POST /api/shared-carts/save` | `routes/shared-cart.js` |
| 28 | `DELETE /api/shared-carts/saved/{sharedCartId}` | `routes/shared-cart-saved.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.
