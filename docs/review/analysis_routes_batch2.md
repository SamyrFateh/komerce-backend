# Komerce Backend — Route Analysis (Batch 2)

**Files analyzed:** `orders.js`, `payments.js`, `pilotage.js`, `pricing.js`, `products.js`, `purchasing.js`, `relais.js`, `scans.js`, `unsold.js`
**Generated:** 2026-04-05

---

## 1. routes/orders.js (54 KB · ~1287 lines)

Core order lifecycle: creation, listing, status transitions, cost tracking, QR-based collection.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | POST | `/` | `authenticate` | Create a new order (client). Validates stock, calculates totals, applies loyalty discount, creates order_items, sends SMS + email confirmation | `orders`, `order_items`, `products`, `relais`, `recipients`, `order_status_history` |
| 2 | GET | `/` | `authenticate` | List orders for the authenticated client. Supports `status`, `limit`, `offset` filters | `orders`, `relais`, `order_items`, `products` |
| 3 | GET | `/relais` | `authenticate`, `requireRole(['admin', 'agent_relais'])` | List orders at the agent's relais (shipped/transit/available). Includes 48h alert detection | `orders`, `recipients`, `relais`, `order_items`, `products` |
| 4 | GET | `/problems` | `authenticate`, `requireRole(['admin', 'agent_relais', 'agent_hub'])` | Detect problematic orders using 10 rules (stalled, transit too long, no relais, etc.). Returns health_score 0–100 | `orders`, `recipients`, `relais` |
| 5 | POST | `/:id/qr-token` | `authenticate`, `requireRole(['admin', 'agent_relais'])` | Generate a 24-char SHA256 QR token for an "available" order. Expires in 48h | `orders`, `recipients`, `relais` |
| 6 | GET | `/retrait/:token` | **None (public)** | Public HTML page displaying a QR code for parcel collection. Loads qrcodejs from CDN | `orders`, `recipients`, `relais` |
| 7 | GET | `/:ref` | **None (public, soft-auth)** | Order detail by reference or UUID. Returns minimal data if unauthenticated; full data if authed. Includes items + history | `orders`, `relais`, `order_items`, `products`, `order_status_history` |
| 8 | PATCH | `/:id/status` | `authenticate`, `requireRole(['admin', 'agent_hub', 'agent_relais'])` | Change order status. Validates transition matrix + role permissions. Triggers SMS. Auto-generates pickup_code if needed | `orders`, `order_status_history`, `relais`, `users` |
| 9 | PATCH | `/:id/cost` | `authenticate`, `requireRole(['admin'])` | Record real cost + customs data. Optionally sets supplier_name and supplier_invoice_url | `orders`, `customs_history` |
| 10 | GET | `/:id/history` | `authenticate` | Status history for an order. Owner or admin/agents only | `order_status_history`, `users`, `orders` |

### Issues — orders.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 **HIGH** | **XSS vulnerability** — `order.client_name`, `order.relais_name`, `order.relais_address` are injected directly into HTML without escaping in the GET `/retrait/:token` route. A malicious name like `<script>alert(1)</script>` would execute JS | Lines 911–913 |
| 🟠 **MEDIUM** | **SQL injection pattern** — `pickupCodePatch` uses string interpolation in SQL: `` `, pickup_code = '${newCode}'` ``. Although `newCode` is crypto-generated and safe in practice, the pattern is dangerous and should use parameterized queries | Line 1138 |
| 🟠 **MEDIUM** | **GET `/:ref` is public** — Anyone can query order details by reference. Unauthenticated requests get minimal data (reference, status, created_at), but this still leaks order existence. Consider rate-limiting or requiring auth | Lines 962–1066 |
| 🟡 **LOW** | **Hard-coded exchange rate fallback** — `eurKmf = rates?.eur_kmf || 492` — fallback should be in config/env | Line 175 |
| 🟡 **LOW** | **Hard-coded cost estimation** — Fret (65 KMF/kg), AED rate (138), customs 20% — should be configurable | Lines 288–291 |
| 🟡 **LOW** | **Stock decrement inconsistency** — For `cash_relais`, stock is decremented at order creation (line 414). For `stripe_eur`, it's decremented at payment confirmation in payments.js. This split logic is fragile | Lines 412–419 vs payments.js 228–244 |
| ℹ️ **INFO** | Uses DB transactions properly with `getClient()` + `BEGIN`/`COMMIT`/`ROLLBACK` for POST and PATCH routes | Multiple |

