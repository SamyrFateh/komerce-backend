-- 073_pickup_verify_attempts.sql
-- Persist rate-limit attempts for public pickup-code verification.
-- S17 — avoids in-memory reset after redeploy.

CREATE TABLE IF NOT EXISTS pickup_verify_attempts (
  attempt_key TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pickup_verify_attempts_reset_at
  ON pickup_verify_attempts(reset_at);

DO $$
BEGIN
  RAISE NOTICE 'Migration 073 OK : pickup_verify_attempts';
END $$;
