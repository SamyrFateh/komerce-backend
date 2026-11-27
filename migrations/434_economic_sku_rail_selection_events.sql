-- @migration 434_economic_sku_rail_selection_events.sql
-- @domain economic-engine
-- @purpose Audit reversible economic withdrawals at exact SKU, market and commercial transport rail.
CREATE TABLE public.economic_sku_rail_selection_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  sku_id uuid NOT NULL REFERENCES public.product_skus(id) ON DELETE RESTRICT,
  rail text NOT NULL CHECK (rail IN ('SEA_STANDARD', 'AIR_EXPRESS')),
  action text NOT NULL CHECK (action IN ('WITHDRAW', 'RESTORE')),
  policy_version text NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 1000),
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_economic_sku_rail_selection_current ON public.economic_sku_rail_selection_events
  (market_id, sku_id, rail, id DESC);

CREATE FUNCTION public.reject_economic_sku_rail_selection_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'economic SKU rail selection events are append-only';
END;
$$;

CREATE TRIGGER economic_sku_rail_selection_immutable
  BEFORE UPDATE OR DELETE ON public.economic_sku_rail_selection_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_economic_sku_rail_selection_mutation();
