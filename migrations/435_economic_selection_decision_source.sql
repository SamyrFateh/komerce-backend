-- @migration 435_economic_selection_decision_source.sql
-- @domain economic-engine
-- @purpose Distinguish policy automation from a human authorization without impersonation.
ALTER TABLE public.economic_sku_rail_selection_events
  ADD COLUMN decision_source text NOT NULL DEFAULT 'MANUAL';

ALTER TABLE public.economic_sku_rail_selection_events
  ALTER COLUMN actor_id DROP NOT NULL,
  ADD CONSTRAINT economic_selection_decision_source_check
    CHECK ((decision_source = 'MANUAL' AND actor_id IS NOT NULL)
        OR (decision_source = 'POLICY_AUTOMATION' AND actor_id IS NULL AND action = 'WITHDRAW'));
