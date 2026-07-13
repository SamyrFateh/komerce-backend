# Security 360 — couverture des gardes (hybride runtime + statique)

> 2026-07-13T10:41:49.597Z — 485 endpoints

| Niveau | Compte |
|---|---|
| 🟢 PROTECTED | 430 |
| ⚪ PUBLIC (légitime) | 5 |
| 🟠 UNPROTECTED | 48 |
| 🔴 ADMIN_NO_GUARD | 0 |
| ❔ UNKNOWN (statique n'a pas atteint — à auditer) | 2 |

## Flaggés

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
- 🟠 `GET /health/ready` — UNPROTECTED
- 🟠 `GET /health/version` — UNPROTECTED
- 🟠 `GET /health` — UNPROTECTED
- ❔ `GET /webhook/meta-whatsapp` — UNKNOWN
- ❔ `POST /webhook/meta-whatsapp` — UNKNOWN
