-- @migration 293_sourcing_candidate_boutique_taxonomy.sql
-- @domain sourcing
-- @purpose Store confirmed commercial classification separately from economic customs state.
ALTER TABLE sourcing_candidates ADD COLUMN IF NOT EXISTS commercial_taxonomy_review jsonb;
COMMENT ON COLUMN sourcing_candidates.commercial_taxonomy_review IS 'Boutique classification from confirmed supplier mapping; no customs, pricing, publication or KIR decision authority.';
