-- ============================================================
-- Migration 060 : Colonnes pending_at et confirmed_at sur orders
-- Date : mai 2026
--
-- CONTEXTE :
--   services/order-status-machine.js v1.4 référence ces colonnes
--   dans STATUS_TIMESTAMP (pending_at, confirmed_at) mais elles
--   n'existaient dans aucune migration ni dans schema.sql.
--
--   Sans ces colonnes, toute transition pending → confirmed via
--   transitionOrderStatus() plante avec :
--     "column confirmed_at does not exist"
--
-- IDEMPOTENT (ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pending_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Index léger pour les requêtes d'analyse (optionnel, non bloquant)
CREATE INDEX IF NOT EXISTS idx_orders_confirmed_at ON orders(confirmed_at)
  WHERE confirmed_at IS NOT NULL;

COMMENT ON COLUMN orders.pending_at   IS 'Timestamp de création de la commande (status=pending). Positionné ONCE via COALESCE.';
COMMENT ON COLUMN orders.confirmed_at IS 'Timestamp de confirmation du paiement (status=confirmed). Positionné ONCE via COALESCE.';
