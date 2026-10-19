-- @migration 303_simulation_scope_and_cost_provenance.sql
-- @domain    economic-engine
-- @purpose   L3 — distinguer faits simulés de recette et activité réelle, sans second moteur de marge.
--
--   orders.simulation_scope : NULL = activité réelle. Valeur (ex. 'RCT1') = commande d'un périmètre de recette
--                             identifié. Posée une seule fois (immuable ensuite), par le service canonique.
--   order_item_real_cost_allocations.provenance : provenance déclarée d'un coût (ex. 'FICTIF recette').
--   cost_components.provenance : provenance déclarée d'un paramètre saisi (ex. commission relais).
--
-- Additive, idempotente. Aucun backfill : l'existant reste NULL (activité réelle / provenance non déclarée).

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS simulation_scope text;
ALTER TABLE public.order_item_real_cost_allocations ADD COLUMN IF NOT EXISTS provenance text;
ALTER TABLE public.cost_components ADD COLUMN IF NOT EXISTS provenance text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_simulation_scope_format') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_simulation_scope_format
      CHECK (simulation_scope IS NULL OR simulation_scope ~ '^[A-Z][A-Z0-9-]{1,31}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_simulation_scope
  ON public.orders (simulation_scope) WHERE simulation_scope IS NOT NULL;

COMMENT ON COLUMN public.orders.simulation_scope IS
  'NULL = activité réelle. Sinon identifiant du périmètre de recette (faits simulés) : exclu des agrégats '
  'd''activité réelle, inclus seulement quand ce périmètre est demandé explicitement. Immuable une fois posé.';
COMMENT ON COLUMN public.order_item_real_cost_allocations.provenance IS
  'Provenance déclarée du coût (ex. FICTIF recette, pièce fournisseur). NULL = non déclarée (historique).';
COMMENT ON COLUMN public.cost_components.provenance IS
  'Provenance déclarée de la valeur saisie. Un coût réel dérivé exige auteur ET provenance.';

-- Immuabilité : un périmètre posé ne se retire ni ne change (pas de requalification silencieuse).
CREATE OR REPLACE FUNCTION prevent_order_simulation_scope_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.simulation_scope IS NOT NULL AND NEW.simulation_scope IS DISTINCT FROM OLD.simulation_scope THEN
    RAISE EXCEPTION 'orders.simulation_scope est immuable une fois posé (%)', OLD.simulation_scope;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_orders_simulation_scope_immutable ON public.orders;
CREATE TRIGGER trg_orders_simulation_scope_immutable
  BEFORE UPDATE OF simulation_scope ON public.orders
  FOR EACH ROW EXECUTE FUNCTION prevent_order_simulation_scope_change();

-- Journal append-only des saisies/corrections de coûts et des affectations de périmètre (traçabilité L1/L3).
CREATE TABLE IF NOT EXISTS public.order_cost_entry_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('simulation_scope_assigned', 'manual_cost_entered', 'manual_cost_corrected')),
  cost_type text,
  idempotency_key text,
  old_value jsonb,
  new_value jsonb,
  provenance text,
  reason text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_cost_entry_events_order ON public.order_cost_entry_events (order_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_cost_entry_events_idem
  ON public.order_cost_entry_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
