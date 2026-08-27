-- LOT 4G — Action Center Canonical
-- Stable browser-facing signal references + explicit global authority.

CREATE SEQUENCE IF NOT EXISTS decision_signal_ref_seq START 1;

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS signal_ref TEXT;

UPDATE signals
   SET signal_ref = 'KSG-' || LPAD(nextval('decision_signal_ref_seq')::text, 6, '0')
 WHERE signal_ref IS NULL;

ALTER TABLE signals
  ALTER COLUMN signal_ref SET DEFAULT ('KSG-' || LPAD(nextval('decision_signal_ref_seq')::text, 6, '0')),
  ALTER COLUMN signal_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_signal_ref
  ON signals(signal_ref);

CREATE TABLE IF NOT EXISTS decision_signal_global_access_grants (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NULL,
  revoked_at TIMESTAMPTZ NULL
);

-- Continuity bootstrap: the historical Action Center and Signals API were
-- admin-only. Future admin accounts do NOT receive this authority implicitly.
INSERT INTO decision_signal_global_access_grants (user_id, reason)
SELECT id, 'bootstrap_from_admin_role'
  FROM users
 WHERE role = 'admin'
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_decision_signal_global_access_active
  ON decision_signal_global_access_grants(user_id)
  WHERE revoked_at IS NULL;
