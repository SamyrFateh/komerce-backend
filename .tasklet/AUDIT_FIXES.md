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
- **Fix appliqué** : Alignement du mapping sur l'ENUM `order_status`

### FIX-002 : CREATE TABLE parcels / parcel_items / parcel_status ABSENTS du repo
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `migrations/018_schema_reconciliation.sql`
- **Fix appliqué** : CREATE TYPE/TABLE IF NOT EXISTS

### FIX-003 : Trigger trg_scan_sync_status en conflit avec parcelSync
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `migrations/018_schema_reconciliation.sql`
- **Fix appliqué** : `DISABLE TRIGGER`

### FIX-004 : FOR UPDATE inefficace dans hub.js (race condition)
- **Statut** : ✅ FAIT (Étape 2)
- **Fichiers** : `routes/hub.js`, `utils/parcelSync.js`
- **Fix appliqué** :
  - `parcelSync.js` v2.1 : ajout paramètre optionnel `dbClient` à `syncScanToParcels()` et `safeSyncScanToParcels()`. Toutes les queries internes passent par `dbClient || db`.
  - `hub.js` : POST /scan et POST /seal exécutent `safeSyncScanToParcels(opts, client)` AVANT le COMMIT. Le verrou FOR UPDATE est maintenu pendant tout le sync.
  - Séquence corrigée : `BEGIN → SELECT FOR UPDATE → safeSyncScanToParcels(opts, client) → COMMIT`

### FIX-005 : finance.js référence 4 colonnes inexistantes
- **Statut** : ✅ FAIT (Étape 2)
- **Fichier** : `migrations/019_finance_columns.sql`
- **Fix appliqué** : `ALTER TABLE orders ADD COLUMN IF NOT EXISTS` pour :
  - `cost_real_kmf` NUMERIC(12,2)
  - `cost_estimated_kmf` NUMERIC(12,2)
  - `margin_real_pct` NUMERIC(5,2)
  - `order_occasion` TEXT
- **Note** : Colonnes ajoutées avec valeurs NULL. Le code finance.js reste inchangé.

---

## P1 — IMPORTANTS

### FIX-006 : scans.parcel_id absent du schéma
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `migrations/018_schema_reconciliation.sql`
- **Fix appliqué** : `ADD COLUMN + INDEX`

### FIX-007 : STATUS_TO_STEP utilise "preparing" au lieu de "preparation"
- **Statut** : ✅ FAIT (Étape 2)
- **Fichier** : `routes/parcels.js`
- **Fix appliqué** : Clé `preparing` → `preparation` dans le mapping STATUS_TO_STEP.

---

## P2 — MODÉRÉS

### FIX-008 : products.price_eur et products.badge non définis
- **Statut** : ✅ FAIT (Étape 1)
- **Fichier** : `migrations/018_schema_reconciliation.sql`
- **Fix appliqué** : `ADD COLUMN IF NOT EXISTS`

### FIX-009 : order_items.unit_price_kmf n'existe pas
- **Statut** : ✅ FAIT (Étape 2)
- **Fichier** : `routes/parcels.js`
- **Fix appliqué** : `oi.unit_price_kmf` → `oi.price_kmf` dans GET /parcels/:ref.

---

## P3 — MINEURS (dette technique)

### FIX-010 : pilotage.js orphelin (code mort)
- **Statut** : ✅ FAIT (Étape 3)
- **Fichier** : `routes/pilotage.js`
- **Fix appliqué** : Fichier supprimé. Était déjà commenté dans server.js, absorbé dans dashboard.js v11.

### FIX-011 : finance.js monté 2 fois
- **Statut** : ✅ FAIT (Étape 3)
- **Fichier** : `server.js`
- **Fix appliqué** : Un seul montage conservé (`/api/admin/finance` avec adminLimiter). Ancien `/api/finance` redirigé avec 301 JSON.

### FIX-012 : Seed data et fixMissingSchema dans server.js
- **Statut** : ✅ FAIT (Étape 3)
- **Fichiers** : `server.js` → `scripts/fix-schema.js` + `scripts/seed.js`
- **Fix appliqué** :
  - `fixAdminHash()` + `fixMissingSchema()` extraits dans `scripts/fix-schema.js`
  - `seedProducts()` + `seedRelais()` + `fixProductEncoding()` + `fixProductCategories()` + `fixProductImages()` extraits dans `scripts/seed.js`
  - `server.js` importe et appelle les deux modules au démarrage — même séquence, même comportement.
  - server.js passe de ~1100 lignes à ~260 lignes.

---

## RÉSUMÉ

| Priorité | Total | Terminés | Restants |
|----------|-------|---------|----------|
| 🔴 P0 | 5 | 5 | 0 |
| 🟡 P1 | 2 | 2 | 0 |
| 🟠 P2 | 2 | 2 | 0 |
| ⚪ P3 | 3 | 3 | 0 |
| **Total** | **12** | **12** | **0** |

✅ **AUDIT COMPLET — 12/12 fixes appliqués**

---

## STRATÉGIE DE FIX — HISTORIQUE

### ✅ Étape 1 : Migration 018 + FIX-001 (FAIT)
Migration 018_schema_reconciliation.sql + correction computeOrderStatus().
Branche : `fix/etape1-schema-reconciliation`

### ✅ Étape 2 : Fix code (FIX-004 + FIX-005 + FIX-007 + FIX-009) (FAIT)
- Restructuré hub.js transactions (FIX-004)
- Migration 019 pour colonnes finance (FIX-005)
- Fix STATUS_TO_STEP (FIX-007)
- Fix unit_price_kmf (FIX-009)
Branche : `fix/etape2-code-fixes`

### ✅ Étape 3 : Clean-up (FIX-010 + FIX-011 + FIX-012) (FAIT)
- Supprimé pilotage.js (FIX-010)
- Dé-dupliqué finance.js (FIX-011)
- Extrait seeds + migrations de server.js (FIX-012)
Branche : `fix/etape3-cleanup`

---

*Tracker créé le 7 avril 2026 — Audit Tasklet AI*
