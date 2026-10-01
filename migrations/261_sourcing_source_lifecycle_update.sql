-- @migration 261_sourcing_source_lifecycle_update.sql
-- @domain    sourcing
-- @purpose   Mise à jour opérateur d'une source sans jamais supprimer son historique :
--            (1) libellé opérateur (display_name) ; (2) trace des transitions de cycle de
--            vie (archivage / restauration) dans sourcing_provider_control_events.
--
-- Additif et idempotent. Aucune ligne supprimée ; captures, observations et KIR intacts.

ALTER TABLE public.sourcing_sources
  ADD COLUMN IF NOT EXISTS display_name text;

ALTER TABLE public.sourcing_sources
  DROP CONSTRAINT IF EXISTS sourcing_sources_display_name_chk;
ALTER TABLE public.sourcing_sources
  ADD CONSTRAINT sourcing_sources_display_name_chk
  CHECK (display_name IS NULL OR (btrim(display_name) <> '' AND char_length(display_name) <= 80));

COMMENT ON COLUMN public.sourcing_sources.display_name IS
  'Libellé opérateur de la source (affichage uniquement, NULL = libellé du connecteur). Jamais un identifiant.';

-- Étend la trace des contrôles au cycle de vie : old_value/new_value = « source active ».
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.sourcing_provider_control_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%capability%'
  LOOP
    EXECUTE format('ALTER TABLE public.sourcing_provider_control_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.sourcing_provider_control_events
  ADD CONSTRAINT sourcing_provider_control_events_capability_check
  CHECK (capability IN ('discovery', 'sync', 'import', 'production', 'lifecycle'));
