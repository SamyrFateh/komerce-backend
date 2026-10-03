-- @migration 268_market_cost_attributions_conservation_guard.sql
-- @domain    economic-engine
-- @purpose   Garde de conservation en base sur market_cost_attributions :
--            à la fin de toute transaction, les attributions ACTIVES d'un
--            fait GROUP valent soit 0 (rien d'attribué), soit exactement le
--            montant du fait. Protège contre tout écrivain parallèle
--            (INSERT manuel, script, futur service) en plus du service.
--
-- Doctrine :
--   - Contrainte DIFFÉRÉE (DEFERRABLE INITIALLY DEFERRED) : une correction écrit
--     REVERSAL puis nouvelle ATTRIBUTION dans une même transaction ; l'état
--     intermédiaire n'est jamais validé, seul l'état au COMMIT l'est.
--   - Une attribution active = ATTRIBUTION qu'aucun REVERSAL ne cible (même
--     définition que market-cost-attribution-service et pricing-period-structure).
--   - Seuls les faits GROUP de type ACCRUAL sont attribuables.
--   - Aucune donnée n'est modifiée ; la table reste append-only.
--   - economic_structure_cost_events est append-only : le montant d'un fait ne
--     change jamais, donc contrôler à l'insertion d'une ligne d'attribution
--     suffit.

CREATE OR REPLACE FUNCTION public.market_cost_attributions_check_conservation()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_event_amount numeric(18,2);
  v_scope        text;
  v_kind         text;
  v_active       numeric(18,2);
BEGIN
  SELECT e.amount_kmf, e.scope_kind, e.event_kind
    INTO v_event_amount, v_scope, v_kind
    FROM public.economic_structure_cost_events e
   WHERE e.id = NEW.source_event_id;

  IF NEW.event_kind = 'ATTRIBUTION' AND (v_scope IS DISTINCT FROM 'GROUP' OR v_kind IS DISTINCT FROM 'ACCRUAL') THEN
    RAISE EXCEPTION 'market_cost_attribution_event_not_attributable: le fait % est % / %, seul un fait GROUP ACCRUAL est attribuable',
      NEW.source_event_id, v_scope, v_kind
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(a.amount_kmf), 0)
    INTO v_active
    FROM public.market_cost_attributions a
   WHERE a.source_event_id = NEW.source_event_id
     AND a.event_kind = 'ATTRIBUTION'
     AND NOT EXISTS (
       SELECT 1 FROM public.market_cost_attributions r WHERE r.reverses_id = a.id
     );

  IF v_active <> 0 AND v_active IS DISTINCT FROM v_event_amount THEN
    RAISE EXCEPTION 'market_cost_attribution_not_conserved: attributions actives % <> montant du fait % (source_event_id %)',
      v_active, v_event_amount, NEW.source_event_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_mca_conservation ON public.market_cost_attributions;
CREATE CONSTRAINT TRIGGER trg_mca_conservation
  AFTER INSERT ON public.market_cost_attributions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.market_cost_attributions_check_conservation();
