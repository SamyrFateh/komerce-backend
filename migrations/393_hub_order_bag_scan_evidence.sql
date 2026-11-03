-- @migration 393_hub_order_bag_scan_evidence.sql
-- #3329 / M3 : preuve de dépôt par référence+quantité ; fermeture d'un sac sur plan figé.
-- Pas de code-barres individuel, aucune seconde lecture au moment de fermer le sac.
ALTER TABLE public.hub_physical_units
  ADD COLUMN IF NOT EXISTS bag_plan jsonb;

ALTER TABLE public.hub_physical_units
  DROP CONSTRAINT IF EXISTS hub_order_bag_plan_type_check;
ALTER TABLE public.hub_physical_units
  ADD CONSTRAINT hub_order_bag_plan_type_check CHECK (
    bag_plan IS NULL OR
    (order_id IS NOT NULL AND unit_type = 'HANDLING_UNIT' AND jsonb_typeof(bag_plan) = 'array')
  );

ALTER TABLE public.hub_physical_unit_placements
  ADD COLUMN IF NOT EXISTS evidence_method text,
  ADD COLUMN IF NOT EXISTS evidence_code text,
  ADD COLUMN IF NOT EXISTS evidence_ref text;

ALTER TABLE public.hub_physical_unit_placements
  DROP CONSTRAINT IF EXISTS hub_placement_evidence_method_check;
ALTER TABLE public.hub_physical_unit_placements
  ADD CONSTRAINT hub_placement_evidence_method_check
  CHECK (evidence_method IS NULL OR evidence_method IN ('SCAN','MANUAL','COUNT_ON_MANIFEST'));

-- A bag's intended quantities are captured when created and cannot be silently
-- altered to match incorrect physical contents later.
CREATE OR REPLACE FUNCTION public.hub_order_bag_plan_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_item record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.bag_plan IS DISTINCT FROM OLD.bag_plan THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_PLAN_IMMUTABLE' USING ERRCODE = '23514';
  END IF;

  IF NEW.bag_plan IS NULL THEN RETURN NEW; END IF;
  IF NEW.unit_type <> 'HANDLING_UNIT' OR NEW.order_id IS NULL THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_PLAN_REQUIRES_ORDER' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(NEW.bag_plan) = 0 THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_PLAN_EMPTY' USING ERRCODE = '23514';
  END IF;
  FOR v_item IN SELECT *
      FROM jsonb_to_recordset(NEW.bag_plan) AS x(order_item_id uuid, quantity integer)
  LOOP
    IF v_item.order_item_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'HUB_ORDER_BAG_PLAN_ITEM_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_items oi
                   WHERE oi.id = v_item.order_item_id AND oi.order_id = NEW.order_id
                     AND oi.fulfillment_source IS DISTINCT FROM 'LOCAL_STOCK'
                     AND oi.quantity >= v_item.quantity) THEN
      RAISE EXCEPTION 'HUB_ORDER_BAG_PLAN_ITEM_WRONG_ORDER_OR_QTY' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(NEW.bag_plan) AS x(order_item_id uuid, quantity integer)
    GROUP BY order_item_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_PLAN_DUPLICATE_ITEM' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hub_order_bag_plan_guard ON public.hub_physical_units;
CREATE TRIGGER trg_hub_order_bag_plan_guard
  BEFORE INSERT OR UPDATE OF bag_plan ON public.hub_physical_units
  FOR EACH ROW EXECUTE FUNCTION public.hub_order_bag_plan_guard();

-- New proof is required AT THE INSERT: no later editing of append-only evidence.
-- SCAN must be a confirmed physical code for the exact allocated supplier/SKU.
-- Manual exception must record a nonempty reference to a human verification.
CREATE OR REPLACE FUNCTION public.hub_order_bag_evidence_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_order_id uuid;
  v_sku uuid;
  v_supplier uuid;
