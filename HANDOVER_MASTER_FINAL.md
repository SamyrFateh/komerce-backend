# HANDOVER MASTER — KOMERCE BACKEND

> **Dernière mise à jour :** Session 17 — Avril 2026
> **Repo :** `SamyrFateh/komerce-backend` · branche `main`
> **Runtime :** Node.js 20 + Express 4 · PostgreSQL 15 · Déploiement Railway
> **Version serveur :** `v9.1`
> **Score intégrité code :** `9.4/10` (Audit Session 17)

---

## TABLE DES MATIÈRES

1. [Vision Produit](#1-vision-produit)
2. [Architecture Technique](#2-architecture-technique)
3. [Arborescence Repo](#3-arborescence-repo)
4. [Base de Données — Schéma Complet](#4-base-de-données)
5. [API — Toutes les Routes Montées](#5-api-routes)
6. [Fonctionnalités Métier — Implémentées vs Restantes](#6-fonctionnalités-métier)
7. [Sécurité & Middleware](#7-sécurité--middleware)
8. [Dashboards & Outils Admin](#8-dashboards--outils-admin)
9. [Configuration & Déploiement](#9-configuration--déploiement)
10. [Historique des Sessions](#10-historique-des-sessions)
11. [État Actuel & Prochaines Étapes](#11-état-actuel--prochaines-étapes)

---

## 1. VISION PRODUIT

**Komerce** est une plateforme e-commerce B2C connectant la diaspora comorienne (France, EAU) aux Comores (Anjouan prioritaire).

**Flux principal :**
```
Diaspora (EUR/Stripe) ──→ Hub Dubai (AED) ──→ Fret maritime ──→ Douane Comores ──→ Points Relais Anjouan ──→ Destinataire (KMF/Cash)
```

**Proposition de valeur :**
- Commander depuis la France pour un proche à Anjouan
- Paiement EUR (Stripe) ou KMF (Cash relais)
- Suivi temps réel par scan QR à chaque étape
- SMS automatiques au destinataire
- Modules spécialisés (couture sur mesure, lunettes, etc.)

**Devises :** EUR (diaspora Stripe) · AED (achat Dubai) · KMF (vente locale)
**Taux de change :** Gérés en DB (`exchange_rates`), modifiables par admin

---

## 2. ARCHITECTURE TECHNIQUE

```
┌─────────────────────────────────────────────────────────┐
│                    server.js v9.1                         │
│  Express + Helmet + CORS + Rate-Limit + Body Parser      │
├─────────────────────────────────────────────────────────┤
│  18 fichiers routes montés sur /api/*                     │
│  + /health (Railway probe)                                │
│  + /api/health (inline avec latence DB)                   │
├─────────────────────────────────────────────────────────┤
│  Middleware : auth.js (JWT+RBAC) · rate-limit.js (6 limiters) │
├─────────────────────────────────────────────────────────┤
│  Utils : pricing.js · rates.js · reference.js · sms.js    │
├─────────────────────────────────────────────────────────┤
│  DB : PostgreSQL 15 via pg Pool (db.js → db/index.js)     │
│  Schema : schema.sql v1.3 + schema_extension.sql          │
│  Tables v9 : customs_history (CREATE TABLE + 9 colonnes)  │
├─────────────────────────────────────────────────────────┤
│  Cron intégré : Cash relais reminders (1h interval)       │
│  Static : public/ (9 dashboards HTML + assets)            │
│  Deploy : Railway · PORT env · Graceful shutdown SIGTERM   │
└─────────────────────────────────────────────────────────┘
```

**Stack :**
- **Runtime :** Node.js 20 LTS
- **Framework :** Express 4.21
- **DB :** PostgreSQL 15 (Railway)
- **Auth :** JWT (jsonwebtoken) + bcrypt
- **Paiement :** Stripe SDK
- **SMS :** Afrika's Talking API
- **PDF :** PDFKit (étiquettes, manifestes, rapports)
- **QR :** qrcode (npm) + Html5Qrcode (frontend)
- **Sécurité :** helmet, cors, express-rate-limit

---

## 3. ARBORESCENCE REPO

```
komerce-backend/
├── server.js                    # Point d'entrée v9.0
├── package.json                 # Dépendances
├── db.js                        # Pool PostgreSQL (wrapper)
├── .gitignore                   # ✅ Configuré (node_modules, .env, logs)
├── .env.example                 # ✅ Template complet (18 variables dont QR_SECRET)
├── db/
│   ├── index.js                 # Export pool PG
│   ├── schema.sql               # Schéma principal v1.3 (14 tables)
│   ├── schema_extension.sql     # Extension cérémonie + litiges
│   └── seed.sql                 # Données initiales (relais, produits, taux)
├── middleware/
│   ├── auth.js                  # JWT authenticate + requireRole
│   └── rate-limit.js            # 6 limiters express-rate-limit
├── routes/
│   ├── auth.js                  # Inscription, login, profil, refresh, password
│   ├── products.js              # CRUD produits + recherche + stock
│   ├── orders.js                # CRUD commandes + assign shipment + cancel
│   ├── relais.js                # Liste/détail points relais
│   ├── admin.js                 # Dashboard admin + orders + marges + partenaires
│   ├── dashboard.js             # Ops, Sales, Retards, Forecast
│   ├── pricing.js               # Calcul prix, taux de change
│   ├── modules.js               # Modules spécialisés (couture, lunettes, etc.)
│   ├── pilotage.js              # Coûts & Marges agrégés + historique
│   ├── baskets.js               # Panier partagé + cadeau WhatsApp
│   ├── logistics.js             # Expéditions, colis, étiquettes PDF, manifeste
│   ├── payments.js              # Stripe + Cash relais + webhooks
│   ├── scans.js                 # Scan QR chaîne logistique (4 étapes)
│   ├── finance.js               # Export CSV, preuves Stripe, rapport PDF
│   ├── purchasing.js            # Workflow achat automatisé
│   ├── loyalty.js               # Programme fidélité points/récompenses
│   ├── unsold.js                # Gestion invendus
│   └── health.js                # Healthcheck Railway
├── utils/
│   ├── pricing.js               # calcPrix + calcPrixTenue (moteur pricing)
│   ├── rates.js                 # getRates helper (cache DB)
│   ├── reference.js             # Générateurs KOM-XXXX, EXP-XXXX, K-XXXX
│   └── sms.js                   # sendSMS + processCashRelaisReminders
├── public/
│   ├── Komerce_Boutique.html    # SPA frontend client (122 KB)
│   ├── Komerce_Mobile.html      # App mobile PWA Anjouan (54 KB)
│   ├── Komerce_Admin.html       # Back-office administration (112 KB, 7 APIs)
│   ├── Komerce_Pilotage.html    # Pilotage coûts & marges (179 KB, 9 APIs)
│   ├── Komerce_Simulateur.html  # Simulateur tarification v17 (141 KB)
│   ├── Komerce_Backend.html     # Méga-cockpit all-in-one (514 KB, 26 APIs)
│   ├── Komerce_Tests.html       # Test Runner E2E 12 étapes (147 KB)
│   ├── Komerce_Hub.html         # Dashboard Agent Hub Dubai (40 KB)
│   ├── Komerce_Relais.html      # Dashboard Agent Relais Anjouan (93 KB)
│   ├── komerce-api.js           # Client API JS (128 KB)
│   ├── sw.js                    # Service Worker PWA
│   └── images/                  # Assets visuels
├── ROADMAP_BOUTIQUE_LIVE.md     # Roadmap Boutique Live (5 étapes ✅)
├── test_e2e.sh                  # Script test E2E (9 étapes)
└── HANDOVER_MASTER_FINAL.md     # Ce document
```

> **Note :** Les anciens fichiers `Komerce_Web.html`, `Komerce_PWA_Mobile.html`, `Komerce_Backoffice_Admin_v2.html`, `Komerce_Pilotage_v2.html`, `Komerce_Simulateur_v7.html` ont été remplacés par leurs versions harmonisées sans suffixes.

---

## 4. BASE DE DONNÉES

### Tables principales (schema.sql v1.3)

| Table | Description | Colonnes clés |
|-------|-------------|---------------|
| `users` | Utilisateurs (clients, admins, agents) | id, email, phone, role (ENUM), country, password_hash |
| `relais` | Points relais Anjouan | id, name, agent_name, phone, address, island, is_active |
| `products` | Catalogue produits | id, sku, name, category, price_kmf, cost_kmf, price_aed, stock, source |
| `baskets` | Paniers (personal/shared/gift) | id, code (K-XXXX), type (ENUM), owner_id, expires_at, is_locked |
| `basket_items` | Articles panier | basket_id, product_id, quantity, price_kmf, note |
| `recipients` | Destinataires Comores | id, user_id, full_name, phone, relais_id |
| `shipments` | Expéditions maritimes | id, reference (EXP-XXXX), carrier, container_ref, departed_at, eta, arrived_at |
| `orders` | Commandes | id, reference (KOM-XXXX), user_id, relais_id, shipment_id, total_kmf/eur/aed, payment_mode/status, status (10 états), pickup_code |
| `order_items` | Lignes de commande | order_id, product_id, quantity, price_kmf, scan_code |
| `scans` | Scans QR logistique | order_id, order_item_id, step (4 ENUM), scanned_by, location, GPS, is_anomaly |
| `order_status_history` | Historique statuts | order_id, status, scan_id, changed_by |
| `sms_log` | Journal SMS envoyés | order_id, recipient, type, message, status, at_message_id |
| `exchange_rates` | Taux de change | eur_kmf (défaut 492), aed_kmf (défaut 138), valid_from |
| `disputes` | Litiges & remboursements | order_id, type, level (1-3), status, refund_kmf/eur |

### Table customs_history (ajoutée v8.9 → v9.0)

| Colonne | Type | Utilisée par |
|---------|------|-------------|
| `id` | UUID PK | customs |
| `order_id` | TEXT FK | customs, alerts |
| `customs_estimated_kmf` | INTEGER | customs |
| `customs_real_kmf` | INTEGER | customs, alerts |
| `customs_delta_pct` | NUMERIC(6,2) | customs, alerts |
| `is_anomaly` | BOOLEAN | customs, alerts |
| `notes` | TEXT | customs |
| `customs_agent_id` | UUID | customs |
| `created_at` | TIMESTAMPTZ | customs, alerts |

### Tables extension (schema_extension.sql)

| Table | Description |
|-------|-------------|
| `ceremony_fabrics` | Catalogue tissus cérémonie (legacy) |
| `ceremony_models` | Modèles tenues cérémonie (legacy) |
| `ceremony_order_items` | Lignes commande cérémonie |
| `fabrics` | Catalogue tissus — utilisé par modules.js |
| `garment_models` | Modèles tenues — utilisé par modules.js |

### Types ENUM PostgreSQL

```sql
user_role:      client | admin | agent_relais | agent_hub
order_status:   draft → confirmed → paid → preparation → shipped → available → collected | cancelled | refunded
payment_mode:   stripe_eur | cash_relais
payment_status: pending | paid | failed | refunded
basket_type:    personal | shared | gift
scan_step:      preparation → shipped → relais_received → collected
```

### Triggers DB automatiques

1. **`set_updated_at()`** → Met à jour `updated_at` sur users, products, orders, shipments, disputes
2. **`sync_order_status_from_scan()`** → Un INSERT dans `scans` met à jour automatiquement le `status` de la commande + insère dans `order_status_history`

---

## 5. API ROUTES — TOUTES LES ROUTES MONTÉES

### 5.1 Auth (`/api/auth` → routes/auth.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/api/auth/register` | Public | Inscription (email/phone + password) |
| POST | `/api/auth/login` | Public | Connexion → JWT token |
| GET | `/api/auth/me` | JWT | Profil utilisateur courant |
| POST | `/api/auth/refresh` | JWT | Renouvellement token |
| POST | `/api/auth/change-password` | JWT | Changement mot de passe |

### 5.2 Products (`/api/products` → routes/products.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/products` | Public | Liste produits (filtres: category, search, promo) |
| GET | `/api/products/:id` | Public | Détail produit |
| POST | `/api/products` | Admin | Créer produit |
| PUT | `/api/products/:id` | Admin | Modifier produit |
| DELETE | `/api/products/:id` | Admin | Désactiver produit |

### 5.3 Orders (`/api/orders` → routes/orders.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/api/orders` | JWT | Créer commande (items, relais, mode paiement, occasion) |
| GET | `/api/orders` | JWT | Mes commandes |
| GET | `/api/orders/:id` | JWT | Détail commande + items + scans |
| PATCH | `/api/orders/:id/shipment` | Admin | Affecter commande à une expédition |
| PATCH | `/api/orders/:id/cancel` | JWT | Annuler commande |

### 5.4 Relais (`/api/relais` → routes/relais.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/relais` | Public | Liste relais actifs (tri par île) |
| GET | `/api/relais/:id` | Public | Détail relais |

### 5.5 Admin (`/api/admin` → routes/admin.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/admin/dashboard` | Admin | KPIs globaux |
| GET | `/api/admin/orders` | Admin | Toutes commandes + filtres |
| GET | `/api/admin/margins` | Admin | Dashboard marge réelle |
| GET | `/api/admin/customs` | Admin | Historique douane |
| GET | `/api/admin/partners` | Admin | Gestion partenaires/relais |
| POST | `/api/admin/partners` | Admin | Créer partenaire |
| PUT | `/api/admin/partners/:id` | Admin | Modifier partenaire |
| GET | `/api/admin/alerts` | Admin | Alertes marge négative + anomalies douane |

> **Fix v9 :** `customs_history.order_id` — cast `::uuid` sur les 4 JOINs (était : `operator does not exist: uuid = text`)

### 5.6 Dashboard (`/api/dashboard` → routes/dashboard.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/dashboard/ops` | Admin | Pilotage opérationnel : activité, SLA, logistique, alertes |
| GET | `/api/dashboard/sales` | Admin | Ventes & marges : KPIs, top produits, LTV |
| GET | `/api/dashboard/retards` | Admin | Clients en retard : niveaux, compensation recommandée |
| GET | `/api/dashboard/forecast` | Admin | Projections CA & marge (3 scénarios) |

> **Fix v9 :** `dispatched_at` → `shipped_at` (ops) ; `SUM(o.quantity)` → `SUM(oi.quantity)` (sales) ; validation UUID dans `GET /scans/:order_id`

### 5.7 – 5.18 (inchangés)

Voir sections 5.7 à 5.18 de la version précédente — routes pricing, modules, pilotage, baskets, logistics, payments, scans, finance, purchasing, loyalty, unsold, health inchangées.

> **Fix v9 Pilotage :** `GET /api/pilotage/clients` — paramètre `$2` supprimé (était non référencé → `could not determine data type`)

---

## 6. FONCTIONNALITÉS MÉTIER — IMPLÉMENTÉES vs RESTANTES

### ✅ IMPLÉMENTÉ ET OPÉRATIONNEL (sur `main` v9.0)

| # | Fonctionnalité | Fichiers | Statut |
|---|---------------|----------|--------|
| 1–25 | (idem v8.5) | — | ✅ Complet |
| 26 | **Dashboard Hub Dubai** | public/Komerce_Hub.html | ✅ Nouveau v9 |
| 27 | **Dashboard Relais Anjouan** | public/Komerce_Relais.html | ✅ Nouveau v9 |
| 28 | **Méga-cockpit Backend** | public/Komerce_Backend.html | ✅ Nouveau v9 |
| 29 | **Test Runner E2E** | public/Komerce_Tests.html | ✅ Nouveau v9 |
| 30 | **customs_history schema** | db/schema.sql (CREATE TABLE) | ✅ Fix v9 |
| 31 | **Boutique branchée API** | public/Komerce_Boutique.html | ✅ Nouveau v9.1 |
| 32 | **Auth Boutique (login/register)** | public/Komerce_Boutique.html | ✅ Nouveau v9.1 |
| 33 | **Checkout réel POST /api/orders** | public/Komerce_Boutique.html | ✅ Nouveau v9.1 |
| 34 | **Auto-refresh 15s (4 dashboards)** | Admin, Pilotage, Hub, Relais | ✅ Nouveau v9.1 |
| 35 | **Badge 🔴 LIVE animé** | Admin, Pilotage, Hub, Relais | ✅ Nouveau v9.1 |
| 36 | **Script test E2E** | test_e2e.sh | ✅ Nouveau v9.1 |

### 🔶 DÉCLARÉ MAIS NON ENCORE OPÉRATIONNEL

| # | Module | Phase | Bloqueur |
|---|--------|-------|----------|
| 1 | **Module lunettes** | Phase 2 | Opticien partenaire Dubai à signer |
| 2 | **Module cosmétiques** | Phase 2 | Accord exclusivité fournisseur à signer |
| 3 | **Module construction** | Phase 3 | Logistique volumineuse non résolue |

### 🔴 RESTE À FAIRE

| # | Fonctionnalité | Priorité | Détail |
|---|---------------|----------|--------|
| 1 | **Tests automatisés** | 🔴 P0 | Jest/Supertest — auth, orders, payments, scans |
| 2 | **Route disputes CRUD** | 🟡 P1 | Table `disputes` prête, `routes/disputes.js` manquant |
| 3 | **Upload images produits** | 🟡 P1 | `image_url` en DB, pas d'upload S3/Cloudinary |
| 4 | **Activer modules Phase 2** | 🟡 P1 | Signer contrats opticien + cosmétiques |
| 5 | **Logging structuré** | 🟢 P2 | Passer à Winston/Pino |
| 6 | **Redis rate-limit** | 🟢 P2 | Remplacer memory store pour scale |
| 7 | **Multi-île** | 🟢 P2 | Schema prêt, logique = Anjouan uniquement |

---

## 7. SÉCURITÉ & MIDDLEWARE

### 7.1 Authentification (middleware/auth.js)

```
JWT Bearer Token
├── authenticate()     → vérifie le token, attache req.user
└── requireRole([...]) → vérifie req.user.role ∈ roles autorisés
```

**Rôles :** `client` · `admin` · `agent_relais` · `agent_hub`

### 7.2 Rate Limiting (middleware/rate-limit.js)

| Limiter | Cible | Limite |
|---------|-------|--------|
| `globalLimiter` | `/api/*` | 100 req / 15 min |
| `authLimiter` | login, register | 5 req / 15 min |
| `cashConfirmLimiter` | cash/confirm | 3 req / 1 min |
| `scanCollectLimiter` | scans/collect | 5 req / 1 min |
| `orderCreateLimiter` | orders POST | 10 req / 1 min |
| `dashboardLimiter` | dashboard/* | 30 req / 1 min |

### 7.3 Autres mesures

- **Helmet** : headers sécurité HTTP standards
- **CORS** : whitelist localhost, *.railway.app, FRONTEND_URL
- **Trust proxy** : `app.set('trust proxy', 1)` pour Railway
- **Body limit** : 1MB JSON/URL-encoded
- **Graceful shutdown** : SIGTERM → ferme les connexions proprement

---

## 8. DASHBOARDS & OUTILS ADMIN

Suite complète de 9 dashboards HTML standalone dans `public/`, tous en thème clair, DM Sans, JWT Railway.

| Fichier | Rôle | Taille | APIs |
|---------|------|--------|------|
| `Komerce_Boutique.html` | SPA frontend client (API branchée) | 137 KB | 4 (products, relais, auth, orders) |
| `Komerce_Mobile.html` | App PWA mobile Anjouan | 54 KB | — |
| `Komerce_Admin.html` | Back-office administration | 112 KB | 7 |
| `Komerce_Pilotage.html` | Pilotage coûts & marges | 179 KB | 9 |
| `Komerce_Simulateur.html` | Simulateur tarification v17 | 141 KB | — |
| `Komerce_Backend.html` | Méga-cockpit all-in-one | 514 KB | 26 |
| `Komerce_Tests.html` | Test Runner E2E (12 étapes) | 147 KB | — |
| `Komerce_Hub.html` | Agent Hub Dubai | 40 KB | — |
| `Komerce_Relais.html` | Agent Relais Anjouan | 93 KB | — |

### Komerce_Hub.html — Agent Hub Dubai
- 4 stats temps réel (reçus, en préparation, prêts, alertes >7j)
- Scanner QR réception colis (Html5Qrcode + fallback manuel)
- File d'attente avec actions (Réceptionner / Expédier)
- Expéditions récentes + Répartition par relais destination
- Auto-refresh **15s** + BroadcastChannel sync · Responsive mobile

### Komerce_Relais.html — Agent Relais Anjouan
- Sélecteur de relais (Mutsamudu, Domoni, Moroni, Fomboni)
- 5 stats (en attente, retirés, alertes >48h, cash attendu, à contacter)
- Scanner réception colis (SCAN 5)
- Retrait client double méthode (code 6 chiffres + QR scan)
- Colis en attente avec QR Code modal (WhatsApp, Copier, Télécharger, Imprimer)
- Caisse du jour (cash + stripe + en attente)
- 7 scripts pré-rédigés clients à contacter
- Auto-refresh **15s** + BroadcastChannel sync · Mobile-first

### URLs Railway

| Dashboard | URL |
|-----------|-----|
| 🛒 Boutique | `/Komerce_Boutique.html` |
| 📱 Mobile | `/Komerce_Mobile.html` |
| ⚙️ Admin | `/Komerce_Admin.html` |
| 📈 Pilotage | `/Komerce_Pilotage.html` |
| 🧮 Simulateur | `/Komerce_Simulateur.html` |
| 🏭 Backend | `/Komerce_Backend.html` |
| 🧪 Tests | `/Komerce_Tests.html` |
| 🏗️ Hub | `/Komerce_Hub.html` |
| 📦 Relais | `/Komerce_Relais.html` |

---

## 9. CONFIGURATION & DÉPLOIEMENT

### 9.1 Variables d'environnement (.env.example)

```env
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/komerce
JWT_SECRET=...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
AT_API_KEY=...              # Afrika's Talking
AT_USERNAME=...
AT_SHORTCODE=...
FRONTEND_URL=https://komerce.km
NODE_ENV=production
QR_SECRET=...               # Secret pour signature QR codes
```

### 9.2 Déploiement Railway

```bash
# Build
npm install

# Start
node server.js

# Health probe
GET /health → { status: "ok" }
```

### 9.3 Base de données

```bash
# Initialisation
psql $DATABASE_URL < db/schema.sql
psql $DATABASE_URL < db/schema_extension.sql
psql $DATABASE_URL < db/seed.sql
```

---

## 10. HISTORIQUE DES SESSIONS

| Session | Thème | Livrables clés |
|---------|-------|----------------|
| 1 | Fondations | Express, auth, products, orders, relais |
| 2 | Paiements | Stripe + cash relais + QR codes |
| 3 | Logistique | Scan 4 étapes, SMS, shipments |
| 4 | Pricing v1 | Moteur tri-devise, taux de change |
| 5 | Panier | Share + gift WhatsApp (M10) |
| 6 | Cérémonie → Modules | M11 couture, tissus, modèles |
| 7 | Admin | Dashboard KPIs, back-office, marges |
| 8 | Sécurité | Helmet, CORS, rate-limit, graceful shutdown |
| 9 | Logistique avancée | PDF étiquettes A6, manifeste, colisage |
| 10 | Dashboard ops | Pilotage opérationnel, SLA, alertes |
| 11 | Finance | Export CSV, Stripe proofs, rapport PDF |
| 12 | Modules v2 | Registre générique, lunettes/construction/cosmétiques déclarés |
| 13 | Litiges | Schema disputes, purchasing workflow |
| 14 | Fidélité + Invendus | loyalty.js, unsold.js, dashboard forecast |
| 15 | Audit intégrité + Alignement | Audit code 9.3/10, .gitignore/.env.example/rate-limit/health corrigés |
| 16 | **Dashboards v9.0** | **Fixes P0 dashboard + customs_history · Hub Dubai · Relais Anjouan · Méga-cockpit Backend · Test Runner E2E · Harmonisation noms (9 dashboards)** |
| 17 | **Boutique Live + Auto-refresh v9.1** | **Boutique branchée API (produits, relais, auth, checkout réel) · Auto-refresh 15s sur 4 dashboards · Badge 🔴 LIVE animé · Script test E2E** |

---

## 11. ÉTAT ACTUEL & PROCHAINES ÉTAPES

### État au 4 avril 2026 — v9.1

- ✅ **36 fonctionnalités** implémentées sur `main`
- ✅ **9 dashboards** HTML opérationnels dans `public/`
- ✅ **18 fichiers routes** montés dans server.js v9.0
- ✅ **15+ tables** PostgreSQL avec triggers automatiques (dont `customs_history`)
- ✅ **Score intégrité : 9.3/10** — audit Session 15
- ✅ **Fixes P0 intégrés :** dashboard 500s · scans UUID validation · SQL customs/pilotage · customs_history schema
- ✅ **Suite de dashboards complète :** Hub Dubai · Relais Anjouan · Backend cockpit · Test Runner
- ✅ **Boutique Live :** produits API · relais dynamiques · auth JWT · checkout réel
- ✅ **Auto-refresh 15s :** Admin, Pilotage, Hub, Relais — badge 🔴 LIVE animé
- ✅ **Test E2E :** script test_e2e.sh (9 étapes, flow complet Boutique → Dashboard)

### Prochaines étapes recommandées

| Priorité | Action | Détail |
|----------|--------|--------|
| 🔴 P0 | Tests automatisés | Jest/Supertest — couvrir auth, orders, payments, scans |
| 🟡 P1 | Route disputes | Créer routes/disputes.js (table DB prête) |
| 🟡 P1 | Upload images | S3/Cloudinary pour products.image_url |
| 🟡 P1 | Activer modules Phase 2 | Signer contrats opticien + cosmétiques |
| 🟢 P2 | Logging structuré | Winston/Pino + Railway logs |
| 🟢 P2 | Redis rate-limit | Remplacer memory store pour scale |
| 🟢 P2 | Multi-île | Étendre logique au-delà d'Anjouan |

---

> **Ce document est la source de vérité pour tout nouveau développeur ou IA reprenant le projet.**
> Il reflète exactement l'état du code sur `main` au 4 avril 2026 — version v9.1.
