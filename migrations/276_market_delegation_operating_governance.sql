-- @migration 276_market_delegation_operating_governance.sql
-- @domain    market-delegation
-- @purpose   Market Control Plane M3 foundation: operating lead, central referent,
--            membership duration and per-capability financial limits.
--
-- Authority does not derive from these fields. is_operating_lead and
-- central_referent_user_id are designations only; runtime rights continue to
-- come from central(X,C) or delegated capabilities. Financial limits only
-- constrain capabilities explicitly declared amount_bearing=true.

ALTER TABLE market_operating_assignments
  ADD COLUMN IF NOT EXISTS central_referent_user_id UUID REFERENCES users(id);

ALTER TABLE assignment_memberships
  ADD COLUMN IF NOT EXISTS is_operating_lead BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS effective_until TIMESTAMPTZ;

ALTER TABLE assignment_capability_ceiling
  ADD COLUMN IF NOT EXISTS limit_amount NUMERIC(20,6);

ALTER TABLE membership_capabilities
  ADD COLUMN IF NOT EXISTS limit_amount NUMERIC(20,6);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_assignment_operating_lead
  ON assignment_memberships (assignment_id)
  WHERE status = 'ACTIVE' AND is_operating_lead = TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignment_membership_effective_until_check'
  ) THEN
    ALTER TABLE assignment_memberships
      ADD CONSTRAINT assignment_membership_effective_until_check
      CHECK (effective_until IS NULL OR effective_until > granted_at);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignment_ceiling_limit_nonnegative_check'
  ) THEN
    ALTER TABLE assignment_capability_ceiling
      ADD CONSTRAINT assignment_ceiling_limit_nonnegative_check
      CHECK (limit_amount IS NULL OR limit_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membership_capability_limit_nonnegative_check'
  ) THEN
    ALTER TABLE membership_capabilities
      ADD CONSTRAINT membership_capability_limit_nonnegative_check
      CHECK (limit_amount IS NULL OR limit_amount >= 0);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION enforce_assignment_ceiling_amount_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_amount_bearing BOOLEAN;
BEGIN
  IF NEW.limit_amount IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT amount_bearing
    INTO v_amount_bearing
    FROM capability_registry
   WHERE capability = NEW.capability;

  IF v_amount_bearing IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'capability % is not amount-bearing', NEW.capability;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assignment_ceiling_amount_limit ON assignment_capability_ceiling;
CREATE TRIGGER trg_assignment_ceiling_amount_limit
BEFORE INSERT OR UPDATE OF capability, limit_amount ON assignment_capability_ceiling
FOR EACH ROW EXECUTE FUNCTION enforce_assignment_ceiling_amount_limit();

CREATE OR REPLACE FUNCTION enforce_membership_capability_amount_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_assignment_id UUID;
  v_amount_bearing BOOLEAN;
  v_ceiling_limit NUMERIC(20,6);
BEGIN
  SELECT am.assignment_id
    INTO v_assignment_id
    FROM assignment_memberships am
   WHERE am.id = NEW.membership_id;

  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'membership % not found', NEW.membership_id;
  END IF;

  SELECT cr.amount_bearing, acc.limit_amount
    INTO v_amount_bearing, v_ceiling_limit
    FROM assignment_capability_ceiling acc
    JOIN capability_registry cr ON cr.capability = acc.capability
   WHERE acc.assignment_id = v_assignment_id
     AND acc.capability = NEW.capability
     AND acc.revoked_at IS NULL
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'capability % exceeds assignment ceiling', NEW.capability;
  END IF;

  IF v_amount_bearing IS DISTINCT FROM TRUE AND NEW.limit_amount IS NOT NULL THEN
    RAISE EXCEPTION 'capability % is not amount-bearing', NEW.capability;
  END IF;

  IF v_ceiling_limit IS NOT NULL THEN
    IF NEW.limit_amount IS NULL THEN
      RAISE EXCEPTION 'membership limit required when ceiling limit is finite for %', NEW.capability;
    END IF;
    IF NEW.limit_amount > v_ceiling_limit THEN
      RAISE EXCEPTION 'membership limit % exceeds ceiling limit % for %',
        NEW.limit_amount, v_ceiling_limit, NEW.capability;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_membership_capability_amount_limit ON membership_capabilities;
CREATE TRIGGER trg_membership_capability_amount_limit
BEFORE INSERT OR UPDATE OF capability, membership_id, limit_amount ON membership_capabilities
FOR EACH ROW EXECUTE FUNCTION enforce_membership_capability_amount_limit();

COMMENT ON COLUMN market_operating_assignments.central_referent_user_id IS
  'Central referent designation only. Grants no authority by itself.';
COMMENT ON COLUMN assignment_memberships.is_operating_lead IS
  'Operating lead designation only. Grants no capability by itself.';
COMMENT ON COLUMN assignment_memberships.effective_until IS
  'Optional membership expiry. Runtime enforcement is added by the owning service lot.';
COMMENT ON COLUMN assignment_capability_ceiling.limit_amount IS
  'Optional per-operation maximum for amount-bearing capability; NULL means unlimited ceiling.';
COMMENT ON COLUMN membership_capabilities.limit_amount IS
  'Optional member per-operation maximum. Must not exceed a finite assignment ceiling.';
