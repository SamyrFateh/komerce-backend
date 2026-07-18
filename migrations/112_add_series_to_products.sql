-- ============================================================
-- Migration 112: Add series to products
-- Date: 2026-07-18
--
-- Adds a nullable `series` column to the products table.
-- `series` carries a commercial collection or line name
-- (e.g. "Golden Performance Series", "Collection Été 2026")
-- displayed as the second meta line in the PDP hero (spec M6).
--
-- Nullable — products without a series continue to work as
-- before. The PDP renderer applies a silent fallback when null.
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS series TEXT;

-- No index needed: series is display-only, never filtered on.

-- ============================================================
-- FIN migration 112
-- ============================================================
