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
- **Statut** : ❌ À FAIRE
- **Fichier** : `utils/parcels.js` (~lignes 82-110)
- **Problème** : `computeOrderStatus()` retourne `pending`, `delivered`, `processing`, `arrived` — 4 valeurs qui n'existent PAS dans l'ENUM `order_status`
- **ENUM valide** : `confirmed`, `ordered`, `preparation`, `shipped`, `in_transit`, `available`, `collected`, `cancelled`, `refunded`
- **Impact** : R1 cassée — `syncScanToParcels()` échoue silencieusement à chaque appel. Les commandes ne changent JAMAIS de statut via le chemin parcel-centric.
- **Fix** : Aligner le mapping retour de `computeOrderStatus()` :
  - `pending` → `confirmed`
  - `delivered` → `collected`
  - `processing` → `preparation`
  - `arrived` → `available` (ou `in_transit` selon la sémantique)
- **Tests** : Après fix, vérifier que `safeSyncScanToParcels()` retourne `{synced: true}`

### FIX-002 : CREATE TABLE parcels / parcel_items / parcel_status ABSENTS du repo
- **Statut** : ❌ À FAIRE
- **Fichiers** : `db/schema.sql`, `migrations/`
- **Problème** : Les tables `parcels`, `parcel_items` et le TYPE `parcel_status` sont utilisés partout dans le code mais jamais créés dans les fichiers du repo. Les migrations 001-013 sont absentes.
- **Impact** : Impossible de recréer la DB à partir du repo. Onboarding de développeur impossible.
- **Fix** : Créer une migration `018_schema_reconciliation.sql` qui :
  1. `CREATE TYPE IF NOT EXISTS parcel_status AS ENUM (...)`
  2. `CREATE TABLE IF NOT EXISTS parcels (...)`
  3. `CREATE TABLE IF NOT EXISTS parcel_items (...)`
  4. `CREATE TABLE IF NOT EXISTS customs_history (...)`
- **Note** : Bien utiliser `IF NOT EXISTS` car les tables existent déjà en prod.

### FIX-003 : Trigger trg_scan_sync_status en conflit avec parcelSync
- **Statut** : ❌ À FAIRE
- **Fichier** : `db/schema.sql` (trigger) vs `utils/parcelSync.js` (Phase 3)
- **Problème** : Le trigger `trg_scan_sync_status` est dans schema.sql mais parcelSync se déclare source unique. Aucun DISABLE TRIGGER dans le repo.
- **Impact** : Si DB recréée → double écriture de `orders.status` avec logiques contradictoires.
- **Fix** : Ajouter dans `018_schema_reconciliation.sql` :
  ```sql
  ALTER TABLE scans DISABLE TRIGGER trg_scan_sync_status;
  ```
  Et commenter/supprimer le trigger de schema.sql avec un commentaire expliquant pourquoi.

### FIX-004 : FOR UPDATE inefficace dans hub.js (race condition)
- **Statut** : ❌ À FAIRE
- **Fichier** : `routes/hub.js` (scan, pack, seal)
- **Problème** : Le COMMIT est fait AVANT l'appel à `safeSyncScanToParcels()`. Le verrou FOR UPDATE est relâché trop tôt.
- **Impact** : Race condition entre opérateurs hub (R2 partiellement cassée).
- **Fix** : Restructurer pour que `safeSyncScanToParcels()` s'exécute DANS la transaction :
  ```
  BEGIN → SELECT FOR UPDATE → UPDATE parcel → safeSyncScanToParcels(client) → COMMIT
  ```
  Passer le `client` de transaction à `safeSyncScanToParcels()` au lieu de `pool`.

### FIX-005 : finance.js référence 4 colonnes inexistantes
- **Statut** : ❌ À FAIRE
- **Fichier** : `routes/finance.js` (GET /export, GET /report)
- **Colonnes** : `orders.cost_real_kmf`, `orders.cost_estimated_kmf`, `orders.margin_real_pct`, `orders.order_occasion`
- **Impact** : Export CSV et rapport PDF cassés (erreur PostgreSQL).
- **Fix** : Deux options :
  - A) Ajouter les colonnes à `orders` dans la migration 018
  - B) Retirer les références du code finance.js
  → Décider selon le besoin métier.

---

## P1 — IMPORTANTS

