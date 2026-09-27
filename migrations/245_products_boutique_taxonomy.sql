-- @migration 245_products_boutique_taxonomy.sql
-- @domain    catalog
-- @purpose   Séparer taxonomie boutique et classification douanière produit
--
-- products.category reste la clé économique/douanière historique utilisée par
-- pricing/customs. Les deux colonnes ci-dessous portent uniquement la
-- taxonomie de merchandising/navigation de la boutique.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS boutique_category_key text,
  ADD COLUMN IF NOT EXISTS boutique_subcategory_key text;

COMMENT ON COLUMN products.boutique_category_key IS
  'Univers boutique canonique (ex. Mode & Beauté, Tech). Distinct de products.category, qui reste la classification économique/douanière.';

COMMENT ON COLUMN products.boutique_subcategory_key IS
  'Sous-catégorie boutique canonique, scoped par boutique_category_key.';

CREATE INDEX IF NOT EXISTS idx_products_boutique_taxonomy
  ON products (boutique_category_key, boutique_subcategory_key)
  WHERE boutique_category_key IS NOT NULL;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_boutique_subcategory_requires_category;

ALTER TABLE products
  ADD CONSTRAINT products_boutique_subcategory_requires_category
  CHECK (boutique_subcategory_key IS NULL OR boutique_category_key IS NOT NULL);
