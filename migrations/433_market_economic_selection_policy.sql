-- @migration 433_market_economic_selection_policy.sql
-- @domain economic-engine
-- @purpose Record explicit family-level selection thresholds with the existing append-only market policy.
ALTER TABLE public.pricing_market_decision_policy_events
  ADD COLUMN IF NOT EXISTS selection_by_family jsonb
  CHECK (selection_by_family IS NULL OR jsonb_typeof(selection_by_family) = 'object');

COMMENT ON COLUMN public.pricing_market_decision_policy_events.selection_by_family IS
  'Optional, versioned catalog-family selection thresholds. Older policy events keep NULL.';
