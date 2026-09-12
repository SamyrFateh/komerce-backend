# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **580**
- Réponses 200 `UNKNOWN` : **36**

| # | Opération | Source route |
|---:|---|---|
| 1 | `GET /api/admin/market-settlements/markets/{marketCode}/settlements` | `routes/admin-market-settlement.js` |
| 2 | `POST /api/admin/market-settlements/markets/{marketCode}/settlements/ready` | `routes/admin-market-settlement.js` |
| 3 | `POST /api/admin/market-settlements/settlements/{settlementId}/paid` | `routes/admin-market-settlement.js` |
| 4 | `GET /api/integrations/aliexpress/oauth/callback` | `routes/integrations-aliexpress.js` |
| 5 | `POST /api/integrations/aliexpress/oauth/refresh` | `routes/integrations-aliexpress.js` |
| 6 | `GET /api/integrations/aliexpress/oauth/start` | `routes/integrations-aliexpress.js` |
| 7 | `GET /api/integrations/aliexpress/status` | `routes/integrations-aliexpress.js` |
| 8 | `GET /api/market-delegation/markets/{marketCode}/client-cases/disputes` | `routes/market-delegation-team.js` |
| 9 | `PUT /api/market-delegation/markets/{marketCode}/client-cases/disputes/{disputeId}` | `routes/market-delegation-team.js` |
| 10 | `GET /api/market-delegation/markets/{marketCode}/local-offer/physical-offers` | `routes/market-delegation-team.js` |
| 11 | `PUT /api/market-delegation/markets/{marketCode}/local-offer/physical-offers/{physicalOfferId}` | `routes/market-delegation-team.js` |
| 12 | `GET /api/market-delegation/markets/{marketCode}/local-offer/services` | `routes/market-delegation-team.js` |
| 13 | `PUT /api/market-delegation/markets/{marketCode}/local-offer/services/{serviceId}` | `routes/market-delegation-team.js` |
| 14 | `GET /api/market-delegation/markets/{marketCode}/network/providers` | `routes/market-delegation-team.js` |
| 15 | `POST /api/market-delegation/markets/{marketCode}/network/providers` | `routes/market-delegation-team.js` |
| 16 | `PUT /api/market-delegation/markets/{marketCode}/network/providers/{providerId}` | `routes/market-delegation-team.js` |
| 17 | `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/activate` | `routes/market-delegation-team.js` |
| 18 | `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/suspend` | `routes/market-delegation-team.js` |
| 19 | `GET /api/market-delegation/markets/{marketCode}/network/relais` | `routes/market-delegation-team.js` |
| 20 | `POST /api/market-delegation/markets/{marketCode}/network/relais` | `routes/market-delegation-team.js` |
| 21 | `PUT /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}` | `routes/market-delegation-team.js` |
| 22 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/activate` | `routes/market-delegation-team.js` |
| 23 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/suspend` | `routes/market-delegation-team.js` |
| 24 | `GET /api/market-delegation/markets/{marketCode}/performance` | `routes/market-delegation-team.js` |
| 25 | `GET /api/market-delegation/markets/{marketCode}/settlements` | `routes/market-delegation-team.js` |
| 26 | `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/receive` | `routes/market-delegation-team.js` |
| 27 | `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/request` | `routes/market-delegation-team.js` |
| 28 | `GET /api/market-delegation/markets/{marketCode}/structure-events` | `routes/market-delegation-team.js` |
| 29 | `POST /api/market-delegation/markets/{marketCode}/structure-events` | `routes/market-delegation-team.js` |
| 30 | `GET /api/payments/mobile-money/admin/pending` | `routes/payments-mobile-money.js` |
| 31 | `GET /api/payments/mobile-money/availability` | `routes/payments-mobile-money.js` |
| 32 | `POST /api/payments/mobile-money/callback/{provider}/{transactionId}` | `routes/payments-mobile-money.js` |
| 33 | `POST /api/payments/mobile-money/initiate` | `routes/payments-mobile-money.js` |
| 34 | `GET /api/payments/mobile-money/transactions/{transactionId}` | `routes/payments-mobile-money.js` |
| 35 | `POST /api/payments/mobile-money/transactions/{transactionId}/refresh` | `routes/payments-mobile-money.js` |
| 36 | `POST /api/payments/mobile-money/webhook/{provider}` | `routes/payments-mobile-money.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

