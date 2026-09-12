-- @migration 196_market_delegation_team.sql
-- @domain    market-delegation
-- @purpose   Persistent, expiring team invitations and activation of LOT 1A delegation capabilities.

CREATE TABLE IF NOT EXISTS market_team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES market_operating_assignments(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL CHECK (
    email_normalized = lower(btrim(email_normalized))
    AND position('@' IN email_normalized) > 1
  ),
  token_hash TEXT NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  requested_capabilities JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(requested_capabilities) = 'array'
  ),
  invited_by_membership_id UUID NOT NULL REFERENCES assignment_memberships(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
    status IN ('PENDING','ACCEPTED','REVOKED','EXPIRED')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES users(id),
  revoked_at TIMESTAMPTZ,
  revoked_by_membership_id UUID REFERENCES assignment_memberships(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_team_invitation_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT market_team_invitation_state_check CHECK (
    (status = 'PENDING' AND accepted_at IS NULL AND revoked_at IS NULL)
    OR (status = 'ACCEPTED' AND accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL AND accepted_at IS NULL)
    OR (status = 'EXPIRED' AND accepted_at IS NULL AND revoked_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_market_team_invitation
  ON market_team_invitations (assignment_id, email_normalized)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_market_team_invitations_assignment
  ON market_team_invitations (assignment_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_team_invitations_expiry
  ON market_team_invitations (expires_at)
  WHERE status = 'PENDING';

UPDATE capability_registry
   SET status = 'LIVE', updated_at = NOW()
 WHERE capability IN ('team.read','team.grant','team.revoke','team.invite');

COMMENT ON TABLE market_team_invitations IS
  'Expiring invitation intent for Market Operating Assignment membership. Raw tokens are never persisted; requested capabilities are revalidated at acceptance.';
