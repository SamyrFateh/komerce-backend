-- @migration 147_catalog_global_access_grants.sql
-- @domain    catalog
-- @purpose   LOT 4C — rendre l'autorité d'écriture du catalogue global
--            explicite, persistée et révocable. Le rôle admin ne suffit pas :
--            un admin partenaire marché ne doit jamais pouvoir modifier le
--            catalogue commun, sa taxonomie ou publier un candidat.
--
-- Bootstrap : les utilisateurs possédant déjà un grant dashboard global actif
-- reçoivent une autorité catalogue explicite au moment de cette migration.
-- Après migration, seule cette table fait foi pour le Workspace Catalogue.

CREATE TABLE IF NOT EXISTS catalog_global_access_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID REFERENCES users(id),
  reason      TEXT,
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_catalog_global_access
  ON catalog_global_access_grants (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_global_access_user
  ON catalog_global_access_grants (user_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE catalog_global_access_grants IS
  'Historique des grants autorisant les mutations du catalogue global Komerce. Le rôle admin seul ne confère jamais cette autorité.';

INSERT INTO catalog_global_access_grants (user_id, reason)
SELECT g.user_id, 'bootstrap-from-dashboard-global-authority-2026-08-26'
FROM dashboard_global_access_grants g
WHERE g.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM catalog_global_access_grants c
    WHERE c.user_id = g.user_id
      AND c.revoked_at IS NULL
  );
