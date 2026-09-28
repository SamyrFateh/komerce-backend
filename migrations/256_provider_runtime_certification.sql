-- @migration 256_provider_runtime_certification.sql
-- @domain sourcing
-- A provider can enter production only after a real API import reached CANONICAL_RESOLVED.
-- Evidence is durable and points to the exact completed sourcing capture that proved the runtime path.

ALTER TABLE public.sourcing_sources
  ADD COLUMN IF NOT EXISTS production_certified_capture_id uuid REFERENCES public.sourcing_captures(capture_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_certified_at timestamptz;
