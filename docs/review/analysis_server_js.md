# server.js — Full Analysis Report

> **File:** `server.js` (570 lines, 32 KB)
> **Repo:** SamyrFateh/komerce-backend
> **SHA:** 7e78c6f61e1a79a5ee5f1ab6f3cf13f6285c8260
> **Analyzed:** 2026-04-05

---

## A. Version & Metadata

| Field | Value |
|-------|-------|
| **Header comment** | `KOMERCE — Serveur API v9.2 (sécurisé)` |
| **Healthcheck response** | `version: '9.3'` |
| **Startup banner** | `KOMERCE API v9.3` |
| **⚠️ Discrepancy** | Header says v9.2, but health endpoint and banner say v9.3 — header comment is stale |

### Changelog (from comments, lines 7–17)

| Version | Description |
|---------|-------------|
| v9.2 | Helmet CSP corrigé — inline scripts + Google Fonts + images HTTPS autorisés |
| v9.1 | BUG-014 cookie-parser ajouté — JWT migré vers httpOnly cookie |
| v8.8 | Migration robuste (try/catch individuel) + CREATE TABLE partners + gen_random_uuid |
| v8.7 | Auto-migration customs_history colonnes + loyalty_tiers table + users.loyalty_tier_id |
| v8.6 | Auto-migration bcrypt admin hash · fix P0 dashboard + scans · fix 404 routes |
| v8.5 | Rate-limit middleware branché · health route montée · .env retiré du repo |
| v8.1 | Helmet · CORS fix · graceful shutdown · health check DB · cron lock |
| v8.0 | /api/loyalty ajouté · /api/unsold ajouté · migration session 6 |
| v7.6 | /api/purchasing ajouté · triggerPurchasing dans payments.js (cash + Stripe) |
| v7.5 | /api/ceremony → /api/modules · /api/pilotage ajouté |

---

## B. Dependencies & Imports

### Top-level requires (lines 19–35)

| # | Import | Variable(s) | Used? |
|---|--------|-------------|-------|
| 1 | `dotenv` | (side-effect `.config()`) | ✅ Yes |
| 2 | `express` | `express` | ✅ Yes |
| 3 | `cors` | `cors` | ✅ Yes |
| 4 | `helmet` | `helmet` | ✅ Yes |
| 5 | `cookie-parser` | `cookieParser` | ✅ Yes |
| 6 | `path` | `path` | ✅ Yes |
| 7 | `./db` | `db` | ✅ Yes |
| 8 | `./middleware/rate-limit` | `{ globalLimiter, authLimiter, cashConfirmLimiter, scanCollectLimiter, orderCreateLimiter, dashboardLimiter }` | ✅ All used |

### Route file requires (lines 126–143)

| # | Import | Variable |
|---|--------|----------|
| 1 | `./routes/auth` | `authRouter` |
| 2 | `./routes/products` | `productsRouter` |
| 3 | `./routes/orders` | `ordersRouter` |
| 4 | `./routes/relais` | `relaisRouter` |
| 5 | `./routes/admin` | `adminRouter` |
| 6 | `./routes/dashboard` | `dashboardRouter` |
| 7 | `./routes/pricing` | `pricingRouter` |
| 8 | `./routes/modules` | `modulesRouter` |
| 9 | `./routes/pilotage` | `pilotageRouter` |
| 10 | `./routes/baskets` | `basketsRouter` |
| 11 | `./routes/logistics` | `logisticsRouter` |
| 12 | `./routes/payments` | `paymentsRouter` |
| 13 | `./routes/scans` | `scansRouter` |
| 14 | `./routes/finance` | `financeRouter` |
| 15 | `./routes/purchasing` | `purchasingRouter` |
| 16 | `./routes/loyalty` | `loyaltyRouter` |
| 17 | `./routes/unsold` | `unsoldRouter` |
| 18 | `./routes/health` | `healthRouter` |

### Late requires (line 210, 231)

| # | Import | Variable | Used? |
|---|--------|----------|-------|
| 1 | `./utils/sms` | `{ processCashRelaisReminders }` | ✅ Yes (cron) |
| 2 | `bcryptjs` | `bcryptMigrate` | ✅ Yes (admin hash migration) |