---

## 2. routes/payments.js (11.7 KB · ~313 lines)

Stripe payments, cash confirmation by relais agents, exchange rates.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | POST | `/stripe/intent` | `authenticate` | Create a Stripe PaymentIntent for an order (EUR). Returns `client_secret` for frontend | `orders` |
| 2 | POST | `/stripe/webhook` | **None** (Stripe signature verification) | Stripe webhook handler. On `payment_intent.succeeded`: marks order paid→ordered, sends SMS, triggers purchasing. On `payment_intent.payment_failed`: marks failed | `orders`, `order_status_history`, `users` |
| 3 | POST | `/cash/confirm` | `authenticate`, `requireRole(['admin', 'agent_relais'])` | Agent confirms cash receipt via `cash_ref_code`. Decrements stock, validates order, sends SMS, triggers purchasing | `orders`, `order_items`, `products`, `order_status_history`, `users` |
| 4 | GET | `/rates` | **None (public)** | Returns current exchange rates (EUR/KMF, AED/KMF) | `exchange_rates` |
| 5 | GET | `/config` | **None (public)** | Returns Stripe publishable key (safe to expose) | None (env var) |

### Issues — payments.js

| Severity | Issue | Location |
|----------|-------|----------|
| ✅ **GOOD** | Stripe webhook properly verifies signature via `constructEvent()` | Lines 90–99 |
| ✅ **GOOD** | Idempotence check on webhook — skips if already paid | Lines 107–113 |
| ✅ **GOOD** | Uses DB transaction for cash confirmation | Lines 189–288 |
| 🟡 **LOW** | Stripe webhook success path doesn't decrement stock (stock was already reserved for stripe_eur orders at creation? Actually no — POST /orders only decrements for cash_relais). **Potential stock issue for Stripe orders** — stock is never explicitly decremented for Stripe payments. The webhook sets status to 'ordered' but doesn't touch product stock | Lines 115–143 |
| ℹ️ **INFO** | `triggerPurchasing()` is called after both Stripe and cash payment confirmation — non-blocking with `.catch()` | Lines 163–165, 271–273 |

---

## 3. routes/pilotage.js (27.8 KB · ~610 lines)

Admin-only cost/margin analytics dashboard.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | GET | `/` | `authenticate`, `requireRole(['admin'])` (via `router.use`) | Monthly snapshot: volume, CA, cost breakdown, margins, top products, pipeline. Supports `?mois=YYYY-MM` | `orders`, `order_items`, `products`, `exchange_rates`, `customs_taux_mensuel` |
| 2 | GET | `/history` | `authenticate`, `requireRole(['admin'])` | Monthly history over N months (default 6, max 24). Simplified margin estimate (12% flat) | `orders`, `exchange_rates` |
| 3 | GET | `/clients` | `authenticate`, `requireRole(['admin'])` | Client behavior: top buyers, top products, sales by relais, retention, evolution. Supports `?debut`, `?fin`, `?top` | `orders`, `users`, `order_items`, `products`, `relais`, `loyalty_tiers` |

### Issues — pilotage.js

| Severity | Issue | Location |
|----------|-------|----------|
| ✅ **GOOD** | All routes protected by `router.use(authenticate, requireRole(['admin']))` — global middleware | Line 22 |
| ✅ **GOOD** | In-memory cache with 30s TTL to reduce DB load | Lines 25–33 |
| 🟠 **MEDIUM** | **Many hard-coded business constants** — Hub cost (7000 AED/month), freight (180 EUR/m³), customs rate (42% CIF), embark (3 AED), distribution (1200 + 1340 KMF), dimensions per category — all should be in DB or config | Lines 49–131, 255–256 |
| 🟡 **LOW** | History endpoint uses a **flat 12% margin estimate** rather than real CDR calculation — could be misleading | Lines 370–371 |
| 🟡 **LOW** | `calcCoutRevient()` helper duplicates pricing logic that also exists in `utils/pricing.js` — DRY violation | Lines 51–132 |
| ℹ️ **INFO** | Heavy queries (7+ queries per request on `/` and `/clients`). The 30s cache mitigates this but could be slow on first load | Multiple |

