# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **602**
- Réponses 200 `UNKNOWN` : **15**

| # | Opération | Source route |
|---:|---|---|
| 1 | `GET /api/admin/dashboard/orders` | `routes/admin-dashboard-market.js` |
| 2 | `GET /api/admin/dashboard/orders/market/{marketCode}` | `routes/admin-dashboard-market.js` |
| 3 | `GET /api/admin/market-settlements/markets/{marketCode}/settlements` | `routes/admin-market-settlement.js` |
| 4 | `POST /api/admin/market-settlements/markets/{marketCode}/settlements/ready` | `routes/admin-market-settlement.js` |
| 5 | `POST /api/admin/market-settlements/settlements/{settlementId}/paid` | `routes/admin-market-settlement.js` |
| 6 | `PUT /api/auth/me/password` | `routes/auth.js` |
| 7 | `POST /api/auth/step-up/otp/request` | `routes/auth-step-up-otp.js` |
| 8 | `POST /api/auth/step-up/otp/verify` | `routes/auth-step-up-otp.js` |
| 9 | `GET /api/payments/mobile-money/admin/pending` | `routes/payments-mobile-money.js` |
| 10 | `GET /api/payments/mobile-money/availability` | `routes/payments-mobile-money.js` |
| 11 | `POST /api/payments/mobile-money/callback/{provider}/{transactionId}` | `routes/payments-mobile-money.js` |
| 12 | `POST /api/payments/mobile-money/initiate` | `routes/payments-mobile-money.js` |
| 13 | `GET /api/payments/mobile-money/transactions/{transactionId}` | `routes/payments-mobile-money.js` |
| 14 | `POST /api/payments/mobile-money/transactions/{transactionId}/refresh` | `routes/payments-mobile-money.js` |
| 15 | `POST /api/payments/mobile-money/webhook/{provider}` | `routes/payments-mobile-money.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

