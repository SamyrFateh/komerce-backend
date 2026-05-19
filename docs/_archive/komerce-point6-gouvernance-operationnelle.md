# 🔶 Point 6 Élargi — Gouvernance Opérationnelle Komerce

> **Date** : 6 avril 2026 · **Auteur** : Tasklet · **Scope** : komerce-backend  
> **Philosophie** : _"Tout paramètre métier doit vivre en base, jamais dans le code. Le terrain ajuste, le code obéit."_

---

## 📑 Table des matières

1. [Vision & Principes](#1-vision--principes)
2. [Audit des valeurs hardcodées](#2-audit-des-valeurs-hardcodées)
3. [Architecture `business_rules`](#3-architecture-business_rules)
4. [Catalogue complet des règles variabilisables](#4-catalogue-complet-des-règles-variabilisables)
5. [Mécanisme d'annulation](#5-mécanisme-dannulation)
6. [Expédition partielle Hub Dubai](#6-expédition-partielle-hub-dubai)
7. [Système de remboursement](#7-système-de-remboursement)
8. [Impact fichier par fichier](#8-impact-fichier-par-fichier)
9. [Migration DB](#9-migration-db)
10. [API Admin Configuration](#10-api-admin-configuration)
11. [Intégration Dashboard Pilotage](#11-intégration-dashboard-pilotage)
12. [Plan d'implémentation](#12-plan-dimplémentation)

---

## 1. Vision & Principes

### Le problème

Aujourd'hui, **47 valeurs métier** sont dispersées en dur dans 12 fichiers du repo. Chaque ajustement nécessite un commit, un déploiement, et un risque de régression. Le terrain (agents relais, hub Dubai, admin) ne peut rien ajuster sans développeur.

### La solution

Un **moteur de règles centralisé** avec :
- 🗄️ **Table `business_rules`** : source de vérité unique en DB
- 🔄 **Cache mémoire TTL** : performance (pas de requête DB à chaque appel)
- 🖥️ **Page admin** : interface pour ajuster en temps réel
- 📜 **Historique** : chaque changement est audité (qui, quand, ancienne valeur → nouvelle)
- 🔒 **Valeurs par défaut** : le code fonctionne même si la table est vide (fallback hardcodé)

### Principes directeurs

| # | Principe | Conséquence |
|:-:|----------|-------------|
| 1 | **Le terrain commande** | Tout seuil doit être modifiable sans déploiement |
| 2 | **Retour d'expérience** | Chaque règle a un historique de modifications |
| 3 | **Safe by default** | Si la DB est vide, les valeurs par défaut (actuelles) s'appliquent |
| 4 | **Audit complet** | Table `business_rules_history` — qui a changé quoi, quand |
| 5 | **Progressivité** | Déployer le moteur d'abord, migrer les constantes progressivement |

---

## 2. Audit des valeurs hardcodées

### 🔴 Critique — Valeurs qui DOIVENT être variabilisées immédiatement

| # | Fichier | Ligne | Constante | Valeur actuelle | Impact business |
|:-:|---------|:-----:|-----------|:---------------:|----------------|
| 1 | `orders.js` | SMS text | Délai paiement cash relais | **36h** | Annulation automatique si pas payé |
| 2 | `orders.js` | `qr-token` | Expiration QR retrait | **48h** | Client perd accès au QR |
| 3 | `orders.js` | `POST /` | Quantité max par article | **100** | Limite commande |
| 4 | `orders.js` | `problems` | Préparation bloquée | **4 jours** | Détection problème |
| 5 | `orders.js` | `problems` | Transit trop long | **12 jours** | Détection problème |
| 6 | `orders.js` | `problems` | Attente retrait trop longue | **7 jours** | Détection problème |
| 7 | `orders.js` | `problems` | Commande stagnante | **30 jours** | Détection problème |
| 8 | `orders.js` | `problems` | Pas de notification après | **1 heure** | Détection problème |
| 9 | `dashboard.js` | SLA | SLA Warning | **35 jours** | Alerte dashboard |
| 10 | `dashboard.js` | SLA | SLA Late | **42 jours** | Alerte dashboard |
| 11 | `dashboard.js` | SLA | SLA Blocked | **56 jours** | Alerte dashboard |
| 12 | `dashboard.js` | SLA | SLA Inactif | **7 jours** | Alerte dashboard |
| 13 | `dashboard.js` | Compensations | Compensation préventive | **28 jours** | Action auto |
| 14 | `dashboard.js` | Compensations | Avoir | **35 jours** | Action auto |
| 15 | `dashboard.js` | Compensations | Remise | **42 jours** | Action auto |
| 16 | `dashboard.js` | Compensations | Remboursement | **56 jours** | Action auto |
| 17 | `dashboard.js` | Cache | TTL cache dashboard | **30 secondes** | Performance vs fraîcheur |
| 18 | `orders.js` | Estimation | Coefficient douane par défaut | **20%** | Marge estimée |
| 19 | `orders.js` | Estimation | Fret par kg | **65 KMF/kg** | Coût estimé |
| 20 | `db.js` | Pool | Pool max connexions | **10** | Performance DB |

### 🟠 Important — Valeurs métier à variabiliser

| # | Fichier | Constante | Valeur actuelle | Impact |
|:-:|---------|-----------|:---------------:|--------|
| 21 | `loyalty.js` | Palier Bronze seuil | **0 commandes** | Fidélité |
| 22 | `loyalty.js` | Palier Silver seuil | **3 commandes** | Fidélité |
| 23 | `loyalty.js` | Palier Gold seuil | **10 commandes** | Fidélité |
| 24 | `loyalty.js` | Palier Platinum seuil | **25 commandes** | Fidélité |
| 25 | `loyalty.js` | Remise Bronze | **0%** | Fidélité |
| 26 | `loyalty.js` | Remise Silver | **2%** | Fidélité |
| 27 | `loyalty.js` | Remise Gold | **5%** | Fidélité |
| 28 | `loyalty.js` | Remise Platinum | **8%** | Fidélité |
| 29 | `rates.js` | Fallback EUR/KMF | **492** | Conversion |
| 30 | `rates.js` | Fallback AED/KMF | **138** | Conversion |
| 31 | `auth.js` | JWT expiration | **30 jours** | Sécurité |
| 32 | `rate-limit.js` | Global limit | **100 req/15min** | Sécurité |
| 33 | `rate-limit.js` | Auth limit | **5 req/15min** | Sécurité |
| 34 | `sms.js` | Cash reminder cron | **1 heure** | Rappels |
| 35 | `pricing.js` | Marge par défaut | **Variable** | Pricing |

### 🟡 Nice to have — Valeurs à variabiliser plus tard

| # | Constante | Valeur | Contexte |
|:-:|-----------|:------:|----------|
| 36 | Max retries référence unique | 5 | orders.js |
| 37 | Longueur code cash | 6 chiffres | orders.js |
| 38 | Longueur code retrait | 6 chars | orders.js |
| 39 | Multer max file size | (non limité) | upload.js |
| 40 | QR code taille | 200×200 | orders.js |

### 🆕 Nouvelles règles à créer (Point 6 Roadmap)

| # | Règle | Valeur défaut | Source |
|:-:|-------|:-------------:|--------|
| 41 | `CANCEL_FREE_WINDOW_HOURS` | 24h | Roadmap §7.1 |
| 42 | `CANCEL_PARTIAL_REFUND_PCT` | 80% | Roadmap §7.1 |
| 43 | `CANCEL_CUTOFF_STATUS` | `shipped` | Roadmap §7.1 |
| 44 | `PARTIAL_SHIP_DELAY_THRESHOLD_DAYS` | 7j | Roadmap §7.2 |
| 45 | `PARTIAL_SHIP_MIN_AVAILABLE_PCT` | 60% | Roadmap §7.2 |
| 46 | `PARTIAL_SHIP_AUTO_NOTIFY` | true | Roadmap §7.2 |
| 47 | `BACKORDER_MAX_DAYS` | 30j | Roadmap §7.2 |

---

## 3. Architecture `business_rules`

### Table principale

```sql
CREATE TABLE business_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category    TEXT NOT NULL,           -- 'orders', 'sla', 'loyalty', 'pricing', 'security', 'notifications'
  key         TEXT NOT NULL UNIQUE,    -- 'CANCEL_FREE_WINDOW_HOURS'
  value       JSONB NOT NULL,          -- { "value": 24 } ou { "value": "shipped" } ou { "value": true }
  value_type  TEXT NOT NULL DEFAULT 'number', -- 'number', 'string', 'boolean', 'json'
  label_fr    TEXT NOT NULL,           -- "Fenêtre d'annulation gratuite (heures)"
  description TEXT,                    -- Description longue pour l'admin
  min_value   NUMERIC,                -- Contrainte min (optionnel)
  max_value   NUMERIC,                -- Contrainte max (optionnel)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Table d'historique (audit trail)

```sql
CREATE TABLE business_rules_history (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id      UUID NOT NULL REFERENCES business_rules(id),
  old_value    JSONB,
  new_value    JSONB NOT NULL,
  changed_by   UUID REFERENCES users(id),
  change_reason TEXT,                  -- Optionnel : "retour terrain agent Moroni"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Cache mémoire (dans le code Node.js)

```javascript
// utils/rules.js — Moteur de règles centralisé
const CACHE_TTL_MS = 60_000; // 1 minute
let _cache = null;
let _cacheAt = 0;

async function getRule(key, defaultValue) {
  if (!_cache || Date.now() - _cacheAt > CACHE_TTL_MS) {
    const { rows } = await db.query(
      'SELECT key, value, value_type FROM business_rules WHERE is_active = TRUE'
    );
    _cache = Object.fromEntries(rows.map(r => [r.key, r.value?.value ?? defaultValue]));
    _cacheAt = Date.now();
  }
  return _cache[key] ?? defaultValue;
}

function invalidateCache() { _cache = null; }

module.exports = { getRule, invalidateCache };
```

### Principe : Zéro Breaking Change

```javascript
// AVANT (hardcodé) :
const QR_EXPIRATION_HOURS = 48;

// APRÈS (variabilisé, avec fallback) :
const QR_EXPIRATION_HOURS = await getRule('QR_EXPIRATION_HOURS', 48);
//                                                                ^^
//                                          Fallback = valeur actuelle
//                                          → Si la DB est vide, RIEN NE CHANGE
```

---

## 4. Catalogue complet des règles variabilisables

### 📦 Catégorie : `orders` — Commandes

| Clé | Label FR | Type | Défaut | Min | Max | Fichiers impactés |
|-----|----------|:----:|:------:|:---:|:---:|-------------------|
| `CANCEL_FREE_WINDOW_HOURS` | Fenêtre annulation gratuite (h) | number | 24 | 1 | 168 | orders.js (nouveau) |
| `CANCEL_PARTIAL_REFUND_PCT` | % remboursé hors fenêtre | number | 80 | 0 | 100 | orders.js (nouveau) |
| `CANCEL_CUTOFF_STATUS` | Statut max pour annulation | string | `shipped` | — | — | orders.js (nouveau) |
| `CASH_PAYMENT_TIMEOUT_HOURS` | Délai paiement cash relais | number | 36 | 12 | 168 | orders.js, sms.js |
| `QR_EXPIRATION_HOURS` | Durée validité QR retrait | number | 48 | 6 | 168 | orders.js |
| `MAX_QUANTITY_PER_ITEM` | Quantité max par article | number | 100 | 1 | 1000 | orders.js |
| `ORDER_ALERT_48H_AVAILABLE` | Alerte colis non retiré (h) | number | 48 | 12 | 168 | orders.js |

### 🚢 Catégorie : `shipping` — Expédition

| Clé | Label FR | Type | Défaut | Min | Max | Fichiers impactés |
|-----|----------|:----:|:------:|:---:|:---:|-------------------|
| `PARTIAL_SHIP_DELAY_THRESHOLD_DAYS` | Retard déclenchant expé partielle (j) | number | 7 | 1 | 60 | orders.js (nouveau) |
| `PARTIAL_SHIP_MIN_AVAILABLE_PCT` | % articles dispo pour expé partielle | number | 60 | 10 | 100 | orders.js (nouveau) |
| `PARTIAL_SHIP_AUTO_NOTIFY` | Notification auto expé partielle | boolean | true | — | — | orders.js (nouveau) |
| `BACKORDER_MAX_DAYS` | Backorder max avant annulation auto | number | 30 | 7 | 90 | orders.js (nouveau) |

### ⏱️ Catégorie : `sla` — Niveaux de service

| Clé | Label FR | Type | Défaut | Min | Max | Fichiers impactés |
|-----|----------|:----:|:------:|:---:|:---:|-------------------|
| `SLA_WARNING_DAYS` | SLA Warning (jours) | number | 35 | 7 | 90 | dashboard.js |
| `SLA_LATE_DAYS` | SLA Late (jours) | number | 42 | 14 | 120 | dashboard.js |
| `SLA_BLOCKED_DAYS` | SLA Blocked (jours) | number | 56 | 21 | 180 | dashboard.js |
| `SLA_INACTIVE_DAYS` | SLA Inactif (jours) | number | 7 | 1 | 30 | dashboard.js |
| `PROBLEM_PREP_BLOCKED_DAYS` | Préparation bloquée max (j) | number | 4 | 1 | 14 | orders.js |
| `PROBLEM_TRANSIT_MAX_DAYS` | Transit max avant alerte (j) | number | 12 | 5 | 60 | orders.js |
| `PROBLEM_WAITING_MAX_DAYS` | Attente retrait max (j) | number | 7 | 1 | 30 | orders.js |
| `PROBLEM_STALLED_DAYS` | Commande stagnante (j) | number | 30 | 7 | 90 | orders.js |
| `PROBLEM_NO_NOTIF_HOURS` | Pas de notif après (h) | number | 1 | 0.5 | 24 | orders.js |

### 💰 Catégorie : `compensation` — Compensations automatiques

| Clé | Label FR | Type | Défaut | Min | Max | Fichiers impactés |
|-----|----------|:----:|:------:|:---:|:---:|-------------------|
| `COMP_PREVENTIVE_DAYS` | Compensation préventive (j) | number | 28 | 7 | 60 | dashboard.js |
| `COMP_CREDIT_DAYS` | Avoir boutique (j) | number | 35 | 14 | 90 | dashboard.js |
| `COMP_DISCOUNT_DAYS` | Remise (j) | number | 42 | 21 | 120 | dashboard.js |
| `COMP_REFUND_DAYS` | Remboursement auto (j) | number | 56 | 28 | 180 | dashboard.js |

### 💎 Catégorie : `loyalty` — Programme fidélité

| Clé | Label FR | Type | Défaut | Fichiers impactés |
|-----|----------|:----:|:------:|-------------------|
| `LOYALTY_SILVER_ORDERS` | Seuil Silver (commandes) | number | 3 | loyalty.js |
| `LOYALTY_GOLD_ORDERS` | Seuil Gold (commandes) | number | 10 | loyalty.js |
| `LOYALTY_PLATINUM_ORDERS` | Seuil Platinum (commandes) | number | 25 | loyalty.js |
| `LOYALTY_SILVER_DISCOUNT` | Remise Silver (%) | number | 2 | loyalty.js |
| `LOYALTY_GOLD_DISCOUNT` | Remise Gold (%) | number | 5 | loyalty.js |
| `LOYALTY_PLATINUM_DISCOUNT` | Remise Platinum (%) | number | 8 | loyalty.js |

### 📊 Catégorie : `pricing` — Tarification

| Clé | Label FR | Type | Défaut | Fichiers impactés |
|-----|----------|:----:|:------:|-------------------|
| `CUSTOMS_DEFAULT_PCT` | Douane estimée (%) | number | 20 | orders.js, pricing.js |
| `FREIGHT_KMF_PER_KG` | Fret par kg (KMF) | number | 65 | orders.js |
| `EUR_KMF_FALLBACK` | Taux EUR/KMF fallback | number | 492 | orders.js, rates.js |
| `AED_KMF_FALLBACK` | Taux AED/KMF fallback | number | 138 | rates.js |

### 🔧 Catégorie : `system` — Système

| Clé | Label FR | Type | Défaut | Fichiers impactés |
|-----|----------|:----:|:------:|-------------------|
| `DASHBOARD_CACHE_TTL_SEC` | Cache dashboard (sec) | number | 30 | dashboard.js |
| `CASH_REMINDER_INTERVAL_MIN` | Intervalle rappels cash (min) | number | 60 | sms.js |

---

## 5. Mécanisme d'annulation

### 5.1 Flux complet

```
Client demande annulation
         │
         ▼
┌─────────────────────────────┐
│ Vérification éligibilité     │
│                              │
│ 1. Statut ≤ CANCEL_CUTOFF?  │──── NON ──→ ❌ "Annulation impossible — en transit"
│    (défaut: shipped)         │
│                              │
│ 2. Dans fenêtre gratuite?    │
│    now - paid_at < FREE_WIN  │
│                              │
│    OUI → Remboursement 100%  │
│    NON → Remboursement X%    │
│          (CANCEL_PARTIAL_%)  │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Exécution                    │
│                              │
│ 1. orders.status → cancelled │
│ 2. Stock re-incrémenté       │
│ 3. Remboursement calculé     │
│    → Stripe refund OU        │
│    → Crédit boutique (cash)  │
│ 4. order_status_history +=   │
│ 5. SMS + Email client        │
│ 6. Audit trail               │
└─────────────────────────────┘
```

### 5.2 Nouvel endpoint

```
POST /api/orders/:id/cancel
Body: { reason?: string }
Auth: client (propre commande) ou admin (toute commande)
```

### 5.3 Table de décision

| Condition | Remboursement | Méthode | Stock |
|-----------|:------------:|---------|:-----:|
| Dans fenêtre + Stripe | 100% | Stripe refund | ✅ Restauré |
| Dans fenêtre + Cash | 100% | Crédit boutique | ✅ Restauré |
| Hors fenêtre + Stripe | `CANCEL_PARTIAL_REFUND_PCT`% | Stripe partial refund | ✅ Restauré |
| Hors fenêtre + Cash | `CANCEL_PARTIAL_REFUND_PCT`% | Crédit boutique | ✅ Restauré |
| Statut ≥ `CANCEL_CUTOFF_STATUS` | 0% | Refusé | ❌ Pas touché |

### 5.4 Nouvelle table `refunds`

```sql
CREATE TABLE refunds (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id        UUID NOT NULL REFERENCES orders(id),
  amount_kmf      INTEGER NOT NULL,
  amount_eur      NUMERIC(10,2),
  refund_type     TEXT NOT NULL,        -- 'full', 'partial', 'partial_ship'
  refund_method   TEXT NOT NULL,        -- 'stripe', 'store_credit'
  stripe_refund_id TEXT,                -- ID Stripe si applicable
  store_credit_id  UUID,               -- Référence crédit boutique
  reason          TEXT,
  initiated_by    UUID REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'completed', 'failed'
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.5 Nouvelle table `store_credits`

```sql
CREATE TABLE store_credits (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id),
  amount_kmf    INTEGER NOT NULL,
  remaining_kmf INTEGER NOT NULL,      -- Décrémenté à l'utilisation
  reason        TEXT,                  -- 'cancellation_refund', 'compensation', 'manual'
  source_order_id UUID REFERENCES orders(id),
  expires_at    TIMESTAMPTZ,           -- Optionnel : crédit expirable
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. Expédition partielle Hub Dubai

### 6.1 Concept

Quand une commande multi-articles a des retards sur certains articles, on expédie ce qui est prêt et on met le reste en backorder.

### 6.2 Flux

```
Commande multi-articles en préparation
              │
              ▼
┌──────────────────────────────────────┐
│ Vérification quotidienne (cron)       │
│                                       │
│ Pour chaque commande en 'preparation' │
│ ou 'ordered' depuis > DELAY_THRESHOLD │
│                                       │
│ 1. Calculer % articles disponibles    │
│ 2. Si % ≥ MIN_AVAILABLE_PCT          │
│    ET retard ≥ DELAY_THRESHOLD_DAYS   │
│    → Créer sous-commande partielle    │
│                                       │
│ 3. Articles restants → backorder      │
│    Avec date estimée                  │
│                                       │
│ 4. Si backorder > BACKORDER_MAX_DAYS  │
│    → Proposer annulation partielle    │
└──────────────────────────────────────┘
```

### 6.3 Nouvelle table `sub_orders`

```sql
CREATE TABLE sub_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_order_id UUID NOT NULL REFERENCES orders(id),
  type            TEXT NOT NULL,          -- 'partial_ship', 'backorder'
  status          order_status NOT NULL DEFAULT 'preparation',
  tracking_ref    TEXT,                   -- Référence tracking séparée
  estimated_date  TIMESTAMPTZ,           -- Date estimée pour backorder
  shipped_at      TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sub_order_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sub_order_id    UUID NOT NULL REFERENCES sub_orders(id),
  order_item_id   UUID NOT NULL REFERENCES order_items(id),
  quantity        INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.4 Nouvelle colonne `order_items`

```sql
ALTER TABLE order_items
  ADD COLUMN availability_status TEXT DEFAULT 'pending',
  -- 'pending', 'available', 'delayed', 'backorder', 'cancelled'
  ADD COLUMN estimated_available_at TIMESTAMPTZ,
  ADD COLUMN backorder_reason TEXT;
```

---

## 7. Système de remboursement

### 7.1 Stripe Refund

```javascript
// Pour les commandes Stripe payées
const refund = await stripe.refunds.create({
  payment_intent: order.stripe_payment_id,
  amount: refundAmountCents,  // En centimes EUR
  reason: 'requested_by_customer',
  metadata: {
    order_reference: order.reference,
    refund_type: 'cancellation',
  },
});
```

### 7.2 Crédit boutique (Cash relais)

Les commandes cash ne peuvent pas être remboursées en espèces automatiquement. Le système génère un **crédit boutique** utilisable sur la prochaine commande.

```javascript
// Appliquer crédit boutique à la commande suivante
// Dans POST /api/orders (création)
const credits = await getAvailableCredits(db, req.user.id);
if (credits.total_kmf > 0) {
  const creditApplied = Math.min(credits.total_kmf, total_kmf);
  total_kmf -= creditApplied;
  // Décrémenter les crédits utilisés
}
```

---

## 8. Impact fichier par fichier

### 📝 Fichiers à MODIFIER

| Fichier | Changements | Effort |
|---------|-------------|:------:|
| **`orders.js`** | → Remplacer 12 constantes par `getRule()` · Ajouter `POST /:id/cancel` · Ajouter logique sous-commandes · Restauration stock | 🔴 8h |
| **`payments.js`** | → Ajouter logique Stripe refund · Intégrer `store_credits` | 🟠 3h |
| **`dashboard.js`** | → Remplacer 8 constantes SLA/compensation par `getRule()` · Ajouter indicateurs annulations + partielles | 🟠 4h |
| **`loyalty.js`** | → Remplacer 8 constantes paliers par `getRule()` | 🟡 1h |
| **`sms.js`** | → Remplacer intervalle cron par `getRule()` · Nouveaux templates SMS annulation + partielle | 🟡 2h |
| **`pricing.js`** | → Remplacer coefficients par `getRule()` | 🟡 1h |
| **`rates.js`** | → Remplacer fallbacks par `getRule()` | 🟡 0.5h |
| **`server.js`** | → Ajouter route `configRouter` · Auto-migration `business_rules` | 🟡 1h |
| **`validators/index.js`** | → Ajouter schémas cancel, config, sub_orders | 🟡 1h |

### 📝 Fichiers à CRÉER

| Fichier | Rôle | Effort |
|---------|------|:------:|
| **`utils/rules.js`** | Moteur de règles centralisé + cache | 🟡 2h |
| **`routes/config.js`** | API CRUD règles admin | 🟠 3h |
| **`db/migrations/007_business_rules.sql`** | Tables business_rules, refunds, store_credits, sub_orders | 🟡 1h |

### 🖥️ Frontend (Dashboard Pilotage)

| Composant | Changements | Effort |
|-----------|-------------|:------:|
| **Nouvelle vue "⚙️ Configuration"** | Interface admin pour ajuster les 47 règles par catégorie | 🟠 4h |
| **Vue Ops** | Ajouter indicateurs annulations + expéditions partielles | 🟡 2h |
| **Vue Finance** | Ajouter montants remboursés + crédits boutique en cours | 🟡 2h |

---

## 9. Migration DB

### `007_business_rules.sql`

```sql
-- ============================================================
-- MIGRATION 007 — Moteur de règles opérationnelles
-- ============================================================

-- 1. Table des règles
CREATE TABLE IF NOT EXISTS business_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category    TEXT NOT NULL,
  key         TEXT NOT NULL UNIQUE,
  value       JSONB NOT NULL,
  value_type  TEXT NOT NULL DEFAULT 'number',
  label_fr    TEXT NOT NULL,
  description TEXT,
  min_value   NUMERIC,
  max_value   NUMERIC,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_br_category ON business_rules(category);
CREATE INDEX idx_br_key ON business_rules(key);

-- 2. Historique des modifications
CREATE TABLE IF NOT EXISTS business_rules_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id       UUID NOT NULL REFERENCES business_rules(id),
  old_value     JSONB,
  new_value     JSONB NOT NULL,
  changed_by    UUID REFERENCES users(id),
  change_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Remboursements
CREATE TABLE IF NOT EXISTS refunds (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id         UUID NOT NULL REFERENCES orders(id),
  amount_kmf       INTEGER NOT NULL,
  amount_eur       NUMERIC(10,2),
  refund_type      TEXT NOT NULL,
  refund_method    TEXT NOT NULL,
  stripe_refund_id TEXT,
  store_credit_id  UUID,
  reason           TEXT,
  initiated_by     UUID REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'pending',
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refunds_order ON refunds(order_id);

-- 4. Crédits boutique
CREATE TABLE IF NOT EXISTS store_credits (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES users(id),
  amount_kmf       INTEGER NOT NULL,
  remaining_kmf    INTEGER NOT NULL,
  reason           TEXT,
  source_order_id  UUID REFERENCES orders(id),
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credits_user ON store_credits(user_id);

-- 5. Sous-commandes (expédition partielle)
CREATE TABLE IF NOT EXISTS sub_orders (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_order_id  UUID NOT NULL REFERENCES orders(id),
  type             TEXT NOT NULL,
  status           order_status NOT NULL DEFAULT 'preparation',
  tracking_ref     TEXT,
  estimated_date   TIMESTAMPTZ,
  shipped_at       TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sub_order_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sub_order_id     UUID NOT NULL REFERENCES sub_orders(id),
  order_item_id    UUID NOT NULL REFERENCES order_items(id),
  quantity         INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Extension order_items pour backorder
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS availability_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS estimated_available_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backorder_reason TEXT;

-- 7. Seed des règles par défaut
INSERT INTO business_rules (category, key, value, value_type, label_fr, description, min_value, max_value)
VALUES
  -- Orders
  ('orders', 'CANCEL_FREE_WINDOW_HOURS', '{"value": 24}', 'number',
   'Fenêtre annulation gratuite (heures)', 'Délai après paiement pour annulation avec remboursement 100%', 1, 168),
  ('orders', 'CANCEL_PARTIAL_REFUND_PCT', '{"value": 80}', 'number',
   'Remboursement hors fenêtre (%)', 'Pourcentage remboursé si annulation hors fenêtre gratuite', 0, 100),
  ('orders', 'CANCEL_CUTOFF_STATUS', '{"value": "shipped"}', 'string',
   'Statut max pour annulation', 'Au-delà de ce statut, annulation impossible (retour SAV)', NULL, NULL),
  ('orders', 'CASH_PAYMENT_TIMEOUT_HOURS', '{"value": 36}', 'number',
   'Délai paiement cash relais (heures)', 'Temps accordé au client pour payer en espèces au relais', 12, 168),
  ('orders', 'QR_EXPIRATION_HOURS', '{"value": 48}', 'number',
   'Validité QR retrait (heures)', 'Durée de validité du QR code de retrait', 6, 168),
  ('orders', 'MAX_QUANTITY_PER_ITEM', '{"value": 100}', 'number',
   'Quantité max par article', 'Nombre maximum d''articles identiques par commande', 1, 1000),
  ('orders', 'ORDER_ALERT_48H_AVAILABLE', '{"value": 48}', 'number',
   'Alerte colis non retiré (heures)', 'Durée avant alerte si colis disponible non retiré', 12, 168),

  -- Shipping
  ('shipping', 'PARTIAL_SHIP_DELAY_THRESHOLD_DAYS', '{"value": 7}', 'number',
   'Retard déclenchant expédition partielle (jours)', 'Nombre de jours de retard avant déclenchement expédition partielle', 1, 60),
  ('shipping', 'PARTIAL_SHIP_MIN_AVAILABLE_PCT', '{"value": 60}', 'number',
   'Articles disponibles min pour expédition partielle (%)', 'Pourcentage minimum d''articles disponibles', 10, 100),
  ('shipping', 'PARTIAL_SHIP_AUTO_NOTIFY', '{"value": true}', 'boolean',
   'Notification auto expédition partielle', 'Envoyer SMS/email automatiquement au client', NULL, NULL),
  ('shipping', 'BACKORDER_MAX_DAYS', '{"value": 30}', 'number',
   'Backorder max avant proposition annulation (jours)', 'Durée max de backorder avant proposition d''annulation au client', 7, 90),

  -- SLA
  ('sla', 'SLA_WARNING_DAYS', '{"value": 35}', 'number', 'SLA Warning (jours)', 'Seuil d''alerte SLA jaune', 7, 90),
  ('sla', 'SLA_LATE_DAYS', '{"value": 42}', 'number', 'SLA Late (jours)', 'Seuil d''alerte SLA orange', 14, 120),
  ('sla', 'SLA_BLOCKED_DAYS', '{"value": 56}', 'number', 'SLA Blocked (jours)', 'Seuil d''alerte SLA rouge', 21, 180),
  ('sla', 'SLA_INACTIVE_DAYS', '{"value": 7}', 'number', 'SLA Inactif (jours)', 'Seuil commande sans activité', 1, 30),
  ('sla', 'PROBLEM_PREP_BLOCKED_DAYS', '{"value": 4}', 'number', 'Préparation bloquée max (jours)', NULL, 1, 14),
  ('sla', 'PROBLEM_TRANSIT_MAX_DAYS', '{"value": 12}', 'number', 'Transit max avant alerte (jours)', NULL, 5, 60),
  ('sla', 'PROBLEM_WAITING_MAX_DAYS', '{"value": 7}', 'number', 'Attente retrait max (jours)', NULL, 1, 30),
  ('sla', 'PROBLEM_STALLED_DAYS', '{"value": 30}', 'number', 'Commande stagnante (jours)', NULL, 7, 90),
  ('sla', 'PROBLEM_NO_NOTIF_HOURS', '{"value": 1}', 'number', 'Pas de notification après (heures)', NULL, 0.5, 24),

  -- Compensation
  ('compensation', 'COMP_PREVENTIVE_DAYS', '{"value": 28}', 'number', 'Compensation préventive (jours)', NULL, 7, 60),
  ('compensation', 'COMP_CREDIT_DAYS', '{"value": 35}', 'number', 'Avoir boutique (jours)', NULL, 14, 90),
  ('compensation', 'COMP_DISCOUNT_DAYS', '{"value": 42}', 'number', 'Remise (jours)', NULL, 21, 120),
  ('compensation', 'COMP_REFUND_DAYS', '{"value": 56}', 'number', 'Remboursement auto (jours)', NULL, 28, 180),

  -- Loyalty
  ('loyalty', 'LOYALTY_SILVER_ORDERS', '{"value": 3}', 'number', 'Seuil Silver (commandes)', NULL, 1, 50),
  ('loyalty', 'LOYALTY_GOLD_ORDERS', '{"value": 10}', 'number', 'Seuil Gold (commandes)', NULL, 5, 100),
  ('loyalty', 'LOYALTY_PLATINUM_ORDERS', '{"value": 25}', 'number', 'Seuil Platinum (commandes)', NULL, 10, 200),
  ('loyalty', 'LOYALTY_SILVER_DISCOUNT', '{"value": 2}', 'number', 'Remise Silver (%)', NULL, 0, 20),
  ('loyalty', 'LOYALTY_GOLD_DISCOUNT', '{"value": 5}', 'number', 'Remise Gold (%)', NULL, 0, 30),
  ('loyalty', 'LOYALTY_PLATINUM_DISCOUNT', '{"value": 8}', 'number', 'Remise Platinum (%)', NULL, 0, 50),

  -- Pricing
  ('pricing', 'CUSTOMS_DEFAULT_PCT', '{"value": 20}', 'number', 'Douane estimée par défaut (%)', NULL, 5, 50),
  ('pricing', 'FREIGHT_KMF_PER_KG', '{"value": 65}', 'number', 'Fret par kg (KMF)', NULL, 10, 500),
  ('pricing', 'EUR_KMF_FALLBACK', '{"value": 492}', 'number', 'Taux EUR/KMF fallback', NULL, 400, 600),
  ('pricing', 'AED_KMF_FALLBACK', '{"value": 138}', 'number', 'Taux AED/KMF fallback', NULL, 100, 200),

  -- System
  ('system', 'DASHBOARD_CACHE_TTL_SEC', '{"value": 30}', 'number', 'Cache dashboard (secondes)', NULL, 5, 300),
  ('system', 'CASH_REMINDER_INTERVAL_MIN', '{"value": 60}', 'number', 'Intervalle rappels cash (minutes)', NULL, 15, 360)
ON CONFLICT (key) DO NOTHING;

-- Trigger updated_at
CREATE TRIGGER trg_br_updated BEFORE UPDATE ON business_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sub_orders_updated BEFORE UPDATE ON sub_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## 10. API Admin Configuration

### `routes/config.js` — 5 endpoints

| # | Méthode | Chemin | Rôle | Description |
|:-:|---------|--------|------|-------------|
| 1 | `GET` | `/api/config/rules` | admin | Liste toutes les règles (groupées par catégorie) |
| 2 | `GET` | `/api/config/rules/:key` | admin | Détail d'une règle + historique |
| 3 | `PUT` | `/api/config/rules/:key` | admin | Modifier une règle (+ raison optionnelle) |
| 4 | `POST` | `/api/config/rules/:key/reset` | admin | Reset à la valeur par défaut |
| 5 | `GET` | `/api/config/rules/:key/history` | admin | Historique des modifications |

### Body `PUT /api/config/rules/:key`

```json
{
  "value": 48,
  "reason": "Retour terrain: 24h trop court pour les clients de Mohéli"
}
```

### Réponse `GET /api/config/rules`

```json
{
  "categories": {
    "orders": {
      "label": "Commandes",
      "rules": [
        {
          "key": "CANCEL_FREE_WINDOW_HOURS",
          "label_fr": "Fenêtre annulation gratuite (heures)",
          "value": 24,
          "value_type": "number",
          "min_value": 1,
          "max_value": 168,
          "updated_at": "2026-04-06T19:30:00Z"
        }
      ]
    }
  }
}
```

---

## 11. Intégration Dashboard Pilotage

### Nouvelle vue : ⚙️ Configuration

Interface pour l'admin avec :
- 📂 Navigation par **catégorie** (onglets)
- 🔢 Input numérique avec **slider** (min/max) pour chaque règle
- 🔄 Bouton **reset** par règle
- 📜 **Historique** des modifications (qui, quand, raison)
- 🔒 Sauvegarde avec **confirmation** ("Êtes-vous sûr ?")

### Indicateurs ajoutés aux vues existantes

| Vue | Nouvel indicateur |
|-----|-------------------|
| **Ops** | 📊 Annulations aujourd'hui · Expéditions partielles en cours |
| **Finance** | 💸 Remboursements du mois · Crédits boutique actifs |
| **Retards** | 🔄 Commandes en backorder · Propositions d'annulation envoyées |
| **Pipeline** | Nouveau statut `partially_shipped` dans le kanban |

---

## 12. Plan d'implémentation

### Phase 1 — Fondations (1 PR) ⏱️ ~6h

| # | Tâche | Effort |
|:-:|-------|:------:|
| 1.1 | Créer `db/migrations/007_business_rules.sql` | 1h |
| 1.2 | Créer `utils/rules.js` (moteur + cache) | 2h |
| 1.3 | Créer `routes/config.js` (API CRUD) | 2h |
| 1.4 | Brancher dans `server.js` | 0.5h |
| 1.5 | Validator Joi pour config | 0.5h |

**Livrable** : Le moteur fonctionne, les 37 règles sont en DB, l'API admin est opérationnelle. Aucun code existant n'est modifié.

### Phase 2 — Migration des constantes (1 PR) ⏱️ ~8h

| # | Tâche | Effort |
|:-:|-------|:------:|
| 2.1 | `orders.js` — remplacer 12 constantes par `getRule()` | 3h |
| 2.2 | `dashboard.js` — remplacer 8 constantes SLA/comp | 2h |
| 2.3 | `loyalty.js` — remplacer 8 constantes fidélité | 1h |
| 2.4 | `pricing.js` + `rates.js` — coefficients | 1h |
| 2.5 | `sms.js` — intervalle cron | 0.5h |
| 2.6 | Tests de non-régression | 0.5h |

**Livrable** : Toutes les constantes sont variabilisées. Le comportement est identique (mêmes valeurs par défaut). L'admin peut maintenant ajuster sans déploiement.

### Phase 3 — Annulation & Remboursement (1 PR) ⏱️ ~8h

| # | Tâche | Effort |
|:-:|-------|:------:|
| 3.1 | `POST /api/orders/:id/cancel` — endpoint complet | 3h |
| 3.2 | Intégration Stripe refund | 2h |
| 3.3 | Système crédit boutique | 1.5h |
| 3.4 | SMS/Email annulation | 0.5h |
| 3.5 | Tests | 1h |

**Livrable** : Les clients peuvent annuler. Remboursement auto Stripe ou crédit boutique.

### Phase 4 — Expédition partielle (1 PR) ⏱️ ~6h

| # | Tâche | Effort |
|:-:|-------|:------:|
| 4.1 | Logique sous-commandes | 2h |
| 4.2 | Détection retard + déclenchement | 2h |
| 4.3 | Notifications client | 1h |
| 4.4 | Tests | 1h |

**Livrable** : Le système détecte les retards et propose/exécute les expéditions partielles.

### Phase 5 — Dashboard Configuration (1 PR) ⏱️ ~6h

| # | Tâche | Effort |
|:-:|-------|:------:|
| 5.1 | Vue ⚙️ Configuration dans dashboard-app | 4h |
| 5.2 | Indicateurs annulations/partielles dans vues Ops/Finance | 2h |

**Livrable** : L'admin a un cockpit complet pour piloter et ajuster les règles.

---

### 📊 Résumé

| Phase | Effort | Impact |
|-------|:------:|--------|
| Phase 1 — Fondations | 6h | Infrastructure zéro risque |
| Phase 2 — Migration constantes | 8h | 47 valeurs variabilisables |
| Phase 3 — Annulation | 8h | Nouveau flux client |
| Phase 4 — Expédition partielle | 6h | Logistique avancée |
| Phase 5 — Dashboard config | 6h | Interface admin |
| **TOTAL** | **34h** | **Gouvernance opérationnelle complète** |

---

### 🔄 Boucle retour d'expérience

```
┌────────────────────────────────────────────────────────────────┐
│                                                                 │
│   📊 Dashboard Pilotage                                        │
│   ├── L'admin observe les métriques (SLA, annulations, etc.)  │
│   ├── Constate un problème (ex: trop d'annulations hors fenêtre)│
│   └── Ajuste la règle via ⚙️ Configuration                    │
│         Ex: CANCEL_FREE_WINDOW_HOURS : 24 → 48                │
│                                                                 │
│   📜 Historique enregistré                                      │
│   ├── Qui: admin                                                │
│   ├── Quand: 2026-04-15 14:30                                   │
│   ├── Raison: "Retour terrain — 24h trop court pour Mohéli"   │
│   └── Ancienne valeur: 24 → Nouvelle: 48                       │
│                                                                 │
│   🔄 Effet immédiat                                             │
│   ├── Cache invalidé → nouvelle valeur active en < 1 min       │
│   ├── Prochaine commande: fenêtre 48h                          │
│   └── AUCUN déploiement nécessaire                              │
│                                                                 │
│   📈 Observer les résultats → ajuster → itérer                 │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

> 🔒 _"Le code définit les mécanismes. La base définit les seuils. Le terrain ajuste les seuils."_  
> — Gouvernance Opérationnelle Komerce v1.0
