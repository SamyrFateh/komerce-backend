-- @migration 102_sourcing_candidates_raw_payload.sql
-- @domain    catalog
-- @purpose   ING-5 (verrou 4) — persister le payload fournisseur brut intégral
--            sur sourcing_candidates. Matière première de la rejouabilité
--            (DOCTRINE_CATALOGUE §5) et de l'éligibilité (ING-I3) : une
--            colonne non mappée comme hazmat_class doit pouvoir matcher une
--            exclusion, ce qui exige que rien ne soit perdu à la normalisation.
-- @doctrine  DOCTRINE_INGESTION_CATALOGUE.md ING-I3, CHANTIERS_INGESTION_CATALOGUE.md ING-5
-- Idempotente : IF NOT EXISTS.

SET client_encoding = 'UTF8';

ALTER TABLE sourcing_candidates ADD COLUMN IF NOT EXISTS raw_payload jsonb;

COMMENT ON COLUMN sourcing_candidates.raw_payload IS
  'Payload fournisseur brut intégral (toutes colonnes, y compris non mappées). '
  'Jamais lu par la boutique. Sert la rejouabilité et l''éligibilité douane '
  '(une colonne inconnue type hazmat_class doit pouvoir matcher une exclusion). '
  'NULL = candidat créé avant ING-5 (legacy, pas de brut disponible).';

DO $$
BEGIN
  RAISE NOTICE 'Migration 102 OK : raw_payload persisté sur sourcing_candidates (ING-5 verrou 4)';
END $$;
