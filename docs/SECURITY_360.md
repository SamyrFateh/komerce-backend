# Security 360 — couverture des gardes (hybride runtime + statique)

> 2026-06-20T19:27:38.473Z — 460 endpoints

| Niveau | Compte |
|---|---|
| 🟢 PROTECTED | 363 |
| ⚪ PUBLIC (légitime) | 5 |
| 🟠 UNPROTECTED | 37 |
| 🔴 ADMIN_NO_GUARD | 2 |
| ❔ UNKNOWN (statique n'a pas atteint — à auditer) | 53 |

## Flaggés

- ❔ `GET /api/admin/dashboard` — UNKNOWN
- 🔴 `GET /api/admin/pricing-components/{id}` — ADMIN_NO_GUARD
- 🔴 `GET /api/admin/pricing-components` — ADMIN_NO_GUARD
- ❔ `POST /api/admin/sourcing/candidates/{id}/import-product` — UNKNOWN
- ❔ `POST /api/admin/sourcing/candidates/{id}/reject` — UNKNOWN
- ❔ `POST /api/admin/sourcing/candidates/{id}/scan` — UNKNOWN
- ❔ `POST /api/admin/sourcing/candidates/{id}/watchlist` — UNKNOWN
- ❔ `GET /api/admin/sourcing/candidates/{id}` — UNKNOWN
- ❔ `PUT /api/admin/sourcing/candidates/{id}` — UNKNOWN
- ❔ `POST /api/admin/sourcing/candidates/scan-batch` — UNKNOWN
- ❔ `GET /api/admin/sourcing/candidates` — UNKNOWN
- ❔ `POST /api/admin/sourcing/catalogs/import` — UNKNOWN
- ❔ `GET /api/admin/sourcing/catalogs` — UNKNOWN
- ❔ `GET /api/admin/sourcing/connectors` — UNKNOWN
- 🟠 `POST /api/auth/admin-reset` — UNPROTECTED
- 🟠 `POST /api/auth/guest-checkout` — UNPROTECTED
- ❔ `GET /api/auth/invoices` — UNKNOWN
- ❔ `GET /api/auth/magic-link/validate` — UNKNOWN
- ❔ `POST /api/auth/magic-link` — UNKNOWN
- 🟠 `POST /api/auth/orders-by-phone` — UNPROTECTED
- ❔ `GET /api/auth/orders` — UNKNOWN
- 🟠 `POST /api/auth/otp/request` — UNPROTECTED
- 🟠 `POST /api/auth/otp/test-reset` — UNPROTECTED
- 🟠 `POST /api/auth/otp/verify` — UNPROTECTED
- 🟠 `GET /api/boutique/suggestions` — UNPROTECTED
- 🟠 `GET /api/categories` — UNPROTECTED
- 🟠 `GET /api/client/magic-link/validate` — UNPROTECTED
- 🟠 `POST /api/client/magic-link` — UNPROTECTED
- ❔ `POST /api/hub/auto-distribute/cleanup` — UNKNOWN
- ❔ `GET /api/hub/auto-distribute` — UNKNOWN
- ❔ `POST /api/hub/auto-distribute` — UNKNOWN
- ❔ `POST /api/hub/orders/mark-ordered` — UNKNOWN
- 🟠 `GET /api/invoices/public/{token}` — UNPROTECTED
- 🟠 `GET /api/loyalty/tiers` — UNPROTECTED
- 🟠 `GET /api/modules/{type}` — UNPROTECTED
- 🟠 `GET /api/modules/fabrics` — UNPROTECTED
- 🟠 `GET /api/modules/models` — UNPROTECTED
- 🟠 `POST /api/modules/price` — UNPROTECTED
- 🟠 `GET /api/modules` — UNPROTECTED
- ❔ `POST /api/orders/{id}/qr-token` — UNKNOWN
- 🟠 `GET /api/orders/retrait/{token}` — UNPROTECTED
- 🟠 `GET /api/payments/config` — UNPROTECTED
- 🟠 `POST /api/payments/paypal/capture/{paypalOrderId}` — UNPROTECTED
- 🟠 `POST /api/payments/paypal/create-order` — UNPROTECTED
- 🟠 `POST /api/pricing/calculate` — UNPROTECTED
- 🟠 `POST /api/pricing/couture` — UNPROTECTED
- 🟠 `GET /api/products/{id}` — UNPROTECTED
- 🟠 `GET /api/products/categories` — UNPROTECTED
- 🟠 `GET /api/products/subcategories` — UNPROTECTED
- 🟠 `GET /api/products` — UNPROTECTED
- 🟠 `GET /api/relais/{id}` — UNPROTECTED
- 🟠 `GET /api/relais/public` — UNPROTECTED
- 🟠 `GET /api/relais` — UNPROTECTED
- ❔ `GET /api/shared-carts/{id}/as-cart-items` — UNKNOWN
- ❔ `POST /api/shared-carts/{id}/awaiting-choice/adjust` — UNKNOWN
- ❔ `POST /api/shared-carts/{id}/awaiting-choice/cancel` — UNKNOWN
- ❔ `POST /api/shared-carts/{id}/awaiting-choice/complete` — UNKNOWN
- ❔ `POST /api/shared-carts/{id}/cancel` — UNKNOWN
- ❔ `POST /api/shared-carts/{id}/close` — UNKNOWN
- ❔ `POST /api/shared-carts/{id}/extend-window` — UNKNOWN
- ❔ `POST /api/shared-carts/{id}/finalize` — UNKNOWN
- ❔ `PUT /api/shared-carts/{id}/items` — UNKNOWN
- ❔ `GET /api/shared-carts/{id}` — UNKNOWN
- ❔ `POST /api/shared-carts/from-basket` — UNKNOWN
- ❔ `POST /api/shared-carts/from-cart-items` — UNKNOWN
- ❔ `POST /api/shared-carts/from-order` — UNKNOWN
- ❔ `GET /api/shared-carts/mine` — UNKNOWN
- 🟠 `POST /api/shared-carts/public/{token}/contributions/cash` — UNPROTECTED
- ❔ `POST /api/shared-carts/public/{token}/contributions` — UNKNOWN
- ❔ `DELETE /api/shared-carts/public/{token}/estimations/{estimationId}` — UNKNOWN
- ❔ `GET /api/shared-carts/public/{token}/estimations/by-phone` — UNKNOWN
- ❔ `GET /api/shared-carts/public/{token}/estimations` — UNKNOWN
- ❔ `POST /api/shared-carts/public/{token}/estimations` — UNKNOWN
- ❔ `GET /api/shared-carts/public/{token}` — UNKNOWN
- 🟠 `PATCH /api/shares/{token}/contributions/{id}` — UNPROTECTED
- 🟠 `POST /api/shares/{token}/contributions` — UNPROTECTED
- 🟠 `GET /api/shares/{token}` — UNPROTECTED
- 🟠 `POST /api/shares` — UNPROTECTED
- 🟠 `POST /api/tracking/{token}/verify-pickup` — UNPROTECTED
- 🟠 `GET /api/tracking/{token}` — UNPROTECTED
- ❔ `GET /api/v2/alerts` — UNKNOWN
- ❔ `GET /api/v2/parcels/{id}/orders` — UNKNOWN
- ❔ `GET /api/v2/parcels/{id}/scans` — UNKNOWN
- ❔ `GET /api/v2/parcels/{id}` — UNKNOWN
- ❔ `GET /api/v2/parcels/{ref}/detail` — UNKNOWN
- ❔ `GET /api/v2/parcels/{ref}/label` — UNKNOWN
- ❔ `GET /api/v2/reconciliation/summary` — UNKNOWN
- ❔ `GET /health/metrics` — UNKNOWN
- ❔ `GET /health/ready` — UNKNOWN
- ❔ `GET /health` — UNKNOWN
- ❔ `GET /webhook/meta-whatsapp` — UNKNOWN
- ❔ `POST /webhook/meta-whatsapp` — UNKNOWN
