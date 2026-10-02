-- 265 — Hub par ligne d'achat (PR 3/8, MISSION_PURCHASE_LINES) : rattache les allocations HUB-001 aux lignes.
--
-- Propriétaire : logistics (hub_purchase_allocations). Additif :
--   * aucune recopie sur les allocations existantes (elles sont immuables) : une allocation historique garde
--     purchase_line_id NULL et se résout vers l'unique ligne de sa PO historique ;
--   * « une allocation par PO » reste garanti pour la forme historique (index partiel) ;
--   * une PO regroupée (order_id NULL, PR 4) ne peut être allouée QUE par ligne.
-- Le trigger d'immuabilité (trg_hub_purchase_allocation_immutable) est inchangé.

ALTER TABLE public.hub_purchase_allocations
  ADD COLUMN IF NOT EXISTS purchase_line_id uuid REFERENCES public.purchase_lines(id) ON DELETE RESTRICT;

-- La contrainte UNIQUE (purchase_order_id) de la 233 est remplacée par deux index partiels.
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT c.conname INTO v_constraint
    FROM pg_constraint c
   WHERE c.conrelid = 'public.hub_purchase_allocations'::regclass
     AND c.contype = 'u'
     AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
            FROM unnest(c.conkey) k(attnum)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) = ARRAY['purchase_order_id'];
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.hub_purchase_allocations DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_purchase_allocations_line
  ON public.hub_purchase_allocations (purchase_line_id)
  WHERE purchase_line_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_hub_purchase_allocations_po_historical
  ON public.hub_purchase_allocations (purchase_order_id)
  WHERE purchase_line_id IS NULL;

-- Cohérence ligne ↔ allocation : l'instantané doit décrire la ligne exacte, et une PO regroupée n'est jamais
-- allouée au niveau PO.
CREATE OR REPLACE FUNCTION public.hub_guard_allocation_purchase_line()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_line public.purchase_lines%ROWTYPE;
  v_po_order_id uuid;
BEGIN
  IF NEW.purchase_line_id IS NULL THEN
    SELECT order_id INTO v_po_order_id FROM public.purchase_orders WHERE id = NEW.purchase_order_id;
    IF FOUND AND v_po_order_id IS NULL THEN
      RAISE EXCEPTION 'hub_allocation_grouped_requires_line: une PO regroupée ne s''alloue que par ligne d''achat'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_line FROM public.purchase_lines WHERE id = NEW.purchase_line_id;
  IF NOT FOUND
     OR v_line.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id
     OR v_line.order_item_id IS DISTINCT FROM NEW.order_item_id
     OR v_line.product_sku_id IS DISTINCT FROM NEW.product_sku_id
     OR v_line.supplier_id IS DISTINCT FROM NEW.supplier_id THEN
    RAISE EXCEPTION 'hub_allocation_line_mismatch: l''allocation ne décrit pas la ligne d''achat référencée'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hub_allocation_purchase_line ON public.hub_purchase_allocations;
CREATE TRIGGER trg_hub_allocation_purchase_line
  BEFORE INSERT ON public.hub_purchase_allocations
  FOR EACH ROW EXECUTE FUNCTION public.hub_guard_allocation_purchase_line();

-- Vue de progression : le reçu d'une PO regroupée (et d'une ligne ouverte) vaut désormais la somme des
-- placements RECEIVE des allocations de la ligne. Le reçu d'une PO historique reste purchase_orders.received_qty.
-- Mêmes colonnes, même ordre : CREATE OR REPLACE.
CREATE OR REPLACE VIEW public.v_purchase_line_progress AS
SELECT
  pl.id                                AS line_id,
  pl.order_item_id                     AS order_item_id,
  oi.order_id                          AS order_id,
  pl.purchase_order_id                 AS purchase_order_id,
  po.status                            AS po_status,
  CASE
    WHEN po.id IS NULL        THEN NULL
    WHEN po.order_id IS NULL  THEN 'grouped'
    ELSE 'historical'
  END                                  AS po_shape,
  public.purchase_line_effective_quantity(pl.cancelled_at, pl.settled_quantity, pl.confirmed_quantity, pl.quantity)
                                       AS effective_quantity,
  CASE
    WHEN po.order_id IS NOT NULL THEN COALESCE(po.received_qty, 0)
    ELSE COALESCE((
      SELECT SUM(p.quantity)::integer
        FROM public.hub_physical_unit_placements p
        JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
       WHERE a.purchase_line_id = pl.id AND p.operation_type = 'RECEIVE'
    ), 0)
  END                                  AS received_quantity,
  (pl.cancelled_at IS NOT NULL)        AS cancelled,
  pl.product_supplier_id               AS product_supplier_id,
  po.hub_received_at                   AS hub_received_at,
  pl.quantity                          AS quantity
FROM public.purchase_lines pl
JOIN public.order_items oi ON oi.id = pl.order_item_id
LEFT JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
UNION ALL
SELECT
  NULL::uuid,
  po.order_item_id,
  po.order_id,
  po.id,
  po.status,
  'historical_no_line',
  CASE WHEN po.status = 'cancelled' THEN 0 ELSE po.qty END,
  COALESCE(po.received_qty, 0),
  (po.status = 'cancelled'),
  po.product_supplier_id,
  po.hub_received_at,
  po.qty
FROM public.purchase_orders po
WHERE po.order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.purchase_lines pl WHERE pl.purchase_order_id = po.id);