### FIX-006 : scans.parcel_id absent du schéma
- **Statut** : ❌ À FAIRE
- **Fichier** : `utils/parcelSync.js` étape 3 + `db/schema.sql`
- **Problème** : `UPDATE scans SET parcel_id = $1` mais la colonne n'est pas définie.
- **Fix** : Ajouter dans migration 018 :
  ```sql
  ALTER TABLE scans ADD COLUMN IF NOT EXISTS parcel_id UUID REFERENCES parcels(id);
  CREATE INDEX IF NOT EXISTS idx_scans_parcel_id ON scans(parcel_id);
  ```

### FIX-007 : STATUS_TO_STEP utilise "preparing" au lieu de "preparation"
- **Statut** : ❌ À FAIRE
- **Fichier** : `routes/parcels.js` (~ligne 27)
- **Problème** : La clé `preparing` ne correspond à aucune valeur de `parcel_status`.
- **Fix** : Changer `preparing` → `preparation` dans le mapping.

---

## P2 — MODÉRÉS

### FIX-008 : products.price_eur et products.badge non définis
- **Statut** : ❌ À FAIRE
- **Fichier** : `server.js` seedProducts()
- **Fix** : Ajouter dans migration 018 :
  ```sql
  ALTER TABLE products ADD COLUMN IF NOT EXISTS price_eur NUMERIC(10,2);
  ALTER TABLE products ADD COLUMN IF NOT EXISTS badge TEXT;
  ```

### FIX-009 : order_items.unit_price_kmf n'existe pas
- **Statut** : ❌ À FAIRE
- **Fichier** : `routes/parcels.js` GET /:ref
- **Problème** : Code référence `oi.unit_price_kmf` mais la colonne s'appelle `oi.price_kmf`.
- **Fix** : Remplacer `oi.unit_price_kmf` par `oi.price_kmf`.

---

## P3 — MINEURS (dette technique)

### FIX-010 : pilotage.js orphelin (code mort)
- **Statut** : ❌ À FAIRE
- **Fichier** : `routes/pilotage.js`
- **Problème** : Fichier existant mais commenté dans server.js (non monté).
- **Fix** : Supprimer le fichier.

### FIX-011 : finance.js monté 2 fois
- **Statut** : ❌ À FAIRE
- **Fichier** : `server.js`
- **Problème** : Monté sur `/api/admin/finance` (adminLimiter) ET `/api/finance` (globalLimiter).
- **Fix** : Garder un seul montage (probablement `/api/admin/finance` avec adminLimiter).

### FIX-012 : Seed data et fixMissingSchema dans server.js
- **Statut** : ❌ À FAIRE
- **Fichier** : `server.js` (~700 lignes de seeds/migration)
- **Fix** : Extraire dans `scripts/seed.js` et `scripts/fix-schema.js`.

---

## RÉSUMÉ

| Priorité | Total | Terminés | Restants |
|----------|-------|---------|----------|
| 🔴 P0 | 5 | 0 | 5 |
| 🟡 P1 | 2 | 0 | 2 |
| 🟠 P2 | 2 | 0 | 2 |
| ⚪ P3 | 3 | 0 | 3 |
| **Total** | **12** | **0** | **12** |

---

## STRATÉGIE DE FIX RECOMMANDÉE

### Étape 1 : Migration 018 (FIX-002 + FIX-003 + FIX-006 + FIX-008)
Une seule migration qui réconcilie le schéma :
- CREATE TYPE/TABLE IF NOT EXISTS pour parcels, parcel_items, parcel_status, customs_history
- DISABLE TRIGGER trg_scan_sync_status
- ADD COLUMN IF NOT EXISTS pour scans.parcel_id, products.price_eur, products.badge

### Étape 2 : Fix code (FIX-001 + FIX-004 + FIX-005 + FIX-007 + FIX-009)
- Aligner computeOrderStatus() avec l'ENUM
- Restructurer hub.js transactions
- Corriger finance.js
- Fix STATUS_TO_STEP et unit_price_kmf

### Étape 3 : Clean-up (FIX-010 + FIX-011 + FIX-012)
- Supprimer pilotage.js
- Dé-dupliquer finance.js
- Extraire seeds de server.js

---

*Tracker créé le 7 avril 2026 — Audit Tasklet AI*
