# 🔴 RAPPORT D'AUDIT — Cartographie 360° Komerce Backend

> 📅 Audit réalisé le 06/04/2026
> 🔬 Méthode : extraction programmatique exhaustive de chaque fichier source

---

## 📊 Résumé des écarts

| Métrique | Carto actuelle | Code réel | Écart |
|----------|---------------|-----------|-------|
| **Endpoints** | 112 | **~127** (119 base + 7 nouveaux Phase 3-4 + 1 server.js) | ❌ Header à mettre à jour |
| **Tables créées** (CREATE TABLE dans repo) | 24 | **19** | ❌ Confusion tables/vues/Supabase |
| **Tables Supabase-only** (pas de CREATE dans repo) | incluses dans 24 | **7** | ⚠️ Non distinguées |
| **Vues** | "2 vues" (header) / "3 vues" (footer) | **3** (1 dans repo + 2 Supabase) | ❌ Incohérent |
| **Provider SMS** | SMS (Orange) | **Africa's Talking** (africastalking) | ❌ FAUX |
| **Provider Email** | Email (Mailjet) | **Nodemailer** | ❌ FAUX |

---

## 🔴 Erreur 1 : Comptage endpoints (112 → 120)

Le header annonce **112 endpoints** mais le total réel par route est **119 + 1 server.js = 120**.

Pourtant, la matrice endpoints dans la carto liste bien les bons endpoints par route. C'est **juste le total du header qui est faux**.

| Route | Code réel | Carto | Delta |
|-------|-----------|-------|-------|
| admin.js | 17 | 17 | ✅ |
| auth.js | 9 | 9 | ✅ |
| baskets.js | 7 | 7 | ✅ |
| dashboard.js | 5 | 5 | ✅ |
| finance.js | 4 | 4 | ✅ |
| health.js | 2 | 2 | ✅ |
| logistics.js | 5 | 5 | ✅ |
| loyalty.js | 7 | 7 | ✅ |
| modules.js | 7 | 7 | ✅ |
| orders.js | 10 | 10 | ✅ |
| payments.js | 5 | 5 | ✅ |
| pilotage.js | 3 | 3 | ✅ |
| pricing.js | 4 | 4 | ✅ |
| products.js | 8 | 8 | ✅ |
| purchasing.js | 10 | 10 | ✅ |
| relais.js | 3 | 3 | ✅ |
| scans.js | 6 | 6 | ✅ |
| unsold.js | 7 | 7 | ✅ |
| server.js (direct) | 1 | 1 (mentionné) | ✅ |
| **TOTAL** | **120** | **"112"** | **❌ -8** |

---

## 🔴 Erreur 2 : Provider SMS — Orange → Africa's Talking

**La carto dit** : `SMS (Orange)`
**Le code dit** : `africastalking ^0.7.2` (package.json) avec `AT_API_KEY`, `AT_USERNAME`

Le fichier `utils/sms.js` utilise clairement le SDK `africastalking`. Aucune référence à Orange dans le code.

---

## 🔴 Erreur 3 : Provider Email — Mailjet → Nodemailer

**La carto dit** : `Email (Mailjet)`
**Le code dit** : `nodemailer ^6.9.14` (package.json)

Le fichier `utils/email.js` utilise `nodemailer`, pas Mailjet.

---

## 🔴 Erreur 4 : 5 tables manquantes dans la carto

Ces tables ont un `CREATE TABLE` dans le repo mais **n'apparaissent pas dans la carto** :

| Table | Fichier source | Description |
|-------|---------------|-------------|
| `sms_log` | schema.sql | Log de tous les SMS envoyés |
| `disputes` | schema.sql | Litiges/réclamations clients |
| `ceremony_fabrics` | schema_extension.sql | Tissus pour module cérémonie |
| `ceremony_models` | schema_extension.sql | Modèles pour module cérémonie |
| `ceremony_order_items` | schema_extension.sql | Items commande cérémonie |

---

## 🔴 Erreur 5 : Confusion tables `fabrics` vs `ceremony_fabrics`

Le code dans `modules.js` et `pricing.js` requête les tables **`fabrics`** et **`garment_models`**.
Le schema_extension.sql crée **`ceremony_fabrics`** et **`ceremony_models`**.

Ce sont des tables **DIFFÉRENTES** ! Les tables `fabrics` et `garment_models` sont probablement créées dans Supabase ou via un script non inclus dans le repo.

---

## 🔴 Erreur 6 : Footer incohérent et fabricé

Le footer "Dernière analyse automatique" du document contient :
- **20 tables** (vs 24 dans le header, vs 19+7 réel)
- **550 alertes sécurité** (chiffre non vérifiable)
- **100/100 score de risque** (chiffre non vérifiable)

Ce footer semble auto-généré et n'est pas fiable.

---

## 🔴 Erreur 7 : Comptage vues incohérent

- Header : "2 vues"
- Section 9 : liste 3 vues
- Footer : "3 vues"

**Réalité dans le code :**
| Vue | Créée dans | Source |
|-----|-----------|--------|
| `customs_taux_mensuel` | server.js | `CREATE OR REPLACE VIEW` ✅ |
| `v_loyalty_summary` | Supabase (pas dans repo) | Requêtée dans loyalty.js |
| `v_unsold_pipeline` | Supabase (pas dans repo) | Requêtée dans unsold.js |

→ **1 vue dans le repo, 2 vues Supabase-only, 3 vues total**

---

