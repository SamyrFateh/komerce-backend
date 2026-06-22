-- Migration 072 — Table de révocation JWT (N4)
-- ═══════════════════════════════════════════════════════════════════════
-- Permet de révoquer un token JWT avant son expiration naturelle.
-- Cas couverts : déconnexion explicite, changement de mot de passe admin,
--               compromission détectée, rotation forcée.
--
-- Stratégie : jti (JWT ID) unique par token, stocké à la révocation.
-- La vérification JWT check si le jti est dans revoked_tokens.
-- Le cron startJwtRevocationCleanupCron() purge les lignes expirées.
--
-- IDEMPOTENTE : IF NOT EXISTS.
-- Application : psql $DATABASE_URL -f migrations/072_jwt_revocation.sql
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         TEXT        PRIMARY KEY,                   -- JWT ID (uuid v4 ou hex 32 bytes)
  user_id     UUID,                                      -- optionnel — pour audit
  user_role   TEXT,                                      -- optionnel — pour audit
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,                      -- expiry naturelle du token → pour cleanup
  reason      TEXT                                       -- 'logout' | 'password_change' | 'forced'
);

CREATE INDEX IF NOT EXISTS idx_rt_expires_at ON revoked_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_rt_user_id    ON revoked_tokens (user_id) WHERE user_id IS NOT NULL;

COMMENT ON TABLE revoked_tokens IS
  'JWT révoqués avant expiration naturelle. '
  'Le cron startJwtRevocationCleanupCron purge les lignes dont expires_at < NOW().';

COMMIT;
