-- @migration 195_operator_market_scopes_projection_marker.sql
-- @domain    market-delegation,market
-- @purpose   Mark operator_market_scopes rows derived from assignment memberships.

ALTER TABLE operator_market_scopes
  ADD COLUMN IF NOT EXISTS projected_from_membership_id UUID
  REFERENCES assignment_memberships(id);

CREATE INDEX IF NOT EXISTS idx_operator_market_scopes_projected_membership
  ON operator_market_scopes (projected_from_membership_id)
  WHERE projected_from_membership_id IS NOT NULL;

COMMENT ON COLUMN operator_market_scopes.projected_from_membership_id IS
  'Non-null when this authorization read-model row is deterministically projected from market-delegation assignment membership.';
