-- LOT 4G — Action Center Canonical
-- Stable browser-facing signal references + explicit global authority.
-- A signal is one derived fact across its whole active lifecycle.

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

-- Historical snooze/ack behaviour could leave more than one active row for the
-- same derived fact because the former unique index only protected status=open.
-- Preserve the strongest operator intent (snoozed > acknowledged > open), then
-- resolve every older duplicate before installing the lifecycle-wide invariant.
WITH ranked_active AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY signal_type, entity_type, entity_id
           ORDER BY
             CASE status
               WHEN 'snoozed' THEN 1
               WHEN 'acknowledged' THEN 2
               ELSE 3
             END,
             updated_at DESC NULLS LAST,
             created_at DESC,
             id
         ) AS rn
    FROM signals
   WHERE status IN ('open','acknowledged','snoozed')
)
UPDATE signals s
   SET status = 'resolved',
       resolved_at = COALESCE(s.resolved_at, NOW()),
       snoozed_until = NULL,
       updated_at = NOW()
  FROM ranked_active r
 WHERE s.id = r.id
   AND r.rn > 1;

-- Database-level protection against regeneration races. NULL entity dimensions
-- represent one global fact, so NULLS NOT DISTINCT is intentional.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_active_fact_unique
  ON signals(signal_type, entity_type, entity_id) NULLS NOT DISTINCT
  WHERE status IN ('open','acknowledged','snoozed');

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