## 🔴 Erreur 8 : Middleware validate manquant pour products.js

La matrice middleware dit que products.js n'utilise **pas** validate.
**Réalité** : products.js importe `validate` et fait **3 appels** à `validate()`.

### Matrice validate correcte :

| Route | validate dans carto | validate dans code | Statut |
|-------|--------------------|--------------------|--------|
| admin.js | ✅ | ✅ (4 appels) | ✅ |
| auth.js | ✅ | ✅ (7 appels) | ✅ |
| baskets.js | ✅ | ✅ (4 appels) | ✅ |
| dashboard.js | ❌ | ❌ | ✅ |
| finance.js | ❌ | ❌ | ✅ |
| health.js | ❌ | ❌ | ✅ |
| logistics.js | ✅ | ✅ (2 appels) | ✅ |
| loyalty.js | ❌ | ❌ | ✅ |
| modules.js | ✅ | ✅ (3 appels) | ✅ |
| orders.js | ✅ | ✅ (3 appels) | ✅ |
| payments.js | ✅ | ✅ (2 appels) | ✅ |
| pilotage.js | ❌ | ❌ | ✅ |
| pricing.js | ❌ | ❌ | ✅ |
| **products.js** | **❌** | **✅ (3 appels)** | **❌ ERREUR** |
| purchasing.js | ❌ | ❌ | ✅ |
| relais.js | ❌ | ❌ | ✅ |
| scans.js | ✅ | ✅ (4 appels) | ✅ |
| unsold.js | ❌ | ❌ | ✅ |

---

## 📋 Inventaire complet vérifié

### Tables avec CREATE TABLE dans le repo (19)

| # | Table | Source |
|---|-------|--------|
| 1 | users | schema.sql |
| 2 | relais | schema.sql |
| 3 | products | schema.sql |
| 4 | baskets | schema.sql |
| 5 | basket_items | schema.sql |
| 6 | recipients | schema.sql |
| 7 | shipments | schema.sql |
| 8 | orders | schema.sql |
| 9 | order_items | schema.sql |
| 10 | scans | schema.sql |
| 11 | order_status_history | schema.sql |
| 12 | sms_log | schema.sql |
| 13 | exchange_rates | schema.sql |
| 14 | disputes | schema.sql |
| 15 | ceremony_fabrics | schema_extension.sql |
| 16 | ceremony_models | schema_extension.sql |
| 17 | ceremony_order_items | schema_extension.sql |
| 18 | partners | server.js |
| 19 | loyalty_tiers | server.js |

### Tables/vues Supabase-only (9)

| # | Nom | Type | Requêtée dans |
|---|-----|------|---------------|
| 1 | customs_history | Table | admin.js, orders.js, server.js |
| 2 | fabrics | Table | modules.js, pricing.js |
| 3 | garment_models | Table | modules.js, pricing.js |
| 4 | product_suppliers | Table | purchasing.js, scans.js |
| 5 | purchase_orders | Table | purchasing.js, scans.js |
| 6 | suppliers | Table | purchasing.js |
| 7 | unsold_items | Table | unsold.js |
| 8 | v_loyalty_summary | Vue | loyalty.js |
| 9 | v_unsold_pipeline | Vue | unsold.js |

### Vue créée dans le repo (1)

| # | Vue | Source |
|---|-----|--------|
| 1 | customs_taux_mensuel | server.js |

### Enums (6)
user_role, order_status, payment_mode, payment_status, basket_type, scan_step

### Functions (2)
set_updated_at, sync_order_status_from_scan

### Triggers (6)
trg_users_updated, trg_products_updated, trg_orders_updated, trg_shipments_updated, trg_scan_sync_status, trg_disputes_updated

---

## ✅ Ce qui est CORRECT dans la carto actuelle

- ✅ Liste des 18 routes et leurs endpoints (descriptions détaillées)
- ✅ Pipeline de commande (9 statuts, transitions)
- ✅ Matrice des dépendances inter-routes
- ✅ Architecture diagram (globalement correct)
- ✅ Rate limiters (6 limiteurs)
- ✅ Schéma DB pour les tables présentes
- ✅ Services externes Stripe, JWT, bcrypt, PDFKit, QRCode

---

## 🛡️ Corrections appliquées (PR #106, #108)

| Date | PR | Correction |
|------|-----|------------|
| 07/04/2026 | #106 | 2 injections SQL corrigées dans `orders.js` (`/problems`, `pickup_code`) — requêtes paramétrées |
| 07/04/2026 | #106 | Toutes les interpolations `business_rules` passent par `getRuleNumber()` qui force le cast Number (anti-injection) |
| 07/04/2026 | #108 | `utils/sms.js` — backticks imbriquées remplacées par requêtes paramétrées `$1`, `$2` |
| 07/04/2026 | #115 | Phase 5.2 — `GET /api/dashboard/annulations-parcels` : endpoint protégé par `authMiddleware`, requêtes SQL paramétrées, fallback gracieux frontend |

---

## 🎯 Actions recommandées

1. **Corriger le header** : 112 → 120 endpoints
2. **Corriger les providers** : Orange → Africa's Talking, Mailjet → Nodemailer
3. **Ajouter les 5 tables manquantes** dans le schéma et la matrice
4. **Distinguer tables repo vs Supabase-only**
5. **Corriger validate middleware** pour products.js
6. **Supprimer le footer fabricé**
7. **Harmoniser le comptage vues** : 3 vues (1 repo + 2 Supabase)
