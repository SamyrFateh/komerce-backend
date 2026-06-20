# Security 360 — couverture des gardes (hybride runtime + statique)

> 2026-06-20T20:39:14.879Z — 460 endpoints

| Niveau | Compte |
|---|---|
| 🟢 PROTECTED | 402 |
| ⚪ PUBLIC (légitime) | 5 |
| 🟠 UNPROTECTED | 46 |
| 🔴 ADMIN_NO_GUARD | 2 |
| ❔ UNKNOWN (statique n'a pas atteint — à auditer) | 5 |

## Flaggés

- 🔴 `GET /api/admin/pricing-components/{id}` — ADMIN_NO_GUARD
- 🔴 `GET /api/admin/pricing-components` — ADMIN_NO_GUARD
- 🟠 `POST /api/auth/admin-reset` — UNPROTECTED
- 🟠 `POST /api/auth/guest-checkout` — UNPROTECTED
- 🟠 `GET /api/auth/magic-link/validate` — UNPROTECTED
- 🟠 `POST /api/auth/magic-link` — UNPROTECTED
- 🟠 `POST /api/auth/orders-by-phone` — UNPROTECTED
- 🟠 `POST /api/auth/otp/request` — UNPROTECTED
- 🟠 `POST /api/auth/otp/test-reset` — UNPROTECTED
- 🟠 `POST /api/auth/otp/verify` — UNPROTECTED
- 🟠 `GET /api/boutique/suggestions` — UNPROTECTED
- 🟠 `GET /api/categories` — UNPROTECTED
- 🟠 `GET /api/client/magic-link/validate` — UNPROTECTED
- 🟠 `POST /api/client/magic-link` — UNPROTECTED
- 🟠 `GET /api/invoices/public/{token}` — UNPROTECTED
- 🟠 `GET /api/loyalty/tiers` — UNPROTECTED
- 🟠 `GET /api/modules/{type}` — UNPROTECTED
- 🟠 `GET /api/modules/fabrics` — UNPROTECTED
- 🟠 `GET /api/modules/models` — UNPROTECTED
- 🟠 `POST /api/modules/price` — UNPROTECTED
- 🟠 `GET /api/modules` — UNPROTECTED
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
- 🟠 `POST /api/shared-carts/public/{token}/contributions/cash` — UNPROTECTED
- 🟠 `POST /api/shared-carts/public/{token}/contributions` — UNPROTECTED
- 🟠 `DELETE /api/shared-carts/public/{token}/estimations/{estimationId}` — UNPROTECTED
- 🟠 `GET /api/shared-carts/public/{token}/estimations/by-phone` — UNPROTECTED
- 🟠 `GET /api/shared-carts/public/{token}/estimations` — UNPROTECTED
- 🟠 `POST /api/shared-carts/public/{token}/estimations` — UNPROTECTED
- 🟠 `GET /api/shared-carts/public/{token}` — UNPROTECTED
- 🟠 `PATCH /api/shares/{token}/contributions/{id}` — UNPROTECTED
- 🟠 `POST /api/shares/{token}/contributions` — UNPROTECTED
- 🟠 `GET /api/shares/{token}` — UNPROTECTED
- 🟠 `POST /api/shares` — UNPROTECTED
- 🟠 `POST /api/tracking/{token}/verify-pickup` — UNPROTECTED
- 🟠 `GET /api/tracking/{token}` — UNPROTECTED
- 🟠 `GET /api/v2/parcels/{ref}/label` — UNPROTECTED
- ❔ `GET /health/metrics` — UNKNOWN
- ❔ `GET /health/ready` — UNKNOWN
- ❔ `GET /health` — UNKNOWN
- ❔ `GET /webhook/meta-whatsapp` — UNKNOWN
- ❔ `POST /webhook/meta-whatsapp` — UNKNOWN
