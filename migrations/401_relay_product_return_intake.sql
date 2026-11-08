-- @migration 401_relay_product_return_intake.sql
-- @domain logistics
-- Physical return is a distinct fact, never inferred from a dispute status.
-- First tranche: ONE complete attestation per SAV request; partial physical
-- receipts and disposition require a separately designed workflow.
CREATE TABLE IF NOT EXISTS public.relay_product_return_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.disputes(id),
  relay_id uuid NOT NULL REFERENCES public.relais(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  condition_code text NOT NULL CHECK (condition_code IN ('sealed','opened','damaged','unknown')),
  storage_zone text CHECK (storage_zone ~ '^[A-Z]$'),
  observation text NOT NULL CHECK (length(btrim(observation)) BETWEEN 10 AND 1000),
  received_by uuid NOT NULL REFERENCES public.users(id),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_relay_product_return_receipts_relay
  ON public.relay_product_return_receipts (relay_id, received_at DESC);

-- Independently enforce order/relay/quantity ownership if another SQL writer
-- tries to bypass the route. No stock, wallet or price mutation.
CREATE OR REPLACE FUNCTION public.guard_relay_product_return_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request_row record;
BEGIN
  SELECT d.id,d.type,d.status,d.return_quantity,oi.qty_collected,
         o.relais_id,o.simulation_scope
    INTO request_row
    FROM public.disputes d
    JOIN public.orders o ON o.id=d.order_id
    JOIN public.order_items oi
      ON oi.id=d.return_order_item_id AND oi.order_id=o.id
   WHERE d.id=NEW.request_id
   FOR SHARE OF d,o,oi;
  IF NOT FOUND
     OR request_row.type IS DISTINCT FROM 'product_return'
     OR request_row.status NOT IN ('open','processing')
     OR request_row.relais_id IS DISTINCT FROM NEW.relay_id
     OR request_row.simulation_scope IS NOT NULL
     OR request_row.return_quantity IS DISTINCT FROM NEW.quantity
     OR request_row.qty_collected < NEW.quantity
  THEN
    RAISE EXCEPTION 'RELAY_RETURN_RECEIPT_NOT_ELIGIBLE'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_relay_product_return_receipt ON public.relay_product_return_receipts;
CREATE TRIGGER trg_guard_relay_product_return_receipt
BEFORE INSERT ON public.relay_product_return_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_relay_product_return_receipt();

-- The proof cannot be edited after the physical event. Corrections must be
-- a separately auditable compensating event, not a silent rewrite.
CREATE OR REPLACE FUNCTION public.prevent_relay_product_return_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RELAY_RETURN_RECEIPT_IMMUTABLE' USING ERRCODE='P0001';
END;
$$;
DROP TRIGGER IF EXISTS trg_immutable_relay_product_return_receipt ON public.relay_product_return_receipts;
CREATE TRIGGER trg_immutable_relay_product_return_receipt
BEFORE UPDATE OR DELETE ON public.relay_product_return_receipts
FOR EACH ROW EXECUTE FUNCTION public.prevent_relay_product_return_receipt_mutation();

COMMENT ON TABLE public.relay_product_return_receipts IS
'Preuve append-only de reprise physique SAV par relais : la zone A-Z reste facultative et non exclusive. Aucune disponibilité stock ou compensation financière implicite.';