### ⚠️ Notes
- **No unused imports detected** — all variables are referenced.
- `bcryptjs` imported late at line 231 (before `fixAdminHash` function), not at top of file.

---

## C. Middleware Chain (in order of declaration)

| # | Line | Middleware | Path / Scope | Description |
|---|------|-----------|--------------|-------------|
| 1 | 39 | `app.set('trust proxy', 1)` | Global setting | Trusts first proxy (Railway) for rate-limiting |
| 2 | 73 | `helmet({...})` | Global | Security headers with CSP allowing inline scripts, Google Fonts, HTTPS images |
| 3 | 92 | `cors(corsOptions)` | Global | Dynamic CORS: allows localhost, *.up.railway.app, FRONTEND_URL env var |
| 4 | 96 | `express.json({ limit: '1mb' })` | Global | JSON body parser, 1MB limit |
| 5 | 97 | `express.urlencoded({ extended: true, limit: '1mb' })` | Global | URL-encoded body parser, 1MB limit |
| 6 | 101 | `cookieParser()` | Global | Cookie parser for JWT httpOnly cookies (BUG-014) |
| 7 | 105 | `globalLimiter` | `/api/` | 100 req/15min global API rate limit |
| 8 | 106 | `authLimiter` | `/api/auth/login` | 5 req/15min brute-force protection |
| 9 | 107 | `authLimiter` | `/api/auth/register` | 5 req/15min anti-spam |
| 10 | 108 | `cashConfirmLimiter` | `/api/payments/cash/confirm` | 3 req/min cash code abuse prevention |
| 11 | 109 | `scanCollectLimiter` | `/api/scans/collect` | 5 req/min QR brute-force prevention |
| 12 | 110 | `orderCreateLimiter` | `/api/orders` | 10 req/min spam orders prevention |
| 13 | 111 | `dashboardLimiter` | `/api/dashboard` | 30 req/min anti-DoS for heavy queries |
| 14 | 113 | `express.static('public')` | Global | Static files with custom headers for HTML (no-cache, UTF-8) |
| 15 | 199 | Error handler `(err, req, res, next)` | Global (end) | CORS error → 403, other errors → 500 |

### CSP Directives (Helmet config)

| Directive | Values |
|-----------|--------|
| `defaultSrc` | `'self'` |
| `scriptSrc` | `'self'`, `'unsafe-inline'` |
| `styleSrc` | `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com` |
| `fontSrc` | `'self'`, `https://fonts.gstatic.com`, `data:` |
| `imgSrc` | `'self'`, `data:`, `https:`, `http:` |
| `connectSrc` | `'self'` |
| `mediaSrc` | `'self'` |
| `objectSrc` | `'none'` |
| `frameAncestors` | `'none'` |
| `baseUri` | `'self'` |
| `formAction` | `'self'` |
| `scriptSrcAttr` | `'unsafe-inline'` |

### ⚠️ Security Notes
- `imgSrc` allows **`http:`** which is unusual for a secured app (allows mixed content images)
- `'unsafe-inline'` for scripts and styles weakens CSP significantly
- `connectSrc` only allows `'self'` — external API calls from frontend won't work

---

## D. Auto-Migrations (function `fixMissingSchema`, lines 276–361)

All run at startup inside `fixMissingSchema()` with individual try/catch wrappers.

### ALTER TABLE statements

| # | Table | Column | Type | Default |
|---|-------|--------|------|---------|
| 1 | `customs_history` | `customs_estimated_kmf` | `INTEGER` | `0` |
| 2 | `customs_history` | `notes` | `TEXT` | — |
| 3 | `customs_history` | `customs_agent_id` | `UUID` | — |
| 4 | `users` | `loyalty_tier_id` | `UUID` | — |

### CREATE TABLE IF NOT EXISTS

| # | Table | Primary Key | Notable Columns |
|---|-------|-------------|-----------------|
| 1 | `partners` | `id UUID DEFAULT gen_random_uuid()` | name, partner_type (default 'relais'), contact_name, contact_phone, contact_email, address, island, zone, commission_kmf, notes, is_active, created_at, updated_at |
| 2 | `loyalty_tiers` | `id UUID DEFAULT gen_random_uuid()` | label (UNIQUE), min_orders (INT), discount_pct (NUMERIC 5,2), badge, created_at |

