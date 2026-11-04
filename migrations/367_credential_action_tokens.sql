-- V1 credential lifecycle: persisted hashes only; never store raw invitation/reset links.
CREATE TABLE IF NOT EXISTS credential_action_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('account_activation', 'password_reset')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_credential_action_tokens_user_purpose
 ON credential_action_tokens(user_id, purpose) WHERE consumed_at IS NULL;
