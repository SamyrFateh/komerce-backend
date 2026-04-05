# Komerce Backend — Route Analysis (Batch 1)

> **Files analyzed:** admin.js, auth.js, baskets.js, dashboard.js, finance.js, health.js, logistics.js, loyalty.js, modules.js
> **Date:** 2026-04-05

---

## 1. routes/admin.js

**Mount point:** `/api/admin`
**Guard:** All routes use `[authenticate, requireRole(['admin'])]`
**Size:** 948 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | GET | /dashboard | admin | Global KPIs: order counts, revenue, top products, margin KPIs, recent orders | orders, order_items, products, users |
| 2 | GET | /orders | admin | List all orders with filters (status, payment_mode, confection_type, dates, search, margin_alert) + pagination | orders, order_items, products, users, relais, recipients |
| 3 | GET | /margins | admin | Margin dashboard: by category, alerts, weekly timeline | orders, order_items, products |
| 4 | GET | /customs | admin | Customs history: detailed log, stats by category, anomalies | customs_history, orders, order_items, products, users |
| 5 | GET | /alerts | admin | Active alerts: margin alerts, customs anomalies, sourcing-blocked orders | orders, order_items, products, customs_history |
| 6 | GET | /partners | admin | List partners with optional type/island filters | partners |
| 7 | POST | /partners | admin | Create a new partner (name + partner_type required) | partners |
| 8 | PUT | /partners/:id | admin | Update partner fields dynamically | partners |
| 9 | POST | /reset | admin | **DANGEROUS** — Delete data (3 modes: orders / users / factory full re-seed) | order_items, customs_history, orders, recipients, users, products, relais, partners |
| 10 | GET | /counts | admin | Quick row counts for orders, items, products, relais, users (pre-reset view) | orders, order_items, products, relais, users |
| 11 | POST | /seed-test | admin | Seed 28 realistic test orders over 3 months with 5 test clients | products, relais, users, recipients, orders, order_items, order_status_history |

### Issues — admin.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 HIGH | **POST /reset and POST /seed-test should be disabled in production.** These delete/seed all data. No environment guard exists. | Lines 541, 683 |
| 🟡 MEDIUM | **Error message leak** — `res.status(500).json({ error: 'Erreur reset : ' + err.message })` exposes internal error details to client. Same in seed-test. | Lines 652, 942 |
| 🟡 MEDIUM | **Hard-coded EUR_KMF = 492** exchange rate in seed-test. Should use `getRates()` or config. | Line 796 |
| 🟡 MEDIUM | **Hard-coded seed product data** (20 products with prices) baked into route handler — should be an external seed file. | Lines 589–610 |
| 🟢 LOW | All queries use parameterized `$N` placeholders — no SQL injection risk. |  |
| 🟢 LOW | All routes wrapped in try/catch. |  |

---

## 2. routes/auth.js

**Mount point:** `/api/auth`
**Size:** 525 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | POST | /register | none | Create user account (phone required, password min 6 chars). Checks email/phone duplicates. | users |
| 2 | POST | /login | none | Login by email or phone + password. Returns JWT + httpOnly cookie. | users |
| 3 | GET | /me | authenticate | Get current user profile with loyalty tier info + orders_until_next_tier. | users, loyalty_tiers |
| 4 | PUT | /me | authenticate | Update profile (full_name, phone, currency_pref). | users |
| 5 | POST | /guest-checkout | none (rate-limited: 5/15min per IP) | Find-or-create user by phone for guest checkout. Returns JWT. | users |
| 6 | POST | /auto-register | requireInternalKey (X-Internal-Key header) | Internal-only silent account creation. Requires INTERNAL_API_KEY env var. | users |
| 7 | POST | /orders-by-phone | none (rate-limited: 5/15min per IP) | Lookup user by phone, return short-lived 2h JWT with scope `orders_read`. | users |
| 8 | POST | /logout | none | Clear httpOnly JWT cookie. | none |
| 9 | POST | /admin-reset | none (ADMIN_RESET_KEY in body) | Reset admin password. Requires ADMIN_RESET_KEY env var match in body. | users |

