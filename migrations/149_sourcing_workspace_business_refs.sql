-- LOT 4E — Sourcing Workspace Canonical
-- Global central authority + stable browser-facing business references.

CREATE SEQUENCE IF NOT EXISTS sourcing_candidate_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sourcing_import_ref_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sourcing_partner_ref_seq START 1;

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

ALTER TABLE supplier_catalog_imports
  ADD COLUMN IF NOT EXISTS import_ref TEXT;

UPDATE supplier_catalog_imports
   SET import_ref = 'KSI-' || LPAD(nextval('sourcing_import_ref_seq')::text, 6, '0')
 WHERE import_ref IS NULL;

ALTER TABLE supplier_catalog_imports
  ALTER COLUMN import_ref SET DEFAULT ('KSI-' || LPAD(nextval('sourcing_import_ref_seq')::text, 6, '0')),
  ALTER COLUMN import_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_catalog_imports_import_ref
  ON supplier_catalog_imports(import_ref);

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS partner_ref TEXT;

UPDATE partners
   SET partner_ref = 'KPT-' || LPAD(nextval('sourcing_partner_ref_seq')::text, 6, '0')
 WHERE partner_ref IS NULL;

ALTER TABLE partners
  ALTER COLUMN partner_ref SET DEFAULT ('KPT-' || LPAD(nextval('sourcing_partner_ref_seq')::text, 6, '0')),
  ALTER COLUMN partner_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_partner_ref
  ON partners(partner_ref);

CREATE TABLE IF NOT EXISTS sourcing_global_access_grants (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NULL,
  revoked_at TIMESTAMPTZ NULL
);

-- Continuity bootstrap: central catalogue authorities can initially source.
INSERT INTO sourcing_global_access_grants (user_id, reason)
SELECT user_id, 'bootstrap_from_catalog_global_authority'
  FROM catalog_global_access_grants
 WHERE revoked_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- Preserve the dedicated sourcing operator role as an explicit persisted grant.
INSERT INTO sourcing_global_access_grants (user_id, reason)
SELECT id, 'bootstrap_from_sourcing_role'
  FROM users
 WHERE role = 'sourcing'
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_sourcing_global_access_active
  ON sourcing_global_access_grants(user_id)
  WHERE revoked_at IS NULL;
