# KOMERCE BACKEND — AUDIT FIXES TRACKER

> **Date audit** : 7 avril 2026
> **Dernière mise à jour** : 7 avril 2026

---

## LÉGENDE
- 🔴 **P0** = Critique — casse le fonctionnement actuel
- 🟡 **P1** = Important — fonctionnalité dégradée
- 🟠 **P2** = Modéré — bug non bloquant
- ⚪ **P3** = Mineur — dette technique / clean-up

---

## P0 — CRITIQUES

### FIX-001 : computeOrderStatus() retourne des valeurs ENUM invalides
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `utils/parcels.js`
- **Fix appliqué** : Alignement du mapping sur l'ENUM `order_status` :
  - `pending` → `confirmed`
  - `delivered` → `collected`
  - `processing` → `preparation`
  - `arrived` → `in_transit`
  - Ajout de `ARRIVED` dans le check `inMovement`

### FIX-002 : CREATE TABLE parcels / parcel_items / parcel_status ABSENTS du repo
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `migrations/018_schema_reconciliation.sql`
- **Fix appliqué** : CREATE TYPE/TABLE IF NOT EXISTS pour `parcel_status`, `parcels`, `parcel_items`, `customs_history`

### FIX-003 : Trigger trg_scan_sync_status en conflit avec parcelSync
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `migrations/018_schema_reconciliation.sql`
- **Fix appliqué** : `ALTER TABLE scans DISABLE TRIGGER trg_scan_sync_status;`

### FIX-004 : FOR UPDATE inefficace dans hub.js (race condition)
- **Statut** : ❌ À FAIRE (Étape 2)
- **Fichier** : `routes/hub.js` (scan, pack, seal)
- **Problème** : Le COMMIT est fait AVANT l'appel à `safeSyncScanToParcels()`. Le verrou FOR UPDATE est relâché trop tôt.
- **Impact** : Race condition entre opérateurs hub (R2 partiellement cassée).
- **Fix** : Restructurer pour que `safeSyncScanToParcels()` s'exécute DANS la transaction :
  ```
  BEGIN → SELECT FOR UPDATE → UPDATE parcel → safeSyncScanToParcels(client) → COMMIT
  ```
  Passer le `client` de transaction à `safeSyncScanToParcels()` au lieu de `pool`.

### FIX-005 : finance.js référence 4 colonnes inexistantes
- **Statut** : ❌ À FAIRE (Étape 2)
- **Fichier** : `routes/finance.js` (GET /export, GET /report)
- **Colonnes** : `orders.cost_real_kmf`, `orders.cost_estimated_kmf`, `orders.margin_real_pct`, `orders.order_occasion`
- **Impact** : Export CSV et rapport PDF cassés (erreur PostgreSQL).
- **Fix** : Deux options :
  - A) Ajouter les colonnes à `orders` dans une migration
  - B) Retirer les références du code finance.js
  → Décider selon le besoin métier.

---

## P1 — IMPORTANTS

### FIX-006 : scans.parcel_id absent du schéma
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `migrations/018_schema_reconciliation.sql`
- **Fix appliqué** : `ALTER TABLE scans ADD COLUMN IF NOT EXISTS parcel_id UUID REFERENCES parcels(id);` + index

### FIX-007 : STATUS_TO_STEP utilise "preparing" au lieu de "preparation"
- **Statut** : ❌ À FAIRE (Étape 2)
- **Fichier** : `routes/parcels.js` (~ligne 27)
- **Problème** : La clé `preparing` ne correspond à aucune valeur de `parcel_status`.
- **Fix** : Changer `preparing` → `preparation` dans le mapping.

---

## P2 — MODÉRÉS

### FIX-008 : products.price_eur et products.badge non définis
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `migrations/018_schema_reconciliation.sql`
- **Fix appliqué** : `ALTER TABLE products ADD COLUMN IF NOT EXISTS price_eur/badge;`

### FIX-009 : order_items.unit_price_kmf n'existe pas
- **Statut** : ❌ À FAIRE (Étape 2)
- **Fichier** : `routes/parcels.js` GET /:ref
- **Problème** : Code référence `oi.unit_price_kmf` mais la colonne s'appelle `oi.price_kmf`.
- **Fix** : Remplacer `oi.unit_price_kmf` par `oi.price_kmf`.

---

## P3 — MINEURS (dette technique)

### FIX-010 : pilotage.js orphelin (code mort)
- **Statut** : ❌ À FAIRE (Étape 3)
- **Fichier** : `routes/pilotage.js`
- **Problème** : Fichier existant mais commenté dans server.js (non monté).
- **Fix** : Supprimer le fichier.

### FIX-011 : finance.js monté 2 fois
- **Statut** : ❌ À FAIRE (Étape 3)
- **Fichier** : `server.js`
- **Problème** : Monté sur `/api/admin/finance` (adminLimiter) ET `/api/finance` (globalLimiter).
- **Fix** : Garder un seul montage (probablement `/api/admin/finance` avec adminLimiter).

### FIX-012 : Seed data et fixMissingSchema dans server.js
- **Statut** : ❌ À FAIRE (Étape 3)
- **Fichier** : `server.js` (~700 lignes de seeds/migration)
- **Fix** : Extraire dans `scripts/seed.js` et `scripts/fix-schema.js`.

---

## RÉSUMÉ

| Priorité | Total | Terminés | Restants |
|----------|-------|---------|----------|
| 🔴 P0 | 5 | 3 | 2 |
| 🟡 P1 | 2 | 1 | 1 |
| 🟠 P2 | 2 | 1 | 1 |
| ⚪ P3 | 3 | 0 | 3 |
| **Total** | **12** | **5** | **7** |

---

## STRATÉGIE DE FIX RECOMMANDÉE

### ✅ Étape 1 : Migration 018 + FIX-001 (FAIT)
Migration 018_schema_reconciliation.sql + correction computeOrderStatus().
Branche : `fix/etape1-schema-reconciliation`

### Étape 2 : Fix code (FIX-004 + FIX-005 + FIX-007 + FIX-009)
- Restructurer hub.js transactions (FIX-004)
- Corriger finance.js (FIX-005)
- Fix STATUS_TO_STEP (FIX-007)
- Fix unit_price_kmf (FIX-009)

### Étape 3 : Clean-up (FIX-010 + FIX-011 + FIX-012)
- Supprimer pilotage.js
- Dé-dupliquer finance.js
- Extraire seeds de server.js

---

*Tracker créé le 7 avril 2026 — Audit Tasklet AI*
