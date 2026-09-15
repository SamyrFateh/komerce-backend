-- @migration 234_hub_outbound_destination_and_quarantine_release.sql
-- @domain    logistics
-- @purpose   HUB-001 hardening — un outbound physique doit être homogène non
--            seulement sur Market mais aussi sur destination commerciale ;
--            QUARANTINED est réversible uniquement après fermeture du dossier
--            Incident Management et uniquement vers l'état pré-quarantaine.
--
-- Doctrine :
--   Hub may SPLIT / MERGE / REPACK; Hub may NEVER REASSIGN.
--   Une quarantaine sans owner/SLA/résolution est interdite.

CREATE OR REPLACE FUNCTION hub_guard_physical_unit_update()
RETURNS trigger AS $$
DECLARE
  active_count integer;
  market_count integer;
  destination_count integer;
  resolved_market_id uuid;
  resolved_destination_ref text;
  transition_ok boolean;
  resume_state text;
BEGIN
  IF OLD.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM OLD.market_id THEN
    RAISE EXCEPTION 'hub_physical_unit_market_immutable';
  END IF;

  IF OLD.outcome_type IS NOT NULL AND NEW.outcome_type IS DISTINCT FROM OLD.outcome_type THEN
    RAISE EXCEPTION 'hub_physical_outcome_immutable';
  END IF;

  IF NEW.market_id IS DISTINCT FROM OLD.market_id
     AND NEW.state NOT IN ('PACKED', 'DISPATCHED') THEN
    RAISE EXCEPTION 'hub_market_only_derived_at_outbound';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'QUARANTINED' THEN
      IF OLD.outcome_type IS NOT NULL THEN
        RAISE EXCEPTION 'hub_destructive_outcome_quarantine_terminal';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM incidents i
         WHERE i.status IN ('open', 'investigating')
           AND i.details->>'physical_unit_id' = OLD.id::text
      ) THEN
        RAISE EXCEPTION 'hub_quarantine_incident_active';
      END IF;

      SELECT COALESCE(NULLIF(e.from_state, 'QUARANTINED'), 'RECEIVED')
        INTO resume_state
        FROM hub_custody_events e
       WHERE e.physical_unit_id = OLD.id
         AND e.event_type = 'QUARANTINE'
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT 1;

      resume_state := COALESCE(resume_state, 'RECEIVED');
      transition_ok := NEW.state = resume_state;
    ELSE
      transition_ok := CASE OLD.state
        WHEN 'RECEIVED'        THEN NEW.state IN ('IDENTIFIED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'IDENTIFIED'      THEN NEW.state IN ('QUALITY_CHECKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'QUALITY_CHECKED' THEN NEW.state IN ('LOCATED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'LOCATED'         THEN NEW.state IN ('ALLOCATED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'ALLOCATED'       THEN NEW.state IN ('PICKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'PICKED'          THEN NEW.state IN ('PACKED', 'QUARANTINED', 'SUPERSEDED')
        WHEN 'PACKED'          THEN NEW.state IN ('DISPATCHED', 'QUARANTINED')
        WHEN 'DISPATCHED'      THEN NEW.state = 'QUARANTINED'
        ELSE false
      END;
    END IF;

    IF NOT transition_ok THEN
      RAISE EXCEPTION 'hub_physical_state_transition_invalid:%->%', OLD.state, NEW.state;
    END IF;
  END IF;

  IF NEW.state IN ('PACKED', 'DISPATCHED') THEN
    SELECT COUNT(*)::integer,
           COUNT(DISTINCT a.market_id)::integer,
           COUNT(DISTINCT a.destination_ref)::integer,
           MIN(a.market_id::text)::uuid,
           MIN(a.destination_ref)
      INTO active_count, market_count, destination_count, resolved_market_id, resolved_destination_ref
      FROM hub_physical_unit_placements p
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id
     WHERE p.physical_unit_id = NEW.id
       AND p.removed_at IS NULL;

    IF active_count = 0 THEN
      RAISE EXCEPTION 'hub_outbound_unit_empty';
    END IF;
    IF market_count <> 1 THEN
      RAISE EXCEPTION 'hub_outbound_market_not_homogeneous';
    END IF;
    IF destination_count <> 1 OR resolved_destination_ref IS NULL THEN
      RAISE EXCEPTION 'hub_outbound_destination_not_homogeneous';
    END IF;
    IF NEW.market_id IS NOT NULL AND NEW.market_id IS DISTINCT FROM resolved_market_id THEN
      RAISE EXCEPTION 'hub_outbound_market_snapshot_mismatch';
    END IF;

    NEW.market_id := resolved_market_id;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Un SQL direct ne doit jamais pouvoir laisser une quarantaine physique sans
-- dossier opérationnel. Le contrôle est différé à COMMIT pour permettre au
-- service HUB-001 de créer l'unité puis l'incident dans la même transaction.
-- Les outcomes destructifs sont une autre classe : ils sont possédés par le
-- fait physique + outbox F0 et restent terminaux sans incident de réparation.
CREATE OR REPLACE FUNCTION hub_require_quarantine_incident()
RETURNS trigger AS $$
BEGIN
  IF NEW.state = 'QUARANTINED' AND NEW.outcome_type IS NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM incidents i
       WHERE i.status IN ('open', 'investigating')
         AND i.details->>'physical_unit_id' = NEW.id::text
    ) THEN
      RAISE EXCEPTION 'hub_quarantine_incident_required';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hub_quarantine_incident_required ON hub_physical_units;
CREATE CONSTRAINT TRIGGER trg_hub_quarantine_incident_required
  AFTER INSERT OR UPDATE OF state, outcome_type ON hub_physical_units
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION hub_require_quarantine_incident();

COMMENT ON FUNCTION hub_guard_physical_unit_update() IS
  'HUB-001 hardening — outbound mono-Market + mono-destination ; sortie de QUARANTINED seulement après incident résolu et vers état pré-quarantaine.';
COMMENT ON FUNCTION hub_require_quarantine_incident() IS
  'HUB-001 — toute quarantaine non destructive doit avoir un incident actif au COMMIT ; empêche les quarantaines orphelines même par SQL direct.';
