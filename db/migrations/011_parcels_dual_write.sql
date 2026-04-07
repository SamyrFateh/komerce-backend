-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 011 — Refonte Parcel-Centric · Phase 2 : Double Écriture
--
-- OBJECTIF : Préparer la DB pour la double écriture scans → parcels.
--            Le trigger legacy trg_scan_sync_status reste actif.
--
-- IMPACT : MINIMAL. Index supplémentaires uniquement.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Index composite pour la résolution rapide parcel_items → parcel
-- Utilisé par syncScanToParcels() pour résoudre un order_item_id vers son parcel
CREATE INDEX IF NOT EXISTS idx_parcel_items_order_item_parcel
  ON parcel_items(order_item_id, parcel_id);

-- Index pour filtrer les parcels actifs d'un order rapidement
CREATE INDEX IF NOT EXISTS idx_parcels_order_active
  ON parcels(order_id) WHERE status != 'cancelled';

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIN Migration 011
-- ═══════════════════════════════════════════════════════════════════════════════
