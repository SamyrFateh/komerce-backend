-- ============================================================
-- Migration 081 — products.product_ref
-- Référence interne Komerce stable et lisible (RANK-02)
-- ============================================================
-- Doctrine :
--   products.id        = UUID technique DB, jamais exposé comme réf métier.
--   products.sku       = réf fournisseur / stock / variante, peut changer.
--   products.product_ref = réf interne Komerce stable, lisible, durable.
--
-- Format : KPR-XXXXXX (6 chiffres, séquence numérique DB).
--   Pas de catégorie dans la ref → stable si catégorie change.
--
-- Ordre d'application :
--   1. Ajout colonne nullable.
--   2. Création séquence (idempotente).
--   3. Backfill produits existants dans l'ordre de création.
--   4. Avance la séquence au-delà du backfill.
--   5. Pose le DEFAULT sur la colonne.
--   6. Contrainte UNIQUE.
-- ============================================================

-- 1. Colonne nullable (safe si migration rejouée partiellement)
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_ref TEXT;

-- 2. Séquence dédiée (idempotente)
CREATE SEQUENCE IF NOT EXISTS product_ref_seq START 1;

-- 3. Backfill produits existants sans product_ref, dans l'ordre created_at
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS n
  FROM products
  WHERE product_ref IS NULL
)
UPDATE products p
SET product_ref = 'KPR-' || LPAD(numbered.n::TEXT, 6, '0')
FROM numbered
WHERE p.id = numbered.id;

-- 4. Avance la séquence au-delà des valeurs backfillées
--    (au moins 1 pour éviter setval(0))
SELECT setval(
  'product_ref_seq',
  GREATEST(
    (SELECT COUNT(*) FROM products WHERE product_ref ~ '^KPR-\d+$'),
    1
  )
);

-- 5. Défaut automatique : nextval séquence → KPR-XXXXXX
ALTER TABLE products
  ALTER COLUMN product_ref
  SET DEFAULT 'KPR-' || LPAD(nextval('product_ref_seq')::TEXT, 6, '0');

-- 6. Contrainte d'unicité
ALTER TABLE products
  ADD CONSTRAINT products_product_ref_unique UNIQUE (product_ref);

-- 7. Commentaire de colonne
COMMENT ON COLUMN products.product_ref IS
  'Référence interne Komerce stable (KPR-XXXXXX). '
  'Indépendante de category/sku. '
  'Générée automatiquement à la création via séquence product_ref_seq.';