### CREATE OR REPLACE VIEW

| # | View Name | Description |
|---|-----------|-------------|
| 1 | `customs_taux_mensuel` | Monthly average customs delta % from `customs_history` where `customs_real_kmf > 0` |

### Other Migration Logic (outside `fixMissingSchema`)

| Function | Lines | Description |
|----------|-------|-------------|
| `fixAdminHash()` | 233–272 | Updates admin password hash to bcrypt; creates admin user if missing; fixes demo client hashes |
| `fixProductEncoding()` | 368–403 | Rewrites product names/descriptions with correct UTF-8 encoding for 20 products |
| `fixProductCategories()` | 512–553 | Remaps old categories (electronics, home, wedding, fashion, services) → new subcategories (18 mappings) |
| `fixProductImages()` | 474–508 | Sets Unsplash image URLs for 20 products (only where image_url is NULL or empty) |

### ⚠️ Migration Concerns
- **All migrations run on EVERY startup** — no migration tracking/versioning system
- `fixAdminHash` **always** overwrites the admin password hash, even if it was already correct — this means every restart resets admin & demo passwords
- `fixProductEncoding` runs every time, updating by `price_kmf + category` match (fragile if prices change)
- `fixProductCategories` runs every time but only matches `oldCat` values, so harmless after first run
- `fixProductImages` is idempotent (only updates NULL/empty)
- No `CREATE INDEX` statements found in server.js
- No `CREATE FUNCTION` statements found in server.js

---

## E. Routes Mounted (app.use)

