# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **529**
- Réponses 200 `UNKNOWN` : **6**

| # | Opération | Source route |
|---:|---|---|
| 1 | `GET /api/payments/mobile-money/admin/pending` | `routes/payments-mobile-money.js` |
| 2 | `GET /api/payments/mobile-money/availability` | `routes/payments-mobile-money.js` |
| 3 | `POST /api/payments/mobile-money/callback/{provider}/{transactionId}` | `routes/payments-mobile-money.js` |
| 4 | `POST /api/payments/mobile-money/initiate` | `routes/payments-mobile-money.js` |
| 5 | `GET /api/payments/mobile-money/transactions/{transactionId}` | `routes/payments-mobile-money.js` |
| 6 | `POST /api/payments/mobile-money/transactions/{transactionId}/refresh` | `routes/payments-mobile-money.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

