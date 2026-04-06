# 🗺️ CARTOGRAPHY_360.md — Cartographie Complète Komerce

> **Version** : 15.0 — 06/04/2026 (fusion v12+v14)
> **Statut** : Source de vérité architecture — MIROIR EXACT du repo
> **Repo** : `SamyrFateh/komerce-backend`
> **Dernière vérification** : 06/04/2026 — scan exhaustif fichier par fichier, SHA par SHA
> 📊 **18 fichiers route** · **~120 endpoints** · **27+ tables** · **3 vues** · **9 services externes**

---

## 📑 Table des matières

1. [Métriques Globales](#1--métriques-globales)
2. [Arbre Complet du Projet](#2--arbre-complet-du-projet)
3. [Vue d'ensemble architecture](#3--vue-densemble-architecture)
4. [Carte des routes (endpoints)](#4--carte-des-routes)
5. [Schéma de base de données](#5--schéma-de-base-de-données)
6. [Middleware & sécurité](#6--middleware--sécurité)
7. [Dépendances inter-routes](#7--dépendances-inter-routes)
8. [Chaîne de traitement des commandes](#8--chaîne-de-traitement-des-commandes)
9. [Services externes](#9--services-externes)
10. [Utilitaires](#10--utilitaires)
11. [Validators](#11--validators)
12. [Frontend — Architecture Monolithique (`public/`)](#12--frontend--architecture-monolithique-public)
13. [Dashboard App — Tasklet Instant App](#13--dashboard-app--tasklet-instant-app)
14. [Scripts](#14--scripts)
15. [Documentation (`docs/`)](#15--documentation-docs)
16. [CI/CD — GitHub Actions](#16--cicd--github-actions)
17. [Fichiers Racine](#17--fichiers-racine)
18. [Audit de sécurité](#18--audit-de-sécurité)
19. [Stack technique](#19--stack-technique)
20. [Points de vigilance](#20--points-de-vigilance)
21. [Statistiques finales](#21--statistiques-finales)
22. [Règle de Mise à Jour (DELTA)](#22--règle-de-mise-à-jour-delta)

---

## 1. 📊 Métriques Globales

| Métrique | Valeur |
|----------|--------|
| **Fichiers totaux** | ~93 |
| **Dossiers** | 14 |
| **Routes API** | 18 fichiers |
| **Middlewares** | 4 |
| **Utilitaires** | 5 |
| **Validators** | 1 |
| **Fichiers DB** | 4 + 3 migrations |
| **Frontend (public/)** | 15 HTML + 3 JS + 2 images |
| **Dashboard App** | 12 fichiers (React/TSX) |
| **Scripts** | 4 |
| **Docs** | 11 + 11 audit |
| **CI/CD Workflows** | 2 |
| **Taille totale estimée** | ~3.5 MB (hors package-lock.json) |

---

## 2. 🌳 Arbre Complet du Projet

```
komerce-backend/
├── .cursorrules                          (1.4 KB)  [3dd2643a]
├── .env.example                          (1.9 KB)  [6568d664]
├── .gitignore                            (258 B)   [61e13d23]
├── AGENT_RULES.md                        (2.9 KB)  [c610dfeb]
├── CONTRIBUTING.md                       (3.2 KB)  [a18b8868]
├── README.md                             (3.9 KB)  [1c05bc68]
├── db.js                                 (770 B)   [08d9e6c6]
├── package.json                          (923 B)   [f7944e67]
├── package-lock.json                     (113.9 KB)[3bb09e87]
├── server.js                             (33.9 KB) [5b9d8eac]
│
├── routes/                               (18 fichiers)
│   ├── admin.js                          (24.3 KB) [6bb443fe]
│   ├── auth.js                           (18.5 KB) [cef6b0d4]
│   ├── baskets.js                        (11.7 KB) [6f41e7a1]
│   ├── dashboard.js                      (37.7 KB) [c89e311d]
│   ├── finance.js                        (13.7 KB) [a919836e]
│   ├── health.js                         (1.4 KB)  [e29fabcb]
│   ├── logistics.js                      (9.7 KB)  [f78d7537]
│   ├── loyalty.js                        (5.8 KB)  [c4540300]
│   ├── modules.js                        (20.6 KB) [3ea6fa01]
│   ├── orders.js                         (55.4 KB) [bd3501e2]
│   ├── payments.js                       (12.0 KB) [1ba52974]
│   ├── pilotage.js                       (1.2 KB)  [9af27985]
│   ├── pricing.js                        (3.5 KB)  [a3b26f39]
│   ├── products.js                       (12.0 KB) [11f09636]
│   ├── purchasing.js                     (32.6 KB) [a17bb100]
│   ├── relais.js                         (1.7 KB)  [d6e93c3c]
│   ├── scans.js                          (23.0 KB) [c667d95e]
│   └── unsold.js                         (6.7 KB)  [215dd595]
│
├── middleware/                            (4 fichiers)
│   ├── auth.js                           (4.5 KB)  [b84255eb]
│   ├── rate-limit.js                     (3.2 KB)  [061f0e94]
│   ├── upload.js                         (1.5 KB)  [5ea7f1af]
│   └── validate.js                       (5.6 KB)  [4c671ec0]
│
├── utils/                                (5 fichiers)
│   ├── email.js                          (6.7 KB)  [daf607c3]
│   ├── pricing.js                        (3.7 KB)  [6f505ed0]
│   ├── rates.js                          (719 B)   [933ed3c4]
│   ├── reference.js                      (2.5 KB)  [253751b9]
│   └── sms.js                            (7.4 KB)  [af6ae916]
│
├── validators/                           (1 fichier)
│   └── index.js                          (13.6 KB) [dcc266a7]
│
├── db/                                   (4 + 3 migrations)
│   ├── schema.sql                        (19.2 KB) [31333f3c]
│   ├── schema_extension.sql              (3.8 KB)  [45f80c47]
│   ├── seed.sql                          (7.8 KB)  [2bfe8cf2]
│   └── migrations/
│       ├── 004_fix_order_status_enum.sql  (3.9 KB)  [c4cdffa2]
│       ├── 005_add_in_transit_status.sql  (2.8 KB)  [47121f39]
│       └── 006_dashboard_columns.sql      (2.8 KB)  [5701835e]
│
├── public/                               (15 HTML + 3 JS + 2 images)
│   ├── index.html                        (143.9 KB)[c925b4b8]
│   ├── Komerce_Admin.html                (121.4 KB)[d8e57998]
│   ├── Komerce_Admin_Users.html          (32.2 KB) [90591618]
│   ├── Komerce_Backend.html              (512.6 KB)[f02590ab]
│   ├── Komerce_Backoffice_Admin_v2.html  (68.2 KB) [3eafa998]
│   ├── Komerce_Hub.html                  (42.8 KB) [763e9794]
│   ├── Komerce_Mobile.html               (53.9 KB) [d0348e70]
│   ├── Komerce_Pilotage_v2.html          (109.6 KB)[667718df]
│   ├── Komerce_Pipeline.html             (32.7 KB) [64b87f00]
│   ├── Komerce_QR_Print.html             (9.4 KB)  [e9a09169]
│   ├── Komerce_Relais.html               (99.6 KB) [756a114e]
│   ├── Komerce_Simulateur.html           (106.1 KB)[1f74411d]
│   ├── Komerce_Tests.html                (147.0 KB)[f053cfc0]
│   ├── Komerce_Web.html                  (81.1 KB) [caa83c27]
│   ├── portal.html                       (15.8 KB) [8a511d9e]
│   ├── chart.umd.min.js                  (200.8 KB)[ebfe8019]
│   ├── komerce-api.js                    (127.8 KB)[400380df]
│   ├── sw.js                             (6.5 KB)  [f4238e4d]
│   └── images/
│       ├── avatar_panier.png             (13.3 KB) [8ed44a7c]
│       └── hero_banner.jpg               (139.1 KB)[b486987e]
│
├── dashboard-app/                        (12 fichiers — React/TSX)
│   ├── app.tsx                           (2.1 KB)  [593bfadc]
│   ├── index.html                        (2.7 KB)  [40a99817]
│   ├── styles.css                        (126 B)   [826e8a56]
│   ├── tasklet.config.json               (184 B)   [eed57f48]
│   ├── types.ts                          (3.1 KB)  [65389896]
│   ├── components/
│   │   ├── AlertsView.tsx                (3.4 KB)  [69708424]
│   │   ├── FinanceView.tsx               (7.7 KB)  [3bf26622]
│   │   ├── OpsView.tsx                   (4.6 KB)  [fa693aaf]
│   │   ├── PilotageView.tsx              (6.8 KB)  [fd7f1d0c]
│   │   └── StatCard.tsx                  (1.1 KB)  [693fa866]
│   ├── data/
│   │   └── mockData.ts                   (5.0 KB)  [4fda0a37]
│   └── utils/
│       └── formatters.ts                 (1.8 KB)  [530ffb88]
│
├── scripts/                              (4 fichiers)
│   ├── impact-check.js                   (25.5 KB) [d0fef162]
│   ├── impact-config.json                (8.4 KB)  [e81e48fd]
│   ├── setup-hooks.sh                    (4.5 KB)  [1d4ba37f]
│   └── test_e2e_full.sh                  (11.7 KB) [f2e5fdf8]
│
├── docs/                                 (11 fichiers + audit/)
│   ├── AGENTS_PROTOCOL.md                (13.9 KB) [676f2c17]
│   ├── AUDIT_REPORT.md                   (8.0 KB)  [6b4fc1c7]
│   ├── CARTOGRAPHY_360.md                (CE FICHIER)
│   ├── DASHBOARD_REDESIGN.md             (8.5 KB)  [0f46d186]
│   ├── DEPLOYMENT.md                     (19.7 KB) [9ac4d5c1]
│   ├── IMPACT_SYSTEM.md                  (14.2 KB) [005e6ce8]
│   ├── README.md                         (8.6 KB)  [914fef23]
│   ├── REPRISE_SESSION.md                (2.8 KB)  [e6aa4f6d]
│   ├── ROADMAP_KOMERCE.md                (18.8 KB) [31a0284e]
│   ├── VALIDATION_GUIDE.md               (3.4 KB)  [e657ab19]
│   ├── analyse-dashboard-pilotage.md     (5.8 KB)  [ae4e10c6]
│   └── audit/                            (11 fichiers)
│       ├── AUDIT_BUGS.md                 (7.9 KB)  [92fa541a]
│       ├── AUDIT_CODE_INTEGRITY.md       (10.9 KB) [2ce96aec]
│       ├── FRONTEND_AUDIT.md             (21.3 KB) [2dbbfde5]
│       ├── SECURITY_CHECKLIST.md         (2.5 KB)  [f9480b40]
│       ├── batch_2.md                    (17.3 KB) [3c94ffd2]
│       ├── batch_3.md                    (15.0 KB) [b82bc77b]
│       ├── batch_5.md                    (16.6 KB) [6b0b6d31]
│       ├── batch_6.md                    (14.4 KB) [19a32efb]
│       ├── db_audit.md                   (15.1 KB) [7ee3d48a]
│       ├── middleware_audit.md           (12.5 KB) [f3533515]
│       └── utils_audit.md               (15.9 KB) [cc2b9d7a]
│
└── .github/workflows/                    (2 fichiers)
    ├── auto-cartography.yml              (4.9 KB)  [1daacd02]
    └── carto-guard.yml                   (3.3 KB)  [d1e3c317]
```

---

## 3. 🏗️ Vue d'ensemble architecture

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

## 4. 🗂️ Carte des routes (endpoints)

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

## 5. 🗄️ Schéma de base de données

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

## 6. 🛡️ Middleware & sécurité

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

## 7. 🔗 Dépendances inter-routes

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

## 8. 🔄 Chaîne de traitement des commandes

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

## 9. 🌐 Services externes

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

## 10. 🛠️ Utilitaires

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

## 11. ✅ Validators (1 fichier)

### `validators/index.js` (13.6 KB) [dcc266a7]
**Schémas Joi centralisés**
- Validation utilisateur (register, login)
- Validation produit
- Validation commande
- Validation paiement
- Export de tous les schémas

---

## 12. 🖥️ Frontend — Architecture Monolithique (`public/`)

### ⚠️ ARCHITECTURE CRITIQUE À CONNAÎTRE

> **CHAQUE fichier HTML est un monolithe autonome (50-512 KB) avec CSS + JS inline.**
> Pas de framework. Pas de build. Pas de bundler. Pas de composants partagés (sauf `komerce-api.js`).

### Fichier partagé : `komerce-api.js` (127.8 KB) [400380df]
Client API JavaScript vanille — 128 KB monolithique :
- Toutes les fonctions d'appel API (fetch wrappers)
- Gestion du token JWT (localStorage)
- Importé par tous les HTML via `<script src="/komerce-api.js">`

### Fichier partagé : `chart.umd.min.js` (200.8 KB) [ebfe8019]
Chart.js UMD bundle — copie locale (pas CDN)
- Utilisé par les dashboards et pages statistiques

### Service Worker : `sw.js` (6.5 KB) [f4238e4d]
PWA Service Worker :
- Cache des assets statiques
- Stratégie cache-first pour les images
- Network-first pour les API calls

### CDN et dépendances externes :

| Librairie | Version | Source | Utilisé par |
|-----------|---------|--------|-------------|
| DOMPurify | v3.1.0 | `cdnjs.cloudflare.com` | Tous les HTML (sanitization XSS) |
| Google Fonts (Poppins) | - | `fonts.googleapis.com` | Tous les HTML (typographie) |
| QR Code Generator | - | `cdn.jsdelivr.net` + `unpkg.com` | QR_Print, Scans |
| Chart.js | bundlé | Local (`chart.umd.min.js`) | Dashboards, Stats |

### Pages Frontend :

| Fichier | Taille | SHA | Rôle | Accès |
|---------|--------|-----|------|-------|
| `index.html` | 143.9 KB | c925b4b8 | 🏪 **Boutique principale** (route `/`) | Public |
| `Komerce_Admin.html` | 121.4 KB | d8e57998 | 👑 Panel admin principal | Admin |
| `Komerce_Admin_Users.html` | 32.2 KB | 90591618 | 👥 Gestion utilisateurs | Admin |
| `Komerce_Backend.html` | 512.6 KB | f02590ab | ⚙️ **Backend admin complet** (512 KB !) | Admin |
| `Komerce_Backoffice_Admin_v2.html` | 68.2 KB | 3eafa998 | 🏢 Backoffice admin v2 | Admin |
| `Komerce_Hub.html` | 42.8 KB | 763e9794 | 🔗 Hub central / portail | Multi-rôle |
| `Komerce_Mobile.html` | 53.9 KB | d0348e70 | 📱 Version mobile PWA | Public |
| `Komerce_Pilotage_v2.html` | 109.6 KB | 667718df | 📊 Dashboard pilotage v2 | Admin |
| `Komerce_Pipeline.html` | 32.7 KB | 64b87f00 | 🔄 Pipeline commandes | Vendeur |
| `Komerce_QR_Print.html` | 9.4 KB | e9a09169 | 🏷️ Impression QR codes | Vendeur/Relais |
| `Komerce_Relais.html` | 99.6 KB | 756a114e | 📦 Interface points relais | Relais |
| `Komerce_Simulateur.html` | 106.1 KB | 1f74411d | 🧮 Simulateur tarifs/livraison | Public |
| `Komerce_Tests.html` | 147.0 KB | f053cfc0 | 🧪 Page de tests | Dev |
| `Komerce_Web.html` | 81.1 KB | caa83c27 | 🌐 Version web classique | Public |
| `portal.html` | 15.8 KB | 8a511d9e | 🚪 Portail d'entrée | Public |

### Images :

| Fichier | Taille | SHA |
|---------|--------|-----|
| `images/avatar_panier.png` | 13.3 KB | 8ed44a7c |
| `images/hero_banner.jpg` | 139.1 KB | b486987e |

---

## 13. 📊 Dashboard App — Tasklet Instant App (`dashboard-app/`)

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

### Fichiers (`dashboard-app/`)

| Fichier | Taille | SHA | Rôle |
|---------|--------|-----|------|
| `app.tsx` | 2.1 KB | 593bfadc | Composant principal — routing entre vues |
| `index.html` | 2.7 KB | 40a99817 | Point d'entrée HTML |
| `styles.css` | 126 B | 826e8a56 | Styles additionnels |
| `tasklet.config.json` | 184 B | eed57f48 | Config Tasklet (displayName, description) |
| `types.ts` | 3.1 KB | 65389896 | Types TypeScript partagés |

### Composants (`components/`) :

| Fichier | Taille | SHA | Rôle |
|---------|--------|-----|------|
| `AlertsView.tsx` | 3.4 KB | 69708424 | Vue alertes — affiche les alertes critiques |
| `FinanceView.tsx` | 7.7 KB | 3bf26622 | Vue finance — soldes, retraits, transactions |
| `OpsView.tsx` | 4.6 KB | fa693aaf | Vue opérations — commandes, livraisons |
| `PilotageView.tsx` | 6.8 KB | fd7f1d0c | Vue pilotage — KPIs, graphiques |
| `StatCard.tsx` | 1.1 KB | 693fa866 | Composant carte statistique réutilisable |

### Données (`data/`) :

| Fichier | Taille | SHA | Rôle |
|---------|--------|-----|------|
| `mockData.ts` | 5.0 KB | 4fda0a37 | Données mock pour développement |

### Utilitaires (`utils/`) :

| Fichier | Taille | SHA | Rôle |
|---------|--------|-----|------|
| `formatters.ts` | 1.8 KB | 530ffb88 | Formatage nombres, dates, devises (KMF) |


## 14. ⚙️ Scripts (4 fichiers)

### `scripts/impact-check.js` (25.5 KB) [d0fef162]
**Analyse d'impact des modifications**
- Scanne les fichiers modifiés
- Calcule un score de risque
- Identifie les dépendances impactées
- Utilisé par le workflow CI/CD `auto-cartography.yml`

### `scripts/impact-config.json` (8.4 KB) [e81e48fd]
**Configuration de l'analyse d'impact**
- Mapping routes → tables → middlewares
- Services externes référencés
- Seuils d'alerte

### `scripts/setup-hooks.sh` (4.5 KB) [1d4ba37f]
**Installation des git hooks**
- Pre-commit : lint, validation
- Pre-push : vérification carto

### `scripts/test_e2e_full.sh` (11.7 KB) [f2e5fdf8]
**Tests end-to-end complets**
- Scénario complet : inscription → commande → paiement → livraison
- Vérifie chaque endpoint
- Rapport de résultat

---

## 15. 📚 Documentation (`docs/`)

| Fichier | Taille | SHA | Rôle |
|---------|--------|-----|------|
| `AGENTS_PROTOCOL.md` | ~15 KB | (v1.4) | 🔒 Protocole de gouvernance |
| `AUDIT_REPORT.md` | 8.0 KB | 6b4fc1c7 | 📋 Rapport d'audit principal |
| `CARTOGRAPHY_360.md` | - | (v14.0) | 🗺️ CE fichier |
| `DASHBOARD_REDESIGN.md` | 8.5 KB | 0f46d186 | 📐 Specs redesign dashboard |
| `DEPLOYMENT.md` | 19.7 KB | 9ac4d5c1 | 🚀 Guide de déploiement |
| `IMPACT_SYSTEM.md` | 14.2 KB | 005e6ce8 | 💥 Documentation système d'impact |
| `README.md` | 8.6 KB | 914fef23 | 📖 Documentation technique |
| `REPRISE_SESSION.md` | 2.8 KB | e6aa4f6d | 🔄 Guide reprise de session |
| `ROADMAP_KOMERCE.md` | 18.8 KB | 31a0284e | 📋 Roadmap v14 — source de vérité |
| `VALIDATION_GUIDE.md` | 3.4 KB | e657ab19 | ✅ Guide de validation |
| `analyse-dashboard-pilotage.md` | 5.8 KB | ae4e10c6 | 📊 Analyse dashboard pilotage |

### Audit (`docs/audit/`) — 11 fichiers

| Fichier | Taille | SHA | Contenu |
|---------|--------|-----|---------|
| `AUDIT_BUGS.md` | 7.9 KB | 92fa541a | Bugs identifiés par audit |
| `AUDIT_CODE_INTEGRITY.md` | 10.9 KB | 2ce96aec | Intégrité code — imports/exports |
| `FRONTEND_AUDIT.md` | 21.3 KB | 2dbbfde5 | Audit complet du frontend |
| `SECURITY_CHECKLIST.md` | 2.5 KB | f9480b40 | Checklist sécurité pré-Go-Live |
| `batch_2.md` | 17.3 KB | 3c94ffd2 | Audit lot 2 |
| `batch_3.md` | 15.0 KB | b82bc77b | Audit lot 3 |
| `batch_5.md` | 16.6 KB | 6b0b6d31 | Audit lot 5 |
| `batch_6.md` | 14.4 KB | 19a32efb | Audit lot 6 |
| `db_audit.md` | 15.1 KB | 7ee3d48a | Audit base de données |
| `middleware_audit.md` | 12.5 KB | f3533515 | Audit middlewares |
| `utils_audit.md` | 15.9 KB | cc2b9d7a | Audit utilitaires |

---

## 16. 🤖 CI/CD — GitHub Actions (`.github/workflows/`)

### `auto-cartography.yml` (~5 KB) [v2.0]
**Métriques automatiques de la cartographie**
- Trigger : push sur `main` (paths étendus à public/, scripts/, dashboard-app/, validators/, .github/)
- Action : exécute `impact-check.js` et met à jour la section métriques en fin de carto
- ⚠️ Ne régénère PAS le contenu complet — les agents doivent faire la mise à jour DELTA manuellement

### `carto-guard.yml` (~3.5 KB) [v2.0]
**Vérification coffre-fort dans les PR**
- Trigger : pull_request (opened, synchronize)
- Paths surveillés : routes/, middleware/, utils/, validators/, db/, scripts/, public/, dashboard-app/, server.js, db.js, package.json, .github/workflows/
- Commente la PR si la carto n'est pas à jour — avec instructions DELTA

---

## 17. 📁 Fichiers Racine

| Fichier | Taille | SHA | Rôle |
|---------|--------|-----|------|
| `.cursorrules` | 1.4 KB | 3dd2643a | Règles pour l'éditeur Cursor |
| `.env.example` | 1.9 KB | 6568d664 | Template variables d'environnement |
| `.gitignore` | 258 B | 61e13d23 | Fichiers exclus de Git |
| `AGENT_RULES.md` | ~3 KB | (v mise à jour) | Règles obligatoires agents IA |
| `CONTRIBUTING.md` | 3.2 KB | a18b8868 | Guide de contribution |
| `README.md` | 3.9 KB | 1c05bc68 | README principal |

---

## 18. 🔐 Audit de sécurité

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

## 19. 🔧 Stack technique

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

## 20. ⚠️ Points de vigilance

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

## 21. 📊 Statistiques finales

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

## 22. 📝 Règle de Mise à Jour (DELTA)

> **Chaque commit modifiant du code DOIT mettre à jour cette cartographie — UNIQUEMENT les lignes impactées.**
>
> | Action | Mise à jour |
> |--------|------------|
> | Ajout/suppression de fichier | Arbre + section concernée |
> | Modification de fichier | SHA dans l'arbre |
> | Ajout/modification d'endpoint | Section routes |
> | Modification table/vue | Section BDD |
>
> **❌ INTERDIT de régénérer toute la carto à chaque commit**
> **✅ OBLIGATOIRE de ne modifier que les lignes impactées**


---

> 📝 *Cartographie 360° — Version v15.0 — 6 avril 2026*
> *Fusion v12 (profondeur d'analyse) + v14 (couverture structurelle)*
> *Source de vérité architecture : consulter avant toute modification de code.*
> *Roadmap & Issues → voir `docs/ROADMAP_KOMERCE.md`*
> *Mise à jour : approche DELTA (ne modifier que les lignes impactées)*

---

## 🤖 Dernière analyse automatique

> Mise à jour : 2026-04-06 16:00:29 UTC

| Métrique | Valeur |
|----------|--------|
| Routes | 18 fichiers |
| Middlewares | 4 fichiers |
| Utilitaires | 5 fichiers |
| Frontend (public/) | 20 fichiers |
| Dashboard App | 17 fichiers |
| Score de risque | 100/100 |

*Métriques auto-générées — workflow auto-cartography v2.0*
*⚠️ Complète la carto mais ne remplace pas la mise à jour DELTA manuelle.*
