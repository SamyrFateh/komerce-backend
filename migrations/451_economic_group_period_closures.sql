-- @migration 451_economic_group_period_closures.sql
-- @domain economic-engine
-- @purpose Audit Direction approval against the exact group month evidence.
CREATE TABLE public.economic_group_period_closures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_start date NOT NULL CHECK (EXTRACT(DAY FROM period_start)=1),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  evidence_ref text NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 3 AND 1000),
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_start,evidence_hash)
);

CREATE FUNCTION public.reject_economic_group_period_closure_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'economic group period closures are append-only';
END;
$$;

CREATE TRIGGER trg_economic_group_period_closure_append_only
BEFORE UPDATE OR DELETE ON public.economic_group_period_closures
FOR EACH ROW EXECUTE FUNCTION public.reject_economic_group_period_closure_mutation();