### Issues — auth.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 HIGH | **Fallback JWT secret** — `_JWT_SECRET = JWT_SECRET \|\| 'komerce_secret_dev_UNSAFE'`. If `JWT_SECRET` is unset in non-production, a known weak secret is used. Tokens are forgeable. | Line 24 |
| 🔴 HIGH | **POST /admin-reset has NO authentication** — Only relies on ADMIN_RESET_KEY in request body. If the key leaks, anyone can reset the admin password. No rate limiting on this route. | Line 485 |
| 🟡 MEDIUM | **In-memory rate limiting** (`_guestCheckoutAttempts`, `_phoneLookupAttempts`) won't work across multiple server instances. Use Redis in production. | Lines 247, 404 |
| 🟡 MEDIUM | **POST /orders-by-phone returns JWT for just a phone number** — Even with rate limiting, this could be abused. The `scope: 'orders_read'` claim is generated but there's no enforcement noted in orders.js. | Line 452 |
| 🟡 MEDIUM | **POST /guest-checkout auto-creates accounts** with generated email (`phone@komerce.km`) and random password — creates phantom accounts that cannot log in normally. | Line 299 |
| 🟡 MEDIUM | **POST /register does not validate email format** — only checks if email is duplicate, not if it's a valid email. | Line 101 |
| 🟡 MEDIUM | **Hard-coded admin email** `admin@komerce.km` in /admin-reset. Should be configurable. | Line 502 |
| 🟢 LOW | Password hashing uses bcrypt with cost 10 — adequate. |  |
| 🟢 LOW | Cookie settings (httpOnly, sameSite='Strict', secure in prod) are properly configured. |  |
| 🟢 LOW | All queries parameterized — no SQL injection. |  |

---

## 3. routes/baskets.js

**Mount point:** `/api/baskets`
**Size:** 253 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | GET | / | authenticate | List baskets — admin sees all, client sees own only. | baskets, users, basket_items |
| 2 | POST | /share | **none** (req.user?.id optional) | Create a shared basket with WhatsApp link (K-XXXX code, 7 day expiry). | baskets, products, basket_items |
| 3 | GET | /:code([A-Z]-[A-Z0-9]{4}) | none | View basket by code (public, with regex validation on code format). | baskets, basket_items, products |
| 4 | PATCH | /:code | authenticate | Modify basket: add/remove/update_qty items. | baskets, basket_items, products |
| 5 | POST | /:code/pay | authenticate | Lock basket for payment + SMS notification to basket creator. | baskets, users |
| 6 | POST | /gift | authenticate | Create a gift basket (14-day expiry). | baskets, products, basket_items |
| 7 | POST | /gift/:code/confirm | authenticate | Lock gift basket + send SMS with pickup code to recipient. | baskets, users |

### Issues — baskets.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟡 MEDIUM | **POST /share has NO authentication** — Anyone can create shared baskets, potentially spamming the DB. There's no rate limiting either. | Line 47 |
| 🟡 MEDIUM | **PATCH /:code loops individual DB queries** for each add item (check product, check existing, insert/update) — N+1 query problem. Should batch. | Lines 127–133 |
| 🟢 LOW | Basket codes use regex validation `[A-Z]-[A-Z0-9]{4}` — good input constraint. |  |
| 🟢 LOW | All queries parameterized. |  |
| 🟢 LOW | All routes have try/catch. |  |

---

## 4. routes/dashboard.js

