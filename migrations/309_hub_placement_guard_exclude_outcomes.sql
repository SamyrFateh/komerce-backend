-- 309_hub_placement_guard_exclude_outcomes.sql
-- Lot 6 (stabilisation multi-pays, résiduel C2) — le garde anti-doublon des placements (migration 233) comptait
-- la matière d'une unité perdue / volée / détruite / inutilisable (outcome_type terminal) comme encore placée :
-- le remplacement d'une unité perdue était refusé (hub_allocation_overplaced) ou mis en quarantaine.
-- La couverture physique (v_purchase_line_progress, migration 306) n'a jamais compté ces unités comme reçues ;
-- ce garde s'aligne sur la même définition. Corps identique à 233 hormis la jointure sur l'unité.
-- Aucune donnée réécrite. Rollback : rejouer la définition de hub_guard_placement_insert de la migration 233.

CREATE OR REPLACE FUNCTION hub_guard_placement_insert()
RETURNS trigger AS $$
DECLARE
  allocation_qty integer;
  already_placed integer;
  unit_state text;
BEGIN
  SELECT state INTO unit_state
    FROM hub_physical_units
   WHERE id = NEW.physical_unit_id
   FOR UPDATE;

  IF unit_state IS NULL THEN
    RAISE EXCEPTION 'hub_physical_unit_unresolvable';
  END IF;
  IF unit_state IN ('PACKED', 'DISPATCHED', 'QUARANTINED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'hub_physical_unit_content_frozen';
  END IF;

  SELECT quantity INTO allocation_qty
    FROM hub_purchase_allocations
   WHERE id = NEW.allocation_id
   FOR UPDATE;

  IF allocation_qty IS NULL THEN
    RAISE EXCEPTION 'hub_purchase_allocation_unresolvable';
  END IF;

  SELECT COALESCE(SUM(p.quantity), 0)::integer INTO already_placed
    FROM hub_physical_unit_placements p
    JOIN hub_physical_units u ON u.id = p.physical_unit_id
   WHERE p.allocation_id = NEW.allocation_id
     AND p.removed_at IS NULL
     AND u.outcome_type IS NULL;

  IF already_placed + NEW.quantity > allocation_qty THEN
    RAISE EXCEPTION 'hub_allocation_overplaced';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
