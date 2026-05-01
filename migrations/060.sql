-- ============================================================
-- Migration 060 : Colonnes pending_at et confirmed_at sur orders
-- IDEMPOTENT (ADD COLUMN IF NOT EXISTS)
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pending_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_confirmed_at ON orders(confirmed_at)
  WHERE confirmed_at IS NOT NULL;

COMMENT ON COLUMN orders.pending_at   IS 'Timestamp de création de la commande (status=pending).';
COMMENT ON COLUMN orders.confirmed_at IS 'Timestamp de confirmation du paiement (status=confirmed).';