**Mount point:** `/api/dashboard`
**Guard:** `router.use(authenticate, requireRole(['admin']))` — applied to ALL routes
**Size:** 796 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | GET | /ops | admin | Operational dashboard: activity KPIs, SLA tracking, logistics pipeline (Dubai/boat/Anjouan), delays, alerts (cash pending, anomalies, low stock), client delay compensation | orders, relais, recipients, products |
| 2 | GET | /sales | admin | Sales & margins: L1 KPIs (CA/margin/basket), L2 (diaspora vs local, margin by category), L3 (re-purchase rate, LTV), top 10 products, never-sold products, client stats | orders, order_items, products, users |
| 3 | GET | /retards | admin | Delayed orders for client outreach: classified by compensation level (préventif/avoir 5%/remise 10%/remboursement). Includes suggested SMS text. | orders, users, recipients |
| 4 | GET | /forecast | admin | Revenue projections: linear model from historical daily CA, pessimistic/expected/optimistic scenarios, margin projection | orders |
| 5 | GET | /pipeline | admin | Kanban board: all orders grouped by status stage with timestamps, client/recipient info, product details | orders, users, recipients, relais, order_items, products |

### Issues — dashboard.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟡 MEDIUM | **In-memory cache** (`_cache` Map with 30s TTL) won't work across multiple server instances. | Lines 32–40 |
| 🟡 MEDIUM | **Hard-coded SLA constants** (SLA_WARNING_DAYS=35, SLA_LATE_DAYS=42, SLA_BLOCKED_DAYS=56, etc.) should be in env/config. | Lines 20–29 |
| 🟡 MEDIUM | **GET /pipeline loads ALL orders** (no LIMIT, no pagination) — will degrade as order volume grows. | Line 717 |
| 🟡 MEDIUM | **GET /ops runs 8+ heavy queries** in parallel — could cause DB contention under load. | Lines 50–200 |
| 🟢 LOW | All queries parameterized. |  |
| 🟢 LOW | All routes have try/catch. |  |

---

## 5. routes/finance.js

**Mount point:** `/api/finance`
**Guard:** `[authenticate, requireRole(['admin'])]` on all routes
**Size:** 387 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | GET | /summary | admin | Monthly finance summary JSON (order counts, CA by payment mode, costs, margins) | orders |
| 2 | GET | /export | admin | CSV export of monthly transactions with frozen exchange rates. BOM for Excel. | orders, users, relais, exchange_rates |
| 3 | GET | /stripe-proofs | admin | List Stripe PaymentIntents for the month, enriched with Stripe API details | orders, users + Stripe API |
| 4 | GET | /report | admin | Generate PDF monthly financial report (CA, margins, exchange rates) using PDFKit | orders |

### Issues — finance.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 HIGH | **Stripe SDK initialized at module load** — `require('stripe')(process.env.STRIPE_SECRET_KEY)`. If `STRIPE_SECRET_KEY` is undefined, this creates a Stripe instance with `undefined` key. Any call will fail at runtime but the module loads. Could mask config issues. | Line 15 |
| 🟡 MEDIUM | **Sequential Stripe API calls** in `/stripe-proofs` — each order triggers 1-2 Stripe API calls in a loop. For 50+ orders, this will be very slow and could hit Stripe rate limits. | Lines 220–251 |
| 🟡 MEDIUM | **No pagination** on `/stripe-proofs` — returns all matching orders for the month. | Line 196 |
| 🟢 LOW | CSV export uses proper escaping via `csvEscape()`. |  |
| 🟢 LOW | All queries parameterized. |  |
| 🟢 LOW | All routes have try/catch. |  |

---

## 6. routes/health.js

**Mount point:** `/health`
**Size:** 53 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | GET | / | none | Basic health check: DB connectivity + latency + uptime | none (SELECT 1) |
| 2 | GET | /ready | none | Readiness probe: DB connectivity | none (SELECT 1) |

### Issues — health.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟢 LOW | **`require('../db')` inside route handler** — lazy load on every request. Minor inefficiency but harmless. | Lines 20, 44 |
| 🟢 LOW | No auth on health endpoints — intentional and correct for monitoring. |  |
| ✅ | Clean, minimal, well-structured. No issues. |  |

---

## 7. routes/logistics.js