---

## 4. routes/pricing.js (3.5 KB · ~93 lines)

Real-time pricing calculator and exchange rate management.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | POST | `/calculate` | **None (public)** | Calculate product price given `product_id`, `qty`, `is_diaspora`, `relais_type` | `products`, `exchange_rates` (via getRates) |
| 2 | POST | `/couture` | **None (public)** | Calculate couture price given `fabric_id`, `model_id`, `qty`, `is_diaspora` | `fabrics`, `garment_models`, `exchange_rates` |
| 3 | GET | `/rates` | **None (public)** | Returns last 5 exchange rate records | `exchange_rates` |
| 4 | PUT | `/rates` | `authenticate`, `requireRole(['admin'])` | Insert a new exchange rate record | `exchange_rates` |

### Issues — pricing.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟠 **MEDIUM** | **No auth on POST /calculate and POST /couture** — These query the database (products, fabrics, garment_models). While probably intentional for a public storefront, they could be abused for enumeration or DoS. Consider rate-limiting | Lines 20, 46 |
| 🟡 **LOW** | **No input validation on qty** — `parseInt(qty)` could be negative or absurdly large | Lines 35, 62 |
| ✅ **GOOD** | PUT /rates properly protected with admin auth | Line 80 |

---

## 5. routes/products.js (11.8 KB · ~345 lines)

Product catalog CRUD with image upload.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | GET | `/` | **None (public)** | List products with pagination, filters (category, search, price range, in_stock) | `products` |
| 2 | GET | `/categories` | **None (public)** | List active product categories with counts | `products` |
| 3 | GET | `/:id` | **None (public)** | Product detail (active only) | `products` |
| 4 | POST | `/` | `authenticate`, `requireRole(['admin'])` | Create a product with full field set. Validates numeric fields | `products` |
| 5 | PUT | `/:id` | `authenticate`, `requireRole(['admin'])` | Update product fields dynamically. Validates numeric fields | `products` |
| 6 | DELETE | `/:id` | `authenticate`, `requireRole(['admin'])` | Soft-delete (sets `is_active = FALSE`) | `products` |
| 7 | POST | `/:id/image` | `authenticate`, `requireRole(['admin'])` | Upload single product image (multipart). Stores in `public/uploads/products/` | `products` |
| 8 | POST | `/:id/images` | `authenticate`, `requireRole(['admin'])` | Upload up to 5 images. Appends to JSON `images` array | `products` |

### Issues — products.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🔴 **HIGH** | **SQL injection** — In POST `/:id/images`, the first uploaded image URL is interpolated directly into SQL: `` const setMain = existing.length === 0 ? `, image_url = '${imageUrls[0]}'` : '' ``. Although `imageUrls[0]` comes from multer's filename, a crafted filename could inject SQL | Line 330 |
| 🟡 **LOW** | File cleanup on error only removes file if product not found — doesn't clean up on other errors | Lines 289–291, 321–323 |
| ✅ **GOOD** | GET routes are properly public (storefront catalog). Admin routes properly guarded | Multiple |
| ✅ **GOOD** | Parameterized queries used throughout except for the image URL issue noted above | Multiple |

---

## 6. routes/purchasing.js (32.5 KB · ~791 lines)

