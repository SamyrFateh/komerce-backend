-- Migration 425: a confirmed purchase price has its own currency.
-- Never rewrite supplier_currency (the original immutable supplier quotation).
-- No historical records are rewritten and no currency is guessed.
ALTER TABLE public.purchase_lines
  ADD COLUMN IF NOT EXISTS confirmed_currency text NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_purchase_lines_confirmed_currency'
       AND conrelid = 'public.purchase_lines'::regclass
  ) THEN
    ALTER TABLE public.purchase_lines
      ADD CONSTRAINT chk_purchase_lines_confirmed_currency CHECK (
        confirmed_currency IS NULL OR
        (confirmed_currency ~ '^[A-Z]{3}$'
         AND confirmed_at IS NOT NULL
         AND confirmed_quantity > 0
         AND confirmed_unit_price IS NOT NULL)
      );
  END IF;
END $$;

-- Extra append-only guard: only the initial notified manual-PO confirmation
-- may set the separate actual-confirmation currency. All quote identity and
-- money columns remain frozen by trg_purchase_lines_guard_freeze (migration 263).
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_confirmed_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_po_status text;
  v_trigger_mode text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.confirmed_currency IS NOT NULL THEN
      RAISE EXCEPTION 'confirmed_currency must be created at manual confirmation'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.confirmed_currency IS DISTINCT FROM OLD.confirmed_currency THEN
    SELECT po.status::text, po.trigger_mode INTO v_po_status, v_trigger_mode
      FROM public.purchase_orders po WHERE po.id = OLD.purchase_order_id;

    IF OLD.confirmed_currency IS NOT NULL
       OR OLD.confirmed_at IS NOT NULL
       OR OLD.confirmed_quantity IS NOT NULL
       OR OLD.supplier_currency IS NOT NULL
       OR OLD.supplier_unit_price IS NOT NULL
       OR v_po_status IS DISTINCT FROM 'notified'
       OR v_trigger_mode IS DISTINCT FROM 'manual'
       OR NEW.confirmed_currency IS NULL
       OR NEW.confirmed_currency !~ '^[A-Z]{3}$'
       OR NEW.confirmed_at IS NULL
       OR COALESCE(NEW.confirmed_quantity, 0) <= 0
       OR NEW.confirmed_unit_price IS NULL THEN
      RAISE EXCEPTION 'confirmed_currency frozen: only first unpriced manual PO confirmation may create it'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_lines_guard_confirmed_currency
  ON public.purchase_lines;
CREATE TRIGGER trg_purchase_lines_guard_confirmed_currency
  BEFORE INSERT OR UPDATE OF confirmed_currency
  ON public.purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_confirmed_currency();

COMMENT ON COLUMN public.purchase_lines.confirmed_currency IS
  'Currency established when confirming an originally unpriced manual purchase. Append-only, never backfilled from indicative sourcing cost; quoted supplier_currency stays immutable.';
