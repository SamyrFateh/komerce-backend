-- @migration 452_hub_internal_invoices.sql
-- @domain settlement
-- @purpose Immutable internal Hub invoices and one attested full incoming settlement.
CREATE TABLE public.hub_internal_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  period_from date NOT NULL,
  period_to date NOT NULL CHECK (period_to > period_from),
  amount_kmf numeric(24,2) NOT NULL CHECK (amount_kmf > 0),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  statement_snapshot jsonb NOT NULL,
  issued_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  payment_reference text UNIQUE CHECK (length(btrim(payment_reference)) BETWEEN 3 AND 200),
  paid_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  paid_at timestamptz,
  CHECK ((payment_reference IS NULL AND paid_by IS NULL AND paid_at IS NULL)
      OR (payment_reference IS NOT NULL AND paid_by IS NOT NULL AND paid_at IS NOT NULL)),
  UNIQUE (market_id, period_from, period_to)
);

CREATE FUNCTION public.guard_hub_internal_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'hub_internal_invoices cannot be deleted';
  END IF;
  IF OLD.paid_at IS NOT NULL OR NEW.paid_at IS NULL OR
     (to_jsonb(OLD) - ARRAY['payment_reference','paid_by','paid_at']) <>
     (to_jsonb(NEW) - ARRAY['payment_reference','paid_by','paid_at']) THEN
    RAISE EXCEPTION 'hub_internal_invoices are immutable except for one settlement';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_hub_internal_invoice
BEFORE UPDATE OR DELETE ON public.hub_internal_invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_hub_internal_invoice();