Semi-automated supplier purchasing engine + admin dashboard.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | GET | `/` | `authenticate`, `requireRole(['admin'])` | List purchasing pipeline. Supports `?status` filter. Limit 100 | `purchase_orders`, `orders`, `suppliers` |
| 2 | GET | `/suppliers` | `authenticate`, `requireRole(['admin'])` | List suppliers with mapped product counts. Supports `?platform`, `?active` filters. Strips API keys from response | `suppliers`, `product_suppliers`, `purchase_orders` |
| 3 | POST | `/suppliers` | `authenticate`, `requireRole(['admin'])` | Create a new supplier (name, platform, contact info, API keys, etc.) | `suppliers` |
| 4 | POST | `/suppliers/:id/map` | `authenticate`, `requireRole(['admin'])` | Map a product to a supplier (upsert on product_id+supplier_id) | `product_suppliers` |
| 5 | DELETE | `/suppliers/:id` | `authenticate`, `requireRole(['admin'])` | Soft-delete supplier. Cancels pending POs. Blocks if confirmed POs exist (unless [TEST] + x-force-delete) | `suppliers`, `product_suppliers`, `purchase_orders` |
| 6 | GET | `/order/:order_id/completeness` | `authenticate`, `requireRole(['admin'])` | Check reception completeness for an order's POs | `purchase_orders`, `product_suppliers`, `products`, `suppliers` |
| 7 | GET | `/:order_id` | `authenticate`, `requireRole(['admin'])` | List purchase orders for a specific order | `purchase_orders`, `suppliers` |
| 8 | POST | `/:order_id/confirm` | `authenticate`, `requireRole(['admin'])` | Manually confirm a purchase order. Sets supplier_name on the parent order | `purchase_orders`, `suppliers`, `orders` |
| 9 | POST | `/:id/receive` | `authenticate`, `requireRole(['admin'])` | Mark PO as received (partial or full). Triggers SCAN 3 + SMS when all POs complete | `purchase_orders`, `orders` |
| 10 | DELETE | `/po/:po_id` | `authenticate`, `requireRole(['admin'])` | Cancel a purchase order. Blocks if `hub_received` unless x-force-delete | `purchase_orders` |

**Non-route export:** `triggerPurchasing(orderId)` — Called from payments.js after payment confirmation. Creates POs for each order item, notifies admin/supplier.

### Issues — purchasing.js

| Severity | Issue | Location |
|----------|-------|----------|
| ✅ **GOOD** | All routes properly guarded with `[authenticate, requireRole(['admin'])]` | Line 41 |
| ✅ **GOOD** | Supplier delete uses transaction + soft-delete pattern | Lines 446–497 |
| ✅ **GOOD** | API keys stripped from GET /suppliers response | Lines 357–360 |
| 🟡 **LOW** | Supplier API stubs (`noonOrder`, `amazonOrder`, `aliexpressOrder`) always return `{ success: false }` — Phase 2 placeholders. All auto_order suppliers will fall back to manual notification | Lines 276–289 |
| 🟡 **LOW** | `triggerPurchasing` is not idempotent — calling it twice would create duplicate POs. Relies on caller to ensure single invocation | Lines 77–189 |
| 🟡 **LOW** | `ADMIN_WA` env var is checked but `WA_API` const is never used — dead code | Lines 55–57 |
| ℹ️ **INFO** | Circular dependency: purchasing.js imports `triggerScan3` from scans.js, and scans.js doesn't import from purchasing (one-way). But payments.js imports `triggerPurchasing` from purchasing.js. Clean dependency chain | Lines 43–52 |

---

## 7. routes/relais.js (1.6 KB · ~55 lines)

Public relay point directory.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | GET | `/` | **None (public)** | List all active relais (id, name, agent_name, phone, address, zone, hours, island) | `relais` |
| 2 | GET | `/public` | **None (public)** | List active relais — lighter variant (id, name, zone, island, address, phone) | `relais` |
| 3 | GET | `/:id` | **None (public)** | Detail of a single active relais | `relais` |

### Issues — relais.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟡 **LOW** | **Duplicate routes** — GET `/` and GET `/public` serve nearly identical purposes with slightly different column selection. One could be removed | Lines 13 vs 28 |
| ✅ **GOOD** | All routes are read-only and public — appropriate for a store locator | Multiple |
| ✅ **GOOD** | Parameterized query for `/:id` | Line 43 |
| ℹ️ **INFO** | No CRUD routes for admin — relais management presumably handled elsewhere (migrations/admin panel) | — |

---

## 8. routes/scans.js (20.7 KB · ~543 lines)

