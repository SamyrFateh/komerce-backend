-- 359 — Journal financier canonique (Lot 5, décision propriétaire : journal d'abord, pivot EUR dès son contrat).
--
-- Un mouvement financier = un fait métier projeté, avec ses montants NATIFS, ses taux historiques (jambes FX figées),
-- son état et sa provenance. Idempotent par movement_key ; les champs monétaires sont immuables une fois posés,
-- l'état n'avance que vers l'avant. Ce n'est PAS une comptabilité en partie double (pas de comptes débit/crédit).
-- Rollback : DROP TABLE public.financial_movement_documents, public.financial_movements CASCADE ; DROP FUNCTION public.financial_movements_guard().

CREATE TABLE IF NOT EXISTS public.financial_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_key    text NOT NULL,
  source_kind     text NOT NULL,
  source_id       text NOT NULL,
  facet           text NOT NULL DEFAULT 'main',
  direction       text NOT NULL,
  category        text NOT NULL,
  state           text NOT NULL,
  market_id       uuid NULL REFERENCES public.markets(id),
  order_id        uuid NULL,
  purchase_order_id uuid NULL,
  shipment_id     uuid NULL,
  parcel_id       uuid NULL,
  supplier_id     uuid NULL,
  relais_id       uuid NULL,
  amount_native   numeric(18,4) NOT NULL,
  currency        text NOT NULL,
  amount_eur      numeric(18,2) NULL,
  fx_status       text NOT NULL,
  fx_legs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  fx_as_of        timestamptz NULL,
  occurred_at     timestamptz NOT NULL,
  provenance      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  state_changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_financial_movements_key UNIQUE (movement_key),
  CONSTRAINT chk_fm_key CHECK (movement_key = source_kind || ':' || source_id || ':' || facet),
  CONSTRAINT chk_fm_direction CHECK (direction IN ('inflow', 'outflow', 'cost')),
  CONSTRAINT chk_fm_state CHECK (state IN ('planned', 'committed', 'observed', 'settled', 'reversed')),
  CONSTRAINT chk_fm_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT chk_fm_amount CHECK (amount_native > 0),
  CONSTRAINT chk_fm_fx_status CHECK (fx_status IN ('snapshot', 'converted', 'native_eur', 'unavailable')),
  CONSTRAINT chk_fm_eur_presence CHECK ((fx_status = 'unavailable') = (amount_eur IS NULL)),
  CONSTRAINT chk_fm_legs_array CHECK (jsonb_typeof(fx_legs) = 'array'),
  CONSTRAINT chk_fm_provenance_object CHECK (jsonb_typeof(provenance) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_fm_market_time ON public.financial_movements (market_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_fm_order ON public.financial_movements (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_po ON public.financial_movements (purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fm_source ON public.financial_movements (source_kind, source_id);

-- Pièces justificatives : plusieurs pièces par mouvement, sans doublon.
CREATE TABLE IF NOT EXISTS public.financial_movement_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id  uuid NOT NULL REFERENCES public.financial_movements(id) ON DELETE CASCADE,
  doc_kind     text NOT NULL,
  doc_ref      text NOT NULL,
  doc_url      text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_fmd_ref CHECK (btrim(doc_ref) <> ''),
  CONSTRAINT uq_fmd UNIQUE (movement_id, doc_kind, doc_ref)
);

-- Immuabilité : identité, montants natifs, EUR, taux et date métier ne changent jamais ;
-- l'état n'avance qu'en avant (planned < committed < observed < settled < reversed).
CREATE OR REPLACE FUNCTION public.financial_movements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rank_old int; rank_new int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial_movements est append-only (DELETE interdit) : corriger par un mouvement reversed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.movement_key IS DISTINCT FROM OLD.movement_key OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.amount_native IS DISTINCT FROM OLD.amount_native OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at THEN
    RAISE EXCEPTION 'financial_movements : identité et montants natifs immuables' USING ERRCODE = 'restrict_violation';
  END IF;
  -- EUR et taux : posables une seule fois (de unavailable vers converti), jamais modifiables ensuite.
  IF OLD.fx_status <> 'unavailable' AND (NEW.amount_eur IS DISTINCT FROM OLD.amount_eur OR NEW.fx_legs IS DISTINCT FROM OLD.fx_legs
     OR NEW.fx_status IS DISTINCT FROM OLD.fx_status OR NEW.fx_as_of IS DISTINCT FROM OLD.fx_as_of) THEN
    RAISE EXCEPTION 'financial_movements : montant EUR et taux figés' USING ERRCODE = 'restrict_violation';
  END IF;
  rank_old := array_position(ARRAY['planned','committed','observed','settled','reversed'], OLD.state);
  rank_new := array_position(ARRAY['planned','committed','observed','settled','reversed'], NEW.state);
  IF rank_new < rank_old THEN
    RAISE EXCEPTION 'financial_movements : l''état ne recule pas (% -> %)', OLD.state, NEW.state USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN NEW.state_changed_at := now(); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_financial_movements_guard ON public.financial_movements;
CREATE TRIGGER trg_financial_movements_guard BEFORE UPDATE OR DELETE ON public.financial_movements
  FOR EACH ROW EXECUTE FUNCTION public.financial_movements_guard();

COMMENT ON TABLE public.financial_movements IS
  'Journal financier canonique (projection idempotente des faits métier) : natif + EUR + taux figés + état + provenance. Pas de partie double.';
