-- 357 — Chaque NOUVELLE PO fournisseur regroupée appartient à un seul marché.
-- Compatibilité : les PO historiques mixtes sont préservées (market_id NULL),
-- sans possibilité de rattacher de nouvelles lignes ambiguës.
-- Le marché autoritaire vient de orders.market_id via order_items.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS market_id uuid REFERENCES public.markets(id);

-- Rendre lisibles les anciens dossiers homogènes sans changer leurs lignes.
WITH homogeneous AS (
  SELECT pl.purchase_order_id AS po_id,
         MIN(o.market_id::text)::uuid AS market_id
    FROM public.purchase_lines pl
    JOIN public.order_items oi ON oi.id = pl.order_item_id
    JOIN public.orders o ON o.id = oi.order_id
   WHERE pl.purchase_order_id IS NOT NULL
   GROUP BY pl.purchase_order_id
  HAVING COUNT(DISTINCT o.market_id) = 1
)
UPDATE public.purchase_orders po
   SET market_id = h.market_id
  FROM homogeneous h
 WHERE po.id = h.po_id AND po.market_id IS NULL;

UPDATE public.purchase_orders po
   SET market_id = o.market_id
  FROM public.orders o
 WHERE po.order_id = o.id AND po.market_id IS NULL;

CREATE OR REPLACE FUNCTION public.purchase_orders_guard_market_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.order_id IS NULL AND NEW.market_id IS NULL THEN
    RAISE EXCEPTION 'purchase_order_market_required: marché obligatoire pour une nouvelle PO regroupée'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.market_id IS NOT NULL
       AND NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'purchase_order_market_immutable: marché de la PO immuable'
      USING ERRCODE = '23514';
  END IF;

  -- Même sur un ancien en-tête dont le marché était absent, le rendre
  -- non-null exige que toutes les lignes déjà rattachées concordent.
  IF NEW.order_id IS NULL AND NEW.market_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.market_id IS DISTINCT FROM OLD.market_id)
     AND EXISTS (
       SELECT 1 FROM public.purchase_lines pl
       JOIN public.order_items oi ON oi.id = pl.order_item_id
       JOIN public.orders o ON o.id = oi.order_id
       WHERE pl.purchase_order_id = NEW.id
         AND o.market_id IS DISTINCT FROM NEW.market_id
     ) THEN
    RAISE EXCEPTION 'purchase_order_market_mismatch: lignes de marché différent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_orders_market_scope ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_market_scope
  BEFORE INSERT OR UPDATE OF market_id ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.purchase_orders_guard_market_scope();

CREATE OR REPLACE FUNCTION public.purchase_lines_guard_market_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_po_market uuid;
  v_po_order uuid;
  v_line_market uuid;
BEGIN
  IF NEW.purchase_order_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.purchase_order_id IS NOT DISTINCT FROM OLD.purchase_order_id
       AND NEW.order_item_id IS NOT DISTINCT FROM OLD.order_item_id THEN
    RETURN NEW;
  END IF;

  -- Le verrou de l'en-tête sérialise les rattachements concurrents.
  SELECT market_id, order_id INTO v_po_market, v_po_order
    FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po_order IS NOT NULL THEN
    RETURN NEW; -- Forme historique 1:1 préservée.
  END IF;

  IF v_po_market IS NULL THEN
    RAISE EXCEPTION 'purchase_line_market_unset: ancien dossier sans marché unique, aucun nouveau rattachement'
      USING ERRCODE = '23514';
  END IF;

  SELECT o.market_id INTO v_line_market
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE oi.id = NEW.order_item_id;
  IF v_line_market IS NULL OR v_line_market IS DISTINCT FROM v_po_market THEN
    RAISE EXCEPTION 'purchase_line_market_mismatch: ligne non destinée au marché de la PO'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_lines_b_market_scope ON public.purchase_lines;
CREATE TRIGGER trg_purchase_lines_b_market_scope
  BEFORE INSERT OR UPDATE OF purchase_order_id, order_item_id ON public.purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_market_scope();

COMMENT ON COLUMN public.purchase_orders.market_id IS
  'Marché unique de toute nouvelle PO regroupée. Autorité dérivée des commandes clientes. NULL uniquement pour anciens dossiers multi-marchés à préserver.';
