-- @migration 450_hub_supplier_receipt_quality.sql
-- @domain logistics,purchasing
-- @purpose Supplier quality observations and physical return attestations.
-- Additive. No financial disposition or client inventory for rejected units.
CREATE TABLE public.hub_supplier_receipt_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE CHECK (length(reference) BETWEEN 1 AND 120),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  market_id uuid NOT NULL REFERENCES public.markets(id),
  observed_by uuid NOT NULL REFERENCES public.users(id),
  observed_at timestamptz NOT NULL DEFAULT now(),
  observation_hash text NOT NULL CHECK (observation_hash ~ '^[0-9a-f]{64}$'),
  conforming_unit_id uuid UNIQUE REFERENCES public.hub_physical_units(id)
);
CREATE TABLE public.hub_supplier_receipt_check_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.hub_supplier_receipt_checks(id),
  product_sku_id uuid NOT NULL REFERENCES public.product_skus(id),
  expected_quantity integer NOT NULL CHECK (expected_quantity > 0),
  received_quantity integer NOT NULL CHECK (received_quantity >= 0),
  rejected_quantity integer NOT NULL CHECK (rejected_quantity >= 0),
  conforming_quantity integer GENERATED ALWAYS AS (received_quantity-rejected_quantity) STORED,
  missing_quantity integer GENERATED ALWAYS AS (expected_quantity-received_quantity) STORED,
  UNIQUE(check_id,product_sku_id),
  CHECK (rejected_quantity <= received_quantity AND received_quantity <= expected_quantity)
);
CREATE TABLE public.hub_supplier_return_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE CHECK (length(reference) BETWEEN 1 AND 120),
  check_line_id uuid NOT NULL REFERENCES public.hub_supplier_receipt_check_lines(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  returned_by uuid NOT NULL REFERENCES public.users(id),
  returned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_supplier_receipt_checks_po_idx ON public.hub_supplier_receipt_checks(purchase_order_id,observed_at);
CREATE INDEX hub_supplier_return_line_idx ON public.hub_supplier_return_attestations(check_line_id);
CREATE FUNCTION public.hub_supplier_check_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HUB_SUPPLIER_CHECK_IMMUTABLE' USING ERRCODE='P0001';
END $$;
CREATE TRIGGER hub_supplier_check_immutable BEFORE UPDATE OR DELETE ON public.hub_supplier_receipt_checks
FOR EACH ROW EXECUTE FUNCTION public.hub_supplier_check_immutable();
CREATE TRIGGER hub_supplier_check_line_immutable BEFORE UPDATE OR DELETE ON public.hub_supplier_receipt_check_lines
FOR EACH ROW EXECUTE FUNCTION public.hub_supplier_check_immutable();
CREATE TRIGGER hub_supplier_return_immutable BEFORE UPDATE OR DELETE ON public.hub_supplier_return_attestations
FOR EACH ROW EXECUTE FUNCTION public.hub_supplier_check_immutable();

CREATE FUNCTION public.hub_supplier_return_quantity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rejected integer; already_returned bigint;
BEGIN
  SELECT rejected_quantity INTO rejected FROM public.hub_supplier_receipt_check_lines
  WHERE id=NEW.check_line_id FOR UPDATE;
  SELECT COALESCE(SUM(quantity),0) INTO already_returned FROM public.hub_supplier_return_attestations
  WHERE check_line_id=NEW.check_line_id;
  IF rejected IS NULL OR already_returned + NEW.quantity > rejected THEN
    RAISE EXCEPTION 'HUB_SUPPLIER_RETURN_EXCEEDS_REJECTED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hub_supplier_return_quantity_guard BEFORE INSERT ON public.hub_supplier_return_attestations
FOR EACH ROW EXECUTE FUNCTION public.hub_supplier_return_quantity_guard();

COMMENT ON TABLE public.hub_supplier_receipt_checks IS 'Immutable supplier quality observation; conforming stock is recorded separately by canonical physical receipt.';
COMMENT ON TABLE public.hub_supplier_receipt_check_lines IS 'Observed received, rejected and missing quantities; rejected units are not client allocations.';
COMMENT ON TABLE public.hub_supplier_return_attestations IS 'Physical supplier handover only; never a refund, replacement or loss decision.';
