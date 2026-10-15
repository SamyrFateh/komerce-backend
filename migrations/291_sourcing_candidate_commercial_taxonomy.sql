-- Commercial boutique classification is independent from economic/customs qualification.
ALTER TABLE sourcing_candidates ADD COLUMN IF NOT EXISTS commercial_taxonomy_review jsonb;
COMMENT ON COLUMN sourcing_candidates.commercial_taxonomy_review IS 'Human-confirmed boutique category/subcategory; never implies customs validation or permission to publish.';
