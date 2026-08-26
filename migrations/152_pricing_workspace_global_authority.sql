-- LOT 4F — Pricing Workspace Canonical
-- Global central authority + stable browser-facing competitor references.

CREATE SEQUENCE IF NOT EXISTS pricing_competitor_ref_seq START 1;

ALTER TABLE competitor_prices
  ADD COLUMN IF NOT EXISTS competitor_ref TEXT;

UPDATE competitor_prices
   SET competitor_ref = 'KPC-' || LPAD(nextval('pricing_competitor_ref_seq')::text, 6, '0')
 WHERE competitor_ref IS NULL;

ALTER TABLE competitor_prices
  ALTER COLUMN competitor_ref SET DEFAULT ('KPC-' || LPAD(nextval('pricing_competitor_ref_seq')::text, 6, '0')),
  ALTER COLUMN competitor_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_prices_competitor_ref
  ON competitor_prices(competitor_ref);

CREATE TABLE IF NOT EXISTS pricing_global_access_grants (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NULL,
  revoked_at TIMESTAMPTZ NULL
);

-- Continuity bootstrap: pricing writes were historically admin-only.
INSERT INTO pricing_global_access_grants (user_id, reason)
SELECT id, 'bootstrap_from_admin_role'
  FROM users
 WHERE role = 'admin'
ON CONFLICT (user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_pricing_global_access_active
  ON pricing_global_access_grants(user_id)
  WHERE revoked_at IS NULL;
