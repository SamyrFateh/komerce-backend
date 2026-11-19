-- 464 · Borne SQL transactionnelle de l'annulation des PO de recette G6 exclusivement.
-- G6-BUYER exception, only after cancelled PO and its immutable cancelled lines.
-- The transaction must scope LOCAL komerce.g6_recipe_po_id to the exact PO.
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_attachment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_order_id uuid;
  v_order_item uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.purchase_order_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT status, order_id, order_item_id INTO v_status, v_order_id, v_order_item
      FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR SHARE;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'purchase_line_po_missing' USING ERRCODE = '23503';
    END IF;
    IF v_order_id IS NULL OR v_order_item IS DISTINCT FROM NEW.order_item_id THEN
      RAISE EXCEPTION 'purchase_line_attach_forbidden: insertion rattachée réservée à une PO historique du même order_item'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.purchase_lines WHERE purchase_order_id = NEW.purchase_order_id) THEN
      RAISE EXCEPTION 'purchase_line_historical_po_already_has_line' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.purchase_order_id IS NOT DISTINCT FROM OLD.purchase_order_id THEN
    RETURN NEW;
  END IF;

  IF OLD.purchase_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.purchase_orders WHERE id = OLD.purchase_order_id FOR SHARE;
    IF v_status IS DISTINCT FROM 'draft' THEN
      IF NOT (
        v_status='cancelled'
        AND NEW.purchase_order_id IS NULL
        AND NEW.cancelled_at IS NOT NULL
        AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at
        AND current_setting('komerce.g6_recipe_po_id',true)=OLD.purchase_order_id::text
        AND EXISTS (
          SELECT 1 FROM public.order_items oi
          JOIN public.orders o ON o.id=oi.order_id
          WHERE oi.id=OLD.order_item_id
            AND o.simulation_scope='G6-BUYER'
            AND o.payment_mode='cash_relais'
        )
      ) THEN
        RAISE EXCEPTION 'purchase_line_detach_forbidden: la PO d''origine n''est pas en brouillon' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF NEW.purchase_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR SHARE;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'purchase_line_attach_forbidden: la PO cible n''est pas en brouillon' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

