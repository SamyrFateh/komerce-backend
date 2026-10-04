-- @migration 274_market_delegation_audit_market.sql
-- @domain    market-delegation
-- @purpose   M2 Market Control Plane — rattacher chaque audit de délégation au Market ID,
--            y compris avant l'existence d'un Market Operating Assignment.

ALTER TABLE market_delegation_audit
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id) ON DELETE RESTRICT;

UPDATE market_delegation_audit audit
   SET market_id = assignment.market_id
  FROM market_operating_assignments assignment
 WHERE audit.assignment_id = assignment.id
   AND audit.market_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_market_delegation_audit_market
  ON market_delegation_audit (market_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION enforce_market_delegation_audit_market()
RETURNS TRIGGER AS $$
DECLARE
  v_assignment_market UUID;
  v_membership_assignment UUID;
  v_membership_market UUID;
BEGIN
  IF NEW.assignment_id IS NOT NULL THEN
    SELECT market_id
      INTO v_assignment_market
      FROM market_operating_assignments
     WHERE id = NEW.assignment_id;

    IF v_assignment_market IS NULL THEN
      RAISE EXCEPTION 'market delegation audit assignment % not found', NEW.assignment_id;
    END IF;

    IF NEW.market_id IS NULL THEN
      NEW.market_id := v_assignment_market;
    ELSIF NEW.market_id IS DISTINCT FROM v_assignment_market THEN
      RAISE EXCEPTION 'market delegation audit market % conflicts with assignment market %',
        NEW.market_id, v_assignment_market;
    END IF;
  END IF;

  IF NEW.membership_id IS NOT NULL THEN
    SELECT am.assignment_id, assignment.market_id
      INTO v_membership_assignment, v_membership_market
      FROM assignment_memberships am
      JOIN market_operating_assignments assignment ON assignment.id = am.assignment_id
     WHERE am.id = NEW.membership_id;

    IF v_membership_assignment IS NULL THEN
      RAISE EXCEPTION 'market delegation audit membership % not found', NEW.membership_id;
    END IF;

    IF NEW.assignment_id IS NOT NULL
       AND NEW.assignment_id IS DISTINCT FROM v_membership_assignment THEN
      RAISE EXCEPTION 'market delegation audit membership assignment % conflicts with assignment %',
        v_membership_assignment, NEW.assignment_id;
    END IF;

    IF NEW.market_id IS NULL THEN
      NEW.market_id := v_membership_market;
    ELSIF NEW.market_id IS DISTINCT FROM v_membership_market THEN
      RAISE EXCEPTION 'market delegation audit market % conflicts with membership market %',
        NEW.market_id, v_membership_market;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_market_delegation_audit_market_guard ON market_delegation_audit;
CREATE TRIGGER trg_market_delegation_audit_market_guard
BEFORE INSERT OR UPDATE OF market_id, assignment_id, membership_id
ON market_delegation_audit
FOR EACH ROW EXECUTE FUNCTION enforce_market_delegation_audit_market();

COMMENT ON COLUMN market_delegation_audit.market_id IS
  'Market ID audité directement. Permet de tracer le provisioning avant création complète de l assignment ; cohérent avec assignment/membership quand présents.';
