-- ============================================================
-- Migration 025: Add subcategory to products
-- Date: 20 avril 2026
--
-- Prepares the products table for subcategory support.
-- The subcategory column is nullable — products without a 
-- subcategory will continue to work as before.
--
-- Example values:
--   category='Mode'    → subcategory='Robes', 'Chaussures', 'Sacs'
--   category='Tech'    → subcategory='Smartphones', 'Écouteurs', 'Chargeurs'
--   category='Enfant'  → subcategory='Jouets', 'Vêtements', 'Scolaire'
-- ============================================================

-- Add subcategory column (nullable, no constraint)
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT;

-- Index for filtering by category + subcategory
CREATE INDEX IF NOT EXISTS idx_products_category_subcategory 
  ON products(category, subcategory) 
  WHERE is_available = TRUE;

-- ============================================================
-- FIN migration 025
-- ============================================================