Logistics scan chain: preparation → shipped → relais_received → collected.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | POST | `/` | `authenticate` + in-code role check (`STEP_ROLES`) | Register a scan (item or order). Validates step, resolves scan_code to order. Triggers SMS on shipped/relais_received. Alerts admins on anomaly | `scans`, `order_items`, `orders`, `users`, `recipients`, `relais` |
| 2 | POST | `/collect` | `authenticate`, `requireRole(['admin', 'agent_relais'])` | Collect parcel via 6-digit pickup_code. Records scan, sends SMS to sender | `orders`, `scans`, `relais`, `recipients`, `users` |
| 3 | POST | `/hub/receive` | `authenticate`, `requireRole(['admin', 'agent_hub'])` | Hub receive via QR code — **always returns 501** with redirect to purchasing route | `purchase_orders` |
| 4 | GET | `/hub/pending` | `authenticate`, `requireRole(['admin', 'agent_hub'])` | List orders with pending hub reception. Shows PO completion status per order | `orders`, `purchase_orders`, `product_suppliers`, `products` |
| 5 | POST | `/verify-qr` | `authenticate`, `requireRole(['admin', 'agent_relais'])` | Verify QR token for collection. Validates token, checks expiry, marks collected, invalidates token, sends SMS, recalculates loyalty | `orders`, `recipients`, `relais`, `users`, `order_status_history`, `scans` |
| 6 | GET | `/:order_id` | `authenticate`, `requireRole(['admin'])` | Scan history for an order. Validates UUID format to prevent Postgres crash | `scans`, `users` |

**Non-route export:** `triggerScan3(order_id, scanned_by)` — Called from purchasing.js when all POs are received. Inserts preparation scan + sends SMS.

### Issues — scans.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟠 **MEDIUM** | **POST `/hub/receive` always returns 501** — Dead/unfinished route. Comment says "use POST /api/purchasing/:po_id/receive directly". Should be removed or implemented | Lines 300–336 |
| 🟠 **MEDIUM** | **POST `/` uses in-code role checking** instead of `requireRole()` middleware — inconsistent with other routes and bypasses standard auth pattern. Any authenticated user reaches the handler before role is checked | Lines 101, 124–127 |
| 🟡 **LOW** | `triggerScan3` uses `db.getClient` not found — actually uses `db.query` directly (no transaction). If SMS fails and scan insert fails, state could be inconsistent | Lines 49–92 |
| ✅ **GOOD** | UUID validation on `/:order_id` to prevent Postgres errors on non-UUID strings | Lines 521–524 |
| ✅ **GOOD** | QR verification uses transaction with proper ROLLBACK on failure | Lines 387–514 |

---

## 9. routes/unsold.js (6.4 KB · ~159 lines)

Unsold item management: listing, resolution, WhatsApp broadcast.

### Endpoints

| # | Method | Path | Auth | Description | Key SQL Tables |
|---|--------|------|------|-------------|----------------|
| 1 | GET | `/` | `authenticate`, `requireAdmin` | List all unsold items from view `v_unsold_pipeline` | `v_unsold_pipeline` (view) |
| 2 | POST | `/scan` | `authenticate`, `requireAdmin` | Trigger manual unsold detection. Calls `auto_unsold()` function, creates `unsold_items` records | `orders`, `order_items`, `products`, `unsold_items` |
| 3 | GET | `/:id` | `authenticate`, `requireAdmin` | Detail of a single unsold item | `v_unsold_pipeline` |
| 4 | PATCH | `/:id` | `authenticate`, `requireAdmin` | Update unsold price, channel, or notes | `unsold_items` |
| 5 | POST | `/:id/resolve` | `authenticate`, `requireAdmin` | Mark unsold as sold/donated/destroyed. Valid statuses: `sold_whatsapp`, `sold_reseller`, `donated`, `destroyed` | `unsold_items` |
| 6 | GET | `/:id/whatsapp` | `authenticate`, `requireAdmin` | Generate WhatsApp promotional message for an unsold item | `v_unsold_pipeline` |
| 7 | GET | `/stats/summary` | `authenticate`, `requireAdmin` | Aggregate stats: total active, liquidation value, avg days in stock, channel breakdown | `v_unsold_pipeline` |

### Issues — unsold.js

