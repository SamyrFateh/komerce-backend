-- @migration 391_hub_sku_physical_codes.sql
-- Hub V1 / #3329 : code physique = identité d'une variante, PAS d'une commande ni d'une unité.
-- Mapping durable ; allocations client et mouvements physiques restent dans les tables canoniques.
CREATE TABLE IF NOT EXISTS public.product_sku_physical_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_sku_id uuid NOT NULL REFERENCES public.product_skus(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE CASCADE,
  code text NOT NULL CHECK (
    code <> '' AND length(code) <= 128 AND code = upper(btrim(code))
    AND code !~ '[[:cntrl:]]'
  ),
  code_type text NOT NULL CHECK (code_type IN ('EAN_GTIN','SUPPLIER_BARCODE','KOM_LOT_LABEL')),
  trust text NOT NULL DEFAULT 'DECLARED' CHECK (trust IN ('DECLARED','CONFIRMED')),
  printed_on_pack boolean,
  confirmed_by uuid REFERENCES public.users(id),
  confirmed_at timestamptz,
  confirmation_proof_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_physical_code_scope CHECK (
    (code_type = 'EAN_GTIN' AND supplier_id IS NULL)
    OR (code_type IN ('SUPPLIER_BARCODE','KOM_LOT_LABEL') AND supplier_id IS NOT NULL)
  ),
  CONSTRAINT chk_physical_code_confirmation CHECK (
    (trust = 'DECLARED' AND confirmed_by IS NULL AND confirmed_at IS NULL AND confirmation_proof_ref IS NULL)
    OR (trust = 'CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL
      AND nullif(btrim(confirmation_proof_ref), '') IS NOT NULL)
  )
);
-- Multiple copies with the same EAN are expected; a code never identifies an individual unit.
CREATE UNIQUE INDEX IF NOT EXISTS ux_physical_code_global
  ON public.product_sku_physical_codes(code) WHERE supplier_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_physical_code_supplier
  ON public.product_sku_physical_codes(supplier_id, code) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_physical_code_sku
  ON public.product_sku_physical_codes(product_sku_id);
