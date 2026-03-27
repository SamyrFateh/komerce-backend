-- ============================================
-- KOMERCE — Migration de rattrapage (products)
-- Aligne la table products avec le code backend
-- ============================================

BEGIN;

-- Prix
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_aed NUMERIC(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_kmf INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS price_eur NUMERIC(12,2);

-- Dimensions / poids
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(10,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS dimensions_cm TEXT;

-- Stock & médias
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS badge TEXT;

-- Flags produit
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_couture BOOLEAN NOT NULL DEFAULT FALSE;

-- Sourcing & tri
ALTER TABLE products ADD COLUMN IF NOT EXISTS sourcing_source TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Douane
ALTER TABLE products
ADD COLUMN IF NOT EXISTS customs_risk_coeff NUMERIC(5,3) NOT NULL DEFAULT 1.200;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS customs_risk_updated DATE;

-- Initialisation EUR
UPDATE products
SET price_eur = ROUND((price_kmf / 492.0)::numeric, 2)
WHERE price_eur IS NULL
  AND price_kmf IS NOT NULL;

COMMIT;
