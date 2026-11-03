-- @migration 369_single_purchase_model.sql
-- @domain purchasing
-- P0-5 : un seul modèle d'achat. Toute ligne d'achat naît ouverte (sans PO) ; l'identité fournisseur
-- exacte et le prix ne sont exigés pour le rattachement qu'aux PO en mode API (trigger_mode='auto').
-- Une PO manuelle/WhatsApp accepte une ligne issue d'un mapping fournisseur (prix éventuellement inconnu,
-- exigé à la confirmation par le service). Le mode d'une PO devient immuable après création.
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_groupable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_other_currency text;
BEGIN
  IF NEW.purchase_order_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.purchase_order_id IS NOT DISTINCT FROM OLD.purchase_order_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po.order_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF v_po.trigger_mode = 'auto'
     AND (NEW.product_sku_id IS NULL
          OR NEW.supplier_unit_ref IS NULL
          OR NEW.supplier_order_identity IS NULL
          OR NEW.supplier_unit_price IS NULL
          OR NEW.supplier_currency IS NULL) THEN
    RAISE EXCEPTION 'purchase_line_not_groupable: une PO en mode API exige une ligne à identité fournisseur exacte et prix connu'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.supplier_id IS DISTINCT FROM v_po.supplier_id
     OR NEW.procurement_hub_ref IS DISTINCT FROM v_po.procurement_hub_ref THEN
    RAISE EXCEPTION 'purchase_line_not_homogeneous: fournisseur ou hub différent de l''en-tête de la PO'
      USING ERRCODE = '23514';
  END IF;

  SELECT pl.supplier_currency INTO v_other_currency
    FROM public.purchase_lines pl
   WHERE pl.purchase_order_id = NEW.purchase_order_id
     AND pl.cancelled_at IS NULL
     AND pl.id IS DISTINCT FROM NEW.id
     AND pl.supplier_currency IS NOT NULL
     AND NEW.supplier_currency IS NOT NULL
     AND pl.supplier_currency IS DISTINCT FROM NEW.supplier_currency
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'purchase_line_not_homogeneous: devise différente des lignes déjà rattachées (%)', v_other_currency
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.purchase_orders_guard_trigger_mode() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.trigger_mode IS DISTINCT FROM OLD.trigger_mode THEN
    RAISE EXCEPTION 'purchase_order_mode_immutable: le mode d''une PO ne change pas après création'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_orders_trigger_mode_immutable ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_trigger_mode_immutable
  BEFORE UPDATE OF trigger_mode ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_guard_trigger_mode();
