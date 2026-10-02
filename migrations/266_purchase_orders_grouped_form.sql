-- 266 — Forme regroupée de purchase_orders (PR 4/8, MISSION_PURCHASE_LINES).
--
-- Une PO est SOIT de forme historique (order_id, qty, supplier_sku renseignés : une commande, un item),
-- SOIT de forme regroupée (en-tête fournisseur seul : les lignes d'achat portent tout le détail).
-- La forme est fixée par le chemin de création. Rien n'est supprimé : les colonnes de ligne de l'en-tête
-- restent, NULL pour la forme regroupée. Aucun comportement ne change tant que KOMERCE_GROUPED_PURCHASING est éteint.
--
-- Additif et idempotent.

-- 1. Statut `draft` : on relit le CHECK actuel (quelles que soient les valeurs déjà autorisées en live)
--    et on y ajoute uniquement `draft`.
DO $$
DECLARE
  v_name text;
  v_def text;
  v_values text[];
BEGIN
  FOR v_name, v_def IN
    SELECT c.conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
     WHERE c.conrelid = 'public.purchase_orders'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ~ '\mstatus\M'
       AND pg_get_constraintdef(c.oid) ~ '''(pending|notified|confirmed)''::text'
  LOOP
    SELECT array_agg(DISTINCT t.x[1] ORDER BY t.x[1]) INTO v_values
      FROM regexp_matches(v_def, '''([a-z_]+)''::text', 'g') AS t(x);
    IF NOT ('draft' = ANY (v_values)) THEN
      v_values := array_append(v_values, 'draft'::text);
    END IF;
    EXECUTE format('ALTER TABLE public.purchase_orders DROP CONSTRAINT %I', v_name);
    EXECUTE format(
      'ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status = ANY (ARRAY[%s]))',
      (SELECT string_agg(quote_literal(v) || '::text', ', ' ORDER BY v) FROM unnest(v_values) AS v)
    );
  END LOOP;
END $$;

-- 2. Colonnes de ligne de l'en-tête : nullables (forme regroupée).
ALTER TABLE public.purchase_orders ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN supplier_sku DROP NOT NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN qty DROP NOT NULL;

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS chk_purchase_orders_qty;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_qty CHECK (qty IS NULL OR qty > 0);

-- 3. Hub d'approvisionnement de l'en-tête : recopié à 'DXB' pour l'existant ; 'DXB' par défaut pour les écrivains
--    historiques qui ne le renseignent pas.
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS procurement_hub_ref text;
UPDATE public.purchase_orders SET procurement_hub_ref = 'DXB' WHERE procurement_hub_ref IS NULL;
ALTER TABLE public.purchase_orders ALTER COLUMN procurement_hub_ref SET DEFAULT 'DXB';
ALTER TABLE public.purchase_orders ALTER COLUMN procurement_hub_ref SET NOT NULL;

ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS chk_purchase_orders_hub_ref;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_hub_ref CHECK (btrim(procurement_hub_ref) <> '');

-- 4. Forme : historique (order_id, qty, supplier_sku renseignés) XOR regroupée (tout le détail de ligne NULL).
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS chk_purchase_orders_header_shape;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT chk_purchase_orders_header_shape CHECK (
    (order_id IS NOT NULL AND qty IS NOT NULL AND supplier_sku IS NOT NULL)
    OR (
      order_id IS NULL
      AND order_item_id IS NULL
      AND product_sku_id IS NULL
      AND supplier_unit_ref IS NULL
      AND supplier_order_identity IS NULL
      AND qty IS NULL
      AND supplier_sku IS NULL
      AND supplier_unit_price IS NULL
      AND supplier_currency IS NULL
    )
  );

COMMENT ON COLUMN public.purchase_orders.procurement_hub_ref IS
  'Hub d''approvisionnement destinataire de la PO (référence logique, ex. DXB). Toutes les lignes d''une PO regroupée partagent cette valeur.';

-- 5. I4 — homogénéité d'une PO regroupée, à tout rattachement (INSERT rattaché ou UPDATE de purchase_order_id).
--    Même fournisseur et même hub que l'en-tête ; même devise que les lignes déjà rattachées ; identité exacte
--    et prix présents (seules les lignes à identité exacte sont regroupables).
--    Le trigger porte un nom qui le fait passer AVANT la garde I3 : il prend FOR UPDATE sur l'en-tête
--    (sérialise deux rattachements concurrents de devises différentes), la garde I3 reprend ensuite FOR SHARE.
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_groupable() RETURNS trigger
LANGUAGE plpgsql AS $$
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
    RETURN NEW; -- PO historique : écriture double 1:1, gardée par I3
  END IF;

  IF NEW.product_sku_id IS NULL
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
END $$;

DROP TRIGGER IF EXISTS trg_purchase_lines_a_groupable ON public.purchase_lines;
CREATE TRIGGER trg_purchase_lines_a_groupable
  BEFORE INSERT OR UPDATE OF purchase_order_id ON public.purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_groupable();

-- 6. is_order_complete : une ligne ouverte (sans PO) non reçue rend la commande incomplète.
--    Avant PR 4 toute ligne non annulée avait une PO ; le filtre purchase_order_id IS NOT NULL n'a plus lieu d'être.
CREATE OR REPLACE FUNCTION public.is_order_complete(p_order_id uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public.v_purchase_line_progress v
     WHERE v.order_id = p_order_id
       AND NOT v.cancelled
       AND v.received_quantity < v.effective_quantity
  );
$$;
