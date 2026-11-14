-- @migration 415_paid_no_show_liquidation_guard.sql
-- @domain unsold-resolution
-- @purpose Fable F3 (#4107/#4115) : fail-closed paid no-show at database boundary.
-- 14 days uncollected is NEVER a transfer of ownership. No backfill or payout.
-- The legacy auto_unsold() remains installed for historical compatibility but
-- cannot mutate a paid order; paid unsold_items cannot be created or mutated.
--
-- A complete parcel-level custody, notice and financial closure must replace
-- this conservative guard before any sale/donation/destruction of paid stock.

CREATE OR REPLACE FUNCTION public.guard_paid_no_show_order()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_status = 'paid'
     AND (NEW.unsold_at IS DISTINCT FROM OLD.unsold_at
       OR NEW.unsold_price_kmf IS DISTINCT FROM OLD.unsold_price_kmf) THEN
    RAISE EXCEPTION 'UNSOLD_PAID_ORDER_PROTECTED: paid order cannot enter liquidation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_paid_no_show_order ON public.orders;
CREATE TRIGGER trg_guard_paid_no_show_order
BEFORE UPDATE OF unsold_at, unsold_price_kmf ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_paid_no_show_order();

CREATE OR REPLACE FUNCTION public.guard_paid_unsold_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_payment_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.order_id IS DISTINCT FROM OLD.order_id THEN
    RAISE EXCEPTION 'UNSOLD_ORDER_REASSIGN_FORBIDDEN: sale provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lock the order so the payment->paid transition cannot race a liquidation.
  SELECT payment_status::text INTO v_payment_status
    FROM public.orders WHERE id = NEW.order_id FOR UPDATE;
  IF v_payment_status = 'paid' THEN
    RAISE EXCEPTION 'UNSOLD_PAID_ITEM_PROTECTED: customer-paid goods remain under custody'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_paid_unsold_item ON public.unsold_items;
CREATE TRIGGER trg_guard_paid_unsold_item
BEFORE INSERT OR UPDATE ON public.unsold_items
FOR EACH ROW EXECUTE FUNCTION public.guard_paid_unsold_item();
