-- ============================================================
-- Migration 038: price_history (audit des changements de prix)
-- Date: avril 2026
-- Version ASCII pure pour psql Windows
--
-- OBJECTIF: tracer chaque modification de price_kmf depuis le pricing
--           pour pouvoir auditer "qui a applique tel prix sur tel produit
--           a tel moment et avec quelle source (reco/batch/manual)".
-- ============================================================

SET client_encoding = 'UTF8';

CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price_kmf NUMERIC,
  new_price_kmf NUMERIC NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'reco' | 'batch' | 'import'
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_applied_at ON price_history(applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_source ON price_history(source, applied_at DESC);
