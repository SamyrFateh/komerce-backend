-- @migration 368_internal_account_activation.sql
-- @domain auth-identity
-- @purpose New internal identities cannot authenticate until invitation consumption.
-- Existing users preserve their prior behavior.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_activation_required BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_pending_activation
  ON users(id) WHERE account_activation_required = TRUE;

-- Any password change invalidates all sessions issued before that instant.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS credentials_changed_at TIMESTAMPTZ;
