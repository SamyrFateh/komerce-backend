-- @migration 254_provider_control_policy.sql
-- @domain sourcing
-- Operator policy is independent from source lifecycle and existing autopilot.
-- Safe default: no newly introduced capability is authorized automatically.
ALTER TABLE public.sourcing_sources
  ADD COLUMN IF NOT EXISTS discovery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS production_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.sourcing_provider_control_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES public.sourcing_sources(source_id),
  capability text NOT NULL CHECK (capability IN ('discovery','sync','import','production')),
  old_value boolean NOT NULL,
  new_value boolean NOT NULL,
  actor_id text,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
