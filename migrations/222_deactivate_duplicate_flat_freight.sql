-- @migration 222_deactivate_duplicate_flat_freight.sql
-- @domain    economic-engine
-- @purpose   Neutralise le composant historique fret_maritime_eur_m3 créé avec
--            unit='eur' alors que sa sémantique est EUR/m3. pricing-cdr calcule
--            déjà le fret volumique via finance_config.fret_eur_per_m3 ; laisser
--            ce composant actif ajoute ~180 EUR par article et double-compte le fret.
-- @doctrine  variable_cost_truth, no_silent_double_count, fixed_structure_never_fabricates_sku_price

BEGIN;

DO $$
DECLARE
  v_unit text;
  v_category text;
  v_active boolean;
  v_finance_rate numeric;
BEGIN
  SELECT unit, category, is_active
    INTO v_unit, v_category, v_active
    FROM cost_components
   WHERE key = 'fret_maritime_eur_m3'
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'cost_components.fret_maritime_eur_m3 absent — rien à neutraliser';
    RETURN;
  END IF;

  IF v_category <> 'freight' THEN
    RAISE EXCEPTION 'REFUS 222: fret_maritime_eur_m3 category inattendue: %', v_category;
  END IF;

  SELECT fret_eur_per_m3
    INTO v_finance_rate
    FROM finance_config
   WHERE id = 1;

  IF COALESCE(v_finance_rate, 0) <= 0 THEN
    RAISE EXCEPTION 'REFUS 222: finance_config.fret_eur_per_m3 absent ou nul';
  END IF;

  -- Le bug observé est précisément unit=eur sur un tarif décrit/alloué au volume.
  -- Si la ligne a déjà été migrée vers une vraie unité volumique, ne pas la désactiver.
  IF v_unit = 'eur' AND v_active THEN
    UPDATE cost_components
       SET is_active = FALSE,
           notes = concat_ws(E'\n', NULLIF(notes, ''),
             '2026-09: désactivé — doublon du fret volumique finance_config.fret_eur_per_m3; unit=eur appliquait 180 EUR/article.'),
           updated_at = NOW()
     WHERE key = 'fret_maritime_eur_m3';

    INSERT INTO cost_component_events (
      component_id, component_key, event_type, old_value, new_value, notes
    )
    SELECT id,
           key,
           'deactivated',
           jsonb_build_object('is_active', TRUE, 'unit', v_unit),
           jsonb_build_object('is_active', FALSE, 'canonical_source', 'finance_config.fret_eur_per_m3'),
           'Migration 222 — suppression du double comptage fret et de l’erreur d’unité EUR/article.'
      FROM cost_components
     WHERE key = 'fret_maritime_eur_m3';
  END IF;
END $$;

COMMIT;
