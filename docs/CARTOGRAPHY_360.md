# 🗺️ CARTOGRAPHIE D'IMPACT 360° — Komerce Backend

> 📅 Générée automatiquement — 05/04/2026 à 13:08
> 📊 **18 routes** · **118 endpoints** · **27 tables** · **9 services externes**

---

## 📑 Table des matières

1. [Vue d'ensemble architecture](#1--vue-densemble-architecture)
2. [Matrice des endpoints (118 endpoints)](#2--matrice-des-endpoints-118-endpoints)
3. [Matrice des dépendances inter-routes](#3--matrice-des-dépendances-inter-routes)
4. [Cartographie des tables DB](#4--cartographie-des-tables-db)
5. [Services externes](#5--services-externes)
6. [Chaîne de traitement des commandes](#6--chaîne-de-traitement-des-commandes)
7. [Matrice middleware](#7--matrice-middleware)
8. [Schéma DB](#8--schéma-db)
9. [Points de vigilance](#9--points-de-vigilance)

---

## 1. 🏗️ Vue d'ensemble architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Web / Mobile)                              │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          server.js (Express)                                    │
│                                                                                 │
│  Rate Limiters:                                                                 │
│  ├─ globalLimiter        → /api/*                                               │
│  ├─ authLimiter          → /api/auth/login, /api/auth/register                  │
│  ├─ cashConfirmLimiter   → /api/payments/cash/confirm                           │
│  ├─ scanCollectLimiter   → /api/scans/collect                                   │
│  ├─ orderCreateLimiter   → /api/orders                                          │
│  └─ dashboardLimiter     → /api/dashboard                                       │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
                   ┌───────────────┼───────────────────────┐
                   ▼               ▼                       ▼
         ┌─────────────┐  ┌──────────────┐       ┌──────────────┐
         │  Middleware  │  │  Middleware   │       │  Middleware   │
         │authenticate  │  │ requireRole  │       │ upload(multer)│
         │  (JWT)       │  │ (admin/hub)  │       │              │
         └──────┬──────┘  └──────┬───────┘       └──────┬───────┘
                │                │                       │
                ▼                ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ROUTES (18 fichiers)                               │
│                                                                                 │
│  🔐 Auth & Users          📦 Commandes & Paiements    📊 Admin & Pilotage       │
│  ├─ /api/auth             ├─ /api/orders               ├─ /api/admin            │
│  ├─ /api/loyalty          ├─ /api/payments             ├─ /api/admin/pilotage   │
│  └─ /api/relais           ├─ /api/purchasing           ├─ /api/admin/finance    │
│                           ├─ /api/scans                └─ /api/dashboard        │
│  🛍️ Produits & Modules    └─ /api/logistics                                     │
│  ├─ /api/products                                      🔧 Utilitaires           │
│  ├─ /api/modules          🛒 Paniers & Invendus        ├─ /api/pricing          │
│  └─ /api/pricing          ├─ /api/baskets              └─ /health               │
│                           └─ /api/unsold                                        │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
              ┌────────────────────┼──────────────────────┐
              ▼                    ▼                      ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────────┐
│   PostgreSQL DB   │  │ Services externes │  │   Fichiers / Uploads          │
│                   │  │                   │  │                               │
│  27 tables        │  │  Stripe (paiement)│  │  Multer → /uploads/            │
│  2 vues           │  │  SMS (Orange)     │  │  PDFKit → PDF labels/reports  │
│  2 fonctions      │  │  WhatsApp         │  │  QRCode → QR generation       │
│  6 triggers       │  │  Email (Mailjet)  │  │                               │
│                   │  │  JWT / bcrypt     │  │                               │
└───────────────────┘  └───────────────────┘  └───────────────────────────────┘
```

### Points de montage (server.js)

| Chemin de montage | Router | Rate Limiter |
|---|---|---|

| `/api/admin` | `adminRouter` | `—` |
| `/api/admin/finance` | `financeRouter` | `—` |
| `/api/admin/pilotage` | `pilotageRouter` | `—` |
| `/api/admin/stats` | `pilotageRouter` | `—` |
| `/api/auth` | `authRouter` | `—` |
| `/api/baskets` | `basketsRouter` | `—` |
| `/api/dashboard` | `dashboardRouter` | `dashboardLimiter` |
| `/api/finance` | `financeRouter` | `—` |
| `/api/logistics` | `logisticsRouter` | `—` |
| `/api/loyalty` | `loyaltyRouter` | `—` |
| `/api/modules` | `modulesRouter` | `—` |
| `/api/orders` | `ordersRouter` | `orderCreateLimiter` |
| `/api/payments` | `paymentsRouter` | `—` |
| `/api/pilotage` | `pilotageRouter` | `—` |
| `/api/pricing` | `pricingRouter` | `—` |
| `/api/products` | `productsRouter` | `—` |
| `/api/purchasing` | `purchasingRouter` | `—` |
| `/api/relais` | `relaisRouter` | `—` |
| `/api/scans` | `scansRouter` | `—` |
| `/api/unsold` | `unsoldRouter` | `—` |
| `/health` | `healthRouter` | `—` |

---


## 2. 📡 Matrice des endpoints (118 endpoints)

### 📁 admin.js — `/api/admin` (11 endpoints, 9 tables, 38.1 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/admin/dashboard` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 2 | 🟢 `GET` | `/api/admin/orders` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 3 | 🟢 `GET` | `/api/admin/margins` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 4 | 🟢 `GET` | `/api/admin/customs` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 5 | 🟢 `GET` | `/api/admin/alerts` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 6 | 🟢 `GET` | `/api/admin/partners` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 7 | 🔵 `POST` | `/api/admin/partners` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 8 | 🟡 `PUT` | `/api/admin/partners/:id` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 9 | 🔵 `POST` | `/api/admin/reset` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 10 | 🟢 `GET` | `/api/admin/counts` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |
| 11 | 🔵 `POST` | `/api/admin/seed-test` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `partners`, `products`, `recipients`, `relais`, `users` |

> 🌐 **Services externes** : `Stripe`, `bcrypt`


### 📁 auth.js — `/api/auth` (9 endpoints, 2 tables, 17.8 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🔵 `POST` | `/api/auth/register` | ✅ | — | `loyalty_tiers`, `users` |
| 2 | 🔵 `POST` | `/api/auth/login` | ✅ | — | `loyalty_tiers`, `users` |
| 3 | 🟢 `GET` | `/api/auth/me` | ✅ | — | `loyalty_tiers`, `users` |
| 4 | 🟡 `PUT` | `/api/auth/me` | ✅ | — | `loyalty_tiers`, `users` |
| 5 | 🔵 `POST` | `/api/auth/guest-checkout` | ✅ | — | `loyalty_tiers`, `users` |
| 6 | 🔵 `POST` | `/api/auth/auto-register` | ✅ | — | `loyalty_tiers`, `users` |
| 7 | 🔵 `POST` | `/api/auth/orders-by-phone` | ✅ | — | `loyalty_tiers`, `users` |
| 8 | 🔵 `POST` | `/api/auth/logout` | ✅ | — | `loyalty_tiers`, `users` |
| 9 | 🔵 `POST` | `/api/auth/admin-reset` | ✅ | — | `loyalty_tiers`, `users` |

> 🌐 **Services externes** : `JWT`, `bcrypt`


### 📁 baskets.js — `/api/baskets` (7 endpoints, 4 tables, 10.9 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/baskets` | ✅ | — | `basket_items`, `baskets`, `products`, `users` |
| 2 | 🔵 `POST` | `/api/baskets/share` | ✅ | — | `basket_items`, `baskets`, `products`, `users` |
| 3 | 🟢 `GET` | `/api/baskets/:code([A-Z]-[A-Z0-9]{4})` | ✅ | — | `basket_items`, `baskets`, `products`, `users` |
| 4 | 🟠 `PATCH` | `/api/baskets/:code` | ✅ | — | `basket_items`, `baskets`, `products`, `users` |
| 5 | 🔵 `POST` | `/api/baskets/:code/pay` | ✅ | — | `basket_items`, `baskets`, `products`, `users` |
| 6 | 🔵 `POST` | `/api/baskets/gift` | ✅ | — | `basket_items`, `baskets`, `products`, `users` |
| 7 | 🔵 `POST` | `/api/baskets/gift/:code/confirm` | ✅ | — | `basket_items`, `baskets`, `products`, `users` |

> 🌐 **Services externes** : `SMS (Orange)`, `WhatsApp`


### 📁 dashboard.js — `/api/dashboard` (5 endpoints, 6 tables, 32.8 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/dashboard/ops` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `users` |
| 2 | 🟢 `GET` | `/api/dashboard/sales` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `users` |
| 3 | 🟢 `GET` | `/api/dashboard/retards` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `users` |
| 4 | 🟢 `GET` | `/api/dashboard/forecast` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `users` |
| 5 | 🟢 `GET` | `/api/dashboard/pipeline` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `users` |

> 🌐 **Services externes** : `SMS (Orange)`


### 📁 finance.js — `/api/admin/finance` (4 endpoints, 4 tables, 15.7 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/admin/finance/summary` | ✅ | role-based | `exchange_rates`, `orders`, `relais`, `users` |
| 2 | 🟢 `GET` | `/api/admin/finance/export` | ✅ | role-based | `exchange_rates`, `orders`, `relais`, `users` |
| 3 | 🟢 `GET` | `/api/admin/finance/stripe-proofs` | ✅ | role-based | `exchange_rates`, `orders`, `relais`, `users` |
| 4 | 🟢 `GET` | `/api/admin/finance/report` | ✅ | role-based | `exchange_rates`, `orders`, `relais`, `users` |

> 🌐 **Services externes** : `PDFKit`, `Stripe`


### 📁 health.js — `/health` (2 endpoints, 0 tables, 1.3 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/health` | ❌ | — | — |
| 2 | 🟢 `GET` | `/health/ready` | ❌ | — | — |

### 📁 logistics.js — `/api/logistics` (5 endpoints, 7 tables, 9.3 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🔵 `POST` | `/api/logistics/shipments` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `shipments`, `users` |
| 2 | 🟢 `GET` | `/api/logistics/shipments` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `shipments`, `users` |
| 3 | 🟠 `PATCH` | `/api/logistics/shipments/:id` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `shipments`, `users` |
| 4 | 🟢 `GET` | `/api/logistics/labels/:shipment_id` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `shipments`, `users` |
| 5 | 🟢 `GET` | `/api/logistics/manifest/:shipment_id` | ✅ | role-based | `order_items`, `orders`, `products`, `recipients`, `relais`, `shipments`, `users` |

> 🌐 **Services externes** : `PDFKit`, `QRCode`, `SMS (Orange)`


### 📁 loyalty.js — `/api/loyalty` (7 endpoints, 3 tables, 5.4 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/loyalty/tiers` | ✅ | admin | `loyalty_tiers`, `users`, `v_loyalty_summary` |
| 2 | 🟢 `GET` | `/api/loyalty/me` | ✅ | admin | `loyalty_tiers`, `users`, `v_loyalty_summary` |
| 3 | 🟢 `GET` | `/api/loyalty/users` | ✅ | admin | `loyalty_tiers`, `users`, `v_loyalty_summary` |
| 4 | 🟢 `GET` | `/api/loyalty/stats` | ✅ | admin | `loyalty_tiers`, `users`, `v_loyalty_summary` |
| 5 | 🟡 `PUT` | `/api/loyalty/tiers/:id` | ✅ | admin | `loyalty_tiers`, `users`, `v_loyalty_summary` |
| 6 | 🔵 `POST` | `/api/loyalty/recalculate/:user_id` | ✅ | admin | `loyalty_tiers`, `users`, `v_loyalty_summary` |
| 7 | 🔵 `POST` | `/api/loyalty/recalculate-all` | ✅ | admin | `loyalty_tiers`, `users`, `v_loyalty_summary` |

### 📁 modules.js — `/api/modules` (7 endpoints, 3 tables, 19.9 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/modules` | ✅ | role-based | `fabrics`, `garment_models`, `products` |
| 2 | 🟢 `GET` | `/api/modules/:type` | ✅ | role-based | `fabrics`, `garment_models`, `products` |
| 3 | 🟢 `GET` | `/api/modules/fabrics` | ✅ | role-based | `fabrics`, `garment_models`, `products` |
| 4 | 🟢 `GET` | `/api/modules/models` | ✅ | role-based | `fabrics`, `garment_models`, `products` |
| 5 | 🔵 `POST` | `/api/modules/price` | ✅ | role-based | `fabrics`, `garment_models`, `products` |
| 6 | 🔵 `POST` | `/api/modules/fabrics` | ✅ | role-based | `fabrics`, `garment_models`, `products` |
| 7 | 🔵 `POST` | `/api/modules/models` | ✅ | role-based | `fabrics`, `garment_models`, `products` |

### 📁 orders.js — `/api/orders` (15 endpoints, 9 tables, 52.7 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🔵 `POST` | `/api/orders` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 2 | 🟢 `GET` | `/api/orders` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 3 | 🟢 `GET` | `/api/orders/:ref` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 4 | 🟢 `GET` | `/api/orders/relais` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 5 | 🟢 `GET` | `/api/orders/:ref` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 6 | 🟢 `GET` | `/api/orders/problems` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 7 | 🟢 `GET` | `/api/orders/:ref` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 8 | 🟢 `GET` | `/api/orders/relais` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 9 | 🟢 `GET` | `/api/orders/problems` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 10 | 🔵 `POST` | `/api/orders/:id/qr-token` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 11 | 🟢 `GET` | `/api/orders/retrait/:token` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 12 | 🟢 `GET` | `/api/orders/:ref` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 13 | 🟠 `PATCH` | `/api/orders/:id/status` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 14 | 🟠 `PATCH` | `/api/orders/:id/cost` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |
| 15 | 🟢 `GET` | `/api/orders/:id/history` | ✅ | role-based | `customs_history`, `order_items`, `order_status_history`, `orders`, `pour`, `products`, `recipients`, `relais`, `users` |

> 🔗 **Appels inter-routes** : `loyalty.recalculateLoyalty()`, `loyalty.getLoyaltyDiscount()`


> 🌐 **Services externes** : `Email (Mailjet)`, `QRCode`, `SMS (Orange)`, `Stripe`, `WhatsApp`


### 📁 payments.js — `/api/payments` (5 endpoints, 6 tables, 11.5 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🔵 `POST` | `/api/payments/stripe/intent` | ✅ | role-based | `exchange_rates`, `order_items`, `order_status_history`, `orders`, `products`, `users` |
| 2 | 🔵 `POST` | `/api/payments/stripe/webhook` | ✅ | role-based | `exchange_rates`, `order_items`, `order_status_history`, `orders`, `products`, `users` |
| 3 | 🔵 `POST` | `/api/payments/cash/confirm` | ✅ | role-based | `exchange_rates`, `order_items`, `order_status_history`, `orders`, `products`, `users` |
| 4 | 🟢 `GET` | `/api/payments/rates` | ✅ | role-based | `exchange_rates`, `order_items`, `order_status_history`, `orders`, `products`, `users` |
| 5 | 🟢 `GET` | `/api/payments/config` | ✅ | role-based | `exchange_rates`, `order_items`, `order_status_history`, `orders`, `products`, `users` |

> 🔗 **Appels inter-routes** : `purchasing.triggerPurchasing()`


> 🌐 **Services externes** : `SMS (Orange)`, `Stripe`


### 📁 pilotage.js — `/api/admin/pilotage` (3 endpoints, 8 tables, 27.2 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/admin/pilotage` | ✅ | role-based | `customs_taux_mensuel`, `exchange_rates`, `loyalty_tiers`, `order_items`, `orders`, `products`, `relais`, `users` |
| 2 | 🟢 `GET` | `/api/admin/pilotage/history` | ✅ | role-based | `customs_taux_mensuel`, `exchange_rates`, `loyalty_tiers`, `order_items`, `orders`, `products`, `relais`, `users` |
| 3 | 🟢 `GET` | `/api/admin/pilotage/clients` | ✅ | role-based | `customs_taux_mensuel`, `exchange_rates`, `loyalty_tiers`, `order_items`, `orders`, `products`, `relais`, `users` |

> 🌐 **Services externes** : `JWT`, `SMS (Orange)`, `Stripe`


### 📁 pricing.js — `/api/pricing` (4 endpoints, 4 tables, 3.5 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🔵 `POST` | `/api/pricing/calculate` | ✅ | role-based | `exchange_rates`, `fabrics`, `garment_models`, `products` |
| 2 | 🔵 `POST` | `/api/pricing/couture` | ✅ | role-based | `exchange_rates`, `fabrics`, `garment_models`, `products` |
| 3 | 🟢 `GET` | `/api/pricing/rates` | ✅ | role-based | `exchange_rates`, `fabrics`, `garment_models`, `products` |
| 4 | 🟡 `PUT` | `/api/pricing/rates` | ✅ | role-based | `exchange_rates`, `fabrics`, `garment_models`, `products` |

### 📁 products.js — `/api/products` (8 endpoints, 1 tables, 11.6 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/products` | ✅ | role-based | `products` |
| 2 | 🟢 `GET` | `/api/products/categories` | ✅ | role-based | `products` |
| 3 | 🟢 `GET` | `/api/products/:id` | ✅ | role-based | `products` |
| 4 | 🔵 `POST` | `/api/products` | ✅ | role-based | `products` |
| 5 | 🟡 `PUT` | `/api/products/:id` | ✅ | role-based | `products` |
| 6 | 🔴 `DELETE` | `/api/products/:id` | ✅ | role-based | `products` |
| 7 | 🔵 `POST` | `/api/products/:id/image` | ✅ | role-based | `products` |
| 8 | 🔵 `POST` | `/api/products/:id/images` | ✅ | role-based | `products` |

### 📁 purchasing.js — `/api/purchasing` (10 endpoints, 8 tables, 31.8 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/purchasing` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 2 | 🟢 `GET` | `/api/purchasing/suppliers` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 3 | 🔵 `POST` | `/api/purchasing/suppliers` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 4 | 🔵 `POST` | `/api/purchasing/suppliers/:id/map` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 5 | 🔴 `DELETE` | `/api/purchasing/suppliers/:id` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 6 | 🟢 `GET` | `/api/purchasing/order/:order_id/completeness` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 7 | 🟢 `GET` | `/api/purchasing/:order_id` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 8 | 🔵 `POST` | `/api/purchasing/:order_id/confirm` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 9 | 🔵 `POST` | `/api/purchasing/:id/receive` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |
| 10 | 🔴 `DELETE` | `/api/purchasing/po/:po_id` | ✅ | role-based | `order_items`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `relais`, `suppliers`, `via` |

> 🔗 **Appels inter-routes** : `scans.triggerScan3()`


> 🌐 **Services externes** : `SMS (Orange)`, `WhatsApp`


### 📁 relais.js — `/api/relais` (3 endpoints, 1 tables, 1.6 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/relais` | ❌ | — | `relais` |
| 2 | 🟢 `GET` | `/api/relais/public` | ❌ | — | `relais` |
| 3 | 🟢 `GET` | `/api/relais/:id` | ❌ | — | `relais` |

### 📁 scans.js — `/api/scans` (6 endpoints, 11 tables, 20.3 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🔵 `POST` | `/api/scans` | ✅ | role-based | `order_items`, `order_status_history`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `recipients`, `relais`, `scans`, `users`, `via` |
| 2 | 🔵 `POST` | `/api/scans/collect` | ✅ | role-based | `order_items`, `order_status_history`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `recipients`, `relais`, `scans`, `users`, `via` |
| 3 | 🔵 `POST` | `/api/scans/hub/receive` | ✅ | role-based | `order_items`, `order_status_history`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `recipients`, `relais`, `scans`, `users`, `via` |
| 4 | 🟢 `GET` | `/api/scans/hub/pending` | ✅ | role-based | `order_items`, `order_status_history`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `recipients`, `relais`, `scans`, `users`, `via` |
| 5 | 🔵 `POST` | `/api/scans/verify-qr` | ✅ | role-based | `order_items`, `order_status_history`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `recipients`, `relais`, `scans`, `users`, `via` |
| 6 | 🟢 `GET` | `/api/scans/:order_id` | ✅ | role-based | `order_items`, `order_status_history`, `orders`, `product_suppliers`, `products`, `purchase_orders`, `recipients`, `relais`, `scans`, `users`, `via` |

> 🔗 **Appels inter-routes** : `loyalty.const { recalculateLoyalty()`


> 🌐 **Services externes** : `SMS (Orange)`


### 📁 unsold.js — `/api/unsold` (7 endpoints, 5 tables, 6.3 Ko)

| # | Méthode | Chemin complet | Auth | Rôles | Tables touchées |
|---|---------|---------------|------|-------|-----------------|
| 1 | 🟢 `GET` | `/api/unsold` | ✅ | admin | `order_items`, `orders`, `products`, `unsold_items`, `v_unsold_pipeline` |
| 2 | 🔵 `POST` | `/api/unsold/scan` | ✅ | admin | `order_items`, `orders`, `products`, `unsold_items`, `v_unsold_pipeline` |
| 3 | 🟢 `GET` | `/api/unsold/:id` | ✅ | admin | `order_items`, `orders`, `products`, `unsold_items`, `v_unsold_pipeline` |
| 4 | 🟠 `PATCH` | `/api/unsold/:id` | ✅ | admin | `order_items`, `orders`, `products`, `unsold_items`, `v_unsold_pipeline` |
| 5 | 🔵 `POST` | `/api/unsold/:id/resolve` | ✅ | admin | `order_items`, `orders`, `products`, `unsold_items`, `v_unsold_pipeline` |
| 6 | 🟢 `GET` | `/api/unsold/:id/whatsapp` | ✅ | admin | `order_items`, `orders`, `products`, `unsold_items`, `v_unsold_pipeline` |
| 7 | 🟢 `GET` | `/api/unsold/stats/summary` | ✅ | admin | `order_items`, `orders`, `products`, `unsold_items`, `v_unsold_pipeline` |

> 🌐 **Services externes** : `WhatsApp`


---

## 3. 🔗 Matrice des dépendances inter-routes

### Appels croisés identifiés

| Route source | Route cible | Fonction appelée | Direction |
|---|---|---|---|
| `orders.js` | `loyalty.js` | `getLoyaltyDiscount()` | orders → loyalty |
| `orders.js` | `loyalty.js` | `recalculateLoyalty()` | orders → loyalty |
| `payments.js` | `purchasing.js` | `triggerPurchasing()` | payments → purchasing |
| `purchasing.js` | `scans.js` | `triggerScan3()` | purchasing → scans |
| `scans.js` | `loyalty.js` | `recalculateLoyalty()` | scans → loyalty |

### Graphe de dépendances

```
                    ┌────────────┐
                    │  orders.js │
                    └─────┬──────┘
                          │
              ┌───────────┴───────────┐
              │ getLoyaltyDiscount()   │ recalculateLoyalty()
              ▼                       ▼
        ┌────────────┐         ┌─────────────┐
        │ loyalty.js │◄────────│  scans.js   │
        └────────────┘         └──────▲──────┘
              ▲                       │
              │                       │ triggerScan3()
              │                       │
              │                ┌──────┴──────┐
              │                │purchasing.js│
              │                └──────▲──────┘
              │                       │
              │                       │ triggerPurchasing()
              │                       │
              │                ┌──────┴──────┐
              │                │payments.js  │
              │                └─────────────┘
              │
              └─── recalculateLoyalty()
```

### Flux de la chaîne complète

```
orders.js ──payment──▶ payments.js ──trigger──▶ purchasing.js ──trigger──▶ scans.js ──recalc──▶ loyalty.js
    │                                                                                              ▲
    └──────────────────────── getLoyaltyDiscount() / recalculateLoyalty() ──────────────────────────┘
```

> ⚠️ **Couplage fort** : La chaîne `payments → purchasing → scans → loyalty` est une dépendance linéaire critique. Une panne sur n'importe quel maillon bloque le flux entier.

---


## 4. 🗄️ Cartographie des tables DB

### Matrice Tables × Routes

| # | Table | Routes associées | Nb routes | Criticité |
|---|-------|-----------------|-----------|-----------|
| 1 | `products` | `admin.js`, `baskets.js`, `dashboard.js`, `logistics.js`, `modules.js`, `orders.js`, `payments.js`, `pilotage.js`, `pricing.js`, `products.js`, `purchasing.js`, `scans.js`, `unsold.js` | 13 | 🔴 CRITIQUE (13) |
| 2 | `users` | `admin.js`, `auth.js`, `baskets.js`, `dashboard.js`, `finance.js`, `logistics.js`, `loyalty.js`, `orders.js`, `payments.js`, `pilotage.js`, `scans.js` | 11 | 🔴 CRITIQUE (11) |
| 3 | `orders` | `admin.js`, `dashboard.js`, `finance.js`, `logistics.js`, `orders.js`, `payments.js`, `pilotage.js`, `purchasing.js`, `scans.js`, `unsold.js` | 10 | 🔴 CRITIQUE (10) |
| 4 | `order_items` | `admin.js`, `dashboard.js`, `logistics.js`, `orders.js`, `payments.js`, `pilotage.js`, `purchasing.js`, `scans.js`, `unsold.js` | 9 | 🔴 CRITIQUE (9) |
| 5 | `relais` | `admin.js`, `dashboard.js`, `finance.js`, `logistics.js`, `orders.js`, `pilotage.js`, `purchasing.js`, `relais.js`, `scans.js` | 9 | 🔴 CRITIQUE (9) |
| 6 | `recipients` | `admin.js`, `dashboard.js`, `logistics.js`, `orders.js`, `scans.js` | 5 | 🔴 CRITIQUE (5) |
| 7 | `exchange_rates` | `finance.js`, `payments.js`, `pilotage.js`, `pricing.js` | 4 | 🟠 ÉLEVÉE (4) |
| 8 | `order_status_history` | `admin.js`, `orders.js`, `payments.js`, `scans.js` | 4 | 🟠 ÉLEVÉE (4) |
| 9 | `loyalty_tiers` | `auth.js`, `loyalty.js`, `pilotage.js` | 3 | 🟠 ÉLEVÉE (3) |
| 10 | `customs_history` | `admin.js`, `orders.js` | 2 | 🟡 MOYENNE (2) |
| 11 | `fabrics` | `modules.js`, `pricing.js` | 2 | 🟡 MOYENNE (2) |
| 12 | `garment_models` | `modules.js`, `pricing.js` | 2 | 🟡 MOYENNE (2) |
| 13 | `product_suppliers` | `purchasing.js`, `scans.js` | 2 | 🟡 MOYENNE (2) |
| 14 | `purchase_orders` | `purchasing.js`, `scans.js` | 2 | 🟡 MOYENNE (2) |
| 15 | `via` | `purchasing.js`, `scans.js` | 2 | 🟡 MOYENNE (2) |
| 16 | `basket_items` | `baskets.js` | 1 | 🟢 FAIBLE (1) |
| 17 | `baskets` | `baskets.js` | 1 | 🟢 FAIBLE (1) |
| 18 | `customs_taux_mensuel` | `pilotage.js` | 1 | 🟢 FAIBLE (1) |
| 19 | `partners` | `admin.js` | 1 | 🟢 FAIBLE (1) |
| 20 | `pour` | `orders.js` | 1 | 🟢 FAIBLE (1) |
| 21 | `scans` | `scans.js` | 1 | 🟢 FAIBLE (1) |
| 22 | `shipments` | `logistics.js` | 1 | 🟢 FAIBLE (1) |
| 23 | `suppliers` | `purchasing.js` | 1 | 🟢 FAIBLE (1) |
| 24 | `unsold_items` | `unsold.js` | 1 | 🟢 FAIBLE (1) |
| 25 | `v_loyalty_summary` | `loyalty.js` | 1 | 🟢 FAIBLE (1) |
| 26 | `v_unsold_pipeline` | `unsold.js` | 1 | 🟢 FAIBLE (1) |

### Tables sans routes identifiées dans le code


- `product` — ⚠️ Table définie dans le schéma mais non référencée dans les routes analysées

### Heatmap Tables critiques

```
Table                   │ Nb routes │ Barre de criticité
────────────────────────┼───────────┼──────────────────────────
  products               │    13     │ █████████████ 🔴
  users                  │    11     │ ███████████░░ 🔴
  orders                 │    10     │ ██████████░░░ 🔴
  order_items            │     9     │ █████████░░░░ 🔴
  relais                 │     9     │ █████████░░░░ 🔴
  recipients             │     5     │ █████░░░░░░░░ 🔴
  exchange_rates         │     4     │ ████░░░░░░░░░ 🟠
  order_status_history   │     4     │ ████░░░░░░░░░ 🟠
  loyalty_tiers          │     3     │ ███░░░░░░░░░░ 🟠
  customs_history        │     2     │ ██░░░░░░░░░░░ 🟡
```

---

## 5. 🌐 Services externes

| # | Service | Type | Routes utilisatrices | Nb routes | Usage principal |
|---|---------|------|---------------------|-----------|-----------------|
| 1 | **Email (Mailjet)** | 📧 Email | `orders.js` | 1 | Emails transactionnels : confirmation de commande, factures |
| 2 | **JWT** | 🔐 Auth Token | `auth.js`, `pilotage.js` | 2 | Génération et vérification de tokens d'authentification |
| 3 | **PDFKit** | 📄 Génération PDF | `finance.js`, `logistics.js` | 2 | Étiquettes d'expédition, manifestes, rapports financiers |
| 4 | **QRCode** | 📲 QR Code | `logistics.js`, `orders.js` | 2 | Génération de QR codes pour retrait et étiquettes |
| 5 | **SMS (Orange)** | 📱 Notification | `baskets.js`, `dashboard.js`, `logistics.js`, `orders.js`, `payments.js`, `pilotage.js`, `purchasing.js`, `scans.js` | 8 | Notifications SMS : confirmation commande, expédition, collecte, alertes |
| 6 | **Stripe** | 💳 Paiement | `admin.js`, `finance.js`, `orders.js`, `payments.js`, `pilotage.js` | 5 | Création d'intents, webhooks, vérification de paiements, preuves |
| 7 | **WhatsApp** | 💬 Messagerie | `baskets.js`, `orders.js`, `purchasing.js`, `unsold.js` | 4 | Notifications WhatsApp : paniers partagés, achats, invendus |
| 8 | **bcrypt** | 🔒 Hashing | `admin.js`, `auth.js` | 2 | Hachage et vérification de mots de passe |


### Architecture des services externes

```
┌──────────────────────────────────────────────────────────────┐
│                     Komerce Backend                          │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌───────────┐              │
│  │orders.js │    │payments.js│    │  auth.js  │              │
│  └────┬─────┘    └────┬─────┘    └─────┬─────┘              │
│       │               │               │                      │
└───────┼───────────────┼───────────────┼──────────────────────┘
        │               │               │
   ┌────▼────┐    ┌────▼────┐    ┌────▼────┐
   │  Stripe │    │  Stripe │    │   JWT   │
   │  SMS    │    │  SMS    │    │  bcrypt │
   │WhatsApp │    │         │    │         │
   │  Email  │    │         │    │         │
   │ QRCode  │    │         │    │         │
   └─────────┘    └─────────┘    └─────────┘
```

---


## 6. 🔄 Chaîne de traitement des commandes

### Cycle de vie complet d'une commande

```
  ÉTAPE 1                 ÉTAPE 2                ÉTAPE 3              ÉTAPE 4
  Création                Paiement               Achat fournisseur    Réception hub
  ┌──────────┐           ┌──────────┐           ┌──────────────┐    ┌──────────────┐
  │orders.js │──paid───▶ │payments.js│──trigger─▶│purchasing.js │───▶│purchasing.js │
  │ POST /   │           │ stripe/   │           │triggerPurch- │    │ :id/receive  │
  │          │           │ webhook   │           │asing()       │    │              │
  │          │           │  -ou-     │           │              │    │              │
  │          │           │ cash/     │           │              │    │              │
  │          │           │ confirm   │           │              │    │              │
  └──────────┘           └──────────┘           └──────────────┘    └──────┬───────┘
       │                                                                   │
       │                                                          triggerScan3()
       │                                                                   │
       │                                                                   ▼
  ÉTAPE 9                 ÉTAPE 8                ÉTAPE 7              ÉTAPE 5
  Fidélité                Collecte               Réception relais     Expédition
  ┌──────────┐           ┌──────────┐           ┌──────────────┐    ┌──────────────┐
  │loyalty.js│◀──recalc──│ scans.js │◀──step────│  scans.js    │◀───│  scans.js    │
  │recalculate│          │ /collect │           │ POST /        │    │  POST /      │
  │Loyalty() │           │ -ou-     │           │ step=relais_  │    │  step=shipped│
  │          │           │/verify-qr│           │ received      │    │              │
  └──────────┘           └──────────┘           └──────────────┘    └──────────────┘
```

### Détail des étapes

| # | Étape | Route | Endpoint | Statut commande | Tables modifiées | Notification |
|---|-------|-------|----------|----------------|------------------|-------------|
| 1 | 🛒 Création commande | `orders.js` | `POST /api/orders` | `pending` | `orders`, `order_items`, `recipients` | SMS + WhatsApp |
| 2a | 💳 Paiement Stripe | `payments.js` | `POST /api/payments/stripe/webhook` | `paid` | `orders`, `order_status_history` | SMS |
| 2b | 💵 Paiement Cash | `payments.js` | `POST /api/payments/cash/confirm` | `paid` | `orders`, `order_status_history` | SMS |
| 3 | 📋 Déclenchement achat | `purchasing.js` | `triggerPurchasing()` | `purchasing` | `purchase_orders`, `order_items` | SMS + WhatsApp |
| 4 | 📦 Réception hub | `purchasing.js` | `POST /api/purchasing/:id/receive` | `hub_received` | `purchase_orders`, `orders` | — |
| 5 | 🚚 Expédition | `scans.js` | `POST /api/scans` (step=shipped) | `shipped` | `scans`, `order_status_history` | SMS |
| 6 | 📍 Réception relais | `scans.js` | `POST /api/scans` (step=relais_received) | `relais_received` | `scans`, `order_status_history` | SMS |
| 7 | ✅ Collecte client | `scans.js` | `POST /api/scans/collect` ou `/verify-qr` | `collected` | `scans`, `order_status_history`, `orders` | SMS |
| 8 | ⭐ Recalcul fidélité | `loyalty.js` | `recalculateLoyalty()` | — | `users`, `loyalty_tiers` | — |

### Statuts de commande (cycle de vie)

```
pending ──▶ paid ──▶ purchasing ──▶ hub_received ──▶ shipped ──▶ relais_received ──▶ collected
   │                                                                                      │
   │                         ┌── cancelled                                                 │
   └─────────────────────────┤                                                             │
                             └── problem                                                   │
                                                                                           │
                                                                    recalculateLoyalty() ◀─┘
```

---


## 7. 🛡️ Matrice middleware

| Route | `authenticate` | `requireRole` | `requireAdmin` | `rate-limit` | `upload (multer)` | `express.raw` |
|-------|:--------------:|:-------------:|:--------------:|:------------:|:-----------------:|:-------------:|
| `admin.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `auth.js` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `baskets.js` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `dashboard.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `finance.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `health.js` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `logistics.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `loyalty.js` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `modules.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `orders.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `payments.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `pilotage.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `pricing.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `products.js` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `purchasing.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `relais.js` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `scans.js` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `unsold.js` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |


### Détail des middleware

| Middleware | Fichier | Dépendances | Rôle |
|---|---|---|---|
| `authenticate` | `middleware/auth.js` | `jsonwebtoken`, `db` | Vérifie le token JWT et charge l'utilisateur |
| `requireRole` | `middleware/auth.js` | — | Vérifie que l'utilisateur a le rôle requis (admin, hub, relais) |
| `requireAdmin` | `middleware/auth.js` | — | Raccourci pour `requireRole('admin')` |
| `rate-limit` | `middleware/rate-limit.js` | `express-rate-limit` | Limite le nombre de requêtes par IP |
| `upload` | `middleware/upload.js` | `multer`, `crypto`, `fs` | Gestion des uploads de fichiers (images produits) |

### Rate Limiters (server.js)

| Limiter | Route protégée | Description |
|---|---|---|
| `globalLimiter` | `/api/*` | Limite globale sur toutes les routes API |
| `authLimiter` | `/api/auth/login`, `/api/auth/register` | Protection brute-force sur l'authentification |
| `cashConfirmLimiter` | `/api/payments/cash/confirm` | Protection contre les confirmations cash abusives |
| `scanCollectLimiter` | `/api/scans/collect` | Protection contre les scans de collecte abusifs |
| `orderCreateLimiter` | `/api/orders` | Protection contre la création massive de commandes |
| `dashboardLimiter` | `/api/dashboard` | Protection contre les requêtes dashboard intensives |

---


## 8. 📐 Schéma DB

### Tables (19)

| # | Table | Type | Description |
|---|-------|------|-------------|
| 1 | `basket_items` | 📋 Table | Articles dans les paniers |
| 2 | `baskets` | 📋 Table | Paniers partagés |
| 3 | `ceremony_fabrics` | 📋 Table | Tissus cérémonie |
| 4 | `ceremony_models` | 📋 Table | Modèles cérémonie |
| 5 | `ceremony_order_items` | 📋 Table | Articles commande cérémonie |
| 6 | `disputes` | 📋 Table | Litiges et réclamations |
| 7 | `exchange_rates` | 📋 Table | Taux de change EUR/XOF |
| 8 | `fabrics` | 📋 Table | Tissus (module couture) |
| 9 | `garment_models` | 📋 Table | Modèles de vêtements (module couture) |
| 10 | `order_items` | 📋 Table | Articles de commande |
| 11 | `order_status_history` | 📋 Table | Historique des changements de statut |
| 12 | `orders` | 📋 Table | Commandes principales |
| 13 | `products` | 📋 Table | Catalogue produits |
| 14 | `recipients` | 📋 Table | Destinataires des commandes |
| 15 | `relais` | 📋 Table | Points relais de collecte |
| 16 | `scans` | 📋 Table | Scans de suivi (shipped, received, collected) |
| 17 | `shipments` | 📋 Table | Expéditions groupées |
| 18 | `sms_log` | 📋 Table | Journal des SMS envoyés |
| 19 | `users` | 📋 Table | Utilisateurs (clients, admins, hubs, relais) |

### Fonctions (2)

| # | Fonction | Description |
|---|----------|-------------|
| 1 | `set_updated_at()` | Met à jour automatiquement le champ `updated_at` sur modification |
| 2 | `sync_order_status_from_scan()` | Synchronise le statut de commande à partir d'un nouveau scan |

### Triggers (6)

| # | Trigger | Table cible | Description |
|---|---------|------------|-------------|
| 1 | `trg_disputes_updated` | `disputes` | Appelle `set_updated_at()` à chaque modification litige |
| 2 | `trg_orders_updated` | `orders` | Appelle `set_updated_at()` à chaque modification commande |
| 3 | `trg_products_updated` | `products` | Appelle `set_updated_at()` à chaque modification produit |
| 4 | `trg_scan_sync_status` | `scans` | Appelle `sync_order_status_from_scan()` après insertion d'un scan |
| 5 | `trg_shipments_updated` | `shipments` | Appelle `set_updated_at()` à chaque modification expédition |
| 6 | `trg_users_updated` | `users` | Appelle `set_updated_at()` à chaque modification utilisateur |


### Diagramme entité-relation simplifié

```
┌──────────┐     ┌────────────┐     ┌──────────────┐     ┌───────────┐
│  users   │────▶│   orders   │────▶│ order_items   │────▶│ products  │
│          │     │            │     │              │     │           │
│ id       │     │ id         │     │ order_id     │     │ id        │
│ email    │     │ user_id    │     │ product_id   │     │ name      │
│ role     │     │ status     │     │ qty          │     │ price     │
│ loyalty_ │     │ relais_id  │     │ price        │     │           │
│  tier_id │     │ total      │     └──────────────┘     └─────┬─────┘
└────┬─────┘     └──────┬─────┘                                │
     │                  │                                      │
     │                  │           ┌──────────────────┐       │
     │                  ├──────────▶│order_status_history│      │
     │                  │           │ order_id          │      │
     │                  │           │ status            │      │
     │                  │           │ changed_at        │      │
     │                  │           └──────────────────┘       │
     │                  │                                      │
     │                  │           ┌──────────────┐           │
     │                  ├──────────▶│  recipients  │           │
     │                  │           └──────────────┘           │
     │                  │                                      │
     │                  │           ┌──────────────┐           │
     │                  ├──────────▶│    scans     │           │
     │                  │           └──────────────┘           │
     │                  │                                      │
     │                  │           ┌──────────────┐    ┌──────┴──────┐
     │                  └──────────▶│   relais     │    │product_     │
     │                              └──────────────┘    │suppliers    │
     │                                                  │             │
     │           ┌──────────────┐                       │ product_id  │
     └──────────▶│loyalty_tiers │                       │ supplier_id │
                 └──────────────┘                       └──────┬──────┘
                                                               │
                                    ┌──────────────┐           │
                                    │  suppliers   │◀──────────┘
                                    └──────────────┘
                                    
                                    ┌──────────────┐     ┌──────────────┐
                                    │purchase_orders│────▶│ order_items   │
                                    │              │     │              │
                                    │ supplier_id  │     └──────────────┘
                                    └──────────────┘
```

---


## 9. ⚠️ Points de vigilance

### 🔴 Tables à risque (points de défaillance unique)

Tables utilisées par 5+ routes — une migration ou un problème sur ces tables impacte une grande partie du système :

- **`products`** — **13 routes** dépendantes : `admin.js`, `baskets.js`, `dashboard.js`, `logistics.js`, `modules.js`, `orders.js`, `payments.js`, `pilotage.js`, `pricing.js`, `products.js`, `purchasing.js`, `scans.js`, `unsold.js`
- **`users`** — **11 routes** dépendantes : `admin.js`, `auth.js`, `baskets.js`, `dashboard.js`, `finance.js`, `logistics.js`, `loyalty.js`, `orders.js`, `payments.js`, `pilotage.js`, `scans.js`
- **`orders`** — **10 routes** dépendantes : `admin.js`, `dashboard.js`, `finance.js`, `logistics.js`, `orders.js`, `payments.js`, `pilotage.js`, `purchasing.js`, `scans.js`, `unsold.js`
- **`order_items`** — **9 routes** dépendantes : `admin.js`, `dashboard.js`, `logistics.js`, `orders.js`, `payments.js`, `pilotage.js`, `purchasing.js`, `scans.js`, `unsold.js`
- **`relais`** — **9 routes** dépendantes : `admin.js`, `dashboard.js`, `finance.js`, `logistics.js`, `orders.js`, `pilotage.js`, `purchasing.js`, `relais.js`, `scans.js`
- **`recipients`** — **5 routes** dépendantes : `admin.js`, `dashboard.js`, `logistics.js`, `orders.js`, `scans.js`

### 🟠 Routes à risque

Routes les plus complexes (nombreux endpoints, tables, dépendances) :

| Route | Endpoints | Tables | Appels croisés | Services ext. | Taille | Score complexité |
|-------|-----------|--------|---------------|---------------|--------|-----------------|
| 🔴 `orders.js` | 15 | 9 | 2 | 5 | 52.7 Ko | **77** |
| 🔴 `admin.js` | 11 | 9 | 0 | 2 | 38.1 Ko | **53** |
| 🔴 `purchasing.js` | 10 | 8 | 1 | 2 | 31.8 Ko | **53** |
| 🔴 `scans.js` | 6 | 11 | 1 | 1 | 20.3 Ko | **52** |
| 🟠 `logistics.js` | 5 | 7 | 0 | 3 | 9.3 Ko | **37** |
| 🟠 `payments.js` | 5 | 6 | 1 | 2 | 11.5 Ko | **37** |
| 🟠 `pilotage.js` | 3 | 8 | 0 | 3 | 27.2 Ko | **36** |
| 🟠 `unsold.js` | 7 | 5 | 0 | 1 | 6.3 Ko | **31** |

### 🟡 Routes sans authentification

Routes accessibles sans token JWT :

- **`health.js`** (`/health`) — 2 endpoints publics : `GET /`, `GET /ready`
- **`relais.js`** (`/api/relais`) — 3 endpoints publics : `GET /`, `GET /public`, `GET /:id`

### 🔵 Dépendances circulaires potentielles

Aucune dépendance circulaire directe détectée. Cependant, la chaîne de dépendances est **linéaire et longue** :

```
orders.js → loyalty.js       (appel direct)
payments.js → purchasing.js  (triggerPurchasing)
purchasing.js → scans.js     (triggerScan3)
scans.js → loyalty.js        (recalculateLoyalty)
```

**Risque** : Si `loyalty.js` devait un jour appeler `orders.js`, une boucle serait créée.


### 📋 Recommandations prioritaires

| # | Priorité | Recommandation | Impact |
|---|----------|---------------|--------|
| 1 | 🔴 Haute | Ajouter des index sur `orders.user_id`, `order_items.order_id`, `orders.status` | Performance des requêtes sur les tables les plus sollicitées |
| 2 | 🔴 Haute | Découpler la chaîne payments→purchasing→scans via une file de messages (Redis/BullMQ) | Résilience : une panne sur un maillon ne bloque plus tout |
| 3 | 🟠 Moyenne | Refactorer `orders.js` (54 Ko, 15 endpoints, 9 tables) en sous-modules | Maintenabilité et testabilité |
| 4 | 🟠 Moyenne | Ajouter `authenticate` sur `relais.js` et `health.js` (ou documenter comme intentionnel) | Sécurité |
| 5 | 🟡 Basse | Extraire les fonctions partagées (recalculateLoyalty, triggerPurchasing, triggerScan3) en un service dédié | Réduction du couplage inter-routes |
| 6 | 🟡 Basse | Ajouter des tests d'intégration sur la chaîne complète commande→paiement→achat→scan→fidélité | Fiabilité du flux critique |

---

## 📊 Statistiques finales

| Métrique | Valeur |
|----------|--------|
| Fichiers route analysés | **18** |
| Endpoints totaux | **118** |
| Tables PostgreSQL | **27** |
| Vues | **2** (`v_loyalty_summary`, `v_unsold_pipeline`) |
| Fonctions DB | **2** |
| Triggers DB | **6** |
| Services externes | **9** |
| Middleware | **3** (authenticate, rate-limit, upload) |
| Appels inter-routes | **5** |
| Tables critiques (5+ routes) | **6** |
| Route la plus complexe | `orders.js` (52 Ko, 15 endpoints) |

---

> 📝 *Ce document a été généré automatiquement à partir de l'analyse statique du code source. Il reflète l'état du code au moment de l'analyse et doit être mis à jour lors de modifications significatives de l'architecture.*

---

## 🤖 Dernière analyse automatique

> Mise à jour : 2026-04-05 22:12:15 UTC

| Métrique | Valeur |
|----------|--------|
| Routes analysées | 18 |
| Tables cartographiées | 20 |
| Services externes | 9 |
| Score de risque global | 100/100 |
| Alertes sécurité | 538 |

*Régénéré automatiquement par le coffre-fort Komerce v1.0*
