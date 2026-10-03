-- @migration 267_market_cost_attributions.sql
-- @domain    economic-engine
-- @purpose   Créer la table market_cost_attributions — répartition des charges
--            de structure mutualisées (scope_kind = 'GROUP') entre marchés.
--
-- Doctrine :
--   - Seuls les economic_structure_cost_events à scope_kind = 'GROUP' génèrent
--     des attributions. Les MARKET_DIRECT portent déjà leur market_id.
--   - Les coûts variables transactionnels (freight, customs, product_purchase,
--     relay, payment, etc.) ne passent JAMAIS par cette table. Leur attribution
--     market est une projection : real_cost_allocations → order → market_id.
--   - Append-only strict : jamais d'UPDATE, jamais de DELETE.
--   - Idempotence : replay identique avec attribution active → noop.
--   - Correction : REVERSAL des attributions actives puis nouvelles ATTRIBUTION.
--   - Conservation : SUM(attributions) par source_event_id = event.amount_kmf.
--   - Chaque ATTRIBUTION ne peut être reversée qu'une seule fois (UNIQUE sur reverses_id).

CREATE TABLE IF NOT EXISTS public.market_cost_attributions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id   uuid NOT NULL REFERENCES public.economic_structure_cost_events(id),
  market_id         uuid NOT NULL REFERENCES public.markets(id),
  event_kind        text NOT NULL,
  amount_kmf        numeric(18,2) NOT NULL,
  allocation_key    text NOT NULL,
  allocation_basis  jsonb NOT NULL,
  policy_version    text NOT NULL,
  reverses_id       uuid REFERENCES public.market_cost_attributions(id),
  recorded_by       uuid NOT NULL REFERENCES public.users(id),
  recorded_at       timestamptz NOT NULL DEFAULT now(),

  -- event_kind : ATTRIBUTION (répartition initiale) ou REVERSAL (annulation)
  CONSTRAINT chk_mca_event_kind CHECK (event_kind IN ('ATTRIBUTION', 'REVERSAL')),

  -- Montant non nul
  CONSTRAINT chk_mca_amount_nonzero CHECK (amount_kmf <> 0),

  -- Signe cohérent avec le type d'événement
  CONSTRAINT chk_mca_sign CHECK (
    (event_kind = 'ATTRIBUTION' AND amount_kmf > 0)
    OR (event_kind = 'REVERSAL' AND amount_kmf < 0)
  ),

  -- ATTRIBUTION n'a pas de reverses_id ; REVERSAL en a un obligatoirement
  CONSTRAINT chk_mca_reversal_link CHECK (
    (event_kind = 'ATTRIBUTION' AND reverses_id IS NULL)
    OR (event_kind = 'REVERSAL' AND reverses_id IS NOT NULL)
  )
);

-- Chaque ATTRIBUTION ne peut être reversée qu'une seule fois
CREATE UNIQUE INDEX IF NOT EXISTS idx_mca_reversal_unique
  ON public.market_cost_attributions (reverses_id)
  WHERE reverses_id IS NOT NULL;

-- Recherche par source_event_id (idempotence, conservation)
CREATE INDEX IF NOT EXISTS idx_mca_source_event
  ON public.market_cost_attributions (source_event_id);

-- Requêtes cockpit par market + période
CREATE INDEX IF NOT EXISTS idx_mca_market_period
  ON public.market_cost_attributions (market_id, recorded_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Garde append-only : interdit UPDATE et DELETE directe.
-- Les suppressions en cascade (purge d'un market ou d'un event source) restent
-- possibles via pg_trigger_depth > 1.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.market_cost_attributions_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'market_cost_attribution_immutable: UPDATE interdit — utiliser REVERSAL + nouvelle ATTRIBUTION'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'market_cost_attribution_immutable: DELETE interdit — journal append-only'
      USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_mca_guard_immutable ON public.market_cost_attributions;
CREATE TRIGGER trg_mca_guard_immutable
  BEFORE UPDATE OR DELETE ON public.market_cost_attributions
  FOR EACH ROW EXECUTE FUNCTION public.market_cost_attributions_guard_immutable();

-- ─────────────────────────────────────────────────────────────────────────────
-- Garde : un REVERSAL ne peut cibler qu'une ATTRIBUTION existante
-- (pas un autre REVERSAL, et la cible doit exister).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.market_cost_attributions_guard_reversal_target()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_target_kind text;
  v_target_source uuid;
BEGIN
  IF NEW.event_kind <> 'REVERSAL' OR NEW.reverses_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT event_kind, source_event_id INTO v_target_kind, v_target_source
  FROM public.market_cost_attributions
  WHERE id = NEW.reverses_id;

  IF v_target_kind IS NULL THEN
    RAISE EXCEPTION 'market_cost_attribution_reversal_target_missing: l''attribution cible % n''existe pas', NEW.reverses_id
      USING ERRCODE = '23503';
  END IF;

  IF v_target_kind <> 'ATTRIBUTION' THEN
    RAISE EXCEPTION 'market_cost_attribution_reversal_target_invalid: la cible % est un %, pas une ATTRIBUTION', NEW.reverses_id, v_target_kind
      USING ERRCODE = '23514';
  END IF;

  IF v_target_source IS DISTINCT FROM NEW.source_event_id THEN
    RAISE EXCEPTION 'market_cost_attribution_reversal_source_mismatch: le REVERSAL pointe source_event_id % mais l''ATTRIBUTION cible pointe %', NEW.source_event_id, v_target_source
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mca_guard_reversal_target ON public.market_cost_attributions;
CREATE TRIGGER trg_mca_guard_reversal_target
  BEFORE INSERT ON public.market_cost_attributions
  FOR EACH ROW EXECUTE FUNCTION public.market_cost_attributions_guard_reversal_target();