BEGIN
  SELECT u.order_id INTO v_order_id
    FROM public.hub_physical_units u
   WHERE u.id = NEW.physical_unit_id AND u.unit_type = 'HANDLING_UNIT';
  IF v_order_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.evidence_method IS NULL THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_DEPOSIT_EVIDENCE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF NEW.operation_type NOT IN ('REPACK','SPLIT','MERGE') THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_DEPOSIT_OPERATION_INVALID' USING ERRCODE = '23514';
  END IF;

  SELECT a.product_sku_id, a.supplier_id INTO v_sku, v_supplier
    FROM public.hub_purchase_allocations a WHERE a.id = NEW.allocation_id;
  IF NEW.evidence_method = 'SCAN' THEN
    IF NEW.evidence_code IS NULL OR NEW.evidence_code = ''
       OR NEW.evidence_code <> upper(btrim(NEW.evidence_code)) THEN
      RAISE EXCEPTION 'HUB_ORDER_BAG_SCAN_CODE_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.product_sku_physical_codes c
       WHERE c.code = NEW.evidence_code AND c.product_sku_id = v_sku
         AND c.trust = 'CONFIRMED'
         AND (c.supplier_id = v_supplier OR c.supplier_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'HUB_ORDER_BAG_SCAN_SKU_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.evidence_method = 'MANUAL' THEN
    IF NEW.evidence_ref IS NULL OR length(btrim(NEW.evidence_ref)) < 6 THEN
      RAISE EXCEPTION 'HUB_ORDER_BAG_MANUAL_PROOF_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF NEW.evidence_code IS NOT NULL THEN
      RAISE EXCEPTION 'HUB_ORDER_BAG_MANUAL_CODE_FORBIDDEN' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'HUB_ORDER_BAG_DEPOSIT_METHOD_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hub_order_bag_evidence_guard ON public.hub_physical_unit_placements;
CREATE TRIGGER trg_hub_order_bag_evidence_guard
  BEFORE INSERT ON public.hub_physical_unit_placements
  FOR EACH ROW EXECUTE FUNCTION public.hub_order_bag_evidence_guard();

-- A bag cannot be closed without proof on every active line and exact match
-- between the chosen partial-shipment plan and the actually deposited quantities.
CREATE OR REPLACE FUNCTION public.hub_order_bag_pack_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM 'PACKED'
     OR OLD.state = 'PACKED'
     OR OLD.order_id IS NULL OR OLD.unit_type <> 'HANDLING_UNIT' THEN
    RETURN NEW;
  END IF;

  IF OLD.bag_plan IS NULL OR jsonb_array_length(OLD.bag_plan) = 0 THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_PLAN_REQUIRED' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hub_physical_unit_placements p
     WHERE p.physical_unit_id = OLD.id AND p.removed_at IS NULL
       AND (p.evidence_method IS NULL OR p.evidence_method NOT IN ('SCAN','MANUAL'))
  ) THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_UNPROVEN_CONTENT' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH planned AS (
      SELECT x.order_item_id, sum(x.quantity)::integer AS qty
        FROM jsonb_to_recordset(OLD.bag_plan) AS x(order_item_id uuid, quantity integer)
       GROUP BY x.order_item_id
    ), actual AS (
      SELECT a.order_item_id, sum(p.quantity)::integer AS qty
        FROM public.hub_physical_unit_placements p
        JOIN public.hub_purchase_allocations a ON a.id = p.allocation_id
       WHERE p.physical_unit_id = OLD.id AND p.removed_at IS NULL
       GROUP BY a.order_item_id
    )
    SELECT 1 FROM planned FULL JOIN actual USING (order_item_id)
     WHERE planned.qty IS DISTINCT FROM actual.qty
  ) THEN
    RAISE EXCEPTION 'HUB_ORDER_BAG_CONTENT_PLAN_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hub_order_bag_pack_guard ON public.hub_physical_units;
CREATE TRIGGER trg_hub_order_bag_pack_guard
  BEFORE UPDATE OF state ON public.hub_physical_units
  FOR EACH ROW EXECUTE FUNCTION public.hub_order_bag_pack_guard();