| Severity | Issue | Location |
|----------|-------|----------|
| 🟠 **MEDIUM** | **Error messages leak internal details** — All 500 responses return `err.message` directly: `res.status(500).json({ error: err.message })`. Should return generic error for security | Lines 14, 48, 62, 80, 104, 135, 155 |
| 🟡 **LOW** | **Inconsistent auth import** — Uses `requireAdmin` imported separately, while all other files use `requireRole(['admin'])`. Creates maintenance confusion | Line 6 |
| 🟡 **LOW** | **POST /scan N+1 query** — Uses a `for` loop with individual INSERTs instead of batch INSERT for unsold_items | Lines 35–44 |
| ℹ️ **INFO** | `/stats/summary` is declared AFTER `/:id` routes — Express correctly differentiates multi-segment paths from single-segment params, so this works | Line 140 |

---

## Cross-File Issues Summary

### 🔴 Critical / High

| # | Issue | File(s) | Lines |
|---|-------|---------|-------|
| 1 | **XSS vulnerability** — User-controlled data (client name, relais name/address) injected into HTML without escaping | orders.js | 911–913 |
| 2 | **SQL injection pattern** — String interpolation in SQL (`image_url = '${imageUrls[0]}'`) | products.js | 330 |
| 3 | **SQL injection pattern** — String interpolation in SQL (`pickup_code = '${newCode}'`) | orders.js | 1138 |

### 🟠 Medium

| # | Issue | File(s) |
|---|-------|---------|
| 4 | No auth on pricing calculation routes (POST /calculate, POST /couture) — DB queries accessible publicly | pricing.js |
| 5 | Dead route POST /hub/receive always returns 501 | scans.js |
| 6 | Error messages leak `err.message` to clients in 500 responses | unsold.js |
| 7 | In-code role checking instead of middleware on POST /scans | scans.js |
| 8 | Many hard-coded business constants (hub cost, freight rates, customs, dimensions, fallback FX rates) | pilotage.js, orders.js |

### 🟡 Low / Informational

| # | Issue | File(s) |
|---|-------|---------|
| 9 | Duplicate routes: GET /relais and GET /relais/public serve same purpose | relais.js |
| 10 | Inconsistent auth pattern: `requireAdmin` vs `requireRole(['admin'])` | unsold.js vs others |
| 11 | Stock decrement split across orders.js (cash) and payments.js (stripe) — no decrement for Stripe in webhook | orders.js, payments.js |
| 12 | Supplier API stubs always fail → all auto_order falls back to manual | purchasing.js |
| 13 | `triggerPurchasing` not idempotent — duplicate POs if called twice | purchasing.js |
| 14 | `WA_API` constant declared but never used | purchasing.js |
| 15 | History endpoint uses flat 12% margin instead of real CDR calculation | pilotage.js |
| 16 | CDR calculation logic duplicated between pilotage.js and utils/pricing.js | pilotage.js |

---

## Route Count Summary

| File | Routes | Public | Auth Required | Admin Only |
|------|--------|--------|---------------|------------|
| orders.js | 10 | 2 | 4 | 4 |
| payments.js | 5 | 3 | 1 | 1 |
| pilotage.js | 3 | 0 | 0 | 3 |
| pricing.js | 4 | 3 | 0 | 1 |
| products.js | 8 | 3 | 0 | 5 |
| purchasing.js | 10 | 0 | 0 | 10 |
| relais.js | 3 | 3 | 0 | 0 |
| scans.js | 6 | 0 | 2 | 4 |
| unsold.js | 7 | 0 | 0 | 7 |
| **TOTAL** | **56** | **14** | **7** | **35** |

---

## Database Tables Referenced (Batch 2)

| Table/View | Files Using It |
|------------|---------------|
| `orders` | orders, payments, pilotage, purchasing, scans, unsold |
| `order_items` | orders, payments, pilotage, unsold |
| `order_status_history` | orders, payments, scans |
| `products` | orders, payments, pilotage, pricing, products, purchasing, scans |
| `relais` | orders, pilotage, relais, scans |
| `users` | orders, payments, pilotage, scans |
| `recipients` | orders, scans |
| `exchange_rates` | payments, pilotage, pricing |
| `purchase_orders` | purchasing, scans |
| `suppliers` | purchasing |
| `product_suppliers` | purchasing, scans |
| `scans` | scans |
| `unsold_items` | unsold |
| `v_unsold_pipeline` | unsold (view) |
| `customs_history` | orders |
| `customs_taux_mensuel` | pilotage (view) |
| `fabrics` | pricing |
| `garment_models` | pricing |
| `loyalty_tiers` | pilotage |
