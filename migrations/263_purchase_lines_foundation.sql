-- @migration 263_purchase_lines_foundation.sql
-- @domain    purchasing
-- @purpose   PURCHASE-LINES PR 1 — introduire purchase_lines, unité canonique de besoin
--            d'achat et de traçabilité vers order_items, sans changer aucun comportement
--            visible. Chaque PO historique reçoit sa ligne 1:1 (recopie), puis les gardes
--            transactionnelles sont posées. Aucune colonne supprimée ni modifiée.
--
-- Doctrine :
--   - purchase_orders reste l'en-tête fournisseur (le regroupement viendra en PR 4).
--   - Aucun statut stocké sur purchase_lines : l'état se déduit de faits.
--   - Anti-double-achat en base : la somme des quantités effectives des lignes d'un
--     order_item ne dépasse jamais order_items.quantity (garde I1, verrou FOR UPDATE).
--   - Recopie fail-closed : un sur-engagement ou une PO active sans order_item_id fait
--     ÉCHOUER la migration avec la liste des identifiants. Aucune correction silencieuse.
--
-- Ordre : table + index → recopie → diagnostics → gardes (triggers).

CREATE TABLE IF NOT EXISTS public.purchase_lines (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id        uuid NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  order_item_id            uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  supplier_id              uuid NOT NULL REFERENCES public.suppliers(id),
  product_supplier_id      uuid NULL REFERENCES public.product_suppliers(id) ON DELETE SET NULL,
  product_sku_id           uuid NULL REFERENCES public.product_skus(id),
  supplier_sku             text NOT NULL,
  supplier_unit_ref        text NULL,
  supplier_order_identity  jsonb NULL,
  quantity                 integer NOT NULL,
  supplier_unit_price      numeric(18,4) NULL,
  supplier_currency        text NULL,
  procurement_hub_ref      text NOT NULL,
  parent_line_id           uuid NULL REFERENCES public.purchase_lines(id),
  confirmed_quantity       integer NULL,
  confirmed_unit_price     numeric(18,4) NULL,
  confirmed_at             timestamptz NULL,
  settled_quantity         integer NULL,
  settled_at               timestamptz NULL,
  settle_reason            text NULL,
  cancelled_at             timestamptz NULL,
  cancel_reason            text NULL,
  created_by               uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_purchase_lines_quantity CHECK (quantity > 0),
  CONSTRAINT chk_purchase_lines_hub_ref CHECK (btrim(procurement_hub_ref) <> ''),
  CONSTRAINT chk_purchase_lines_supplier_unit_ref_nonempty
    CHECK (supplier_unit_ref IS NULL OR btrim(supplier_unit_ref) <> ''),
  CONSTRAINT chk_purchase_lines_confirmed_bound
    CHECK (confirmed_quantity IS NULL OR (confirmed_quantity >= 0 AND confirmed_quantity <= quantity)),
  CONSTRAINT chk_purchase_lines_confirmed_price
    CHECK (confirmed_unit_price IS NULL OR confirmed_unit_price > 0),
  CONSTRAINT chk_purchase_lines_settled_nonneg
    CHECK (settled_quantity IS NULL OR settled_quantity >= 0),
  CONSTRAINT chk_purchase_lines_cancel_pair
    CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL)),
  CONSTRAINT chk_purchase_lines_settle_pair
    CHECK ((settled_at IS NULL) = (settled_quantity IS NULL)),
  CONSTRAINT chk_purchase_lines_settle_bound
    CHECK (settled_quantity IS NULL OR settled_quantity <= COALESCE(confirmed_quantity, quantity)),
  CONSTRAINT chk_purchase_lines_supplier_money_pair
    CHECK (
      (supplier_unit_price IS NULL AND supplier_currency IS NULL)
      OR (supplier_unit_price IS NOT NULL AND supplier_currency IS NOT NULL
          AND supplier_unit_price > 0 AND supplier_currency ~ '^[A-Z]{3}$')
    ),
  CONSTRAINT chk_purchase_lines_supplier_order_identity_shape
    CHECK (
      supplier_order_identity IS NULL
      OR (
        product_sku_id IS NOT NULL
        AND supplier_unit_ref IS NOT NULL
        AND jsonb_typeof(supplier_order_identity) = 'object'
        AND jsonb_typeof(supplier_order_identity->'provider') = 'string'
        AND btrim(supplier_order_identity->>'provider') <> ''
        AND jsonb_typeof(supplier_order_identity->'version') = 'number'
        AND (supplier_order_identity->>'version') ~ '^[0-9]+$'
        AND (supplier_order_identity->>'version')::integer >= 1
        AND jsonb_typeof(supplier_order_identity->'payload') = 'object'
        AND supplier_order_identity->'payload' <> '{}'::jsonb
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_order_item ON public.purchase_lines (order_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase_order ON public.purchase_lines (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_lines_open_group ON public.purchase_lines (supplier_id, procurement_hub_ref)
  WHERE purchase_order_id IS NULL AND cancelled_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recopie 1:1 : chaque PO historique rattachée à un order_item reçoit sa ligne.
-- Faite AVANT la pose des gardes (ceux-ci ne valident que les écritures futures).
-- Idempotente : une PO déjà recopiée (ligne existante) est ignorée.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.purchase_lines (
  purchase_order_id, order_item_id, supplier_id, product_supplier_id, product_sku_id,
  supplier_sku, supplier_unit_ref, supplier_order_identity, quantity,
  supplier_unit_price, supplier_currency, procurement_hub_ref,
  confirmed_quantity, confirmed_unit_price, confirmed_at,
  cancelled_at, cancel_reason, created_at, updated_at
)
SELECT
  po.id, po.order_item_id, po.supplier_id, po.product_supplier_id, po.product_sku_id,
  po.supplier_sku, po.supplier_unit_ref, po.supplier_order_identity, po.qty,
  po.supplier_unit_price, po.supplier_currency,
  'DXB',  -- Procurement Hub V1 = Dubai (DOCTRINE_PROCUREMENT_FULFILLMENT §5) : rôle, pas constante métier
  CASE WHEN po.status IN ('confirmed', 'hub_received') THEN po.qty END,
  CASE WHEN po.status IN ('confirmed', 'hub_received') THEN po.supplier_unit_price END,
  CASE WHEN po.status IN ('confirmed', 'hub_received') THEN COALESCE(po.confirmed_at, po.updated_at) END,
  CASE WHEN po.status = 'cancelled' THEN po.updated_at END,
  CASE WHEN po.status = 'cancelled' THEN 'legacy_backfill_cancelled' END,
  po.created_at, po.updated_at
FROM public.purchase_orders po
WHERE po.order_item_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.purchase_lines pl WHERE pl.purchase_order_id = po.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnostics bloquants — décision humaine requise, jamais de correction silencieuse.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_overcommitted text;
  v_orphan_active text;
BEGIN
  SELECT string_agg(x.order_item_id::text || ' (besoin ' || x.need || ', engagé ' || x.committed || ')', ', ')
    INTO v_overcommitted
  FROM (
    SELECT pl.order_item_id, oi.quantity AS need,
           SUM(CASE WHEN pl.cancelled_at IS NOT NULL THEN 0
                    ELSE COALESCE(pl.settled_quantity, pl.confirmed_quantity, pl.quantity) END) AS committed
    FROM public.purchase_lines pl
    JOIN public.order_items oi ON oi.id = pl.order_item_id
    GROUP BY pl.order_item_id, oi.quantity
    HAVING SUM(CASE WHEN pl.cancelled_at IS NOT NULL THEN 0
                    ELSE COALESCE(pl.settled_quantity, pl.confirmed_quantity, pl.quantity) END) > oi.quantity
  ) x;

  IF v_overcommitted IS NOT NULL THEN
    RAISE EXCEPTION 'purchase_lines_backfill_overcommitted: order_items sur-engagés par des PO existantes : %', v_overcommitted
      USING HINT = 'Décision humaine : annuler ou corriger les PO en trop avant de rejouer la migration 263.';
  END IF;

  SELECT string_agg(po.id::text || ' [' || po.status || ']', ', ')
    INTO v_orphan_active
  FROM public.purchase_orders po
  WHERE po.order_item_id IS NULL
    AND po.status IN ('pending', 'notified', 'confirmed');

  IF v_orphan_active IS NOT NULL THEN
    RAISE EXCEPTION 'purchase_lines_backfill_active_po_without_order_item: PO actives sans order_item_id : %', v_orphan_active
      USING HINT = 'Décision humaine : rattacher ou annuler ces PO avant de rejouer la migration 263.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Quantité effective d'une ligne — définition unique, utilisée par I1 et le diagnostic :
--   0 si annulée ; sinon COALESCE(settled_quantity, confirmed_quantity, quantity).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_line_effective_quantity(
  p_cancelled_at timestamptz, p_settled integer, p_confirmed integer, p_quantity integer
) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_cancelled_at IS NOT NULL THEN 0
              ELSE COALESCE(p_settled, p_confirmed, p_quantity) END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- I1 — pas de sur-engagement. Verrou FOR UPDATE sur l'order_item : deux écritures
-- concurrentes sur le même besoin sont sérialisées, la seconde voit la première.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_commitment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_need integer;
  v_others integer;
  v_self integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.order_item_id = OLD.order_item_id
     AND NEW.quantity = OLD.quantity
     AND NEW.confirmed_quantity IS NOT DISTINCT FROM OLD.confirmed_quantity
     AND NEW.settled_quantity IS NOT DISTINCT FROM OLD.settled_quantity
     AND NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at THEN
    RETURN NEW;
  END IF;

  SELECT quantity INTO v_need FROM public.order_items WHERE id = NEW.order_item_id FOR UPDATE;
  IF v_need IS NULL THEN
    RAISE EXCEPTION 'purchase_line_order_item_missing' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(SUM(public.purchase_line_effective_quantity(cancelled_at, settled_quantity, confirmed_quantity, quantity)), 0)
    INTO v_others
  FROM public.purchase_lines
  WHERE order_item_id = NEW.order_item_id AND id <> NEW.id;

  v_self := public.purchase_line_effective_quantity(NEW.cancelled_at, NEW.settled_quantity, NEW.confirmed_quantity, NEW.quantity);

  IF v_others + v_self > v_need THEN
    RAISE EXCEPTION 'purchase_line_overcommitted: order_item % besoin % engagé %', NEW.order_item_id, v_need, v_others + v_self
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_lines_guard_commitment ON public.purchase_lines;
CREATE TRIGGER trg_purchase_lines_guard_commitment
  BEFORE INSERT OR UPDATE ON public.purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_commitment();

-- ─────────────────────────────────────────────────────────────────────────────
-- I3 — rattachement / détachement : seulement en brouillon. Exception PR 1 : l'INSERT
-- d'une ligne déjà rattachée à une PO de forme historique (écriture double 1:1), à
-- condition que cette PO n'ait encore aucune ligne et vise le même order_item.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_attachment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_order_id uuid;
  v_order_item uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.purchase_order_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT status, order_id, order_item_id INTO v_status, v_order_id, v_order_item
      FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR SHARE;
    IF v_status IS NULL THEN
      RAISE EXCEPTION 'purchase_line_po_missing' USING ERRCODE = '23503';
    END IF;
    IF v_order_id IS NULL OR v_order_item IS DISTINCT FROM NEW.order_item_id THEN
      RAISE EXCEPTION 'purchase_line_attach_forbidden: insertion rattachée réservée à une PO historique du même order_item'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM public.purchase_lines WHERE purchase_order_id = NEW.purchase_order_id) THEN
      RAISE EXCEPTION 'purchase_line_historical_po_already_has_line' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.purchase_order_id IS NOT DISTINCT FROM OLD.purchase_order_id THEN
    RETURN NEW;
  END IF;

  IF OLD.purchase_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.purchase_orders WHERE id = OLD.purchase_order_id FOR SHARE;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'purchase_line_detach_forbidden: la PO d''origine n''est pas en brouillon' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.purchase_order_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.purchase_orders WHERE id = NEW.purchase_order_id FOR SHARE;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'purchase_line_attach_forbidden: la PO cible n''est pas en brouillon' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_lines_guard_attachment ON public.purchase_lines;
CREATE TRIGGER trg_purchase_lines_guard_attachment
  BEFORE INSERT OR UPDATE ON public.purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_attachment();

-- ─────────────────────────────────────────────────────────────────────────────
-- I5 — gel. Ligne rattachée à une PO qui n'est plus en brouillon : tout est immuable
-- sauf confirmation, clôture et annulation, chacune écrite UNE SEULE FOIS (NULL → valeur).
-- Ligne ouverte ou en brouillon : seuls purchase_order_id (garde I3) et l'annulation
-- bougent. La quantité d'une ligne ne change jamais : on fractionne.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_po_status text;
BEGIN
  IF NEW.order_item_id IS DISTINCT FROM OLD.order_item_id
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.product_supplier_id IS DISTINCT FROM OLD.product_supplier_id
     OR NEW.product_sku_id IS DISTINCT FROM OLD.product_sku_id
     OR NEW.supplier_sku IS DISTINCT FROM OLD.supplier_sku
     OR NEW.supplier_unit_ref IS DISTINCT FROM OLD.supplier_unit_ref
     OR NEW.supplier_order_identity IS DISTINCT FROM OLD.supplier_order_identity
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.supplier_unit_price IS DISTINCT FROM OLD.supplier_unit_price
     OR NEW.supplier_currency IS DISTINCT FROM OLD.supplier_currency
     OR NEW.procurement_hub_ref IS DISTINCT FROM OLD.procurement_hub_ref
     OR NEW.parent_line_id IS DISTINCT FROM OLD.parent_line_id THEN
    RAISE EXCEPTION 'purchase_line_frozen: champ d''identité ou de quantité immuable' USING ERRCODE = '23514';
  END IF;

  -- Ligne ouverte ou en brouillon : ni confirmation ni clôture (rien n'est parti chez le fournisseur).
  IF OLD.purchase_order_id IS NOT NULL THEN
    SELECT status INTO v_po_status FROM public.purchase_orders WHERE id = OLD.purchase_order_id;
  END IF;
  IF (OLD.purchase_order_id IS NULL OR v_po_status = 'draft')
     AND (NEW.confirmed_quantity IS DISTINCT FROM OLD.confirmed_quantity
          OR NEW.confirmed_unit_price IS DISTINCT FROM OLD.confirmed_unit_price
          OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
          OR NEW.settled_quantity IS DISTINCT FROM OLD.settled_quantity
          OR NEW.settled_at IS DISTINCT FROM OLD.settled_at
          OR NEW.settle_reason IS DISTINCT FROM OLD.settle_reason) THEN
    RAISE EXCEPTION 'purchase_line_frozen: pas de confirmation ni de clôture avant soumission' USING ERRCODE = '23514';
  END IF;

  -- Écritures uniques : une valeur posée ne change plus.
  IF OLD.confirmed_quantity IS NOT NULL
     AND (NEW.confirmed_quantity IS DISTINCT FROM OLD.confirmed_quantity
          OR NEW.confirmed_unit_price IS DISTINCT FROM OLD.confirmed_unit_price
          OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
    RAISE EXCEPTION 'purchase_line_frozen: confirmation déjà enregistrée' USING ERRCODE = '23514';
  END IF;
  IF OLD.settled_at IS NOT NULL
     AND (NEW.settled_quantity IS DISTINCT FROM OLD.settled_quantity
          OR NEW.settled_at IS DISTINCT FROM OLD.settled_at
          OR NEW.settle_reason IS DISTINCT FROM OLD.settle_reason) THEN
    RAISE EXCEPTION 'purchase_line_frozen: clôture déjà enregistrée' USING ERRCODE = '23514';
  END IF;
  IF OLD.cancelled_at IS NOT NULL
     AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
          OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION 'purchase_line_frozen: annulation déjà enregistrée' USING ERRCODE = '23514';
  END IF;
  -- Confirmation et prix confirmé s'écrivent ensemble.
  IF (NEW.confirmed_quantity IS NULL) <> (NEW.confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'purchase_line_frozen: confirmed_quantity et confirmed_at s''écrivent ensemble' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_lines_guard_freeze ON public.purchase_lines;
CREATE TRIGGER trg_purchase_lines_guard_freeze
  BEFORE UPDATE ON public.purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_freeze();

-- ─────────────────────────────────────────────────────────────────────────────
-- I6 — pas de suppression directe : on annule. Les suppressions en cascade (purge
-- d'une commande, nettoyage staging) restent possibles : elles s'exécutent à une
-- profondeur de trigger supérieure à 1.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_lines_guard_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'purchase_line_delete_forbidden: annuler la ligne (cancelled_at) plutôt que la supprimer' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_lines_guard_delete ON public.purchase_lines;
CREATE TRIGGER trg_purchase_lines_guard_delete
  BEFORE DELETE ON public.purchase_lines
  FOR EACH ROW EXECUTE FUNCTION public.purchase_lines_guard_delete();
