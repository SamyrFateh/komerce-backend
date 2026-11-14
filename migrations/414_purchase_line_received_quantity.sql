-- @migration 414_purchase_line_received_quantity.sql
-- @domain purchasing
-- @purpose HB-06/H3 (#3998) : une seule définition SQL de la quantité reçue d'une ligne d'achat (placements actifs, hors quarantaine/superseded/outcome). Additive : fonction + vue recréée à colonnes identiques. Garde du regroupement : une ligne sans variante n'est plus regroupable, cas manuel central_hub compris (HB-11).
CREATE OR REPLACE FUNCTION public.purchase_line_received_quantity(p_line_id uuid) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE((
    SELECT (sum(p.quantity))::integer
      FROM public.purchase_lines pl
      JOIN public.hub_purchase_allocations a
        ON (a.purchase_line_id = pl.id
            OR (a.purchase_line_id IS NULL AND a.purchase_order_id = pl.purchase_order_id AND a.order_item_id = pl.order_item_id))
      JOIN public.hub_physical_unit_placements p ON p.allocation_id = a.id AND p.removed_at IS NULL
      JOIN public.hub_physical_units u ON u.id = p.physical_unit_id
           AND u.state <> ALL (ARRAY['QUARANTINED'::text, 'SUPERSEDED'::text]) AND u.outcome_type IS NULL
     WHERE pl.id = p_line_id
  ), 0)
$$;

CREATE OR REPLACE VIEW public.v_purchase_line_progress AS
 SELECT pl.id AS line_id,
    pl.order_item_id,
    oi.order_id,
    pl.purchase_order_id,
    po.status AS po_status,
        CASE
            WHEN (po.id IS NULL) THEN NULL::text
            WHEN (po.order_id IS NULL) THEN 'grouped'::text
            ELSE 'historical'::text
        END AS po_shape,
    public.purchase_line_effective_quantity(pl.cancelled_at, pl.settled_quantity, pl.confirmed_quantity, pl.quantity) AS effective_quantity,
    public.purchase_line_received_quantity(pl.id) AS received_quantity,
    (pl.cancelled_at IS NOT NULL) AS cancelled,
    pl.product_supplier_id,
    po.hub_received_at,
    pl.quantity,
    COALESCE(po.received_qty, 0) AS declared_received_quantity
   FROM ((public.purchase_lines pl
     JOIN public.order_items oi ON ((oi.id = pl.order_item_id)))
     LEFT JOIN public.purchase_orders po ON ((po.id = pl.purchase_order_id)))
UNION ALL
 SELECT NULL::uuid AS line_id,
    po.order_item_id,
    po.order_id,
    po.id AS purchase_order_id,
    po.status AS po_status,
    'historical_no_line'::text AS po_shape,
        CASE
            WHEN (po.status = 'cancelled'::text) THEN 0
            ELSE po.qty
        END AS effective_quantity,
    COALESCE(( SELECT (sum(p.quantity))::integer AS sum
           FROM ((public.hub_purchase_allocations a
             JOIN public.hub_physical_unit_placements p ON (((p.allocation_id = a.id) AND (p.removed_at IS NULL))))
             JOIN public.hub_physical_units u ON (((u.id = p.physical_unit_id) AND (u.state <> ALL (ARRAY['QUARANTINED'::text, 'SUPERSEDED'::text])) AND (u.outcome_type IS NULL))))
          WHERE ((a.purchase_order_id = po.id) AND (a.purchase_line_id IS NULL))), 0) AS received_quantity,
    (po.status = 'cancelled'::text) AS cancelled,
    po.product_supplier_id,
    po.hub_received_at,
    po.qty AS quantity,
    COALESCE(po.received_qty, 0) AS declared_received_quantity
   FROM public.purchase_orders po
  WHERE ((po.order_id IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.purchase_lines pl
          WHERE (pl.purchase_order_id = po.id)))));

CREATE OR REPLACE FUNCTION public.purchase_lines_guard_groupable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_other_currency text;
  v_supplier_system_key text;
BEGIN
  IF NEW.purchase_order_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.purchase_order_id IS NOT DISTINCT FROM OLD.purchase_order_id THEN RETURN NEW; END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR UPDATE;
  IF NOT FOUND OR v_po.order_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT system_key INTO v_supplier_system_key FROM public.suppliers WHERE id = v_po.supplier_id;
  IF v_supplier_system_key = 'central_hub' AND v_po.trigger_mode IN ('manual', 'whatsapp') THEN
    -- Actual seller, price and proof are captured by the existing manual PO
    -- confirmation/authorization steps; no API identity is manufactured here.
    -- HB-11 : la réception d'une PO regroupée se fait par variante, une ligne sans variante est non réceptionnable.
    IF NEW.product_sku_id IS NULL THEN
      RAISE EXCEPTION 'purchase_line_variant_required: une ligne sans variante (product_sku_id) ne peut pas être regroupée'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.product_sku_id IS NULL
     OR NEW.supplier_unit_ref IS NULL
     OR NEW.supplier_order_identity IS NULL
     OR NEW.supplier_unit_price IS NULL
     OR NEW.supplier_currency IS NULL THEN
    RAISE EXCEPTION 'purchase_line_not_groupable: seule une ligne à identité fournisseur exacte et prix connu est regroupable'
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
     AND pl.supplier_currency IS DISTINCT FROM NEW.supplier_currency
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'purchase_line_not_homogeneous: devise différente des lignes déjà rattachées (%)', v_other_currency
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
