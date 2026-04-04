# HANDOVER MASTER — KOMERCE BACKEND

> **Dernière mise à jour :** Session 15 — Avril 2026
> **Repo :** `SamyrFateh/komerce-backend` · branche `main`
> **Runtime :** Node.js 20 + Express 4 · PostgreSQL 15 · Déploiement Railway
> **Version serveur :** `v8.5`
> **Score intégrité code :** `9.3/10` (Audit Session 15)

---

## TABLE DES MATIÈRES

1. [Vision Produit](#1-vision-produit)
2. [Architecture Technique](#2-architecture-technique)
3. [Arborescence Repo](#3-arborescence-repo)
4. [Base de Données — Schéma Complet](#4-base-de-données)
5. [API — Toutes les Routes Montées](#5-api-routes)
6. [Fonctionnalités Métier — Implémentées vs Restantes](#6-fonctionnalités-métier)
7. [Sécurité & Middleware](#7-sécurité--middleware)
8. [Outils Admin Locaux](#8-outils-admin-locaux)
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
│                    server.js v8.5                         │
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
├─────────────────────────────────────────────────────────┤
│  Cron intégré : Cash relais reminders (1h interval)       │
│  Static : public/ (SPA Komerce_Web.html)                  │
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
- **QR :** qrcode (npm)
- **Sécurité :** helmet, cors, express-rate-limit

---

## 3. ARBORESCENCE REPO

```
komerce-backend/
├── server.js                    # Point d'entrée v8.5
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
│   ├── Komerce_Web.html         # SPA frontend
│   ├── Komerce_Web.html.old     # ⚠️ Ancienne version (à nettoyer)
│   ├── komerce-api.js           # Client API JS
│   ├── komerce-api.js.old       # ⚠️ Ancienne version (à nettoyer)
│   └── *.sql                    # 2 fichiers migration (à déplacer vers db/)
├── backend/                     # ⚠️ OBSOLÈTE — à supprimer (contient node_modules trackés)
└── HANDOVER_MASTER_FINAL.md     # Ce document
```

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

### Tables extension (schema_extension.sql)

| Table | Description |
|-------|-------------|
| `ceremony_fabrics` | Catalogue tissus cérémonie (legacy, voir `fabrics` dans schema.sql) |
| `ceremony_models` | Modèles tenues cérémonie (legacy, voir `garment_models`) |
| `ceremony_order_items` | Lignes commande cérémonie |
| `fabrics` | Catalogue tissus (schema.sql v1.3) — utilisé par modules.js |
| `garment_models` | Modèles tenues (schema.sql v1.3) — utilisé par modules.js |

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

**Système d'occasions :** `order_occasion` (mariage, bapteme, rentrée, fête, ramadan, autre) — marketing segmenté.

### 5.4 Relais (`/api/relais` → routes/relais.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/relais` | Public | Liste relais actifs (tri par île) |
| GET | `/api/relais/:id` | Public | Détail relais |

### 5.5 Admin (`/api/admin` → routes/admin.js — v7.1)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/admin/dashboard` | Admin | KPIs globaux (commandes, CA, panier moyen, top produits, marge) |
| GET | `/api/admin/orders` | Admin | Toutes commandes + filtres (status, payment_mode, search, margin_alert, dates) |
| GET | `/api/admin/margins` | Admin | Dashboard marge réelle par commande |
| GET | `/api/admin/customs` | Admin | Historique douane |
| GET | `/api/admin/partners` | Admin | Gestion partenaires/relais |
| POST | `/api/admin/partners` | Admin | Créer partenaire |
| PUT | `/api/admin/partners/:id` | Admin | Modifier partenaire |
| GET | `/api/admin/alerts` | Admin | Alertes marge négative + anomalies douane |

### 5.6 Dashboard (`/api/dashboard` → routes/dashboard.js — v7.1)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/dashboard/ops` | Admin | Pilotage opérationnel : activité, SLA, logistique (Dubai/Bateau/Anjouan), alertes, retards clients |
| GET | `/api/dashboard/sales` | Admin | Ventes & marges : KPIs L1/L2/L3, marge par catégorie, top 10 produits, clients récurrents, LTV |
| GET | `/api/dashboard/retards` | Admin | Clients en retard : classification par niveau, compensation recommandée, SMS suggérés |
| GET | `/api/dashboard/forecast` | Admin | Projections CA & marge (pessimiste/attendu/optimiste) avec modèle linéaire |

**SLA définis dans le code :**
- Warning : 35 jours · Late : 42 jours · Blocked : 56 jours · Inactif : 7 jours
- Compensations : Contact préventif (28j) → Avoir 5% (35j) → Remise 10% (42j) → Remboursement (56j)

### 5.7 Pricing (`/api/pricing` → routes/pricing.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/api/pricing/calculate` | Public | Calcul prix temps réel (product_id, qty, diaspora, relais_type) |
| POST | `/api/pricing/couture` | Public | Calcul prix tenue couture (fabric_id + model_id) |
| GET | `/api/pricing/rates` | Public | Taux de change actuels + historique 5 derniers |
| PUT | `/api/pricing/rates` | Admin | Mettre à jour les taux EUR/KMF et AED/KMF |

### 5.8 Modules (`/api/modules` → routes/modules.js — v7.5)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/modules` | Public | Liste des 4 modules avec disponibilité |
| GET | `/api/modules/:type` | Public | Détail d'un module |
| POST | `/api/modules/price` | Public | Calcul prix pour n'importe quel module |
| GET | `/api/modules/fabrics` | Public | Catalogue tissus (filtre: fabric_type) |
| GET | `/api/modules/models` | Public | Catalogue modèles tenues |
| POST | `/api/modules/fabrics` | Admin | Ajouter tissu (calcul auto prix KMF/yard) |
| POST | `/api/modules/models` | Admin | Ajouter modèle tenue |

**Registre des modules :**

| Module | Phase | Disponible | Description |
|--------|-------|------------|-------------|
| `couture` | 1 | ✅ Oui | Tissu + confection sur mesure · mensurations · atelier Deira |
| `lunettes` | 2 | ❌ Non | Ordonnance → montage Dubai → livraison (opticien partenaire à signer) |
| `construction` | 3 | ❌ Non | Matériaux finition Dubai (logistique volumineuse) |
| `cosmetiques` | 2 | ❌ Non | Marques Dubai exclusives (accord exclusivité à signer) |

### 5.9 Pilotage (`/api/pilotage` → routes/pilotage.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/pilotage` | Admin | Snapshot mensuel agrégé coûts & marges (moteur pricing v7) |
| GET | `/api/pilotage/history` | Admin | Historique mensuel sur N mois |

**Moteur intégré :** Reproduit la logique simulateur v7 (taux terrain 42% CIF, dimensions par catégorie, taux douane SH Comores).

### 5.10 Baskets (`/api/baskets` → routes/baskets.js — M10)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/api/baskets/share` | Optionnel | Créer panier partagé → lien K-XXXX WhatsApp (7j) |
| GET | `/api/baskets/:code` | Public | Consulter panier partagé |
| PATCH | `/api/baskets/:code` | JWT | Modifier panier (add/remove/update_qty) |
| POST | `/api/baskets/:code/pay` | JWT | Payer panier → verrouille + SMS créateur |
| POST | `/api/baskets/gift` | JWT | Offrir panier cadeau (14j) |
| POST | `/api/baskets/gift/:code/confirm` | JWT | Confirmer cadeau → SMS destinataire + code retrait |

### 5.11 Logistics (`/api/logistics` → routes/logistics.js — M12)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/api/logistics/shipments` | Admin | Créer expédition (carrier, container, eta) |
| GET | `/api/logistics/shipments` | Admin | Liste expéditions (avec nb commandes) |
| PATCH | `/api/logistics/shipments/:id` | Admin | Mettre à jour expédition (arrivée → auto SMS clients) |
| POST | `/api/logistics/parcels` | Admin | Créer colis |
| POST | `/api/logistics/parcels/:id/photo` | Admin | Photo colis agent Dubai |
| GET | `/api/logistics/labels/:shipment_id` | Admin | Étiquettes PDF A6 (avec QR code) |
| GET | `/api/logistics/manifest/:shipment_id` | Admin | Manifeste PDF complet |

### 5.12 Payments (`/api/payments` → routes/payments.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/api/payments/create-intent` | JWT | Créer PaymentIntent Stripe (EUR) |
| POST | `/api/payments/cash/confirm` | JWT | Confirmer paiement cash relais (code 6 chiffres) |
| POST | `/api/payments/webhook` | Stripe | Webhook Stripe (payment_intent.succeeded) |

**Flux post-paiement :** Déclenche auto `triggerPurchasing()` → crée entrée purchasing workflow.

### 5.13 Scans (`/api/scans` → routes/scans.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| POST | `/api/scans` | Agent | Scanner QR (4 étapes : preparation → shipped → relais_received → collected) |
| GET | `/api/scans/verify/:code` | Agent | Vérifier QR code |
| GET | `/api/scans/order/:orderId` | JWT | Historique scans d'une commande |

**4 étapes de scan MVP :**
1. **Préparation** — Article acheté, vérifié, emballé au hub Dubai
2. **Shipped** — Expédition maritime confirmée (départ)
3. **Relais received** — Reçu au point relais → déclenche SMS destinataire
4. **Collected** — Récupéré par le destinataire

### 5.14 Finance (`/api/finance` → routes/finance.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/finance/export` | Admin | Export CSV transactions du mois (avec taux figés) |
| GET | `/api/finance/stripe-proofs` | Admin | Liste PaymentIntents Stripe confirmés + rapprochement DB |
| GET | `/api/finance/report` | Admin | Rapport PDF mensuel (CA, marges, flux devises) |

### 5.15 Purchasing (`/api/purchasing` → routes/purchasing.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/purchasing` | Admin | Liste commandes en cours d'achat |
| PATCH | `/api/purchasing/:id` | Admin | Mettre à jour statut achat |

### 5.16 Loyalty (`/api/loyalty` → routes/loyalty.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/loyalty/points` | JWT | Points fidélité du client |
| POST | `/api/loyalty/redeem` | JWT | Utiliser points |

### 5.17 Unsold (`/api/unsold` → routes/unsold.js)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/unsold` | Admin | Produits jamais vendus ou stock dormant |
| POST | `/api/unsold/action` | Admin | Action sur invendu (promo, retrait, etc.) |

### 5.18 Health (`/health` + `/api/health`)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/health` | Public | Railway readiness probe (JSON status) |
| GET | `/api/health` | Public | Health check avec test DB + latence |

---

## 6. FONCTIONNALITÉS MÉTIER — IMPLÉMENTÉES vs RESTANTES

### ✅ IMPLÉMENTÉ ET OPÉRATIONNEL (sur `main`)

| # | Fonctionnalité | Fichiers | Statut |
|---|---------------|----------|--------|
| 1 | **Auth JWT + RBAC** (client, admin, agent_relais, agent_hub) | auth.js, middleware/auth.js | ✅ Complet |
| 2 | **Catalogue produits** (CRUD, catégories, stock, promo, recherche) | products.js | ✅ Complet |
| 3 | **Commandes complètes** (création, items, occasion, affectation expédition, annulation) | orders.js | ✅ Complet |
| 4 | **Double paiement** : Stripe EUR (diaspora) + Cash relais KMF (local) | payments.js | ✅ Complet |
| 5 | **Scan QR 4 étapes** (prep → shipped → relais → collected) avec trigger DB auto | scans.js, schema.sql triggers | ✅ Complet |
| 6 | **SMS automatiques** (confirmation, rappels cash H12/H36, disponibilité, cadeau) | utils/sms.js, cron server.js | ✅ Complet |
| 7 | **Points relais** (CRUD, zones, îles) | relais.js | ✅ Complet |
| 8 | **Panier partagé + cadeau WhatsApp** (share, gift, pay, confirm, SMS) | baskets.js | ✅ Complet |
| 9 | **Logistique maritime** (expéditions, manifeste PDF, étiquettes A6 QR, arrivée → auto SMS) | logistics.js | ✅ Complet |
| 10 | **Module couture** (tissus, modèles, 3 sous-types: ready_made/fabric_only/custom) | modules.js | ✅ Complet |
| 11 | **Moteur de pricing tri-devise** (EUR/AED/KMF, calcul coût de revient, fret, douane 42% CIF) | pricing.js, utils/pricing.js, pilotage.js | ✅ Complet |
| 12 | **Dashboard admin** (KPIs, orders filtrés, marges, douane, partenaires, alertes) | admin.js | ✅ Complet |
| 13 | **Dashboard opérationnel** (activité, SLA, logistique 3 zones, alertes, clients retards) | dashboard.js | ✅ Complet |
| 14 | **Dashboard ventes** (CA, marge décomposée, catégories, top produits, LTV, taux réachat) | dashboard.js | ✅ Complet |
| 15 | **Prévisions** (forecast CA pessimiste/attendu/optimiste, projection marge, alerte perte) | dashboard.js | ✅ Complet |
| 16 | **Pilotage coûts & marges** (snapshot agrégé, historique mensuel, cache 30s) | pilotage.js | ✅ Complet |
| 17 | **Finance & comptabilité** (export CSV, preuves Stripe, rapport PDF mensuel) | finance.js | ✅ Complet |
| 18 | **Purchasing workflow** (flux achat automatisé post-paiement) | purchasing.js | ✅ Complet |
| 19 | **Programme fidélité** (points, récompenses) | loyalty.js | ✅ Complet |
| 20 | **Gestion invendus** (détection, actions) | unsold.js | ✅ Complet |
| 21 | **Litiges & remboursements** (3 niveaux, photos, résolution) | schema.sql (disputes table) | ✅ Schema prêt |
| 22 | **Compensation retards automatisée** (4 niveaux: contact → avoir → remise → remboursement) | dashboard.js /retards | ✅ Complet |
| 23 | **Rate limiting** (6 limiters : global, auth, cash, scan, orders, dashboard) | middleware/rate-limit.js | ✅ Complet |
| 24 | **Sécurité** (Helmet, CORS hardened, trust proxy, graceful shutdown) | server.js | ✅ Complet |
| 25 | **Taux de change** (CRUD admin, historique, cache, fallback) | pricing.js, utils/rates.js | ✅ Complet |

### 🔶 DÉCLARÉ MAIS NON ENCORE OPÉRATIONNEL

| # | Module | Phase | Bloqueur |
|---|--------|-------|----------|
| 1 | **Module lunettes** (ordonnance → montage → livraison) | Phase 2 | Opticien partenaire Dubai à signer |
| 2 | **Module cosmétiques** (marques Dubai exclusives) | Phase 2 | Accord exclusivité fournisseur à signer |
| 3 | **Module construction** (matériaux finition) | Phase 3 | Logistique volumineuse non résolue |

> Note : Le code backend pour ces 3 modules existe dans `modules.js` (registre + endpoints). Ils retournent `disponible: false` et des messages d'attente. L'activation est un changement de flag dans `MODULES_REGISTRY`, pas un développement backend.

### 🔴 RESTE À FAIRE (développement nécessaire)

| # | Fonctionnalité | Priorité | Détail |
|---|---------------|----------|--------|
| 1 | **Frontend SPA complet** | 🔴 Haute | `Komerce_Web.html` existe mais doit être connecté à toutes les routes API |
| 2 | **Tests automatisés** | 🔴 Haute | Aucun test unitaire/intégration — critique pour production |
| 3 | **Route disputes CRUD** | 🟡 Moyenne | La table `disputes` existe en DB mais aucun fichier `routes/disputes.js` n'est monté |
| 4 | **Notifications push** | 🟡 Moyenne | SMS OK, mais pas de push web/mobile |
| 5 | **Upload images produits** | 🟡 Moyenne | `image_url` existe en DB mais pas d'upload/stockage S3 |
| 6 | **Tableau de bord relais** | 🟡 Moyenne | Les agents relais ont un rôle mais pas de vue dédiée |
| 7 | **Multi-île** | 🟢 Basse | Schema prêt (`island` sur relais) mais logique = Anjouan uniquement |
| 8 | **i18n** | 🟢 Basse | Tout en français — pas de support multilingue |
| 9 | **Rate limiter Redis** | 🟢 Basse | Memory store OK pour MVP, Redis nécessaire en production scale |
| 10 | **Logging structuré** | 🟢 Basse | console.log/error partout — passer à Winston/Pino |

---

## 7. SÉCURITÉ & MIDDLEWARE

### 7.1 Authentification (middleware/auth.js)

```
JWT Bearer Token
├── authenticate()     → vérifie le token, attache req.user
└── requireRole([...]) → vérifie req.user.role ∈ roles autorisés
```

**Rôles :** `client` · `admin` · `agent_relais` · `agent_hub`
**Secret :** `JWT_SECRET` en .env
**Token :** Expire selon configuration (refresh disponible)

### 7.2 Rate Limiting (middleware/rate-limit.js)

| Limiter | Cible | Limite |
|---------|-------|--------|
| `globalLimiter` | `/api/*` | 100 req / 15 min |
| `authLimiter` | `/api/auth/login`, `/api/auth/register` | 5 req / 15 min |
| `cashConfirmLimiter` | `/api/payments/cash/confirm` | 3 req / 1 min |
| `scanCollectLimiter` | `/api/scans/collect` | 5 req / 1 min |
| `orderCreateLimiter` | `/api/orders` | 10 req / 1 min |
| `dashboardLimiter` | `/api/dashboard/*` | 30 req / 1 min |

### 7.3 Autres mesures

- **Helmet** : headers sécurité HTTP standards
- **CORS** : whitelist localhost, *.railway.app, FRONTEND_URL
- **Trust proxy** : `app.set('trust proxy', 1)` pour Railway
- **Body limit** : 1MB JSON/URL-encoded
- **Graceful shutdown** : SIGTERM → ferme les connexions proprement

---

## 8. OUTILS ADMIN LOCAUX

Versions **réelles** dans `public/` :

| Outil | Version repo | Fichier |
|-------|-------------|---------|
| **SPA Komerce** | Komerce_Web.html | Front public |
| **Client API** | komerce-api.js | Wrapper fetch pour toutes les routes |

> Note : Les outils Backoffice, Simulateur et Pilotage décrits dans les sessions précédentes sont des **pages HTML standalone** servies par `public/`. Leurs versions dans le repo sont les versions commitées sur `main`.

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
| 15 | Audit intégrité + Alignement | Audit code 9.3/10, .gitignore/.env.example/rate-limit/health corrigés, HANDOVER aligné avec code réel |

---

## 11. ÉTAT ACTUEL & PROCHAINES ÉTAPES

### État au 4 avril 2026

- ✅ **25 fonctionnalités backend** implémentées et poussées sur `main`
- ✅ **18 fichiers routes** montés dans server.js v8.5
- ✅ **14+ tables** PostgreSQL avec triggers automatiques
- ✅ **Score intégrité : 9.3/10** — tous les faux positifs de l'audit résolus
- ⚠️ **1 point opérationnel restant** : supprimer `backend/` du tracking git

### Nettoyage restant (non bloquant)

| # | Action | Impact |
|---|--------|--------|
| 1 | `git rm -r backend/` | Supprimer le dossier obsolète (node_modules trackés) |
| 2 | Supprimer `public/Komerce_Web.html.old` | Nettoyage fichier obsolète |
| 3 | Supprimer `public/komerce-api.js.old` | Nettoyage fichier obsolète |
| 4 | Déplacer `public/*.sql` vers `db/` | Organisation migrations |

### Prochaines étapes recommandées

| Priorité | Action | Détail |
|----------|--------|--------|
| 🔴 P0 | Tests automatisés | Jest/Supertest — couvrir auth, orders, payments, scans |
| 🔴 P0 | Frontend connecté | Relier Komerce_Web.html à toutes les routes API |
| 🟡 P1 | Route disputes | Créer routes/disputes.js (table DB prête) |
| 🟡 P1 | Upload images | S3/Cloudinary pour products.image_url |
| 🟡 P1 | Activer modules Phase 2 | Signer contrats opticien + cosmétiques |
| 🟢 P2 | Logging structuré | Winston/Pino + Railway logs |
| 🟢 P2 | Redis rate-limit | Remplacer memory store pour scale |
| 🟢 P2 | Multi-île | Étendre logique au-delà d'Anjouan |

---

> **Ce document est la source de vérité pour tout nouveau développeur ou IA reprenant le projet.**
> Il reflète exactement l'état du code sur `main` au 4 avril 2026.
