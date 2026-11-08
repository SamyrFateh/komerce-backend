-- @migration 400_catalog_product_quality_holds.sql
-- @domain catalog
-- A SAV report or quality remark is a signal, NEVER an automatic global freeze.
-- Freezing/unfreezing is an explicit audited Catalog central action.
CREATE TABLE IF NOT EXISTS public.catalog_product_quality_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  author_id uuid NOT NULL REFERENCES public.users(id),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_catalog_quality_notes_product_time
  ON public.catalog_product_quality_notes (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.catalog_product_sale_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  reason text NOT NULL CHECK (reason IN ('safety','defect','repeated_returns','quality_review','other')),
  comment text NOT NULL CHECK (length(btrim(comment)) BETWEEN 10 AND 2000),
  frozen_by uuid NOT NULL REFERENCES public.users(id),
  frozen_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid REFERENCES public.users(id),
  released_at timestamptz,
  release_comment text,
  CONSTRAINT catalog_product_hold_release_complete CHECK (
    (released_at IS NULL AND released_by IS NULL AND release_comment IS NULL)
    OR (released_at IS NOT NULL AND released_by IS NOT NULL
      AND release_comment IS NOT NULL AND length(btrim(release_comment)) BETWEEN 10 AND 2000)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_sale_hold_one_active
  ON public.catalog_product_sale_holds (product_id)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_sale_holds_product_time
  ON public.catalog_product_sale_holds (product_id, frozen_at DESC);

-- Central transactional guard against bypassing the product gate via another
-- checkout route: a NEW order line cannot be created while its reference is frozen.
-- Existing orders, parcels, receipts and collections remain untouched.
CREATE OR REPLACE FUNCTION public.guard_new_order_item_catalog_hold()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lock products before inspecting holds, serializing with freeze/unfreeze
  -- transactions that lock the same parent products row FOR UPDATE.
  PERFORM 1 FROM public.products WHERE id = NEW.product_id FOR SHARE;
  IF EXISTS (
    SELECT 1 FROM public.catalog_product_sale_holds h
     WHERE h.product_id = NEW.product_id AND h.released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product_catalog_quality_hold: %', NEW.product_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_new_order_item_catalog_hold ON public.order_items;
CREATE TRIGGER trg_guard_new_order_item_catalog_hold
BEFORE INSERT ON public.order_items FOR EACH ROW
EXECUTE FUNCTION public.guard_new_order_item_catalog_hold();

COMMENT ON TABLE public.catalog_product_sale_holds IS
  'Historique de gels globaux de vente explicites du Catalogue. Un signalement SAV ne gèle jamais automatiquement.';
COMMENT ON TABLE public.catalog_product_quality_notes IS
  'Observations qualité historisées par le Catalogue, indépendantes des litiges SAV.';