| # | Line | Path | Router File | Notes |
|---|------|------|-------------|-------|
| 1 | 145 | `/api/auth` | `./routes/auth` | |
| 2 | 146 | `/api/products` | `./routes/products` | |
| 3 | 147 | `/api/orders` | `./routes/orders` | |
| 4 | 148 | `/api/relais` | `./routes/relais` | |
| 5 | 150 | `/api/admin/pilotage` | `./routes/pilotage` | **Alias** — dashboard HTML calls this path |
| 6 | 151 | `/api/admin/finance` | `./routes/finance` | **Alias** — dashboard HTML calls this path |
| 7 | 152 | `/api/admin/stats` | `./routes/pilotage` | **Alias** — dashboard HTML calls this path |
| 8 | 154 | `/api/admin` | `./routes/admin` | |
| 9 | 155 | `/api/dashboard` | `./routes/dashboard` | |
| 10 | 156 | `/api/pricing` | `./routes/pricing` | |
| 11 | 157 | `/api/modules` | `./routes/modules` | |
| 12 | 158 | `/api/pilotage` | `./routes/pilotage` | Duplicate mount of pilotageRouter (also at #5 and #7) |
| 13 | 159 | `/api/baskets` | `./routes/baskets` | |
| 14 | 160 | `/api/logistics` | `./routes/logistics` | |
| 15 | 161 | `/api/payments` | `./routes/payments` | |
| 16 | 162 | `/api/scans` | `./routes/scans` | |
| 17 | 163 | `/api/finance` | `./routes/finance` | Duplicate mount of financeRouter (also at #6) |
| 18 | 164 | `/api/purchasing` | `./routes/purchasing` | |
| 19 | 165 | `/api/loyalty` | `./routes/loyalty` | |
| 20 | 166 | `/api/unsold` | `./routes/unsold` | |
| 21 | 167 | `/health` | `./routes/health` | Railway readiness probe (no `/api` prefix) |

### ⚠️ Route Notes
- **pilotageRouter** is mounted 3 times: `/api/admin/pilotage`, `/api/admin/stats`, `/api/pilotage`
- **financeRouter** is mounted 2 times: `/api/admin/finance`, `/api/finance`
- Route order matters: `/api/admin/pilotage` and `/api/admin/finance` are mounted **before** `/api/admin` to ensure they match first
- 18 unique route files, 21 mount points (3 are aliases)

---

## F. Inline Routes (defined directly in server.js)

### 1. `GET /api/health` (line 171–185)
- **Auth required?** No
- **What it does:** Returns JSON with status, version (`9.3`), DB latency (via `SELECT 1`), timestamp, and NODE_ENV
- **Error handling:** Returns 503 `{ status: 'degraded', db: 'unreachable' }` if DB query fails

### 2. `GET *` — SPA Fallback (line 189–195)
- **Auth required?** No
- **What it does:**
  - If path starts with `/api` → returns 404 JSON `{ error: 'Endpoint introuvable' }`
  - Otherwise → serves `public/Komerce_Boutique.html` as the SPA fallback
- **Note:** Sets `Content-Type: text/html; charset=utf-8` explicitly

---

## G. Seed Data

### Products (20 items, function `seedProducts`, lines 406–443)
Only seeds if product name doesn't already exist (SELECT check before INSERT).

| # | Name | Price KMF | Price EUR | Category | Stock | Badge |
|---|------|-----------|-----------|----------|-------|-------|
| 1 | Samsung Galaxy A35 (128Go) | 99,000 | 200 | telephones | 15 | Populaire |
| 2 | Écouteurs Samsung Galaxy Buds2 | 39,600 | 80 | audio | 20 | — |
| 3 | Pack coques + accessoires (5 pièces) | 14,850 | 30 | accessoires-tel | 30 | Nouveau |
| 4 | Chargeur rapide 65W GaN (multi-ports) | 19,800 | 40 | accessoires-tel | 25 | — |
| 5 | Ventilateur sur pied 16" | 24,750 | 50 | equipement | 25 | Best-seller |
| 6 | Fer à repasser vapeur 2400W | 17,325 | 35 | equipement | 18 | — |
| 7 | Multiprise 6 prises + 2 USB | 9,900 | 20 | equipement | 35 | — |
| 8 | Bouilloire électrique 1.7L inox | 12,375 | 25 | cuisine | 22 | — |
| 9 | Montre homme acier brossé | 99,000 | 200 | accessoires | 8 | Exclusif |
| 10 | Collier or 18K (8g) | 277,200 | 560 | accessoires | 5 | Premium |
| 11 | Parfum Oud Al Shuyukh 100ml | 59,400 | 120 | parfums | 12 | — |
| 12 | Coffret cadeau mariage (4 pièces) | 49,500 | 100 | mariage-custom | 15 | Populaire |
| 13 | Djellaba homme brodée (L/XL/XXL) | 34,650 | 70 | vetements | 20 | Best-seller |
| 14 | Abaya femme dentelle Dubai (M/L/XL) | 39,600 | 80 | vetements | 15 | Populaire |
| 15 | Boubou enfant 3-12 ans | 19,800 | 40 | vetements | 18 | — |
| 16 | Caftan femme soirée (S/M/L/XL) | 54,450 | 110 | vetements | 10 | Nouveau |
| 17 | Crème visage éclat au safran | 24,750 | 50 | soins | 20 | — |
| 18 | Parfum Oud Rose (50ml) | 34,650 | 70 | parfums | 18 | Best-seller |
| 19 | Huile argan pure Maroc (100ml) | 17,325 | 35 | cheveux | 25 | — |
| 20 | Coffret soins corps luxe (5 pièces) | 44,550 | 90 | soins | 12 | Nouveau |

### Relais / Pickup Points (5 items, function `seedRelais`, lines 448–469)

| # | Name | Zone | Island | Phone |
|---|------|------|--------|-------|
| 1 | Relais Moroni Centre | Moroni centre | Grande Comore | 0321001001 |
| 2 | Relais Mutsamudu Centre | Mutsamudu centre | Anjouan | 0321002002 |
| 3 | Relais Fomboni | Fomboni centre | Mohéli | 0321003003 |
| 4 | Relais Domoni | Domoni | Anjouan | 0321004004 |
| 5 | Relais Sima | Sima | Anjouan | 0321005005 |

### Loyalty Tiers (4 items, inside `fixMissingSchema`, lines 344–358)
Only seeded if `loyalty_tiers` table is empty.

| # | Label | Min Orders | Discount % | Badge |
|---|-------|------------|------------|-------|
| 1 | Bronze | 0 | 0 | 🥉 |
| 2 | Silver | 3 | 2 | 🥈 |
| 3 | Gold | 10 | 5 | 🥇 |
| 4 | Platinum | 25 | 8 | 💎 |

### Admin User (inside `fixAdminHash`, lines 233–272)
- Creates/upserts `admin@komerce.km` with role `admin`, phone `+269000000`, country `KM`, currency `KMF`
- Password: `process.env.ADMIN_PASSWORD` or default `Komerce2026!`
- **⚠️ Default password is hardcoded in source**

### Demo Client Hash Fix
- Resets all clients with non-bcrypt hashes to password `client123`
- **⚠️ Default password `client123` is hardcoded in source**

---

## H. Other Notable Logic

### Cron Job (lines 210–223)
- **Task:** `processCashRelaisReminders()` from `./utils/sms`
- **Interval:** Every 60 minutes (`60 * 60 * 1000` ms)
- **Concurrency lock:** Boolean `cronRunning` flag prevents overlapping runs
- **Error handling:** Catches and logs errors, releases lock in `finally`
- **⚠️ Note:** Uses `setInterval`, not a proper cron library. Lock is in-memory only — doesn't protect across multiple instances/processes.

### Error Handling (lines 199–206)
- Global error middleware catches all unhandled errors
- CORS errors → 403 with `"Origine non autorisee"` message
- All other errors → 500 with `"Erreur serveur interne"`
- Logs error messages to console

### Startup Sequence (line 555–568)
Runs sequentially via `.then()` chain:
1. `fixAdminHash()` — fix admin & demo client bcrypt hashes
2. `fixMissingSchema()` — add missing tables/columns/views, seed loyalty tiers
3. `fixProductEncoding()` — fix UTF-8 encoding in product names/descriptions
4. `seedProducts()` — insert 20 demo products if not present
5. `fixProductCategories()` — remap old category names to new subcategories
6. `seedRelais()` — insert 5 pickup point locations if not present
7. `fixProductImages()` — set Unsplash image URLs for products
8. `app.listen(PORT)` — start HTTP server
9. Register `SIGTERM` handler for graceful shutdown

### Graceful Shutdown (lines 560–567)
- Listens for `SIGTERM` signal
- Calls `server.close()` to stop accepting new connections
- Exits with code 0 on success
- Force-kills with code 1 after 10-second timeout
- **⚠️ Only handles `SIGTERM`, not `SIGINT` (Ctrl+C in dev)**

### CORS Helper Function (lines 45–52)
- `isAllowedOrigin(origin)` — custom function
- Allows: no origin (same-origin/mobile), localhost (any port), `*.up.railway.app`, `FRONTEND_URL` env var
- **⚠️ Regex `^https?://localhost` allows both HTTP and HTTPS localhost**

### Environment Variables Referenced
| Variable | Default | Usage |
|----------|---------|-------|
| `FRONTEND_URL` | `''` (empty string) | CORS allowed origin |
| `PORT` | `3000` | Server listen port |
| `NODE_ENV` | `'development'` | Shown in health check |
| `ADMIN_PASSWORD` | `'Komerce2026!'` | Admin user password |

### Module Export
- `module.exports = app` — exports the Express app (for testing)

---

## Summary of Concerns

### 🔴 Critical
1. **Admin password hardcoded** (`Komerce2026!`) — exposed in public repo
2. **Demo client password hardcoded** (`client123`)
3. **Admin hash is overwritten on every restart** — any password change via UI is lost
4. **No migration versioning** — all migrations run on every startup

### 🟡 Warning
5. **server.js is 570 lines** with significant business logic (seed data, migrations, encoding fixes) — should be extracted to separate files
6. **`imgSrc` allows `http:`** in CSP — allows mixed content
7. **`'unsafe-inline'` for scripts** weakens CSP
8. **setInterval cron** without proper scheduling library; in-memory lock doesn't work across instances
9. **Version mismatch** between header comment (v9.2) and actual version string (v9.3)
10. **Product encoding fix** uses fragile matching on `price_kmf + category`

### 🟢 Good Practices
11. Individual try/catch for each migration step — one failure doesn't block others
12. Rate limiting on sensitive endpoints
13. Graceful shutdown with timeout
14. Cookie parser for httpOnly JWT cookies
15. CORS with dynamic origin checking
16. Helmet security headers
17. SPA fallback with API 404 handling
