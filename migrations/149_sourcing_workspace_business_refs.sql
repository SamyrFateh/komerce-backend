-- LOT 4E — Sourcing Workspace Canonical
-- Feature owner: sourcing.
-- Candidate business reference + explicit persisted global authority only.

CREATE SEQUENCE IF NOT EXISTS sourcing_candidate_ref_seq START 1;

ALTER TABLE sourcing_candidates
  ADD COLUMN IF NOT EXISTS candidate_ref TEXT;

UPDATE sourcing_candidates
   SET candidate_ref = 'KSC-' || LPAD(nextval('sourcing_candidate_ref_seq')::text, 6, '0')
 WHERE candidate_ref IS NULL;

ALTER TABLE sourcing_candidates
  ALTER COLUMN candidate_ref SET DEFAULT ('KSC-' || LPAD(nextval('sourcing_candidate_ref_seq')::text, 6, '0')),
  ALTER COLUMN candidate_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sourcing_candidates_candidate_ref
  ON sourcing_candidates(candidate_ref);

CREATE TABLE IF NOT EXISTS sourcing_global_access_grants (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NULL,
  revoked_at TIMESTAMPTZ NULL
);

-- Continuité initiale : l'autorité catalogue centrale existante sait sourcer.
INSERT INTO sourcing_global_access_grants (user_id, reason)
SELECT user_id, 'bootstrap_from_catalog_global_authority'
  FROM catalog_global_access_grants
 WHERE revoked_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- Le rôle dédié sourcing devient également un grant explicite persisté.
INSERT INTO sourcing_global_access_grants (user_id, reason)
SELECT id, 'bootstrap_from_sourcing_role'
  FROM users
 WHERE role = 'sourcing'
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_sourcing_global_access_active
  ON sourcing_global_access_grants(user_id)
  WHERE revoked_at IS NULL;
