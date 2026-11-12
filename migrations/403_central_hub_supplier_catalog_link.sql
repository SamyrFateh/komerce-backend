-- @migration 403_central_hub_supplier_catalog_link.sql
-- @domain    purchasing,catalog,sourcing
-- @purpose   Provide a durable internal Hub procurement identity and trace manual catalog products to it.
-- @added-header 2026-11-12
--
-- This row represents the Hub's procurement operation, not an external provider
-- or a claim that the Hub is the economic seller. Supplier Order Identity and
-- execution mode remain independent facts.

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS system_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_system_key
  ON public.suppliers (system_key)
  WHERE system_key IS NOT NULL;

ALTER TABLE public.supplier_catalog_imports
  ADD COLUMN IF NOT EXISTS supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT;

ALTER TABLE public.sourcing_candidates
  ADD COLUMN IF NOT EXISTS supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS procurement_supplier_id uuid NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.suppliers.system_key IS
  'Stable key for protected system-owned supplier records; not a provider identity.';
COMMENT ON COLUMN public.supplier_catalog_imports.supplier_id IS
  'Canonical operating supplier selected for this import; separate from source_type and supplier_order_identity.';
COMMENT ON COLUMN public.sourcing_candidates.supplier_id IS
  'Canonical supplier/Hub procurement owner carried from the import; does not create an external provider identity.';
COMMENT ON COLUMN public.products.procurement_supplier_id IS
  'Default operational procurement supplier inherited by variants and SKUs; separate from external seller/Supplier Order Identity.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_central_hub_shape') THEN
    ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_central_hub_shape
      CHECK (system_key IS DISTINCT FROM 'central_hub'
        OR (name = 'Fournisseur central Hub'
          AND platform = 'local'
          AND owner_scope = 'hub'
          AND auto_order = FALSE
          AND is_active = TRUE
          AND deleted_at IS NULL));
  END IF;
END $$;

-- The central Hub enters the existing grouped manual-purchasing lifecycle.
-- These lines are internal work for the Hub and may not yet have an external
-- seller SKU, SOI, or supplier price. The normal commitment authorization
-- supplies a sourced amount; confirmation still requires the actual price and
-- a purchase proof before payment authorization.
ALTER TABLE public.purchase_lines ALTER COLUMN supplier_sku DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.purchase_lines_require_supplier_sku_unless_central_hub()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.supplier_sku IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.suppliers s
        WHERE s.id = NEW.supplier_id AND s.system_key = 'central_hub'
     ) THEN
    RAISE EXCEPTION 'purchase_line_supplier_sku_required'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_lines_require_sku_unless_central_hub ON public.purchase_lines;
CREATE TRIGGER trg_purchase_lines_require_sku_unless_central_hub
  BEFORE INSERT OR UPDATE OF supplier_id, supplier_sku ON public.purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_require_supplier_sku_unless_central_hub();

-- Keep the same I4 grouped-PO guard and homogeneity checks. Only the central
-- Hub's explicitly manual PO may start without external seller identity facts.
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_groupable() RETURNS trigger
LANGUAGE plpgsql AS $$
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
    NULL;
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

CREATE OR REPLACE FUNCTION public.protect_central_hub_supplier_row()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM public.suppliers WHERE system_key = 'central_hub') THEN
      RAISE EXCEPTION 'CENTRAL_HUB_SUPPLIER_IMMUTABLE';
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.system_key = 'central_hub' THEN
    RAISE EXCEPTION 'CENTRAL_HUB_SUPPLIER_IMMUTABLE';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_central_hub_supplier_row ON public.suppliers;
CREATE TRIGGER trg_protect_central_hub_supplier_row
  BEFORE UPDATE OR DELETE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.protect_central_hub_supplier_row();

DROP TRIGGER IF EXISTS trg_protect_central_hub_supplier_truncate ON public.suppliers;
CREATE TRIGGER trg_protect_central_hub_supplier_truncate
  BEFORE TRUNCATE ON public.suppliers
  FOR EACH STATEMENT EXECUTE FUNCTION public.protect_central_hub_supplier_row();

INSERT INTO public.suppliers (name, platform, auto_order, is_active, owner_scope, notes, system_key)
VALUES (
  'Fournisseur central Hub',
  'local',
  FALSE,
  TRUE,
  'hub',
  'Entité système de coordination des achats manuels. Ne représente pas un vendeur tiers et ne porte aucune identité provider/API.',
  'central_hub'
)
ON CONFLICT (system_key) WHERE system_key IS NOT NULL DO NOTHING;

-- Keep the row present on re-run without mutating its protected identity.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE system_key = 'central_hub'
       AND name = 'Fournisseur central Hub'
       AND platform = 'local'
       AND owner_scope = 'hub'
       AND auto_order = FALSE
       AND is_active = TRUE
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CENTRAL_HUB_SUPPLIER_PROVISIONING_INVALID';
  END IF;
END $$;
