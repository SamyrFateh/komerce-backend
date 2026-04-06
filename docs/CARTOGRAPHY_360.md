# 🗺️ CARTOGRAPHIE D'IMPACT 360° — Komerce Backend

> 📅 **Date** : 6 avril 2026  
> 🏷️ **Version** : v12.0  
> 📊 **18 fichiers route** · **~120 endpoints** · **27+ tables** · **3 vues** · **9 services externes**

---

## 📑 Table des matières

1. [Vue d'ensemble architecture](#1--vue-densemble-architecture)
2. [Carte des routes (endpoints)](#2--carte-des-routes)
3. [Schéma de base de données](#3--schéma-de-base-de-données)
4. [Middleware & sécurité](#4--middleware--sécurité)
5. [Dépendances inter-routes](#5--dépendances-inter-routes)
6. [Chaîne de traitement des commandes](#6--chaîne-de-traitement-des-commandes)
7. [Services externes](#7--services-externes)
8. [Utilitaires](#8--utilitaires)
9. [Audit de sécurité](#9--audit-de-sécurité)
10. [Dashboard Komerce Pilotage (Instant App)](#10--dashboard-komerce-pilotage)
11. [PRs & Issues — État actuel](#11--prs--issues)
12. [Roadmap](#12--roadmap)
13. [Stack technique](#13--stack-technique)
14. [Points de vigilance](#14--points-de-vigilance)
15. [Statistiques finales](#15--statistiques-finales)

---

## 1. 🏗️ Vue d'ensemble architecture

### Architecture générale

**Komerce** est une API e-commerce Node.js/Express + PostgreSQL, déployée sur **Railway**, servant de backend pour une marketplace Comores ↔ Dubai.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Web / Mobile)                              │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          server.js (Express v4)                                 │
│                                                                                 │
│  Helmet (CSP) · CORS · cookie-parser · express.json (1MB)                      │
│                                                                                 │
│  Rate Limiters (6) :                                                            │
│  ├─ globalLimiter        → /api/*              (100 req/15min)                  │
│  ├─ authLimiter          → /api/auth/login,register (5 req/15min)              │
│  ├─ cashConfirmLimiter   → /api/payments/cash/confirm (3 req/min)              │
│  ├─ scanCollectLimiter   → /api/scans/collect  (5 req/min)                     │
│  ├─ orderCreateLimiter   → POST /api/orders    (10 req/min, POST uniquement)   │
│  └─ dashboardLimiter     → /api/dashboard      (30 req/min)                    │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
                   ┌───────────────┼────────────────────────┐
                   ▼               ▼                        ▼
         ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
         │  Middleware   │  │  Middleware   │  │  Middleware   │  │  Middleware   │
         │ authenticate │  │ requireRole  │  │upload(multer)│  │validate(Joi) │
         │  (JWT)       │  │(admin/hub/   │  │              │  │              │
         │              │  │ agent_relais)│  │              │  │              │
         └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                │                 │                  │                 │
                ▼                 ▼                  ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ROUTES (18 fichiers)                                  │
│                                                                                 │
│  🔐 Auth & Users           📦 Commandes & Paiements    📊 Admin & Pilotage     │
│  ├─ /api/auth              ├─ /api/orders               ├─ /api/admin           │
│  ├─ /api/loyalty           ├─ /api/payments             ├─ /api/dashboard       │
│  └─ /api/relais            ├─ /api/purchasing           ├─ /api/admin/finance   │
│                            ├─ /api/scans                └─ /api/finance         │
│  🛍️ Produits & Modules     └─ /api/logistics                                    │
│  ├─ /api/products                                       🔧 Utilitaires          │
│  ├─ /api/modules           🛒 Paniers & Invendus        ├─ /api/pricing         │
│  └─ /api/pricing           ├─ /api/baskets              └─ /health              │
│                            └─ /api/unsold                                       │
└──────────────────────────────────┬──────────────────────────────────────────────┘
                                   │
              ┌────────────────────┼──────────────────────┐
              ▼                    ▼                      ▼
┌───────────────────┐  ┌───────────────────┐  ┌────────────────────────────────┐
│   PostgreSQL DB   │  │ Services externes │  │   Fichiers / Uploads           │
│   (Railway)       │  │                   │  │                                │
│   27+ tables      │  │  Stripe           │  │  Multer → /uploads/            │
│   3 vues          │  │  Africa's Talking │  │  PDFKit → rapports/étiquettes  │
│   6 triggers      │  │  Nodemailer       │  │  QRCode → codes retrait        │
│   2 fonctions     │  │  WhatsApp         │  │                                │
└───────────────────┘  └───────────────────┘  └────────────────────────────────┘
```

### Connexion PostgreSQL (`db.js`)

- Pool `pg` avec SSL conditionnel, 10 connexions max
- `idleTimeoutMillis: 30_000`, `connectionTimeoutMillis: 5_000`
- Toutes les requêtes utilisent des **requêtes paramétrées** (`$1`, `$2`, etc.) — protection injection SQL

### Variables d'environnement

| Variable | Obligatoire | Description |
|----------|:-----------:|-------------|
| `DATABASE_URL` | ✅ | Connexion PostgreSQL (Railway) |
| `JWT_SECRET` | ✅ | Clé de signature JWT |
| `ADMIN_PASSWORD` | ⚠️ | Mot de passe admin (recommandé) |
| `STRIPE_SECRET_KEY` | ⚠️ | Clé API Stripe (recommandé) |
| `STRIPE_WEBHOOK_SECRET` | ⚠️ | Secret webhook Stripe |
| `FRONTEND_URL` | — | URL frontend pour CORS |
| `NODE_ENV` | — | Environnement (`production`/`development`) |
| `JWT_EXPIRES` | — | Expiration JWT (défaut `30d`) |
| `PORT` | — | Port serveur (défaut `3000`) |

---

## 2. 🗂️ Carte des routes

### 📁 auth.js — `/api/auth` (5 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `POST` | `/api/auth/register` | ❌ | — | Création de compte (phone obligatoire, MDP min 6 chars) |
| 2 | `POST` | `/api/auth/login` | ❌ | — | Connexion, retourne JWT + cookie httpOnly `kmrc_jwt` |
| 3 | `POST` | `/api/auth/logout` | ✅ | — | Déconnexion, supprime le cookie JWT |
| 4 | `GET` | `/api/auth/me` | ✅ | — | Profil utilisateur connecté |
| 5 | `PUT` | `/api/auth/me` | ✅ | — | Mise à jour profil |

> **Sécurité** : Cookie httpOnly (`kmrc_jwt`), `sameSite: Strict`, `secure: true` en production. Validation Joi sur register/login. Rate-limité par `authLimiter` (5 req/15min).

### 📁 orders.js — `/api/orders` (10 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `POST` | `/api/orders` | ✅ | client | Créer une commande (transaction DB, stock FOR UPDATE) |
| 2 | `GET` | `/api/orders` | ✅ | client | Liste commandes du client connecté (paginée) |
| 3 | `GET` | `/api/orders/relais` | ✅ | admin, agent_relais | Commandes du relais (available, shipped, cash pending) |
| 4 | `GET` | `/api/orders/problems` | ✅ | admin, agent_relais, agent_hub | Détection commandes problématiques (10 règles) |
| 5 | `POST` | `/api/orders/:id/qr-token` | ✅ | admin, agent_relais | Générer token QR retrait (expirant) |
| 6 | `GET` | `/api/orders/retrait/:token` | ❌ | public | Page retrait par token QR (vérification expiration) |
| 7 | `GET` | `/api/orders/:ref` | ✅ | — | Détail commande + suivi par référence |
| 8 | `PATCH` | `/api/orders/:id/status` | ✅ | admin, agent_relais, agent_hub | Changement statut (matrice transitions valides) |
| 9 | `PATCH` | `/api/orders/:id/cost` | ✅ | admin | Saisie coût réel (supplier_name, invoice_url) |
| 10 | `GET` | `/api/orders/:id/history` | ✅ | — | Historique statuts de la commande |

> **Pipeline** : 9 statuts — `confirmed → ordered → preparation → shipped → in_transit → available → collected` + `cancelled` / `refunded`.  
> **Transitions** : Matrice `VALID_TRANSITIONS` + `TRANSITION_ROLES` — seuls les rôles autorisés peuvent effectuer chaque transition.  
> **Référence** : Format `K` + 6 chars alphanumériques crypto-safe (randomBytes, rejet biais modulo).  
> **Code cash** : 6 chiffres numériques (ex: `482917`) — dictable oralement.

### 📁 products.js — `/api/products` (8 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/products` | ❌ | — | Liste paginée + filtres (category, search, prix, stock) |
| 2 | `GET` | `/api/products/categories` | ❌ | — | Liste catégories avec compteurs |
| 3 | `GET` | `/api/products/:id` | ❌ | — | Détail produit (is_active = TRUE) |
| 4 | `POST` | `/api/products` | ✅ | admin | Créer un produit (validation Joi) |
| 5 | `PUT` | `/api/products/:id` | ✅ | admin | Modifier un produit |
| 6 | `DELETE` | `/api/products/:id` | ✅ | admin | Désactiver produit (soft delete via is_active) |
| 7 | `POST` | `/api/products/:id/image` | ✅ | admin | Upload image principale (multer) |
| 8 | `POST` | `/api/products/:id/images` | ✅ | admin | Upload images multiples |

> **Filtres** : `category`, `search` (ILIKE), `min_price`, `max_price`, `in_stock`. Tri par `sort_order ASC, created_at DESC`.

### 📁 payments.js — `/api/payments` (5 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `POST` | `/api/payments/stripe/intent` | ✅ | — | Créer PaymentIntent Stripe (EUR, centimes) |
| 2 | `POST` | `/api/payments/stripe/webhook` | — | — | Webhook Stripe (signature vérifiée, raw body) |
| 3 | `POST` | `/api/payments/cash/confirm` | ✅ | agent_relais, admin | Confirmer réception espèces (cash_ref_code) |
| 4 | `GET` | `/api/payments/rates` | ✅ | — | Taux de change actuels (EUR/KMF, AED/KMF) |
| 5 | `GET` | `/api/payments/config` | ✅ | — | Configuration paiement (modes disponibles) |

> **Flux Stripe** : `stripe/intent` → client paie côté front → `stripe/webhook` confirme → `triggerPurchasing()`.  
> **Flux cash** : Commande créée → client va au relais → agent confirme via `cash/confirm` → `triggerPurchasing()`.  
> **Idempotence** : Vérification `payment_status === 'paid'` avant traitement webhook.

### 📁 admin.js — `/api/admin` (14 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/admin/orders` | ✅ | admin | Toutes les commandes + filtres avancés |
| 2 | `DELETE` | `/api/admin/orders/:id` | ✅ | admin | Supprimer une commande par ID |
| 3 | `GET` | `/api/admin/customs` | ✅ | admin | Historique douane |
| 4 | `GET` | `/api/admin/partners` | ✅ | admin | Liste partenaires / relais |
| 5 | `POST` | `/api/admin/partners` | ✅ | admin | Créer un partenaire |
| 6 | `PUT` | `/api/admin/partners/:id` | ✅ | admin | Modifier un partenaire |
| 7 | `GET` | `/api/admin/users` | ✅ | admin | Liste utilisateurs + filtres |
| 8 | `POST` | `/api/admin/users` | ✅ | admin | Créer un utilisateur (avec rôle) |
| 9 | `PUT` | `/api/admin/users/:id/role` | ✅ | admin | Changer le rôle d'un utilisateur |
| 10 | `PUT` | `/api/admin/users/:id/password` | ✅ | admin | Réinitialiser mot de passe |
| 11 | `DELETE` | `/api/admin/users/:id` | ✅ | admin | Supprimer utilisateur (soft/hard) |
| 12 | `GET` | `/api/admin/counts` | ✅ | admin | Compteurs globaux |
| 13 | `POST` | `/api/admin/reset` | ✅ | admin | ⚠️ Reset base de données (dangereux) |
| 14 | `POST` | `/api/admin/seed-test` | ✅ | admin | Seed données de test |

> **Rôles DB** : `user_role` enum = `('client', 'admin', 'agent_relais', 'agent_hub')`.  
> ⚠️ Endpoints dashboard déplacés vers `/api/dashboard/*` (v11.0) : `/dashboard`, `/margins`, `/alerts`.

### 📁 dashboard.js — `/api/dashboard` (8 endpoints) — Dashboard unifié v11

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/dashboard/ops` | ✅ | admin | Vue opérationnelle quotidienne (SLA, alertes, activité) |
| 2 | `GET` | `/api/dashboard/finance` | ✅ | admin | KPIs financiers (CA, marges, paiements, devises) |
| 3 | `GET` | `/api/dashboard/pilotage` | ✅ | admin | Vue stratégique coûts & marges par produit |
| 4 | `GET` | `/api/dashboard/pipeline` | ✅ | admin | Kanban pipeline commandes (compteurs par statut) |
| 5 | `GET` | `/api/dashboard/retards` | ✅ | admin | Clients en retard SLA + compensations |
| 6 | `GET` | `/api/dashboard/forecast` | ✅ | admin | Projections CA/marge |
| 7 | `GET` | `/api/dashboard/clients` | ✅ | admin | Analyse comportement clients |
| 8 | `GET` | `/api/dashboard/history` | ✅ | admin | Historique mensuel (données graphiques) |

> **Cache** : Mémoire TTL 30s (`_cache` Map, max 100 entrées).  
> **Taux** : EUR/KMF dynamiques via `getRates()`, jamais hardcodé.  
> **SLA** : Warning 35j, Late 42j, Blocked 56j, Inactif 7j.  
> **Compensations** : Préventif 28j, Avoir 35j, Remise 42j, Remboursement 56j.  
> **Auth** : `router.use(authenticate, requireRole(['admin']))` appliqué globalement.

### 📁 finance.js — `/api/finance` (4 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/finance/summary` | ✅ | admin | ⚠️ **DÉPLACÉ** → `301` vers `/api/dashboard/finance` |
| 2 | `GET` | `/api/finance/export` | ✅ | admin | Export CSV transactions du mois (?month, ?year) |
| 3 | `GET` | `/api/finance/stripe-proofs` | ✅ | admin | Liste PaymentIntents Stripe confirmés du mois |
| 4 | `GET` | `/api/finance/report` | ✅ | admin | Rapport PDF mensuel (PDFKit, A4, synthèse CA/marges) |

> **Alias** : `/api/admin/finance` pointe vers le même routeur `financeRouter`.  
> **CSV** : BOM UTF-8 pour Excel, taux figés via `LATERAL JOIN exchange_rates`.

### 📁 logistics.js — `/api/logistics` (7 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `POST` | `/api/logistics/shipments` | ✅ | admin | Créer expédition (carrier, container_ref, ETA) |
| 2 | `GET` | `/api/logistics/shipments` | ✅ | admin | Liste expéditions (20 dernières, nb commandes) |
| 3 | `PATCH` | `/api/logistics/shipments/:id` | ✅ | admin | MAJ expédition (arrivée → commandes `available` + SMS batch) |
| 4 | `POST` | `/api/logistics/parcels` | ✅ | admin | Créer colis |
| 5 | `POST` | `/api/logistics/parcels/:id/photo` | ✅ | admin | Photo colis agent Dubai |
| 6 | `GET` | `/api/logistics/labels/:shipment_id` | ✅ | admin | Étiquettes PDF A6 (QR codes, infos retrait) |
| 7 | `GET` | `/api/logistics/manifest/:shipment_id` | ✅ | admin | Manifeste PDF expédition (tableau commandes) |

> **Automatisation** : Quand `arrived_at + customs_cleared_at` sont renseignés, les commandes passent automatiquement en `available` et un SMS batch est envoyé.

### 📁 scans.js — `/api/scans` (6 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `POST` | `/api/scans` | ✅ | admin, agent_hub, agent_relais | Scan générique (step: preparation, shipped, in_transit, relais_received) |
| 2 | `POST` | `/api/scans/collect` | ✅ | admin, agent_relais | Scan collecte (pickup_code vérifié) → statut `collected` |
| 3 | `POST` | `/api/scans/hub/receive` | ✅ | admin, agent_hub | Réception hub |
| 4 | `GET` | `/api/scans/hub/pending` | ✅ | admin, agent_hub | Commandes en attente au hub |
| 5 | `POST` | `/api/scans/verify-qr` | ✅ | admin, agent_relais | Vérification QR token retrait |
| 6 | `GET` | `/api/scans/:order_id` | ✅ | — | Historique scans d'une commande |

> **Sécurité v8.3** : Le statut `collected` a été retiré du `POST /api/scans` générique → uniquement via `/collect` ou `/verify-qr`.

### 📁 purchasing.js — `/api/purchasing` (10 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/purchasing` | ✅ | admin | Liste bons de commande fournisseur |
| 2 | `GET` | `/api/purchasing/suppliers` | ✅ | admin | Liste fournisseurs |
| 3 | `POST` | `/api/purchasing/suppliers` | ✅ | admin | Créer fournisseur |
| 4 | `POST` | `/api/purchasing/suppliers/:id/map` | ✅ | admin | Mapper produit → fournisseur |
| 5 | `DELETE` | `/api/purchasing/suppliers/:id` | ✅ | admin | Supprimer fournisseur |
| 6 | `GET` | `/api/purchasing/order/:order_id/completeness` | ✅ | admin | Vérifier complétude achat |
| 7 | `GET` | `/api/purchasing/:order_id` | ✅ | admin | Détail bon de commande |
| 8 | `POST` | `/api/purchasing/:order_id/confirm` | ✅ | admin | Confirmer bon de commande |
| 9 | `POST` | `/api/purchasing/:id/receive` | ✅ | admin | Réception marchandise → `triggerScan3()` |
| 10 | `DELETE` | `/api/purchasing/po/:po_id` | ✅ | admin | Supprimer bon de commande |

> **Fonction exportée** : `triggerPurchasing(orderId)` — appelée par `payments.js` après confirmation de paiement.

### 📁 baskets.js — `/api/baskets` (endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| — | CRUD | `/api/baskets/*` | ✅ | — | Paniers partagés (standard, gift, shared) |

> Tables : `baskets`, `basket_items`. Validation Joi.

### 📁 modules.js — `/api/modules` (7 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/modules` | ✅ | — | Liste modules disponibles |
| 2 | `GET` | `/api/modules/:type` | ✅ | — | Détail module par type |
| 3 | `GET` | `/api/modules/fabrics` | ✅ | — | Liste tissus |
| 4 | `GET` | `/api/modules/models` | ✅ | — | Liste modèles |
| 5 | `POST` | `/api/modules/price` | ✅ | — | Calcul prix module |
| 6 | `POST` | `/api/modules/fabrics` | ✅ | admin | Créer tissu |
| 7 | `POST` | `/api/modules/models` | ✅ | admin | Créer modèle |

> Tables : `fabrics`, `garment_models`, `products`.

### 📁 loyalty.js — `/api/loyalty` (7 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/loyalty/tiers` | ✅ | admin | Liste paliers fidélité |
| 2 | `GET` | `/api/loyalty/me` | ✅ | — | Niveau fidélité du client connecté |
| 3 | `GET` | `/api/loyalty/users` | ✅ | admin | Classement fidélité utilisateurs |
| 4 | `GET` | `/api/loyalty/stats` | ✅ | admin | Statistiques fidélité |
| 5 | `PUT` | `/api/loyalty/tiers/:id` | ✅ | admin | Modifier palier |
| 6 | `POST` | `/api/loyalty/recalculate/:user_id` | ✅ | admin | Recalculer fidélité d'un utilisateur |
| 7 | `POST` | `/api/loyalty/recalculate-all` | ✅ | admin | Recalculer fidélité de tous |

> **Fonctions exportées** : `getLoyaltyDiscount(db, userId)`, `recalculateLoyalty(db, userId)`.  
> **Paliers** : Bronze (0 cmd, 0%), Silver (3 cmd, 2%), Gold (10 cmd, 5%), Platinum (25 cmd, 8%).

### 📁 unsold.js — `/api/unsold` (7 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/unsold` | ✅ | admin | Liste articles invendus |
| 2 | `POST` | `/api/unsold/scan` | ✅ | admin | Scanner article invendu |
| 3 | `GET` | `/api/unsold/:id` | ✅ | admin | Détail invendu |
| 4 | `PATCH` | `/api/unsold/:id` | ✅ | admin | Modifier invendu |
| 5 | `POST` | `/api/unsold/:id/resolve` | ✅ | admin | Résoudre invendu |
| 6 | `GET` | `/api/unsold/:id/whatsapp` | ✅ | admin | Lien WhatsApp notification |
| 7 | `GET` | `/api/unsold/stats/summary` | ✅ | admin | Statistiques invendus |

### 📁 pricing.js — `/api/pricing` (4 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `POST` | `/api/pricing/calculate` | ✅ | — | Calcul prix (marge, fret, douane) |
| 2 | `POST` | `/api/pricing/couture` | ✅ | — | Calcul prix couture |
| 3 | `GET` | `/api/pricing/rates` | ✅ | — | Taux de change actuels |
| 4 | `PUT` | `/api/pricing/rates` | ✅ | admin | Mettre à jour taux de change |

### 📁 relais.js — `/api/relais` (3 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/relais` | ❌ | — | Liste tous les relais actifs |
| 2 | `GET` | `/api/relais/public` | ❌ | — | Liste relais (vue publique) |
| 3 | `GET` | `/api/relais/:id` | ❌ | — | Détail relais |

> ⚠️ Aucune authentification requise — routes publiques intentionnelles.

### 📁 health.js — `/health` (2 endpoints)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/health` | ❌ | — | Healthcheck Railway (readiness probe) |
| 2 | `GET` | `/health/ready` | ❌ | — | Ready check |

> **Endpoint caché** : `GET /api/health` défini directement dans `server.js` — retourne version, latence DB, timestamp, env.

### 📁 pilotage.js — `/api/pilotage` ⚠️ DEPRECATED (3 redirections)

| # | Méthode | Chemin | Auth | Rôles | Description |
|---|---------|--------|:----:|-------|-------------|
| 1 | `GET` | `/api/pilotage` | ✅ | admin | ⚠️ `301` → `/api/dashboard/pilotage` |
| 2 | `GET` | `/api/pilotage/history` | ✅ | admin | ⚠️ `301` → `/api/dashboard/history` |
| 3 | `GET` | `/api/pilotage/clients` | ✅ | admin | ⚠️ `301` → `/api/dashboard/clients` |

> **Note** : Ce fichier est conservé uniquement pour rétro-compatibilité. Tous les endpoints pilotage ont été absorbés dans `dashboard.js` (v11.0). Le routeur est commenté dans `server.js`.

### Alias de routes (`server.js`)

| Alias | Cible | Description |
|-------|-------|-------------|
| `/api/admin/finance` | `financeRouter` | Alias rétro-compatibilité |
| `/api/admin/pilotage` | `dashboardRouter` | Redirection v11 |
| `/api/admin/stats` | `dashboardRouter` | Redirection v11 |

---

## 3. 🗄️ Schéma de base de données

### Tables principales (27+)

| # | Table | Source | Trigger | Description |
|---|-------|--------|---------|-------------|
| 1 | `users` | schema.sql | `trg_users_updated` | Utilisateurs (clients, admins, agents hub/relais) |
| 2 | `relais` | schema.sql | — | Points relais de collecte (5 par défaut aux Comores) |
| 3 | `products` | schema.sql | `trg_products_updated` | Catalogue produits (20 articles seed) |
| 4 | `orders` | schema.sql | `trg_orders_updated` | Commandes principales |
| 5 | `order_items` | schema.sql | — | Articles de commande |
| 6 | `order_status_history` | schema.sql | — | Historique changements de statut |
| 7 | `recipients` | schema.sql | — | Destinataires des commandes |
| 8 | `shipments` | schema.sql | `trg_shipments_updated` | Expéditions groupées |
| 9 | `scans` | schema.sql | `trg_scan_sync_status` | Scans de suivi (shipped, received, collected) |
| 10 | `exchange_rates` | schema.sql | — | Taux de change EUR/KMF, AED/KMF |
| 11 | `sms_log` | schema.sql | — | Journal des SMS envoyés |
| 12 | `disputes` | schema.sql | `trg_disputes_updated` | Litiges et réclamations |
| 13 | `baskets` | schema.sql | — | Paniers partagés |
| 14 | `basket_items` | schema.sql | — | Articles dans les paniers |
| 15 | `partners` | server.js (auto-migration) | — | Partenaires commerciaux |
| 16 | `loyalty_tiers` | server.js (auto-migration) | — | Niveaux fidélité |
| 17 | `customs_history` | Supabase/DB | — | Historique douane |
| 18 | `fabrics` | Supabase/DB | — | Tissus (modules couture) |
| 19 | `garment_models` | Supabase/DB | — | Modèles vêtement |
| 20 | `product_suppliers` | Supabase/DB | — | Mapping produit → fournisseur |
| 21 | `purchase_orders` | Supabase/DB | — | Bons de commande fournisseur |
| 22 | `suppliers` | Supabase/DB | — | Fournisseurs |
| 23 | `unsold_items` | Supabase/DB | — | Articles invendus |
| 24 | `ceremony_fabrics` | schema_extension.sql | — | Tissus cérémonie (legacy) |
| 25 | `ceremony_models` | schema_extension.sql | — | Modèles cérémonie (legacy) |
| 26 | `ceremony_order_items` | schema_extension.sql | — | Articles cérémonie (legacy) |

### Vues (3)

| # | Vue | Source | Description |
|---|-----|--------|-------------|
| 1 | `v_loyalty_summary` | Supabase | Résumé fidélité |
| 2 | `v_unsold_pipeline` | Supabase | Pipeline invendus |
| 3 | `customs_taux_mensuel` | server.js | Taux douaniers mensuels (AVG customs_delta_pct) |

### Enums PostgreSQL (6)

| Enum | Valeurs |
|------|---------|
| `user_role` | `client`, `admin`, `agent_relais`, `agent_hub` |
| `order_status` | `confirmed`, `ordered`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, `cancelled`, `refunded` |
| `payment_mode` | `stripe_eur`, `cash_relais` |
| `payment_status` | `pending`, `paid`, `partial`, `refunded` |
| `basket_type` | `standard`, `gift`, `shared` |
| `scan_step` | `preparation`, `shipped`, `in_transit`, `relais_received`, `collected` |

### Fonctions PostgreSQL (2)

| Fonction | Description |
|----------|-------------|
| `set_updated_at()` | Met à jour `updated_at` automatiquement via triggers |
| `sync_order_status_from_scan()` | Synchronise le statut de commande depuis les scans |

### Triggers (6)

| Trigger | Table | Événement | Fonction |
|---------|-------|-----------|----------|
| `trg_users_updated` | `users` | BEFORE UPDATE | `set_updated_at()` |
| `trg_products_updated` | `products` | BEFORE UPDATE | `set_updated_at()` |
| `trg_orders_updated` | `orders` | BEFORE UPDATE | `set_updated_at()` |
| `trg_shipments_updated` | `shipments` | BEFORE UPDATE | `set_updated_at()` |
| `trg_scan_sync_status` | `scans` | AFTER INSERT | `sync_order_status_from_scan()` |
| `trg_disputes_updated` | `disputes` | BEFORE UPDATE | `set_updated_at()` |

### Criticité des tables

```
Table                   │ Nb routes │ Criticité
────────────────────────┼───────────┼──────────────────
products                │    13     │ █████████████ 🔴
users                   │    11     │ ███████████░░ 🔴
orders                  │    10     │ ██████████░░░ 🔴
order_items             │     9     │ █████████░░░░ 🔴
relais                  │     9     │ █████████░░░░ 🔴
recipients              │     5     │ █████░░░░░░░░ 🔴
exchange_rates          │     5     │ █████░░░░░░░░ 🔴
order_status_history    │     4     │ ████░░░░░░░░░ 🟠
loyalty_tiers           │     3     │ ███░░░░░░░░░░ 🟠
scans                   │     2     │ ██░░░░░░░░░░░ 🟡
```

### Diagramme entité-relation simplifié

```
┌──────────┐     ┌────────────┐     ┌──────────────┐     ┌───────────┐
│  users   │────▶│   orders   │────▶│ order_items   │────▶│ products  │
│          │     │            │     │              │     │           │
│ id       │     │ id         │     │ order_id     │     │ id        │
│ email    │     │ user_id    │     │ product_id   │     │ name      │
│ role     │     │ status     │     │ qty          │     │ price_kmf │
│ loyalty_ │     │ relais_id  │     │ price_kmf    │     │           │
│  tier_id │     │ total_kmf  │     └──────────────┘     └─────┬─────┘
└────┬─────┘     └──────┬─────┘                                │
     │                  │                                      │
     │                  ├──▶ order_status_history               │
     │                  ├──▶ recipients                         │
     │                  ├──▶ scans                              │
     │                  ├──▶ relais                              │
     │                  └──▶ shipments                           │
     │                                                          │
     └──▶ loyalty_tiers       purchase_orders ──▶ order_items   │
                              suppliers ◄── product_suppliers ◄─┘
```

---

## 4. 🛡️ Middleware & sécurité

### Middleware applicatifs

| Middleware | Fichier | Dépendances | Rôle |
|------------|---------|-------------|------|
| `authenticate` | `middleware/auth.js` | `jsonwebtoken`, `db` | Vérifie JWT (cookie httpOnly `kmrc_jwt` OU header `Authorization: Bearer`) |
| `requireRole` | `middleware/auth.js` | — | Vérifie le rôle utilisateur (admin, agent_hub, agent_relais) |
| `upload` | `middleware/upload.js` | `multer`, `crypto`, `fs` | Gestion uploads fichiers (images produits, photos colis) |
| `validate` | `middleware/validate.js` | `joi` | Validation Joi centralisée + sanitisation anti-XSS / proto-pollution |

### Matrice middleware par route

| Route | authenticate | requireRole | validate | upload | rate-limit |
|-------|:-----------:|:-----------:|:--------:|:------:|:----------:|
| auth.js | ✅ (partiel) | — | ✅ | — | ✅ authLimiter |
| orders.js | ✅ | ✅ | ✅ | — | ✅ orderCreateLimiter (POST) |
| products.js | ✅ (partiel) | ✅ (admin) | ✅ | ✅ | — |
| payments.js | ✅ (partiel) | ✅ | ✅ | — | ✅ cashConfirmLimiter |
| admin.js | ✅ | ✅ (admin) | ✅ | — | — |
| dashboard.js | ✅ | ✅ (admin) | — | — | ✅ dashboardLimiter |
| finance.js | ✅ | ✅ (admin) | — | — | — |
| logistics.js | ✅ | ✅ (admin) | ✅ | — | — |
| scans.js | ✅ | ✅ | ✅ | — | ✅ scanCollectLimiter |
| purchasing.js | ✅ | ✅ (admin) | — | — | — |
| loyalty.js | ✅ | ✅ (admin) | — | — | — |
| modules.js | ✅ | ✅ | ✅ | — | — |
| baskets.js | ✅ | — | ✅ | — | — |
| unsold.js | ✅ | ✅ (admin) | — | — | — |
| pricing.js | ✅ | ✅ (admin pour PUT) | — | — | — |
| pilotage.js | ✅ | ✅ (admin) | — | — | — |
| relais.js | ❌ | — | — | — | — |
| health.js | ❌ | — | — | — | — |

### Rate Limiters détaillés (6)

| Limiter | Route | Limite | Description |
|---------|-------|--------|-------------|
| `globalLimiter` | `/api/*` | 100 req/15min | Protection globale |
| `authLimiter` | `/api/auth/login`, `/api/auth/register` | 5 req/15min | Anti brute-force |
| `cashConfirmLimiter` | `/api/payments/cash/confirm` | 3 req/min | Anti-abus confirmation cash |
| `scanCollectLimiter` | `/api/scans/collect` | 5 req/min | Anti-abus scan QR |
| `orderCreateLimiter` | `POST /api/orders` | 10 req/min | Anti-spam commandes (POST uniquement) |
| `dashboardLimiter` | `/api/dashboard` | 30 req/min | Anti-DoS requêtes lourdes |

### Headers de sécurité (Helmet)

- **CSP** : `script-src 'unsafe-inline'`, CDN autorisés (cdnjs, unpkg, jsdelivr), Google Fonts
- **Frame ancestors** : `'none'` (anti-clickjacking)
- **Object-src** : `'none'`
- **Base-uri** : `'self'`

### CORS

- Origines autorisées : `localhost:*`, `*.up.railway.app`, `FRONTEND_URL`
- Méthodes : GET, POST, PUT, PATCH, DELETE, OPTIONS
- `credentials: true` (cookies cross-origin)

---

## 5. 🔗 Dépendances inter-routes

### Appels croisés

| Route source | Route cible | Fonction | Direction |
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
                                      │ triggerScan3()
                               ┌──────┴──────┐
                               │purchasing.js│
                               └──────▲──────┘
                                      │ triggerPurchasing()
                               ┌──────┴──────┐
                               │payments.js  │
                               └─────────────┘
```

### Flux complet

```
orders.js ──payment──▶ payments.js ──trigger──▶ purchasing.js ──trigger──▶ scans.js ──recalc──▶ loyalty.js
    │                                                                                              ▲
    └──────────────── getLoyaltyDiscount() / recalculateLoyalty() ──────────────────────────────────┘
```

> ⚠️ **Couplage fort** : La chaîne `payments → purchasing → scans → loyalty` est une dépendance linéaire critique. Une panne sur un maillon bloque le flux entier.

---

## 6. 🔄 Chaîne de traitement des commandes

### Cycle de vie complet

```
confirmed ──▶ ordered ──▶ preparation ──▶ shipped ──▶ in_transit ──▶ available ──▶ collected
                                                                                      │
                         cancelled (admin à tout moment) ◄────────────────────────────┤
                         refunded (après cancelled) ◄─────────────────────────────────┘
```

### Détail des étapes

| # | Étape | Route | Endpoint | Statut | Tables modifiées | Notification |
|---|-------|-------|----------|--------|------------------|-------------|
| 1 | 🛒 Création | `orders.js` | `POST /api/orders` | `confirmed` | orders, order_items, recipients | SMS + Email |
| 2a | 💳 Stripe | `payments.js` | `stripe/webhook` | `ordered` | orders, order_status_history | SMS |
| 2b | 💵 Cash | `payments.js` | `cash/confirm` | `ordered` | orders, order_status_history, products | SMS |
| 3 | 📋 Achat | `purchasing.js` | `triggerPurchasing()` | — | purchase_orders, order_items | SMS + WhatsApp |
| 4 | 📦 Réception hub | `purchasing.js` | `:id/receive` | `preparation` | purchase_orders, orders | SMS |
| 5 | 📦 Transitaire | `scans.js` | `POST /` (step=shipped) | `shipped` | scans, order_status_history | SMS |
| 6 | 🚢 Embarquement | `scans.js` | `POST /` (step=in_transit) | `in_transit` | scans, order_status_history | SMS |
| 7 | 📍 Relais | `scans.js` | `POST /` (step=relais_received) | `available` | scans, order_status_history | SMS |
| 8 | ✅ Collecte | `scans.js` | `/collect` ou `/verify-qr` | `collected` | scans, order_status_history | SMS |
| 9 | ⭐ Fidélité | `loyalty.js` | `recalculateLoyalty()` | — | users, loyalty_tiers | — |

### SMS par statut

| Statut | Message |
|--------|---------|
| `ordered` | Commande lancée, article en cours de traitement |
| `preparation` | Colis reçu au Hub, contrôle qualité |
| `shipped` | Colis remis au transitaire à Dubai |
| `in_transit` | Colis embarqué sur le bateau 🚢 (ETA 3-5 semaines) |
| `available` | Disponible au relais, code retrait |
| `collected` | Remise effectuée, merci ! 🎉 |

---

## 7. 🌐 Services externes

| # | Service | Type | Dépendance npm | Routes | Usage |
|---|---------|------|---------------|--------|-------|
| 1 | **Stripe** | 💳 Paiement | `stripe` | payments, finance, admin | PaymentIntents, webhooks, preuves |
| 2 | **Africa's Talking** | 📱 SMS | `africastalking` | orders, payments, scans, logistics, purchasing, baskets, dashboard | Notifications transactionnelles |
| 3 | **Nodemailer** | 📧 Email | `nodemailer` | orders | Confirmation commande |
| 4 | **WhatsApp** | 💬 Messagerie | — | baskets, orders, purchasing, unsold | Notifications paniers, achats, invendus |
| 5 | **PDFKit** | 📄 PDF | `pdfkit` | finance, logistics | Rapports financiers, étiquettes, manifestes |
| 6 | **QRCode** | 📲 QR | `qrcode` | logistics, orders | Codes retrait, étiquettes |
| 7 | **bcryptjs** | 🔒 Hashing | `bcryptjs` | auth, admin | Hachage mots de passe (coût 10) |
| 8 | **jsonwebtoken** | 🔐 JWT | `jsonwebtoken` | auth, middleware | Tokens d'authentification (30d) |
| 9 | **Joi** | ✅ Validation | `joi` | validators | Schémas de validation centralisés |

---

## 8. 🛠️ Utilitaires

| Fichier | Rôle |
|---------|------|
| `utils/sms.js` | Envoi SMS via Africa's Talking + `processCashRelaisReminders()` (cron 1h) |
| `utils/email.js` | Emails transactionnels via Nodemailer (confirmation commande) |
| `utils/rates.js` | Taux de change EUR/KMF, AED/KMF (table `exchange_rates`) |
| `utils/pricing.js` | Moteur de calcul prix (marge, fret, douane estimée) |
| `utils/reference.js` | Génération de références expédition (`generateShipmentRef()`) |
| `validators/index.js` | Schémas Joi centralisés : auth, orders, products, payments, logistics, etc. |

### Cron intégré

- **Cash relais reminders** : `setInterval` toutes les heures, avec verrou anti-concurrence (`cronRunning`).

### Auto-migrations au démarrage (`server.js`)

1. `fixAdminHash()` — Corrige le hash admin bcrypt (migration one-time)
2. `fixMissingSchema()` — Colonnes customs_history, table partners, table loyalty_tiers, vue customs_taux_mensuel, seed loyalty_tiers
3. `seedProducts()` — 20 articles par défaut
4. `seedRelais()` — 5 relais Comores
5. `fixProductEncoding()` — Fix UTF-8 produits
6. `fixProductImages()` — URLs images Unsplash

---

## 9. 🔐 Audit de sécurité

### Issues critiques (#71–#76) — STATUT : 🔴 OPEN

| # | Issue | Sévérité | Description | Fichier |
|---|-------|----------|-------------|---------|
| #71 | Injection SQL potentielle | 🔴 Critique | Vérifier toutes les requêtes dynamiques avec interpolation de string | Plusieurs routes |
| #72 | JWT secret faible en dev | 🔴 Critique | Fallback `komerce_secret_dev_UNSAFE` si JWT_SECRET manquant | `auth.js:26` |
| #73 | Admin password reset non sécurisé | 🔴 Critique | Pas de vérification ancien MDP pour `/api/admin/users/:id/password` | `admin.js` |
| #74 | CORS trop permissif | 🔴 Critique | `*.up.railway.app` autorise tous les sous-domaines Railway | `server.js:66` |
| #75 | Rate limiting insuffisant | 🔴 Critique | Certaines routes admin sans rate limiting | `server.js` |
| #76 | `POST /api/admin/reset` en production | 🔴 Critique | Endpoint de reset DB accessible en production | `admin.js` |

### Issues majeures (#77–#84) — STATUT : 🔴 OPEN

| # | Issue | Sévérité | Description | Fichier |
|---|-------|----------|-------------|---------|
| #77 | `unsafe-inline` dans CSP | 🟠 Majeur | Scripts inline autorisés par CSP | `server.js:94` |
| #78 | Pas de HTTPS forcé | 🟠 Majeur | `secure: isProd` sur cookie mais pas de redirection HTTPS | `auth.js:50` |
| #79 | Stock race condition | 🟠 Majeur | `FOR UPDATE` ajouté (BUG-008) mais vérifier edge cases | `orders.js:270` |
| #80 | SMS sans rate-limit | 🟠 Majeur | Les SMS sont envoyés en fire-and-forget, pas de throttling | Plusieurs routes |
| #81 | Stripe webhook sans idempotency key | 🟠 Majeur | Check `payment_status` mais pas d'idempotency key Stripe | `payments.js:109` |
| #82 | Données sensibles dans logs | 🟠 Majeur | `console.error` peut exposer des données sensibles | Partout |
| #83 | Multer sans validation de type | 🟠 Majeur | Vérifier que les uploads sont bien filtrés par type MIME | `middleware/upload.js` |
| #84 | Pas de pagination max | 🟠 Majeur | `limit` accepte des valeurs arbitraires (LIMIT 999999) | `products.js`, `orders.js` |

### Patterns SQL sécurisés utilisés

- ✅ **Requêtes paramétrées** : `$1`, `$2`, ... partout
- ✅ **FOR UPDATE** : Verrouillage stock lors des commandes (BUG-008)
- ✅ **Transactions** : `BEGIN` / `COMMIT` / `ROLLBACK` pour création commande
- ✅ **COALESCE** : Mises à jour partielles sécurisées
- ⚠️ **Construction dynamique** : Quelques requêtes construisent le WHERE dynamiquement (paramétré, mais à surveiller)

---

## 10. 📊 Dashboard Komerce Pilotage (Instant App)

### Architecture

L'application **Komerce Pilotage** est une instant app Tasklet avec 5 vues, alimentée par les endpoints `/api/dashboard/*`.

### 5 Vues

| # | Vue | Endpoint source | Description |
|---|-----|----------------|-------------|
| 1 | **Opérations** | `/api/dashboard/ops` | Commandes du jour, en cours, bloquées, SLA tracker |
| 2 | **Finance** | `/api/dashboard/finance` | CA total, marges, répartition cash/Stripe, devises |
| 3 | **Pipeline** | `/api/dashboard/pipeline` | Kanban visuel des commandes par statut |
| 4 | **Retards** | `/api/dashboard/retards` | Clients en retard SLA, compensations automatiques |
| 5 | **Clients** | `/api/dashboard/clients` | Comportement, fidélité, top clients |

### Structure données (mock)

```json
{
  "ops": {
    "commandes_aujourd_hui": 5,
    "commandes_en_cours": 23,
    "commandes_bloquees": 2,
    "livrees_aujourd_hui": 3,
    "livrees_30j": 45,
    "sla": { "on_time": 18, "warning": 3, "late": 1, "blocked": 1 }
  },
  "finance": {
    "ca_kmf": 1250000,
    "ca_eur": 2540,
    "marge_moy_pct": 32.5,
    "ca_cash_kmf": 850000,
    "ca_stripe_eur": 1200
  }
}
```

---

## 11. 📋 PRs & Issues — État actuel

### Issues de sécurité

- **#71–#76** : 6 issues critiques — 🔴 OPEN
- **#77–#84** : 8 issues majeures — 🔴 OPEN

### Historique des versions

| Version | Changements majeurs |
|---------|-------------------|
| v7.5 | `ceremony_*` → `module_*`, modules génériques |
| v7.6 | `triggerPurchasing()` dans payments.js |
| v7.7 | Code cash 6 chiffres (au lieu de hex 16) |
| v8.0 | Pipeline simplifié 6→7 étapes, `/api/loyalty`, `/api/unsold` |
| v8.1 | Helmet, CORS fix, graceful shutdown, health check DB |
| v8.5 | Rate-limit middleware branché, health route montée |
| v8.6 | Auto-migration bcrypt admin hash, fix P0 dashboard |
| v8.7 | customs_history colonnes, loyalty_tiers table |
| v8.8 | Migration robuste (try/catch), partners table |
| v9.1 | BUG-014 cookie-parser ajouté — JWT → httpOnly cookie |
| v9.2 | Helmet CSP corrigé — inline scripts + Google Fonts |
| v10.0 | Dashboards unifiés v11 — pilotage.js absorbé |

---

## 12. 🗺️ Roadmap

### ✅ Fait

- [x] Architecture Express + PostgreSQL sur Railway
- [x] Pipeline commande complet (9 statuts, transitions validées)
- [x] Paiements Stripe + Cash relais
- [x] Système de scans (hub/relais/QR collect)
- [x] Dashboard unifié v11 (8 endpoints, cache 30s)
- [x] Fidélité 4 paliers (Bronze → Platinum)
- [x] Logistique (expéditions, étiquettes PDF, manifestes)
- [x] Finance (export CSV, preuves Stripe, rapport PDF)
- [x] Purchasing (fournisseurs, bons de commande)
- [x] Modules couture (tissus, modèles, calcul prix)
- [x] JWT httpOnly cookie (BUG-014)
- [x] Rate limiting (6 limiters)
- [x] Validation Joi centralisée
- [x] Auto-migrations au démarrage
- [x] Paniers partagés, invendus, relais

### 🔲 À faire

- [ ] Corriger les 6 issues critiques de sécurité (#71–#76)
- [ ] Corriger les 8 issues majeures (#77–#84)
- [ ] Ajouter index DB (`orders.user_id`, `order_items.order_id`, `orders.status`)
- [ ] Découpler chaîne payments→purchasing→scans via file de messages (Redis/BullMQ)
- [ ] Refactorer `orders.js` (53.8 Ko) en sous-modules
- [ ] Tests d'intégration sur la chaîne commande complète
- [ ] Pagination max (limiter `limit` à 100)
- [ ] Throttling SMS
- [ ] Monitoring et alerting (Sentry ou équivalent)
- [ ] Phase 2 modules : construction, cosmétiques

---

## 13. 🔧 Stack technique

### Dépendances production

| Package | Version | Usage |
|---------|---------|-------|
| `express` | ^4.19.2 | Framework HTTP |
| `pg` | ^8.12.0 | Client PostgreSQL |
| `bcryptjs` | ^2.4.3 | Hachage mots de passe |
| `jsonwebtoken` | ^9.0.2 | Tokens JWT |
| `stripe` | ^15.11.0 | Paiements en ligne |
| `helmet` | ^8.0.0 | Headers de sécurité |
| `cors` | ^2.8.5 | Cross-Origin Resource Sharing |
| `express-rate-limit` | ^7.3.1 | Rate limiting |
| `joi` | ^17.13.3 | Validation de données |
| `multer` | ^1.4.5-lts.1 | Upload de fichiers |
| `cookie-parser` | ^1.4.7 | Parsing cookies (JWT httpOnly) |
| `pdfkit` | ^0.14.0 | Génération PDF |
| `qrcode` | ^1.5.4 | Génération QR codes |
| `nodemailer` | ^6.9.14 | Envoi d'emails |
| `africastalking` | ^0.7.2 | Envoi SMS |
| `dotenv` | ^16.4.5 | Variables d'environnement |
| `uuid` | ^10.0.0 | Génération UUID v4 |

### Dépendances développement

| Package | Version | Usage |
|---------|---------|-------|
| `nodemon` | ^3.1.4 | Rechargement automatique |

### Override sécurité

| Package | Version | Raison |
|---------|---------|--------|
| `lodash` | ^4.17.21 | Fix vulnérabilité prototype pollution |

### Environnement

- **Node.js** : >= 18.0.0
- **PostgreSQL** : Railway managed (SSL conditionnel)
- **Déploiement** : Railway (PORT via env, trust proxy 1)

---

## 14. ⚠️ Points de vigilance

### 🔴 Tables à risque (points de défaillance unique)

- **`products`** — 13 routes dépendantes
- **`users`** — 11 routes dépendantes
- **`orders`** — 10 routes dépendantes
- **`order_items`** — 9 routes dépendantes
- **`relais`** — 9 routes dépendantes

### 🔴 Routes les plus complexes

| Route | Endpoints | Tables | Appels croisés | Services ext. | Score |
|-------|-----------|--------|---------------|---------------|-------|
| `orders.js` | 10 | 8 | 2 | 5 | **77** |
| `admin.js` | 14 | 9 | 0 | 2 | **53** |
| `purchasing.js` | 10 | 8 | 1 | 2 | **53** |
| `scans.js` | 6 | 7 | 1 | 1 | **52** |
| `dashboard.js` | 8 | 5 | 0 | 1 | **42** |

### 🟡 Routes sans authentification

- **`health.js`** (`/health`) — 2 endpoints publics
- **`relais.js`** (`/api/relais`) — 3 endpoints publics
- **`products.js`** — GET endpoints publics (liste, catégories, détail)
- **`orders.js`** — `GET /api/orders/retrait/:token` (page publique retrait QR)

### Recommandations

| # | Priorité | Recommandation |
|---|----------|---------------|
| 1 | 🔴 | Ajouter index DB sur colonnes FK les plus sollicitées |
| 2 | 🔴 | Découpler la chaîne payments→purchasing→scans (file de messages) |
| 3 | 🔴 | Corriger les issues de sécurité #71–#76 |
| 4 | 🟠 | Refactorer `orders.js` en sous-modules |
| 5 | 🟠 | Ajouter tests d'intégration |
| 6 | 🟡 | Extraire fonctions partagées en service dédié |

---

## 15. 📊 Statistiques finales

| Métrique | Valeur |
|----------|--------|
| Fichiers route | **18** |
| Endpoints totaux | **~120** |
| Tables PostgreSQL | **27+** |
| Vues | **3** |
| Fonctions DB | **2** |
| Triggers DB | **6** |
| Enums | **6** |
| Services externes | **9** |
| Middleware | **4** (authenticate, rate-limit, upload, validate) |
| Rate limiters | **6** |
| Appels inter-routes | **5** |
| Tables critiques (5+ routes) | **7** |
| Issues sécurité critiques | **6** (OPEN) |
| Issues sécurité majeures | **8** (OPEN) |
| Route la plus complexe | `orders.js` (10 endpoints, ~54 Ko) |
| Dépendances production | **17** |

---

> 📝 *Cartographie 360° générée le 6 avril 2026 — Version v12.0*  
> *Basée sur l'analyse exhaustive du code source : server.js, db.js, 18 fichiers route, middleware, utilitaires, validators.*  
> *Ce document doit être mis à jour lors de modifications significatives de l'architecture.*
