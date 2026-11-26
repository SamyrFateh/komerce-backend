-- @migration 432_economic_cost_commitments.sql
-- @domain economic-engine
-- @purpose ECO-1c: non-real commitments and auditable partial release/consumption.
-- No seed, no deployment. Initial realized link supports canonical structure accruals
-- only. Other fact types, cross-currency and correction reconciliation need services.
CREATE TABLE public.economic_cost_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.economic_cost_posts(id) ON DELETE RESTRICT,
  period_start date NOT NULL CHECK (EXTRACT(DAY FROM period_start) = 1),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_native numeric(18,4) NOT NULL CHECK (amount_native > 0 AND amount_native <> 'NaN'::numeric),
  amount_eur numeric(18,2) NOT NULL CHECK (amount_eur >= 0 AND amount_eur <> 'NaN'::numeric),
  fx_legs jsonb NOT NULL CHECK (jsonb_typeof(fx_legs) = 'array'),
  fx_as_of timestamptz NOT NULL,
  evidence_ref text NOT NULL CHECK (char_length(btrim(evidence_ref)) BETWEEN 3 AND 1000),
  request_key text NOT NULL CHECK (char_length(btrim(request_key)) BETWEEN 8 AND 200),
  recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, request_key),
  CHECK ((currency = 'EUR' AND fx_legs = '[]'::jsonb AND amount_native = amount_eur)
      OR (currency <> 'EUR' AND jsonb_array_length(fx_legs) > 0))
);
CREATE TABLE public.economic_cost_commitment_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid NOT NULL REFERENCES public.economic_cost_commitments(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('RELEASE','CONSUME_STRUCTURE')),
  amount_native numeric(18,4) NOT NULL CHECK (amount_native > 0 AND amount_native <> 'NaN'::numeric),
  structure_event_id uuid REFERENCES public.economic_structure_cost_events(id) ON DELETE RESTRICT,
  evidence_ref text NOT NULL CHECK (char_length(btrim(evidence_ref)) BETWEEN 3 AND 1000),
  request_key text NOT NULL CHECK (char_length(btrim(request_key)) BETWEEN 8 AND 200),
  recorded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(commitment_id, request_key),
  CHECK ((kind = 'RELEASE' AND structure_event_id IS NULL)
      OR (kind = 'CONSUME_STRUCTURE' AND structure_event_id IS NOT NULL))
);
CREATE INDEX idx_economic_commitment_movements_fact
  ON public.economic_cost_commitment_movements(structure_event_id);
CREATE INDEX idx_economic_commitments_post_period
  ON public.economic_cost_commitments(post_id, period_start);
CREATE OR REPLACE FUNCTION public.economic_cost_commitment_guard_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'economic_cost_commitment_immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER trg_economic_cost_commitment_immutable
  BEFORE UPDATE OR DELETE ON public.economic_cost_commitments
  FOR EACH ROW EXECUTE FUNCTION public.economic_cost_commitment_guard_immutable();
CREATE TRIGGER trg_economic_cost_commitment_movement_immutable
  BEFORE UPDATE OR DELETE ON public.economic_cost_commitment_movements
  FOR EACH ROW EXECUTE FUNCTION public.economic_cost_commitment_guard_immutable();
CREATE OR REPLACE FUNCTION public.economic_cost_commitment_guard_movement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  c public.economic_cost_commitments%ROWTYPE;
  fact public.economic_structure_cost_events%ROWTYPE;
  charge uuid;
  market uuid;
  used_amount numeric;
BEGIN
  -- At READ COMMITTED each aggregate sees committed predecessors after row locks.
  -- Reject other isolation modes until their concurrency contract is certified.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'economic_commitment_isolation_unsupported' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO STRICT c FROM public.economic_cost_commitments
    WHERE id = NEW.commitment_id FOR UPDATE;
  SELECT COALESCE(SUM(amount_native),0) INTO used_amount
    FROM public.economic_cost_commitment_movements WHERE commitment_id = c.id;
  IF used_amount + NEW.amount_native > c.amount_native THEN
    RAISE EXCEPTION 'economic_commitment_overconsumption' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'CONSUME_STRUCTURE' THEN
    SELECT * INTO STRICT fact FROM public.economic_structure_cost_events
      WHERE id = NEW.structure_event_id FOR UPDATE;
    SELECT p.structure_charge_id, cc.market_id INTO STRICT charge, market
      FROM public.economic_cost_posts p JOIN public.economic_cost_centers cc ON cc.id=p.center_id
      WHERE p.id=c.post_id FOR SHARE OF p, cc;
    IF charge IS NULL OR fact.charge_id IS DISTINCT FROM charge
      OR fact.market_id IS DISTINCT FROM market OR fact.currency <> c.currency
      OR fact.event_kind <> 'ACCRUAL' OR fact.amount_original <= 0
      OR fact.economic_from < (c.period_start::timestamp AT TIME ZONE 'UTC')
      OR fact.economic_to > ((c.period_start + interval '1 month') AT TIME ZONE 'UTC')
      OR EXISTS (SELECT 1 FROM public.economic_structure_cost_events e WHERE e.adjusts_event_id=fact.id) THEN
      RAISE EXCEPTION 'economic_commitment_fact_mismatch_or_correction' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(SUM(amount_native),0) INTO used_amount
      FROM public.economic_cost_commitment_movements WHERE structure_event_id=fact.id;
    IF used_amount + NEW.amount_native > fact.amount_original THEN
      RAISE EXCEPTION 'economic_commitment_fact_overallocation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_economic_cost_commitment_guard_movement
  BEFORE INSERT ON public.economic_cost_commitment_movements
  FOR EACH ROW EXECUTE FUNCTION public.economic_cost_commitment_guard_movement();
COMMENT ON TABLE public.economic_cost_commitments IS 'Administrative commitments, not realized costs, payments or purchases. Opening amount and source FX frozen.';
COMMENT ON TABLE public.economic_cost_commitment_movements IS 'Partial release or consumption against canonical accrual. No additional realized cost. Corrected facts require reconciliation before any decision projection; service pending.';
