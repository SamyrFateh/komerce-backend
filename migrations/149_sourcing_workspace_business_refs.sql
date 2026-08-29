-- LOT 4E — Sourcing Workspace Canonical
-- Feature owner: sourcing.
-- Candidate business reference + explicit persisted global authority only.

-- La route Canonical admet explicitement le rôle `sourcing`, mais la DB live
-- historique ne possédait encore que client/admin/agent_* dans user_role.
-- Le runner exécute chaque fichier dans une transaction : une valeur enum
-- ajoutée ici ne doit pas être utilisée comme valeur enum typée avant COMMIT.
-- Le bootstrap plus bas compare donc role::text, ce qui reste sûr dans cette
-- même transaction et prépare les futurs comptes sourcing sans casser la prod.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'sourcing';

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
-- role::text évite l'utilisation typée de la nouvelle valeur enum avant le
-- COMMIT de cette migration (contrainte PostgreSQL sur ALTER TYPE ADD VALUE).
INSERT INTO sourcing_global_access_grants (user_id, reason)
SELECT id, 'bootstrap_from_sourcing_role'
  FROM users
 WHERE role::text = 'sourcing'
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_sourcing_global_access_active
  ON sourcing_global_access_grants(user_id)
  WHERE revoked_at IS NULL;
