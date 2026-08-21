-- @migration 136_operator_market_scopes.sql
-- @domain    market
-- @purpose   M1 — historique d'ACCÈS des opérateurs aux marchés, grain user.
--            Schéma validé dans KOMERCE_MARKET_LAYER_FREEZE.md §1 (2026-08-19).
--
--            Cette table répond à « quels users pouvaient toucher tel marché
--            à telle date ? ». Elle ne répond PAS à « quelle entité économique
--            exploitait ce marché et devait recevoir sa part ? » — cette
--            question est celle du settlement (grain organisation), une
--            primitive séparée et différée, jamais dérivée de cette table.
--
--            id est l'identité du GRANT, pas du couple (user_id, market_id) :
--            un même opérateur peut être révoqué puis re-invité sur le même
--            marché, ce qui produit plusieurs lignes distinctes dans le temps
--            (granted 2027 / revoked 2028 / re-granted 2029), jamais une
--            seule ligne réécrite.
--
--            Révocation = UPDATE revoked_at, jamais DELETE. L'historique
--            d'accès complet doit rester reconstructible.

CREATE TABLE IF NOT EXISTS operator_market_scopes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- identité du grant, pas du couple
  user_id     UUID NOT NULL REFERENCES users(id),
  market_id   UUID NOT NULL REFERENCES markets(id),
  role        TEXT NOT NULL CHECK (role IN ('viewer', 'manager')),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID REFERENCES users(id),
  revoked_at  TIMESTAMPTZ,                                 -- NULL = actif
  revoked_by  UUID REFERENCES users(id)
);

-- Au plus UN grant actif par (user, market). Les grants révoqués n'entrent
-- pas dans la contrainte, ce qui autorise le cycle grant/revoke/re-grant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_operator_scope
  ON operator_market_scopes (user_id, market_id)
  WHERE revoked_at IS NULL;

-- Index de lecture chaude : résoudre les accès actifs d'un marché.
CREATE INDEX IF NOT EXISTS idx_operator_scope_market
  ON operator_market_scopes (market_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE operator_market_scopes IS
  'Historique d''ACCÈS opérateur → marché, grain user. Jamais la source de '
  'vérité du settlement (grain organisation, différé). Révocation = '
  'UPDATE revoked_at, jamais DELETE.';

COMMENT ON COLUMN operator_market_scopes.id IS
  'Identité du grant lui-même, pas du couple (user_id, market_id) — un '
  'cycle grant/revoke/re-grant produit plusieurs lignes distinctes.';

COMMENT ON COLUMN operator_market_scopes.revoked_at IS
  'NULL = grant actif. Un grant révoqué n''est jamais supprimé : '
  'l''historique d''accès doit rester reconstructible à tout instant.';
