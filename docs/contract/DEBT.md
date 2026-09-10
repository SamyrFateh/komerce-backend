# Dette de contrat API

> Fichier généré depuis `docs/contract/openapi.json` par `scripts/contract-debt-sync.js`.
> Ne pas maintenir cette liste à la main.

- Routes dans le contrat : **571**
- Réponses 200 `UNKNOWN` : **54**

| # | Opération | Source route |
|---:|---|---|
| 1 | `GET /api/admin/market-settlements/markets/{marketCode}/settlements` | `routes/admin-market-settlement.js` |
| 2 | `POST /api/admin/market-settlements/markets/{marketCode}/settlements/ready` | `routes/admin-market-settlement.js` |
| 3 | `POST /api/admin/market-settlements/settlements/{settlementId}/paid` | `routes/admin-market-settlement.js` |
| 4 | `GET /api/admin/workspaces/pricing/market/{marketCode}/charges` | `routes/admin-pricing-workspace.js` |
| 5 | `GET /api/admin/workspaces/pricing/market/{marketCode}/commercial-prices` | `routes/admin-pricing-workspace.js` |
| 6 | `GET /api/admin/workspaces/pricing/market/{marketCode}/corridor` | `routes/admin-pricing-workspace.js` |
| 7 | `POST /api/admin/workspaces/pricing/market/{marketCode}/price-observations` | `routes/admin-pricing-workspace.js` |
| 8 | `POST /api/admin/workspaces/pricing/market/{marketCode}/price-observations/{observationRef}/deactivate` | `routes/admin-pricing-workspace.js` |
| 9 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price` | `routes/admin-pricing-workspace.js` |
| 10 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/activate` | `routes/admin-pricing-workspace.js` |
| 11 | `GET /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/activation-preview` | `routes/admin-pricing-workspace.js` |
| 12 | `POST /api/admin/workspaces/pricing/market/{marketCode}/products/{productRef}/local-price/reset` | `routes/admin-pricing-workspace.js` |
| 13 | `GET /api/admin/workspaces/pricing/market/{marketCode}/structure-events` | `routes/admin-pricing-workspace.js` |
| 14 | `POST /api/admin/workspaces/pricing/market/{marketCode}/structure-events` | `routes/admin-pricing-workspace.js` |
| 15 | `GET /api/admin/workspaces/pricing/structure-events` | `routes/admin-pricing-workspace.js` |
| 16 | `POST /api/admin/workspaces/pricing/structure-events` | `routes/admin-pricing-workspace.js` |
| 17 | `GET /api/market-delegation/markets/{marketCode}/cash-control-policy` | `routes/market-delegation-team.js` |
| 18 | `PUT /api/market-delegation/markets/{marketCode}/cash-control-policy` | `routes/market-delegation-team.js` |
| 19 | `GET /api/market-delegation/markets/{marketCode}/catalog/exposure` | `routes/market-delegation-team.js` |
| 20 | `PUT /api/market-delegation/markets/{marketCode}/catalog/exposure/{productId}` | `routes/market-delegation-team.js` |
| 21 | `GET /api/market-delegation/markets/{marketCode}/client-cases/disputes` | `routes/market-delegation-team.js` |
| 22 | `PUT /api/market-delegation/markets/{marketCode}/client-cases/disputes/{disputeId}` | `routes/market-delegation-team.js` |
| 23 | `GET /api/market-delegation/markets/{marketCode}/local-offer/physical-offers` | `routes/market-delegation-team.js` |
| 24 | `PUT /api/market-delegation/markets/{marketCode}/local-offer/physical-offers/{physicalOfferId}` | `routes/market-delegation-team.js` |
| 25 | `GET /api/market-delegation/markets/{marketCode}/local-offer/services` | `routes/market-delegation-team.js` |
| 26 | `PUT /api/market-delegation/markets/{marketCode}/local-offer/services/{serviceId}` | `routes/market-delegation-team.js` |
| 27 | `GET /api/market-delegation/markets/{marketCode}/network/providers` | `routes/market-delegation-team.js` |
| 28 | `POST /api/market-delegation/markets/{marketCode}/network/providers` | `routes/market-delegation-team.js` |
| 29 | `PUT /api/market-delegation/markets/{marketCode}/network/providers/{providerId}` | `routes/market-delegation-team.js` |
| 30 | `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/activate` | `routes/market-delegation-team.js` |
| 31 | `POST /api/market-delegation/markets/{marketCode}/network/providers/{providerId}/suspend` | `routes/market-delegation-team.js` |
| 32 | `GET /api/market-delegation/markets/{marketCode}/network/relais` | `routes/market-delegation-team.js` |
| 33 | `POST /api/market-delegation/markets/{marketCode}/network/relais` | `routes/market-delegation-team.js` |
| 34 | `PUT /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}` | `routes/market-delegation-team.js` |
| 35 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/activate` | `routes/market-delegation-team.js` |
| 36 | `POST /api/market-delegation/markets/{marketCode}/network/relais/{relaisId}/suspend` | `routes/market-delegation-team.js` |
| 37 | `GET /api/market-delegation/markets/{marketCode}/settlements` | `routes/market-delegation-team.js` |
| 38 | `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/receive` | `routes/market-delegation-team.js` |
| 39 | `POST /api/market-delegation/markets/{marketCode}/settlements/{settlementId}/request` | `routes/market-delegation-team.js` |
| 40 | `GET /api/market-delegation/markets/{marketCode}/structure-events` | `routes/market-delegation-team.js` |
| 41 | `POST /api/market-delegation/markets/{marketCode}/structure-events` | `routes/market-delegation-team.js` |
| 42 | `GET /api/market-delegation/markets/{marketCode}/team` | `routes/market-delegation-team.js` |
| 43 | `DELETE /api/market-delegation/markets/{marketCode}/team/{membershipId}` | `routes/market-delegation-team.js` |
| 44 | `PUT /api/market-delegation/markets/{marketCode}/team/{membershipId}/capabilities` | `routes/market-delegation-team.js` |
| 45 | `POST /api/market-delegation/markets/{marketCode}/team/invitations` | `routes/market-delegation-team.js` |
| 46 | `DELETE /api/market-delegation/markets/{marketCode}/team/invitations/{invitationId}` | `routes/market-delegation-team.js` |
| 47 | `POST /api/market-delegation/team/invitations/{token}/accept` | `routes/market-delegation-team.js` |
| 48 | `GET /api/payments/mobile-money/admin/pending` | `routes/payments-mobile-money.js` |
| 49 | `GET /api/payments/mobile-money/availability` | `routes/payments-mobile-money.js` |
| 50 | `POST /api/payments/mobile-money/callback/{provider}/{transactionId}` | `routes/payments-mobile-money.js` |
| 51 | `POST /api/payments/mobile-money/initiate` | `routes/payments-mobile-money.js` |
| 52 | `GET /api/payments/mobile-money/transactions/{transactionId}` | `routes/payments-mobile-money.js` |
| 53 | `POST /api/payments/mobile-money/transactions/{transactionId}/refresh` | `routes/payments-mobile-money.js` |
| 54 | `POST /api/payments/mobile-money/webhook/{provider}` | `routes/payments-mobile-money.js` |

Chaque ligne doit être fermée par une preuve de forme de réponse (test, lecture de route/service fiable ou contrat explicite), jamais par une forme inventée.

