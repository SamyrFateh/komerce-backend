-- @migration 238_sourcing_source_autopilot.sql
-- @domain    sourcing
-- @purpose   Séparer l'existence/validité d'une source de son autorisation
--            d'acquisition automatique. Les sources historiques restent donc
--            inertes tant qu'un opérateur n'a pas explicitement mis l'autopilot ON.

ALTER TABLE public.sourcing_sources
  ADD COLUMN IF NOT EXISTS autopilot_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_sourcing_sources_autopilot_enabled
  ON public.sourcing_sources (updated_at, source_id)
  WHERE autopilot_enabled = true
    AND status = 'active'
    AND acquisition = 'pull'
    AND continuity = 'recurring';

COMMENT ON COLUMN public.sourcing_sources.autopilot_enabled IS
  'Autorisation explicite de collecte automatique récurrente. Défaut false : aucune source historique ne démarre sans action opérateur.';
