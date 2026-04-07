# KOMERCE BACKEND — CARTOGRAPHIE 360°

> **Date** : 7 avril 2026
> **Repo** : `SamyrFateh/komerce-backend` (branche main)
> **Fichiers audités** : 19 fichiers source + 6 fichiers DB/migrations

---

## 1. TYPES ÉNUMÉRÉS

| Enum | Valeurs | Défini dans |
|------|---------|-------------|
| `user_role` | `client`, `admin`, `agent_relais`, `agent_hub` | schema.sql |
| `order_status` | `confirmed`, `ordered`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, `cancelled`, `refunded` | schema.sql |
| `payment_mode` | `stripe_eur`, `cash_relais` | schema.sql |
| `payment_status` | `pending`, `paid`, `failed`, `refunded` | schema.sql |
| `basket_type` | `personal`, `shared`, `gift` | schema.sql |
| `scan_step` | `preparation`, `shipped`, `in_transit`, `relais_received`, `collected` | schema.sql |
| `parcel_status` | `draft`, `preparation`, `shipped`, `in_transit`, `arrived`, `available`, `collected`, `cancelled` | ⚠️ **ABSENT de schema.sql** — défini dans migration manquante |

---

## 2. TABLES DB

### 2.1 schema.sql

| Table | Colonnes clés | FK/Contraintes |
|-------|--------------|----------------|
| `users` | id, email, phone, full_name, role, country, password_hash, loyalty_tier_id | email UNIQUE, phone UNIQUE |
| `relais` | id, name, agent_name, phone, address, zone, island, is_active | — |
| `products` | id, sku, name, price_kmf, cost_kmf, stock, weight_kg, price_aed, source, dims_* | sku UNIQUE |
| `baskets` | id, code, type, owner_id, is_locked | code UNIQUE, FK users |
| `basket_items` | id, basket_id, product_id, added_by, quantity, price_kmf | FK baskets CASCADE, FK products |
| `recipients` | id, user_id, full_name, phone, relais_id, is_default | FK users, FK relais |
| `shipments` | id, reference, origin, destination, carrier, eta, arrived_at | reference UNIQUE |
| `orders` | id, reference, user_id, basket_id, recipient_id, relais_id, shipment_id, total_kmf, status, payment_mode, payment_status, pickup_code, cost_transport_kmf, cost_douane_kmf | reference UNIQUE, 7 FK |
| `order_items` | id, order_id, product_id, quantity, price_kmf, scan_code, availability_status | FK orders CASCADE, FK products |
| `scans` | id, order_id, order_item_id, step, scanned_by, scan_code, is_anomaly | FK orders CASCADE, FK order_items CASCADE |
| `order_status_history` | id, order_id, status, scan_id, changed_by | FK orders CASCADE |
| `sms_log` | id, order_id, recipient, type, message, status | FK orders |
| `exchange_rates` | id, eur_kmf, aed_kmf, valid_from | — |
| `disputes` | id, order_id, type, level, status, photo_urls, refund_kmf | FK orders CASCADE |

### 2.2 schema_extension.sql (Cérémonie)

| Table | Colonnes clés | FK |
|-------|--------------|----|
| `ceremony_fabrics` | id, name, material, price_per_meter_aed, colors[], occasions[] | — |
| `ceremony_models` | id, name, making_cost_aed, fabric_meters, occasions[] | — |
| `ceremony_order_items` | id, order_id, fabric_id, model_id, size, quantity, prix_par_tenue_kmf | FK orders, fabrics, models |

### 2.3 fixMissingSchema (server.js)

| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `partners` | id, name, partner_type, contact_*, commission_kmf | Créé au boot si absent |
| `loyalty_tiers` | id, label, min_orders, discount_pct, badge | Créé au boot si absent |
| `business_rules` | id, category, key, value (JSONB), label_fr, min/max_value | 46 règles seed |
| `business_rules_history` | id, rule_id, old_value, new_value, changed_by | Audit trail |
| `refunds` | id, order_id, amount_kmf, refund_type, refund_method, status | FK orders |
| `store_credits` | id, user_id, amount_kmf, remaining_kmf, source_order_id | FK users, FK orders |

### 2.4 Migration 016

| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `carriers` | id, name, type, contact_*, avg_transit_days, cost_per_kg_kmf | CRUD dans carriers.js |

### 2.5 ⚠️ Tables MANQUANTES du schéma (CREATE TABLE absent)

