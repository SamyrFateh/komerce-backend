-- @migration 416_fable_local_item_refund_reservations.sql
-- @domain refunds
-- @purpose Fable F1/F2 (#4114) local paid-shortage obligation (cash / mobile money).
-- NEVER a payout. No auto-credit wallet, no guessed payer, no financial success.
-- Migration number 416 follows F3 migration 415 (PR #4116); integration order is explicit.

CREATE TABLE IF NOT EXISTS public.local_item_refund_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  source_incident_id uuid NOT NULL REFERENCES public.incidents(id) ON DELETE RESTRICT,
  market_id uuid NOT NULL REFERENCES public.markets(id) ON DELETE RESTRICT,
  operation_key uuid NOT NULL,
  payment_mode text NOT NULL CHECK (payment_mode IN ('cash_relais','mobile_money')),
  capture_ref text NOT NULL CHECK (length(btrim(capture_ref)) > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  minor_unit integer NOT NULL CHECK (minor_unit BETWEEN 0 AND 4),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  amount_kmf numeric(14,2) NOT NULL CHECK (amount_kmf > 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 8),
  status text NOT NULL DEFAULT 'reserved' CHECK (status = 'reserved'),
  initiated_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_local_item_refund_operation UNIQUE (order_id, operation_key)
);
CREATE INDEX IF NOT EXISTS idx_local_item_refund_order
  ON public.local_item_refund_reservations(order_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_local_item_refund_item
  ON public.local_item_refund_reservations(order_item_id, status);

COMMENT ON TABLE public.local_item_refund_reservations IS
  'F1/F2 reserved liability only; cash/MM payouts cannot be marked completed here. '
  'Separate verified custody or provider settlement is required.';

-- A collection/physical handoff must not consume quantities already reserved
-- for missing goods. The existing E7 PSP guard remains independently active.
CREATE OR REPLACE FUNCTION public.guard_local_item_refund_pending_collection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_local integer;
BEGIN
  IF NEW.qty_collected IS NOT DISTINCT FROM OLD.qty_collected
     AND NEW.qty_refunded IS NOT DISTINCT FROM OLD.qty_refunded
     AND NEW.quantity IS NOT DISTINCT FROM OLD.quantity THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(quantity),0)::integer INTO v_local
    FROM public.local_item_refund_reservations
   WHERE order_item_id=NEW.id AND status='reserved';
  IF NEW.qty_collected + NEW.qty_refunded + v_local > NEW.quantity THEN
    RAISE EXCEPTION 'LOCAL_ITEM_REFUND_QTY_RESERVED_NOT_COLLECTABLE'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_local_item_refund_pending_collection ON public.order_items;
CREATE TRIGGER trg_guard_local_item_refund_pending_collection
BEFORE UPDATE OF qty_collected, qty_refunded, quantity ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.guard_local_item_refund_pending_collection();

-- PSP E7 must not enter the same order while an unresolved local liability
-- exists. Both writers already take the orders FOR UPDATE lock before insert.
CREATE OR REPLACE FUNCTION public.guard_psp_refund_vs_local_obligation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Same order row is the global exclusion lock used by the reservation
  -- writer. This also protects direct SQL/secondary writers that do not
  -- proactively lock orders before inserting an E7 reservation.
  PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.local_item_refund_reservations
     WHERE order_id=NEW.order_id AND status='reserved'
  ) THEN
    RAISE EXCEPTION 'ITEM_REFUND_LOCAL_CROSS_RAIL_UNRESOLVED'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_psp_refund_vs_local_obligation ON public.order_item_refund_reservations;
CREATE TRIGGER trg_guard_psp_refund_vs_local_obligation
BEFORE INSERT ON public.order_item_refund_reservations
FOR EACH ROW EXECUTE FUNCTION public.guard_psp_refund_vs_local_obligation();

-- A legacy / wallet / PSP refund must not bypass an outstanding local
-- obligation, even when invoked through a different service/HTTP route.
CREATE OR REPLACE FUNCTION public.guard_legacy_refund_vs_local_obligation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.orders WHERE id=NEW.order_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.local_item_refund_reservations
     WHERE order_id=NEW.order_id AND status='reserved'
  ) THEN
    RAISE EXCEPTION 'REFUND_LOCAL_OBLIGATION_UNRESOLVED'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_legacy_refund_vs_local_obligation ON public.refunds;
CREATE TRIGGER trg_guard_legacy_refund_vs_local_obligation
BEFORE INSERT ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_refund_vs_local_obligation();

-- No state edit can present an unverified physical payout as completed.
-- Settlement requires a later additive, independently certified migration.
CREATE OR REPLACE FUNCTION public.guard_local_refund_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LOCAL_REFUND_RESERVATION_IMMUTABLE'
    USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS trg_guard_local_refund_immutable ON public.local_item_refund_reservations;
CREATE TRIGGER trg_guard_local_refund_immutable
BEFORE UPDATE OR DELETE ON public.local_item_refund_reservations
FOR EACH ROW EXECUTE FUNCTION public.guard_local_refund_immutable();
