-- @migration 133_webauthn_credentials.sql
-- @domain    auth-passkey
-- @purpose   AUTH-2 — passkeys WebAuthn L3 : credentials enregistrées + challenges
--            éphémères stockés serveur (décision actée : table, pas cookie signé —
--            évite de dépendre de la politique cookie AUTH-8b/c encore en cours,
--            et permet un TTL/consommation atomique en SQL).

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id    TEXT NOT NULL,
  public_key       TEXT NOT NULL,
  sign_count       BIGINT NOT NULL DEFAULT 0,
  transports       TEXT[] NOT NULL DEFAULT '{}',
  aaguid           TEXT,
  backup_eligible  BOOLEAN NOT NULL DEFAULT FALSE,
  backup_state     BOOLEAN NOT NULL DEFAULT FALSE,
  device_label     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user
  ON webauthn_credentials(user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL pour un login discoverable (user pas encore connu au moment du challenge).
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  challenge      TEXT NOT NULL,
  ceremony_type  TEXT NOT NULL CHECK (ceremony_type IN ('register', 'login')),
  expires_at     TIMESTAMPTZ NOT NULL,
  consumed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (challenge)
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
  ON webauthn_challenges(challenge)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE webauthn_credentials IS
  'Passkeys WebAuthn (AUTH-2). Owner exclusif : feature auth-passkey. Jamais de DDL runtime.';
COMMENT ON TABLE webauthn_challenges IS
  'Challenges register/login à usage unique, TTL court (2 min), consommés atomiquement '
  'via UPDATE ... WHERE consumed_at IS NULL RETURNING (voir services/webauthn-service.js).';
