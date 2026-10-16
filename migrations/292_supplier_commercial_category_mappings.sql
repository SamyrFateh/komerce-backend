-- @migration 292_supplier_commercial_category_mappings.sql
-- @domain sourcing
-- @purpose Reusable supplier-category -> boutique taxonomy mappings, never customs.
CREATE TABLE IF NOT EXISTS supplier_commercial_category_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  source_category_id text,
  source_category_path text NOT NULL,
  source_locale text NOT NULL DEFAULT 'en',
  proposed_label_fr text,
  boutique_category_key text,
  boutique_subcategory_key text,
  status text NOT NULL DEFAULT 'PROPOSED'
    CHECK (status IN ('PROPOSED','CONFIRMED','REVIEW_REQUIRED')),
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_commercial_mapping_pair CHECK (
    (boutique_category_key IS NULL AND boutique_subcategory_key IS NULL)
    OR (boutique_category_key IS NOT NULL AND boutique_subcategory_key IS NOT NULL)
  ),
  CONSTRAINT supplier_commercial_mapping_confirmed CHECK (
    status <> 'CONFIRMED' OR (
      boutique_category_key IS NOT NULL AND boutique_subcategory_key IS NOT NULL
      AND confirmed_at IS NOT NULL
    )
  ),
  CONSTRAINT supplier_commercial_mapping_unique UNIQUE(provider, source_category_path)
);
COMMENT ON TABLE supplier_commercial_category_mappings IS
  'Source taxonomy mapping and FR merchandising labels; category unknown never rejects a candidate; no customs or pricing authority.';
CREATE INDEX IF NOT EXISTS idx_supplier_commercial_mapping_status
  ON supplier_commercial_category_mappings(provider,status);
