# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **602**
- Réponses 200 `UNKNOWN` : **42**

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
| 9 | `POST /api/hub/move` | `routes/hub.js` |
| 10 | `POST /api/hub/outcome` | `routes/hub.js` |
| 11 | `POST /api/hub/revalidate` | `routes/hub.js` |
| 12 | `POST /api/hub/transition` | `routes/hub.js` |
| 13 | `POST /api/hub/unit` | `routes/hub.js` |
| 14 | `GET /api/market-delegation/markets/{marketCode}/client-cases/disputes` | `routes/market-delegation-client-case.js` |
| 15 | `PUT /api/market-delegation/markets/{marketCode}/client-cases/disputes/{disputeId}` | `routes/market-delegation-client-case.js` |
| 16 | `GET /api/market-delegation/markets/{marketCode}/local-offer/physical-offers` | `routes/market-delegation-local-offer.js` |
| 17 | `PUT /api/market-delegation/markets/{marketCode}/local-offer/physical-offers/{physicalOfferId}` | `routes/market-delegation-local-offer.js` |
| 18 | `GET /api/market-delegation/markets/{marketCode}/local-offer/services` | `routes/market-delegation-local-offer.js` |
| 19 | `PUT /api/market-delegation/markets/{marketCode}/local-offer/services/{serviceId}` | `routes/market-delegation-local-offer.js` |
| 20 | `GET /api/market-delegation/markets/{marketCode}/network/providers` | `routes/market-delegation-provider.js` |
| 21 | `POST /api/market-delegation/markets/{marketCode}/network/providers` | `routes/market-delegation-provider.js` |
| 22 | `PUT /api/market-delegation/markets/{marketCode}/network/providers/{providerId}` | `routes/market-delegation-provider.js` |
| 23 | `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/activate` | `routes/market-delegation-provider.js` |
| 24 | `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/suspend` | `routes/market-delegation-provider.js` |
| 25 | `GET /api/market-delegation/markets/{marketCode}/network/relais` | `routes/market-delegation-network.js` |
| 26 | `POST /api/market-delegation/markets/{marketCode}/network/relais` | `routes/market-delegation-network.js` |
| 27 | `PUT /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}` | `routes/market-delegation-network.js` |
| 28 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/activate` | `routes/market-delegation-network.js` |
| 29 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/suspend` | `routes/market-delegation-network.js` |
| 30 | `GET /api/market-delegation/markets/{marketCode}/performance` | `routes/market-delegation-performance.js` |
| 31 | `GET /api/market-delegation/markets/{marketCode}/settlements` | `routes/market-delegation-settlement.js` |
| 32 | `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/receive` | `routes/market-delegation-settlement.js` |
| 33 | `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/request` | `routes/market-delegation-settlement.js` |
| 34 | `GET /api/market-delegation/markets/{marketCode}/structure-events` | `routes/market-delegation-structure-event.js` |
| 35 | `POST /api/market-delegation/markets/{marketCode}/structure-events` | `routes/market-delegation-structure-event.js` |
| 36 | `GET /api/payments/mobile-money/admin/pending` | `routes/payments-mobile-money.js` |
| 37 | `GET /api/payments/mobile-money/availability` | `routes/payments-mobile-money.js` |
| 38 | `POST /api/payments/mobile-money/callback/{provider}/{transactionId}` | `routes/payments-mobile-money.js` |
| 39 | `POST /api/payments/mobile-money/initiate` | `routes/payments-mobile-money.js` |
| 40 | `GET /api/payments/mobile-money/transactions/{transactionId}` | `routes/payments-mobile-money.js` |
| 41 | `POST /api/payments/mobile-money/transactions/{transactionId}/refresh` | `routes/payments-mobile-money.js` |
| 42 | `POST /api/payments/mobile-money/webhook/{provider}` | `routes/payments-mobile-money.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

