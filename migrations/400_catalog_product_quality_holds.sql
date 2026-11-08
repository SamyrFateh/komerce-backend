-- @migration 400_catalog_product_quality_holds.sql
-- @domain catalog
-- A SAV report or quality remark is a signal, NEVER an automatic global freeze.
-- Freezing/unfreezing is an explicit audited Catalog central action.
CREATE TABLE IF NOT EXISTS public.catalog_product_quality_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  author_id uuid NOT NULL REFERENCES public.users(id),
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 5 AND 2000),
  source text NOT NULL DEFAULT 'catalog' CHECK (source IN ('catalog','relay')),
  order_item_id uuid REFERENCES public.order_items(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_quality_note_origin CHECK (
    (source='catalog' AND order_item_id IS NULL)
    OR (source='relay' AND order_item_id IS NOT NULL)
  )
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

-- Quality notes cannot be silently rewritten after they have been recorded.
CREATE OR REPLACE FUNCTION public.prevent_catalog_quality_note_mutation()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  RAISE EXCEPTION 'CATALOG_QUALITY_NOTE_IMMUTABLE'
    USING ERRCODE = 'P0001';
END;
$;
DROP TRIGGER IF EXISTS trg_immutable_catalog_quality_note ON public.catalog_product_quality_notes;
CREATE TRIGGER trg_immutable_catalog_quality_note
BEFORE UPDATE OR DELETE ON public.catalog_product_quality_notes
FOR EACH ROW EXECUTE FUNCTION public.prevent_catalog_quality_note_mutation();

-- A hold is an immutable decision. Only its one-time RELEASE may complete the
-- existing row, preserving the original actor, reason, date and justification.
CREATE OR REPLACE FUNCTION public.prevent_catalog_sale_hold_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CATALOG_SALE_HOLD_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.released_at IS NOT NULL
    OR NEW.released_at IS NULL
    OR NEW.released_by IS NULL
    OR NEW.release_comment IS NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.product_id IS DISTINCT FROM OLD.product_id
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.comment IS DISTINCT FROM OLD.comment
    OR NEW.frozen_by IS DISTINCT FROM OLD.frozen_by
    OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at
  THEN
    RAISE EXCEPTION 'CATALOG_SALE_HOLD_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$;
DROP TRIGGER IF EXISTS trg_immutable_catalog_sale_hold ON public.catalog_product_sale_holds;
CREATE TRIGGER trg_immutable_catalog_sale_hold
BEFORE UPDATE OR DELETE ON public.catalog_product_sale_holds
FOR EACH ROW EXECUTE FUNCTION public.prevent_catalog_sale_hold_rewrite();

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
