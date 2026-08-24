-- @migration 145_dashboard_global_access_grants.sql
-- @domain    admin-dashboard
-- @purpose   LOT 2C — rendre l'autorité dashboard globale explicite, persistée
--            et révocable. Le rôle users.role='admin' ne suffit jamais à
--            autoriser une agrégation cross-market.
--
--            Cette table est volontairement DISTINCTE de operator_market_scopes :
--            - operator_market_scopes répond « quels marchés ce user peut opérer ? »
--            - dashboard_global_access_grants répond « ce user peut-il voir le
--              contexte dashboard global Komerce ? »
--
--            Bootstrap de compatibilité : au moment UNIQUE de cette migration,
--            les admins déjà présents ET sans scope marché actif reçoivent un
--            grant global explicite. Ce n'est pas une règle runtime : tout admin
--            créé après cette migration reste sans accès global tant qu'un grant
--            n'est pas créé explicitement.

CREATE TABLE IF NOT EXISTS dashboard_global_access_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID REFERENCES users(id),
  reason      TEXT,
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_dashboard_global_access
  ON dashboard_global_access_grants (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dashboard_global_access_user
  ON dashboard_global_access_grants (user_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE dashboard_global_access_grants IS
  'Historique des grants autorisant le contexte dashboard global Komerce. '
  'Jamais dérivé du rôle admin ni de l absence de operator_market_scopes.';

COMMENT ON COLUMN dashboard_global_access_grants.revoked_at IS
  'NULL = grant global actif. Révocation historisée par UPDATE, jamais DELETE.';

-- Bootstrap unique de l'administration centrale existante.
-- IMPORTANT : l'absence de scope n'est utilisée qu'ici comme critère de
-- migration du legacy vers un GRANT PERSISTÉ. Après cette migration, seul
-- dashboard_global_access_grants fait foi.
INSERT INTO dashboard_global_access_grants (user_id, reason)
SELECT u.id, 'legacy-central-bootstrap-2026-08-24'
FROM users u
WHERE u.role = 'admin'
  AND NOT EXISTS (
    SELECT 1
    FROM operator_market_scopes oms
    WHERE oms.user_id = u.id
      AND oms.revoked_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM dashboard_global_access_grants g
    WHERE g.user_id = u.id
      AND g.revoked_at IS NULL
  );