**Mount point:** `/api/logistics`
**Guard:** `[authenticate, requireRole(['admin'])]` on all routes
**Size:** 217 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | POST | /shipments | admin | Create a new shipment (carrier, container_ref, dates, notes) | shipments |
| 2 | GET | /shipments | admin | List recent shipments (LIMIT 20) with order counts | shipments, orders |
| 3 | PATCH | /shipments/:id | admin | Update shipment; if arrived+customs cleared → bulk update orders to 'available' + batch SMS to clients | shipments, orders, users, recipients, relais |
| 4 | GET | /labels/:shipment_id | admin | Generate A6 PDF labels with QR codes for all orders in a shipment | orders, users, relais, order_items, products |
| 5 | GET | /manifest/:shipment_id | admin | Generate PDF manifest for a shipment (order list with client info) | shipments, orders, users, relais, order_items |

### Issues — logistics.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟡 MEDIUM | **Fire-and-forget SMS** — `Promise.all(...).catch(err => console.error(...))` sends SMS asynchronously but errors are only logged. No retry mechanism or failed-SMS tracking. | Lines 80–88 |
| 🟡 MEDIUM | **PATCH /shipments/:id has side effects** — updates order statuses and triggers SMS in the same endpoint. Should potentially be a separate action. | Lines 65–89 |
| 🟢 LOW | Hard-coded `LIMIT 20` on shipment list — no pagination parameter. | Line 43 |
| 🟢 LOW | All queries parameterized. |  |
| 🟢 LOW | All routes have try/catch. |  |

---

## 8. routes/loyalty.js

**Mount point:** `/api/loyalty`
**Size:** 150 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | GET | /tiers | **none** (public) | List all loyalty tiers (for client-facing display) | loyalty_tiers |
| 2 | GET | /me | authenticate | Current user's loyalty tier + progression | v_loyalty_summary (view) |
| 3 | GET | /users | authenticate + requireAdmin | All users with their loyalty tiers | v_loyalty_summary |
| 4 | GET | /stats | authenticate + requireAdmin | Loyalty KPIs: tier distribution, all users | loyalty_tiers, v_loyalty_summary |
| 5 | PUT | /tiers/:id | authenticate + requireAdmin | Update a loyalty tier's settings | loyalty_tiers |
| 6 | POST | /recalculate/:user_id | authenticate + requireAdmin | Recalculate a specific user's loyalty tier | via `recalculate_loyalty()` DB function |
| 7 | POST | /recalculate-all | authenticate + requireAdmin | Recalculate ALL client tiers (sequential) | users, via `recalculate_loyalty()` DB function |

**Also exports:** `getLoyaltyDiscount(db, userId)` and `recalculateLoyalty(db, userId)` utility functions for use by orders.js.

### Issues — loyalty.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟡 MEDIUM | **Uses `requireAdmin`** instead of `requireRole(['admin'])` — different middleware function from all other files. Could indicate inconsistency or a different middleware function. | Line 6 |
| 🟡 MEDIUM | **POST /recalculate-all is sequential** — iterates all clients one-by-one with `await db.query()` per user. Could timeout for large user bases. Should batch. | Lines 98–101 |
| 🟡 MEDIUM | **GET /stats loads ALL users** into memory (no pagination) — will not scale. | Line 50 |
| 🟢 LOW | Error responses expose `err.message` directly — `res.status(500).json({ error: err.message })`. | Multiple |
| 🟢 LOW | All queries parameterized. |  |

---

## 9. routes/modules.js

**Mount point:** `/api/modules`
**Size:** 502 lines

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|---------------|
| 1 | GET | / | none | List all modules from in-memory registry | none (MODULES_REGISTRY JS object) |
| 2 | GET | /:type | none | Get module detail by type from registry | none (MODULES_REGISTRY) |
| 3 | GET | /fabrics | none | Fabric catalog for couture module (with optional filter by fabric_type) | fabrics |
| 4 | GET | /models | none | Garment model catalog for couture module | garment_models |
| 5 | POST | /price | none | Calculate price for any module (couture: ready_made/fabric_only/custom_from_fabric; lunettes; construction; cosmetiques) | products, fabrics, garment_models |
| 6 | POST | /fabrics | authenticate + requireRole(['admin']) | Add a fabric to the catalog | fabrics |
| 7 | POST | /models | authenticate + requireRole(['admin']) | Add a garment model to the catalog | garment_models |

