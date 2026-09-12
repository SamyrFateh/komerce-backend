-- @migration 198_market_cash_control_policy.sql
-- @domain    market-delegation
-- @purpose   Politique de contrôle cash pilotée par le partenaire pays, sous invariants Komerce.

CREATE TABLE IF NOT EXISTS market_cash_control_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL UNIQUE REFERENCES market_operating_assignments(id) ON DELETE RESTRICT,
  market_id UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  cash_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  confirmation_mode TEXT NOT NULL DEFAULT 'SINGLE'
    CHECK (confirmation_mode IN ('SINGLE','DUAL_ALWAYS')),
  updated_by_membership_id UUID REFERENCES assignment_memberships(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_cash_control_policies_market
  ON market_cash_control_policies (market_id, updated_at DESC);

CREATE OR REPLACE FUNCTION enforce_cash_policy_assignment_market()
RETURNS TRIGGER AS $$
DECLARE
  v_market_id UUID;
BEGIN
  SELECT market_id INTO v_market_id
    FROM market_operating_assignments
   WHERE id = NEW.assignment_id;

  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'cash policy assignment % not found', NEW.assignment_id;
  END IF;
  IF v_market_id IS DISTINCT FROM NEW.market_id THEN
    RAISE EXCEPTION 'cash policy market % does not match assignment market %', NEW.market_id, v_market_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cash_policy_assignment_market ON market_cash_control_policies;
CREATE TRIGGER trg_cash_policy_assignment_market
BEFORE INSERT OR UPDATE OF assignment_id, market_id ON market_cash_control_policies
FOR EACH ROW EXECUTE FUNCTION enforce_cash_policy_assignment_market();

-- La capability était déjà dans le registre P0 et dans le ceiling template v1,
-- mais restait MISSING tant qu'aucune API réelle ne l'exerçait.
UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability = 'cash_control.policy.manage';

-- Ceinture de compatibilité : un assignment ancien doit bien contenir la capability
-- avant qu'on la donne à son responsable. On n'ajoute rien hors MARKET/DELEGABLE.
INSERT INTO assignment_capability_ceiling (assignment_id, capability, granted_by)
SELECT a.id, 'cash_control.policy.manage', a.granted_by
  FROM market_operating_assignments a
 WHERE a.status = 'ACTIVE'
   AND NOT EXISTS (
     SELECT 1
       FROM assignment_capability_ceiling acc
      WHERE acc.assignment_id = a.id
        AND acc.capability = 'cash_control.policy.manage'
        AND acc.revoked_at IS NULL
   );

-- Quand une capability DELEGATION passe LIVE, ne pas rétrograder silencieusement
-- les responsables existants : on l'accorde aux memberships qui portaient déjà
-- le triplet de responsabilité équipe + finance avant ce cutover.
INSERT INTO membership_capabilities (membership_id, capability, granted_by)
SELECT am.id, 'cash_control.policy.manage', am.user_id
  FROM assignment_memberships am
 WHERE am.status = 'ACTIVE'
   AND EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = am.id AND mc.capability = 'team.grant' AND mc.revoked_at IS NULL
   )
   AND EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = am.id AND mc.capability = 'team.revoke' AND mc.revoked_at IS NULL
   )
   AND EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = am.id AND mc.capability = 'finance.read' AND mc.revoked_at IS NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM membership_capabilities mc
      WHERE mc.membership_id = am.id
        AND mc.capability = 'cash_control.policy.manage'
        AND mc.revoked_at IS NULL
   );

COMMENT ON TABLE market_cash_control_policies IS
  'Partner-owned Market cash policy. Komerce enforces the non-bypassable safety floor; partner may require dual confirmation.';
