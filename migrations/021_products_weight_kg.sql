-- ════════════════════════════════════════════════════════════════
-- KOMERCE — Migration 021 : Ajout products.weight_kg manquant
-- Date : 2026-04-08
-- Idempotente : IF NOT EXISTS
--
-- Contexte :
--   Migration 020 ajoute volume_cm3, category, is_fragile, is_bulky,
--   compatibility_group sur products — mais oublie weight_kg.
--   La route POST /api/parcels/optimize utilise p.weight_kg AS unit_weight
--   ce qui provoque une erreur PostgreSQL "column does not exist".
-- ════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(6,2);

CREATE INDEX IF NOT EXISTS idx_products_weight_kg ON products(weight_kg);

-- ════════════════════════════════════════════════════════════════
-- FIN migration 021
-- ════════════════════════════════════════════════════════════════