### Issues — modules.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 **CRITICAL** | **Route ordering bug** — `GET /:type` (line 111) is defined BEFORE `GET /fabrics` (line 126) and `GET /models` (line 177). In Express, routes match in order of definition. Requests to `/api/modules/fabrics` and `/api/modules/models` will be caught by `/:type` first. Since 'fabrics' and 'models' are not keys in `MODULES_REGISTRY`, these will return 404. **The fabric and model catalog endpoints are unreachable.** | Lines 111 vs 126, 177 |
| 🟡 MEDIUM | **POST /price has NO authentication** — Anyone can calculate prices. Intentional for public pricing, but allows unlimited DB queries (product/fabric/model lookups). No rate limiting. | Line 218 |
| 🟡 MEDIUM | **Module registry is hard-coded in JS** — Adding/removing modules requires a code deploy. Should be in DB or config. | Lines 40–85 |
| 🟢 LOW | All queries parameterized. |  |
| 🟢 LOW | All routes have try/catch. |  |

---

## Summary — All Endpoints (Batch 1)

| File | Endpoints | Auth Pattern |
|------|-----------|-------------|
| admin.js | 11 | All admin-only |
| auth.js | 9 | Mix: public (register/login/logout/guest-checkout/orders-by-phone/admin-reset), authenticated (me), internal key (auto-register) |
| baskets.js | 7 | Mix: public (share, view by code), authenticated (list, modify, pay, gift) |
| dashboard.js | 5 | All admin-only (router.use middleware) |
| finance.js | 4 | All admin-only |
| health.js | 2 | All public (no auth) |
| logistics.js | 5 | All admin-only |
| loyalty.js | 7 | Mix: public (tiers), authenticated (me), admin (users, stats, tiers update, recalculate) |
| modules.js | 7 | Mix: public (list, detail, fabrics, models, price), admin (add fabric, add model) |
| **TOTAL** | **57** | |

---

## Cross-Cutting Issues Summary

| # | Severity | Issue | Files Affected |
|---|----------|-------|----------------|
| 1 | 🔴 CRITICAL | **Route ordering bug in modules.js** — `/fabrics` and `/models` GET endpoints are unreachable because `/:type` catches them first | modules.js |
| 2 | 🔴 HIGH | **Unsafe JWT fallback secret** in non-production environments | auth.js |
| 3 | 🔴 HIGH | **POST /admin-reset has no auth middleware** — only body-key protection with no rate limiting | auth.js |
| 4 | 🔴 HIGH | **POST /reset and /seed-test have no production guard** — can destroy all data in production | admin.js |
| 5 | 🟡 MEDIUM | **In-memory caching and rate limiting** won't work across multiple instances (needs Redis) | auth.js, dashboard.js |
| 6 | 🟡 MEDIUM | **Error messages leaked to client** in several routes (`err.message` exposed) | admin.js, loyalty.js |
| 7 | 🟡 MEDIUM | **No pagination** on several endpoints that load all records | dashboard.js (pipeline), finance.js (stripe-proofs), loyalty.js (stats/users) |
| 8 | 🟡 MEDIUM | **Hard-coded business constants** (SLA days, exchange rates, module registry) should be in config/DB | admin.js, dashboard.js, modules.js |
| 9 | 🟡 MEDIUM | **Inconsistent auth middleware** — loyalty.js uses `requireAdmin` while all others use `requireRole(['admin'])` | loyalty.js |
| 10 | 🟡 MEDIUM | **Stripe SDK init with potentially undefined key** at module load time | finance.js |
| 11 | 🟢 POSITIVE | **All SQL queries use parameterized placeholders** — no SQL injection vulnerabilities found | All files |
| 12 | 🟢 POSITIVE | **All routes have try/catch** with error handling | All files |
| 13 | 🟢 POSITIVE | **Cookie security** properly configured (httpOnly, sameSite, secure in prod) | auth.js |
