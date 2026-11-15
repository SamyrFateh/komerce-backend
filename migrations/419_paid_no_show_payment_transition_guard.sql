-- @migration 419_paid_no_show_payment_transition_guard.sql
-- @domain unsold-resolution
-- F3 #4115: close reverse path unpaid-unsold -> paid (and direct paid-unsold INSERT).
-- The original migration 415 still guards paid orders being marked unsold and any
-- subsequent insert/update of unsold_items. No existing row is rewritten here.
CREATE OR REPLACE FUNCTION public.guard_paid_no_show_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_status::text = 'paid' THEN
    IF NEW.unsold_at IS NOT NULL THEN
      RAISE EXCEPTION 'UNSOLD_PAID_ORDER_PROTECTED: paid order cannot enter liquidation'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Prevent paying a previously-unpaid order already commercialized via
    -- legacy unsold_items. The order row is locked by the UPDATE; the
    -- unsold_items writer locks that same row (migration 415).
    IF EXISTS (SELECT 1 FROM public.unsold_items ui WHERE ui.order_id = NEW.id) THEN
      RAISE EXCEPTION 'UNSOLD_PAID_ITEM_PROTECTED: refuse payment on liquidated order'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_paid_no_show_order ON public.orders;
CREATE TRIGGER trg_guard_paid_no_show_order
BEFORE INSERT OR UPDATE OF payment_status, unsold_at ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_paid_no_show_order();