| Table | Utilisé dans | Colonnes référencées dans le code |
|-------|-------------|-----------------------------------|
| `parcels` | hub.js, parcels.js, parcelSync.js, logistics.js, dashboard.js, carriers.js | id, reference, order_id, shipment_id, status, type, notes, prepared_at, shipped_at, in_transit_at, available_at, collected_at, customs_* |
| `parcel_items` | parcels.js, parcelSync.js, hub.js, dashboard.js | id, parcel_id, order_item_id, quantity |
| `customs_history` | server.js fixMissingSchema, dashboard.js | customs_estimated_kmf, customs_real_kmf, customs_agent_id, notes |

---

## 3. INDEX (25 total)

**schema.sql** : 18 index
**migration 014** : 6 index (parcels, parcel_items)
**migration 016** : 1 index (carriers)
**migration 017** : 1 unique partiel (one_draft_per_order) + 1 UNIQUE (unique_order_item_per_parcel)

---

## 4. TRIGGERS

| Trigger | Table | Action | ⚠️ Statut |
|---------|-------|--------|-----------|
| `trg_users_updated` | users | set_updated_at() | ✅ OK |
| `trg_products_updated` | products | set_updated_at() | ✅ OK |
| `trg_orders_updated` | orders | set_updated_at() | ✅ OK |
| `trg_shipments_updated` | shipments | set_updated_at() | ✅ OK |
| `trg_disputes_updated` | disputes | set_updated_at() | ✅ OK |
| `trg_scan_sync_status` | scans AFTER INSERT | sync_order_status_from_scan() | 🔴 **CONFLIT** avec parcelSync Phase 3 |

---

## 5. ROUTES & ENDPOINTS

### 5.1 Montage (server.js)

| Préfixe | Route file | Rate limiter |
|---------|-----------|-------------|
| `/api/auth` | auth.js | authLimiter |
| `/api/products` | products.js | globalLimiter |
| `/api/orders` | orders.js | orderCreateLimiter (POST) |
| `/api/relais` | relais.js | globalLimiter |
| `/api/admin/finance` | finance.js | adminLimiter |
| `/api/admin/pilotage` | dashboard.js *(alias)* | adminLimiter |
| `/api/admin/stats` | dashboard.js *(alias)* | adminLimiter |
| `/api/admin` | admin.js | adminLimiter |
| `/api/dashboard` | dashboard.js | dashboardLimiter |
| `/api/pricing` | pricing.js | globalLimiter |
| `/api/modules` | modules.js | globalLimiter |
| `/api/baskets` | baskets.js | globalLimiter |
| `/api/logistics` | logistics.js | globalLimiter |
| `/api/parcels` | parcels.js | globalLimiter |
| `/api/hub` | hub.js | globalLimiter |
| `/api/carriers` | carriers.js | globalLimiter |
| `/api/payments` | payments.js | globalLimiter |
| `/api/scans` | scans.js | globalLimiter |
| `/api/finance` | finance.js | globalLimiter |
| `/api/purchasing` | purchasing.js | globalLimiter |
| `/api/loyalty` | loyalty.js | globalLimiter |
| `/api/unsold` | unsold.js | globalLimiter |
| `/api/config` | config.js | globalLimiter |
| `/health` | health.js | — |

> **pilotage.js** existe mais est **commenté** (non monté).
> **finance.js** est monté **2 fois** (`/api/admin/finance` + `/api/finance`).

### 5.2 Endpoints audités

#### hub.js (5 endpoints)
| Méthode | Path | Auth | Tables |
|---------|------|------|--------|
| POST | /api/hub/scan | admin, agent_hub | parcels FOR UPDATE, scans |
| POST | /api/hub/pack | admin, agent_hub | parcels FOR UPDATE |
| POST | /api/hub/seal | admin, agent_hub | parcels FOR UPDATE, orders |
| GET | /api/hub/pending | admin, agent_hub | parcels, orders, users, parcel_items |
| GET | /api/hub/today | admin, agent_hub | parcels |

#### parcels.js (6 endpoints)
| Méthode | Path | Auth | Tables |
|---------|------|------|--------|
| GET | /api/parcels | admin, agent_hub | parcels, orders |
| GET | /api/parcels/:ref | admin, agent_hub, agent_relais | parcels, orders, parcel_items, order_items, products |
| POST | /api/parcels | admin, agent_hub | parcels, orders |
| PATCH | /api/parcels/:id/status | admin, agent_hub | parcels, orders |
| POST | /api/parcels/:id/items | admin, agent_hub | parcel_items, order_items |
| DELETE | /api/parcels/:id/items/:item_id | admin, agent_hub | parcel_items |

