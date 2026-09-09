-- @migration 194_market_delegation_assignments.sql
-- @domain    market-delegation
-- @purpose   Market Operating Assignment, ceiling, memberships and delegation audit.

CREATE TABLE IF NOT EXISTS market_operating_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED','ENDED')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ,
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_operating_assignment_period_check CHECK (
    effective_until IS NULL OR effective_until > effective_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_market_assignment
  ON market_operating_assignments (market_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_market_operating_assignments_market
  ON market_operating_assignments (market_id, status, effective_from DESC);

CREATE TABLE IF NOT EXISTS assignment_capability_ceiling (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES market_operating_assignments(id) ON DELETE CASCADE,
  capability TEXT NOT NULL REFERENCES capability_registry(capability),
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_assignment_ceiling_capability
  ON assignment_capability_ceiling (assignment_id, capability)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS assignment_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES market_operating_assignments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),
  CONSTRAINT assignment_membership_revocation_state_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_assignment_membership
  ON assignment_memberships (assignment_id, user_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_assignment_memberships_user
  ON assignment_memberships (user_id, status);

CREATE TABLE IF NOT EXISTS membership_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES assignment_memberships(id) ON DELETE CASCADE,
  capability TEXT NOT NULL REFERENCES capability_registry(capability),
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_membership_capability
  ON membership_capabilities (membership_id, capability)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS ceiling_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_current_ceiling_template
  ON ceiling_templates ((1)) WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS ceiling_template_capabilities (
  template_id UUID NOT NULL REFERENCES ceiling_templates(id) ON DELETE CASCADE,
  capability TEXT NOT NULL REFERENCES capability_registry(capability),
  PRIMARY KEY (template_id, capability)
);

CREATE TABLE IF NOT EXISTS market_delegation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  assignment_id UUID REFERENCES market_operating_assignments(id) ON DELETE SET NULL,
  membership_id UUID REFERENCES assignment_memberships(id) ON DELETE SET NULL,
  capability TEXT REFERENCES capability_registry(capability),
  action TEXT NOT NULL CHECK (char_length(btrim(action)) > 0),
  payload_before JSONB,
  payload_after JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_market_delegation_audit_assignment
  ON market_delegation_audit (assignment_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION enforce_assignment_ceiling_capability()
RETURNS TRIGGER AS $$
DECLARE
  v_scope TEXT;
  v_mode TEXT;
BEGIN
  SELECT authority_scope, delegation_mode
    INTO v_scope, v_mode
    FROM capability_registry
   WHERE capability = NEW.capability;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'unknown capability: %', NEW.capability;
  END IF;
  IF v_scope <> 'MARKET' OR v_mode <> 'DELEGABLE' THEN
    RAISE EXCEPTION 'capability % cannot enter a market assignment ceiling', NEW.capability;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assignment_ceiling_capability_guard ON assignment_capability_ceiling;
CREATE TRIGGER trg_assignment_ceiling_capability_guard
BEFORE INSERT OR UPDATE OF capability ON assignment_capability_ceiling
FOR EACH ROW EXECUTE FUNCTION enforce_assignment_ceiling_capability();

CREATE OR REPLACE FUNCTION enforce_membership_capability_within_ceiling()
RETURNS TRIGGER AS $$
DECLARE
  v_assignment UUID;
BEGIN
  SELECT assignment_id INTO v_assignment
    FROM assignment_memberships
   WHERE id = NEW.membership_id;
  IF v_assignment IS NULL THEN
    RAISE EXCEPTION 'membership % not found', NEW.membership_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM assignment_capability_ceiling acc
     WHERE acc.assignment_id = v_assignment
       AND acc.capability = NEW.capability
       AND acc.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'capability % exceeds assignment ceiling', NEW.capability;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_membership_capability_ceiling_guard ON membership_capabilities;
CREATE TRIGGER trg_membership_capability_ceiling_guard
BEFORE INSERT OR UPDATE OF capability, membership_id ON membership_capabilities
FOR EACH ROW EXECUTE FUNCTION enforce_membership_capability_within_ceiling();

WITH template_row AS (
  INSERT INTO ceiling_templates (name, version, is_current)
  VALUES ('market-operator-default', 1, TRUE)
  ON CONFLICT (name, version) DO UPDATE SET is_current = EXCLUDED.is_current
  RETURNING id
)
INSERT INTO ceiling_template_capabilities (template_id, capability)
SELECT template_row.id, registry.capability
  FROM template_row
  CROSS JOIN capability_registry registry
 WHERE registry.class = 'DELEGATION'
   AND registry.authority_scope = 'MARKET'
   AND registry.delegation_mode = 'DELEGABLE'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE market_operating_assignments IS
  'Sole active economic operating mandate for a Market ID; at most one ACTIVE row per market.';
COMMENT ON TABLE assignment_capability_ceiling IS
  'Maximum MARKET/DELEGABLE authority granted by central to one operating assignment.';
COMMENT ON TABLE assignment_memberships IS
  'Users acting under one Market Operating Assignment; capabilities are granted separately.';
COMMENT ON TABLE market_delegation_audit IS
  'Append-only audit trail for market delegation mutations; distinct from economic facts.';
