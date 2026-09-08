# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **537**
- Réponses 200 `UNKNOWN` : **14**

| # | Opération | Source route |
|---:|---|---|
| 1 | `GET /api/admin/workspaces/pricing/market/{marketCode}/commercial-prices` | `routes/admin-pricing-workspace.js` |
| 2 | `GET /api/admin/workspaces/pricing/market/{marketCode}/corridor` | `routes/admin-pricing-workspace.js` |
| 3 | `POST /api/admin/workspaces/pricing/market/{marketCode}/price-observations` | `routes/admin-pricing-workspace.js` |
| 4 | `POST /api/admin/workspaces/pricing/market/{marketCode}/price-observations/{observationRef}/deactivate` | `routes/admin-pricing-workspace.js` |
| 5 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price` | `routes/admin-pricing-workspace.js` |
| 6 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/activate` | `routes/admin-pricing-workspace.js` |
| 7 | `GET /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/activation-preview` | `routes/admin-pricing-workspace.js` |
| 8 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/reset` | `routes/admin-pricing-workspace.js` |
| 9 | `GET /api/payments/mobile-money/admin/pending` | `routes/payments-mobile-money.js` |
| 10 | `GET /api/payments/mobile-money/availability` | `routes/payments-mobile-money.js` |
| 11 | `POST /api/payments/mobile-money/callback/{provider}/{transactionId}` | `routes/payments-mobile-money.js` |
| 12 | `POST /api/payments/mobile-money/initiate` | `routes/payments-mobile-money.js` |
| 13 | `GET /api/payments/mobile-money/transactions/{transactionId}` | `routes/payments-mobile-money.js` |
| 14 | `POST /api/payments/mobile-money/transactions/{transactionId}/refresh` | `routes/payments-mobile-money.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

