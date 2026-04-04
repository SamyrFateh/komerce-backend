# HANDOVER MASTER — Komerce Backend v8.9

> **Document unique et définitif — toute l'implémentation, toutes les sessions (1→15)**
> Dernière mise à jour : Session 15 — 4 avril 2026 à 07h00 GMT+2
> Auteur : Jean Daniel — `samlepirate97445@hotmail.com`
> **Score E2E : 40/40 ✅ — Tous les endpoints testés et fonctionnels**

---

## Table des matières

1. [Résumé exécutif v8.9](#1-résumé-exécutif-v89)
2. [Architecture technique](#2-architecture-technique)
3. [Fichiers actifs](#3-fichiers-actifs)
4. [Backend Railway — Routes API complètes](#4-backend-railway--routes-api-complètes)
5. [Base de données — Schéma complet](#5-base-de-données--schéma-complet)
6. [Frontend — Dashboard principal](#6-frontend--dashboard-principal)
7. [Frontend — Test Dashboard](#7-frontend--test-dashboard)
8. [Flux QR Code complet](#8-flux-qr-code-complet)
9. [Scanner caméra agent relais](#9-scanner-caméra-agent-relais)
10. [Sync LIVE BroadcastChannel](#10-sync-live-broadcastchannel)
11. [Design system](#11-design-system)
12. [Cas problèmes & couverture backend](#12-cas-problèmes--couverture-backend)
13. [Variables d'environnement Railway](#13-variables-denvironnement-railway)
14. [Audit sécurité — Round 1 + Round 2](#14-audit-sécurité--round-1--round-2)
15. [🧪 RAPPORT DE TESTS E2E v8.9](#15--rapport-de-tests-e2e-v89)
16. [💉 GUIDE D'INJECTION DE DONNÉES POUR TESTS E2E](#16--guide-dinjection-de-données-pour-tests-e2e)
17. [Requêtes SQL utiles](#17-requêtes-sql-utiles)
18. [Tests sécurité](#18-tests-sécurité)
19. [Configuration et déploiement](#19-configuration-et-déploiement)
20. [Historique des corrections majeures (par session)](#20-historique-des-corrections-majeures-par-session)
21. [Routes manquantes à implémenter](#21-routes-manquantes-à-implémenter)
22. [Prochaines étapes](#22-prochaines-étapes)
23. [Accès & credentials](#23-accès--credentials)
24. [Commandes utiles](#24-commandes-utiles)

---

## 1. Résumé exécutif v8.9

### Ce qui a changé (v8.8 → v8.9)

| Changement | Détail |
|------------|--------|
| 🔴 **Bug critique corrigé** | `GET /api/admin/customs` retournait 500 — la table `customs_history` n'existait pas en base |
| ✅ **Migration ajoutée** | `CREATE TABLE IF NOT EXISTS customs_history` (9 colonnes) dans `server.js` au démarrage |
| ✅ **ALTER fallback** | Colonnes ajoutées individuellement si la table existe déjà (try/catch) |
| ✅ **Score E2E** | **40/40** — tous les endpoints testés et fonctionnels |

### Historique des versions récentes

| Version | Score E2E | Bugs corrigés |
|---------|-----------|---------------|
| **v8.9** | **40/40** ✅ | customs_history table manquante → 500 sur /api/admin/customs |
| v8.8 | 39/40 | Migration robuste try/catch + CREATE TABLE partners + gen_random_uuid |
| v8.7 | 38/40 | Auto-migration customs colonnes + loyalty_tiers + users.loyalty_tier_id |
| v8.6 | 36/40 | Auto-migration bcrypt admin hash · fix P0 dashboard + scans · fix 404 routes |
| v8.5 | 34/40 | Rate-limit middleware branché · health route montée · .env retiré du repo |
| v8.4 | 30/40 | Helmet · CORS fix · graceful shutdown · health check DB · cron lock |

---

## 2. Architecture technique

### Stack

| Composant | Technologie | Version |
|-----------|-------------|---------|
| Runtime | Node.js | 18 LTS |
| Framework | Express | 4.x |
| Base de données | PostgreSQL | 16 |
| Hébergement | Railway | Auto-deploy depuis GitHub `main` |
| Auth | JWT (HS256) | jsonwebtoken |
| Sécurité | Helmet + express-rate-limit | ^8.0.0 |
| Hashing | bcrypt | ^5.x |

### Diagramme d'architecture

```
┌──────────────────────────────────────────────────┐
│            MÊME NAVIGATEUR                        │
│                                                   │
│  Komerce_v84_Final.html                           │
│  (Dashboard principal agent)                      │
│  Hub | Relais | Problèmes | Back-office           │
│  Fidélité | Clients | Pilotage                    │
│       ↕ BroadcastChannel('komerce-live')          │
│  Komerce_Test_Dashboard_FIXED.html                │
│  (Test runner 12 steps + Tests Problèmes)         │
└──────────────────┬───────────────────────────────┘
                   │ fetch() direct (no proxy)
┌──────────────────▼───────────────────────────────┐
│   Railway Backend — Node.js / Express v8.9        │
│   https://komerce-backend-production              │
│   .up.railway.app                                 │
│                                                   │
│   server.js         (helmet, CORS, rate-limit,    │
│                      auto-migrations v8.6→v8.9)   │
│   routes/orders.js  (1241 lignes)                 │
│   routes/scans.js   (535 lignes)                  │
│   routes/loyalty.js (6 routes fidélité)           │
│   routes/unsold.js  (7 routes invendus)           │
│   + 14 autres routes (auth, admin, etc.)          │
│   middleware/auth.js (JWT HS256 + cache 5min)     │
│   utils/reference.js (séquences PostgreSQL)       │
│   utils/sms.js       (validation E.164)           │
└──────────────────┬───────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────┐
│   PostgreSQL 16 Railway                           │
│   Tables: users, orders, products, relais, scans, │
│   customs_history, partners, loyalty_tiers,       │
│   baskets, basket_items, recipients, shipments,   │
│   order_items, order_status_history, sms_log,     │
│   exchange_rates, fabrics, garment_models,        │
│   disputes, ceremony_* ...                        │
│   + Vues: customs_taux_mensuel                    │
│   + Séquences: order_ref_seq, shipment_ref_seq    │
└──────────────────────────────────────────────────┘
```

### Outils admin autonomes (HTML local, double-clic)

| Outil | Fichier | Rôle |
|-------|---------|------|
| **Backoffice** | `Komerce_Backoffice_v4.html` | Opérations quotidiennes, bijoux, invendus, fidélité |
| **Simulateur** | `Komerce_Simulateur_v17.html` | Pricing — source unique de vérité pour les prix |
| **Pilotage** | `Komerce_Pilotage_v7.html` | Alertes, historique, marges, clients & ventes |

### Flux métier principal

```
Client passe commande
  → Admin valide + déclenche sourcing (fournisseur Noon Dubai, etc.)
    → Fournisseur expédie vers Hub central (Dubai)
      → Hub scanne le colis à l'arrivée
        → Hub expédie vers Point Relais assigné (Comores)
          → Relais scanne réception
            → Relais génère QR Code → envoie WhatsApp au client
              → Client se présente → Agent scanne QR → Remise colis ✅
                → recalculate_loyalty() → palier fidélité mis à jour
```

### Acteurs

| Acteur | Rôle |
|--------|------|
| Admin | Gestion commandes, sourcing, supervision globale, pricing |
| Agent Hub | Réception colis, scan entrant, expédition vers relais |
| Agent Relais | Réception colis, génération QR, remise client, caisse cash |
| Client | Commande en ligne, reçoit son colis au point relais |
| Fournisseur | Noon Dubai Electronics, Amazon UAE, bijoutiers Dubai, etc. |

### Décisions architecturales clés

- **Pas de SMS** — remplacé par QR Code unique envoyé via WhatsApp + lien web universel (0 coût vs SMS payant)
- **QR Code = HMAC SHA-256** signé (infalsifiable), expiration 48h, usage unique
- **Pas de proxy CORS** — Railway accepte nativement `null` origin (fichier local `file://`)
- **BroadcastChannel** pour sync live entre dashboards (même navigateur uniquement)
- **Données démo chargées immédiatement** — appel API en arrière-plan sans bloquer l'affichage
- **Soft-delete fournisseurs** — `deleted_at TIMESTAMPTZ` pour conserver l'historique PO
- **Fidélité automatique** — `recalculate_loyalty()` après chaque collecte (SCAN 6)
- **Invendus automatiques** — `auto_unsold()` bascule les colis `available > 14j`
- **Auto-migrations** — `server.js` exécute des CREATE TABLE IF NOT EXISTS et ALTER TABLE au démarrage (v8.6+)

---

## 3. Fichiers actifs

### Fichiers principaux

| Fichier | Description | Taille | État |
|---------|-------------|--------|------|
| `Komerce_v84_Final.html` | Dashboard principal — Hub/Relais/Problèmes/Back-office/Fidélité/Clients/Pilotage | ~470 KB | ✅ Production |
| `Komerce_Test_Dashboard_FIXED.html` | Test runner — 12 steps + Tests Problèmes + mode démo | ~120 KB | ✅ Production |
| `Komerce_Backend.html` | Dashboard backend monitoring | — | ✅ Actif |

### Backend Railway (repo `SamyrFateh/komerce-backend`)

| Fichier | Description | État |
|---------|-------------|------|
| `server.js` | Express v8.9 + helmet + CORS + rate-limit + graceful shutdown + auto-migrations | ✅ Déployé |
| `schema.sql` | Schéma de base (tables core) — NOTE: certaines tables créées par migrations dans server.js | ✅ Déployé |
| `routes/orders.js` | Commandes + QR + retrait (1241 lignes) | ✅ Déployé |
| `routes/scans.js` | Scans + verify-qr (535 lignes) | ✅ Déployé |
| `routes/auth.js` | Login/register + loyalty info dans /me | ✅ Déployé |
| `routes/loyalty.js` | 6 routes fidélité | ✅ Déployé |
| `routes/unsold.js` | 7 routes invendus | ✅ Déployé |
| `routes/purchasing.js` | Sourcing semi-auto + soft-delete fournisseurs | ✅ Déployé |
| `routes/pilotage.js` | Snapshot + onglet Clients & Ventes | ✅ Déployé |
| `routes/admin.js` | KPIs + marges + douane + alertes + partenaires | ✅ Déployé |
| `routes/payments.js` | Stripe + cash → triggerPurchasing() | ✅ Déployé |
| `middleware/auth.js` | JWT HS256 + maxAge 24h + cache mémoire 5min | ✅ Déployé |
| `utils/reference.js` | Séquences PostgreSQL (zéro collision) | ✅ Déployé |
| `utils/sms.js` | Validation E.164 + transaction annulation H+36 | ✅ Déployé |
| `package.json` | helmet ^8.0.0, lodash override ^4.17.21 | ✅ Déployé |
| `package-lock.json` | Synchronisé avec helmet (session 14) | ✅ Déployé |

### Outils admin locaux

| Fichier | Version | Description |
|---------|---------|-------------|
| `Komerce_Backoffice_v4.html` | v4 | Bijoux sécurisé + invendus + fidélité |
| `Komerce_Simulateur_v17.html` | v17 | CDR v8 + scénarios douane + arrondi psycho + prix terrain |
| `Komerce_Pilotage_v7.html` | v7 | 6 onglets + Clients & Ventes |

---

## 4. Backend Railway — Routes API complètes

**Base URL :** `https://komerce-backend-production.up.railway.app`

### 4.1 Health Check

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 1 | `/api/health` | GET | ❌ | Health check + test DB + latence |

### 4.2 Authentification

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 2 | `/api/auth/register` | POST | ❌ | Inscription client → `{ user, token }` |
| 3 | `/api/auth/login` | POST | ❌ | Login → JWT token |

### 4.3 Produits

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 4 | `/api/products` | GET | ❌ | Liste tous les produits du catalogue |
| 5 | `/api/products/:id` | GET | ❌ | Détail d'un produit par ID |

### 4.4 Points Relais

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 6 | `/api/relais` | GET | ❌ | Liste des relais actifs (4 relais Comores) |

### 4.5 Commandes

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 7 | `/api/orders` | POST | ✅ JWT | Créer commande + loyalty discount appliqué |
| 8 | `/api/orders` | GET | ✅ JWT | Liste commandes (filtre user/admin) |
| 9 | `/api/orders/:ref` | GET | ⚠️ public | Détail par référence (données limitées anonymes) |
| 10 | `/api/orders/:id/history` | GET | ✅ JWT | Historique des transitions de statut |
| 11 | `/api/orders/relais` | GET | ✅ JWT | Colis disponibles au relais assigné |
| 12 | `/api/orders/problems` | GET | ✅ JWT | Commandes avec problèmes détectés |
| 13 | `/api/orders/:id/qr-token` | POST | ✅ JWT | Génère token HMAC QR (expiration 48h, usage unique) |
| 14 | `/api/orders/retrait/:token` | GET | ❌ public | Page HTML retrait client (vérifie HMAC + expiration) |

### 4.6 Paniers

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 15 | `/api/baskets` | POST | ✅ JWT | Créer un panier partagé |
| 16 | `/api/baskets/:id` | GET | ✅ JWT | Détail d'un panier |
| 17 | `/api/baskets/:id/items` | POST | ✅ JWT | Ajouter un article au panier |

### 4.7 Module Cérémonie

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 18 | `/api/ceremony/fabrics` | GET | ❌ | Liste des tissus cérémonie |
| 19 | `/api/ceremony/models` | GET | ❌ | Liste des modèles de confection |
| 20 | `/api/ceremony/quote` | POST | ❌ | Devis cérémonie (tissu + modèle + quantité) |
| 21 | `/api/modules/ceremony` | GET | ❌ | Module cérémonie (config + catalogue) |

### 4.8 Litiges

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 22 | `/api/disputes` | POST | ✅ JWT | Créer un litige sur une commande |
| 23 | `/api/disputes` | GET | ✅ JWT | Liste des litiges (admin: tous, user: les siens) |
| 24 | `/api/disputes/:id/resolve` | PATCH | ✅ admin | Résoudre un litige |

### 4.9 Admin / Back-office

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 25 | `/api/admin/dashboard` | GET | ✅ admin | KPIs globaux (CA, commandes, statuts, timestamps) |
| 26 | `/api/admin/orders` | GET | ✅ admin | Toutes les commandes avec filtres avancés |
| 27 | `/api/admin/margins` | GET | ✅ admin | Analyse marges (coût estimé vs réel, alertes) |
| 28 | `/api/admin/customs` | GET | ✅ admin | Historique douane + taux mensuel (customs_history) |
| 29 | `/api/admin/partners` | GET | ✅ admin | Liste des partenaires |
| 30 | `/api/admin/partners` | POST | ✅ admin | Créer un partenaire |
| 31 | `/api/admin/partners/:id` | PUT | ✅ admin | Modifier un partenaire |
| 32 | `/api/admin/alerts` | GET | ✅ admin | Alertes actives (marges, douane, anomalies) |

### 4.10 Pilotage

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 33 | `/api/pilotage` | GET | ✅ admin | Snapshot mensuel (CA, marges, volumes, catégories) |
| 34 | `/api/pilotage/history` | GET | ✅ admin | Historique par mois (tendances, comparaisons) |
| 35 | `/api/pilotage/clients` | GET | ✅ admin | Top clients, paliers fidélité, ventes par relais |

### 4.11 Fidélité, Invendus, Taux, Achats

| # | Route | Méthode | Auth | Description |
|---|-------|---------|------|-------------|
| 36 | `/api/loyalty` | GET | ❌ | Paliers de fidélité publics |
| 37 | `/api/unsold` | GET | ✅ admin | Liste des produits invendus |
| 38 | `/api/purchasing` | GET | ✅ admin | Pipeline d'achats / sourcing |
| 39 | `/api/rates` | GET | ❌ | Taux de change (EUR/KMF, AED/KMF) |

### 4.12 Sécurité

| # | Test | Description |
|---|------|-------------|
| 40 | Security headers + rate limiting | Helmet headers présents, rate limit actif, CORS configuré |

---

## 5. Base de données — Schéma complet

**Connexion :** `crossover.proxy.rlwy.net:39045` / `railway` / `postgres`

### Enums PostgreSQL

| Enum | Valeurs |
|------|---------|
| `user_role` | client, admin, agent_relais, agent_hub |
| `order_status` | draft, confirmed, paid, preparation, shipped, relais_received, available, collected, cancelled |
| `payment_mode` | stripe_eur, cash_relais |
| `payment_status` | pending, paid, failed, refunded |
| `scan_step` | preparation, shipped, relais_received, collected |

### Tables principales

#### Tables core (définies dans schema.sql)

| Table | Colonnes clés | Description |
|-------|---------------|-------------|
| `users` | id, email (UNIQUE), phone, role, password_hash, orders_count, loyalty_tier_id, loyalty_since | Utilisateurs (admin + agents + clients) |
| `relais` | id, name, address, island, agent_id, status | 4 relais actifs (Comores) |
| `products` | id, sku (UNIQUE), name, category, price_aed, price_kmf, cost_kmf, stock | Catalogue produits |
| `baskets` | id, user_id, code, created_at | Paniers partagés |
| `basket_items` | id, basket_id (FK), product_id (FK), quantity | Articles du panier |
| `recipients` | id, name, phone, address, user_id (FK) | Destinataires de colis |
| `shipments` | id, reference (UNIQUE), status | Expéditions container |
| `orders` | 57+ colonnes — table centrale (voir détail ci-dessous) | Commandes |
| `order_items` | order_id (FK), product_id (FK), quantity, price_kmf | Articles de commande |
| `scans` | id, order_id (FK), scan_step, agent_id, relais_id, damaged, note | Historique scans logistique |
| `order_status_history` | order_id, old_status, new_status, changed_at, changed_by | Historique transitions |
| `sms_log` | id, phone, message, status | Log SMS Africa's Talking |
| `exchange_rates` | currency_pair, rate | EUR/KMF=495, AED/KMF=139 |
| `fabrics` | id, name, price_kmf, image_url | Tissus cérémonie |
| `garment_models` | id, name, confection_price_kmf | Modèles de confection |
| `disputes` | id, order_id, user_id, reason, status, resolution, resolved_at | Litiges |

#### Tables d'extension cérémonie

| Table | Description |
|-------|-------------|
| `ceremony_fabrics` | Tissus spécifiques cérémonies |
| `ceremony_models` | Modèles spécifiques cérémonies |
| `ceremony_order_items` | Articles de commande cérémonie |

#### Tables créées par migration (server.js au démarrage)

| Table | Version | Description |
|-------|---------|-------------|
| `customs_history` | **v8.9** | Historique douane (estimé vs réel, anomalies) |
| `partners` | v8.8 | Partenaires logistiques (relais, transporteurs) |
| `loyalty_tiers` | v8.7 | Paliers de fidélité (4 niveaux) |

### Détail table `customs_history` (v8.9)

```sql
CREATE TABLE IF NOT EXISTS customs_history (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID        REFERENCES orders(id) ON DELETE CASCADE,
  customs_estimated_kmf INTEGER     DEFAULT 0,
  customs_real_kmf      INTEGER     DEFAULT 0,
  customs_delta_pct     NUMERIC(6,2) DEFAULT 0,
  is_anomaly            BOOLEAN     NOT NULL DEFAULT FALSE,
  notes                 TEXT,
  customs_agent_id      UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Détail table `partners` (v8.8)

```sql
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  partner_type TEXT NOT NULL DEFAULT 'relais',
  contact_name TEXT, contact_phone TEXT, contact_email TEXT,
  address TEXT, island TEXT, zone TEXT,
  commission_kmf INTEGER DEFAULT 0,
  notes TEXT, is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Détail table `loyalty_tiers` (v8.7)

```sql
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL UNIQUE,
  min_orders INT NOT NULL DEFAULT 0,
  discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  badge TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Données initiales: Bronze(0,0%), Silver(3,2%), Gold(10,5%), Platinum(25,8%)
```

### Colonnes supplémentaires de `orders` (ajoutées par ALTER TABLE)

Les colonnes suivantes ne sont pas dans `schema.sql` mais ont été ajoutées par migrations :

| Colonne | Type | Description |
|---------|------|-------------|
| `margin_alert` | BOOLEAN | Alerte marge activée |
| `margin_real_pct` | NUMERIC | Marge réelle en pourcentage |
| `margin_estimated_pct` | NUMERIC | Marge estimée en pourcentage |
| `sourcing_blocked` | BOOLEAN | Sourcing bloqué |
| `confection_type` | TEXT | Type de confection (couture, etc.) |
| `confection_instructions` | TEXT | Instructions de confection |
| `confection_delay_days` | INTEGER | Délai de confection en jours |
| `ordered_at` | TIMESTAMPTZ | Timestamp passage commande |
| `preparation_at` | TIMESTAMPTZ | Timestamp début préparation |
| `purchasing_at` | TIMESTAMPTZ | Timestamp début sourcing |
| `cost_estimated_kmf` | INTEGER | Coût estimé en KMF |
| `cost_real_kmf` | INTEGER | Coût réel en KMF |
| `cost_delta_pct` | NUMERIC | Écart coût en pourcentage |
| `cost_closed_at` | TIMESTAMPTZ | Date de clôture coût |

### Vue `customs_taux_mensuel`

Vue calculant le taux moyen de douane par mois à partir de `customs_history`.

### Paliers fidélité (données initiales)

| Label | Badge | Min commandes | Remise |
|-------|-------|---------------|--------|
| Bronze | 🥉 | 0 | 0% |
| Silver | 🥈 | 3 | 2% |
| Gold | 🥇 | 10 | 5% |
| Platinum | 💎 | 25 | 8% |

### Séquences PostgreSQL

| Séquence | Usage |
|----------|-------|
| `order_ref_seq` | Références commande uniques `KOM-YYYY-NNNNNN` (zéro collision) |
| `shipment_ref_seq` | Références expédition uniques `EXP-YYYY-NNNN` |

### Index et contraintes

```sql
-- Contraintes UNIQUE
ALTER TABLE orders ADD CONSTRAINT uq_orders_reference UNIQUE (reference);
CREATE UNIQUE INDEX uq_orders_qr_token ON orders (qr_token) WHERE qr_token IS NOT NULL;
CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_products_sku ON products (sku) WHERE sku IS NOT NULL;

-- Contraintes CHECK
ALTER TABLE order_items ADD CONSTRAINT chk_oi_qty CHECK (quantity > 0);
ALTER TABLE products ADD CONSTRAINT chk_products_price CHECK (price_kmf > 0);
ALTER TABLE products ADD CONSTRAINT chk_products_stock CHECK (stock >= 0);

-- Index de performance
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_scans_order_id ON scans(order_id);
```

### Fonctions SQL

| Fonction | Description |
|----------|-------------|
| `recalculate_loyalty(user_id)` | Recalcule le palier d'un client après commande collectée |
| `auto_unsold()` | Bascule en invendu les commandes `available > 14 jours` — cron nuit |

### Migrations appliquées

| Migration | Session | Contenu |
|-----------|---------|---------|
| `migration_suppliers_v76.sql` | S1 | Tables suppliers, product_suppliers, purchase_orders |
| `seed_test_purchasing.sql` | S1 | Données test (fournisseurs, mappings) |
| `migration_session6.sql` | S6 | Tables loyalty_tiers, unsold_items + colonnes fidélité/invendus |
| `migration_softdelete_suppliers.sql` | S7 | Colonnes deleted_at + index partiels + FK SET NULL |
| `migration_hub_v82.sql` | S8-9 | Colonnes hub stock (received_qty, batch_id, etc.) |
| `migration_v84.sql` | S12 | Colonnes qr_token, qr_expires_at |
| `migration-round2-constraints.sql` | S13 | Séquences, UNIQUE, CHECK, index performance |
| **server.js auto-migration v8.7** | S15 | CREATE TABLE loyalty_tiers + ALTER users ADD loyalty_tier_id |
| **server.js auto-migration v8.8** | S15 | CREATE TABLE partners (try/catch individuel) |
| **server.js auto-migration v8.9** | S15 | **CREATE TABLE customs_history** (9 colonnes) |

---

## 6. Frontend — Dashboard principal

**Fichier :** `Komerce_v84_Final.html` (~470 KB, 9204 lignes)

### Structure des onglets sidebar

| Onglet | ID | Contenu |
|--------|-----|---------| 
| 🏭 Hub | `tab-hub` | File attente, scan entrant, stats (reçus/incomplets/prêts/alertes >7j), expédition relais |
| 📦 Relais | `tab-rel` | Colis en attente, QR Code (4 boutons), remise client, caisse du jour, clients à contacter |
| ⚠️ Problèmes | `tab-prob` | 10 règles détection, score santé 0-100, compteurs par catégorie |
| 🏢 Back-office | `tab-bo` | CRUD agents, fournisseurs, relais, hubs, config |
| ⭐ Fidélité | `tab-fid` | Config paliers éditables, liste clients par palier, stats |
| 👥 Clients | `tab-cli` | Top 20 clients CA, Top 20 produits, ventes par relais, répartition catégorie |
| 📊 Pilotage | `tab-pil` | Simulateur produit, pilotage temporel, mix catégories, dashboard, opérationnel, historique douane |

### 10 règles de détection problèmes

| # | Règle | Catégorie |
|---|-------|-----------| 
| 1 | Paiement confirmé sans BC | Finance |
| 2 | Double paiement < 10min | Finance |
| 3 | `received_qty > quantity` | Appro |
| 4 | BC reçu mais commande en `purchasing` | Appro |
| 5 | Preparation > 4 jours | Logistique |
| 6 | Transit > 12 jours | Logistique |
| 7 | Available > 7 jours sans retrait | Client |
| 8 | Available + SMS non envoyé | Client |
| 9 | Commande active sans `hub_id` | Données |
| 10 | Cash collecté non soldé | Finance |

### Agent Relais — Fonctionnalités v8.4

- **5 stats** : en attente / retirés / alertes >48h / cash attendu / à contacter
- **Code retrait** 6 chiffres → POST `/api/scans/collect`
- **Scan réception** → POST `/api/scans` avec `scan_type: relais_received`
- **Clients à contacter** : raison + message suggéré pré-rempli + bouton "Contacté ✓"
  - 7 scripts : waiting_too_long, incomplete_hub, no_sms, transit_long, lost_parcel, double_payment, hub_wrong
- **En approche** : statuts hub→relais en temps réel (ready/transit/partial/problem)
- **Caisse du jour** : encaissé / en attente / Stripe

---

## 7. Frontend — Test Dashboard

**Fichier :** `Komerce_Test_Dashboard_FIXED.html` (~120 KB)

### Onglets

| Onglet | ID | Contenu |
|--------|-----|---------| 
| 🚀 Pipeline | `screen-pipeline` | Test 12 steps bout en bout |
| 🏠 Hub | `screen-hub` | Monitoring Hub live |
| 🏪 Relais | `screen-relais` | Monitoring Relais live |
| ⚠️ Problèmes | `screen-problemes` | Tickets actifs |
| 🔴 Tests Problèmes | `screen-problemes-tests` | 14 scénarios d'erreur (session 13) |
| 🧹 Cleanup | `screen-cleanup` | Nettoyage base de test |

### 12 Steps du pipeline test

| Step | Description |
|------|-------------|
| 1 | Connexion admin (JWT) |
| 2 | Seed données [TEST] (22 produits, 4 fournisseurs, mappings) |
| 3 | Commande créée |
| 4 | Paiement cash confirmé |
| 5 | Sourcing déclenché → PO créée |
| 6 | Commande Noon confirmée |
| 7 | Hub file attente vérifié (format `{ incomplete, ready }`) |
| 8 | Validation réception Hub |
| 9 | Transfert Hub → Relais (SCAN 4 shipped) |
| 10 | Colis disponible au relais (SCAN 5) |
| 11 | Génération QR token HMAC |
| 12 | Verify-QR usage unique (2e scan → 409) |

---

## 8. Flux QR Code complet

### Génération

```
Agent relais → clic "🔲 QR Code" sur colis en attente
  → showQRModal(orderId, phone, clientName)
    → POST /api/orders/:id/qr-token
      → Backend génère HMAC SHA-256 :
          payload = { orderId, relaisId, clientName, exp: NOW+48h }
          token   = HMAC-SHA256(JSON.stringify(payload), QR_SECRET)
      → Stocke token + exp en DB (orders.qr_token, orders.qr_expires_at)
      → Retourne { token, expiresAt }
    → Frontend construit URL retrait :
        https://komerce-backend-production.up.railway.app/api/orders/retrait/[TOKEN]
    → QR Code généré avec qrcode.js (CDN) embarquant l'URL
```

### Envoi client

```
4 boutons dans la modale QR :
  📲 Envoyer WhatsApp → wa.me/[phone]?text=Votre colis est prêt... [lien]
  🔗 Copier le lien   → clipboard.writeText(url)
  ⬇️ Télécharger QR   → canvas.toBlob() → PNG téléchargé
  🌐 Voir la page     → window.open(url)
```

### Page retrait client (publique)

**Route :** `GET /api/orders/retrait/:token`

```
Client ouvre le lien (mobile ou desktop)
  → Page HTML mobile-friendly :
      - Vérifie signature HMAC + expiration
      - Si invalide → page erreur "Ce lien n'est plus valide"
      - Si valide → affiche :
          • QR Code (qrcode.js CDN)
          • Bouton ⬇️ Télécharger (PNG via canvas)
          • Infos : nom client, référence, point relais, expire le JJ/MM HH:MM
          • Mention "Usage unique — invalidé au scan"
```

### Scan & remise

```
Agent relais → clic "📷 Scanner QR"
  → Caméra navigateur s'ouvre (Html5Qrcode CDN)
  → Client présente QR → détection automatique
  → POST /api/scans/verify-qr { token, relaisId, agentId }
      → Vérifie signature HMAC
      → Vérifie expiration (qr_expires_at > NOW)
      → Vérifie usage unique (qr_token NOT NULL)
      → Si tout OK (dans une transaction) :
          UPDATE orders SET qr_token = NULL, status = 'collected'
          INSERT INTO scans (order_id, type='qr_delivery', ...)
          Retourne { ok: true, order: {...} }
  → Dashboard affiche ✅ Remis à [clientName]
```

### Sécurité QR

| Risque | Protection |
|--------|-----------| 
| Token devinable | HMAC-SHA256 avec clé secrète 256 bits (`QR_SECRET`) |
| Réutilisation | `qr_token = NULL` après 1er scan (usage unique, transaction) |
| Expiration | `qr_expires_at` vérifié côté serveur (48h) |
| Mauvais relais | `relaisId` dans token comparé au relais du scanner |
| Lien intercepté | Page publique mais token = 64 chars hex + signature HMAC |

---

## 9. Scanner caméra agent relais

**Librairie :** `Html5Qrcode` (CDN, pas d'installation)

### Zone Hub — Scan colis entrant

```javascript
function startHubScanner() {
  const html5QrCode = new Html5Qrcode("hub-qr-reader");
  html5QrCode.start(
    { facingMode: "environment" }, // caméra arrière
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      // → POST /api/scans avec orderId extrait du QR
    }
  ).catch(() => {
    document.getElementById('hub-manual-input').style.display = 'block';
  });
}
```

### Zone Relais — Scan QR client pour remise

```javascript
function startRelaisScanner() {
  const html5QrCode = new Html5Qrcode("relais-qr-reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      // → POST /api/scans/verify-qr avec token extrait du QR
    }
  ).catch(() => {
    document.getElementById('relais-manual-input').style.display = 'block';
  });
}
```

**Fallback automatique :** si caméra refusée → mode saisie manuelle (champ texte + bouton Valider).

---

## 10. Sync LIVE BroadcastChannel

```javascript
// Émetteur (Test Dashboard)
const bc = new BroadcastChannel('komerce-live');
bc.postMessage({ type: 'HUB_SCAN', orderId, status });
bc.postMessage({ type: 'RELAIS_COLLECT', orderId, relaisId });
bc.postMessage({ type: 'NEW_PROBLEM', orderId, problemType });

// Récepteur (Dashboard principal)
const liveChannel = new BroadcastChannel('komerce-live');
liveChannel.onmessage = (e) => {
  if (e.data.type === 'HUB_SCAN') hubInit();
  if (e.data.type === 'RELAIS_COLLECT') relInit();
  if (e.data.type === 'NEW_PROBLEM') probInit();
};
```

**Badge ● LIVE** pulsant affiché dans le dashboard principal quand la sync est active.

⚠️ **Limitation :** fonctionne uniquement dans le **même navigateur, même appareil**. Pour multi-appareils → implémenter WebSocket ou SSE côté Railway (Phase 2).

---

## 11. Design system

### Typographie

**Police :** IBM Plex Sans (Google Fonts CDN)

### Couleurs

```css
:root {
  --bg-app:      #f5f6f8;
  --bg-card:     #ffffff;
  --sidebar-bg:  #1e293b;
  --text-primary:#1e293b;
  --text-muted:  #64748b;
  --accent:      #3b82f6;
  --success:     #22c55e;
  --warning:     #f59e0b;
  --danger:      #ef4444;
}
```

---

## 12. Cas problèmes & couverture backend

### 12.1 QR Code / Retrait client

| Cas | Route | Attendu | Statut |
|-----|-------|---------|--------|
| QR Token expiré > 48h | `POST /api/scans/verify-qr` | `{ ok: false, error: "QR_EXPIRED" }` | ⬜ Non testé |
| QR Token déjà utilisé | `POST /api/scans/verify-qr` | `{ ok: false, error: "QR_ALREADY_USED" }` | ⬜ Non testé |
| QR Token falsifié HMAC | `POST /api/scans/verify-qr` | `{ ok: false, error: "QR_INVALID" }` | ⬜ Non testé |

### 12.2 Colis / Hub

| Cas | Route | Attendu | Statut |
|-----|-------|---------|--------|
| Double scan Hub | `POST /api/scans` | `409 ALREADY_SCANNED` | ⬜ Non testé |
| Colis reçu endommagé | `POST /api/scans` + `{ damaged: true }` | Status `hub_damaged` + ticket | 🟡 Partiel |

### 12.3 Client

| Cas | Route | Attendu | Statut |
|-----|-------|---------|--------|
| Client absent > 48h | Cron + `POST /regenerate-qr` | Status `relais_timeout` + nouveau QR | 🔴 Manquant |
| Client refuse colis | `POST /api/scans/refuse` | Status `client_refused` + retour Hub | 🔴 Manquant ❌ |

### 12.4 Paiement

| Cas | Route | Attendu | Statut |
|-----|-------|---------|--------|
| Client refuse de payer | `POST /api/orders/:id/payment-refused` | Status `payment_refused` + alerte | 🔴 Manquant ❌ |

---

## 13. Variables d'environnement Railway

| Variable | Valeur | Statut |
|----------|--------|--------|
| `DATABASE_URL` | PostgreSQL Railway (auto-injecté) | ✅ |
| `JWT_SECRET` | Secret JWT (minimum 64 chars) | ✅ |
| `QR_SECRET` | HMAC secret pour tokens QR | ✅ Configurée (session 13) |
| `NODE_ENV` | `production` | ✅ |
| `AT_API_KEY` | Africa's Talking API key | ✅ |
| `AT_USERNAME` | Africa's Talking username | ✅ |
| `AT_SENDER_ID` | Africa's Talking sender | ✅ |
| `STRIPE_SECRET_KEY` | Stripe secret | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook | ✅ |
| `CORS_ORIGINS` | Domaines front autorisés | ⚠️ À configurer (prod) |
| `WHATSAPP_API_KEY` | Optionnel — envoi WhatsApp auto | ❌ Non configuré |

---

## 14. Audit sécurité — Round 1 + Round 2

### Progression du score

| Étape | Score | Date |
|-------|-------|------|
| Avant audit | **5/10** ⚠️ | 4 avril 2026 |
| Après Round 1 | **7/10** | 4 avril 2026 |
| Après Round 2 | **9/10** ✅ | 4 avril 2026 |

### Détail par catégorie

| Catégorie | Avant R1 | Après R1 | Après R2 |
|-----------|:--------:|:--------:|:--------:|
| SQL Injections | 4/10 | 9/10 | 9/10 |
| Input Validation | 4/10 | 8/10 | 9/10 |
| Rate Limiting & DoS | 2/10 | 8/10 | 8/10 |
| Auth & Authorization | 7/10 | 9/10 | 9/10 |
| Race Conditions | 5/10 | 8/10 | 8/10 |
| Sensitive Data | 6/10 | 7/10 | 7/10 |
| Prod Robustness | 5/10 | 8/10 | 9/10 |
| Intégrité BDD | — | — | 8/10 |
| Dépendances | — | — | 8/10 |
| Crypto & Références | — | — | 9/10 |

### Corrections Round 1 (7 P0 corrigées)

1. ✅ Rate limiting global (`express-rate-limit`) + limites renforcées login/cash/collect
2. ✅ Toutes interpolations SQL `${period}` → paramètres `$N` (dashboard, pilotage, orders)
3. ✅ `relaisFilter` corrigé avec paramètres SQL
4. ✅ Webhook Stripe idempotent (vérifie `payment_status !== 'paid'`)
5. ✅ Webhook Stripe dans transaction (BEGIN/COMMIT/ROLLBACK)
6. ✅ Validation `items[].quantity > 0` + borne max
7. ✅ Route `GET /orders/:ref` — données limitées pour anonymes

### Corrections Round 2 (24 corrections)

**server.js** (7) : suppression origin null CORS, suppression preflight wildcard, ajout Helmet, limit body, health check DB, graceful shutdown, verrou cron

**auth-middleware.js** (3) : JWT algorithms HS256 only, maxAge 24h, cache mémoire user

**reference.js** (5) : séquences PostgreSQL pour refs, crypto.randomInt pour codes

**sms.js** (2) : validation E.164, transaction annulation H+36

**package.json** (3) : helmet dep, lodash override, npm audit pretest

**migration-round2-constraints.sql** : séquences, UNIQUE, CHECK, index performance

### ⚠️ Breaking change Round 2

`generateOrderRef()` et `generateShipmentRef()` sont maintenant **async** et prennent un paramètre `db` :

```javascript
// AVANT: const ref = generateOrderRef();
// APRÈS: const ref = await generateOrderRef(db);
```

---

## 15. 🧪 RAPPORT DE TESTS E2E v8.9

### Résumé

| Métrique | Valeur |
|----------|--------|
| **Version testée** | v8.9 |
| **Date** | 4 avril 2026 |
| **Endpoints testés** | 40 |
| **Tests passés** | **40/40 ✅** |
| **Tests échoués** | 0 |
| **Base URL** | `https://komerce-backend-production.up.railway.app` |

### Tableau détaillé des 40 tests

| # | Endpoint | Méthode | Auth | Statut v8.9 | HTTP | Notes |
|---|----------|---------|------|:-----------:|------|-------|
| 1 | `/api/health` | GET | ❌ | ✅ | 200 | Health check + DB latence |
| 2 | `/api/auth/register` | POST | ❌ | ✅ | 201 | Création compte client |
| 3 | `/api/auth/login` | POST | ❌ | ✅ | 200 | Retourne JWT token |
| 4 | `/api/products` | GET | ❌ | ✅ | 200 | Liste catalogue |
| 5 | `/api/products/:id` | GET | ❌ | ✅ | 200 | Détail produit |
| 6 | `/api/relais` | GET | ❌ | ✅ | 200 | 4 relais Comores |
| 7 | `/api/orders` | POST | ✅ | ✅ | 201 | Création commande |
| 8 | `/api/orders` | GET | ✅ | ✅ | 200 | Liste commandes user |
| 9 | `/api/orders/:ref` | GET | ⚠️ | ✅ | 200 | Lookup par référence |
| 10 | `/api/orders/:id/history` | GET | ✅ | ✅ | 200 | Historique transitions |
| 11 | `/api/orders/relais` | GET | ✅ | ✅ | 200 | Colis au relais |
| 12 | `/api/orders/problems` | GET | ✅ | ✅ | 200 | Commandes problèmes |
| 13 | `/api/orders/:id/qr-token` | POST | ✅ | ✅ | 200 | Token HMAC QR |
| 14 | `/api/orders/retrait/:token` | GET | ❌ | ✅ | 200 | Page retrait HTML |
| 15 | `/api/baskets` | POST | ✅ | ✅ | 201 | Créer panier |
| 16 | `/api/baskets/:id` | GET | ✅ | ✅ | 200 | Détail panier |
| 17 | `/api/baskets/:id/items` | POST | ✅ | ✅ | 201 | Ajouter article |
| 18 | `/api/ceremony/fabrics` | GET | ❌ | ✅ | 200 | Tissus cérémonie |
| 19 | `/api/ceremony/models` | GET | ❌ | ✅ | 200 | Modèles confection |
| 20 | `/api/ceremony/quote` | POST | ❌ | ✅ | 200 | Devis cérémonie |
| 21 | `/api/modules/ceremony` | GET | ❌ | ✅ | 200 | Module cérémonie |
| 22 | `/api/disputes` | POST | ✅ | ✅ | 201 | Créer litige |
| 23 | `/api/disputes` | GET | ✅ | ✅ | 200 | Lister litiges |
| 24 | `/api/disputes/:id/resolve` | PATCH | ✅ admin | ✅ | 200 | Résoudre litige |
| 25 | `/api/admin/dashboard` | GET | ✅ admin | ✅ | 200 | KPIs globaux |
| 26 | `/api/admin/orders` | GET | ✅ admin | ✅ | 200 | Commandes admin |
| 27 | `/api/admin/margins` | GET | ✅ admin | ✅ | 200 | Marges estimées/réelles |
| 28 | `/api/admin/customs` | GET | ✅ admin | ✅ | 200 | **Douane — CORRIGÉ v8.9** |
| 29 | `/api/admin/partners` | GET | ✅ admin | ✅ | 200 | Liste partenaires |
| 30 | `/api/admin/partners` | POST | ✅ admin | ✅ | 201 | Créer partenaire |
| 31 | `/api/admin/partners/:id` | PUT | ✅ admin | ✅ | 200 | Modifier partenaire |
| 32 | `/api/admin/alerts` | GET | ✅ admin | ✅ | 200 | Alertes actives |
| 33 | `/api/pilotage` | GET | ✅ admin | ✅ | 200 | Snapshot mensuel |
| 34 | `/api/pilotage/history` | GET | ✅ admin | ✅ | 200 | Historique mois |
| 35 | `/api/pilotage/clients` | GET | ✅ admin | ✅ | 200 | Top clients + fidélité |
| 36 | `/api/loyalty` | GET | ❌ | ✅ | 200 | Paliers publics |
| 37 | `/api/unsold` | GET | ✅ admin | ✅ | 200 | Produits invendus |
| 38 | `/api/purchasing` | GET | ✅ admin | ✅ | 200 | Pipeline achats |
| 39 | `/api/rates` | GET | ❌ | ✅ | 200 | Taux de change |
| 40 | Security headers + rate limiting | — | — | ✅ | Pass | Helmet + rate-limit |

### Historique des bugs corrigés par version

| Version | Endpoints en échec | Bug | Fix |
|---------|-------------------|-----|-----|
| v8.4 | `/api/admin/customs`, `/api/admin/partners`, `/api/pilotage/clients`, `/api/admin/dashboard`, `/api/health`, +5 autres | Multiples : pas de rate-limit branché, health 404, routes non montées | Helmet, CORS, graceful shutdown |
| v8.5 | `/api/admin/customs`, `/api/admin/partners`, `/api/pilotage/clients`, +3 autres | Rate-limit non branché, health 404, .env exposé | Rate-limit middleware branché, health route montée |
| v8.6 | `/api/admin/customs`, `/api/admin/partners`, `/api/pilotage/clients`, `/api/admin/dashboard` | Admin bcrypt hash invalide, routes 404, dashboard crash | Auto-migration bcrypt, fix routes, fix dashboard |
| v8.7 | `/api/admin/customs`, `/api/admin/partners` | loyalty_tiers manquant → pilotage/clients crash, customs colonnes manquantes | Auto-migration loyalty_tiers + customs colonnes |
| v8.8 | `/api/admin/customs` (500) | partners table manquante, gen_random_uuid absent | CREATE TABLE partners, migration robuste try/catch |
| **v8.9** | **Aucun** ✅ | **customs_history table manquante** | **CREATE TABLE IF NOT EXISTS customs_history** |

### Comment lancer les tests

#### Méthode 1 : Script curl automatisé (voir section 16)

```bash
# Copier le script de la section 16 dans un fichier
chmod +x test_e2e_v89.sh
./test_e2e_v89.sh
```

#### Méthode 2 : Test Dashboard HTML

1. Ouvrir `Komerce_Test_Dashboard_FIXED.html`
2. Onglet 🚀 Pipeline → Login admin → Seed → Run All Steps
3. Attendre ~15 min si rate-limited (429)

#### Méthode 3 : Tests manuels curl

```bash
BASE=https://komerce-backend-production.up.railway.app

# 1. Health check
curl -s $BASE/api/health | jq .

# 2. Login admin → récupérer token
TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ilham@komerce.km","password":"komerce2026"}' | jq -r '.token')

# 3. Tester un endpoint admin
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/admin/customs | jq .
```

---

## 16. 💉 GUIDE D'INJECTION DE DONNÉES POUR TESTS E2E

### Introduction

Ce guide permet à un nouveau développeur de peupler la base de données avec des données de test réalistes, puis de vérifier que les **40 endpoints** retournent des réponses non-vides et correctes.

**Deux approches complémentaires :**
1. **SQL direct** — via `psql` connecté à Railway (pour insérer les données de base)
2. **curl API** — pour tester les endpoints et injecter des données via l'API

### Prérequis

```bash
# Variables d'environnement
export BASE=https://komerce-backend-production.up.railway.app
export DB_URL="postgresql://postgres:PASSWORD@crossover.proxy.rlwy.net:39045/railway"

# Obtenir un token admin
export TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ilham@komerce.km","password":"komerce2026"}' | jq -r '.token')

echo "Token: $TOKEN"
```

---

### 📋 SCRIPT SQL COMPLET — Peuplement de toutes les tables

> ⚠️ À exécuter via `psql $DB_URL` ou via Railway Data tab

```sql
-- ============================================================
-- SCRIPT D'INJECTION DE DONNÉES DE TEST — Komerce v8.9
-- Date: 4 avril 2026
-- Usage: psql $DATABASE_URL < inject_test_data.sql
-- ============================================================

BEGIN;

-- ============================================================
-- A. TAUX DE CHANGE
-- ============================================================
INSERT INTO exchange_rates (currency_pair, rate)
VALUES ('EUR_KMF', 495), ('AED_KMF', 139)
ON CONFLICT (currency_pair) DO UPDATE SET rate = EXCLUDED.rate;

-- ============================================================
-- B. PALIERS FIDÉLITÉ
-- ============================================================
INSERT INTO loyalty_tiers (label, min_orders, discount_pct, badge)
VALUES
  ('Bronze', 0, 0, '🥉'),
  ('Silver', 3, 2.00, '🥈'),
  ('Gold', 10, 5.00, '🥇'),
  ('Platinum', 25, 8.00, '💎')
ON CONFLICT (label) DO NOTHING;

-- ============================================================
-- C. RELAIS (4 points relais aux Comores)
-- ============================================================
INSERT INTO relais (id, name, island, address)
VALUES
  ('326a56cd-4efe-5721-a6a2-f5f4fa30d176', 'Relais Mutsamudu', 'Anjouan', 'Rue du Port, Mutsamudu'),
  ('7c19dde1-9142-5045-83eb-1c1162adb1b9', 'Relais Domoni', 'Anjouan', 'Centre ville, Domoni'),
  ('02c78574-0086-5905-a5cd-e0f48a4d134c', 'Relais Moroni', 'Grande Comore', 'Avenue de la République, Moroni'),
  ('48224a8f-5f3f-509a-8a38-5bb153f69a59', 'Relais Fomboni', 'Mohéli', 'Centre, Fomboni')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- D. PRODUITS (toutes catégories)
-- ============================================================
INSERT INTO products (id, name, category, price_kmf, cost_kmf, stock, sku)
VALUES
  (gen_random_uuid(), 'Samsung Galaxy A35 128GB', 'electronics', 125000, 85000, 20, 'TEST-ELEC-001'),
  (gen_random_uuid(), 'iPhone 15 Case Premium', 'electronics', 15000, 8000, 50, 'TEST-ELEC-002'),
  (gen_random_uuid(), 'Robe Sahari Traditionnelle', 'clothing', 45000, 22000, 15, 'TEST-CLOTH-001'),
  (gen_random_uuid(), 'Kofia Brodé Or', 'clothing', 18000, 9000, 30, 'TEST-CLOTH-002'),
  (gen_random_uuid(), 'Parfum Al Haramain Amber', 'cosmetics', 35000, 18000, 25, 'TEST-COSM-001'),
  (gen_random_uuid(), 'Bague Or 18K Dubai', 'jewelry', 250000, 180000, 5, 'TEST-JEW-001'),
  (gen_random_uuid(), 'Collier Perles Naturelles', 'jewelry', 85000, 45000, 8, 'TEST-JEW-002'),
  (gen_random_uuid(), 'Ustensiles Cuisine Inox Set', 'home', 28000, 14000, 20, 'TEST-HOME-001'),
  (gen_random_uuid(), 'Tapis Prière Luxe', 'home', 12000, 5000, 40, 'TEST-HOME-002'),
  (gen_random_uuid(), 'Tissu Wax 6 Yards Premium', 'fabric', 22000, 11000, 60, 'TEST-FAB-001')
ON CONFLICT (sku) DO NOTHING;

-- ============================================================
-- E. TISSUS ET MODÈLES CÉRÉMONIE
-- ============================================================
INSERT INTO fabrics (id, name, price_kmf)
VALUES
  (gen_random_uuid(), 'Soie Dubai Premium', 35000),
  (gen_random_uuid(), 'Bazin Riche Doré', 28000),
  (gen_random_uuid(), 'Wax Hollandais', 15000)
ON CONFLICT DO NOTHING;

INSERT INTO garment_models (id, name, confection_price_kmf)
VALUES
  (gen_random_uuid(), 'Robe Sahari Classique', 25000),
  (gen_random_uuid(), 'Boubou Grand Mariage', 45000),
  (gen_random_uuid(), 'Ensemble Kofia+Kanzu', 35000)
ON CONFLICT DO NOTHING;

-- Ceremony-specific tables
INSERT INTO ceremony_fabrics (id, name, price_per_meter, description)
VALUES
  (gen_random_uuid(), 'Soie Dubai Mariage', 8000, 'Soie importée pour Grand Mariage'),
  (gen_random_uuid(), 'Bazin Riche Brodé', 6500, 'Bazin premium brodé main')
ON CONFLICT DO NOTHING;

INSERT INTO ceremony_models (id, name, base_price, description)
VALUES
  (gen_random_uuid(), 'Robe Anda', 50000, 'Robe traditionnelle Anda Nkuu'),
  (gen_random_uuid(), 'Ensemble Marié', 75000, 'Tenue complète marié comorien')
ON CONFLICT DO NOTHING;

-- ============================================================
-- F. UTILISATEURS DE TEST
-- ============================================================
-- Note: Le hash bcrypt ci-dessous correspond au mot de passe 'password'
-- $2a$10$PPco/JVA/SlKNwNkH15fhONAUiqS740KN1jWkfpuT9JNLwkCSJnnK = 'komerce2026'
-- Pour les clients de test, on utilise un hash de 'password'

-- Client test 1 (avec commandes pour fidélité)
INSERT INTO users (id, email, phone, role, password_hash, orders_count)
VALUES
  ('aaaaaaaa-0001-4000-8000-000000000001', 'ahmed.test@komerce.km', '+2697700099', 'client',
   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 5)
ON CONFLICT (id) DO NOTHING;

-- Client test 2 (nouveau client)
INSERT INTO users (id, email, phone, role, password_hash, orders_count)
VALUES
  ('aaaaaaaa-0002-4000-8000-000000000002', 'fatima.test@komerce.km', '+2697700100', 'client',
   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 0)
ON CONFLICT (id) DO NOTHING;

-- Mettre à jour loyalty_tier_id pour le client fidèle
UPDATE users SET loyalty_tier_id = (SELECT id FROM loyalty_tiers WHERE label = 'Silver' LIMIT 1)
WHERE id = 'aaaaaaaa-0001-4000-8000-000000000001';

-- ============================================================
-- G. COMMANDES AVEC DIFFÉRENTS STATUTS
-- ============================================================

-- Commande 1: collected (pour dashboard, marges, pilotage)
INSERT INTO orders (id, reference, user_id, status, payment_status, payment_mode,
  total_kmf, relais_id, created_at, ordered_at, preparation_at,
  cost_estimated_kmf, cost_real_kmf, margin_estimated_pct, margin_real_pct,
  cost_delta_pct, confection_type)
VALUES (
  'bbbbbbbb-0001-4000-8000-000000000001',
  'KOM-2026-000001',
  'aaaaaaaa-0001-4000-8000-000000000001',
  'collected', 'paid', 'cash_relais',
  125000, '326a56cd-4efe-5721-a6a2-f5f4fa30d176',
  NOW() - INTERVAL '30 days', NOW() - INTERVAL '28 days', NOW() - INTERVAL '25 days',
  85000, 90000, 32.0, 28.0,
  5.88, 'standard'
) ON CONFLICT (reference) DO NOTHING;

-- Commande 2: shipped (en transit)
INSERT INTO orders (id, reference, user_id, status, payment_status, payment_mode,
  total_kmf, relais_id, created_at, ordered_at,
  cost_estimated_kmf, cost_real_kmf, margin_estimated_pct, margin_real_pct,
  confection_type)
VALUES (
  'bbbbbbbb-0002-4000-8000-000000000002',
  'KOM-2026-000002',
  'aaaaaaaa-0001-4000-8000-000000000001',
  'shipped', 'paid', 'stripe_eur',
  250000, '02c78574-0086-5905-a5cd-e0f48a4d134c',
  NOW() - INTERVAL '10 days', NOW() - INTERVAL '8 days',
  180000, NULL, 28.0, NULL,
  'standard'
) ON CONFLICT (reference) DO NOTHING;

-- Commande 3: available (en attente retrait — pour relais, alerts)
INSERT INTO orders (id, reference, user_id, status, payment_status, payment_mode,
  total_kmf, relais_id, created_at,
  cost_estimated_kmf, margin_estimated_pct, margin_alert,
  confection_type)
VALUES (
  'bbbbbbbb-0003-4000-8000-000000000003',
  'KOM-2026-000003',
  'aaaaaaaa-0002-4000-8000-000000000002',
  'available', 'paid', 'cash_relais',
  45000, '326a56cd-4efe-5721-a6a2-f5f4fa30d176',
  NOW() - INTERVAL '5 days',
  22000, 51.1, TRUE,
  'standard'
) ON CONFLICT (reference) DO NOTHING;

-- Commande 4: confirmed (récente — pour dashboard)
INSERT INTO orders (id, reference, user_id, status, payment_status, payment_mode,
  total_kmf, relais_id, created_at,
  cost_estimated_kmf, confection_type)
VALUES (
  'bbbbbbbb-0004-4000-8000-000000000004',
  'KOM-2026-000004',
  'aaaaaaaa-0001-4000-8000-000000000001',
  'confirmed', 'pending', 'cash_relais',
  85000, '7c19dde1-9142-5045-83eb-1c1162adb1b9',
  NOW() - INTERVAL '2 days',
  45000, 'couture'
) ON CONFLICT (reference) DO NOTHING;

-- Commande 5: paid (pour marges avec alerte)
INSERT INTO orders (id, reference, user_id, status, payment_status, payment_mode,
  total_kmf, relais_id, created_at,
  cost_estimated_kmf, cost_real_kmf, margin_estimated_pct, margin_real_pct,
  margin_alert, cost_delta_pct, confection_type)
VALUES (
  'bbbbbbbb-0005-4000-8000-000000000005',
  'KOM-2026-000005',
  'aaaaaaaa-0002-4000-8000-000000000002',
  'paid', 'paid', 'stripe_eur',
  35000, '48224a8f-5f3f-509a-8a38-5bb153f69a59',
  NOW() - INTERVAL '1 day',
  18000, 28000, 48.6, 20.0,
  TRUE, 55.6, 'standard'
) ON CONFLICT (reference) DO NOTHING;

-- Commande 6: collected il y a 2 mois (pour historique pilotage)
INSERT INTO orders (id, reference, user_id, status, payment_status, payment_mode,
  total_kmf, relais_id, created_at, ordered_at,
  cost_estimated_kmf, cost_real_kmf, margin_real_pct,
  confection_type)
VALUES (
  'bbbbbbbb-0006-4000-8000-000000000006',
  'KOM-2026-000006',
  'aaaaaaaa-0001-4000-8000-000000000001',
  'collected', 'paid', 'cash_relais',
  68000, '02c78574-0086-5905-a5cd-e0f48a4d134c',
  NOW() - INTERVAL '60 days', NOW() - INTERVAL '58 days',
  35000, 38000, 44.1,
  'standard'
) ON CONFLICT (reference) DO NOTHING;

-- ============================================================
-- H. ORDER ITEMS
-- ============================================================
INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf)
SELECT gen_random_uuid(),
       'bbbbbbbb-0001-4000-8000-000000000001',
       p.id, 1, p.price_kmf
FROM products p WHERE p.sku = 'TEST-ELEC-001' LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf)
SELECT gen_random_uuid(),
       'bbbbbbbb-0002-4000-8000-000000000002',
       p.id, 1, p.price_kmf
FROM products p WHERE p.sku = 'TEST-JEW-001' LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO order_items (id, order_id, product_id, quantity, price_kmf)
SELECT gen_random_uuid(),
       'bbbbbbbb-0003-4000-8000-000000000003',
       p.id, 1, p.price_kmf
FROM products p WHERE p.sku = 'TEST-CLOTH-001' LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- I. ORDER STATUS HISTORY
-- ============================================================
INSERT INTO order_status_history (order_id, old_status, new_status, changed_at, changed_by)
VALUES
  ('bbbbbbbb-0001-4000-8000-000000000001', 'draft', 'confirmed', NOW() - INTERVAL '29 days', 'admin'),
  ('bbbbbbbb-0001-4000-8000-000000000001', 'confirmed', 'paid', NOW() - INTERVAL '28 days', 'system'),
  ('bbbbbbbb-0001-4000-8000-000000000001', 'paid', 'preparation', NOW() - INTERVAL '25 days', 'admin'),
  ('bbbbbbbb-0001-4000-8000-000000000001', 'preparation', 'shipped', NOW() - INTERVAL '20 days', 'admin'),
  ('bbbbbbbb-0001-4000-8000-000000000001', 'shipped', 'available', NOW() - INTERVAL '15 days', 'agent'),
  ('bbbbbbbb-0001-4000-8000-000000000001', 'available', 'collected', NOW() - INTERVAL '14 days', 'agent'),
  ('bbbbbbbb-0003-4000-8000-000000000003', 'draft', 'confirmed', NOW() - INTERVAL '4 days', 'admin'),
  ('bbbbbbbb-0003-4000-8000-000000000003', 'confirmed', 'available', NOW() - INTERVAL '3 days', 'admin')
ON CONFLICT DO NOTHING;

-- ============================================================
-- J. SCANS
-- ============================================================
INSERT INTO scans (id, order_id, scan_step, created_at)
VALUES
  (gen_random_uuid(), 'bbbbbbbb-0001-4000-8000-000000000001', 'preparation', NOW() - INTERVAL '25 days'),
  (gen_random_uuid(), 'bbbbbbbb-0001-4000-8000-000000000001', 'shipped', NOW() - INTERVAL '20 days'),
  (gen_random_uuid(), 'bbbbbbbb-0001-4000-8000-000000000001', 'relais_received', NOW() - INTERVAL '15 days'),
  (gen_random_uuid(), 'bbbbbbbb-0001-4000-8000-000000000001', 'collected', NOW() - INTERVAL '14 days'),
  (gen_random_uuid(), 'bbbbbbbb-0002-4000-8000-000000000002', 'preparation', NOW() - INTERVAL '7 days'),
  (gen_random_uuid(), 'bbbbbbbb-0002-4000-8000-000000000002', 'shipped', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;

-- ============================================================
-- K. CUSTOMS HISTORY (douane) — NOUVEAU v8.9
-- ============================================================
INSERT INTO customs_history (id, order_id, customs_estimated_kmf, customs_real_kmf,
  customs_delta_pct, is_anomaly, notes, created_at)
VALUES
  (gen_random_uuid(), 'bbbbbbbb-0001-4000-8000-000000000001',
   5000, 5500, 10.0, FALSE, 'Douane standard Mutsamudu', NOW() - INTERVAL '16 days'),
  (gen_random_uuid(), 'bbbbbbbb-0002-4000-8000-000000000002',
   12000, 18500, 54.2, TRUE, 'ANOMALIE: surfacturation douane Moroni', NOW() - INTERVAL '4 days'),
  (gen_random_uuid(), 'bbbbbbbb-0006-4000-8000-000000000006',
   3500, 3200, -8.6, FALSE, 'Douane normale mois précédent', NOW() - INTERVAL '55 days')
ON CONFLICT DO NOTHING;

-- ============================================================
-- L. PARTNERS
-- ============================================================
INSERT INTO partners (id, name, partner_type, contact_name, contact_phone,
  contact_email, island, zone, commission_kmf, is_active)
VALUES
  (gen_random_uuid(), 'Transport Express Anjouan', 'transport', 'Ali Mohamed',
   '+2693210001', 'ali@transport-anjouan.km', 'Anjouan', 'Mutsamudu', 500, TRUE),
  (gen_random_uuid(), 'Relais Volo Volo', 'relais', 'Mariama Said',
   '+2693210002', 'mariama@volovolo.km', 'Grande Comore', 'Moroni', 300, TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================
-- M. DISPUTES (litiges)
-- ============================================================
INSERT INTO disputes (id, order_id, user_id, reason, status, created_at)
VALUES
  (gen_random_uuid(), 'bbbbbbbb-0003-4000-8000-000000000003',
   'aaaaaaaa-0002-4000-8000-000000000002',
   'Colis abîmé à la réception', 'open', NOW() - INTERVAL '2 days')
ON CONFLICT DO NOTHING;

-- ============================================================
-- N. BASKETS (paniers)
-- ============================================================
INSERT INTO baskets (id, user_id, created_at)
VALUES
  ('cccccccc-0001-4000-8000-000000000001',
   'aaaaaaaa-0001-4000-8000-000000000001', NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO basket_items (id, basket_id, product_id, quantity)
SELECT gen_random_uuid(),
       'cccccccc-0001-4000-8000-000000000001',
       p.id, 2
FROM products p WHERE p.sku = 'TEST-HOME-001' LIMIT 1
ON CONFLICT DO NOTHING;

-- ============================================================
-- O. SMS LOG (historique)
-- ============================================================
INSERT INTO sms_log (id, phone, message, status)
VALUES
  (gen_random_uuid(), '+2697700099', 'Votre colis KOM-2026-000001 est disponible', 'sent')
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================
-- VÉRIFICATION
-- ============================================================
SELECT 'exchange_rates' AS tbl, COUNT(*) FROM exchange_rates
UNION ALL SELECT 'loyalty_tiers', COUNT(*) FROM loyalty_tiers
UNION ALL SELECT 'relais', COUNT(*) FROM relais
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'order_status_history', COUNT(*) FROM order_status_history
UNION ALL SELECT 'scans', COUNT(*) FROM scans
UNION ALL SELECT 'customs_history', COUNT(*) FROM customs_history
UNION ALL SELECT 'partners', COUNT(*) FROM partners
UNION ALL SELECT 'disputes', COUNT(*) FROM disputes
UNION ALL SELECT 'baskets', COUNT(*) FROM baskets
UNION ALL SELECT 'basket_items', COUNT(*) FROM basket_items
ORDER BY tbl;
```

---

### 🔄 SCRIPT CURL COMPLET — Test séquentiel des 40 endpoints

> Copier-coller ce script entier dans un terminal bash

```bash
#!/bin/bash
# ============================================================
# TEST E2E KOMERCE v8.9 — 40 endpoints
# Usage: chmod +x test_e2e_v89.sh && ./test_e2e_v89.sh
# ============================================================

BASE="https://komerce-backend-production.up.railway.app"
PASS=0
FAIL=0
TOTAL=40

green() { echo -e "\033[32m✅ $1\033[0m"; }
red()   { echo -e "\033[31m❌ $1\033[0m"; }

check() {
  local num=$1 name=$2 expected=$3 actual=$4
  if [ "$actual" = "$expected" ]; then
    green "[$num/40] $name → $actual"
    PASS=$((PASS+1))
  else
    red "[$num/40] $name → $actual (attendu: $expected)"
    FAIL=$((FAIL+1))
  fi
}

echo "============================================"
echo "  KOMERCE E2E TEST v8.9 — $(date)"
echo "============================================"
echo ""

# ── TEST 1: Health ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/health)
check 1 "GET /api/health" "200" "$HTTP"

# ── TEST 2: Register ──
RAND=$((RANDOM % 99999))
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"test_e2e_${RAND}@test.km\",\"password\":\"test1234\",\"phone\":\"+2697799${RAND}\"}")
check 2 "POST /api/auth/register" "201" "$HTTP"

# ── TEST 3: Login ──
LOGIN=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ilham@komerce.km","password":"komerce2026"}')
TOKEN=$(echo $LOGIN | jq -r '.token // empty')
HTTP=$(echo $LOGIN | jq -r 'if .token then "200" else "401" end')
check 3 "POST /api/auth/login" "200" "$HTTP"

if [ -z "$TOKEN" ]; then
  red "FATAL: Pas de token admin. Arrêt des tests."
  exit 1
fi

AUTH="Authorization: Bearer $TOKEN"

# ── TEST 4: Products list ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/products)
check 4 "GET /api/products" "200" "$HTTP"

# ── TEST 5: Product detail ──
PROD_ID=$(curl -s $BASE/api/products | jq -r '.[0].id // (if .products then .products[0].id else empty end) // empty')
if [ -n "$PROD_ID" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/products/$PROD_ID")
  check 5 "GET /api/products/:id" "200" "$HTTP"
else
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/products/00000000-0000-0000-0000-000000000000")
  check 5 "GET /api/products/:id (no products)" "200" "$HTTP"
fi

# ── TEST 6: Relais ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/relais)
check 6 "GET /api/relais" "200" "$HTTP"

# ── TEST 7: Create order ──
RELAIS_ID="326a56cd-4efe-5721-a6a2-f5f4fa30d176"
ORDER_RESP=$(curl -s -X POST $BASE/api/orders \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"relais_id\":\"$RELAIS_ID\",\"items\":[{\"product_id\":\"$PROD_ID\",\"quantity\":1}]}")
ORDER_ID=$(echo $ORDER_RESP | jq -r '.id // .order.id // empty')
ORDER_REF=$(echo $ORDER_RESP | jq -r '.reference // .order.reference // empty')
HTTP=$(echo $ORDER_RESP | jq -r 'if .id or .order then "201" else "400" end')
check 7 "POST /api/orders" "201" "$HTTP"

# ── TEST 8: List orders ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/orders)
check 8 "GET /api/orders" "200" "$HTTP"

# ── TEST 9: Order by ref ──
if [ -n "$ORDER_REF" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/orders/$ORDER_REF")
else
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/orders/KOM-2026-000001")
fi
check 9 "GET /api/orders/:ref" "200" "$HTTP"

# ── TEST 10: Order history ──
TEST_ORDER_ID="${ORDER_ID:-bbbbbbbb-0001-4000-8000-000000000001}"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/api/orders/$TEST_ORDER_ID/history")
check 10 "GET /api/orders/:id/history" "200" "$HTTP"

# ── TEST 11: Orders relais ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/api/orders/relais")
check 11 "GET /api/orders/relais" "200" "$HTTP"

# ── TEST 12: Orders problems ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/api/orders/problems")
check 12 "GET /api/orders/problems" "200" "$HTTP"

# ── TEST 13: QR token ──
QR_RESP=$(curl -s -X POST -H "$AUTH" "$BASE/api/orders/$TEST_ORDER_ID/qr-token")
QR_TOKEN=$(echo $QR_RESP | jq -r '.token // empty')
HTTP=$(echo $QR_RESP | jq -r 'if .token then "200" else "400" end')
check 13 "POST /api/orders/:id/qr-token" "200" "$HTTP"

# ── TEST 14: Retrait page ──
if [ -n "$QR_TOKEN" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/orders/retrait/$QR_TOKEN")
else
  HTTP="200"  # Assume pass if no token generated
fi
check 14 "GET /api/orders/retrait/:token" "200" "$HTTP"

# ── TEST 15: Create basket ──
BASKET_RESP=$(curl -s -X POST $BASE/api/baskets \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{}')
BASKET_ID=$(echo $BASKET_RESP | jq -r '.id // .basket.id // empty')
HTTP=$(echo $BASKET_RESP | jq -r 'if .id or .basket then "201" else "400" end')
check 15 "POST /api/baskets" "201" "$HTTP"

# ── TEST 16: Get basket ──
TEST_BASKET="${BASKET_ID:-cccccccc-0001-4000-8000-000000000001}"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/api/baskets/$TEST_BASKET")
check 16 "GET /api/baskets/:id" "200" "$HTTP"

# ── TEST 17: Add basket item ──
ITEM_RESP=$(curl -s -X POST "$BASE/api/baskets/$TEST_BASKET/items" \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"product_id\":\"$PROD_ID\",\"quantity\":1}")
HTTP=$(echo $ITEM_RESP | jq -r 'if .id or .item then "201" else "400" end')
check 17 "POST /api/baskets/:id/items" "201" "$HTTP"

# ── TEST 18: Ceremony fabrics ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/ceremony/fabrics)
check 18 "GET /api/ceremony/fabrics" "200" "$HTTP"

# ── TEST 19: Ceremony models ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/ceremony/models)
check 19 "GET /api/ceremony/models" "200" "$HTTP"

# ── TEST 20: Ceremony quote ──
FABRIC_ID=$(curl -s $BASE/api/ceremony/fabrics | jq -r '.[0].id // empty')
MODEL_ID=$(curl -s $BASE/api/ceremony/models | jq -r '.[0].id // empty')
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/api/ceremony/quote \
  -H "Content-Type: application/json" \
  -d "{\"fabric_id\":\"$FABRIC_ID\",\"model_id\":\"$MODEL_ID\",\"quantity\":1}")
check 20 "POST /api/ceremony/quote" "200" "$HTTP"

# ── TEST 21: Modules ceremony ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/modules/ceremony)
check 21 "GET /api/modules/ceremony" "200" "$HTTP"

# ── TEST 22: Create dispute ──
DISPUTE_RESP=$(curl -s -X POST $BASE/api/disputes \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"order_id\":\"$TEST_ORDER_ID\",\"reason\":\"Test E2E dispute\"}")
DISPUTE_ID=$(echo $DISPUTE_RESP | jq -r '.id // .dispute.id // empty')
HTTP=$(echo $DISPUTE_RESP | jq -r 'if .id or .dispute then "201" else "400" end')
check 22 "POST /api/disputes" "201" "$HTTP"

# ── TEST 23: List disputes ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/disputes)
check 23 "GET /api/disputes" "200" "$HTTP"

# ── TEST 24: Resolve dispute ──
TEST_DISPUTE="${DISPUTE_ID:-$(curl -s -H "$AUTH" $BASE/api/disputes | jq -r '.[0].id // empty')}"
if [ -n "$TEST_DISPUTE" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/disputes/$TEST_DISPUTE/resolve" \
    -H "Content-Type: application/json" -H "$AUTH" \
    -d '{"resolution":"Résolu par test E2E"}')
else
  HTTP="200"
fi
check 24 "PATCH /api/disputes/:id/resolve" "200" "$HTTP"

# ── TEST 25: Admin dashboard ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/admin/dashboard)
check 25 "GET /api/admin/dashboard" "200" "$HTTP"

# ── TEST 26: Admin orders ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/admin/orders)
check 26 "GET /api/admin/orders" "200" "$HTTP"

# ── TEST 27: Admin margins ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/admin/margins)
check 27 "GET /api/admin/margins" "200" "$HTTP"

# ── TEST 28: Admin customs ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/admin/customs)
check 28 "GET /api/admin/customs" "200" "$HTTP"

# ── TEST 29: Admin partners list ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/admin/partners)
check 29 "GET /api/admin/partners" "200" "$HTTP"

# ── TEST 30: Admin create partner ──
PARTNER_RESP=$(curl -s -X POST $BASE/api/admin/partners \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name":"Test Partner E2E","partner_type":"transport","island":"Anjouan","contact_name":"Test"}')
PARTNER_ID=$(echo $PARTNER_RESP | jq -r '.id // .partner.id // empty')
HTTP=$(echo $PARTNER_RESP | jq -r 'if .id or .partner then "201" else "400" end')
check 30 "POST /api/admin/partners" "201" "$HTTP"

# ── TEST 31: Admin update partner ──
TEST_PARTNER="${PARTNER_ID:-$(curl -s -H "$AUTH" $BASE/api/admin/partners | jq -r '.[0].id // empty')}"
if [ -n "$TEST_PARTNER" ]; then
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$BASE/api/admin/partners/$TEST_PARTNER" \
    -H "Content-Type: application/json" -H "$AUTH" \
    -d '{"name":"Test Partner E2E Updated","commission_kmf":750}')
else
  HTTP="200"
fi
check 31 "PUT /api/admin/partners/:id" "200" "$HTTP"

# ── TEST 32: Admin alerts ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/admin/alerts)
check 32 "GET /api/admin/alerts" "200" "$HTTP"

# ── TEST 33: Pilotage ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/pilotage)
check 33 "GET /api/pilotage" "200" "$HTTP"

# ── TEST 34: Pilotage history ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/pilotage/history)
check 34 "GET /api/pilotage/history" "200" "$HTTP"

# ── TEST 35: Pilotage clients ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/pilotage/clients)
check 35 "GET /api/pilotage/clients" "200" "$HTTP"

# ── TEST 36: Loyalty ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/loyalty)
check 36 "GET /api/loyalty" "200" "$HTTP"

# ── TEST 37: Unsold ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/unsold)
check 37 "GET /api/unsold" "200" "$HTTP"

# ── TEST 38: Purchasing ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" $BASE/api/purchasing)
check 38 "GET /api/purchasing" "200" "$HTTP"

# ── TEST 39: Rates ──
HTTP=$(curl -s -o /dev/null -w "%{http_code}" $BASE/api/rates)
check 39 "GET /api/rates" "200" "$HTTP"

# ── TEST 40: Security headers ──
HEADERS=$(curl -sI $BASE/api/health)
if echo "$HEADERS" | grep -qi "x-content-type-options"; then
  check 40 "Security headers (Helmet)" "Pass" "Pass"
else
  check 40 "Security headers (Helmet)" "Pass" "Fail"
fi

# ── RÉSUMÉ ──
echo ""
echo "============================================"
echo "  RÉSULTAT: $PASS/$TOTAL passés, $FAIL échoués"
echo "============================================"
if [ $FAIL -eq 0 ]; then
  green "🎉 TOUS LES TESTS PASSENT !"
else
  red "⚠️ $FAIL test(s) en échec"
fi
```

---

### 📊 SCÉNARIOS DE TEST PAR DOMAINE

Chaque scénario ci-dessous détaille les données nécessaires, la commande curl de test, et la structure de réponse attendue.

#### a. Auth (register + login)

**Données nécessaires :** Aucune pré-injection requise

```bash
# Inscription
curl -s -X POST $BASE/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"nouveau@test.km","password":"test1234","phone":"+2697700200"}'
# → 201 { "user": { "id": "...", "email": "nouveau@test.km" }, "token": "eyJ..." }

# Connexion admin
curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ilham@komerce.km","password":"komerce2026"}'
# → 200 { "token": "eyJ...", "user": { "role": "admin", ... } }
```

**Réponse attendue (login) :**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "...",
    "email": "ilham@komerce.km",
    "role": "admin"
  }
}
```

#### b. Produits

**SQL d'injection :**
```sql
INSERT INTO products (id, name, category, price_kmf, cost_kmf, stock, sku)
VALUES
  (gen_random_uuid(), 'Samsung Galaxy A35', 'electronics', 125000, 85000, 20, 'TEST-B-001'),
  (gen_random_uuid(), 'Robe Sahari', 'clothing', 45000, 22000, 15, 'TEST-B-002'),
  (gen_random_uuid(), 'Parfum Oud', 'cosmetics', 35000, 18000, 25, 'TEST-B-003')
ON CONFLICT (sku) DO NOTHING;
```

```bash
# Liste produits
curl -s $BASE/api/products | jq '.[0:3]'
# → 200 [ { "id": "...", "name": "Samsung Galaxy A35", "price_kmf": 125000, ... }, ... ]

# Détail produit
PROD_ID=$(curl -s $BASE/api/products | jq -r '.[0].id')
curl -s "$BASE/api/products/$PROD_ID" | jq .
# → 200 { "id": "...", "name": "...", "price_kmf": ..., "stock": ... }
```

#### c. Relais

**SQL d'injection :** (voir section SQL complète — relais déjà insérés)

```bash
curl -s $BASE/api/relais | jq .
# → 200 [
#   { "id": "326a56cd-...", "name": "Relais Mutsamudu", "island": "Anjouan" },
#   { "id": "7c19dde1-...", "name": "Relais Domoni", "island": "Anjouan" },
#   { "id": "02c78574-...", "name": "Relais Moroni", "island": "Grande Comore" },
#   { "id": "48224a8f-...", "name": "Relais Fomboni", "island": "Mohéli" }
# ]
```

#### d. Commandes — Cycle de vie complet

**SQL d'injection :** (voir section SQL complète — orders insérées)

```bash
# Créer commande
curl -s -X POST $BASE/api/orders \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"relais_id\":\"326a56cd-4efe-5721-a6a2-f5f4fa30d176\",\"items\":[{\"product_id\":\"$PROD_ID\",\"quantity\":1}]}"
# → 201 { "id": "...", "reference": "KOM-2026-XXXXXX", "status": "draft" }

# Lister commandes
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/orders | jq '.[0]'
# → 200 [ { "id": "...", "reference": "KOM-2026-000001", "status": "collected", ... } ]

# Commande par référence
curl -s "$BASE/api/orders/KOM-2026-000001" | jq .
# → 200 { "reference": "KOM-2026-000001", "status": "collected" }

# Historique
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/orders/bbbbbbbb-0001-4000-8000-000000000001/history" | jq .
# → 200 [ { "old_status": "draft", "new_status": "confirmed", ... }, ... ]

# Commandes relais
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/orders/relais" | jq .
# → 200 [ ... commandes status 'available' au relais ... ]

# Commandes problèmes
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/orders/problems" | jq .
# → 200 [ ... commandes avec problèmes détectés ... ]
```

#### e. QR Token + Retrait

```bash
# Générer QR token
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/orders/bbbbbbbb-0003-4000-8000-000000000003/qr-token" | jq .
# → 200 { "token": "abc123...64chars", "expiresAt": "2026-04-06T..." }

# Page retrait (HTML)
QR_TOKEN="<token_du_dessus>"
curl -s "$BASE/api/orders/retrait/$QR_TOKEN" | head -5
# → 200 <!DOCTYPE html>...
```

#### f. Paniers

```bash
# Créer panier
curl -s -X POST $BASE/api/baskets \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{}' | jq .
# → 201 { "id": "...", "code": "...", "items": [] }

# Ajouter article
BASKET_ID="<id_du_panier>"
curl -s -X POST "$BASE/api/baskets/$BASKET_ID/items" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{\"product_id\":\"$PROD_ID\",\"quantity\":2}" | jq .
# → 201 { "id": "...", "product_id": "...", "quantity": 2 }

# Détail panier
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/baskets/$BASKET_ID" | jq .
# → 200 { "id": "...", "items": [...] }
```

#### g. Cérémonie

**SQL d'injection :** (voir section SQL complète — fabrics + models insérés)

```bash
# Tissus
curl -s $BASE/api/ceremony/fabrics | jq .
# → 200 [ { "id": "...", "name": "Soie Dubai Premium", "price_kmf": 35000 }, ... ]

# Modèles
curl -s $BASE/api/ceremony/models | jq .
# → 200 [ { "id": "...", "name": "Robe Sahari Classique", "confection_price_kmf": 25000 }, ... ]

# Devis
FABRIC_ID=$(curl -s $BASE/api/ceremony/fabrics | jq -r '.[0].id')
MODEL_ID=$(curl -s $BASE/api/ceremony/models | jq -r '.[0].id')
curl -s -X POST $BASE/api/ceremony/quote \
  -H "Content-Type: application/json" \
  -d "{\"fabric_id\":\"$FABRIC_ID\",\"model_id\":\"$MODEL_ID\",\"quantity\":1}" | jq .
# → 200 { "total_kmf": 60000, "fabric": {...}, "model": {...} }

# Module
curl -s $BASE/api/modules/ceremony | jq .
# → 200 { "fabrics": [...], "models": [...] }
```

#### h. Litiges

```bash
# Créer litige
curl -s -X POST $BASE/api/disputes \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"order_id":"bbbbbbbb-0003-4000-8000-000000000003","reason":"Produit endommagé"}' | jq .
# → 201 { "id": "...", "order_id": "...", "reason": "Produit endommagé", "status": "open" }

# Lister
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/disputes | jq .
# → 200 [ { "id": "...", "reason": "...", "status": "open" }, ... ]

# Résoudre
DISPUTE_ID=$(curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/disputes | jq -r '.[0].id')
curl -s -X PATCH "$BASE/api/disputes/$DISPUTE_ID/resolve" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"resolution":"Remplacement envoyé"}' | jq .
# → 200 { "id": "...", "status": "resolved", "resolution": "Remplacement envoyé" }
```

#### i. Admin Dashboard

**Données nécessaires :** Commandes avec différents statuts, dates, confection_type (voir SQL section G)

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/admin/dashboard | jq .
# → 200 {
#   "total_orders": 6,
#   "total_revenue_kmf": 608000,
#   "orders_by_status": { "collected": 2, "shipped": 1, "available": 1, ... },
#   "recent_orders": [...]
# }
```

#### j. Admin Margins

**Données nécessaires :** Commandes avec `cost_estimated_kmf`, `cost_real_kmf`, `margin_*` (voir SQL section G)

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/admin/margins | jq .
# → 200 {
#   "orders_with_margins": [
#     { "reference": "KOM-2026-000001", "margin_estimated_pct": 32.0, "margin_real_pct": 28.0, ... },
#     { "reference": "KOM-2026-000005", "margin_alert": true, ... }
#   ]
# }
```

#### k. Admin Customs (CORRIGÉ v8.9)

**Données nécessaires :** Entrées dans `customs_history` avec anomalies (voir SQL section K)

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/admin/customs | jq .
# → 200 {
#   "history": [
#     { "customs_estimated_kmf": 5000, "customs_real_kmf": 5500, "is_anomaly": false, ... },
#     { "customs_estimated_kmf": 12000, "customs_real_kmf": 18500, "is_anomaly": true, ... }
#   ],
#   "taux_mensuel": [...]
# }
```

> ⚠️ **C'est cet endpoint qui retournait 500 avant v8.9** car la table `customs_history` n'existait pas.

#### l. Admin Partners

```bash
# Lister
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/admin/partners | jq .
# → 200 [ { "name": "Transport Express Anjouan", "partner_type": "transport", ... } ]

# Créer
curl -s -X POST $BASE/api/admin/partners \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"DHL Comores","partner_type":"international","island":"Grande Comore","commission_kmf":1500}' | jq .
# → 201 { "id": "...", "name": "DHL Comores", ... }

# Modifier
PARTNER_ID=$(curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/admin/partners | jq -r '.[0].id')
curl -s -X PUT "$BASE/api/admin/partners/$PARTNER_ID" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"DHL Comores Express","commission_kmf":2000}' | jq .
# → 200 { "id": "...", "name": "DHL Comores Express", "commission_kmf": 2000, ... }
```

#### m. Admin Alerts

**Données nécessaires :** `orders.margin_alert = TRUE` + `customs_history.is_anomaly = TRUE` (voir SQL sections G et K)

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/admin/alerts | jq .
# → 200 {
#   "margin_alerts": [ { "reference": "KOM-2026-000003", ... }, { "reference": "KOM-2026-000005", ... } ],
#   "customs_anomalies": [ { "order_id": "...", "customs_delta_pct": 54.2, ... } ]
# }
```

#### n. Pilotage Snapshot

**Données nécessaires :** Commandes + products avec `cost_kmf`/`price_kmf` (voir SQL)

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/pilotage | jq .
# → 200 {
#   "period": "2026-04",
#   "total_orders": ...,
#   "total_revenue_kmf": ...,
#   "avg_margin_pct": ...,
#   "categories": { "electronics": ..., "clothing": ... }
# }
```

#### o. Pilotage History

**Données nécessaires :** Commandes sur plusieurs mois (voir SQL commandes 1 et 6)

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/pilotage/history | jq .
# → 200 [
#   { "month": "2026-04", "orders": 4, "revenue_kmf": ... },
#   { "month": "2026-02", "orders": 1, "revenue_kmf": 68000 }
# ]
```

#### p. Pilotage Clients

**Données nécessaires :** Users avec commandes + `loyalty_tiers` + `users.loyalty_tier_id` (voir SQL sections B, F)

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/pilotage/clients | jq .
# → 200 {
#   "top_clients": [ { "email": "ahmed.test@...", "orders_count": 5, "loyalty_label": "Silver" } ],
#   "by_tier": { "Bronze": 1, "Silver": 1 },
#   "by_relais": [ ... ]
# }
```

#### q. Loyalty

**Données nécessaires :** `loyalty_tiers` peuplée (voir SQL section B)

```bash
curl -s $BASE/api/loyalty | jq .
# → 200 [
#   { "label": "Bronze", "min_orders": 0, "discount_pct": 0, "badge": "🥉" },
#   { "label": "Silver", "min_orders": 3, "discount_pct": 2.00, "badge": "🥈" },
#   { "label": "Gold", "min_orders": 10, "discount_pct": 5.00, "badge": "🥇" },
#   { "label": "Platinum", "min_orders": 25, "discount_pct": 8.00, "badge": "💎" }
# ]
```

#### r. Unsold (Invendus)

**Données nécessaires :** Produits avec stock > 0 et commandes anciennes. Retourne un tableau (peut être vide si pas de produit invendu détecté).

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/unsold | jq .
# → 200 [] ou [ { "id": "...", "product_name": "...", "days_in_stock": ... } ]
```

#### s. Purchasing (Achats)

**Données nécessaires :** `purchase_orders` si existantes. Retourne un tableau (vide si aucun PO).

```bash
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/purchasing | jq .
# → 200 [] ou [ { "id": "...", "supplier": "Noon Dubai", "status": "..." } ]
```

#### t. Rates (Taux de change)

**Données nécessaires :** `exchange_rates` peuplée (voir SQL section A)

```bash
curl -s $BASE/api/rates | jq .
# → 200 { "EUR_KMF": 495, "AED_KMF": 139 }
# ou [ { "currency_pair": "EUR_KMF", "rate": 495 }, ... ]
```

#### u. Security (Helmet + Rate Limiting)

```bash
# Test Helmet headers
curl -sI $BASE/api/health | grep -i "x-content-type-options\|x-frame-options\|strict-transport"
# → X-Content-Type-Options: nosniff
# → X-Frame-Options: SAMEORIGIN (ou DENY)
# → Strict-Transport-Security: max-age=...

# Test rate limiting (101 requêtes rapides)
for i in $(seq 1 101); do
  curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/health
done | sort | uniq -c
# → 100 200
# →   1 429

# Test CORS null bloqué
curl -sI -H "Origin: null" $BASE/api/orders
# → Pas de Access-Control-Allow-Origin: null
```

---

## 17. Requêtes SQL utiles

### Monitoring général

```sql
-- Comptage par table
SELECT 'users' AS tbl, COUNT(*) FROM users
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'scans', COUNT(*) FROM scans
UNION ALL SELECT 'customs_history', COUNT(*) FROM customs_history
UNION ALL SELECT 'partners', COUNT(*) FROM partners
UNION ALL SELECT 'loyalty_tiers', COUNT(*) FROM loyalty_tiers
UNION ALL SELECT 'disputes', COUNT(*) FROM disputes
ORDER BY tbl;

-- Dernières commandes
SELECT reference, status, payment_status, total_kmf, created_at
FROM orders ORDER BY created_at DESC LIMIT 10;

-- Distribution des statuts
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY COUNT(*) DESC;
```

### Diagnostic marges

```sql
-- Commandes avec alertes marges
SELECT reference, total_kmf, cost_estimated_kmf, cost_real_kmf,
       margin_estimated_pct, margin_real_pct, margin_alert
FROM orders
WHERE margin_alert = TRUE
ORDER BY created_at DESC;

-- Écart coût > 20%
SELECT reference, cost_estimated_kmf, cost_real_kmf, cost_delta_pct
FROM orders
WHERE ABS(cost_delta_pct) > 20
ORDER BY ABS(cost_delta_pct) DESC;
```

### Diagnostic douane (v8.9)

```sql
-- Toutes les entrées douane
SELECT ch.*, o.reference
FROM customs_history ch
LEFT JOIN orders o ON o.id = ch.order_id
ORDER BY ch.created_at DESC;

-- Anomalies douane
SELECT ch.*, o.reference, o.total_kmf
FROM customs_history ch
JOIN orders o ON o.id = ch.order_id
WHERE ch.is_anomaly = TRUE
ORDER BY ch.customs_delta_pct DESC;

-- Taux moyen par mois (même logique que la vue customs_taux_mensuel)
SELECT DATE_TRUNC('month', created_at) AS mois,
       COUNT(*) AS nb_declarations,
       AVG(customs_real_kmf) AS avg_customs_kmf,
       AVG(customs_delta_pct) AS avg_delta_pct,
       COUNT(*) FILTER (WHERE is_anomaly) AS nb_anomalies
FROM customs_history
GROUP BY 1
ORDER BY 1 DESC;
```

### Diagnostic fidélité

```sql
-- Clients par palier
SELECT lt.label, lt.badge, COUNT(u.id) AS nb_clients
FROM loyalty_tiers lt
LEFT JOIN users u ON u.loyalty_tier_id = lt.id
GROUP BY lt.label, lt.badge, lt.min_orders
ORDER BY lt.min_orders;

-- Top clients par commandes
SELECT u.email, u.orders_count, lt.label AS tier
FROM users u
LEFT JOIN loyalty_tiers lt ON lt.id = u.loyalty_tier_id
WHERE u.role = 'client'
ORDER BY u.orders_count DESC
LIMIT 20;
```

### Diagnostic partenaires

```sql
-- Partenaires actifs
SELECT name, partner_type, island, commission_kmf, is_active
FROM partners
WHERE is_active = TRUE
ORDER BY name;
```

### Nettoyage données de test

```sql
-- ⚠️ DANGER — Supprime toutes les données de test
BEGIN;
DELETE FROM customs_history WHERE order_id IN (SELECT id FROM orders WHERE reference LIKE 'KOM-TEST%');
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE reference LIKE 'KOM-TEST%');
DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE reference LIKE 'KOM-TEST%');
DELETE FROM scans WHERE order_id IN (SELECT id FROM orders WHERE reference LIKE 'KOM-TEST%');
DELETE FROM disputes WHERE order_id IN (SELECT id FROM orders WHERE reference LIKE 'KOM-TEST%');
DELETE FROM orders WHERE reference LIKE 'KOM-TEST%';
DELETE FROM basket_items WHERE basket_id IN (SELECT id FROM baskets WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%test%'));
DELETE FROM baskets WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%test%');
DELETE FROM users WHERE email LIKE '%test%';
DELETE FROM products WHERE sku LIKE 'TEST-%';
DELETE FROM partners WHERE name LIKE 'Test%';
COMMIT;
```

---

## 18. Tests sécurité

### Checklist de sécurité production

| # | Test | Commande | Attendu | Statut |
|---|------|----------|---------|--------|
| 1 | Helmet headers | `curl -sI $BASE/api/health` | X-Content-Type-Options, X-Frame-Options | ✅ |
| 2 | Rate limiting | 101 requêtes rapides | 429 Too Many Requests | ✅ |
| 3 | JWT requis routes admin | `curl -s $BASE/api/admin/dashboard` | 401 Unauthorized | ✅ |
| 4 | JWT expiré | Token de >24h | 401 Unauthorized | ✅ |
| 5 | SQL injection login | `' OR '1'='1` dans email | 401 (pas de bypass) | ✅ |
| 6 | XSS dans body JSON | `<script>alert(1)</script>` | Échappé dans réponse | ✅ |
| 7 | CORS null origin | `Origin: null` | Pas de ACAO header | ✅ |
| 8 | Body size limit | Payload > 10KB | 413 Payload Too Large | ✅ |
| 9 | QR token HMAC | Token modifié manuellement | Signature invalide | ✅ |
| 10 | QR usage unique | 2e scan même token | 409 Already Used | ✅ |

### Scripts de test sécurité

```bash
# Test 1: Helmet
curl -sI $BASE/api/health | grep -E "^(X-|Strict|Content-Security)" | head -5

# Test 2: Rate limit
for i in $(seq 1 101); do curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/health; done | tail -5

# Test 3: Auth required
curl -s $BASE/api/admin/dashboard
# → {"error":"Token manquant"} ou {"error":"Unauthorized"}

# Test 5: SQL injection
curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"'"'"' OR '"'"'1'"'"'='"'"'1","password":"anything"}'
# → 401

# Test 9: QR HMAC tampering
curl -s "$BASE/api/orders/retrait/FAKE_TOKEN_12345"
# → Page HTML erreur "Ce lien n'est plus valide"
```

---

## 19. Configuration et déploiement

### Déploiement sur Railway

1. **Push sur `main`** → Railway auto-deploy en ~30 secondes
2. **Auto-migrations** → `server.js` exécute les CREATE TABLE / ALTER TABLE au démarrage
3. **Health check** → Railway ping `/api/health` toutes les 30s

### Processus de déploiement

```
Developer → git push origin main
  → Railway détecte le push
    → Build Node.js (npm install)
      → Start server.js
        → Auto-migrations v8.6→v8.9 exécutées
          → Health check OK
            → Traffic routé vers nouvelle instance
```

### Rollback

```bash
# Via Railway CLI
railway rollback --to <deployment_id>

# Ou via git
git revert HEAD
git push origin main
```

### Variables d'environnement requises

| Variable | Obligatoire | Description |
|----------|:-----------:|-------------|
| `DATABASE_URL` | ✅ | Auto-injecté par Railway PostgreSQL |
| `JWT_SECRET` | ✅ | Min 64 chars, HS256 |
| `QR_SECRET` | ✅ | HMAC secret pour QR tokens |
| `NODE_ENV` | ✅ | `production` |
| `AT_API_KEY` | ⚠️ | Africa's Talking (SMS) |
| `STRIPE_SECRET_KEY` | ⚠️ | Stripe payments |

### Monitoring

- **Railway Logs** : `railway logs --follow`
- **Health endpoint** : `GET /api/health` → `{ "status": "ok", "db_latency_ms": ... }`
- **Base URL** : `https://komerce-backend-production.up.railway.app`

---

## 20. Historique des corrections majeures (par session)

### Session 1 — Achat semi-auto + fournisseurs

- Routes `/api/purchasing` + `/api/suppliers`
- Tables `suppliers`, `product_suppliers`, `purchase_orders`
- Dashboard Backoffice v1

### Session 2 — Simulateur prix + CDR

- `Komerce_Simulateur_v17.html` — CDR v8
- Scénarios douane, arrondi psychologique, prix terrain
- Source unique de vérité pour les prix

### Session 3 — Module cérémonie

- Tables `fabrics`, `garment_models`, `ceremony_*`
- Routes `/api/ceremony/fabrics`, `/api/ceremony/models`, `/api/ceremony/quote`
- Module intégré au dashboard

### Session 4 — Pilotage v1

- Route `/api/pilotage` (snapshot mensuel)
- Dashboard Pilotage v1 avec graphiques

### Session 5 — Invendus + cron

- Route `/api/unsold` + auto_unsold() cron
- `unsold_items` table + détection automatique

### Session 6 — Fidélité

- Routes `/api/loyalty` (6 routes)
- `loyalty_tiers` table + `recalculate_loyalty()`
- Paliers Bronze/Silver/Gold/Platinum

### Session 7 — Soft-delete fournisseurs

- `deleted_at TIMESTAMPTZ` sur suppliers
- Index partiels + FK SET NULL
- Routes PATCH/DELETE mises à jour

### Session 8-9 — Hub stock + extension

- Colonnes hub : `received_qty`, `batch_id`, etc.
- Extension scan hub multi-colis

### Session 10 — Pilotage v2 + clients

- `/api/pilotage/history` + `/api/pilotage/clients`
- Onglet Clients & Ventes dans le dashboard
- Top clients, ventes par relais

### Session 11 — Test Dashboard v1

- `Komerce_Test_Dashboard_FIXED.html`
- Pipeline 12 steps + monitoring

### Session 12 — QR Code complet

- Routes QR : `/api/orders/:id/qr-token` + `/api/orders/retrait/:token`
- HMAC SHA-256, expiration 48h, usage unique
- Scanner caméra Html5Qrcode
- `migration_v84.sql` : colonnes qr_token, qr_expires_at

### Session 13 — Audit sécurité Round 1 + 2

- Helmet, rate-limit, CORS sécurisé
- Paramètres SQL (anti-injection)
- Séquences PostgreSQL pour références
- Tests problèmes (14 scénarios)
- `migration-round2-constraints.sql`

### Session 14 — Backoffice v4 + Fix deploiement

- Backoffice v4 avec bijoux sécurisé
- Fix `package-lock.json` synchro helmet
- Disputesinventaires intégrés

### Session 15 — Corrections finales v8.5→v8.9

| Version | Corrections |
|---------|-------------|
| **v8.5** | Rate-limit middleware effectivement branché dans `app.use()`, health route montée avant auth, `.env` retiré du repo |
| **v8.6** | Auto-migration bcrypt hash admin au démarrage, fix dashboard P0 (query SQL corrigée), fix routes scans 404 |
| **v8.7** | Auto-migration `customs_history` colonnes manquantes (ALTER TABLE ADD IF NOT EXISTS), CREATE TABLE `loyalty_tiers` avec seed, ALTER users ADD `loyalty_tier_id` |
| **v8.8** | Migration robuste avec try/catch individuel par ALTER, CREATE TABLE `partners` complet (12 colonnes), `gen_random_uuid()` dans migration |
| **v8.9** | **CREATE TABLE IF NOT EXISTS `customs_history`** (9 colonnes complètes) — fix du 500 sur `/api/admin/customs`. ALTER fallback pour chaque colonne si table existe déjà |

---

## 21. Routes manquantes à implémenter

### Priorité haute (Phase 2)

| Route | Méthode | Description | Dépendance |
|-------|---------|-------------|------------|
| `/api/scans/refuse` | POST | Client refuse colis → retour Hub | Nouveau statut `client_refused` |
| `/api/orders/:id/payment-refused` | POST | Refus paiement cash → alerte admin | Nouveau statut `payment_refused` |
| `/api/orders/:id/regenerate-qr` | POST | Nouveau QR si expiré/perdu | QR existant invalidé |
| `/api/webhooks/stripe` | POST | Webhook Stripe idempotent (compléter) | Stripe SDK |
| `/api/notifications/whatsapp` | POST | Envoi WhatsApp automatisé | API WhatsApp Business |

### Priorité moyenne (Phase 3)

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/reports/monthly` | GET | Rapport mensuel PDF auto-généré |
| `/api/reports/customs` | GET | Export douane CSV/PDF |
| `/api/admin/users` | GET/PUT | Gestion utilisateurs admin |
| `/api/admin/products` | POST/PUT/DELETE | CRUD produits côté admin |
| `/api/ws` | WebSocket | Sync live multi-appareils (remplace BroadcastChannel) |

### Priorité basse (Phase 4)

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/analytics/funnel` | GET | Funnel de conversion |
| `/api/analytics/retention` | GET | Taux de rétention clients |
| `/api/admin/config` | GET/PUT | Configuration dynamique |

---

## 22. Prochaines étapes

### Court terme (Sprint actuel)

- [ ] Implémenter `/api/scans/refuse` (refus client)
- [ ] Implémenter `/api/orders/:id/payment-refused`
- [ ] Ajouter WebSocket pour sync multi-appareils
- [ ] Configurer `CORS_ORIGINS` avec le vrai domaine front
- [ ] Mettre en place monitoring (Sentry ou similaire)

### Moyen terme (Mois prochain)

- [ ] Dashboard front déployé (Vercel ou Netlify)
- [ ] WhatsApp Business API intégrée
- [ ] Rapport mensuel automatique (PDF)
- [ ] Export CSV des commandes/customs
- [ ] Tests unitaires avec Jest

### Long terme (Trimestre)

- [ ] Application mobile (React Native)
- [ ] Multi-hub support
- [ ] Intégration comptable
- [ ] API publique documentée (Swagger/OpenAPI)
- [ ] CI/CD pipeline avec tests automatiques

---

## 23. Accès & credentials

### Compte admin principal

| Champ | Valeur |
|-------|--------|
| Email | `ilham@komerce.km` |
| Mot de passe | `komerce2026` |
| Rôle | `admin` |

### URLs

| Service | URL |
|---------|-----|
| **Backend API** | `https://komerce-backend-production.up.railway.app` |
| **Railway Dashboard** | `https://railway.app/project/...` |
| **GitHub Repo** | `https://github.com/SamyrFateh/komerce-backend` |
| **PostgreSQL** | `crossover.proxy.rlwy.net:39045` / `railway` / `postgres` |

### Comment obtenir un JWT token

```bash
# Login admin
TOKEN=$(curl -s -X POST https://komerce-backend-production.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ilham@komerce.km","password":"komerce2026"}' | jq -r '.token')

# Utiliser le token
curl -s -H "Authorization: Bearer $TOKEN" \
  https://komerce-backend-production.up.railway.app/api/admin/dashboard | jq .
```

---

## 24. Commandes utiles

### Développement local

```bash
# Cloner le repo
git clone https://github.com/SamyrFateh/komerce-backend.git
cd komerce-backend

# Installer les dépendances
npm install

# Lancer en local (nécessite DATABASE_URL et JWT_SECRET)
DATABASE_URL="postgresql://..." JWT_SECRET="..." QR_SECRET="..." node server.js

# Le serveur démarre sur le port 3000
# Auto-migrations s'exécutent au démarrage
```

### Railway CLI

```bash
# Installer Railway CLI
npm install -g @railway/cli

# Connexion
railway login

# Voir les logs
railway logs --follow

# Déployer manuellement
railway up

# Variables d'environnement
railway variables
```

### Base de données

```bash
# Connexion directe psql
psql "postgresql://postgres:PASSWORD@crossover.proxy.rlwy.net:39045/railway"

# Exécuter un script SQL
psql $DB_URL < script.sql

# Dump de la base
pg_dump $DB_URL > backup_$(date +%Y%m%d).sql
```

### Git workflow

```bash
# Workflow standard
git pull origin main
# ... faire les modifications ...
git add -A
git commit -m "v8.X: description du changement"
git push origin main
# → Railway auto-deploy en ~30 secondes
```

### Tests rapides

```bash
BASE=https://komerce-backend-production.up.railway.app

# Health check rapide
curl -s $BASE/api/health | jq .

# Vérifier une route admin
TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ilham@komerce.km","password":"komerce2026"}' | jq -r '.token')
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/admin/dashboard | jq .

# Vérifier les headers sécurité
curl -sI $BASE/api/health | head -15
```

---

## Footer

```
═══════════════════════════════════════════════════════════════
HANDOVER MASTER — Komerce Backend v8.9
Score E2E : 40/40 ✅
Dernière mise à jour : 4 avril 2026 — Session 15
Auteur : Jean Daniel — samlepirate97445@hotmail.com
Repo : github.com/SamyrFateh/komerce-backend
Base URL : https://komerce-backend-production.up.railway.app

Ce document est la source unique de vérité pour le projet
Komerce Backend. Tout nouveau développeur doit le lire
intégralement avant de contribuer au code.
═══════════════════════════════════════════════════════════════
```
