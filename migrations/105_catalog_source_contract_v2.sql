-- @migration 105_catalog_source_contract_v2.sql
-- @domain    catalog
-- @purpose   PDC-1 — préserver la structure fournisseur riche normalisée sans l'aplatir
-- @added-header 2026-07-12
--
-- raw_payload reste la donnée fournisseur brute intégrale (ING-I3).
-- normalized_source_contract conserve séparément la TRADUCTION du connecteur
-- vers le contrat NormalizedSupplierProduct V2, sans raw_payload dupliqué.
-- Cette colonne n'est PAS le catalogue canonique et ne pilote aucun stock :
-- PDC-2 décidera explicitement comment promouvoir media / option_axes /
-- sellable_units vers les structures catalogue propriétaires.

ALTER TABLE public.sourcing_candidates
  ADD COLUMN IF NOT EXISTS normalized_source_contract jsonb;

ALTER TABLE public.sourcing_candidates
  DROP CONSTRAINT IF EXISTS chk_sourcing_candidates_normalized_source_contract_object;

ALTER TABLE public.sourcing_candidates
  ADD CONSTRAINT chk_sourcing_candidates_normalized_source_contract_object
  CHECK (
    normalized_source_contract IS NULL
    OR jsonb_typeof(normalized_source_contract) = 'object'
  );

COMMENT ON COLUMN public.sourcing_candidates.normalized_source_contract IS
  'Snapshot du NormalizedSupplierProduct V2 validé, sans raw_payload. '
  'Préserve les mappings media/option_axes/sellable_units du connecteur. '
  'NULL pour les contrats V1. Ne constitue pas la vérité catalogue ni stock.';
