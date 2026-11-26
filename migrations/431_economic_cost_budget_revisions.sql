-- @migration 431_economic_cost_budget_revisions.sql
-- @domain economic-engine
-- @purpose ECO-1b: versioned monthly budget at post level; never an actual cost.
-- No initial budget, no FX calculation here, no production or staging activation.
-- The service must authorize the post and freeze the canonical fx-authority result.
CREATE TABLE public.economic_cost_budget_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.economic_cost_posts(id) ON DELETE RESTRICT,
  period_start date NOT NULL CHECK (EXTRACT(DAY FROM period_start) = 1),
  revision integer NOT NULL CHECK (revision >= 1),
  previous_revision integer,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_native numeric(18,4) NOT NULL CHECK (amount_native >= 0 AND amount_native <> 'NaN'::numeric),
  amount_eur numeric(18,2) NOT NULL CHECK (amount_eur >= 0 AND amount_eur <> 'NaN'::numeric),
  fx_legs jsonb NOT NULL CHECK (jsonb_typeof(fx_legs) = 'array'),
  fx_as_of timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT economic_budget_revision_unique UNIQUE (post_id, period_start, revision),
  CONSTRAINT economic_budget_request_unique UNIQUE (post_id, period_start, idempotency_key),
  CONSTRAINT economic_budget_revision_chain CHECK (
    (revision = 1 AND previous_revision IS NULL)
    OR (revision > 1 AND previous_revision IS NOT NULL AND previous_revision = revision - 1)
  ),
  CONSTRAINT economic_budget_predecessor FOREIGN KEY (post_id, period_start, previous_revision)
    REFERENCES public.economic_cost_budget_revisions(post_id, period_start, revision) ON DELETE RESTRICT,
  CONSTRAINT economic_budget_fx_shape CHECK (
    (currency = 'EUR' AND fx_legs = '[]'::jsonb AND amount_native = amount_eur)
    OR (currency <> 'EUR' AND jsonb_array_length(fx_legs) > 0)
  ),
  CONSTRAINT economic_budget_zero_identity CHECK (amount_native <> 0 OR amount_eur = 0)
);
COMMENT ON TABLE public.economic_cost_budget_revisions IS 'Planning only. Current budget = greatest revision per post and month, never sum of revisions. Center and longer periods derive from posts and months. No actual cost or financial movement is written.';
CREATE OR REPLACE FUNCTION public.economic_cost_budget_guard_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'economic_cost_budget_revision_immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER trg_economic_cost_budget_guard_immutable
  BEFORE UPDATE OR DELETE ON public.economic_cost_budget_revisions
  FOR EACH ROW EXECUTE FUNCTION public.economic_cost_budget_guard_immutable();
