-- ============================================
-- KOMERCE — Migration v7.1 (FIXED)
-- Ajout colonne price_eur + initialisation
-- ============================================

BEGIN;

-- 1️⃣ Ajouter la colonne
ALTER TABLE products
ADD COLUMN IF NOT EXISTS price_eur NUMERIC(12,2);

-- 2️⃣ Initialiser depuis price_kmf
UPDATE products
SET price_eur = ROUND((price_kmf / 492.0)::numeric, 2)
WHERE price_eur IS NULL
  AND price_kmf IS NOT NULL;

-- 3️⃣ Ajouter la contrainte (compatible PostgreSQL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'price_eur_positive'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT price_eur_positive
    CHECK (price_eur IS NULL OR price_eur >= 0);
  END IF;
END $$;

-- 4️⃣ Index
CREATE INDEX IF NOT EXISTS idx_products_price_eur
ON products(price_eur);

COMMIT;