#### dashboard.js (11 endpoints)
| Path | Tables |
|------|--------|
| /api/dashboard/ops | orders, relais, recipients, products |
| /api/dashboard/finance | orders, order_items, products |
| /api/dashboard/pilotage | orders, order_items, products, exchange_rates |
| /api/dashboard/pipeline | orders, users, recipients, relais, order_items, products |
| /api/dashboard/retards | orders, users, recipients |
| /api/dashboard/forecast | orders |
| /api/dashboard/clients | orders, users, order_items, products, relais |
| /api/dashboard/history | orders |
| /api/dashboard/hub-dubai | orders, users, order_items, products |
| /api/dashboard/relais | orders, recipients, relais, order_items, products |
| /api/dashboard/annulations-parcels | orders, parcels, parcel_items, refunds, store_credits |

#### orders.js (6 endpoints audités — fichier 102 KB partiellement lu)
| Méthode | Path | Tables |
|---------|------|--------|
| POST | /api/orders | orders, order_items, products, baskets, recipients, sms_log |
| GET | /api/orders | orders, users |
| GET | /api/orders/:ref | orders, order_items, products, users, relais, recipients |
| PATCH | /api/orders/:id/status | orders, order_status_history, sms_log |
| PATCH | /api/orders/:id/cost | orders |
| GET | /api/orders/:id/history | order_status_history |

#### logistics.js (5 endpoints)
| Méthode | Path | Tables |
|---------|------|--------|
| POST | /api/logistics/shipments | shipments |
| GET | /api/logistics/shipments | shipments, orders |
| PATCH | /api/logistics/shipments/:id | shipments, parcels, orders, users, relais |
| GET | /api/logistics/labels/:id | orders, users, relais, order_items, products |
| GET | /api/logistics/manifest/:id | shipments, orders, users, relais, order_items |

#### finance.js (4 endpoints)
| Méthode | Path | Tables | ⚠️ |
|---------|------|--------|----|
| GET | /finance/summary | → redirect 301 /dashboard/finance | — |
| GET | /finance/export | orders, users, relais, exchange_rates | 🔴 4 colonnes inexistantes |
| GET | /finance/stripe-proofs | orders, users + Stripe API | — |
| GET | /finance/report | orders + PDF | 🔴 colonnes inexistantes |

#### carriers.js (5 endpoints)
| Méthode | Path | Tables |
|---------|------|--------|
| GET | /api/carriers | carriers |
| POST | /api/carriers | carriers |
| PATCH | /api/carriers/:id | carriers |
| DELETE | /api/carriers/:id | carriers (soft-delete) |
| PATCH | /api/carriers/customs/:parcel_id | parcels |

#### relais.js (3 endpoints)
| Méthode | Path | Tables |
|---------|------|--------|
| GET | /api/relais | relais |
| GET | /api/relais/public | relais |
| GET | /api/relais/:id | relais |

---

## 6. UTILS & MIDDLEWARE

### Utils

| Fichier | Rôle | Tables touchées |
|---------|------|----------------|
| `parcelSync.js` | Source de vérité unique R1 : sync scan→parcel→order | parcels, parcel_items, orders, scans, order_status_history |
| `parcels.js` | Logique métier colis (statuts, poids, split, computeOrderStatus) | — (pur calcul) |
| `rules.js` | Business rules dynamiques (46 règles) | business_rules |
| `reference.js` | Générateur de références (KOM-XXXX) | — |
| `pricing.js` | Moteur de prix (conversion EUR/KMF/AED) | exchange_rates |
| `rates.js` | Taux de change | exchange_rates |
| `email.js` | Envoi d'emails (transactionnel) | — |
| `sms.js` | Envoi SMS (Africa's Talking) | sms_log |
| `refunds.js` | Logique remboursements | refunds, store_credits |
| `store-credits.js` | Gestion avoirs client | store_credits |

### Middleware

| Fichier | Rôle |
|---------|------|
| `auth.js` | JWT auth + rôle (admin, agent_hub, agent_relais, client) |
| `rate-limit.js` | Rate limiting granulaire (auth, order, admin, dashboard, global) |
| `upload.js` | Multer file upload |
| `validate.js` | Joi/Zod schema validation |

### Scripts

| Fichier | Rôle |
|---------|------|
| `impact-check.js` | Pre-commit hook : analyse d'impact des changements |
| `impact-config.json` | Config du check d'impact |
| `setup-hooks.sh` | Installation des git hooks |
| `test_e2e_full.sh` | Tests E2E complets |

---

## 7. COUVERTURE DE L'AUDIT

| Catégorie | Lus | Total | % |
|-----------|-----|-------|---|
| Schema/migrations | 6 | 6 | 100% |
| Routes | 10 | 22 | 45% |
| Utils | 2 | 10 | 20% |
| server.js + db.js | 2 | 2 | 100% |

> orders.js (102 KB) partiellement lu. Routes auth, products, admin, pricing, modules, baskets, payments, scans, purchasing, loyalty, unsold, health, config non auditées.

---

*Cartographie générée le 7 avril 2026 — Audit Tasklet AI*
