-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 013 — Refonte Parcel-Centric · Phase 4 : Nettoyage Legacy
--
-- OBJECTIF : Supprimer tous les artefacts legacy de l'architecture order-centric
--            maintenant que parcels/parcel_items sont la source de vérité.
--
-- CHANGEMENTS :
--   1. Ajouter colonnes manquantes sur parcels (cancel_reason, estimated_date, backorder_reminder_sent)
--   2. DROP orders.computed_status (deprecated Phase 3)
--   3. DROP trigger trg_scan_sync_status (désactivé Phase 3)
--   4. DROP function sync_order_status_from_scan()
--   5. DROP tables sub_order_items + sub_orders (data migrée en Phase 1, migration 010)
--
-- PRÉ-REQUIS : Migrations 010-012 appliquées
-- ROLLBACK : Non recommandé. Les données sub_orders sont dans parcels depuis 010.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Enrichir parcels avec les colonnes manquantes de sub_orders
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS estimated_date TIMESTAMPTZ;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS backorder_reminder_sent BOOLEAN DEFAULT FALSE;

-- 2. DROP orders.computed_status (marquée DEPRECATED en migration 012)
ALTER TABLE orders DROP COLUMN IF EXISTS computed_status;

-- 3. DROP trigger legacy (désactivé en migration 012)
DROP TRIGGER IF EXISTS trg_scan_sync_status ON scans;

-- 4. DROP function legacy (plus aucun appelant)
DROP FUNCTION IF EXISTS sync_order_status_from_scan();

-- 5. DROP tables legacy (données migrées vers parcels/parcel_items en migration 010)
-- sub_order_items dépend de sub_orders → supprimer en premier
DROP TABLE IF EXISTS sub_order_items CASCADE;
DROP TABLE IF EXISTS sub_orders CASCADE;

-- 6. Nettoyage index orphelins
DROP INDEX IF EXISTS idx_sub_orders_parent;
DROP INDEX IF EXISTS idx_sub_orders_status;
DROP INDEX IF EXISTS idx_sub_orders_type;
DROP INDEX IF EXISTS idx_sub_order_items_sub;

COMMIT;
