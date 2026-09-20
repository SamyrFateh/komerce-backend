# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **592**
- Réponses 200 `UNKNOWN` : **48**

| # | Opération | Source route |
|---:|---|---|
| 1 | `GET /api/admin/dashboard/orders` | `routes/admin-dashboard-market.js` |
| 2 | `GET /api/admin/dashboard/orders/market/{marketCode}` | `routes/admin-dashboard-market.js` |
| 3 | `GET /api/admin/market-settlements/markets/{marketCode}/settlements` | `routes/admin-market-settlement.js` |
| 4 | `POST /api/admin/market-settlements/markets/{marketCode}/settlements/ready` | `routes/admin-market-settlement.js` |
| 5 | `POST /api/admin/market-settlements/settlements/{settlementId}/paid` | `routes/admin-market-settlement.js` |
| 6 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/activate` | `routes/admin-sourcing-workspace.js` |
| 7 | `POST /api/admin/workspaces/sourcing/sources/{sourceRef}/deactivate` | `routes/admin-sourcing-workspace.js` |
| 8 | `PUT /api/auth/me/password` | `routes/auth.js` |
| 9 | `POST /api/auth/step-up/otp/request` | `routes/auth-step-up-otp.js` |
| 10 | `POST /api/auth/step-up/otp/verify` | `routes/auth-step-up-otp.js` |
| 11 | `POST /api/hub/move` | `routes/hub.js` |
| 12 | `POST /api/hub/outcome` | `routes/hub.js` |
| 13 | `POST /api/hub/revalidate` | `routes/hub.js` |
| 14 | `POST /api/hub/transition` | `routes/hub.js` |
| 15 | `POST /api/hub/unit` | `routes/hub.js` |
| 16 | `GET /api/integrations/aliexpress/oauth/callback` | `routes/integrations-aliexpress.js` |
| 17 | `POST /api/integrations/aliexpress/oauth/refresh` | `routes/integrations-aliexpress.js` |
| 18 | `GET /api/integrations/aliexpress/oauth/start` | `routes/integrations-aliexpress.js` |
| 19 | `GET /api/integrations/aliexpress/status` | `routes/integrations-aliexpress.js` |
| 20 | `GET /api/market-delegation/markets/{marketCode}/client-cases/disputes` | `routes/market-delegation-client-case.js` |
| 21 | `PUT /api/market-delegation/markets/{marketCode}/client-cases/disputes/{disputeId}` | `routes/market-delegation-client-case.js` |
| 22 | `GET /api/market-delegation/markets/{marketCode}/local-offer/physical-offers` | `routes/market-delegation-local-offer.js` |
| 23 | `PUT /api/market-delegation/markets/{marketCode}/local-offer/physical-offers/{physicalOfferId}` | `routes/market-delegation-local-offer.js` |
| 24 | `GET /api/market-delegation/markets/{marketCode}/local-offer/services` | `routes/market-delegation-local-offer.js` |
| 25 | `PUT /api/market-delegation/markets/{marketCode}/local-offer/services/{serviceId}` | `routes/market-delegation-local-offer.js` |
| 26 | `GET /api/market-delegation/markets/{marketCode}/network/providers` | `routes/market-delegation-provider.js` |
| 27 | `POST /api/market-delegation/markets/{marketCode}/network/providers` | `routes/market-delegation-provider.js` |
| 28 | `PUT /api/market-delegation/markets/{marketCode}/network/providers/{providerId}` | `routes/market-delegation-provider.js` |
| 29 | `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/activate` | `routes/market-delegation-provider.js` |
| 30 | `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/suspend` | `routes/market-delegation-provider.js` |
| 31 | `GET /api/market-delegation/markets/{marketCode}/network/relais` | `routes/market-delegation-network.js` |
| 32 | `POST /api/market-delegation/markets/{marketCode}/network/relais` | `routes/market-delegation-network.js` |
| 33 | `PUT /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}` | `routes/market-delegation-network.js` |
| 34 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/activate` | `routes/market-delegation-network.js` |
| 35 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/suspend` | `routes/market-delegation-network.js` |
| 36 | `GET /api/market-delegation/markets/{marketCode}/performance` | `routes/market-delegation-performance.js` |
| 37 | `GET /api/market-delegation/markets/{marketCode}/settlements` | `routes/market-delegation-settlement.js` |
| 38 | `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/receive` | `routes/market-delegation-settlement.js` |
| 39 | `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/request` | `routes/market-delegation-settlement.js` |
| 40 | `GET /api/market-delegation/markets/{marketCode}/structure-events` | `routes/market-delegation-structure-event.js` |
| 41 | `POST /api/market-delegation/markets/{marketCode}/structure-events` | `routes/market-delegation-structure-event.js` |
| 42 | `GET /api/payments/mobile-money/admin/pending` | `routes/payments-mobile-money.js` |
| 43 | `GET /api/payments/mobile-money/availability` | `routes/payments-mobile-money.js` |
| 44 | `POST /api/payments/mobile-money/callback/{provider}/{transactionId}` | `routes/payments-mobile-money.js` |
| 45 | `POST /api/payments/mobile-money/initiate` | `routes/payments-mobile-money.js` |
| 46 | `GET /api/payments/mobile-money/transactions/{transactionId}` | `routes/payments-mobile-money.js` |
| 47 | `POST /api/payments/mobile-money/transactions/{transactionId}/refresh` | `routes/payments-mobile-money.js` |
| 48 | `POST /api/payments/mobile-money/webhook/{provider}` | `routes/payments-mobile-money.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

