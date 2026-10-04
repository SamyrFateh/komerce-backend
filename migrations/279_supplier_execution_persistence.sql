-- @migration 279_supplier_execution_persistence.sql
-- @domain    purchasing
-- @purpose   Persistance canonique et reprenable du dialogue d'exécution fournisseur.
--
-- Le modèle sépare :
--   - la PO Komerce (purchase_orders) ;
--   - les sous-ordres natifs du provider ;
--   - les lignes Komerce couvertes par chaque sous-ordre ;
--   - un éventuel parent/groupe provider ;
--   - le journal append-only des opérations provider.
--
-- Aucun nom de champ spécifique CJ n'est exposé dans le schéma canonique.
-- Aucun secret, token, credential ni payload provider brut ne doit être écrit ici.

CREATE TABLE IF NOT EXISTS public.supplier_execution_orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id        uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  provider                 text NOT NULL,
  supplier_order_id        text NOT NULL,
  supplier_order_code      text NULL,
  provider_status          text NULL,
  provider_facts           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_supplier_execution_orders_provider
    CHECK (btrim(provider) <> ''),
  CONSTRAINT chk_supplier_execution_orders_supplier_order_id
    CHECK (btrim(supplier_order_id) <> ''),
  CONSTRAINT chk_supplier_execution_orders_order_code
    CHECK (supplier_order_code IS NULL OR btrim(supplier_order_code) <> ''),
  CONSTRAINT chk_supplier_execution_orders_facts_object
    CHECK (jsonb_typeof(provider_facts) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_execution_orders_provider_order
  ON public.supplier_execution_orders(provider, supplier_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_execution_orders_provider_code
  ON public.supplier_execution_orders(provider, supplier_order_code)
  WHERE supplier_order_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_execution_orders_purchase_order
  ON public.supplier_execution_orders(purchase_order_id);


CREATE TABLE IF NOT EXISTS public.supplier_execution_order_lines (
  supplier_execution_order_id uuid NOT NULL
    REFERENCES public.supplier_execution_orders(id) ON DELETE CASCADE,
  purchase_line_id             uuid NOT NULL
    REFERENCES public.purchase_lines(id) ON DELETE RESTRICT,
  quantity                     integer NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (supplier_execution_order_id, purchase_line_id),
  CONSTRAINT chk_supplier_execution_order_lines_quantity CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_supplier_execution_order_lines_purchase_line
  ON public.supplier_execution_order_lines(purchase_line_id);


CREATE TABLE IF NOT EXISTS public.supplier_execution_groups (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id          uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  provider                   text NOT NULL,
  supplier_parent_order_id   text NOT NULL,
  payment_ref                text NULL,
  provider_status            text NULL,
  payment_status             text NULL,
  provider_facts             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_supplier_execution_groups_provider
    CHECK (btrim(provider) <> ''),
  CONSTRAINT chk_supplier_execution_groups_parent_id
    CHECK (btrim(supplier_parent_order_id) <> ''),
  CONSTRAINT chk_supplier_execution_groups_payment_ref
    CHECK (payment_ref IS NULL OR btrim(payment_ref) <> ''),
  CONSTRAINT chk_supplier_execution_groups_facts_object
    CHECK (jsonb_typeof(provider_facts) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_execution_groups_provider_parent
  ON public.supplier_execution_groups(provider, supplier_parent_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_execution_groups_provider_payment_ref
  ON public.supplier_execution_groups(provider, payment_ref)
  WHERE payment_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_execution_groups_purchase_order
  ON public.supplier_execution_groups(purchase_order_id);


CREATE TABLE IF NOT EXISTS public.supplier_execution_group_members (
  supplier_execution_group_id uuid NOT NULL
    REFERENCES public.supplier_execution_groups(id) ON DELETE CASCADE,
  supplier_execution_order_id uuid NOT NULL
    REFERENCES public.supplier_execution_orders(id) ON DELETE RESTRICT,
  created_at                  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (supplier_execution_group_id, supplier_execution_order_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_execution_group_members_order
  ON public.supplier_execution_group_members(supplier_execution_order_id);


-- Un parent provider ne peut regrouper que des sous-ordres de la même PO Komerce
-- et du même provider. Cette garde évite qu'un adapter mélange deux conversations.
CREATE OR REPLACE FUNCTION public.supplier_execution_group_members_guard()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_group_po uuid;
  v_group_provider text;
  v_order_po uuid;
  v_order_provider text;
BEGIN
  SELECT purchase_order_id, provider
    INTO v_group_po, v_group_provider
    FROM public.supplier_execution_groups
   WHERE id = NEW.supplier_execution_group_id
   FOR SHARE;

  SELECT purchase_order_id, provider
    INTO v_order_po, v_order_provider
    FROM public.supplier_execution_orders
   WHERE id = NEW.supplier_execution_order_id
   FOR SHARE;

  IF v_group_po IS DISTINCT FROM v_order_po
     OR v_group_provider IS DISTINCT FROM v_order_provider THEN
    RAISE EXCEPTION
      'supplier_execution_group_member_mismatch: parent et sous-ordre doivent partager purchase_order_id et provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_supplier_execution_group_members_guard
  ON public.supplier_execution_group_members;

CREATE TRIGGER trg_supplier_execution_group_members_guard
  BEFORE INSERT OR UPDATE
  ON public.supplier_execution_group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.supplier_execution_group_members_guard();


CREATE TABLE IF NOT EXISTS public.supplier_execution_events (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id            uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE RESTRICT,
  provider                     text NOT NULL,
  supplier_execution_order_id  uuid NULL
    REFERENCES public.supplier_execution_orders(id) ON DELETE RESTRICT,
  supplier_execution_group_id  uuid NULL
    REFERENCES public.supplier_execution_groups(id) ON DELETE RESTRICT,
  operation                    text NOT NULL,
  outcome                      text NOT NULL,
  provider_request_id          text NULL,
  provider_code                text NULL,
  provider_message             text NULL,
  facts                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_supplier_execution_events_provider
    CHECK (btrim(provider) <> ''),
  CONSTRAINT chk_supplier_execution_events_operation
    CHECK (btrim(operation) <> ''),
  CONSTRAINT chk_supplier_execution_events_outcome
    CHECK (outcome IN ('requested', 'succeeded', 'rejected', 'ambiguous', 'observed')),
  CONSTRAINT chk_supplier_execution_events_facts_object
    CHECK (jsonb_typeof(facts) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_supplier_execution_events_purchase_order_time
  ON public.supplier_execution_events(purchase_order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_supplier_execution_events_order
  ON public.supplier_execution_events(supplier_execution_order_id)
  WHERE supplier_execution_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_execution_events_group
  ON public.supplier_execution_events(supplier_execution_group_id)
  WHERE supplier_execution_group_id IS NOT NULL;

COMMENT ON TABLE public.supplier_execution_orders IS
  'Sous-ordres natifs provider liés à une PO Komerce. Ex: CJ orderId/orderCode sont mappés vers supplier_order_id/supplier_order_code par l adapter.';
COMMENT ON TABLE public.supplier_execution_groups IS
  'Parent ou groupe natif provider pour une PO Komerce. Ex: un shipmentOrderId CJ est mappé vers supplier_parent_order_id.';
COMMENT ON TABLE public.supplier_execution_events IS
  'Journal append-only du dialogue provider. facts contient uniquement des faits bornés/sanitisés; jamais de secret ni payload brut.';
